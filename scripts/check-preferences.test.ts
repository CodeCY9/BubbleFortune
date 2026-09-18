import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  parsePreferences,
  loadPreferences,
  savePreferences,
  resolveReducedMotion,
  detectInitialQuality,
  AutoQualityEvaluator,
  DEFAULT_PREFERENCES,
  PREFERENCES_STORAGE_KEY,
  Preferences,
  validateDealAcceptance,
} from '../src/utils/preferences';
import {
  PerformanceSampler,
  calculatePercentile,
} from '../src/utils/performance';

describe('1. Production Preferences Parsing & Fallback Resilience Tests', () => {
  it('1.1 空值或非字符串返回默认偏好 (Null/empty returns DEFAULT_PREFERENCES)', () => {
    assert.deepStrictEqual(parsePreferences(null), DEFAULT_PREFERENCES);
    assert.deepStrictEqual(parsePreferences(''), DEFAULT_PREFERENCES);
    assert.deepStrictEqual(parsePreferences(undefined as any), DEFAULT_PREFERENCES);
  });

  it('1.2 损坏的 JSON 格式平稳回退默认 (Corrupted JSON safely falls back)', () => {
    assert.deepStrictEqual(parsePreferences('{bad-json-string'), DEFAULT_PREFERENCES);
    assert.deepStrictEqual(parsePreferences('undefined'), DEFAULT_PREFERENCES);
    assert.deepStrictEqual(parsePreferences('{ "quality": '), DEFAULT_PREFERENCES);
  });

  it('1.3 非对象 JSON 平稳回退 (Non-object JSON falls back)', () => {
    assert.deepStrictEqual(parsePreferences('12345'), DEFAULT_PREFERENCES);
    assert.deepStrictEqual(parsePreferences('"a string"'), DEFAULT_PREFERENCES);
    assert.deepStrictEqual(parsePreferences('["array", 1]'), DEFAULT_PREFERENCES);
    assert.deepStrictEqual(parsePreferences('true'), DEFAULT_PREFERENCES);
  });

  it('1.4 部分字段缺失补齐默认值 (Missing fields filled with defaults)', () => {
    const raw = JSON.stringify({ sound: true, quality: 'low' });
    const parsed = parsePreferences(raw);
    assert.strictEqual(parsed.sound, true);
    assert.strictEqual(parsed.quality, 'low');
    assert.strictEqual(parsed.fast, DEFAULT_PREFERENCES.fast);
    assert.strictEqual(parsed.reducedMotion, DEFAULT_PREFERENCES.reducedMotion);
    assert.strictEqual(parsed.largeText, DEFAULT_PREFERENCES.largeText);
    assert.strictEqual(parsed.confirmDeal, DEFAULT_PREFERENCES.confirmDeal);
  });

  it('1.5 枚举值越界/非法类型安全回退 (Invalid enum or type falls back safely)', () => {
    const raw = JSON.stringify({
      quality: 'ultra_4k', // invalid enum
      sound: 'yes', // should be boolean
      fast: 1, // should be boolean
      reducedMotion: 'sometimes', // invalid enum
      largeText: null, // invalid type
      confirmDeal: 'confirm', // should be boolean
    });
    const parsed = parsePreferences(raw);
    assert.strictEqual(parsed.quality, 'auto');
    assert.strictEqual(parsed.sound, false);
    assert.strictEqual(parsed.fast, false);
    assert.strictEqual(parsed.reducedMotion, 'system');
    assert.strictEqual(parsed.largeText, false);
    assert.strictEqual(parsed.confirmDeal, false);
  });

  it('1.6 有效偏好配置完整保真解析 (Valid preferences parsed faithfully)', () => {
    const valid: Preferences = {
      language: 'zh-CN',
      quality: 'standard',
      sound: true,
      fast: true,
      reducedMotion: 'on',
      largeText: true,
      confirmDeal: true,
      haptics: true,
      flashing: true,
      depthEffects: true,
      screenShake: true,
      highContrast: false,
      colorSafe: false,
    };
    const parsed = parsePreferences(JSON.stringify(valid));
    assert.deepStrictEqual(parsed, valid);
  });

  it('1.7 Storage 不可用或抛出异常时回退默认 (Storage restricted/exception fallback)', () => {
    const originalWindow = (globalThis as any).window;
    // Mock window with throwing localStorage
    (globalThis as any).window = {
      localStorage: {
        getItem: () => {
          throw new Error('SecurityError: The operation is insecure.');
        },
        setItem: () => {
          throw new Error('SecurityError: QuotaExceededError');
        },
      },
    };

    try {
      const loaded = loadPreferences();
      assert.deepStrictEqual(loaded, DEFAULT_PREFERENCES);
      // savePreferences shouldn't throw
      assert.doesNotThrow(() => savePreferences(DEFAULT_PREFERENCES));
    } finally {
      (globalThis as any).window = originalWindow;
    }
  });
});

describe('2. Reduced Motion Resolution Tests', () => {
  it('2.1 当配置为 on 时强制开启，忽略系统设定 (on overrides system)', () => {
    assert.strictEqual(resolveReducedMotion('on', false), true);
    assert.strictEqual(resolveReducedMotion('on', true), true);
  });

  it('2.2 当配置为 off 时强制关闭，忽略系统设定 (off overrides system)', () => {
    assert.strictEqual(resolveReducedMotion('off', false), false);
    assert.strictEqual(resolveReducedMotion('off', true), false);
  });

  it('2.3 当配置为 system 时严格遵循系统媒体查询 (system follows prefers-reduced-motion)', () => {
    assert.strictEqual(resolveReducedMotion('system', true), true);
    assert.strictEqual(resolveReducedMotion('system', false), false);
  });
});

describe('3. Auto Quality Conservative Initial Selection & Degradation Tests', () => {
  it('3.1 保守初选：省流量模式 (saveData) 强制初始 low', () => {
    const q = detectInitialQuality({ saveData: true, deviceMemory: 8, hardwareConcurrency: 8 });
    assert.strictEqual(q, 'low');
  });

  it('3.2 保守初选：内存低于 4GB 初始 low', () => {
    const q = detectInitialQuality({ saveData: false, deviceMemory: 2, hardwareConcurrency: 8 });
    assert.strictEqual(q, 'low');
  });

  it('3.3 保守初选：CPU 核心低于 4 核初始 low', () => {
    const q = detectInitialQuality({ saveData: false, deviceMemory: 8, hardwareConcurrency: 2 });
    assert.strictEqual(q, 'low');
  });

  it('3.4 保守初选：规格充足时初始 standard', () => {
    const q = detectInitialQuality({ saveData: false, deviceMemory: 8, hardwareConcurrency: 8 });
    assert.strictEqual(q, 'standard');
  });

  it('3.5 连续 2 个 5 秒窗口 FPS < 30 触发降级到 low', () => {
    const evaluator = new AutoQualityEvaluator('standard');
    assert.strictEqual(evaluator.getQuality(), 'standard');

    // Window 1: fps = 25 (< 30) -> remains standard
    const q1 = evaluator.recordWindowFps(25);
    assert.strictEqual(q1, 'standard');

    // Window 2: fps = 28 (< 30) -> downgrades to low
    const q2 = evaluator.recordWindowFps(28);
    assert.strictEqual(q2, 'low');
    assert.strictEqual(evaluator.getQuality(), 'low');

    // Subsequent high fps does not bounce back
    const q3 = evaluator.recordWindowFps(60);
    assert.strictEqual(q3, 'low');
  });

  it('3.6 单一窗口掉帧后恢复不触发降级 (Single low window followed by healthy fps resets counter)', () => {
    const evaluator = new AutoQualityEvaluator('standard');

    // Window 1: fps = 20 (< 30)
    evaluator.recordWindowFps(20);
    assert.strictEqual(evaluator.getQuality(), 'standard');

    // Window 2: fps = 55 (healthy >= 30) -> counter resets
    evaluator.recordWindowFps(55);
    assert.strictEqual(evaluator.getQuality(), 'standard');

    // Window 3: fps = 22 (< 30) -> only 1 consecutive, not yet low
    evaluator.recordWindowFps(22);
    assert.strictEqual(evaluator.getQuality(), 'standard');
  });
});

describe('4. Performance Sampling & Percentiles Calculation Tests', () => {
  it('4.1 百分位数计算 (calculatePercentile p50 and p95)', () => {
    const values = [10, 20, 30, 40, 50];
    const p50 = calculatePercentile(values, 50);
    assert.strictEqual(p50, 30);

    // Empty array returns 0
    assert.strictEqual(calculatePercentile([], 50), 0);
    // Single element returns that element
    assert.strictEqual(calculatePercentile([16.6], 95), 16.6);
  });

  it('4.2 采样限制在 ≤ 300 样本 (Window capped at maxSamples)', () => {
    const sampler = new PerformanceSampler(300);
    sampler.start();

    for (let i = 0; i < 350; i++) {
      sampler.recordFrame(0.016, false, false);
    }

    const stats = sampler.getStats();
    assert.strictEqual(stats.sampleCount, 300);
    assert.strictEqual(stats.maxSamples, 300);
  });

  it('4.3 排除后台与加载期，但保留真实前台卡顿', () => {
    const sampler = new PerformanceSampler(300);
    sampler.start();

    // Normal foreground frame: recorded
    sampler.recordFrame(0.016, false, false);
    assert.strictEqual(sampler.getStats().sampleCount, 1);

    // Hidden in background: ignored
    sampler.recordFrame(0.016, true, false);
    assert.strictEqual(sampler.getStats().sampleCount, 1);

    // Asset loading: ignored
    sampler.recordFrame(0.016, false, true);
    assert.strictEqual(sampler.getStats().sampleCount, 1);

    // A foreground stall must remain in the baseline.
    sampler.recordFrame(0.35, false, false);
    assert.strictEqual(sampler.getStats().sampleCount, 2);
    assert.strictEqual(sampler.getStats().fluctuation?.maxFrameTimeMs, 350);

    // Stopped: ignored
    sampler.stop();
    sampler.recordFrame(0.016, false, false);
    assert.strictEqual(sampler.getStats().sampleCount, 2);
  });

  it('4.4 场景与画质切换时分段清空重采样 (updateContext segments samples)', () => {
    const sampler = new PerformanceSampler(300);
    sampler.start();
    sampler.updateContext('OPEN_BOXES', 'standard');
    sampler.recordFrame(0.016, false, false);
    sampler.recordFrame(0.017, false, false);
    assert.strictEqual(sampler.getStats().sampleCount, 2);
    assert.strictEqual(sampler.getStats().phase, 'OPEN_BOXES');
    assert.strictEqual(sampler.getStats().quality, 'standard');

    // Transition to BANKER_OFFER resets samples for new scenario segment
    sampler.updateContext('BANKER_OFFER', 'standard');
    assert.strictEqual(sampler.getStats().sampleCount, 0);
    assert.strictEqual(sampler.getStats().phase, 'BANKER_OFFER');

    // Transition to low quality resets samples
    sampler.recordFrame(0.016, false, false);
    assert.strictEqual(sampler.getStats().sampleCount, 1);
    sampler.updateContext('BANKER_OFFER', 'low');
    assert.strictEqual(sampler.getStats().sampleCount, 0);
    assert.strictEqual(sampler.getStats().quality, 'low');
  });

  it('4.5 波动范围摘要计算正确 (Fluctuation summary computes min, max, avg, p50, p95)', () => {
    const sampler = new PerformanceSampler(300);
    sampler.start();
    sampler.recordFrame(0.010, false, false); // 10ms
    sampler.recordFrame(0.020, false, false); // 20ms
    sampler.recordFrame(0.030, false, false); // 30ms

    const stats = sampler.getStats();
    assert.ok(stats.fluctuation);
    assert.strictEqual(stats.fluctuation.minFrameTimeMs, 10);
    assert.strictEqual(stats.fluctuation.maxFrameTimeMs, 30);
    assert.strictEqual(stats.fluctuation.avgFrameTimeMs, 20);
    assert.strictEqual(stats.fluctuation.p50FrameTimeMs, 20);
    assert.strictEqual(stats.fluctuation.p95FrameTimeMs, 29);
  });

  it('4.6 WebGL 真实数据与加载耗时保存及安全导出 (WebGL stats, load duration and safe snapshot export)', () => {
    const sampler = new PerformanceSampler(300);
    sampler.start();
    sampler.updateContext('OPEN_BOXES', 'standard', 'auto');
    sampler.recordFrame(0.0166, false, false);
    sampler.setLoadDuration(154);
    sampler.setWebGLStats({ calls: 18, triangles: 3600, textures: 5 });

    assert.strictEqual(sampler.getLoadDuration(), 154);
    assert.deepStrictEqual(sampler.getWebGLStats(), { calls: 18, triangles: 3600, textures: 5 });

    const snapshot = sampler.createSnapshot({
      qualityPref: 'auto',
      effectiveQuality: 'standard',
      phase: 'OPEN_BOXES',
    });

    const json = JSON.stringify(snapshot);
    // Verify structure & genuine stats
    assert.strictEqual(snapshot.quality.preference, 'auto');
    assert.strictEqual(snapshot.quality.effective, 'standard');
    assert.strictEqual(snapshot.phase, 'OPEN_BOXES');
    assert.ok(snapshot.webgl);
    assert.strictEqual(snapshot.webgl.calls, 18);
    assert.strictEqual(snapshot.webgl.triangles, 3600);
    assert.strictEqual(snapshot.webgl.textures, 5);
    assert.strictEqual(snapshot.loadDurationMs, 154);
    assert.strictEqual(snapshot.samples.length, 1);
    assert.strictEqual(snapshot.samples[0].phase, 'OPEN_BOXES');
    assert.strictEqual(snapshot.samples[0].quality, 'standard');
    // Guarantees no sensitive tokens
    assert(!json.includes('token'));
    assert(!json.includes('secret'));
    assert(!json.includes('ws://'));
  });
});

describe('5. Deal Confirmation Offer Binding Safety Tests (validateDealAcceptance)', () => {
  const baseOffer = { offerId: 'off_001', amount: 80000 };

  it('5.1 报价与 offerId 一致、阶段正确时确认成功 (Matching offerId, amount, and phase valid)', () => {
    const res = validateDealAcceptance({
      confirmingOffer: baseOffer,
      currentOfferId: 'off_001',
      currentOfferAmount: 80000,
      currentPhase: 'BANKER_OFFER',
    });
    assert.strictEqual(res.valid, true);
    assert.strictEqual(res.reason, undefined);
  });

  it('5.2 isPending 为 true 时禁止重复提交确认 (Pending state rejects acceptance)', () => {
    const res = validateDealAcceptance({
      confirmingOffer: baseOffer,
      currentOfferId: 'off_001',
      currentOfferAmount: 80000,
      currentPhase: 'BANKER_OFFER',
      isPending: true,
    });
    assert.strictEqual(res.valid, false);
    assert.strictEqual(res.reason, 'PENDING');
  });

  it('5.3 阶段非 BANKER_OFFER 时拒绝确认 (Phase changed cancels confirmation)', () => {
    const res = validateDealAcceptance({
      confirmingOffer: baseOffer,
      currentOfferId: 'off_001',
      currentOfferAmount: 80000,
      currentPhase: 'OPEN_BOXES',
    });
    assert.strictEqual(res.valid, false);
    assert.strictEqual(res.reason, 'PHASE_MISMATCH');
  });

  it('5.4 缺少待确认报价或 offerId 为空时拒绝 (No confirming offer or empty ID)', () => {
    const resNull = validateDealAcceptance({
      confirmingOffer: null,
      currentOfferId: 'off_001',
      currentOfferAmount: 80000,
      currentPhase: 'BANKER_OFFER',
    });
    assert.strictEqual(resNull.valid, false);
    assert.strictEqual(resNull.reason, 'NO_OFFER');

    const resEmpty = validateDealAcceptance({
      confirmingOffer: { offerId: '   ', amount: 80000 },
      currentOfferId: 'off_001',
      currentOfferAmount: 80000,
      currentPhase: 'BANKER_OFFER',
    });
    assert.strictEqual(resEmpty.valid, false);
    assert.strictEqual(resEmpty.reason, 'NO_OFFER');
  });

  it('5.5 报价更新或 offerId 不匹配时作废确认 (Outdated offerId aborted)', () => {
    const res = validateDealAcceptance({
      confirmingOffer: baseOffer,
      currentOfferId: 'off_002', // server offer advanced
      currentOfferAmount: 80000,
      currentPhase: 'BANKER_OFFER',
    });
    assert.strictEqual(res.valid, false);
    assert.strictEqual(res.reason, 'ID_MISMATCH');
  });

  it('5.6 金额不匹配或非法时拒绝 (Amount mismatch or non-positive aborted)', () => {
    const resMismatch = validateDealAcceptance({
      confirmingOffer: baseOffer,
      currentOfferId: 'off_001',
      currentOfferAmount: 95000, // amount changed
      currentPhase: 'BANKER_OFFER',
    });
    assert.strictEqual(resMismatch.valid, false);
    assert.strictEqual(resMismatch.reason, 'AMOUNT_MISMATCH');

    const resNegative = validateDealAcceptance({
      confirmingOffer: baseOffer,
      currentOfferId: 'off_001',
      currentOfferAmount: -100,
      currentPhase: 'BANKER_OFFER',
    });
    assert.strictEqual(resNegative.valid, false);
    assert.strictEqual(resNegative.reason, 'AMOUNT_MISMATCH');
  });

  it('5.7 倒计时已超时拒绝，未超时允许 (Deadline expiration validation)', () => {
    const deadline = 1700000030000;

    // Expired
    const resExpired = validateDealAcceptance({
      confirmingOffer: baseOffer,
      currentOfferId: 'off_001',
      currentOfferAmount: 80000,
      currentPhase: 'BANKER_OFFER',
      deadlineTimestamp: deadline,
      serverNow: deadline + 1000,
    });
    assert.strictEqual(resExpired.valid, false);
    assert.strictEqual(resExpired.reason, 'EXPIRED');

    // Not expired
    const resActive = validateDealAcceptance({
      confirmingOffer: baseOffer,
      currentOfferId: 'off_001',
      currentOfferAmount: 80000,
      currentPhase: 'BANKER_OFFER',
      deadlineTimestamp: deadline,
      serverNow: deadline - 1000,
    });
    assert.strictEqual(resActive.valid, true);
  });
});
