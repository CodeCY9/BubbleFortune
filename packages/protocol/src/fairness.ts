import { MONEY_VALUES, ROUND_TARGETS, RULE_VERSION, TOTAL_BOXES } from './config';
import { canonicalJsonStringify } from './canonical';
import { AuditEvent, FairnessProof } from './types';

export const FAIRNESS_ALGORITHM = 'hmac-sha256-fy-v1';
export const COMMIT_PREFIX = 'BubbleFortune/commit/v1\n';
export const SHUFFLE_MSG_PREFIX = 'BubbleFortune/shuffle/v1:';
export const GENESIS_PREVIOUS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

const HEX_REGEX = /^[0-9a-f]{64}$/;

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error('Invalid hex string length');
  }
  const buffer = new ArrayBuffer(hex.length / 2);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

export function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

export async function computeCommitmentWebCrypto(data: {
  algorithm: string;
  amounts: readonly number[] | number[];
  gameId: string;
  roundTargets: readonly number[] | number[];
  ruleVersion: string;
  salt: string;
  seed: string;
}): Promise<string> {
  const canonical = canonicalJsonStringify({
    algorithm: data.algorithm,
    amounts: Array.from(data.amounts),
    gameId: data.gameId,
    roundTargets: Array.from(data.roundTargets),
    ruleVersion: data.ruleVersion,
    salt: data.salt,
    seed: data.seed
  });

  const encoder = new TextEncoder();
  const payload = encoder.encode(COMMIT_PREFIX + canonical);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', payload);
  return bytesToHex(new Uint8Array(digest));
}

export async function shuffleWithHmacFyWebCrypto(
  seedHex: string,
  saltHex: string,
  amounts: readonly number[] | number[]
): Promise<{ values: number[]; counter: number }> {
  const values = Array.from(amounts);
  const seedBytes = hexToBytes(seedHex);
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    seedBytes as any,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  let counter = 0;
  const encoder = new TextEncoder();

  for (let i = values.length - 1; i > 0; ) {
    const n = i + 1;
    const msg = encoder.encode(`${SHUFFLE_MSG_PREFIX}${saltHex}:${counter}`);
    const signature = await globalThis.crypto.subtle.sign('HMAC', key, msg);
    const view = new DataView(signature);
    const val = view.getUint32(0, false); // big-endian
    counter++;

    const limit = Math.floor(0x100000000 / n) * n;
    if (val < limit) {
      const j = val % n;
      const tmp = values[i];
      values[i] = values[j];
      values[j] = tmp;
      i--;
    }
  }

  return { values, counter };
}

export interface FairnessVerificationOptions {
  initialCommitment?: string;
  finalBoxes?: Array<{ id: number; amount: number }>;
}

export type FairnessVerificationStatus =
  | 'VERIFIED'
  | 'SELF_CONSISTENT_NO_INITIAL_COMMITMENT'
  | 'INCOMPLETE'
  | 'INVALID';

export interface FairnessVerificationResult {
  valid: boolean;
  status: FairnessVerificationStatus;
  commitmentMatches: boolean;
  initialCommitmentMatches?: boolean;
  boxMappingMatches: boolean;
  error?: string;
  details?: {
    derivedCommitment: string;
    expectedCommitment: string;
    sampleCounter: number;
    boxMapping: Array<{ id: number; amount: number }>;
  };
}

export async function verifyFairnessProof(
  proof: unknown,
  options: FairnessVerificationOptions = {}
): Promise<FairnessVerificationResult> {
  try {
    if (!globalThis.crypto?.subtle) {
      return {
        valid: false,
        status: 'INVALID',
        commitmentMatches: false,
        boxMappingMatches: false,
        error: 'WebCrypto is not available in current environment'
      };
    }

    if (proof === null || typeof proof !== 'object' || Array.isArray(proof)) {
      return {
        valid: false,
        status: 'INVALID',
        commitmentMatches: false,
        boxMappingMatches: false,
        error: 'Proof must be a non-null object'
      };
    }

    const p = proof as Record<string, unknown>;

    // Check algorithm
    if (p.algorithm !== FAIRNESS_ALGORITHM) {
      return {
        valid: false,
        status: 'INVALID',
        commitmentMatches: false,
        boxMappingMatches: false,
        error: `Unsupported algorithm: expected ${FAIRNESS_ALGORITHM}, got ${String(p.algorithm)}`
      };
    }

    // Classic and versioned challenge proofs are independently verifiable.
    // Challenge pools are carried inside the proof and are never accepted for
    // the Classic rule version.
    const isChallengeRule = typeof p.ruleVersion === 'string' && /^challenge-26-v\d+$/.test(p.ruleVersion);
    const isSurvivorRule = typeof p.ruleVersion === 'string' && /^survivor-26-v\d+$/.test(p.ruleVersion);
    if (p.ruleVersion !== RULE_VERSION && !isChallengeRule && !isSurvivorRule) {
      return {
        valid: false,
        status: 'INVALID',
        commitmentMatches: false,
        boxMappingMatches: false,
        error: `Unsupported ruleVersion: got ${String(p.ruleVersion)}`
      };
    }

    // Check gameId
    if (typeof p.gameId !== 'string' || p.gameId.length === 0 || p.gameId.length > 128) {
      return {
        valid: false,
        status: 'INVALID',
        commitmentMatches: false,
        boxMappingMatches: false,
        error: 'Invalid gameId in proof'
      };
    }

    // Check seed (64 lowercase hex)
    if (typeof p.seed !== 'string' || !HEX_REGEX.test(p.seed)) {
      return {
        valid: false,
        status: 'INVALID',
        commitmentMatches: false,
        boxMappingMatches: false,
        error: 'Invalid seed: must be 64 lowercase hex characters (32 bytes)'
      };
    }

    // Check salt (64 lowercase hex)
    if (typeof p.salt !== 'string' || !HEX_REGEX.test(p.salt)) {
      return {
        valid: false,
        status: 'INVALID',
        commitmentMatches: false,
        boxMappingMatches: false,
        error: 'Invalid salt: must be 64 lowercase hex characters (32 bytes)'
      };
    }

    // Check commitment (64 lowercase hex)
    if (typeof p.commitment !== 'string' || !HEX_REGEX.test(p.commitment)) {
      return {
        valid: false,
        status: 'INVALID',
        commitmentMatches: false,
        boxMappingMatches: false,
        error: 'Invalid commitment format: must be 64 lowercase hex characters'
      };
    }

    // Classic uses its fixed public pool; challenge versions use a server
    // selected pool but still require exactly 26 unique safe integer values.
    if (!Array.isArray(p.amounts) || p.amounts.length !== TOTAL_BOXES) {
      return {
        valid: false,
        status: 'INVALID',
        commitmentMatches: false,
        boxMappingMatches: false,
        error: `Invalid amounts: must have exactly ${MONEY_VALUES.length} items`
      };
    }

    for (let i = 0; i < TOTAL_BOXES; i++) {
      const val = p.amounts[i];
      const invalidClassic = !isChallengeRule && val !== MONEY_VALUES[i];
      if (typeof val !== 'number' || !Number.isSafeInteger(val) || val < 0 || invalidClassic) {
        return {
          valid: false,
          status: 'INVALID',
          commitmentMatches: false,
          boxMappingMatches: false,
          error: `Invalid amount configuration at index ${i}: got ${String(val)}`
        };
      }
    }
    if (isChallengeRule && new Set(p.amounts as number[]).size !== TOTAL_BOXES) {
      return {
        valid: false,
        status: 'INVALID',
        commitmentMatches: false,
        boxMappingMatches: false,
        error: 'Challenge amount pool must contain 26 unique values'
      };
    }

    // Check roundTargets: must match ROUND_TARGETS
    if (!Array.isArray(p.roundTargets) || p.roundTargets.length !== ROUND_TARGETS.length) {
      return {
        valid: false,
        status: 'INVALID',
        commitmentMatches: false,
        boxMappingMatches: false,
        error: `Invalid roundTargets: must have exactly ${ROUND_TARGETS.length} items`
      };
    }

    for (let i = 0; i < ROUND_TARGETS.length; i++) {
      const val = p.roundTargets[i];
      if (typeof val !== 'number' || !Number.isSafeInteger(val) || val !== ROUND_TARGETS[i]) {
        return {
          valid: false,
          status: 'INVALID',
          commitmentMatches: false,
          boxMappingMatches: false,
          error: `Invalid roundTargets configuration at index ${i}: expected ${ROUND_TARGETS[i]}, got ${String(val)}`
        };
      }
    }

    // Recompute commitment
    const derivedCommitment = await computeCommitmentWebCrypto({
      algorithm: p.algorithm as string,
      amounts: p.amounts as number[],
      gameId: p.gameId as string,
      roundTargets: p.roundTargets as number[],
      ruleVersion: p.ruleVersion as string,
      salt: p.salt as string,
      seed: p.seed as string
    });

    const commitmentMatches = derivedCommitment === p.commitment;
    if (!commitmentMatches) {
      return {
        valid: false,
        status: 'INVALID',
        commitmentMatches: false,
        boxMappingMatches: false,
        error: `Commitment hash mismatch: derived ${derivedCommitment}, proof contains ${p.commitment}`
      };
    }

    // Check initial commitment if provided
    let initialCommitmentMatches: boolean | undefined = undefined;
    if (options.initialCommitment !== undefined) {
      initialCommitmentMatches = options.initialCommitment === p.commitment;
      if (!initialCommitmentMatches) {
        return {
          valid: false,
          status: 'INVALID',
          commitmentMatches: true,
          initialCommitmentMatches: false,
          boxMappingMatches: false,
          error: `Initial commitment mismatch: expected ${options.initialCommitment}, proof contains ${p.commitment}`
        };
      }
    }

    // Compute shuffle mapping
    const { values, counter } = await shuffleWithHmacFyWebCrypto(
      p.seed as string,
      p.salt as string,
      p.amounts as number[]
    );

    const derivedBoxMapping = values.map((amount, idx) => ({
      id: idx + 1,
      amount
    }));

    // Missing finalBoxes: cannot claim verified box mapping; return INCOMPLETE
    if (options.finalBoxes === undefined) {
      return {
        valid: false,
        status: 'INCOMPLETE',
        commitmentMatches: true,
        initialCommitmentMatches,
        boxMappingMatches: false,
        error: 'Incomplete verification: final box mapping (26 boxes) was not provided',
        details: {
          derivedCommitment,
          expectedCommitment: p.commitment as string,
          sampleCounter: counter,
          boxMapping: derivedBoxMapping
        }
      };
    }

    // Verify final boxes
    if (!Array.isArray(options.finalBoxes) || options.finalBoxes.length !== TOTAL_BOXES) {
      return {
        valid: false,
        status: 'INVALID',
        commitmentMatches: true,
        initialCommitmentMatches,
        boxMappingMatches: false,
        error: `Final boxes must contain exactly ${MONEY_VALUES.length} boxes`
      };
    }

    const seenIds = new Set<number>();
    for (const box of options.finalBoxes) {
      if (
        box === null ||
        typeof box !== 'object' ||
        typeof box.id !== 'number' ||
        !Number.isSafeInteger(box.id) ||
        box.id < 1 ||
        box.id > TOTAL_BOXES ||
        seenIds.has(box.id)
      ) {
        return {
          valid: false,
          status: 'INVALID',
          commitmentMatches: true,
          initialCommitmentMatches,
          boxMappingMatches: false,
          error: `Duplicate or out-of-range box ID: ${box?.id}`
        };
      }
      seenIds.add(box.id);

      const expectedAmount = values[box.id - 1];
      if (box.amount !== expectedAmount) {
        return {
          valid: false,
          status: 'INVALID',
          commitmentMatches: true,
          initialCommitmentMatches,
          boxMappingMatches: false,
          error: `Box ${box.id} amount mismatch: expected ${expectedAmount}, finalBoxes has ${box.amount}`
        };
      }
    }

    if (seenIds.size !== TOTAL_BOXES) {
      return {
        valid: false,
        status: 'INVALID',
        commitmentMatches: true,
        initialCommitmentMatches,
        boxMappingMatches: false,
        error: `Missing box IDs in finalBoxes: received ${seenIds.size} of ${MONEY_VALUES.length}`
      };
    }

    const status: FairnessVerificationStatus =
      options.initialCommitment === undefined
        ? 'SELF_CONSISTENT_NO_INITIAL_COMMITMENT'
        : 'VERIFIED';

    return {
      valid: true,
      status,
      commitmentMatches: true,
      initialCommitmentMatches,
      boxMappingMatches: true,
      details: {
        derivedCommitment,
        expectedCommitment: p.commitment as string,
        sampleCounter: counter,
        boxMapping: derivedBoxMapping
      }
    };
  } catch (err: any) {
    return {
      valid: false,
      status: 'INVALID',
      commitmentMatches: false,
      boxMappingMatches: false,
      error: err?.message || 'Verification failed'
    };
  }
}

export async function verifyAuditTrailWebCrypto(
  trail: unknown
): Promise<{ valid: boolean; error?: string }> {
  try {
    if (!globalThis.crypto?.subtle) {
      return { valid: false, error: 'WebCrypto is not available in current environment' };
    }

    if (!Array.isArray(trail) || trail.length === 0) {
      return { valid: false, error: 'Audit trail must be a non-empty array' };
    }

    const encoder = new TextEncoder();
    const HEX64_REGEX = /^[0-9a-f]{64}$/;

    for (let i = 0; i < trail.length; i++) {
      const event = trail[i];
      if (!event || typeof event !== 'object' || Array.isArray(event)) {
        return { valid: false, error: `Invalid audit event at index ${i}` };
      }

      if (
        typeof event.seq !== 'number' ||
        !Number.isSafeInteger(event.seq) ||
        event.seq !== i + 1
      ) {
        return {
          valid: false,
          error: `Sequence mismatch at index ${i}: expected ${i + 1}, got ${event.seq}`
        };
      }

      if (
        typeof event.timestamp !== 'number' ||
        !Number.isSafeInteger(event.timestamp) ||
        event.timestamp <= 0
      ) {
        return {
          valid: false,
          error: `Invalid timestamp at seq ${event.seq}: must be a positive safe integer`
        };
      }

      if (typeof event.type !== 'string' || event.type.length === 0) {
        return {
          valid: false,
          error: `Invalid type at seq ${event.seq}: must be a non-empty string`
        };
      }

      if (
        typeof event.payload !== 'object' ||
        event.payload === null ||
        Array.isArray(event.payload)
      ) {
        return {
          valid: false,
          error: `Invalid payload at seq ${event.seq}: must be a non-null object`
        };
      }

      if (typeof event.previousHash !== 'string' || !HEX64_REGEX.test(event.previousHash)) {
        return {
          valid: false,
          error: `Invalid previousHash at seq ${event.seq}: must be 64-character lowercase hex`
        };
      }

      if (typeof event.hash !== 'string' || !HEX64_REGEX.test(event.hash)) {
        return {
          valid: false,
          error: `Invalid hash at seq ${event.seq}: must be 64-character lowercase hex`
        };
      }

      if (i === 0) {
        if (event.type !== 'GAME_CREATED') {
          return {
            valid: false,
            error: `Initial event must be GAME_CREATED, got ${event.type}`
          };
        }
        if (event.previousHash !== GENESIS_PREVIOUS_HASH) {
          return {
            valid: false,
            error: `Genesis previousHash mismatch: expected ${GENESIS_PREVIOUS_HASH}, got ${event.previousHash}`
          };
        }
      } else {
        if (event.previousHash !== trail[i - 1].hash) {
          return {
            valid: false,
            error: `Hash chain break at seq ${event.seq}: previousHash does not match prior event hash`
          };
        }
      }

      const { hash, ...withoutHash } = event;
      const canonical = canonicalJsonStringify(withoutHash);
      const digest = await globalThis.crypto.subtle.digest('SHA-256', encoder.encode(canonical));
      const calculatedHash = bytesToHex(new Uint8Array(digest));

      if (calculatedHash !== event.hash) {
        return {
          valid: false,
          error: `Event hash mismatch at seq ${event.seq}: calculated ${calculatedHash}, got ${event.hash}`
        };
      }
    }

    // Incomplete chain check: final event must be GAME_SETTLED for complete game audit trail
    const lastEvent = trail[trail.length - 1];
    if (lastEvent.type !== 'GAME_SETTLED') {
      return {
        valid: false,
        error: `Incomplete audit trail: final event must be GAME_SETTLED, got ${lastEvent.type}`
      };
    }

    return { valid: true };
  } catch (err: any) {
    return { valid: false, error: err?.message || 'Audit trail verification failed' };
  }
}
