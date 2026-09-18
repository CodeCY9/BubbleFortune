import type { AuditEvent, PublicError } from './types';
import type {
  DuelClientSnapshot,
  DuelCommand,
  DuelPublicSnapshot,
  DuelResult
} from './duel';
import type {
  SurvivorClientSnapshot,
  SurvivorCommand,
  SurvivorPublicSnapshot,
  SurvivorResult
} from './survivor';
import type { RoomThemeId } from './theme';

export const TOURNAMENT_RULE_VERSION = 'tournament-26-v1';
/** A tied child match advances through a deterministic server-side draw. */
export const TOURNAMENT_TIEBREAK_RULE = 'sha256-match-seat-v1';
export const TOURNAMENT_SIZES = [8, 16, 32] as const;
export type TournamentSize = (typeof TOURNAMENT_SIZES)[number];
export const TOURNAMENT_FORMATS = ['duel', 'survivor'] as const;
export type TournamentFormat = (typeof TOURNAMENT_FORMATS)[number];

export type TournamentPhase = 'WAITING' | 'BRACKET' | 'FINISHED';
export type TournamentMatchStatus = 'PENDING' | 'ACTIVE' | 'COMPLETED' | 'BYE';

export interface TournamentSeatInfo {
  seatId: number;
  occupied: boolean;
  nickname: string;
  connected: boolean;
  ready: boolean;
  eliminated: boolean;
  currentMatchId: string | null;
}

export interface TournamentMatchInfo {
  matchId: string;
  roundIndex: number;
  playerSeatIds: [number | null, number | null];
  status: TournamentMatchStatus;
  winnerSeatId: number | null;
  format: TournamentFormat;
  duel: DuelPublicSnapshot | null;
  survivor: SurvivorPublicSnapshot | null;
  /** True when the child result was tied and the tournament tiebreak selected the winner. */
  tieBreakUsed?: boolean;
}

export interface TournamentRoundInfo {
  roundIndex: number;
  matches: TournamentMatchInfo[];
}

export interface TournamentRankingEntry {
  seatId: number;
  nickname: string;
  rank: number;
  score: number;
  eliminatedRound: number | null;
  forfeited: boolean;
}

export interface TournamentResult {
  resultId: string;
  tournamentId: string;
  ruleVersion: string;
  format: TournamentFormat;
  winnerSeatId: number | null;
  rankings: TournamentRankingEntry[];
  matches: Array<{
    matchId: string;
    roundIndex: number;
    winnerSeatId: number | null;
    format: TournamentFormat;
    result: DuelResult | SurvivorResult | null;
    tieBreakUsed?: boolean;
  }>;
  auditTrail: AuditEvent[];
}

export interface TournamentPublicSnapshot {
  roomId: string;
  tournamentId: string;
  ruleVersion: string;
  isPrivate: boolean;
  ranked: boolean;
  /** Cosmetic room theme selected at creation; never affects gameplay. */
  themeId?: RoomThemeId;
  stateVersion: number;
  serverNow: number;
  phase: TournamentPhase;
  size: TournamentSize;
  format: TournamentFormat;
  /** Whether shortcut emotes are enabled for the tournament and survivor child matches. */
  allowEmotes: boolean;
  hostSeatId: number | null;
  seats: TournamentSeatInfo[];
  rounds: TournamentRoundInfo[];
  activeMatchId: string | null;
  result: TournamentResult | null;
}

export type TournamentActionType = 'READY' | 'START' | 'MATCH_COMMAND' | 'LEAVE';

export interface TournamentPrivateView {
  seatId: number | null;
  lastCommandSequence: number;
  allowedActions: TournamentActionType[];
  activeMatch: DuelClientSnapshot | SurvivorClientSnapshot | null;
}

export interface TournamentSpectatorView {
  public: TournamentPublicSnapshot;
}

export interface TournamentClientSnapshot {
  public: TournamentPublicSnapshot;
  private: TournamentPrivateView;
}

export interface TournamentCommandHeader {
  type: TournamentActionType;
  tournamentId: string;
  stateVersion: number;
  commandSequence: number;
  idempotencyKey: string;
}

export interface TournamentReadyCommand extends TournamentCommandHeader {
  type: 'READY';
  ready: boolean;
}

export interface TournamentStartCommand extends TournamentCommandHeader {
  type: 'START';
}

export interface TournamentMatchCommand extends TournamentCommandHeader {
  type: 'MATCH_COMMAND';
  matchId: string;
  duelCommand?: DuelCommand;
  survivorCommand?: SurvivorCommand;
}

export interface TournamentLeaveCommand extends TournamentCommandHeader {
  type: 'LEAVE';
}

export type TournamentCommand =
  | TournamentReadyCommand
  | TournamentStartCommand
  | TournamentMatchCommand
  | TournamentLeaveCommand;

export interface TournamentCommandResult {
  success: boolean;
  idempotencyKey?: string;
  stateVersion: number;
  snapshot?: TournamentClientSnapshot;
  duelResult?: unknown;
  survivorResult?: unknown;
  error?: PublicError;
}

export interface CompletedTournamentRecord {
  tournamentId: string;
  resultId: string;
  ruleVersion: string;
  completedAt: number;
  /** Password/private rooms are historical-only and must not affect ranked stats. */
  isPrivate?: boolean;
  ranked?: boolean;
  seats: Array<{ seatId: number; nickname: string; guestId?: string }>;
  result: TournamentResult;
}

export interface TournamentHistorySummaryItem {
  resultId: string;
  tournamentId: string;
  completedAt: number;
  ruleVersion: string;
  mySeatId: number;
  myRank: number;
  totalPlayers: number;
  winnerSeatId: number | null;
}

export interface TournamentHistoryDetailResponse extends CompletedTournamentRecord {
  mySeatId: number;
}

const MAX_PAYLOAD_BYTES = 8192;
const MAX_STRING_LEN = 128;
const ALLOWED_TYPES = new Set<TournamentActionType>(['READY', 'START', 'MATCH_COMMAND', 'LEAVE']);

export interface TournamentValidationResult {
  valid: boolean;
  command?: TournamentCommand;
  error?: PublicError;
}

export function validateTournamentCommand(raw: unknown): TournamentValidationResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { valid: false, error: { code: 'INVALID_PAYLOAD', message: 'Payload must be an object' } };
  }
  try {
    if (JSON.stringify(raw).length > MAX_PAYLOAD_BYTES) {
      return { valid: false, error: { code: 'INVALID_PAYLOAD', message: 'Payload exceeds size limit' } };
    }
  } catch {
    return { valid: false, error: { code: 'INVALID_PAYLOAD', message: 'Payload serialization failure' } };
  }

  const value = raw as Record<string, unknown>;
  if (typeof value.type !== 'string' || !ALLOWED_TYPES.has(value.type as TournamentActionType)) {
    return { valid: false, error: { code: 'INVALID_PAYLOAD', message: 'Unknown tournament command' } };
  }
  if (typeof value.tournamentId !== 'string' || value.tournamentId.length === 0 || value.tournamentId.length > MAX_STRING_LEN) {
    return { valid: false, error: { code: 'INVALID_PAYLOAD', message: 'Invalid tournament ID' } };
  }
  if (!Number.isInteger(value.stateVersion) || !Number.isInteger(value.commandSequence) || value.stateVersion < 1 || value.commandSequence < 1) {
    return { valid: false, error: { code: 'INVALID_PAYLOAD', message: 'Invalid command version or sequence' } };
  }
  if (typeof value.idempotencyKey !== 'string' || value.idempotencyKey.length === 0 || value.idempotencyKey.length > MAX_STRING_LEN) {
    return { valid: false, error: { code: 'INVALID_PAYLOAD', message: 'Invalid idempotency key' } };
  }

  if (value.type === 'READY') {
    if (typeof value.ready !== 'boolean') return { valid: false, error: { code: 'INVALID_PAYLOAD', message: 'READY requires a boolean' } };
  } else if (value.type === 'MATCH_COMMAND') {
    if (typeof value.matchId !== 'string' || value.matchId.length === 0 || value.matchId.length > MAX_STRING_LEN) {
      return { valid: false, error: { code: 'INVALID_PAYLOAD', message: 'Invalid match ID' } };
    }
    const duelCommand = value.duelCommand;
    const survivorCommand = value.survivorCommand;
    const hasDuel = Boolean(duelCommand && typeof duelCommand === 'object' && !Array.isArray(duelCommand));
    const hasSurvivor = Boolean(survivorCommand && typeof survivorCommand === 'object' && !Array.isArray(survivorCommand));
    if (hasDuel === hasSurvivor) {
      return { valid: false, error: { code: 'INVALID_PAYLOAD', message: 'MATCH_COMMAND requires exactly one child command' } };
    }
  }

  return { valid: true, command: value as TournamentCommand };
}
