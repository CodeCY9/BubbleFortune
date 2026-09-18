import { AuditEvent, PublicBox, PublicOffer, PublicOfferHistoryEntry, PublicError } from './types';
import type { RoomThemeId } from './theme';

export const DUEL_RULE_VERSION = 'duel-26-v1';

export type DuelSeatId = 0 | 1;

export type DuelRole = 'CHALLENGER' | 'BANKER';

export type DuelPhase =
  | 'WAITING'
  | 'SELECTING'
  | 'OPENING'
  | 'SUBMITTING_OFFER'
  | 'OFFERING'
  | 'FINAL_SWAP'
  | 'ROUND_COMPLETE'
  | 'FINISHED';

export interface DuelSeatInfo {
  seatId: DuelSeatId;
  occupied: boolean;
  nickname: string;
  connected: boolean;
  ready: boolean;
  continueReady: boolean;
  role: DuelRole | null;
  score: number;
}

export interface DuelOfferRange {
  min: number;
  max: number;
  step: 1;
}

export type DuelActionType =
  | 'READY'
  | 'START'
  | 'SELECT_BOX'
  | 'OPEN_BOX'
  | 'SUBMIT_OFFER'
  | 'ACCEPT_OFFER'
  | 'REJECT_OFFER'
  | 'KEEP_BOX'
  | 'SWAP_BOX'
  | 'CONTINUE_ROUND'
  | 'LEAVE';

export interface DuelPrivateView {
  seatId: DuelSeatId;
  lastCommandSequence: number;
  allowedActions: DuelActionType[];
  offerRange?: DuelOfferRange;
}

export interface DuelRoundResult {
  roundIndex: number;
  challengerSeatId: DuelSeatId;
  bankerSeatId: DuelSeatId;
  outcomeType: 'OFFER_ACCEPTED' | 'FINAL_KEEP' | 'FINAL_SWAP' | 'FORFEIT';
  originalPlayerBoxId: number;
  finalPlayerBoxId: number;
  originalPlayerBoxAmount: number;
  finalPlayerBoxAmount?: number;
  acceptedOfferAmount?: number;
  highestOfferAmount: number;
  challengerProfit: number;
  bankerProfit: number;
}

export interface DuelOfferHistoryEntry extends PublicOfferHistoryEntry {
  roundIndex: number;
}

export interface DuelFairnessProof {
  roundIndex: number;
  algorithm: string;
  gameId: string;
  matchId: string;
  ruleVersion: string;
  seed: string;
  salt: string;
  amounts: number[];
  roundTargets: number[];
  commitment: string;
  finalBoxes: Array<{ id: number; amount: number }>;
}

export interface DuelResult {
  resultId: string;
  matchId: string;
  ruleVersion: string;
  winnerSeatId: DuelSeatId | null;
  reason: 'NORMAL' | 'FORFEIT' | 'TIMEOUT_DISCONNECT' | 'BOTH_FORFEIT';
  finalScores: Record<DuelSeatId, number>;
  forfeitedSeatId?: DuelSeatId | null;
  rounds: DuelRoundResult[];
  fairnessProofs: DuelFairnessProof[];
  auditTrail: AuditEvent[];
}

export interface DuelPublicSnapshot {
  roomId: string;
  matchId: string;
  ruleVersion: string;
  isPrivate: boolean;
  ranked: boolean;
  /** Whether completed offer history is visible in the public live snapshot. */
  showOfferHistory?: boolean;
  /** Cosmetic room theme selected at creation; never affects gameplay. */
  themeId?: RoomThemeId;
  stateVersion: number;
  serverNow: number;
  phase: DuelPhase;
  roundIndex: number;
  boxRound: number;
  boxesLeftToOpenThisRound: number;
  seats: [DuelSeatInfo, DuelSeatInfo];
  hostSeatId: DuelSeatId | null;
  challengerSeatId: DuelSeatId | null;
  deadlineTimestamp: number | null;
  boxes: PublicBox[];
  openedBoxIds: number[];
  playerBoxId: number | null;
  currentOffer: PublicOffer | null;
  offerHistory: DuelOfferHistoryEntry[];
  roundResults: DuelRoundResult[];
  fairnessCommitments: Record<number, string>;
  result: DuelResult | null;
}

export interface DuelClientSnapshot {
  public: DuelPublicSnapshot;
  private: DuelPrivateView;
}

export interface DuelCommandHeader {
  stateVersion: number;
  commandSequence: number;
  idempotencyKey: string;
}

export interface DuelReadyCommand extends DuelCommandHeader {
  type: 'READY';
  ready: boolean;
}

export interface DuelStartCommand extends DuelCommandHeader {
  type: 'START';
}

export interface DuelSelectBoxCommand extends DuelCommandHeader {
  type: 'SELECT_BOX';
  boxId: number;
}

export interface DuelOpenBoxCommand extends DuelCommandHeader {
  type: 'OPEN_BOX';
  boxId: number;
}

export interface DuelSubmitOfferCommand extends DuelCommandHeader {
  type: 'SUBMIT_OFFER';
  amount: number;
}

export interface DuelAcceptOfferCommand extends DuelCommandHeader {
  type: 'ACCEPT_OFFER';
  offerId: string;
}

export interface DuelRejectOfferCommand extends DuelCommandHeader {
  type: 'REJECT_OFFER';
  offerId: string;
}

export interface DuelKeepBoxCommand extends DuelCommandHeader {
  type: 'KEEP_BOX';
}

export interface DuelSwapBoxCommand extends DuelCommandHeader {
  type: 'SWAP_BOX';
  targetBoxId: number;
}

export interface DuelContinueRoundCommand extends DuelCommandHeader {
  type: 'CONTINUE_ROUND';
}

export interface DuelLeaveCommand extends DuelCommandHeader {
  type: 'LEAVE';
}

export type DuelCommand =
  | DuelReadyCommand
  | DuelStartCommand
  | DuelSelectBoxCommand
  | DuelOpenBoxCommand
  | DuelSubmitOfferCommand
  | DuelAcceptOfferCommand
  | DuelRejectOfferCommand
  | DuelKeepBoxCommand
  | DuelSwapBoxCommand
  | DuelContinueRoundCommand
  | DuelLeaveCommand;

export interface DuelCommandResult {
  success: boolean;
  idempotencyKey?: string;
  stateVersion: number;
  snapshot?: DuelClientSnapshot;
  error?: PublicError;
}

export interface CompletedDuelRecord {
  matchId: string;
  resultId: string;
  ruleVersion: string;
  completedAt: number;
  /** Password/private rooms are historical-only and must not affect ranked Elo. */
  isPrivate?: boolean;
  ranked?: boolean;
  showOfferHistory?: boolean;
  seats: Array<{ seatId: DuelSeatId; nickname: string }>;
  result: DuelResult;
}

export interface DuelHistorySummaryItem {
  resultId: string;
  matchId: string;
  completedAt: number;
  ruleVersion: string;
  mySeatId: DuelSeatId;
  myScore: number;
  opponentScore: number;
  myNickname: string;
  opponentNickname: string;
  winnerSeatId: DuelSeatId | null;
  outcome: 'WIN' | 'LOSE' | 'DRAW' | 'VOID';
  reason: string;
}

export interface DuelHistoryListResponse {
  items: DuelHistorySummaryItem[];
  total: number;
  limit: number;
  offset: number;
}

export type DuelHistoryDetailResponse = CompletedDuelRecord & {
  mySeatId: DuelSeatId;
};

export const DUEL_TIMEOUT_SECONDS = {
  SELECT_PLAYER_BOX: 30,
  OPEN_BOX: 20,
  BANKER_OFFER: 25,
  CHALLENGER_DECISION: 30,
  FINAL_CHOICE: 30,
  ROUND_INTERMISSION: 30,
  RECONNECT_GRACE: 120
} as const;

export const DUEL_BANKER_BUDGET = 1000000;

const MAX_PAYLOAD_BYTES = 2048;
const MAX_STRING_LEN = 128;

const ALLOWED_DUEL_COMMAND_TYPES = new Set([
  'READY',
  'START',
  'SELECT_BOX',
  'OPEN_BOX',
  'SUBMIT_OFFER',
  'ACCEPT_OFFER',
  'REJECT_OFFER',
  'KEEP_BOX',
  'SWAP_BOX',
  'CONTINUE_ROUND',
  'LEAVE'
]);

const ALLOWED_KEYS_BY_DUEL_TYPE: Record<string, Set<string>> = {
  READY: new Set(['type', 'stateVersion', 'commandSequence', 'idempotencyKey', 'ready', 'matchId', 'roomId']),
  START: new Set(['type', 'stateVersion', 'commandSequence', 'idempotencyKey', 'matchId', 'roomId']),
  SELECT_BOX: new Set(['type', 'stateVersion', 'commandSequence', 'idempotencyKey', 'boxId', 'matchId', 'roomId']),
  OPEN_BOX: new Set(['type', 'stateVersion', 'commandSequence', 'idempotencyKey', 'boxId', 'matchId', 'roomId']),
  SUBMIT_OFFER: new Set(['type', 'stateVersion', 'commandSequence', 'idempotencyKey', 'amount', 'matchId', 'roomId']),
  ACCEPT_OFFER: new Set(['type', 'stateVersion', 'commandSequence', 'idempotencyKey', 'offerId', 'matchId', 'roomId']),
  REJECT_OFFER: new Set(['type', 'stateVersion', 'commandSequence', 'idempotencyKey', 'offerId', 'matchId', 'roomId']),
  KEEP_BOX: new Set(['type', 'stateVersion', 'commandSequence', 'idempotencyKey', 'matchId', 'roomId']),
  SWAP_BOX: new Set(['type', 'stateVersion', 'commandSequence', 'idempotencyKey', 'targetBoxId', 'matchId', 'roomId']),
  CONTINUE_ROUND: new Set(['type', 'stateVersion', 'commandSequence', 'idempotencyKey', 'matchId', 'roomId']),
  LEAVE: new Set(['type', 'stateVersion', 'commandSequence', 'idempotencyKey', 'matchId', 'roomId'])
};

export interface DuelValidationResult {
  valid: boolean;
  command?: DuelCommand;
  error?: PublicError;
}

export function validateDuelCommand(raw: unknown): DuelValidationResult {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      valid: false,
      error: { code: 'INVALID_PAYLOAD', message: 'Payload must be a non-null object' }
    };
  }

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

  if (typeof obj.type !== 'string' || !ALLOWED_DUEL_COMMAND_TYPES.has(obj.type)) {
    return {
      valid: false,
      error: { code: 'INVALID_PAYLOAD', message: 'Missing or unknown command type' }
    };
  }

  const allowedKeys = ALLOWED_KEYS_BY_DUEL_TYPE[obj.type];
  if (!allowedKeys) {
    return {
      valid: false,
      error: { code: 'INVALID_PAYLOAD', message: 'Unsupported command type' }
    };
  }

  for (const k of Object.keys(obj)) {
    if (!allowedKeys.has(k)) {
      return {
        valid: false,
        error: { code: 'INVALID_PAYLOAD', message: 'Payload contains forbidden or unknown fields' }
      };
    }
  }

  if (typeof obj.stateVersion !== 'number' || !Number.isSafeInteger(obj.stateVersion) || obj.stateVersion < 1) {
    return {
      valid: false,
      error: { code: 'INVALID_PAYLOAD', message: 'Invalid stateVersion' }
    };
  }

  if (typeof obj.commandSequence !== 'number' || !Number.isSafeInteger(obj.commandSequence) || obj.commandSequence < 1) {
    return {
      valid: false,
      error: { code: 'INVALID_PAYLOAD', message: 'Invalid commandSequence' }
    };
  }

  if (typeof obj.idempotencyKey !== 'string' || obj.idempotencyKey.length === 0 || obj.idempotencyKey.length > MAX_STRING_LEN) {
    return {
      valid: false,
      error: { code: 'INVALID_PAYLOAD', message: 'Invalid idempotencyKey' }
    };
  }

  switch (obj.type) {
    case 'READY':
      if (typeof obj.ready !== 'boolean') {
        return { valid: false, error: { code: 'INVALID_PAYLOAD', message: 'ready must be a boolean' } };
      }
      break;
    case 'SELECT_BOX':
    case 'OPEN_BOX':
      if (typeof obj.boxId !== 'number' || !Number.isSafeInteger(obj.boxId) || obj.boxId < 1 || obj.boxId > 26) {
        return { valid: false, error: { code: 'INVALID_BOX', message: 'boxId must be an integer between 1 and 26' } };
      }
      break;
    case 'SUBMIT_OFFER':
      if (typeof obj.amount !== 'number' || !Number.isSafeInteger(obj.amount) || obj.amount < 1) {
        return { valid: false, error: { code: 'INVALID_PAYLOAD', message: 'amount must be a positive integer' } };
      }
      break;
    case 'ACCEPT_OFFER':
    case 'REJECT_OFFER':
      if (typeof obj.offerId !== 'string' || obj.offerId.length === 0 || obj.offerId.length > MAX_STRING_LEN) {
        return { valid: false, error: { code: 'INVALID_PAYLOAD', message: 'Invalid offerId' } };
      }
      break;
    case 'SWAP_BOX':
      if (typeof obj.targetBoxId !== 'number' || !Number.isSafeInteger(obj.targetBoxId) || obj.targetBoxId < 1 || obj.targetBoxId > 26) {
        return { valid: false, error: { code: 'INVALID_BOX', message: 'targetBoxId must be an integer between 1 and 26' } };
      }
      break;
  }

  return { valid: true, command: obj as unknown as DuelCommand };
}
