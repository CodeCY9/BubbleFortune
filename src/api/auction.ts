import type {
  AuctionHistoryListResponse,
  AuctionHistoryDetailResponse,
  AuctionHistorySummaryItem,
  AuctionShareSummary,
} from '../../packages/protocol/src/auction';
import type { RoomThemeId } from '../../packages/protocol/src/theme';
import {
  safeFetchJson,
  fetchGuestStatus,
  ensureGuestSession,
  type ApiResult,
} from './history';

const DEFAULT_TIMEOUT_MS = 6000;

export interface AuctionShareCreateResponse {
  shareId: string;
  path: string;
}

export interface AuctionRoomSummary {
  roomId: string;
  players: number;
  maxPlayers: number;
  allowSpectators: boolean;
  allowEmotes: boolean;
  showBidHistory: boolean;
  ranked: boolean;
  themeId?: RoomThemeId;
  ruleVersion: string;
}

export interface AuctionRoomListResponse {
  items: AuctionRoomSummary[];
}

function isAuctionRoomSummary(value: unknown): value is AuctionRoomSummary {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as AuctionRoomSummary;
  return typeof item.roomId === 'string' && item.roomId.length > 0
    && Number.isInteger(item.players) && item.players >= 0
    && Number.isInteger(item.maxPlayers) && item.maxPlayers === 8
    && typeof item.allowSpectators === 'boolean'
    && typeof item.allowEmotes === 'boolean'
    && typeof item.showBidHistory === 'boolean'
    && typeof item.ranked === 'boolean'
    && (item.themeId === undefined || item.themeId === 'classic' || item.themeId === 'starry-neon')
    && item.ruleVersion === 'auction-26-v1';
}

export function isAuctionRoomListResponse(value: unknown): value is AuctionRoomListResponse {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && Array.isArray((value as AuctionRoomListResponse).items)
    && (value as AuctionRoomListResponse).items.every(isAuctionRoomSummary));
}

export function parseAuctionSharePath(path: string): string | null {
  return /^\/share\/auction\/([A-Za-z0-9_-]{16,128})\/?$/.exec(path)?.[1] ?? null;
}

export function isAuctionHistorySummaryItem(item: unknown): item is AuctionHistorySummaryItem {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
  const it = item as Record<string, unknown>;
  return (
    typeof it.resultId === 'string' &&
    it.resultId.trim().length > 0 &&
    typeof it.matchId === 'string' &&
    it.matchId.trim().length > 0 &&
    typeof it.completedAt === 'number' &&
    Number.isFinite(it.completedAt) &&
    it.completedAt > 0 &&
    typeof it.ruleVersion === 'string' &&
    typeof it.mySeatId === 'number' &&
    typeof it.myScore === 'number' &&
    Number.isFinite(it.myScore) &&
    typeof it.myRank === 'number' &&
    typeof it.totalPlayers === 'number' &&
    typeof it.myNickname === 'string' &&
    (it.winnerSeatId === null || typeof it.winnerSeatId === 'number') &&
    (it.winnerNickname === null || typeof it.winnerNickname === 'string') &&
    typeof it.reason === 'string'
  );
}

export function isAuctionHistoryListResponse(data: unknown): data is AuctionHistoryListResponse {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const d = data as Record<string, unknown>;
  if (
    !Array.isArray(d.items) ||
    typeof d.total !== 'number' ||
    !Number.isInteger(d.total) ||
    d.total < 0 ||
    typeof d.limit !== 'number' ||
    !Number.isInteger(d.limit) ||
    d.limit < 1 ||
    typeof d.offset !== 'number' ||
    !Number.isInteger(d.offset) ||
    d.offset < 0
  ) {
    return false;
  }

  return d.items.every(isAuctionHistorySummaryItem);
}

export function isAuctionHistoryDetailResponse(data: unknown): data is AuctionHistoryDetailResponse {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const d = data as Record<string, unknown>;
  if (
    typeof d.matchId !== 'string' ||
    d.matchId.trim().length === 0 ||
    typeof d.resultId !== 'string' ||
    d.resultId.trim().length === 0 ||
    typeof d.ruleVersion !== 'string' ||
    typeof d.completedAt !== 'number' ||
    !Number.isFinite(d.completedAt) ||
    !Array.isArray(d.seats) ||
    typeof d.mySeatId !== 'number' ||
    !d.result ||
    typeof d.result !== 'object' ||
    Array.isArray(d.result)
  ) {
    return false;
  }

  const res = d.result as Record<string, unknown>;
  if (
    typeof res.resultId !== 'string' ||
    typeof res.matchId !== 'string' ||
    typeof res.ruleVersion !== 'string' ||
    (res.winnerSeatId !== null && typeof res.winnerSeatId !== 'number') ||
    typeof res.reason !== 'string' ||
    !Array.isArray(res.rankings) ||
    !res.finalScores ||
    typeof res.finalScores !== 'object' ||
    !Array.isArray(res.rounds) ||
    !Array.isArray(res.fairnessProofs)
  ) {
    return false;
  }

  return true;
}

export function isAuctionShareCreateResponse(data: unknown): data is AuctionShareCreateResponse {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const d = data as Record<string, unknown>;
  return typeof d.shareId === 'string' && typeof d.path === 'string';
}

export function isAuctionShareSummary(data: unknown): data is AuctionShareSummary {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const d = data as Record<string, unknown>;
  return (
    typeof d.resultId === 'string' &&
    typeof d.mode === 'string' &&
    typeof d.completedAt === 'number' &&
    typeof d.totalPlayers === 'number' &&
    Array.isArray(d.rankings) &&
    (d.winnerNickname === null || typeof d.winnerNickname === 'string') &&
    typeof d.reason === 'string'
  );
}

/**
 * Ensure guest authentication exists for auction mode.
 * Spectators do not require guest authentication, but players do.
 */
export async function ensureAuctionGuestSession(timeoutMs = DEFAULT_TIMEOUT_MS): Promise<void> {
  const status = await fetchGuestStatus(timeoutMs);
  if (!status.ok || !status.data) {
    throw new Error(status.error?.message || '无法获取游客身份状态');
  }
  if (!status.data.enabled || !status.data.available) {
    throw new Error('竞拍战绩服务暂时不可用，请稍后重试');
  }
  if (status.data.authenticated) {
    return;
  }

  const created = await ensureGuestSession(timeoutMs);
  if (!created.ok || !created.data?.enabled || !created.data.available || !created.data.authenticated) {
    throw new Error(created.error?.message || '创建竞拍游客身份失败，请刷新重试');
  }
}

export async function fetchAuctionRooms(signal?: AbortSignal): Promise<AuctionRoomSummary[]> {
  const result = await safeFetchJson<AuctionRoomListResponse>(
    '/api/auction/rooms',
    { method: 'GET', credentials: 'omit', signal },
    isAuctionRoomListResponse
  );
  if (!result.ok || !result.data) throw new Error(result.error?.message || '无法读取公开竞拍房间');
  return result.data.items;
}

/**
 * Fetch paginated auction history list for current guest.
 */
export async function fetchAuctionHistoryList(options?: {
  limit?: number;
  offset?: number;
  timeoutMs?: number;
}): Promise<ApiResult<AuctionHistoryListResponse>> {
  const limit = options?.limit ?? 10;
  const offset = options?.offset ?? 0;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const url = `/api/auction/history?limit=${encodeURIComponent(limit)}&offset=${encodeURIComponent(offset)}`;
  return safeFetchJson<AuctionHistoryListResponse>(
    url,
    { method: 'GET', timeoutMs },
    isAuctionHistoryListResponse
  );
}

/**
 * Fetch completed auction record detail by matchId.
 */
export async function fetchAuctionHistoryDetail(
  matchId: string,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<ApiResult<AuctionHistoryDetailResponse>> {
  if (!matchId || typeof matchId !== 'string' || matchId.trim().length === 0) {
    return { ok: false, error: { code: 'INVALID_ID', message: '无效的对局标识' } };
  }
  const url = `/api/auction/history/${encodeURIComponent(matchId)}`;
  return safeFetchJson<AuctionHistoryDetailResponse>(
    url,
    { method: 'GET', timeoutMs, custom404Message: '竞拍对局记录不存在或尚在归档中' },
    isAuctionHistoryDetailResponse
  );
}

/**
 * Create or retrieve public share ID for an auction match.
 * The server accepts the matchId route as the canonical public contract.
 */
export async function createAuctionShare(
  matchId: string,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<ApiResult<AuctionShareCreateResponse>> {
  if (!matchId || typeof matchId !== 'string' || matchId.trim().length === 0) {
    return { ok: false, error: { code: 'INVALID_ID', message: '无效的对局标识' } };
  }
  const url = `/api/auction/history/${encodeURIComponent(matchId)}/share`;
  return safeFetchJson<AuctionShareCreateResponse>(
    url,
    { method: 'POST', timeoutMs, body: {} },
    isAuctionShareCreateResponse
  );
}

/**
 * Fetch public shared auction result by shareId.
 */
export async function fetchPublicAuctionShare(
  shareId: string,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<ApiResult<AuctionShareSummary>> {
  if (!shareId || typeof shareId !== 'string' || shareId.trim().length === 0) {
    return { ok: false, error: { code: 'INVALID_ID', message: '无效的分享标识' } };
  }
  const url = `/api/share/auction/${encodeURIComponent(shareId)}`;
  return safeFetchJson<AuctionShareSummary>(
    url,
    { method: 'GET', timeoutMs, custom404Message: '竞拍分享记录不存在' },
    isAuctionShareSummary
  );
}
