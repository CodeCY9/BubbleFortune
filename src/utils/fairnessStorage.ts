import type {
  PublicSnapshot,
  PublicSettlement,
  AuditEvent,
  CompletedGameRecord,
} from '../../packages/protocol/src/types';
import { RULE_VERSION } from '../../packages/protocol/src/config';
import {
  verifyFairnessProof,
  verifyAuditTrailWebCrypto,
  FAIRNESS_ALGORITHM,
} from '../../packages/protocol/src/fairness';

export interface PinnedCommitment {
  version: 1;
  gameId: string;
  commitment: string;
  algorithm: string;
  ruleVersion: string;
  pinnedAt: number;
  tamperedMismatch?: boolean;
  conflictingCommitment?: string;
}

export const FAIRNESS_STORAGE_KEY = 'bubble_fortune_pinned_commitments_v1';

const HEX64_REGEX = /^[0-9a-f]{64}$/;

function getSafeStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    // Catch SecurityError when storage access is restricted or denied
  }
  return null;
}

export function isValidPinnedCommitment(item: unknown): item is PinnedCommitment {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
  const p = item as Record<string, unknown>;
  return (
    p.version === 1 &&
    typeof p.gameId === 'string' &&
    p.gameId.trim().length > 0 &&
    typeof p.commitment === 'string' &&
    HEX64_REGEX.test(p.commitment) &&
    typeof p.algorithm === 'string' &&
    p.algorithm.trim().length > 0 &&
    typeof p.ruleVersion === 'string' &&
    p.ruleVersion.trim().length > 0 &&
    typeof p.pinnedAt === 'number' &&
    Number.isFinite(p.pinnedAt) &&
    p.pinnedAt > 0 &&
    (p.tamperedMismatch === undefined || typeof p.tamperedMismatch === 'boolean') &&
    (p.conflictingCommitment === undefined || typeof p.conflictingCommitment === 'string')
  );
}

function readPinnedStorage(): Record<string, PinnedCommitment> {
  const storage = getSafeStorage();
  if (!storage) return {};
  try {
    const raw = storage.getItem(FAIRNESS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    const clean: Record<string, PinnedCommitment> = {};
    for (const [key, val] of Object.entries(parsed)) {
      if (isValidPinnedCommitment(val) && val.gameId === key) {
        clean[key] = val;
      }
    }
    return clean;
  } catch {
    return {};
  }
}

function writePinnedStorage(data: Record<string, PinnedCommitment>): boolean {
  const storage = getSafeStorage();
  if (!storage) return false;
  try {
    storage.setItem(FAIRNESS_STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

/**
 * Pin initial commitment upon seeing first non-FINISHED snapshot.
 * Finished game history snapshots cannot pretend to be initial witnessed commitments.
 * Checks commitment, algorithm, and ruleVersion consistency.
 * Returns true only if write succeeded (never pretends persistence).
 */
export function pinInitialCommitment(snapshot: PublicSnapshot): boolean {
  const gameId = snapshot.gameId;
  const commitment = snapshot.fairness?.commitment;
  const algorithm = snapshot.fairness?.algorithm || FAIRNESS_ALGORITHM;
  const ruleVersion = snapshot.ruleVersion || RULE_VERSION;

  if (
    !gameId ||
    typeof gameId !== 'string' ||
    !commitment ||
    typeof commitment !== 'string' ||
    !HEX64_REGEX.test(commitment)
  ) {
    return false;
  }

  const storage = readPinnedStorage();
  const existing = storage[gameId];

  // If already pinned for this gameId: check for any metadata/commitment conflict
  if (existing) {
    const isConflict =
      existing.commitment !== commitment ||
      existing.algorithm !== algorithm ||
      existing.ruleVersion !== ruleVersion;

    if (isConflict) {
      existing.tamperedMismatch = true;
      existing.conflictingCommitment = commitment;
      return writePinnedStorage(storage);
    }
    return true;
  }

  // Phase FINISHED: cannot add new initial witness pin
  if (snapshot.phase === 'FINISHED') {
    return false;
  }

  const newPin: PinnedCommitment = {
    version: 1,
    gameId,
    commitment,
    algorithm,
    ruleVersion,
    pinnedAt: Date.now(),
  };

  storage[gameId] = newPin;
  return writePinnedStorage(storage);
}

export function getPinnedCommitment(gameId: string): PinnedCommitment | null {
  if (!gameId || typeof gameId !== 'string') return null;
  const storage = readPinnedStorage();
  const item = storage[gameId];
  return item && isValidPinnedCommitment(item) ? item : null;
}

export interface FairnessVerificationOutcome {
  valid: boolean;
  status: 'VERIFIED' | 'SELF_CONSISTENT' | 'UNSUPPORTED' | 'TAMPERED' | 'INVALID';
  message: string;
  hasInitialCommitment: boolean;
  pinnedCommitment?: string;
  derivedCommitment?: string;
  error?: string;
  details?: any;
}

function mapProofErrorToChinese(err?: string): string {
  if (!err) return '公平证明校验未通过';
  if (err.includes('Unsupported algorithm')) return '加密算法不支持或版本不匹配';
  if (err.includes('Unsupported ruleVersion')) return '游戏规则版本不匹配';
  if (err.includes('Invalid seed')) return '随机种子格式非法（须为64位十六进制）';
  if (err.includes('Invalid salt')) return '随机盐值格式非法（须为64位十六进制）';
  if (err.includes('Invalid commitment')) return '承诺哈希格式非法';
  if (err.includes('Commitment hash mismatch')) return '承诺哈希校验失败：重新计算的哈希与公布哈希不符';
  if (err.includes('Initial commitment mismatch')) return '初始承诺不匹配：公布承诺与开局见证的承诺不一致';
  if (err.includes('amount mismatch')) return '箱子开奖点数与洗牌还原结果不符';
  if (err.includes('Duplicate or out-of-range')) return '箱子编号非法或存在重复项';
  if (err.includes('Missing box IDs')) return '开奖终局箱子映射不完整';
  if (err.includes('Incomplete verification')) return '终局箱子完整映射缺失，校验不完整';
  return `公平证明校验未通过: ${err}`;
}

function mapAuditErrorToChinese(err?: string): string {
  if (!err) return '审计追踪事件链校验未通过';
  if (err.includes('Genesis previousHash')) return '首个事件的前序哈希不匹配';
  if (err.includes('Sequence mismatch')) return '审计事件序号不连续';
  if (err.includes('Hash chain break')) return '审计追踪哈希链断裂（前序事件哈希被篡改）';
  if (err.includes('Event hash mismatch')) return '审计事件内容哈希与记录不符（内容被篡改）';
  if (err.includes('Incomplete audit trail')) return '审计追踪未包含终局结算事件（事件链不完整）';
  if (err.includes('Initial event must be GAME_CREATED')) return '首个审计事件必须是对局创建 (GAME_CREATED)';
  return `审计追踪哈希链校验失败: ${err}`;
}

/**
 * Verify game fairness using WebCrypto and authoritative protocol verification.
 * Enforces strict initial commitment matching, audit trail event chain, and box mapping.
 */
export async function verifyGameFairness(
  recordOrSettlement:
    | CompletedGameRecord
    | {
        gameId: string;
        ruleVersion?: string;
        settlement: PublicSettlement;
        auditTrail?: AuditEvent[];
      }
): Promise<FairnessVerificationOutcome> {
  if (typeof globalThis.crypto === 'undefined' || !globalThis.crypto.subtle) {
    return {
      valid: false,
      status: 'INVALID',
      message: 'WebCrypto 在当前环境不可用，请使用安全连接 (HTTPS / localhost)',
      hasInitialCommitment: false,
      error: 'WEBCRYPTO_UNAVAILABLE',
    };
  }

  const gameId = recordOrSettlement.gameId;
  const ruleVersion = recordOrSettlement.ruleVersion || RULE_VERSION;
  const settlement = recordOrSettlement.settlement;
  const auditTrail = settlement?.auditTrail || (recordOrSettlement as any).auditTrail;

  if (!settlement || !settlement.fairnessProof) {
    return {
      valid: false,
      status: 'UNSUPPORTED',
      message: '该对局不支持公平证明或未包含证明数据（可能为旧版本对局）',
      hasInitialCommitment: false,
    };
  }

  const proof = settlement.fairnessProof;

  // Check gameId and ruleVersion consistency
  if (proof.gameId !== gameId) {
    return {
      valid: false,
      status: 'INVALID',
      message: `证明中的对局标识 (${proof.gameId}) 与当前记录 (${gameId}) 不匹配`,
      hasInitialCommitment: false,
      error: 'GAME_ID_MISMATCH',
    };
  }

  if (proof.ruleVersion !== ruleVersion) {
    return {
      valid: false,
      status: 'INVALID',
      message: `证明中的规则版本 (${proof.ruleVersion}) 与对局规则 (${ruleVersion}) 不匹配`,
      hasInitialCommitment: false,
      error: 'RULE_VERSION_MISMATCH',
    };
  }

  // Final boxes verification requirement: finalBoxes missing cannot claim verified
  if (!settlement.allBoxes || !Array.isArray(settlement.allBoxes) || settlement.allBoxes.length !== 26) {
    return {
      valid: false,
      status: 'INVALID',
      message: '终局箱子完整映射缺失，无法通过公平校验',
      hasInitialCommitment: false,
      error: 'FINAL_BOXES_MISSING',
    };
  }

  // Check pinned initial commitment (valid pin only)
  const pinned = getPinnedCommitment(gameId);
  if (pinned) {
    if (
      pinned.tamperedMismatch ||
      pinned.commitment !== proof.commitment ||
      pinned.algorithm !== proof.algorithm ||
      pinned.ruleVersion !== proof.ruleVersion
    ) {
      return {
        valid: false,
        status: 'TAMPERED',
        message: `开局承诺被篡改：初始记录承诺 (${pinned.commitment}) 与结算公布承诺 (${proof.commitment}) 不匹配`,
        hasInitialCommitment: true,
        pinnedCommitment: pinned.commitment,
        error: 'INITIAL_COMMITMENT_TAMPERED',
      };
    }
  }

  // Execute WebCrypto verification from packages/protocol/src/fairness
  const proofResult = await verifyFairnessProof(proof, {
    initialCommitment: pinned ? pinned.commitment : undefined,
    finalBoxes: settlement.allBoxes,
  });

  if (!proofResult.valid) {
    return {
      valid: false,
      status: 'INVALID',
      message: mapProofErrorToChinese(proofResult.error),
      hasInitialCommitment: Boolean(pinned),
      pinnedCommitment: pinned?.commitment,
      derivedCommitment: proofResult.details?.derivedCommitment,
      error: proofResult.error,
      details: proofResult.details,
    };
  }

  // Verify Audit Trail strictly - missing or empty audit trail cannot be silently glossed over
  if (!auditTrail || !Array.isArray(auditTrail) || auditTrail.length === 0) {
    return {
      valid: false,
      status: 'INVALID',
      message: '审计追踪事件链数据缺失，无法完成完整性校验',
      hasInitialCommitment: Boolean(pinned),
      pinnedCommitment: pinned?.commitment,
      error: 'AUDIT_TRAIL_MISSING',
    };
  }

  const auditRes = await verifyAuditTrailWebCrypto(auditTrail);
  if (!auditRes.valid) {
    return {
      valid: false,
      status: 'INVALID',
      message: mapAuditErrorToChinese(auditRes.error),
      hasInitialCommitment: Boolean(pinned),
      pinnedCommitment: pinned?.commitment,
      error: auditRes.error,
    };
  }

  const first = auditTrail[0].payload;
  const last = auditTrail[auditTrail.length - 1].payload;
  const resultKeys = ['resultId', 'wonAmount', 'outcomeType', 'originalPlayerBoxId', 'finalPlayerBoxId'] as const;
  const amounts = new Map(settlement.allBoxes.map(box => [box.id, box.amount]));
  if (first.gameId !== gameId || first.ruleVersion !== ruleVersion || first.commitment !== proof.commitment ||
      resultKeys.some(key => last[key] !== settlement[key]) ||
      auditTrail.some(event => event.type === 'BOX_OPENED' &&
        amounts.get(event.payload.boxId as number) !== event.payload.revealedAmount)) {
    return { valid: false, status: 'INVALID', message: '事件记录与本局承诺、开箱金额或结算不一致',
      hasInitialCommitment: Boolean(pinned), error: 'AUDIT_RECORD_MISMATCH' };
  }

  // Only return VERIFIED when initial commitment was pinned, matches, and proof is verified
  if (
    pinned &&
    !pinned.tamperedMismatch &&
    pinned.commitment === proof.commitment &&
    pinned.algorithm === proof.algorithm &&
    pinned.ruleVersion === proof.ruleVersion &&
    proofResult.status === 'VERIFIED' &&
    proofResult.initialCommitmentMatches === true
  ) {
    return {
      valid: true,
      status: 'VERIFIED',
      message: '与开局承诺一致（完整校验通过，随机种子、承诺哈希、开箱映射与审计链完全吻合）',
      hasInitialCommitment: true,
      pinnedCommitment: pinned.commitment,
      derivedCommitment: proofResult.details?.derivedCommitment,
      details: proofResult.details,
    };
  }

  return {
    valid: true,
    status: 'SELF_CONSISTENT',
    message: '终局证据自洽，未核对开局承诺（未在开局时见证承诺，证明内哈希与映射自洽）',
    hasInitialCommitment: false,
    derivedCommitment: proofResult.details?.derivedCommitment,
    details: proofResult.details,
  };
}

/**
 * Generate and trigger download of fairness proof JSON payload.
 */
export function downloadFairnessProofJson(
  recordOrSettlement:
    | CompletedGameRecord
    | {
        gameId: string;
        ruleVersion?: string;
        settlement: PublicSettlement;
        auditTrail?: AuditEvent[];
      },
  verificationOutcome?: FairnessVerificationOutcome | null
): void {
  if (typeof window === 'undefined') return;

  const gameId = recordOrSettlement.gameId;
  const settlement = recordOrSettlement.settlement;
  const proof = settlement?.fairnessProof;

  const payload = {
    exportedAt: new Date().toISOString(),
    gameId,
    ruleVersion: recordOrSettlement.ruleVersion || RULE_VERSION,
    verification: verificationOutcome
      ? {
          status: verificationOutcome.status,
          valid: verificationOutcome.valid,
          message: verificationOutcome.message,
          hasInitialCommitment: verificationOutcome.hasInitialCommitment,
          pinnedCommitment: verificationOutcome.pinnedCommitment,
          derivedCommitment: verificationOutcome.derivedCommitment,
        }
      : null,
    fairnessProof: proof || null,
    allBoxes: settlement?.allBoxes || null,
    settlement: {
      resultId: settlement?.resultId,
      wonAmount: settlement?.wonAmount,
      outcomeType: settlement?.outcomeType,
      originalPlayerBoxId: settlement?.originalPlayerBoxId,
      finalPlayerBoxId: settlement?.finalPlayerBoxId,
    },
    auditTrail: settlement?.auditTrail || (recordOrSettlement as any).auditTrail || null,
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `bubble_fortune_fairness_${gameId}_${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
