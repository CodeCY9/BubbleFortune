import { ClientCommand, ErrorCode, PublicError } from './types';

const MAX_PAYLOAD_BYTES = 2048;
const MAX_STRING_LEN = 128;

const ALLOWED_COMMAND_TYPES = new Set([
  'SELECT_BOX',
  'OPEN_BOX',
  'ACCEPT_OFFER',
  'REJECT_OFFER',
  'KEEP_BOX',
  'SWAP_BOX',
  'USE_INQUIRY',
  'BUY_INSURANCE',
  'DECLINE_RAISE',
  'REQUEST_SNAPSHOT'
]);

const ALLOWED_KEYS_BY_TYPE: Record<string, Set<string>> = {
  REQUEST_SNAPSHOT: new Set(['type']),
  SELECT_BOX: new Set(['type', 'gameId', 'stateVersion', 'commandSequence', 'idempotencyKey', 'boxId']),
  OPEN_BOX: new Set(['type', 'gameId', 'stateVersion', 'commandSequence', 'idempotencyKey', 'boxId']),
  ACCEPT_OFFER: new Set(['type', 'gameId', 'stateVersion', 'commandSequence', 'idempotencyKey', 'offerId']),
  REJECT_OFFER: new Set(['type', 'gameId', 'stateVersion', 'commandSequence', 'idempotencyKey', 'offerId']),
  KEEP_BOX: new Set(['type', 'gameId', 'stateVersion', 'commandSequence', 'idempotencyKey']),
  SWAP_BOX: new Set(['type', 'gameId', 'stateVersion', 'commandSequence', 'idempotencyKey', 'targetBoxId']),
  USE_INQUIRY: new Set(['type', 'gameId', 'stateVersion', 'commandSequence', 'idempotencyKey']),
  BUY_INSURANCE: new Set(['type', 'gameId', 'stateVersion', 'commandSequence', 'idempotencyKey']),
  DECLINE_RAISE: new Set(['type', 'gameId', 'stateVersion', 'commandSequence', 'idempotencyKey'])
};

export interface ValidationResult {
  valid: boolean;
  command?: ClientCommand;
  error?: PublicError;
}

export function validateClientCommand(raw: unknown): ValidationResult {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      valid: false,
      error: { code: 'INVALID_PAYLOAD', message: 'Payload must be a non-null object' }
    };
  }

  // Check JSON size limit
  try {
    const jsonStr = JSON.stringify(raw);
    if (jsonStr.length > MAX_PAYLOAD_BYTES) {
      return {
        valid: false,
        error: { code: 'INVALID_PAYLOAD', message: 'Payload exceeds size limit' }
      };
    }
  } catch {
    return {
      valid: false,
      error: { code: 'INVALID_PAYLOAD', message: 'Payload serialization failure' }
    };
  }

  const obj = raw as Record<string, unknown>;

  if (typeof obj.type !== 'string' || !ALLOWED_COMMAND_TYPES.has(obj.type)) {
    return {
      valid: false,
      error: { code: 'INVALID_PAYLOAD', message: 'Missing or unknown command type' }
    };
  }

  if (obj.type === 'REQUEST_SNAPSHOT') {
    const keys = Object.keys(obj);
    if (keys.length !== 1) {
      return {
        valid: false,
        error: { code: 'INVALID_PAYLOAD', message: 'Unexpected fields in snapshot request' }
      };
    }
    return { valid: true, command: { type: 'REQUEST_SNAPSHOT' } };
  }

  const allowedKeys = ALLOWED_KEYS_BY_TYPE[obj.type];
  if (!allowedKeys) {
    return {
      valid: false,
      error: { code: 'INVALID_PAYLOAD', message: 'Unsupported command type' }
    };
  }

  // Reject ANY unknown fields (such as injected amount, value, ev, etc.)
  for (const k of Object.keys(obj)) {
    if (!allowedKeys.has(k)) {
      return {
        valid: false,
        error: { code: 'INVALID_PAYLOAD', message: 'Payload contains unknown field: ' + k }
      };
    }
  }

  // Validate common header fields
  if (typeof obj.gameId !== 'string' || obj.gameId.length === 0 || obj.gameId.length > MAX_STRING_LEN) {
    return {
      valid: false,
      error: { code: 'INVALID_PAYLOAD', message: 'Invalid gameId' }
    };
  }

  if (
    typeof obj.stateVersion !== 'number' ||
    !Number.isInteger(obj.stateVersion) ||
    obj.stateVersion < 0
  ) {
    return {
      valid: false,
      error: { code: 'INVALID_PAYLOAD', message: 'stateVersion must be a non-negative integer' }
    };
  }

  if (
    typeof obj.commandSequence !== 'number' ||
    !Number.isInteger(obj.commandSequence) ||
    obj.commandSequence < 1
  ) {
    return {
      valid: false,
      error: { code: 'INVALID_PAYLOAD', message: 'commandSequence must be a positive integer' }
    };
  }

  if (
    typeof obj.idempotencyKey !== 'string' ||
    obj.idempotencyKey.length === 0 ||
    obj.idempotencyKey.length > MAX_STRING_LEN
  ) {
    return {
      valid: false,
      error: { code: 'INVALID_PAYLOAD', message: 'Invalid idempotencyKey' }
    };
  }

  // Validate specific command fields
  if (obj.type === 'SELECT_BOX' || obj.type === 'OPEN_BOX') {
    if (
      typeof obj.boxId !== 'number' ||
      !Number.isInteger(obj.boxId) ||
      obj.boxId < 1 ||
      obj.boxId > 26
    ) {
      return {
        valid: false,
        error: { code: 'INVALID_BOX', message: 'boxId must be an integer between 1 and 26' }
      };
    }
  } else if (obj.type === 'ACCEPT_OFFER' || obj.type === 'REJECT_OFFER') {
    if (
      typeof obj.offerId !== 'string' ||
      obj.offerId.length === 0 ||
      obj.offerId.length > MAX_STRING_LEN
    ) {
      return {
        valid: false,
        error: { code: 'INVALID_PAYLOAD', message: 'Invalid offerId' }
      };
    }
  } else if (obj.type === 'SWAP_BOX') {
    if (
      typeof obj.targetBoxId !== 'number' ||
      !Number.isInteger(obj.targetBoxId) ||
      obj.targetBoxId < 1 ||
      obj.targetBoxId > 26
    ) {
      return {
        valid: false,
        error: { code: 'INVALID_BOX', message: 'targetBoxId must be an integer between 1 and 26' }
      };
    }
  }

  return {
    valid: true,
    command: obj as unknown as ClientCommand
  };
}
