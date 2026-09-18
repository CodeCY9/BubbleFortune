import type {
  TournamentHistoryDetailResponse,
  TournamentHistorySummaryItem
} from '../../packages/protocol/src/tournament';
import { safeFetchJson } from './history';
import type { RoomThemeId } from '../../packages/protocol/src/theme';

export interface TournamentRoomSummary {
  roomId: string;
  players: number;
  maxPlayers: number;
  allowSpectators: boolean;
  allowEmotes?: boolean;
  themeId?: RoomThemeId;
  ruleVersion: string;
}

export interface TournamentRoomListResponse { items: TournamentRoomSummary[]; }

function isRoomSummary(value: unknown): value is TournamentRoomSummary {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as TournamentRoomSummary;
  return typeof item.roomId === 'string' && item.roomId.length > 0
    && Number.isInteger(item.players) && item.players >= 0
    && Number.isInteger(item.maxPlayers) && [8, 16, 32].includes(item.maxPlayers)
    && typeof item.allowSpectators === 'boolean'
    && (item.allowEmotes === undefined || typeof item.allowEmotes === 'boolean')
    && (item.themeId === undefined || item.themeId === 'classic' || item.themeId === 'starry-neon')
    && item.ruleVersion === 'tournament-26-v1';
}

export function isTournamentRoomList(value: unknown): value is TournamentRoomListResponse {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && Array.isArray((value as TournamentRoomListResponse).items)
    && (value as TournamentRoomListResponse).items.every(isRoomSummary));
}

export const fetchTournamentRooms = (signal?: AbortSignal) => safeFetchJson<TournamentRoomListResponse>(
  '/api/tournament/rooms',
  { method: 'GET', credentials: 'omit', signal },
  isTournamentRoomList
);

export interface TournamentHistoryListResponse {
  items: TournamentHistorySummaryItem[];
  total: number;
  limit: number;
  offset: number;
}

function isSummary(value: unknown): value is TournamentHistorySummaryItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as TournamentHistorySummaryItem;
  return typeof item.resultId === 'string' && typeof item.tournamentId === 'string' && Number.isFinite(item.completedAt) && Number.isInteger(item.mySeatId) && Number.isInteger(item.myRank) && Number.isInteger(item.totalPlayers) && (item.winnerSeatId === null || Number.isInteger(item.winnerSeatId));
}

export function isTournamentHistoryList(value: unknown): value is TournamentHistoryListResponse {
  if (!value || typeof value !== 'object') return false;
  const data = value as TournamentHistoryListResponse;
  return Array.isArray(data.items) && data.items.every(isSummary) && Number.isInteger(data.total) && Number.isInteger(data.limit) && Number.isInteger(data.offset);
}

export function isTournamentHistoryDetail(value: unknown): value is TournamentHistoryDetailResponse {
  if (!value || typeof value !== 'object') return false;
  const data = value as TournamentHistoryDetailResponse;
  return typeof data.tournamentId === 'string' && typeof data.resultId === 'string' && data.ruleVersion === 'tournament-26-v1' && Array.isArray(data.seats) && Boolean(data.result) && Number.isInteger(data.mySeatId);
}

export const fetchTournamentHistory = (limit = 10, offset = 0) => safeFetchJson<TournamentHistoryListResponse>(
  `/api/tournament/history?limit=${limit}&offset=${offset}`,
  { credentials: 'include' },
  isTournamentHistoryList
);

export const fetchTournamentHistoryDetail = (tournamentId: string) => safeFetchJson<TournamentHistoryDetailResponse>(
  `/api/tournament/history/${encodeURIComponent(tournamentId)}`,
  { credentials: 'include' },
  isTournamentHistoryDetail
);

export interface TournamentReplaySummary {
  tournamentId: string;
  resultId: string;
  ruleVersion: string;
  completedAt: number;
  rankings: TournamentHistoryDetailResponse['result']['rankings'];
  matches: TournamentHistoryDetailResponse['result']['matches'];
  events: TournamentHistoryDetailResponse['result']['auditTrail'];
}

function isReplaySummary(value: unknown): value is TournamentReplaySummary {
  if (!value || typeof value !== 'object') return false;
  const data = value as TournamentReplaySummary;
  return typeof data.tournamentId === 'string' && typeof data.resultId === 'string' && data.ruleVersion === 'tournament-26-v1' && Number.isFinite(data.completedAt) && Array.isArray(data.rankings) && Array.isArray(data.matches) && Array.isArray(data.events);
}

export const fetchTournamentReplay = (tournamentId: string) => safeFetchJson<TournamentReplaySummary>(
  `/api/tournament/history/${encodeURIComponent(tournamentId)}/replay`,
  { credentials: 'include' },
  isReplaySummary
);
