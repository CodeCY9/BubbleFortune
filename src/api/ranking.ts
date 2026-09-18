export interface ApiResult<T> {
  ok: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

export type SeasonStatus = 'upcoming' | 'active' | 'completed' | 'archived';
export type RankingBoard =
  | 'elo'
  | 'net_profit'
  | 'challenger_profit'
  | 'banker_profit'
  | 'win_rate'
  | 'survivor_wins'
  | 'tournament_wins'
  | 'matches'
  | 'single_highest'
  | 'single_margin';

export interface SeasonSummary {
  seasonId: string;
  name: string;
  ruleVersion: string;
  startAt: number;
  endAt: number;
  status: SeasonStatus;
  createdAt?: number;
}

export interface SeasonsResponse {
  items: SeasonSummary[];
  activeSeasonId: string | null;
}

export interface RankingEntry {
  rank: number;
  elo: number;
  winRate: number;
  roleBalanceReturnRate: number;
  netProfit: number;
  challengerProfit?: number;
  bankerProfit?: number;
  matchesPlayed: number;
  forfeitRate: number;
  survivorGamesPlayed?: number;
  survivorWins?: number;
  tournamentGamesPlayed?: number;
  tournamentWins?: number;
  singleGamesPlayed?: number;
  singleHighestProfit?: number;
  singleBestDealMargin?: number;
}

export interface RankingListResponse {
  seasonId: string;
  board?: RankingBoard;
  items: RankingEntry[];
  total: number;
  limit: number;
  offset: number;
}

export interface ProfileSummary {
  guestId: string;
  elo: number;
  rank: number | null;
  seasonId: string;
  matchesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  forfeits: number;
  winRate: number;
  roleBalanceReturnRate: number;
  netProfit: number;
  forfeitRate: number;
  singleGamesPlayed: number;
  singleHighestProfit?: number;
  singleBestDealMargin?: number;
  duelGamesPlayed: number;
  auctionGamesPlayed: number;
  survivorGamesPlayed?: number;
  survivorWins?: number;
  tournamentGamesPlayed?: number;
  tournamentWins?: number;
  createdAt: number;
}

export type ReportCategory =
  | 'cheating'
  | 'match_fixing'
  | 'stall'
  | 'harassment'
  | 'other';

export interface ReportPayload {
  targetType: 'guest' | 'match' | 'auction' | string;
  targetId: string;
  category: ReportCategory | string;
  reason: string;
}

export interface ReportResponse {
  success: boolean;
  reportId: string;
  status: string;
}

const DEFAULT_TIMEOUT_MS = 6000;

interface SafeFetchOptions {
  credentials?: RequestCredentials;
  method?: 'GET' | 'POST';
  body?: unknown;
  timeoutMs?: number;
}

/**
 * Universal safe fetch utility for ranking and report APIs.
 * Enforces no-store caching, strict timeouts, response parsing, and domain error mapping.
 */
async function rankingSafeFetch<T>(
  url: string,
  options: SafeFetchOptions,
  validator: (data: unknown) => data is T
): Promise<ApiResult<T>> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

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

    // 200 or 201 OK
    if (res.status === 200 || res.status === 201) {
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
          error: { code: 'INVALID_RESPONSE', message: '服务器响应数据格式校验未通过' },
        };
      }

      return { ok: true, data: json };
    }

    // Try parsing structured error payload from server
    let serverErrorPayload: { code?: string; message?: string; error?: { code?: string; message?: string } } | null = null;
    try {
      serverErrorPayload = await res.json();
    } catch {
      // Ignored if non-JSON error body
    }

    const rawCode = serverErrorPayload?.error?.code || serverErrorPayload?.code;
    const rawMessage = serverErrorPayload?.error?.message || serverErrorPayload?.message;

    if (res.status === 400) {
      return {
        ok: false,
        error: {
          code: rawCode || 'INVALID_PAYLOAD',
          message: rawMessage || '请求参数非法，请检查后重试',
        },
      };
    }

    if (res.status === 401) {
      return {
        ok: false,
        error: {
          code: rawCode || 'UNAUTHORIZED',
          message: rawMessage || '游客身份未认证或凭证已过期，请重新进入大厅获取身份',
        },
      };
    }

    if (res.status === 404) {
      return {
        ok: false,
        error: {
          code: rawCode || 'NOT_FOUND',
          message: rawMessage || '请求的目标资源或记录未找到',
        },
      };
    }

    if (res.status === 409) {
      return {
        ok: false,
        error: {
          code: rawCode || 'REPORT_CONFLICT',
          message: rawMessage || '您已提交过针对该目标的同类举报，请勿重复提交',
        },
      };
    }

    if (res.status === 429) {
      return {
        ok: false,
        error: {
          code: rawCode || 'REPORT_RATE_LIMITED',
          message: rawMessage || '提交过于频繁，请稍后再试（同一网络每小时限制 10 次）',
        },
      };
    }

    if (res.status === 503) {
      return {
        ok: false,
        error: {
          code: rawCode || 'DATABASE_UNAVAILABLE',
          message: rawMessage || '排位与举报数据库服务暂时维护中，请稍后重试',
        },
      };
    }

    return {
      ok: false,
      error: {
        code: rawCode || `HTTP_${res.status}`,
        message: rawMessage || `请求未成功 (${res.status})`,
      },
    };
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      return {
        ok: false,
        error: { code: 'TIMEOUT', message: '网络请求超时，请检查网络连接' },
      };
    }
    return {
      ok: false,
      error: { code: 'NETWORK_ERROR', message: '网络连接异常，请稍后重试' },
    };
  } finally {
    clearTimeout(timer);
  }
}

// Runtime Validators
export function isSeasonsResponse(data: unknown): data is SeasonsResponse {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const d = data as Record<string, unknown>;
  if (!Array.isArray(d.items)) return false;
  if (d.activeSeasonId !== null && typeof d.activeSeasonId !== 'string') return false;

  const validStatuses = new Set(['upcoming', 'active', 'completed', 'archived']);
  for (const item of d.items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    const s = item as Record<string, unknown>;
    if (
      typeof s.seasonId !== 'string' ||
      s.seasonId.trim().length === 0 ||
      typeof s.name !== 'string' ||
      s.name.trim().length === 0 ||
      typeof s.ruleVersion !== 'string' ||
      typeof s.startAt !== 'number' ||
      !Number.isFinite(s.startAt) ||
      typeof s.endAt !== 'number' ||
      !Number.isFinite(s.endAt) ||
      typeof s.status !== 'string' ||
      !validStatuses.has(s.status)
    ) {
      return false;
    }
  }

  return true;
}

export function isRankingListResponse(data: unknown): data is RankingListResponse {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const d = data as Record<string, unknown>;
  const validBoards = new Set<RankingBoard>([
    'elo',
    'net_profit',
    'challenger_profit',
    'banker_profit',
    'win_rate',
    'survivor_wins',
    'tournament_wins',
    'matches',
    'single_highest',
    'single_margin'
  ]);
  if (
    typeof d.seasonId !== 'string' ||
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
  if (d.board !== undefined && (typeof d.board !== 'string' || !validBoards.has(d.board as RankingBoard))) return false;

  for (const item of d.items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    const r = item as Record<string, unknown>;
    // Ensure credentials / private tokens are strictly absent
    if ('guestId' in r || 'token' in r || 'tokenHash' in r) {
      return false;
    }
    if (
      typeof r.rank !== 'number' ||
      !Number.isInteger(r.rank) ||
      r.rank < 1 ||
      typeof r.elo !== 'number' ||
      !Number.isFinite(r.elo) ||
      typeof r.winRate !== 'number' ||
      !Number.isFinite(r.winRate) ||
      r.winRate < 0 ||
      r.winRate > 1 ||
      typeof r.roleBalanceReturnRate !== 'number' ||
      !Number.isFinite(r.roleBalanceReturnRate) ||
      r.roleBalanceReturnRate < 0 ||
      typeof r.netProfit !== 'number' ||
      !Number.isFinite(r.netProfit) ||
      typeof r.matchesPlayed !== 'number' ||
      !Number.isInteger(r.matchesPlayed) ||
      r.matchesPlayed < 0 ||
      typeof r.forfeitRate !== 'number' ||
      !Number.isFinite(r.forfeitRate) ||
      r.forfeitRate < 0 ||
      r.forfeitRate > 1
      || (r.survivorGamesPlayed !== undefined && (typeof r.survivorGamesPlayed !== 'number' || !Number.isInteger(r.survivorGamesPlayed) || r.survivorGamesPlayed < 0))
      || (r.survivorWins !== undefined && (typeof r.survivorWins !== 'number' || !Number.isInteger(r.survivorWins) || r.survivorWins < 0))
      || (r.tournamentGamesPlayed !== undefined && (typeof r.tournamentGamesPlayed !== 'number' || !Number.isInteger(r.tournamentGamesPlayed) || r.tournamentGamesPlayed < 0))
      || (r.tournamentWins !== undefined && (typeof r.tournamentWins !== 'number' || !Number.isInteger(r.tournamentWins) || r.tournamentWins < 0))
      || (r.singleGamesPlayed !== undefined && (typeof r.singleGamesPlayed !== 'number' || !Number.isInteger(r.singleGamesPlayed) || r.singleGamesPlayed < 0))
      || (r.singleHighestProfit !== undefined && (typeof r.singleHighestProfit !== 'number' || !Number.isFinite(r.singleHighestProfit)))
      || (r.singleBestDealMargin !== undefined && (typeof r.singleBestDealMargin !== 'number' || !Number.isFinite(r.singleBestDealMargin)))
      || (r.challengerProfit !== undefined && (typeof r.challengerProfit !== 'number' || !Number.isFinite(r.challengerProfit)))
      || (r.bankerProfit !== undefined && (typeof r.bankerProfit !== 'number' || !Number.isFinite(r.bankerProfit)))
    ) {
      return false;
    }
  }

  return true;
}

export function isProfileSummary(data: unknown): data is ProfileSummary {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const d = data as Record<string, unknown>;
  if (
    typeof d.guestId !== 'string' ||
    d.guestId.trim().length === 0 ||
    typeof d.seasonId !== 'string' ||
    typeof d.elo !== 'number' ||
    !Number.isFinite(d.elo) ||
    (d.rank !== null && (typeof d.rank !== 'number' || !Number.isInteger(d.rank) || d.rank < 1)) ||
    typeof d.matchesPlayed !== 'number' ||
    !Number.isInteger(d.matchesPlayed) ||
    d.matchesPlayed < 0 ||
    typeof d.wins !== 'number' ||
    !Number.isInteger(d.wins) ||
    d.wins < 0 ||
    typeof d.losses !== 'number' ||
    !Number.isInteger(d.losses) ||
    d.losses < 0 ||
    typeof d.draws !== 'number' ||
    !Number.isInteger(d.draws) ||
    d.draws < 0 ||
    typeof d.forfeits !== 'number' ||
    !Number.isInteger(d.forfeits) ||
    d.forfeits < 0 ||
    typeof d.winRate !== 'number' ||
    !Number.isFinite(d.winRate) ||
    d.winRate < 0 ||
    d.winRate > 1 ||
    typeof d.roleBalanceReturnRate !== 'number' ||
    !Number.isFinite(d.roleBalanceReturnRate) ||
    d.roleBalanceReturnRate < 0 ||
    typeof d.netProfit !== 'number' ||
    !Number.isFinite(d.netProfit) ||
    typeof d.forfeitRate !== 'number' ||
    !Number.isFinite(d.forfeitRate) ||
    d.forfeitRate < 0 ||
    d.forfeitRate > 1 ||
    typeof d.singleGamesPlayed !== 'number' ||
    !Number.isInteger(d.singleGamesPlayed) ||
    d.singleGamesPlayed < 0 ||
    (d.singleHighestProfit !== undefined && (typeof d.singleHighestProfit !== 'number' || !Number.isFinite(d.singleHighestProfit))) ||
    (d.singleBestDealMargin !== undefined && (typeof d.singleBestDealMargin !== 'number' || !Number.isFinite(d.singleBestDealMargin))) ||
    typeof d.duelGamesPlayed !== 'number' ||
    !Number.isInteger(d.duelGamesPlayed) ||
    d.duelGamesPlayed < 0 ||
    typeof d.auctionGamesPlayed !== 'number' ||
    !Number.isInteger(d.auctionGamesPlayed) ||
    d.auctionGamesPlayed < 0 ||
    (d.survivorGamesPlayed !== undefined && (typeof d.survivorGamesPlayed !== 'number' || !Number.isInteger(d.survivorGamesPlayed) || d.survivorGamesPlayed < 0)) ||
    (d.survivorWins !== undefined && (typeof d.survivorWins !== 'number' || !Number.isInteger(d.survivorWins) || d.survivorWins < 0)) ||
    (d.tournamentGamesPlayed !== undefined && (typeof d.tournamentGamesPlayed !== 'number' || !Number.isInteger(d.tournamentGamesPlayed) || d.tournamentGamesPlayed < 0)) ||
    (d.tournamentWins !== undefined && (typeof d.tournamentWins !== 'number' || !Number.isInteger(d.tournamentWins) || d.tournamentWins < 0)) ||
    typeof d.createdAt !== 'number' ||
    !Number.isFinite(d.createdAt) ||
    d.createdAt <= 0
  ) {
    return false;
  }

  return true;
}

export function isReportResponse(data: unknown): data is ReportResponse {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const d = data as Record<string, unknown>;
  return (
    d.success === true &&
    typeof d.reportId === 'string' &&
    d.reportId.trim().length > 0 &&
    typeof d.status === 'string'
  );
}

// Exported Fetch Functions

/**
 * Fetch all available seasons and active season ID.
 */
export async function fetchSeasons(timeoutMs = DEFAULT_TIMEOUT_MS): Promise<ApiResult<SeasonsResponse>> {
  return rankingSafeFetch<SeasonsResponse>(
    '/api/seasons',
    { method: 'GET', timeoutMs },
    isSeasonsResponse
  );
}

/**
 * Fetch season rankings. If seasonId is omitted, active season ranking is returned.
 */
export async function fetchRankings(options?: {
  seasonId?: string;
  board?: RankingBoard;
  limit?: number;
  offset?: number;
  timeoutMs?: number;
}): Promise<ApiResult<RankingListResponse>> {
  const limit = options?.limit ?? 20;
  const offset = options?.offset ?? 0;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const basePath = options?.seasonId
    ? `/api/rankings/${encodeURIComponent(options.seasonId)}`
    : '/api/rankings';

  const boardQuery = options?.board ? `&board=${encodeURIComponent(options.board)}` : '';
  const url = `${basePath}?limit=${encodeURIComponent(limit)}&offset=${encodeURIComponent(offset)}${boardQuery}`;
  return rankingSafeFetch<RankingListResponse>(
    url,
    { method: 'GET', timeoutMs },
    isRankingListResponse
  );
}

/**
 * Fetch current authenticated guest's ranking and profile summary.
 */
export async function fetchProfileSummary(options?: {
  seasonId?: string;
  timeoutMs?: number;
}): Promise<ApiResult<ProfileSummary>> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const url = options?.seasonId
    ? `/api/profile/summary?seasonId=${encodeURIComponent(options.seasonId)}`
    : '/api/profile/summary';

  return rankingSafeFetch<ProfileSummary>(
    url,
    { method: 'GET', timeoutMs },
    isProfileSummary
  );
}

/**
 * Submit player violation or unfair match report.
 */
export async function submitReport(
  payload: ReportPayload,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<ApiResult<ReportResponse>> {
  const cleanPayload = {
    targetType: String(payload.targetType || '').trim(),
    targetId: String(payload.targetId || '').trim(),
    category: String(payload.category || '').trim(),
    reason: String(payload.reason || '').trim().slice(0, 200),
  };

  if (!cleanPayload.targetType || !cleanPayload.targetId || !cleanPayload.category) {
    return {
      ok: false,
      error: { code: 'INVALID_PAYLOAD', message: '举报目标类型、目标标识及违规类别为必填项' },
    };
  }

  return rankingSafeFetch<ReportResponse>(
    '/api/reports',
    {
      method: 'POST',
      body: cleanPayload,
      timeoutMs,
    },
    isReportResponse
  );
}
