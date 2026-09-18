import type {
  GuestAuthStatus,
  HistoryListResponse,
  CompletedGameRecord,
} from '../../packages/protocol/src/types';

export interface ApiResult<T> {
  ok: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

const DEFAULT_TIMEOUT_MS = 6000;

interface SafeFetchOptions {
  credentials?: RequestCredentials;
  method?: 'GET' | 'POST';
  body?: unknown;
  timeoutMs?: number;
  custom404Message?: string;
  signal?: AbortSignal;
}

/**
 * Unified thin fetch helper with timeout, abort cleanup, unified error parsing,
 * and strict runtime schema validation guards.
 */
export async function safeFetchJson<T>(
  url: string,
  options: SafeFetchOptions,
  validator: (data: unknown) => data is T
): Promise<ApiResult<T>> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const abortFromCaller = () => controller.abort();
  options.signal?.addEventListener('abort', abortFromCaller, { once: true });

  try {
    const fetchInit: RequestInit = {
      method: options.method ?? 'GET',
      credentials: options.credentials ?? 'same-origin',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      signal: controller.signal,
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    };

    const res = await fetch(url, fetchInit);

    if (res.status === 200) {
      let json: unknown;
      try {
        json = await res.json();
      } catch {
        return {
          ok: false,
          error: { code: 'INVALID_RESPONSE', message: '服务器响应格式非法（无法解析 JSON）' },
        };
      }

      if (!validator(json)) {
        return {
          ok: false,
          error: { code: 'INVALID_RESPONSE', message: '服务器响应内容校验失败' },
        };
      }

      return { ok: true, data: json };
    }

    if (res.status === 404) {
      return {
        ok: false,
        error: {
          code: 'RECORD_NOT_FOUND',
          message: options.custom404Message || '记录不存在或尚在保存，请刷新重试',
        },
      };
    }

    if (res.status === 401) {
      return {
        ok: false,
        error: { code: 'UNAUTHORIZED', message: '游客身份凭证无效或已过期，请重新进入大厅' },
      };
    }

    if (res.status === 503) {
      let code = 'DATABASE_UNAVAILABLE';
      let message = '历史战绩服务暂时维护中，请稍后重试';
      try {
        const body = await res.json();
        if (body?.error?.code) code = body.error.code;
        else if (body?.code) code = body.code;
        if (body?.error?.message) message = body.error.message;
        else if (body?.message) message = body.message;
      } catch {}
      return { ok: false, error: { code, message } };
    }

    return {
      ok: false,
      error: { code: 'HTTP_' + res.status, message: `请求未成功 (${res.status})` },
    };
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      return { ok: false, error: { code: 'TIMEOUT', message: '网络请求超时，请检查网络连接' } };
    }
    return { ok: false, error: { code: 'NETWORK_ERROR', message: '网络连接异常，请稍后重试' } };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abortFromCaller);
  }
}

// Runtime Guards
export function isGuestAuthStatus(data: unknown): data is GuestAuthStatus {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const d = data as Record<string, unknown>;
  return (
    typeof d.enabled === 'boolean' &&
    typeof d.available === 'boolean' &&
    typeof d.authenticated === 'boolean' &&
    (!d.available || d.enabled) &&
    (!d.authenticated || (d.enabled && d.available))
  );
}

const VALID_AI_TYPES = new Set(['conservative', 'aggressive', 'cold', 'inducement', 'crazy']);
const VALID_OUTCOME_TYPES = new Set(['OFFER_ACCEPTED', 'FINAL_KEEP', 'FINAL_SWAP']);
const VALID_OFFER_OUTCOMES = new Set(['PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED']);

export function isHistoryListResponse(data: unknown): data is HistoryListResponse {
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

  for (const item of d.items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    const it = item as Record<string, unknown>;
    if (
      typeof it.resultId !== 'string' ||
      it.resultId.trim().length === 0 ||
      typeof it.gameId !== 'string' ||
      it.gameId.trim().length === 0 ||
      typeof it.aiType !== 'string' ||
      !VALID_AI_TYPES.has(it.aiType) ||
      typeof it.wonAmount !== 'number' ||
      !Number.isFinite(it.wonAmount) ||
      it.wonAmount < 0 ||
      typeof it.outcomeType !== 'string' ||
      !VALID_OUTCOME_TYPES.has(it.outcomeType) ||
      typeof it.completedAt !== 'number' ||
      !Number.isFinite(it.completedAt) ||
      it.completedAt <= 0 ||
      typeof it.ruleVersion !== 'string' ||
      !Number.isInteger(it.originalPlayerBoxId) ||
      !Number.isInteger(it.finalPlayerBoxId)
    ) {
      return false;
    }
  }

  return true;
}

export function isCompletedGameRecord(data: unknown): data is CompletedGameRecord {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const d = data as Record<string, unknown>;
  if (
    typeof d.gameId !== 'string' ||
    d.gameId.trim().length === 0 ||
    typeof d.ruleVersion !== 'string' ||
    d.ruleVersion.trim().length === 0 ||
    typeof d.aiType !== 'string' ||
    !VALID_AI_TYPES.has(d.aiType) ||
    typeof d.completedAt !== 'number' ||
    !Number.isFinite(d.completedAt) ||
    d.completedAt <= 0
  ) {
    return false;
  }

  // Check settlement
  if (!d.settlement || typeof d.settlement !== 'object' || Array.isArray(d.settlement)) {
    return false;
  }
  const s = d.settlement as Record<string, unknown>;
  if (
    typeof s.resultId !== 'string' ||
    s.resultId.trim().length === 0 ||
    typeof s.wonAmount !== 'number' ||
    !Number.isFinite(s.wonAmount) ||
    s.wonAmount < 0 ||
    typeof s.outcomeType !== 'string' ||
    !VALID_OUTCOME_TYPES.has(s.outcomeType) ||
    typeof s.originalPlayerBoxId !== 'number' ||
    !Number.isInteger(s.originalPlayerBoxId) ||
    s.originalPlayerBoxId < 1 ||
    s.originalPlayerBoxId > 26 ||
    typeof s.finalPlayerBoxId !== 'number' ||
    !Number.isInteger(s.finalPlayerBoxId) ||
    s.finalPlayerBoxId < 1 ||
    s.finalPlayerBoxId > 26
  ) {
    return false;
  }

  // Check offerHistory
  if (!Array.isArray(d.offerHistory)) return false;
  for (const entry of d.offerHistory) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
    const e = entry as Record<string, unknown>;
    if (
      typeof e.offerId !== 'string' ||
      typeof e.round !== 'number' ||
      !Number.isInteger(e.round) ||
      e.round < 1 ||
      e.round > 9 ||
      typeof e.amount !== 'number' ||
      !Number.isFinite(e.amount) ||
      e.amount < 0 ||
      typeof e.outcome !== 'string' ||
      !VALID_OFFER_OUTCOMES.has(e.outcome)
    ) {
      return false;
    }
    if (e.dialogue !== undefined && (typeof e.dialogue !== 'string' || Array.from(e.dialogue).length > 240)) {
      return false;
    }
  }

  // Check auditTrail
  if (!Array.isArray(d.auditTrail)) return false;

  return true;
}

/**
 * Check guest authentication and database availability status.
 */
export async function fetchGuestStatus(timeoutMs = DEFAULT_TIMEOUT_MS): Promise<ApiResult<GuestAuthStatus>> {
  return safeFetchJson<GuestAuthStatus>('/api/guest', { method: 'GET', timeoutMs }, isGuestAuthStatus);
}

/**
 * Ensure guest cookie exists before room creation / API operations.
 */
export async function ensureGuestSession(timeoutMs = DEFAULT_TIMEOUT_MS): Promise<ApiResult<GuestAuthStatus>> {
  return safeFetchJson<GuestAuthStatus>(
    '/api/guest',
    { method: 'POST', body: {}, timeoutMs },
    isGuestAuthStatus
  );
}

/** Only an explicitly disabled history service permits anonymous play. */
export async function requireGuestSession(): Promise<void> {
  const status = await fetchGuestStatus();
  if (!status.ok || !status.data) throw new Error(status.error?.message || '无法确认游客身份，请重试');
  if (!status.data.enabled && !status.data.available && !status.data.authenticated) return;
  if (!status.data.enabled || !status.data.available) throw new Error('战绩服务暂时不可用，请稍后重试');
  if (status.data.authenticated) return;
  const session = await ensureGuestSession();
  if (!session.ok || !session.data?.enabled || !session.data.available || !session.data.authenticated) {
    throw new Error(session.error?.message || '游客身份创建失败，请重试');
  }
}

/**
 * Fetch paginated history records for current authenticated guest.
 */
export async function fetchHistoryList(options?: {
  limit?: number;
  offset?: number;
  timeoutMs?: number;
}): Promise<ApiResult<HistoryListResponse>> {
  const limit = options?.limit ?? 10;
  const offset = options?.offset ?? 0;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const url = `/api/history?limit=${encodeURIComponent(limit)}&offset=${encodeURIComponent(offset)}`;
  return safeFetchJson<HistoryListResponse>(url, { method: 'GET', timeoutMs }, isHistoryListResponse);
}

/**
 * Fetch detailed completed game record for a single game.
 */
export async function fetchHistoryDetail(
  resultId: string,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<ApiResult<CompletedGameRecord>> {
  if (!resultId || typeof resultId !== 'string' || resultId.trim().length === 0) {
    return { ok: false, error: { code: 'INVALID_ID', message: '无效的战绩标识' } };
  }
  const url = `/api/history/${encodeURIComponent(resultId)}`;
  return safeFetchJson<CompletedGameRecord>(
    url,
    { method: 'GET', timeoutMs, custom404Message: '记录不存在或尚在保存，请刷新重试' },
    isCompletedGameRecord
  );
}
