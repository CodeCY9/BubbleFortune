import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { validateDealAcceptance } from '../src/utils/preferences';
import {
  pinInitialCommitment,
  getPinnedCommitment,
  verifyGameFairness,
  FAIRNESS_STORAGE_KEY,
} from '../src/utils/fairnessStorage';
import {
  fetchGuestStatus,
  ensureGuestSession,
  fetchHistoryList,
  fetchHistoryDetail,
} from '../src/api/history';
import {
  createInitialPresentationState,
  applySnapshotToPresentation,
  commitBoxOpenAnimation,
} from '../src/utils/presentationManager';
import {
  computeCommitmentWebCrypto,
  shuffleWithHmacFyWebCrypto,
  FAIRNESS_ALGORITHM,
} from '../packages/protocol/src/fairness';
import { MONEY_VALUES, ROUND_TARGETS, RULE_VERSION } from '../packages/protocol/src/config';
import { createAuditEvent, GENESIS_PREVIOUS_HASH } from '../apps/game-server/src/engine/audit';
import type {
  PublicSnapshot,
  PublicSettlement,
  FairnessProof,
} from '../packages/protocol/src/types';

function attachAuditFixture(gameId: string, settlement: PublicSettlement) {
  const created = createAuditEvent({ seq: 1, timestamp: 1, type: 'GAME_CREATED',
    payload: { gameId, ruleVersion: RULE_VERSION, commitment: settlement.fairnessProof?.commitment },
    previousHash: GENESIS_PREVIOUS_HASH });
  settlement.auditTrail = [created, createAuditEvent({ seq: 2, timestamp: 2, type: 'GAME_SETTLED',
    payload: { resultId: settlement.resultId, wonAmount: settlement.wonAmount, outcomeType: settlement.outcomeType,
      originalPlayerBoxId: settlement.originalPlayerBoxId, finalPlayerBoxId: settlement.finalPlayerBoxId }, previousHash: created.hash })];
}

describe('Production Helper & Verification Test Suite', () => {
  let mockStorage: Record<string, string> = {};
  const originalWindow = (globalThis as any).window;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    mockStorage = {};
    (globalThis as any).window = {
      localStorage: {
        getItem: (k: string) => mockStorage[k] ?? null,
        setItem: (k: string, v: string) => {
          mockStorage[k] = String(v);
        },
        removeItem: (k: string) => {
          delete mockStorage[k];
        },
        clear: () => {
          mockStorage = {};
        },
      },
    };
  });

  afterEach(() => {
    (globalThis as any).window = originalWindow;
    globalThis.fetch = originalFetch;
  });

  describe('1. Strict validateDealAcceptance Production Safeguards', () => {
    function checkDeal(
      amount: number,
      options?: {
        deadlineTimestamp?: number | null;
        requireDeadline?: boolean;
        serverNow?: number;
        networkBufferMs?: number;
      }
    ) {
      const offerId = 'offer-safe-1';
      return validateDealAcceptance({
        confirmingOffer: { offerId, amount },
        currentOfferId: offerId,
        currentOfferAmount: amount,
        currentPhase: 'BANKER_OFFER',
        deadlineTimestamp: options?.deadlineTimestamp,
        requireDeadline: options?.requireDeadline,
        serverNow: options?.serverNow,
        networkBufferMs: options?.networkBufferMs,
      });
    }

    it('1.1 必须提供正有限金额 (Requires positive finite amount)', () => {
      assert.strictEqual(checkDeal(0).valid, false);
      assert.strictEqual(checkDeal(-500).valid, false);
      assert.strictEqual(checkDeal(NaN).valid, false);
      assert.strictEqual(checkDeal(Infinity).valid, false);
      assert.strictEqual(checkDeal(-Infinity).valid, false);
      assert.strictEqual(checkDeal(1000).valid, true);
    });

    it('1.2 默认 requireDeadline=false 时兼容遗留测试 (Legacy compatibility without deadline)', () => {
      assert.strictEqual(checkDeal(1500, { deadlineTimestamp: null }).valid, true);
      assert.strictEqual(checkDeal(1500, { deadlineTimestamp: undefined }).valid, true);
    });

    it('1.3 生产环境 requireDeadline=true 严格阻断无截止时间报价', () => {
      assert.strictEqual(checkDeal(1500, { deadlineTimestamp: null, requireDeadline: true }).valid, false);
      assert.strictEqual(checkDeal(1500, { deadlineTimestamp: undefined, requireDeadline: true }).valid, false);
      assert.strictEqual(checkDeal(1500, { deadlineTimestamp: NaN, requireDeadline: true }).valid, false);
    });

    it('1.4 已过期或处于网络保护缓冲期内的报价被拒绝', () => {
      const now = Date.now();
      // Past deadline
      const expired = now - 500;
      assert.strictEqual(checkDeal(1500, { deadlineTimestamp: expired, requireDeadline: true, serverNow: now }).valid, false);

      // Within 200ms grace window (barely expiring)
      const barelyExpiring = now + 100;
      assert.strictEqual(checkDeal(1500, { deadlineTimestamp: barelyExpiring, requireDeadline: true, serverNow: now, networkBufferMs: 200 }).valid, false);

      // Healthy future deadline
      const healthy = now + 5000;
      assert.strictEqual(checkDeal(1500, { deadlineTimestamp: healthy, requireDeadline: true, serverNow: now, networkBufferMs: 200 }).valid, true);
    });
  });

  describe('2. Fairness Commitment Storage & Anti-Tampering Engine', () => {
    // 64-char hex strings
    const seedHex = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const saltHex = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';

    it('2.1 在局中 (非 FINISHED) 锚定初始承诺并锁定不可篡改', () => {
      const gameId = 'game-test-001';
      const commitment = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

      pinInitialCommitment({
        gameId,
        phase: 'SELECTING',
        fairness: { supported: true, commitment },
      } as PublicSnapshot);

      assert.strictEqual(getPinnedCommitment(gameId)?.commitment, commitment);

      // Subsequent conflict within game is flagged as tampered
      pinInitialCommitment({
        gameId,
        phase: 'OFFERING',
        fairness: { supported: true, commitment: 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff' },
      } as PublicSnapshot);

      const pinned = getPinnedCommitment(gameId);
      assert.strictEqual(pinned?.commitment, commitment);
      assert.strictEqual(pinned?.tamperedMismatch, true);
    });

    it('2.2 首帧即为 FINISHED 时不当做初始承诺 (Late join ignore)', () => {
      const gameId = 'game-finished-direct';
      pinInitialCommitment({
        gameId,
        phase: 'FINISHED',
        fairness: { supported: true, commitment: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' },
      } as PublicSnapshot);

      assert.strictEqual(getPinnedCommitment(gameId), null);
    });

    it('2.3 篡改检测：最终结算承诺与局初锚定承诺不符时报 TAMPERED', async () => {
      const gameId = 'game-tampered-001';
      const initialCommitment = '0000000000000000000000000000000000000000000000000000000000000001';
      pinInitialCommitment({
        gameId,
        phase: 'SELECTING',
        fairness: { supported: true, commitment: initialCommitment },
      } as PublicSnapshot);

      const proof: FairnessProof = {
        algorithm: FAIRNESS_ALGORITHM,
        gameId,
        ruleVersion: RULE_VERSION,
        seed: seedHex,
        salt: saltHex,
        amounts: Array.from(MONEY_VALUES),
        roundTargets: Array.from(ROUND_TARGETS),
        commitment: '0000000000000000000000000000000000000000000000000000000000000002',
      };

      const settlement: PublicSettlement = {
        resultId: 'res-1',
        wonAmount: 100,
        outcomeType: 'FINAL_KEEP',
        originalPlayerBoxId: 1,
        finalPlayerBoxId: 1,
        allBoxes: Array.from(MONEY_VALUES).map((amt, idx) => ({ id: idx + 1, amount: amt })),
        fairnessProof: proof,
      };

      attachAuditFixture(gameId, settlement);
      const outcome = await verifyGameFairness({
        gameId,
        settlement,
      });

      assert.strictEqual(outcome.status, 'TAMPERED');
      assert.strictEqual(outcome.valid, false);
      assert.strictEqual(outcome.hasInitialCommitment, true);
    });

    it('2.4 局初锚定承诺与结算计算完全一致时报 VERIFIED', async () => {
      const gameId = 'game-verified-001';
      const proofData = {
        algorithm: FAIRNESS_ALGORITHM,
        gameId,
        ruleVersion: RULE_VERSION,
        seed: seedHex,
        salt: saltHex,
        amounts: MONEY_VALUES,
        roundTargets: ROUND_TARGETS,
      };

      const validHash = await computeCommitmentWebCrypto(proofData);
      const proof: FairnessProof = {
        ...proofData,
        amounts: Array.from(MONEY_VALUES),
        roundTargets: Array.from(ROUND_TARGETS),
        commitment: validHash,
      };

      // Pin initial commitment at opening phase
      pinInitialCommitment({
        gameId,
        phase: 'OPENING',
        fairness: { supported: true, commitment: validHash },
      } as PublicSnapshot);

      // Shuffle amounts with FY to generate matching allBoxes
      const { values } = await shuffleWithHmacFyWebCrypto(seedHex, saltHex, MONEY_VALUES);
      const allBoxes = values.map((amount, idx) => ({ id: idx + 1, amount }));

      const settlement: PublicSettlement = {
        resultId: 'res-verified-1',
        wonAmount: values[0],
        outcomeType: 'FINAL_KEEP',
        originalPlayerBoxId: 1,
        finalPlayerBoxId: 1,
        allBoxes,
        fairnessProof: proof,
      };

      attachAuditFixture(gameId, settlement);
      const outcome = await verifyGameFairness({
        gameId,
        settlement,
      });

      assert.strictEqual(outcome.status, 'VERIFIED');
      assert.strictEqual(outcome.valid, true);
      assert.strictEqual(outcome.hasInitialCommitment, true);
    });

    it('2.5 无局初锚定但内部自洽时报 SELF_CONSISTENT', async () => {
      const gameId = 'game-self-consistent';
      const proofData = {
        algorithm: FAIRNESS_ALGORITHM,
        gameId,
        ruleVersion: RULE_VERSION,
        seed: seedHex,
        salt: saltHex,
        amounts: MONEY_VALUES,
        roundTargets: ROUND_TARGETS,
      };

      const validHash = await computeCommitmentWebCrypto(proofData);
      const proof: FairnessProof = {
        ...proofData,
        amounts: Array.from(MONEY_VALUES),
        roundTargets: Array.from(ROUND_TARGETS),
        commitment: validHash,
      };

      const { values } = await shuffleWithHmacFyWebCrypto(seedHex, saltHex, MONEY_VALUES);
      const allBoxes = values.map((amount, idx) => ({ id: idx + 1, amount }));

      // Do NOT pin initial commitment
      const settlement: PublicSettlement = {
        resultId: 'res-self-1',
        wonAmount: values[0],
        outcomeType: 'FINAL_KEEP',
        originalPlayerBoxId: 1,
        finalPlayerBoxId: 1,
        allBoxes,
        fairnessProof: proof,
      };

      attachAuditFixture(gameId, settlement);
      const outcome = await verifyGameFairness({
        gameId,
        settlement,
      });

      assert.strictEqual(outcome.status, 'SELF_CONSISTENT');
      assert.strictEqual(outcome.valid, true);
      assert.strictEqual(outcome.hasInitialCommitment, false);
    });

    it('2.6 缺少公平性证明数据报 UNSUPPORTED', async () => {
      const outcome = await verifyGameFairness({
        gameId: 'game-no-proof',
        settlement: {
          resultId: 'res-none',
          wonAmount: 50,
          outcomeType: 'FINAL_KEEP',
          originalPlayerBoxId: 1,
          finalPlayerBoxId: 1,
          fairnessProof: null,
        },
      });

      assert.strictEqual(outcome.status, 'UNSUPPORTED');
      assert.strictEqual(outcome.valid, false);
    });
  });

  describe('3. History & Guest API Error Mapping', () => {
    it('3.1 503 DATABASE_UNAVAILABLE 明确识别服务维护状态', async () => {
      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({
            code: 'DATABASE_UNAVAILABLE',
          }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        );

      const statusRes = await fetchGuestStatus();
      assert.strictEqual(statusRes.ok, false);
      assert.strictEqual(statusRes.error?.code, 'DATABASE_UNAVAILABLE');
      assert.match(statusRes.error?.message || '', /历史战绩服务暂时维护中/);

      const listRes = await fetchHistoryList();
      assert.strictEqual(listRes.ok, false);
      assert.strictEqual(listRes.error?.code, 'DATABASE_UNAVAILABLE');
    });

    it('3.2 战绩详情 404 映射为延迟入库文案', async () => {
      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({
            code: 'RECORD_NOT_FOUND',
            message: 'Game settlement record not found',
          }),
          { status: 404, headers: { 'Content-Type': 'application/json' } }
        );

      const detailRes = await fetchHistoryDetail('res-delayed-123');
      assert.strictEqual(detailRes.ok, false);
      assert.strictEqual(detailRes.error?.code, 'RECORD_NOT_FOUND');
      assert.match(detailRes.error?.message || '', /记录不存在或尚在保存/);
    });

    it('3.3 正常获取战绩列表与分页', async () => {
      globalThis.fetch = async (input: RequestInfo | URL) => {
        const url = String(input);
        assert.match(url, /limit=10/);
        assert.match(url, /offset=20/);
        return new Response(
          JSON.stringify({
            items: [
              {
                resultId: 'r-1',
                gameId: 'g-1',
                aiType: 'conservative',
                wonAmount: 8888,
                outcomeType: 'OFFER_ACCEPTED',
                completedAt: 1720000000000,
                ruleVersion: RULE_VERSION,
                originalPlayerBoxId: 1,
                finalPlayerBoxId: 1,
              },
            ],
            total: 21,
            limit: 10,
            offset: 20,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      };

      const listRes = await fetchHistoryList({ limit: 10, offset: 20 });
      assert.strictEqual(listRes.ok, true);
      assert.strictEqual(listRes.data?.items.length, 1);
      assert.strictEqual(listRes.data?.total, 21);
      assert.strictEqual(listRes.data?.items[0].wonAmount, 8888);
    });
  });

  describe('4. Presentation Manager offerHistory Synchronization', () => {
    it('4.1 初始快照立即可见 offerHistory', () => {
      const state = createInitialPresentationState();
      const mockHistory = [
        { offerId: 'off-1', round: 1, amount: 2500, expiresAt: 10000, outcome: 'REJECTED' as const },
      ];

      const snapshot: PublicSnapshot = {
        gameId: 'game-pres-1',
        ruleVersion: 'v1.0',
        phase: 'OFFERING',
        stateVersion: 2,
        lastCommandSequence: 1,
        serverNow: 1000,
        originalPlayerBoxId: 1,
        currentPlayerBoxId: 1,
        currentRound: 2,
        boxesToOpenThisRound: 0,
        totalOpenedBoxes: 6,
        unopenedCount: 19,
        boxes: [],
        currentOffer: { offerId: 'off-2', amount: 5000, expiresAt: 20000 },
        deadlineTimestamp: 20000,
        settlement: null,
        offerHistory: mockHistory,
      };

      const result = applySnapshotToPresentation(state, snapshot, true);
      assert.strictEqual(result.state.bankerOffer, 5000);
      assert.deepStrictEqual(result.state.offerHistory, mockHistory);
    });

    it('4.2 箱子开启动画期间扣留 offerHistory，动画结束同时提交', () => {
      const state = createInitialPresentationState();
      // Set opening box
      const stateOpening = {
        ...state,
        openingBoxId: 5,
        phase: 'OPEN_BOXES' as const,
      };

      const mockHistory = [
        { offerId: 'off-1', round: 1, amount: 1200, expiresAt: 10000, outcome: 'REJECTED' as const },
      ];

      const snapshot: PublicSnapshot = {
        gameId: 'game-pres-2',
        ruleVersion: 'v1.0',
        phase: 'OFFERING',
        stateVersion: 5,
        lastCommandSequence: 3,
        serverNow: 1000,
        originalPlayerBoxId: 1,
        currentPlayerBoxId: 1,
        currentRound: 2,
        boxesToOpenThisRound: 0,
        totalOpenedBoxes: 6,
        unopenedCount: 19,
        boxes: [{ id: 5, status: 'opened', revealedAmount: 100 }],
        currentOffer: { offerId: 'off-new', amount: 4800, expiresAt: 30000 },
        deadlineTimestamp: 30000,
        settlement: null,
        offerHistory: mockHistory,
      };

      // When processing snapshot while box is opening, offer and offerHistory must be held back
      const resultDuringAnimation = applySnapshotToPresentation(stateOpening, snapshot, false);
      assert.strictEqual(resultDuringAnimation.state.bankerOffer, 0);
      assert.deepStrictEqual(resultDuringAnimation.state.offerHistory, []);

      // Completing the box animation commits held offer and offerHistory together
      const stateAfterAnimation = commitBoxOpenAnimation(
        resultDuringAnimation.state,
        5,
        resultDuringAnimation.state.epoch,
        snapshot,
        snapshot.gameId
      );
      assert.strictEqual(stateAfterAnimation.bankerOffer, 4800);
      assert.deepStrictEqual(stateAfterAnimation.offerHistory, mockHistory);
    });
  });
});
