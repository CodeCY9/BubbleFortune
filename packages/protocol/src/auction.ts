import { AuditEvent, PublicBox, PublicError } from './types';
import type { RoomThemeId } from './theme';

export const AUCTION_RULE_VERSION = 'auction-26-v1';
export const AUCTION_INITIAL_CAPITAL = 1000000;
export const AUCTION_MIN_PLAYERS = 3;
export const AUCTION_MAX_PLAYERS = 8;
export const AUCTION_MAX_SPECTATORS = 4;

export type AuctionRole = 'CHALLENGER' | 'CAPITALIST';

export type AuctionPhase =
  | 'WAITING'
  | 'SELECTING'
  | 'OPENING'
  | 'BIDDING'
  | 'OFFERING'
  | 'FINAL_SWAP'
  | 'ROUND_COMPLETE'
  | 'FINISHED';

export interface AuctionSeatInfo {
  seatId: number;
  occupied: boolean;
  nickname: string;
  connected: boolean;
  ready: boolean;
  continueReady: boolean;
  role: AuctionRole | null;
  score: number;
  forfeited: boolean;
}

export type AuctionActionType =
  | 'READY'
  | 'START'
  | 'SELECT_BOX'
  | 'OPEN_BOX'
  | 'SUBMIT_BID'
  | 'ACCEPT_AUCTION'
  | 'ACCEPT_OFFER'
  | 'REJECT_AUCTION'
  | 'REJECT_OFFER'
  | 'KEEP_BOX'
  | 'SWAP_BOX'
  | 'CONTINUE_ROUND'
  | 'LEAVE'
  | 'SEND_EMOTE'
  | 'SEND_REACTION';

export interface AuctionPrivateView {
  seatId: number | null;
  isSpectator: boolean;
  myCapital?: number;
  myBid?: number | null;
  lastCommandSequence: number;
  allowedActions: AuctionActionType[];
}

export interface AuctionCurrentOffer {
  offerId: string;
  amount: number;
  deadlineTimestamp: number | null;
}

export interface AuctionRoundResult {
  roundIndex: number;
  challengerSeatId: number;
  outcomeType: 'OFFER_ACCEPTED' | 'FINAL_KEEP' | 'FINAL_SWAP' | 'FORFEIT';
  originalPlayerBoxId: number;
  finalPlayerBoxId: number;
  originalPlayerBoxAmount: number;
  finalPlayerBoxAmount?: number;
  acceptedOfferAmount?: number;
  winningCapitalistSeatId?: number | null;
  winningBidAmount?: number;
  challengerProfit: number;
  capitalistProfits: Record<number, number>;
  capitalDeductions: Record<number, number>;
}

export interface AuctionFairnessProof {
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

export interface AuctionRanking {
  seatId: number;
  nickname: string;
  score: number;
  remainingCapital: number;
  rank: number;
  forfeited: boolean;
}

export interface AuctionResult {
  resultId: string;
  matchId: string;
  ruleVersion: string;
  winnerSeatId: number | null;
  reason: 'NORMAL' | 'FORFEIT_ALL' | 'SURVIVOR_WIN' | 'TIMEOUT_DISCONNECT';
  rankings: AuctionRanking[];
  finalScores: Record<number, number>;
  forfeitedSeatIds: number[];
  rounds: AuctionRoundResult[];
  fairnessProofs: AuctionFairnessProof[];
  auditTrail: AuditEvent[];
}

export interface AuctionReactionEvent {
  senderNickname: string;
  isSpectator: boolean;
  emoji: string;
  timestamp: number;
}

export interface AuctionRoomConfig {
  isPrivate?: boolean;
  ranked?: boolean;
  allowSpectators?: boolean;
  allowEmotes?: boolean;
  showBidHistory?: boolean;
  /** Cosmetic theme selected when the room is created. */
  themeId?: RoomThemeId;
  /** Password is accepted only when creating or joining a private room; never echoed in snapshots. */
  password?: string;
}

export interface AuctionPublicSnapshot {
  roomId: string;
  matchId: string;
  ruleVersion: string;
  isPrivate: boolean;
  ranked: boolean;
  /** Cosmetic room theme selected at creation; never affects gameplay. */
  themeId?: RoomThemeId;
  allowSpectators: boolean;
  allowEmotes: boolean;
  showBidHistory: boolean;
  stateVersion: number;
  serverNow: number;
  phase: AuctionPhase;
  roundIndex: number;
  totalRounds: number;
  boxRound: number;
  boxesLeftToOpenThisRound: number;
  seats: AuctionSeatInfo[];
  spectatorCount: number;
  hostSeatId: number | null;
  challengerSeatId: number | null;
  deadlineTimestamp: number | null;
  boxes: PublicBox[];
  openedBoxIds: number[];
  playerBoxId: number | null;
  bidsSubmittedSeats: number[];
  currentOffer: AuctionCurrentOffer | null;
  roundResults: AuctionRoundResult[];
  fairnessCommitments: Record<number, string>;
  result: AuctionResult | null;
  lastReaction?: AuctionReactionEvent | null;
}

export interface AuctionClientSnapshot {
  public: AuctionPublicSnapshot;
  private: AuctionPrivateView;
}

export interface AuctionCommandHeader {
  stateVersion: number;
  commandSequence: number;
  idempotencyKey: string;
  matchId?: string;
  roomId?: string;
}

export interface AuctionReadyCommand extends AuctionCommandHeader {
  type: 'READY';
  ready: boolean;
}

export interface AuctionStartCommand extends AuctionCommandHeader {
  type: 'START';
}

export interface AuctionSelectBoxCommand extends AuctionCommandHeader {
  type: 'SELECT_BOX';
  boxId: number;
}

export interface AuctionOpenBoxCommand extends AuctionCommandHeader {
  type: 'OPEN_BOX';
  boxId: number;
}

export interface AuctionSubmitBidCommand extends AuctionCommandHeader {
  type: 'SUBMIT_BID';
  amount: number;
}

export interface AuctionAcceptAuctionCommand extends AuctionCommandHeader {
  type: 'ACCEPT_AUCTION';
  offerId: string;
}

export interface AuctionAcceptOfferCommand extends AuctionCommandHeader {
  type: 'ACCEPT_OFFER';
  offerId: string;
}

export interface AuctionRejectAuctionCommand extends AuctionCommandHeader {
  type: 'REJECT_AUCTION';
  offerId: string;
}

export interface AuctionRejectOfferCommand extends AuctionCommandHeader {
  type: 'REJECT_OFFER';
  offerId: string;
}

export interface AuctionKeepBoxCommand extends AuctionCommandHeader {
  type: 'KEEP_BOX';
}

export interface AuctionSwapBoxCommand extends AuctionCommandHeader {
  type: 'SWAP_BOX';
  targetBoxId: number;
}

export interface AuctionContinueRoundCommand extends AuctionCommandHeader {
  type: 'CONTINUE_ROUND';
}

export interface AuctionLeaveCommand extends AuctionCommandHeader {
  type: 'LEAVE';
}

export interface AuctionSendEmoteCommand extends AuctionCommandHeader {
  type: 'SEND_EMOTE';
  emoji: string;
}

export interface AuctionSendReactionCommand extends AuctionCommandHeader {
  type: 'SEND_REACTION';
  emoji: string;
}

export type AuctionCommand =
  | AuctionReadyCommand
  | AuctionStartCommand
  | AuctionSelectBoxCommand
  | AuctionOpenBoxCommand
  | AuctionSubmitBidCommand
  | AuctionAcceptAuctionCommand
  | AuctionAcceptOfferCommand
  | AuctionRejectAuctionCommand
  | AuctionRejectOfferCommand
  | AuctionKeepBoxCommand
  | AuctionSwapBoxCommand
  | AuctionContinueRoundCommand
  | AuctionLeaveCommand
  | AuctionSendEmoteCommand
  | AuctionSendReactionCommand;

export interface AuctionCommandResult {
  success: boolean;
  idempotencyKey?: string;
  stateVersion: number;
  snapshot?: AuctionClientSnapshot;
  error?: PublicError;
}

export interface CompletedAuctionRecord {
  matchId: string;
  resultId: string;
  ruleVersion: string;
  completedAt: number;
  isPrivate: boolean;
  ranked: boolean;
  allowSpectators: boolean;
  seats: Array<{ seatId: number; nickname: string; guestId?: string }>;
  result: AuctionResult;
}

export interface AuctionHistorySummaryItem {
  resultId: string;
  matchId: string;
  completedAt: number;
  ruleVersion: string;
  mySeatId: number;
  myScore: number;
  myRank: number;
  totalPlayers: number;
  myNickname: string;
  winnerSeatId: number | null;
  winnerNickname: string | null;
  reason: string;
}

export interface AuctionHistoryListResponse {
  items: AuctionHistorySummaryItem[];
  total: number;
  limit: number;
  offset: number;
}

export type AuctionHistoryDetailResponse = CompletedAuctionRecord & {
  mySeatId: number;
};

export interface AuctionShareSummary {
  mode: string;
  resultId: string;
  completedAt: number;
  totalPlayers: number;
  rankings: Array<{
    rank: number;
    nickname: string;
    score: number;
    remainingCapital: number;
  }>;
  winnerNickname: string | null;
  reason: string;
}

export const AUCTION_TIMEOUT_SECONDS = {
  SELECT_PLAYER_BOX: 30,
  OPEN_BOX: 20,
  BIDDING: 20,
  CHALLENGER_DECISION: 30,
  FINAL_CHOICE: 30,
  ROUND_INTERMISSION: 30,
  RECONNECT_GRACE: 120
} as const;

export const AUCTION_ALLOWED_EMOJIS = new Set([
  '👍',
  '👎',
  '👏',
  '🎉',
  '🔥',
  '💰',
  '😮',
  '🤔',
  '😱',
  '💪',
  '🤝',
  '😎'
]);

const MAX_PAYLOAD_BYTES = 2048;
const MAX_STRING_LEN = 128;

const ALLOWED_AUCTION_COMMAND_TYPES = new Set([
  'READY',
  'START',
  'SELECT_BOX',
  'OPEN_BOX',
  'SUBMIT_BID',
  'ACCEPT_AUCTION',
  'ACCEPT_OFFER',
  'REJECT_AUCTION',
  'REJECT_OFFER',
  'KEEP_BOX',
  'SWAP_BOX',
  'CONTINUE_ROUND',
  'LEAVE',
  'SEND_EMOTE',
  'SEND_REACTION'
]);

const ALLOWED_KEYS_BY_AUCTION_TYPE: Record<string, Set<string>> = {
  READY: new Set(['type', 'stateVersion', 'commandSequence', 'idempotencyKey', 'ready', 'matchId', 'roomId']),
  START: new Set(['type', 'stateVersion', 'commandSequence', 'idempotencyKey', 'matchId', 'roomId']),
  SELECT_BOX: new Set(['type', 'stateVersion', 'commandSequence', 'idempotencyKey', 'boxId', 'matchId', 'roomId']),
  OPEN_BOX: new Set(['type', 'stateVersion', 'commandSequence', 'idempotencyKey', 'boxId', 'matchId', 'roomId']),
  SUBMIT_BID: new Set(['type', 'stateVersion', 'commandSequence', 'idempotencyKey', 'amount', 'matchId', 'roomId']),
  ACCEPT_AUCTION: new Set(['type', 'stateVersion', 'commandSequence', 'idempotencyKey', 'offerId', 'matchId', 'roomId']),
  ACCEPT_OFFER: new Set(['type', 'stateVersion', 'commandSequence', 'idempotencyKey', 'offerId', 'matchId', 'roomId']),
  REJECT_AUCTION: new Set(['type', 'stateVersion', 'commandSequence', 'idempotencyKey', 'offerId', 'matchId', 'roomId']),
  REJECT_OFFER: new Set(['type', 'stateVersion', 'commandSequence', 'idempotencyKey', 'offerId', 'matchId', 'roomId']),
  KEEP_BOX: new Set(['type', 'stateVersion', 'commandSequence', 'idempotencyKey', 'matchId', 'roomId']),
  SWAP_BOX: new Set(['type', 'stateVersion', 'commandSequence', 'idempotencyKey', 'targetBoxId', 'matchId', 'roomId']),
  CONTINUE_ROUND: new Set(['type', 'stateVersion', 'commandSequence', 'idempotencyKey', 'matchId', 'roomId']),
  LEAVE: new Set(['type', 'stateVersion', 'commandSequence', 'idempotencyKey', 'matchId', 'roomId']),
  SEND_EMOTE: new Set(['type', 'stateVersion', 'commandSequence', 'idempotencyKey', 'emoji', 'matchId', 'roomId']),
  SEND_REACTION: new Set(['type', 'stateVersion', 'commandSequence', 'idempotencyKey', 'emoji', 'matchId', 'roomId'])
};

export interface AuctionValidationResult {
  valid: boolean;
  command?: AuctionCommand;
  error?: PublicError;
}

export function validateAuctionCommand(raw: unknown): AuctionValidationResult {
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

  if (typeof obj.type !== 'string' || !ALLOWED_AUCTION_COMMAND_TYPES.has(obj.type)) {
    return {
      valid: false,
      error: { code: 'INVALID_PAYLOAD', message: 'Missing or unknown command type' }
    };
  }

  const allowedKeys = ALLOWED_KEYS_BY_AUCTION_TYPE[obj.type];
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

  if (obj.matchId !== undefined) {
    if (typeof obj.matchId !== 'string' || obj.matchId.trim().length === 0 || obj.matchId.length > MAX_STRING_LEN) {
      return {
        valid: false,
        error: { code: 'INVALID_PAYLOAD', message: 'Invalid matchId' }
      };
    }
  }

  if (obj.roomId !== undefined) {
    if (typeof obj.roomId !== 'string' || obj.roomId.trim().length === 0 || obj.roomId.length > MAX_STRING_LEN) {
      return {
        valid: false,
        error: { code: 'INVALID_PAYLOAD', message: 'Invalid roomId' }
      };
    }
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
    case 'SUBMIT_BID':
      if (typeof obj.amount !== 'number' || !Number.isSafeInteger(obj.amount) || obj.amount < 1 || obj.amount > AUCTION_INITIAL_CAPITAL) {
        return { valid: false, error: { code: 'INVALID_PAYLOAD', message: `amount must be an integer between 1 and ${AUCTION_INITIAL_CAPITAL}` } };
      }
      break;
    case 'ACCEPT_AUCTION':
    case 'ACCEPT_OFFER':
    case 'REJECT_AUCTION':
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
    case 'SEND_EMOTE':
    case 'SEND_REACTION':
      if (typeof obj.emoji !== 'string' || !AUCTION_ALLOWED_EMOJIS.has(obj.emoji)) {
        return { valid: false, error: { code: 'INVALID_PAYLOAD', message: 'Emoji is not supported' } };
      }
      break;
  }

  return { valid: true, command: obj as unknown as AuctionCommand };
}
