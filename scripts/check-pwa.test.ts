import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { parseSharePath, isPublicShare, publicShareFields } from '../src/api/share';

function worker() {
  const handlers: Record<string, (event: any) => void> = {};
  const stored = new Map<string, Response>();
  const deleted: string[] = [];
  let waited = 0;
  let offline = false;
  let privateResponse = false;
  const cache = { addAll: async (urls: string[]) => { for (const url of urls) stored.set(url, new Response('shell')); },
    match: async (request: any) => stored.get(typeof request === 'string' ? request : new URL(request.url).pathname),
    put: async (request: any, response: Response) => { stored.set(new URL(request.url).pathname, response); } };
  const config = { version: 'test', precache: ['/index.html'], staticFiles: ['/index.html', '/assets/App-hash.js'], runtimeFiles: ['/assets/current.glb'] };
  vm.runInNewContext(fs.readFileSync('scripts/sw-template.js', 'utf8').replace('__BF_CONFIG__', JSON.stringify(config)), {
    self: { location: { origin: 'https://game.test' }, clients: { claim: async () => {} },
      skipWaiting: () => { waited++; }, addEventListener: (name: string, callback: any) => { handlers[name] = callback; } },
    caches: { open: async () => cache, keys: async () => ['bubble-fortune-v2-old', 'other-app-cache', 'bubble-fortune-v2-test'],
      delete: async (key: string) => { deleted.push(key); } },
    URL, Set,
    fetch: async () => {
      if (offline) throw new Error('offline');
      const response = new Response('resource', { headers: { 'cache-control': privateResponse ? 'private, no-store' : 'public' } });
      Object.defineProperty(response, 'type', { value: 'basic' }); return response;
    },
  });
  const lifecycle = async (name: string) => { let promise: Promise<unknown> | undefined; handlers[name]({ waitUntil: (p: any) => { promise = p; } }); await promise; };
  const request = (path: string, patch = {}) => {
    let response: Promise<Response> | undefined;
    handlers.fetch({ request: { url: new URL(path, 'https://game.test').href, method: 'GET', mode: 'cors', headers: new Headers(), ...patch },
      respondWith: (promise: Promise<Response>) => { response = promise; } });
    return response;
  };
  return { handlers, stored, deleted, request, lifecycle, get waited() { return waited; },
    setOffline: () => { offline = true; }, setPrivate: () => { privateResponse = true; } };
}

test('SW 从不接管 API、游戏协议、POST、跨源及 Authorization 请求', () => {
  const sw = worker();
  for (const path of ['/api/guest', '/api/history', '/api/share/public', '/game/matchmake', 'https://external.test/assets/App-hash.js']) {
    assert.equal(sw.request(path), undefined);
  }
  assert.equal(sw.request('/assets/App-hash.js', { method: 'POST' }), undefined);
  assert.equal(sw.request('/assets/App-hash.js', { headers: new Headers({ Authorization: 'test' }) }), undefined);
});

test('SW 只缓存明确静态资源，private/no-store 与历史模型不缓存', async () => {
  const sw = worker();
  await sw.request('/assets/current.glb'); assert.equal(sw.stored.has('/assets/current.glb'), true);
  assert.equal(sw.request('/assets/historical.glb'), undefined);
  assert.equal(sw.request('/assets/App-hash.js?token=secret'), undefined);
  sw.setPrivate(); await sw.request('/assets/App-hash.js'); assert.equal(sw.stored.has('/assets/App-hash.js'), false);
});

test('离线导航只返回静态应用壳，激活只清自己的旧缓存，更新需明确消息', async () => {
  const sw = worker();
  await sw.lifecycle('install'); sw.setOffline();
  assert.equal(await (await sw.request('/share/abcdefghijklmnop', { mode: 'navigate' }))?.text(), 'shell');
  await sw.lifecycle('activate'); assert.deepEqual(sw.deleted, ['bubble-fortune-v2-old']);
  assert.equal(sw.waited, 0); sw.handlers.message({ data: { type: 'SKIP_WAITING' } }); assert.equal(sw.waited, 1);
});

test('分享路径严格、公开摘要白名单不包含凭据和私人事件', () => {
  const id = 'abcdefghijklmnop';
  assert.equal(parseSharePath('/share/' + id), id);
  for (const value of ['/share/a', '/share/../api/guest', '/share/' + id + '/extra', '//other.test/share/' + id]) assert.equal(parseSharePath(value), null);
  const data = { mode: 'classic-26-v1', aiType: 'cold' as const, wonAmount: 1000000,
    originalPlayerBoxId: 1, finalPlayerBoxId: 26, outcomeType: 'FINAL_SWAP' as const,
    guestId: 'private', token: 'private', auditTrail: ['private'] };
  assert.equal(isPublicShare(data), true);
  assert.equal(isPublicShare({ ...data, wonAmount: NaN }), false);
  assert.equal(isPublicShare({ ...data, finalPlayerBoxId: 27 }), false);
  assert.equal(JSON.stringify(publicShareFields(data)).includes('private'), false);
});

test('生产 manifest、PNG 尺寸与缓存清单均指向实际产物', () => {
  const manifest = JSON.parse(fs.readFileSync('dist/manifest.webmanifest', 'utf8'));
  assert.equal(manifest.display, 'standalone');
  for (const size of [192, 512]) {
    const png = fs.readFileSync(`dist/icons/icon-${size}.png`);
    assert.equal(png.readUInt32BE(16), size); assert.equal(png.readUInt32BE(20), size);
  }
  const config = JSON.parse(fs.readFileSync('dist/pwa-build.json', 'utf8'));
  for (const file of [...config.precache, ...config.runtimeFiles]) assert.equal(fs.existsSync('dist' + file), true, file);
  assert.equal(config.precache.some((file: string) => /Stage3D|\.glb|^\/api|^\/game\//.test(file)), false);
  assert.equal(config.runtimeFiles.filter((file: string) => file.endsWith('.glb')).length, 3);
});
