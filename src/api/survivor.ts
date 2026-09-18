import type { SurvivorHistoryDetailResponse, SurvivorHistorySummaryItem } from '../../packages/protocol/src/survivor';
import { safeFetchJson } from './history';
import type { RoomThemeId } from '../../packages/protocol/src/theme';

export interface SurvivorHistoryListResponse {
  items: SurvivorHistorySummaryItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface SurvivorRoomSummary {
  roomId: string;
  players: number;
  maxPlayers: number;
  allowSpectators: boolean;
  themeId?: RoomThemeId;
  ruleVersion: string;
}

export interface SurvivorRoomListResponse { items: SurvivorRoomSummary[]; }

function isRoomSummary(value: unknown): value is SurvivorRoomSummary {
  if (!value || typeof value !== 'object') return false;
  const item = value as SurvivorRoomSummary;
  return typeof item.roomId === 'string' && Number.isInteger(item.players) && Number.isInteger(item.maxPlayers) &&
    typeof item.allowSpectators === 'boolean' &&
    (item.themeId === undefined || item.themeId === 'classic' || item.themeId === 'starry-neon') &&
    item.ruleVersion === 'survivor-26-v1';
}

export function isSurvivorRoomList(value: unknown): value is SurvivorRoomListResponse {
  return Boolean(value && typeof value === 'object' && Array.isArray((value as SurvivorRoomListResponse).items) &&
    (value as SurvivorRoomListResponse).items.every(isRoomSummary));
}

function isSummary(value: unknown): value is SurvivorHistorySummaryItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as SurvivorHistorySummaryItem;
  return typeof item.resultId === 'string' && typeof item.matchId === 'string' && Number.isFinite(item.completedAt) && Number.isInteger(item.mySeatId) && Number.isFinite(item.myScore) && Number.isInteger(item.myRank) && Number.isInteger(item.totalPlayers);
}

export function isSurvivorHistoryList(value: unknown): value is SurvivorHistoryListResponse {
  if (!value || typeof value !== 'object') return false;
  const data = value as SurvivorHistoryListResponse;
  return Array.isArray(data.items) && data.items.every(isSummary) && Number.isInteger(data.total) && Number.isInteger(data.limit) && Number.isInteger(data.offset);
}

export function isSurvivorHistoryDetail(value: unknown): value is SurvivorHistoryDetailResponse {
  if (!value || typeof value !== 'object') return false;
  const data = value as SurvivorHistoryDetailResponse;
  return typeof data.matchId === 'string' && typeof data.resultId === 'string' && data.ruleVersion === 'survivor-26-v1' && Array.isArray(data.seats) && Boolean(data.result) && Number.isInteger(data.mySeatId);
}

export const fetchSurvivorHistory = (limit = 10, offset = 0) => safeFetchJson<SurvivorHistoryListResponse>(
  `/api/survivor/history?limit=${limit}&offset=${offset}`,
  { credentials: 'include' },
  isSurvivorHistoryList
);

export const fetchSurvivorHistoryDetail = (matchId: string) => safeFetchJson<SurvivorHistoryDetailResponse>(
  `/api/survivor/history/${encodeURIComponent(matchId)}`,
  { credentials: 'include' },
  isSurvivorHistoryDetail
);

export const fetchSurvivorRooms = () => safeFetchJson<SurvivorRoomListResponse>(
  '/api/survivor/rooms',
  { credentials: 'omit' },
  isSurvivorRoomList
);
