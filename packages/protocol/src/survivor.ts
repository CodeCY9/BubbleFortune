import { AuditEvent, FairnessProof, PublicBox, PublicError } from './types';
import type { RoomThemeId } from './theme';

export const SURVIVOR_RULE_VERSION = 'survivor-26-v1';
export const SURVIVOR_MIN_PLAYERS = 2;
export const SURVIVOR_MAX_PLAYERS = 6;
export const SURVIVOR_MAX_SPECTATORS = 4;
export const SURVIVOR_ALLOWED_EMOJIS = new Set(['👍', '👏', '🎉', '🔥', '💰', '😮', '🤔', '😱', '💪', '🤝']);

export type SurvivorPhase = 'WAITING' | 'SELECTING_PERSONAL' | 'OPENING' | 'OFFERING' | 'FINISHED';

export interface SurvivorSeatInfo {
  seatId: number;
  occupied: boolean;
  nickname: string;
  connected: boolean;
  ready: boolean;
  personalBoxId: number | null;
  lockedScore: number;
  active: boolean;
  forfeited: boolean;
}

export interface SurvivorOffer {
  offerId: string;
  amount: number;
  expiresAt: number;
}

export interface SurvivorPublicSnapshot {
  roomId: string;
  matchId: string;
  ruleVersion: string;
  isPrivate: boolean;
  ranked: boolean;
  /** Cosmetic room theme selected at creation; never affects gameplay. */
  themeId?: RoomThemeId;
  stateVersion: number;
  serverNow: number;
  phase: SurvivorPhase;
  roundIndex: number;
  currentChooserSeatId: number | null;
  spectatorCount: number;
  allowEmotes: boolean;
  seats: SurvivorSeatInfo[];
  boxes: PublicBox[];
  openedBoxIds: number[];
  deadlineTimestamp: number | null;
  currentRevealedAmount: number | null;
  fairnessCommitment: string;
  lastEmote: { seatId: number; emoji: string; at: number } | null;
  result: SurvivorResult | null;
}

export interface SurvivorPrivateView {
  seatId: number | null;
  isSpectator?: boolean;
  lastCommandSequence: number;
  currentOffer: SurvivorOffer | null;
  allowedActions: SurvivorActionType[];
}

export interface SurvivorClientSnapshot {
  public: SurvivorPublicSnapshot;
  private: SurvivorPrivateView;
}

export type SurvivorActionType = 'READY' | 'START' | 'SELECT_BOX' | 'OPEN_BOX' | 'ACCEPT_OFFER' | 'REJECT_OFFER' | 'SEND_EMOTE' | 'LEAVE';

export interface SurvivorRoundResult {
  roundIndex: number;
  chooserSeatId: number;
  openedBoxId: number;
  openedAmount: number;
  acceptedOffers: Record<number, number>;
}

export interface SurvivorRanking {
  seatId: number;
  nickname: string;
  score: number;
  rank: number;
  forfeited: boolean;
}

export interface SurvivorResult {
  resultId: string;
  matchId: string;
  ruleVersion: string;
  rankings: SurvivorRanking[];
  rounds: SurvivorRoundResult[];
  auditTrail: AuditEvent[];
  fairnessProof: SurvivorFairnessProof;
}

export interface SurvivorFairnessProof extends FairnessProof {
  finalBoxes: Array<{ id: number; amount: number }>;
}

export interface SurvivorCommandHeader {
  type: SurvivorActionType;
  matchId: string;
  stateVersion: number;
  commandSequence: number;
  idempotencyKey: string;
  ready?: boolean;
  boxId?: number;
  offerId?: string;
  emoji?: string;
}

export type SurvivorCommand = SurvivorCommandHeader;

export interface SurvivorCommandResult {
  success: boolean;
  idempotencyKey?: string;
  stateVersion: number;
  snapshot?: SurvivorClientSnapshot;
  error?: PublicError;
}

export interface CompletedSurvivorRecord {
  matchId: string;
  resultId: string;
  ruleVersion: string;
  completedAt: number;
  /** Password/private rooms are historical-only and must not affect ranked stats. */
  isPrivate?: boolean;
  ranked?: boolean;
  seats: Array<{ seatId: number; nickname: string; guestId?: string }>;
  result: SurvivorResult;
}

export interface SurvivorHistorySummaryItem {
  resultId: string;
  matchId: string;
  completedAt: number;
  ruleVersion: string;
  mySeatId: number;
  myScore: number;
  myRank: number;
  totalPlayers: number;
  winnerSeatId: number | null;
}

export interface SurvivorHistoryDetailResponse extends CompletedSurvivorRecord {
  mySeatId: number;
}
