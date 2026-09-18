import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from '../apps/game-server/src/engine/GameEngine';
import { FakeClock } from '../apps/game-server/src/engine/clock';
import { FAIRNESS_STORAGE_KEY, pinInitialCommitment, verifyGameFairness } from '../src/utils/fairnessStorage';
import { requireGuestSession, isCompletedGameRecord, isHistoryListResponse } from '../src/api/history';
import { PerformanceSampler } from '../src/utils/performance';
import { describeAuditEvent } from '../src/utils/auditTimeline';

const originalWindow = globalThis.window;
const originalFetch = globalThis.fetch;
let storage: Map<string, string>;
beforeEach(() => {
  storage = new Map();
  (globalThis as any).window = { innerWidth: 360, innerHeight: 800, devicePixelRatio: 2,
    localStorage: { getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value) } };
});
afterEach(() => { (globalThis as any).window = originalWindow; globalThis.fetch = originalFetch; });

function completedGame(gameId = 'review-game', pin = true) {
  const clock = new FakeClock();
  const engine = new GameEngine({ gameId, clock });
  if (pin) pinInitialCommitment(engine.getPublicSnapshot());
  for (let step = 0; step < 50 && !engine.isFinished(); step++) clock.advanceToNext();
  assert.equal(engine.isFinished(), true);
  const record = engine.getCompletedRecord()!;
  engine.dispose();
  return record;
}

test('真实引擎终局证明与本机见证通过；无见证只能自洽', async () => {
  const record = completedGame();
  assert.equal((await verifyGameFairness(record)).status, 'VERIFIED');
  storage.clear();
  assert.equal((await verifyGameFairness(record)).status, 'SELF_CONSISTENT');
  assert.equal(pinInitialCommitment({ ...new GameEngine({ clock: new FakeClock() }).getPublicSnapshot(),
    gameId: record.gameId, phase: 'FINISHED' }), false);
});

test('坏 pin 与被禁止的 localStorage 不能升级为完整通过', async () => {
  const record = completedGame();
  storage.set(FAIRNESS_STORAGE_KEY, JSON.stringify({ [record.gameId]: {} }));
  assert.equal((await verifyGameFairness(record)).status, 'SELF_CONSISTENT');
  Object.defineProperty(window, 'localStorage', { get() { throw new Error('SecurityError'); } });
  assert.equal((await verifyGameFairness(record)).status, 'SELF_CONSISTENT');
});

test('不同真实对局事件链、缺失事件与错误规则版本均不能通过', async () => {
  const a = completedGame('a');
  const b = completedGame('b');
  const mixed = structuredClone(a);
  mixed.auditTrail = b.auditTrail;
  mixed.settlement.auditTrail = b.auditTrail;
  assert.equal((await verifyGameFairness(mixed)).error, 'AUDIT_RECORD_MISMATCH');
  mixed.auditTrail = []; mixed.settlement.auditTrail = [];
  assert.equal((await verifyGameFairness(mixed)).error, 'AUDIT_TRAIL_MISSING');
  assert.equal((await verifyGameFairness({ ...a, ruleVersion: 'wrong' })).error, 'RULE_VERSION_MISMATCH');
});

test('真实终局与列表 DTO 通过，缺失结算字段被拒绝', () => {
  const record = completedGame();
  assert.equal(isCompletedGameRecord(record), true);
  assert.equal(isCompletedGameRecord({ ...record, settlement: {} }), false);
  assert.equal(isHistoryListResponse({ items: [{ ...record, ...record.settlement }], limit: 10, offset: 0, total: 1 }), true);
  assert.equal(isHistoryListResponse({ items: [], limit: 10, offset: -1, total: 0 }), false);
  assert.ok(record.auditTrail.some(event => describeAuditEvent(event).includes('超时自动处理')));
});

test('认证故障、坏响应、POST 未认证均阻断创建操作', async () => {
  for (const responses of [
    [new Response('{}', { status: 503 })],
    [new Response('{}')],
    [new Response(JSON.stringify({ enabled: false, available: true, authenticated: false }))],
    [new Response(JSON.stringify({ enabled: true, available: true, authenticated: false })), new Response('{}')],
  ]) {
    let created = 0;
    globalThis.fetch = async () => responses.shift()!;
    await assert.rejects(async () => { await requireGuestSession(); created++; });
    assert.equal(created, 0);
  }
});

test('明确未启用数据库可游戏，正常游客按 GET/POST 完成身份', async () => {
  const calls: string[] = [];
  globalThis.fetch = async (_url, init) => {
    calls.push(init?.method || 'GET');
    return Response.json({ enabled: false, available: false, authenticated: false });
  };
  await requireGuestSession();
  assert.deepEqual(calls, ['GET']);
  calls.length = 0;
  globalThis.fetch = async (_url, init) => {
    calls.push(init?.method || 'GET');
    return Response.json({ enabled: true, available: true, authenticated: init?.method === 'POST' });
  };
  await requireGuestSession();
  assert.deepEqual(calls, ['GET', 'POST']);
});

test('停止采样后，阶段、尺寸、画质偏好、GL 与加载时间冻结；重新开始捕获当前上下文', () => {
  const sampler = new PerformanceSampler();
  sampler.updateContext('OPEN_BOXES', 'standard', 'auto');
  sampler.start(); sampler.recordFrame(0.02);
  sampler.setWebGLStats({ calls: 5, triangles: 10, textures: 1 }); sampler.setLoadDuration(123);
  sampler.stop();
  (window as any).innerWidth = 1280;
  sampler.updateContext('GAME_OVER', 'low', 'low');
  sampler.setWebGLStats({ calls: 99, triangles: 99, textures: 99 }); sampler.setLoadDuration(999);
  const snapshot = sampler.createSnapshot({ qualityPref: 'low', effectiveQuality: 'low', phase: 'GAME_OVER' });
  assert.equal(snapshot.phase, 'OPEN_BOXES'); assert.equal(snapshot.viewport.width, 360);
  assert.equal(snapshot.quality.preference, 'auto'); assert.equal(snapshot.webgl?.calls, 5);
  assert.equal(snapshot.loadDurationMs, 123); assert.equal(snapshot.samples.length, 1);
  sampler.start(); sampler.recordFrame(0.03);
  assert.equal(sampler.getStats().phase, 'GAME_OVER');
  assert.equal(sampler.createSnapshot({ qualityPref: '', effectiveQuality: '', phase: '' }).viewport.width, 1280);
});

test('采样中旋转分段，保留前台长帧', () => {
  const sampler = new PerformanceSampler();
  sampler.start(); sampler.updateContext('OPEN_BOXES', 'low'); sampler.recordFrame(0.02);
  (window as any).innerWidth = 800;
  sampler.recordFrame(0.4);
  const stats = sampler.getStats();
  assert.equal(stats.sampleCount, 1); assert.equal(stats.p95FrameTimeMs, 400);
});
