import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  isSeasonsResponse,
  isRankingListResponse,
  isProfileSummary,
  isReportResponse,
  fetchSeasons,
  fetchRankings,
  fetchProfileSummary,
  submitReport,
} from '../src/api/ranking';
import {
  getTheme,
  applyThemeTokens,
  CLASSIC_THEME,
  STARRY_NEON_THEME,
  THEMES,
} from '../src/themes/registry';

describe('Ranking & Profile API Validation Tests', () => {
  it('1.1 isSeasonsResponse 严格校验赛季列表结构', () => {
    const valid = {
      items: [
        {
          seasonId: 'season-1',
          name: '第 1 赛季 (V1.0)',
          ruleVersion: 'season-v1',
          startAt: 1773273600000,
          endAt: 1775692800000,
          status: 'active',
        },
      ],
      activeSeasonId: 'season-1',
    };
    assert.strictEqual(isSeasonsResponse(valid), true);

    // 状态非法时拒绝
    assert.strictEqual(
      isSeasonsResponse({ ...valid, items: [{ ...valid.items[0], status: 'unknown' }] }),
      false
    );
    // 缺失字段时拒绝
    assert.strictEqual(isSeasonsResponse({ items: [{ seasonId: 's1' }] }), false);
  });

  it('1.2 isRankingListResponse 校验天梯排行并严格排除游客凭据 (Privacy Guard)', () => {
    const valid = {
      seasonId: 'season-1',
      items: [
        {
          rank: 1,
          elo: 1350,
          winRate: 0.65,
          roleBalanceReturnRate: 1.152,
          netProfit: 850000,
          matchesPlayed: 40,
          forfeitRate: 0.025,
        },
      ],
      total: 1,
      limit: 20,
      offset: 0,
    };
    assert.strictEqual(isRankingListResponse(valid), true);

    // 排行榜绝不能泄露 guestId 或 token
    const leakingGuestId = {
      ...valid,
      items: [{ ...valid.items[0], guestId: 'd3b07384-xxxx-xxxx' }],
    };
    assert.strictEqual(isRankingListResponse(leakingGuestId), false);

    const leakingToken = {
      ...valid,
      items: [{ ...valid.items[0], token: 'secret-token' }],
    };
    assert.strictEqual(isRankingListResponse(leakingToken), false);

    // 负场次或越界胜率拒绝
    assert.strictEqual(
      isRankingListResponse({
        ...valid,
        items: [{ ...valid.items[0], winRate: 1.5 }],
      }),
      false
    );
  });

  it('1.3 isProfileSummary 校验游客档案与全模式场次', () => {
    const valid = {
      guestId: 'd3b07384-d113-4632-9c91-46648d1beeed',
      elo: 1280,
      rank: 1,
      seasonId: 'season-1',
      matchesPlayed: 40,
      wins: 26,
      losses: 13,
      draws: 1,
      forfeits: 1,
      winRate: 0.65,
      roleBalanceReturnRate: 1.152,
      netProfit: 850000,
      forfeitRate: 0.025,
      singleGamesPlayed: 15,
      duelGamesPlayed: 20,
      auctionGamesPlayed: 5,
      createdAt: 1773273600000,
    };
    assert.strictEqual(isProfileSummary(valid), true);

    // 隔离或未定级玩家 rank 允许为 null
    assert.strictEqual(isProfileSummary({ ...valid, rank: null }), true);

    // 负数胜场或缺失 guestId 拒绝
    assert.strictEqual(isProfileSummary({ ...valid, wins: -1 }), false);
    assert.strictEqual(isProfileSummary({ ...valid, guestId: '' }), false);
  });

  it('1.4 isReportResponse 校验举报响应工单', () => {
    assert.strictEqual(
      isReportResponse({ success: true, reportId: 'rep_12345', status: 'pending' }),
      true
    );
    assert.strictEqual(isReportResponse({ success: false }), false);
    assert.strictEqual(isReportResponse({ success: true, reportId: '' }), false);
  });

  it('1.5 fetchRankings / fetchProfileSummary / submitReport 请求选项与错误映射', async () => {
    const originalFetch = globalThis.fetch;
    try {
      // 1. 测试 no-store 缓存策略和正确路径
      let capturedInit: RequestInit | undefined;
      let capturedUrl: string | undefined;

      (globalThis as any).fetch = async (url: string, init: RequestInit) => {
        capturedUrl = url;
        capturedInit = init;
        return {
          status: 200,
          json: async () => ({
            seasonId: 'season-1',
            items: [],
            total: 0,
            limit: 20,
            offset: 0,
          }),
        };
      };

      const res = await fetchRankings({ seasonId: 'season-1', limit: 20, offset: 0 });
      assert.strictEqual(res.ok, true);
      assert.strictEqual(capturedInit?.cache, 'no-store');
      assert.strictEqual(capturedInit?.credentials, 'same-origin');
      assert.ok(capturedUrl?.includes('/api/rankings/season-1'));

      // 2. 测试 409 举报冲突映射
      (globalThis as any).fetch = async () => ({
        status: 409,
        json: async () => ({ code: 'REPORT_CONFLICT', message: '已提交' }),
      });

      const conflictRes = await submitReport({
        targetType: 'match',
        targetId: 'res_123',
        category: 'cheating',
        reason: '异常操作',
      });
      assert.strictEqual(conflictRes.ok, false);
      assert.strictEqual(conflictRes.error?.code, 'REPORT_CONFLICT');

      // 3. 测试 429 举报限频映射
      (globalThis as any).fetch = async () => ({
        status: 429,
        json: async () => ({ code: 'REPORT_RATE_LIMITED', message: '限频' }),
      });

      const rateLimitRes = await submitReport({
        targetType: 'match',
        targetId: 'res_123',
        category: 'cheating',
        reason: '异常操作',
      });
      assert.strictEqual(rateLimitRes.ok, false);
      assert.strictEqual(rateLimitRes.error?.code, 'REPORT_RATE_LIMITED');

      // 4. 测试 401 未登录映射
      (globalThis as any).fetch = async () => ({
        status: 401,
        json: async () => ({ code: 'UNAUTHORIZED', message: '未登录' }),
      });

      const unauthRes = await fetchProfileSummary();
      assert.strictEqual(unauthRes.ok, false);
      assert.strictEqual(unauthRes.error?.code, 'UNAUTHORIZED');

      // 5. 测试 503 数据库维护映射
      (globalThis as any).fetch = async () => ({
        status: 503,
        json: async () => ({ code: 'DATABASE_UNAVAILABLE', message: '维护中' }),
      });

      const dbDownRes = await fetchProfileSummary();
      assert.strictEqual(dbDownRes.ok, false);
      assert.strictEqual(dbDownRes.error?.code, 'DATABASE_UNAVAILABLE');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('Theme Registry & Fallback Tests', () => {
  it('2.1 getTheme 正确返回 classic 与 starry-neon 独立主题定义', () => {
    const classic = getTheme('classic');
    const neon = getTheme('starry-neon');
    const fallback = getTheme('unknown-theme');

    assert.strictEqual(classic.id, 'classic');
    assert.strictEqual(neon.id, 'starry-neon');
    assert.strictEqual(fallback.id, 'classic');

    assert.notStrictEqual(classic.tokens.goldPrimary, neon.tokens.goldPrimary);
    assert.notStrictEqual(classic.tokens.bgStage, neon.tokens.bgStage);
    assert.strictEqual(neon.tokens.goldPrimary, '#00f0ff');
    assert.strictEqual(classic.tokens.goldPrimary, '#f59e0b');
  });

  it('2.2 主题注册包含低画质回退 (Low-quality fallback tokens)', () => {
    assert.strictEqual(STARRY_NEON_THEME.lowQualityFallbackTokens.shadowNeon, 'none');
    assert.strictEqual(STARRY_NEON_THEME.lowQualityFallbackTokens.glassBlur, 'none');
    assert.strictEqual(CLASSIC_THEME.lowQualityFallbackTokens.shadowNeon, 'none');
    assert.strictEqual(CLASSIC_THEME.lowQualityFallbackTokens.glassBlur, 'none');
  });

  it('2.3 applyThemeTokens 写入 data-theme 与 CSS 自定义属性', () => {
    const originalDoc = (globalThis as any).document;
    const mockStyle: Record<string, string> = {};
    let setAttrKey = '';
    let setAttrVal = '';

    (globalThis as any).document = {
      documentElement: {
        setAttribute: (k: string, v: string) => {
          setAttrKey = k;
          setAttrVal = v;
        },
        style: {
          setProperty: (k: string, v: string) => {
            mockStyle[k] = v;
          },
        },
      },
    };

    try {
      applyThemeTokens('starry-neon', false);
      assert.strictEqual(setAttrKey, 'data-theme');
      assert.strictEqual(setAttrVal, 'starry-neon');
      assert.strictEqual(mockStyle['--gold-primary'], '#00f0ff');
      assert.strictEqual(mockStyle['--shadow-neon'], '0 0 28px rgba(0, 240, 255, 0.35)');

      // 验证低画质回退生效
      applyThemeTokens('starry-neon', true);
      assert.strictEqual(mockStyle['--shadow-neon'], 'none');
      assert.strictEqual(mockStyle['--glass-blur'], 'none');
    } finally {
      (globalThis as any).document = originalDoc;
    }
  });
});
