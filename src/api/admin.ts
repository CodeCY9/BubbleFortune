export interface AdminApiResult<T> {
  ok: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

export interface AdminSessionResponse {
  success: boolean;
  authenticated: boolean;
}

export interface AdminMetrics {
  totalGuests: number;
  activeGuests24h: number;
  totalSingleGames: number;
  totalDuelGames: number;
  totalAuctionGames: number;
  totalSurvivorGames: number;
  totalTournamentGames: number;
  pendingReports: number;
  activeBans: number;
  systemHealth: string;
}

export interface AdminAnalyticsSummary {
  generatedAt: number;
  windowDays: number;
  totals: {
    events: number;
    uniqueGuests: number;
    completedMatches: number;
  };
  byMode: Array<{ mode: string; events: number; completed: number; uniqueGuests: number }>;
  daily: Array<{ day: string; eventName: string; mode: string | null; count: number; uniqueGuests: number }>;
  retention: {
    eligible1d: number;
    retained1d: number;
    eligible7d: number;
    retained7d: number;
    eligible30d: number;
    retained30d: number;
  };
}

export interface AdminConfigItem {
  key: string;
  value: unknown;
  version: number;
  description: string;
  updatedAt: number;
  updatedBy: string;
}

export interface AdminThemesResponse {
  activeTheme: string;
  availableThemes: string[];
}

export interface AdminReportItem {
  id: string;
  reporterGuestId: string;
  targetType: string;
  targetId: string;
  category: string;
  reason: string;
  ipFingerprint: string;
  status: 'pending' | 'reviewed' | 'actioned' | 'dismissed' | string;
  resolutionNotes: string | null;
  createdAt: number;
  resolvedAt: number | null;
}

export interface AdminReportsResponse {
  items: AdminReportItem[];
  total: number;
}

export interface AdminBanItem {
  id: string;
  guestId: string;
  flagType: string;
  severity: string;
  reason: string;
  ipFingerprint?: string;
  isActive: boolean;
  createdAt?: number;
  updatedAt?: number;
}

export interface AdminBansResponse {
  items: AdminBanItem[];
}

export interface AdminSeasonItem {
  seasonId: string;
  name: string;
  ruleVersion: string;
  startAt: number;
  endAt: number;
  status: 'upcoming' | 'active' | 'completed' | 'archived' | string;
  createdAt?: number;
}

export interface AdminSeasonsResponse {
  items: AdminSeasonItem[];
}

interface FetchOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 6000;

/**
 * Universal safe fetch helper for administrative operations.
 * - Always sends ephemeral X-Admin-Token header.
 * - Strictly enforces cache: 'no-store' to prevent stale or cached security responses.
 * - Parses and maps domain errors gracefully.
 */
async function adminFetch<T>(
  url: string,
  token: string,
  options: FetchOptions = {}
): Promise<AdminApiResult<T>> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'X-Admin-Token': token,
    };

    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    const res = await fetch(url, {
      method: options.method ?? 'GET',
      credentials: 'include',
      cache: 'no-store',
      headers,
      signal: controller.signal,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });

    clearTimeout(timer);

    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      // Body might be non-JSON
    }

    if (res.ok) {
      return {
        ok: true,
        data: json as T,
      };
    }

    // Handle error response from server
    const serverErr = (json as { error?: { code?: string; message?: string } } | null)?.error;
    if (serverErr && typeof serverErr.code === 'string' && typeof serverErr.message === 'string') {
      return {
        ok: false,
        error: {
          code: serverErr.code,
          message: serverErr.message,
        },
      };
    }

    // Fallback error mapping based on HTTP status code
    let fallbackCode = `HTTP_${res.status}`;
    let fallbackMessage = `请求失败 (状态码: ${res.status})`;

    if (res.status === 401) {
      fallbackCode = 'UNAUTHORIZED';
      fallbackMessage = '管理员凭证无效或已过期，请重新登录';
    } else if (res.status === 403) {
      fallbackCode = 'FORBIDDEN';
      fallbackMessage = '访问被拒绝：权限不足或请求来源不被允许';
    } else if (res.status === 404) {
      fallbackCode = 'NOT_FOUND';
      fallbackMessage = '请求的管理接口或资源不存在';
    } else if (res.status === 503) {
      fallbackCode = 'SERVICE_UNAVAILABLE';
      fallbackMessage = '管理后台或数据库服务暂不可用';
    }

    return {
      ok: false,
      error: {
        code: fallbackCode,
        message: fallbackMessage,
      },
    };
  } catch (err: unknown) {
    clearTimeout(timer);
    if (err instanceof Error && err.name === 'AbortError') {
      return {
        ok: false,
        error: {
          code: 'REQUEST_TIMEOUT',
          message: '管理接口请求超时，请检查网络或服务器状态',
        },
      };
    }
    return {
      ok: false,
      error: {
        code: 'NETWORK_ERROR',
        message: err instanceof Error ? err.message : '网络通信异常',
      },
    };
  }
}

/**
 * 1. 验证管理员会话并建立短期会话凭证 (POST /api/admin/session)
 */
export async function loginAdminSession(token: string): Promise<AdminApiResult<AdminSessionResponse>> {
  return adminFetch<AdminSessionResponse>('/api/admin/session', token, {
    method: 'POST',
  });
}

export async function logoutAdminSession(): Promise<AdminApiResult<{ success: boolean }>> {
  return adminFetch<{ success: boolean }>('/api/admin/logout', '', { method: 'POST' });
}

/**
 * 2. 获取系统运行指标 (GET /api/admin/metrics)
 */
export async function fetchAdminMetrics(token: string): Promise<AdminApiResult<AdminMetrics>> {
  return adminFetch<AdminMetrics>('/api/admin/metrics', token, {
    method: 'GET',
  });
}

export async function fetchAdminAnalytics(token: string, days = 30): Promise<AdminApiResult<AdminAnalyticsSummary>> {
  return adminFetch<AdminAnalyticsSummary>(`/api/admin/analytics?days=${encodeURIComponent(days)}`, token, {
    method: 'GET',
  });
}

/**
 * 3. 获取所有运行时配置 (GET /api/admin/config)
 */
export async function fetchAdminConfig(token: string): Promise<AdminApiResult<{ items: AdminConfigItem[] }>> {
  return adminFetch<{ items: AdminConfigItem[] }>('/api/admin/config', token, {
    method: 'GET',
  });
}

/**
 * 3.1 保存运行时配置 (POST /api/admin/config)
 */
export async function saveAdminConfig(
  token: string,
  key: string,
  value: unknown,
  description?: string
): Promise<AdminApiResult<AdminConfigItem>> {
  return adminFetch<AdminConfigItem>('/api/admin/config', token, {
    method: 'POST',
    body: { key, value, description },
  });
}

/**
 * 3.2 局部更新运行时配置 (PATCH /api/admin/config/:key)
 */
export async function patchAdminConfig(
  token: string,
  key: string,
  value: unknown,
  description?: string
): Promise<AdminApiResult<AdminConfigItem>> {
  return adminFetch<AdminConfigItem>(`/api/admin/config/${encodeURIComponent(key)}`, token, {
    method: 'PATCH',
    body: { value, description },
  });
}

/**
 * 4. 获取主题配置 (GET /api/admin/themes)
 */
export async function fetchAdminThemes(token: string): Promise<AdminApiResult<AdminThemesResponse>> {
  return adminFetch<AdminThemesResponse>('/api/admin/themes', token, {
    method: 'GET',
  });
}

/**
 * 4.1 更新主题启停与当前活动主题 (PATCH /api/admin/themes/:themeId)
 */
export async function updateAdminTheme(
  token: string,
  themeId: string,
  options: { enabled?: boolean; setActive?: boolean }
): Promise<AdminApiResult<AdminThemesResponse>> {
  return adminFetch<AdminThemesResponse>(`/api/admin/themes/${encodeURIComponent(themeId)}`, token, {
    method: 'PATCH',
    body: options,
  });
}

/**
 * 5. 获取举报列表 (GET /api/admin/reports)
 */
export async function fetchAdminReports(
  token: string,
  options?: { status?: string; limit?: number; offset?: number }
): Promise<AdminApiResult<AdminReportsResponse>> {
  const query = new URLSearchParams();
  if (options?.status) query.set('status', options.status);
  if (options?.limit !== undefined) query.set('limit', String(options.limit));
  if (options?.offset !== undefined) query.set('offset', String(options.offset));

  const url = query.toString() ? `/api/admin/reports?${query.toString()}` : '/api/admin/reports';
  return adminFetch<AdminReportsResponse>(url, token, {
    method: 'GET',
  });
}

/**
 * 5.1 更新举报处理状态 (PATCH /api/admin/reports/:reportId)
 */
export async function updateAdminReportStatus(
  token: string,
  reportId: string,
  status: string,
  notes?: string
): Promise<AdminApiResult<{ success: boolean; reportId: string; status: string }>> {
  return adminFetch<{ success: boolean; reportId: string; status: string }>(
    `/api/admin/reports/${encodeURIComponent(reportId)}`,
    token,
    {
      method: 'PATCH',
      body: { status, notes },
    }
  );
}

/**
 * 6. 获取活跃封禁列表 (GET /api/admin/bans)
 */
export async function fetchAdminBans(token: string): Promise<AdminApiResult<AdminBansResponse>> {
  return adminFetch<AdminBansResponse>('/api/admin/bans', token, {
    method: 'GET',
  });
}

/**
 * 6.1 新增封禁 (POST /api/admin/bans)
 */
export async function createAdminBan(
  token: string,
  payload: {
    guestId: string;
    reason?: string;
    severity?: string;
    excludeRanking?: boolean;
  }
): Promise<AdminApiResult<{ success: boolean; banId: string; guestId: string }>> {
  return adminFetch<{ success: boolean; banId: string; guestId: string }>('/api/admin/bans', token, {
    method: 'POST',
    body: payload,
  });
}

/**
 * 6.2 解除封禁 (PATCH /api/admin/bans/:banId)
 */
export async function deactivateAdminBan(
  token: string,
  banId: string
): Promise<AdminApiResult<{ success: boolean; banId: string; isActive: boolean }>> {
  return adminFetch<{ success: boolean; banId: string; isActive: boolean }>(
    `/api/admin/bans/${encodeURIComponent(banId)}`,
    token,
    {
      method: 'PATCH',
      body: { isActive: false },
    }
  );
}

/**
 * 7. 获取赛季列表 (GET /api/admin/seasons)
 */
export async function fetchAdminSeasons(token: string): Promise<AdminApiResult<AdminSeasonsResponse>> {
  return adminFetch<AdminSeasonsResponse>('/api/admin/seasons', token, {
    method: 'GET',
  });
}

/**
 * 7.1 创建新赛季 (POST /api/admin/seasons)
 */
export async function createAdminSeason(
  token: string,
  payload: {
    id: string;
    name: string;
    ruleVersion: string;
    startAt: number;
    endAt: number;
    status?: string;
  }
): Promise<AdminApiResult<AdminSeasonItem>> {
  return adminFetch<AdminSeasonItem>('/api/admin/seasons', token, {
    method: 'POST',
    body: payload,
  });
}

/**
 * 7.2 更新赛季信息或状态 (PATCH /api/admin/seasons/:seasonId)
 */
export async function updateAdminSeason(
  token: string,
  seasonId: string,
  payload: Partial<{
    name: string;
    ruleVersion: string;
    startAt: number;
    endAt: number;
    status: 'upcoming' | 'active' | 'completed' | 'archived' | string;
  }>
): Promise<AdminApiResult<AdminSeasonItem>> {
  return adminFetch<AdminSeasonItem>(`/api/admin/seasons/${encodeURIComponent(seasonId)}`, token, {
    method: 'PATCH',
    body: payload,
  });
}
