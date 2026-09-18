import type {
  DuelHistoryListResponse,
  DuelHistoryDetailResponse,
  DuelHistorySummaryItem,
  DuelSeatId,
} from '../../packages/protocol/src/duel';
import {
  safeFetchJson,
  fetchGuestStatus,
  ensureGuestSession,
  type ApiResult,
} from './history';

const DEFAULT_TIMEOUT_MS = 6000;

export function isDuelHistorySummaryItem(item: unknown): item is DuelHistorySummaryItem {
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
    (it.mySeatId === 0 || it.mySeatId === 1) &&
    typeof it.myScore === 'number' &&
    Number.isFinite(it.myScore) &&
    typeof it.opponentScore === 'number' &&
    Number.isFinite(it.opponentScore) &&
    typeof it.myNickname === 'string' &&
    typeof it.opponentNickname === 'string' &&
    (it.winnerSeatId === 0 || it.winnerSeatId === 1 || it.winnerSeatId === null) &&
    (it.outcome === 'WIN' || it.outcome === 'LOSE' || it.outcome === 'DRAW' || it.outcome === 'VOID') &&
    typeof it.reason === 'string'
  );
}

export function isDuelHistoryListResponse(data: unknown): data is DuelHistoryListResponse {
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

  return d.items.every(isDuelHistorySummaryItem);
}

export function isDuelHistoryDetailResponse(data: unknown): data is DuelHistoryDetailResponse {
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
    (d.mySeatId !== 0 && d.mySeatId !== 1) ||
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
    (res.winnerSeatId !== 0 && res.winnerSeatId !== 1 && res.winnerSeatId !== null) ||
    typeof res.reason !== 'string' ||
    !res.finalScores ||
    typeof res.finalScores !== 'object' ||
    !Array.isArray(res.rounds) ||
    !Array.isArray(res.fairnessProofs) ||
    !Array.isArray(res.auditTrail)
  ) {
    return false;
  }

  return true;
}

/**
 * Ensure guest authentication exists for duel mode.
 * Throws if the service is disabled, unavailable, or authentication fails.
 */
export async function ensureDuelGuestSession(timeoutMs = DEFAULT_TIMEOUT_MS): Promise<void> {
  const status = await fetchGuestStatus(timeoutMs);
  if (!status.ok || !status.data) {
    throw new Error(status.error?.message || '无法获取游客身份状态');
  }
  if (!status.data.enabled || !status.data.available) {
    throw new Error('对决战绩服务暂时不可用，请稍后重试');
  }
  if (status.data.authenticated) {
    return;
  }

  const created = await ensureGuestSession(timeoutMs);
  if (!created.ok || !created.data?.enabled || !created.data.available || !created.data.authenticated) {
    throw new Error(created.error?.message || '创建对决游客身份失败，请刷新重试');
  }
}

/**
 * Fetch paginated duel history list for current guest.
 */
export async function fetchDuelHistoryList(options?: {
  limit?: number;
  offset?: number;
  timeoutMs?: number;
}): Promise<ApiResult<DuelHistoryListResponse>> {
  const limit = options?.limit ?? 10;
  const offset = options?.offset ?? 0;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const url = `/api/duel/history?limit=${encodeURIComponent(limit)}&offset=${encodeURIComponent(offset)}`;
  return safeFetchJson<DuelHistoryListResponse>(
    url,
    { method: 'GET', timeoutMs },
    isDuelHistoryListResponse
  );
}

/**
 * Fetch completed duel record detail by matchId.
 */
export async function fetchDuelHistoryDetail(
  matchId: string,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<ApiResult<DuelHistoryDetailResponse>> {
  if (!matchId || typeof matchId !== 'string' || matchId.trim().length === 0) {
    return { ok: false, error: { code: 'INVALID_ID', message: '无效的对决标识' } };
  }
  const url = `/api/duel/history/${encodeURIComponent(matchId)}`;
  return safeFetchJson<DuelHistoryDetailResponse>(
    url,
    { method: 'GET', timeoutMs, custom404Message: '对决记录不存在或尚在归档中' },
    isDuelHistoryDetailResponse
  );
}
