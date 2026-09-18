import {
  ClientCommand,
  CommandResult,
  CompletedGameRecord,
  PublicGameEvent,
  PublicSettlement,
  PublicSnapshot,
  AiType
} from '../../../../packages/protocol/src/types';
import { GameEngine, GameEngineOptions } from './GameEngine';

export const CHALLENGE_RULE_VERSION = 'challenge-26-v2';
export const CHALLENGE_NO_DEAL_ROUNDS = 3;
export const CHALLENGE_POOL_ID = 'volatile-v1';

/** Challenge rules are server-owned; only effective public flags are exposed. */
export const CHALLENGE_CONFIG = Object.freeze({
  noDealRounds: CHALLENGE_NO_DEAL_ROUNDS,
  finalSwapDisabled: true,
  hideAmountList: true,
  inquiryEnabled: true,
  poolId: CHALLENGE_POOL_ID,
  timedOpeningSeconds: 15,
  insuranceEnabled: true,
  insurancePremium: 500,
  insuranceFloor: 5_000,
  raiseDeclineEnabled: true
});

// Server-only versioned pool. The per-game seed still randomizes its mapping.
const CHALLENGE_AMOUNT_POOLS: Record<string, readonly number[]> = {
  [CHALLENGE_POOL_ID]: [
    1, 5, 10, 25, 50, 75, 100, 200, 300, 500, 750, 1_000, 1_500,
    3_000, 5_000, 10_000, 25_000, 50_000, 75_000, 100_000, 150_000,
    250_000, 400_000, 600_000, 800_000, 1_200_000
  ]
};

type ChallengeCommand = ClientCommand & { type?: string };

/** Challenge mode wraps the Classic authority with its versioned rule set. */
export class Challenge26Engine {
  private readonly inner: GameEngine;
  private inquiryUsed = false;
  private insurancePurchased = false;
  private raiseDeclined = false;
  private readonly inquiryIdempotency = new Map<string, CommandResult>();
  private readonly insuranceIdempotency = new Map<string, CommandResult>();
  private readonly raiseIdempotency = new Map<string, CommandResult>();
  private onEventHandler?: (event: PublicGameEvent, snapshot: PublicSnapshot) => void;

  public readonly gameId: string;
  public readonly aiType: AiType;

  constructor(options: GameEngineOptions = {}) {
    const amountValues = options.customBoxAmountMap
      ? undefined
      : CHALLENGE_AMOUNT_POOLS[CHALLENGE_CONFIG.poolId];
    this.inner = new GameEngine({
      ...options,
      amountValues,
      ruleVersion: CHALLENGE_RULE_VERSION,
      openingTimeoutSeconds: CHALLENGE_CONFIG.timedOpeningSeconds
    });
    this.gameId = this.inner.gameId;
    this.aiType = this.inner.aiType;
    this.inner.setOnEventHandler((event, snapshot) => {
      const decoratedSnapshot = this.decorate(snapshot);
      const decoratedEvent = event.type === 'GAME_SETTLED'
        ? { ...event, settlement: this.decorateSettlement(event.settlement) }
        : event;
      this.onEventHandler?.(decoratedEvent, decoratedSnapshot);
    });
  }

  public setOnEventHandler(handler: (event: PublicGameEvent, snapshot: PublicSnapshot) => void): void {
    this.onEventHandler = handler;
  }

  public getPublicSnapshot(): PublicSnapshot {
    return this.decorate(this.inner.getPublicSnapshot());
  }

  public getStateVersion(): number { return this.inner.getStateVersion(); }
  public getPhase() { return this.inner.getPhase(); }
  public isFinished(): boolean { return this.inner.isFinished(); }
  public dispose(): void { this.inner.dispose(); }

  public processCommand(rawInput: unknown): CommandResult {
    const raw = rawInput as ChallengeCommand;
    if (!raw || typeof raw !== 'object') return this.inner.processCommand(rawInput);
    if (raw.type === 'USE_INQUIRY') return this.useInquiry(raw);
    if (raw.type === 'BUY_INSURANCE') return this.buyInsurance(raw);
    if (raw.type === 'DECLINE_RAISE') return this.declineRaise(raw);

    const snapshot = this.inner.getPublicSnapshot();
    if (raw.type === 'ACCEPT_OFFER' && snapshot.phase === 'OFFERING' && snapshot.currentRound <= CHALLENGE_CONFIG.noDealRounds) {
      return this.errorResult(raw, 'INVALID_PHASE', `挑战模式前 ${CHALLENGE_CONFIG.noDealRounds} 轮禁止成交`);
    }

    const result = this.inner.processCommand(rawInput);
    // Challenge mode always keeps the selected box after the 24th opening.
    if (result.success && raw.type === 'OPEN_BOX' && result.snapshot?.phase === 'FINAL_SWAP') {
      const finalSnapshot = this.inner.getPublicSnapshot();
      const automaticKeep = {
        type: 'KEEP_BOX' as const,
        gameId: this.gameId,
        stateVersion: finalSnapshot.stateVersion,
        commandSequence: finalSnapshot.lastCommandSequence + 1,
        idempotencyKey: `challenge-auto-keep-${finalSnapshot.stateVersion}`
      };
      const settled = this.inner.processCommand(automaticKeep);
      return { ...result, stateVersion: settled.stateVersion, snapshot: this.getPublicSnapshot() };
    }
    return this.decorateResult(result);
  }

  public getCompletedRecord(): CompletedGameRecord | null {
    const record = this.inner.getCompletedRecord();
    if (!record) return null;
    const cloned = structuredClone(record);
    cloned.ruleVersion = CHALLENGE_RULE_VERSION;
    cloned.settlement = this.decorateSettlement(cloned.settlement);
    if (cloned.settlement.fairnessProof) cloned.settlement.fairnessProof.ruleVersion = CHALLENGE_RULE_VERSION;
    return cloned;
  }

  private useInquiry(raw: ChallengeCommand): CommandResult { return this.processMetadataFlag(raw, 'inquiry'); }

  private buyInsurance(raw: ChallengeCommand): CommandResult {
    const snapshot = this.inner.getPublicSnapshot();
    if (!CHALLENGE_CONFIG.insuranceEnabled) return this.errorResult(raw, 'INVALID_PHASE', '当前挑战配置未启用保险契约');
    if (snapshot.phase !== 'OPENING' || snapshot.totalOpenedBoxes !== 0) {
      return this.errorResult(raw, 'INVALID_PHASE', '保险契约只能在首次开箱前购买');
    }
    return this.processMetadataFlag(raw, 'insurance');
  }

  private declineRaise(raw: ChallengeCommand): CommandResult {
    const snapshot = this.inner.getPublicSnapshot();
    if (!CHALLENGE_CONFIG.raiseDeclineEnabled || snapshot.phase !== 'OFFERING' || !snapshot.currentOffer) {
      return this.errorResult(raw, 'INVALID_PHASE', '当前没有可拒绝的加码报价');
    }
    if (this.raiseDeclined) return this.errorResult(raw, 'INVALID_PHASE', '拒绝加码能力每局只能使用一次');
    const key = this.commandKey(raw);
    const cached = key ? this.raiseIdempotency.get(key) : undefined;
    if (cached) return cached;
    const transformed = { ...raw, type: 'REJECT_OFFER' as const, offerId: snapshot.currentOffer.offerId };
    const result = this.inner.processCommand(transformed);
    if (!result.success) return this.decorateResult(result);
    this.raiseDeclined = true;
    const nextSnapshot = this.getPublicSnapshot();
    const declined: CommandResult = {
      ...result,
      idempotencyKey: key || result.idempotencyKey,
      event: { type: 'RAISE_DECLINED', stateVersion: nextSnapshot.stateVersion },
      snapshot: nextSnapshot
    };
    if (key) this.raiseIdempotency.set(key, declined);
    return declined;
  }

  private processMetadataFlag(raw: ChallengeCommand, flag: 'inquiry' | 'insurance'): CommandResult {
    const key = this.commandKey(raw);
    const cache = flag === 'inquiry' ? this.inquiryIdempotency : this.insuranceIdempotency;
    const cached = key ? cache.get(key) : undefined;
    if (cached) return cached;
    const snapshot = this.inner.getPublicSnapshot();
    if (!key || raw.gameId !== this.gameId || raw.stateVersion !== snapshot.stateVersion || raw.commandSequence !== snapshot.lastCommandSequence + 1) {
      return this.errorResult(raw, 'STALE_VERSION', '挑战能力请求已过期，请按当前快照重试');
    }
    if (flag === 'inquiry' && this.inquiryUsed) return this.errorResult(raw, 'INVALID_PHASE', '询价能力每局只能使用一次');
    if (flag === 'inquiry' && snapshot.phase !== 'OPENING' && snapshot.phase !== 'OFFERING') {
      return this.errorResult(raw, 'INVALID_PHASE', '当前阶段不能使用询价能力');
    }
    if (flag === 'insurance' && this.insurancePurchased) return this.errorResult(raw, 'INVALID_PHASE', '保险契约每局只能购买一次');

    const advanced = this.inner.processMetadataCommand(raw.commandSequence);
    if (!advanced.success) return this.decorateResult(advanced);
    if (flag === 'inquiry') this.inquiryUsed = true;
    if (flag === 'insurance') this.insurancePurchased = true;
    const nextSnapshot = this.getPublicSnapshot();
    const event: PublicGameEvent = flag === 'inquiry'
      ? { type: 'INQUIRY_USED', stateVersion: nextSnapshot.stateVersion }
      : { type: 'INSURANCE_PURCHASED', stateVersion: nextSnapshot.stateVersion };
    const result: CommandResult = { success: true, idempotencyKey: key, stateVersion: nextSnapshot.stateVersion, event, snapshot: nextSnapshot };
    cache.set(key, result);
    this.onEventHandler?.(event, nextSnapshot);
    return result;
  }

  private commandKey(raw: ChallengeCommand): string | undefined {
    return typeof raw.idempotencyKey === 'string' && raw.idempotencyKey.length > 0 ? raw.idempotencyKey : undefined;
  }

  private decorateResult(result: CommandResult): CommandResult {
    return { ...result, snapshot: result.snapshot ? this.decorate(result.snapshot) : this.getPublicSnapshot() };
  }

  private errorResult(raw: ChallengeCommand, code: 'STALE_VERSION' | 'INVALID_PHASE', message: string): CommandResult {
    return { success: false, idempotencyKey: this.commandKey(raw), stateVersion: this.inner.getStateVersion(), snapshot: this.getPublicSnapshot(), error: { code, message } };
  }

  private decorateSettlement(settlement: PublicSettlement): PublicSettlement {
    if (!this.insurancePurchased) return settlement;
    const preInsuranceWonAmount = settlement.wonAmount;
    const insuredAmount = Math.max(preInsuranceWonAmount, CHALLENGE_CONFIG.insuranceFloor);
    return {
      ...settlement,
      wonAmount: Math.max(0, insuredAmount - CHALLENGE_CONFIG.insurancePremium),
      preInsuranceWonAmount,
      insurancePremium: CHALLENGE_CONFIG.insurancePremium,
      insuranceFloor: CHALLENGE_CONFIG.insuranceFloor
    };
  }

  private decorate(snapshot: PublicSnapshot): PublicSnapshot {
    return {
      ...snapshot,
      ruleVersion: CHALLENGE_RULE_VERSION,
      settlement: snapshot.settlement ? this.decorateSettlement(snapshot.settlement) : null,
      challenge: {
        noDealRounds: CHALLENGE_CONFIG.noDealRounds,
        finalSwapDisabled: CHALLENGE_CONFIG.finalSwapDisabled,
        inquiryAvailable: CHALLENGE_CONFIG.inquiryEnabled && !this.inquiryUsed,
        inquiryUsed: this.inquiryUsed,
        poolId: CHALLENGE_CONFIG.poolId,
        timedOpeningSeconds: CHALLENGE_CONFIG.timedOpeningSeconds,
        insuranceAvailable: CHALLENGE_CONFIG.insuranceEnabled && !this.insurancePurchased && snapshot.phase === 'OPENING' && snapshot.totalOpenedBoxes === 0,
        insurancePurchased: this.insurancePurchased,
        insurancePremium: CHALLENGE_CONFIG.insurancePremium,
        insuranceFloor: CHALLENGE_CONFIG.insuranceFloor,
        raiseDeclineAvailable: CHALLENGE_CONFIG.raiseDeclineEnabled && !this.raiseDeclined && snapshot.phase === 'OFFERING' && Boolean(snapshot.currentOffer),
        raiseDeclined: this.raiseDeclined
      }
    };
  }
}
