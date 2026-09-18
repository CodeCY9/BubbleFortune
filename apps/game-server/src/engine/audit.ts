import crypto from 'node:crypto';
import { canonicalJsonStringify } from '../../../../packages/protocol/src/canonical';
import { AuditEvent } from '../../../../packages/protocol/src/types';
import { GENESIS_PREVIOUS_HASH } from '../../../../packages/protocol/src/fairness';

export { GENESIS_PREVIOUS_HASH };

export function computeEventHash(eventWithoutHash: Omit<AuditEvent, 'hash'>): string {
  const canonical = canonicalJsonStringify({
    payload: eventWithoutHash.payload,
    previousHash: eventWithoutHash.previousHash,
    seq: eventWithoutHash.seq,
    timestamp: eventWithoutHash.timestamp,
    type: eventWithoutHash.type
  });
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

export function createAuditEvent(params: {
  seq: number;
  timestamp: number;
  type: string;
  payload: Record<string, unknown>;
  previousHash: string;
}): AuditEvent {
  const hash = computeEventHash(params);
  return {
    seq: params.seq,
    timestamp: params.timestamp,
    type: params.type,
    payload: params.payload,
    previousHash: params.previousHash,
    hash
  };
}

export function verifyAuditTrailSync(trail: unknown): { valid: boolean; error?: string } {
  try {
    if (!Array.isArray(trail) || trail.length === 0) {
      return { valid: false, error: 'Audit trail must be a non-empty array' };
    }

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
      const calculatedHash = computeEventHash(withoutHash);
      if (calculatedHash !== hash) {
        return {
          valid: false,
          error: `Event hash mismatch at seq ${event.seq}: calculated ${calculatedHash}, got ${hash}`
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
