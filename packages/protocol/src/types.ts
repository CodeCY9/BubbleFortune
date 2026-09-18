/**
 * Public protocol types for Classic 26 Box game.
 * Whitelist data only. No secret state or EV calculation logic here.
 */

export type GamePhase =
  | 'SELECTING'    // Player selecting lucky box
  | 'OPENING'      // Opening boxes in current round
  | 'OFFERING'     // Banker has made an offer, waiting for accept or reject
  | 'FINAL_SWAP'   // 2 unopened boxes remain (player box + 1 other); keep or swap
  | 'FINISHED';    // Game concluded

export type BoxStatus = 'unopened' | 'selected' | 'opened';

// Whitelist box definition: unopened/selected boxes have NO value or amount fields at all!
export type PublicBox =
  | { id: number; status: 'unopened' }
  | { id: number; status: 'selected' }
  | { id: number; status: 'opened'; revealedAmount: number };

export type AiType = 'conservative' | 'aggressive' | 'cold' | 'inducement' | 'crazy';

export type ChallengeCommandType = 'USE_INQUIRY' | 'BUY_INSURANCE' | 'DECLINE_RAISE';

export interface FairnessPublicInfo {
  supported: boolean;
  algorithm?: string;
  commitment?: string;
}

export interface FairnessProof {
  algorithm: string;
  gameId: string;
  ruleVersion: string;
  seed: string;
  salt: string;
  amounts: number[];
  roundTargets: number[];
  commitment: string;
}

export interface PublicOffer {
  offerId: string;
  amount: number;
  expiresAt: number; // Unix epoch ms
  dialogue?: string;
}

export type OfferOutcome = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED';

export interface PublicOfferHistoryEntry {
  offerId: string;
  round: number;
  amount: number;
  expiresAt: number;
  outcome: OfferOutcome;
  dialogue?: string;
}

export interface AuditEvent {
  seq: number;
  timestamp: number;
  type: string;
  payload: Record<string, unknown>;
  previousHash: string;
  hash: string;
}

export type OutcomeType = 'OFFER_ACCEPTED' | 'FINAL_KEEP' | 'FINAL_SWAP';

export interface PublicSettlement {
  resultId: string;
  wonAmount: number;
  outcomeType: OutcomeType;
  originalPlayerBoxId: number;
  finalPlayerBoxId: number;
  acceptedOfferAmount?: number;
  finalBoxAmount?: number;
  allBoxes?: Array<{ id: number; amount: number }>;
  fairnessProof?: FairnessProof | null;
  auditTrail?: AuditEvent[];
  originalBoxAmount?: number;
  highestOfferAmount?: number;
  preInsuranceWonAmount?: number;
  insurancePremium?: number;
  insuranceFloor?: number;
}

export interface CompletedGameRecord {
  gameId: string;
  ruleVersion: string;
  aiType: AiType;
  aiStrategyVersion: string;
  settlement: PublicSettlement;
  offerHistory: PublicOfferHistoryEntry[];
  auditTrail: AuditEvent[];
  completedAt: number;
}

export interface PublicSnapshot {
  gameId: string;
  ruleVersion: string;
  phase: GamePhase;
  stateVersion: number;
  lastCommandSequence: number;
  serverNow: number;
  originalPlayerBoxId: number | null;
  currentPlayerBoxId: number | null;
  currentRound: number;
  boxesToOpenThisRound: number;
  totalOpenedBoxes: number;
  unopenedCount: number;
  boxes: PublicBox[];
  currentOffer: PublicOffer | null;
  deadlineTimestamp: number | null;
  settlement: PublicSettlement | null;
  aiType?: AiType;
  offerHistory?: PublicOfferHistoryEntry[];
  fairness?: FairnessPublicInfo;
  challenge?: {
    noDealRounds: number;
    finalSwapDisabled: boolean;
    inquiryAvailable: boolean;
    inquiryUsed: boolean;
    poolId?: string;
    timedOpeningSeconds?: number;
    insuranceAvailable?: boolean;
    insurancePurchased?: boolean;
    insurancePremium?: number;
    insuranceFloor?: number;
    raiseDeclineAvailable?: boolean;
    raiseDeclined?: boolean;
  };
}

export type PublicGameEvent =
  | { type: 'BOX_SELECTED'; boxId: number; stateVersion: number }
  | { type: 'BOX_OPENED'; boxId: number; revealedAmount: number; stateVersion: number }
  | { type: 'OFFER_MADE'; offerId: string; amount: number; expiresAt: number; stateVersion: number }
  | { type: 'OFFER_ACCEPTED'; offerId: string; amount: number; stateVersion: number }
  | { type: 'OFFER_REJECTED'; offerId: string; nextRound: number; stateVersion: number }
  | { type: 'FINAL_KEEP'; boxId: number; amount: number; stateVersion: number }
  | { type: 'FINAL_SWAP'; originalBoxId: number; newBoxId: number; amount: number; stateVersion: number }
  | { type: 'GAME_SETTLED'; settlement: PublicSettlement; stateVersion: number }
  | { type: 'INQUIRY_USED'; stateVersion: number }
  | { type: 'INSURANCE_PURCHASED'; stateVersion: number }
  | { type: 'RAISE_DECLINED'; stateVersion: number }
  | { type: 'AUTO_ACTION_TIMEOUT'; reason: string; stateVersion: number };

// Base fields required for every state-mutating command
export interface CommandHeader {
  gameId: string;
  stateVersion: number;
  commandSequence: number;
  idempotencyKey: string;
}

export interface SelectBoxCommand extends CommandHeader {
  type: 'SELECT_BOX';
  boxId: number;
}

export interface OpenBoxCommand extends CommandHeader {
  type: 'OPEN_BOX';
  boxId: number;
}

export interface AcceptOfferCommand extends CommandHeader {
  type: 'ACCEPT_OFFER';
  offerId: string;
}

export interface RejectOfferCommand extends CommandHeader {
  type: 'REJECT_OFFER';
  offerId: string;
}

export interface KeepBoxCommand extends CommandHeader {
  type: 'KEEP_BOX';
}

export interface SwapBoxCommand extends CommandHeader {
  type: 'SWAP_BOX';
  targetBoxId: number;
}

export interface UseInquiryCommand extends CommandHeader {
  type: 'USE_INQUIRY';
}

export interface BuyInsuranceCommand extends CommandHeader {
  type: 'BUY_INSURANCE';
}

export interface DeclineRaiseCommand extends CommandHeader {
  type: 'DECLINE_RAISE';
}

export interface RequestSnapshotCommand {
  type: 'REQUEST_SNAPSHOT';
}

export type ClientCommand =
  | SelectBoxCommand
  | OpenBoxCommand
  | AcceptOfferCommand
  | RejectOfferCommand
  | KeepBoxCommand
  | SwapBoxCommand
  | UseInquiryCommand
  | BuyInsuranceCommand
  | DeclineRaiseCommand
  | RequestSnapshotCommand;

export type ErrorCode =
  | 'INVALID_PAYLOAD'
  | 'IDEMPOTENCY_CONFLICT'
  | 'STALE_VERSION'
  | 'OUT_OF_SEQUENCE'
  | 'INVALID_PHASE'
  | 'INVALID_BOX'
  | 'OFFER_EXPIRED'
  | 'RATE_LIMITED'
  | 'UNAUTHORIZED'
  | 'ROOM_FULL'
  | 'INTERNAL_ERROR';

export interface PublicError {
  code: ErrorCode;
  message: string;
}

export interface CommandResult {
  success: boolean;
  idempotencyKey?: string;
  stateVersion: number;
  snapshot?: PublicSnapshot;
  event?: PublicGameEvent;
  error?: PublicError;
}

export interface GuestAuthStatus {
  enabled: boolean;
  available: boolean;
  authenticated: boolean;
}

export interface HistorySummaryItem {
  resultId: string;
  gameId: string;
  completedAt: number;
  ruleVersion: string;
  aiType: AiType;
  wonAmount: number;
  outcomeType: OutcomeType;
  originalPlayerBoxId: number;
  finalPlayerBoxId: number;
  acceptedOfferAmount?: number;
}

export interface HistoryListResponse {
  items: HistorySummaryItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface ShareResponse {
  shareId: string;
  path: string;
}

export interface PublicShareSummary {
  mode: string;
  aiType: AiType;
  wonAmount: number;
  originalPlayerBoxId: number;
  finalPlayerBoxId: number;
  outcomeType: OutcomeType;
  acceptedOfferAmount?: number;
}
