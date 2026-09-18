import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { isRequestOriginAllowed } from '../../src/http/security';

function createMockReq(options: {
  host?: string;
  forwardedHost?: string;
  referer?: string;
  secFetchSite?: string;
}): http.IncomingMessage {
  const headers: Record<string, string> = {};
  if (options.host !== undefined) headers['host'] = options.host;
  if (options.forwardedHost !== undefined) headers['x-forwarded-host'] = options.forwardedHost;
  if (options.referer !== undefined) headers['referer'] = options.referer;
  if (options.secFetchSite !== undefined) headers['sec-fetch-site'] = options.secFetchSite;

  return { headers } as unknown as http.IncomingMessage;
}

describe('isRequestOriginAllowed - Origin and Same-Origin Security', () => {
  const allowedOrigins = new Set<string>([
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'https://game.example.com'
  ]);

  test('allows origin explicitly in allowedOrigins', () => {
    const req = createMockReq({ host: 'something-else.com' });
    assert.equal(isRequestOriginAllowed('https://game.example.com', req, allowedOrigins), true);
    assert.equal(isRequestOriginAllowed('https://game.example.com/', req, allowedOrigins), true);
  });

  test('allows same-origin matching host header even if not in allowedOrigins', () => {
    const req1 = createMockReq({ host: 'mycustomdomain.com' });
    assert.equal(isRequestOriginAllowed('https://mycustomdomain.com', req1, allowedOrigins), true);
    assert.equal(isRequestOriginAllowed('http://mycustomdomain.com', req1, allowedOrigins), true);

    const req2 = createMockReq({ host: '192.168.1.100:3000' });
    assert.equal(isRequestOriginAllowed('http://192.168.1.100:3000', req2, allowedOrigins), true);
  });

  test('allows same-origin matching x-forwarded-host header behind reverse proxy', () => {
    const req = createMockReq({ host: 'internal-service:2567', forwardedHost: 'game.production.net' });
    assert.equal(isRequestOriginAllowed('https://game.production.net', req, allowedOrigins), true);
  });

  test('allows same-origin matching host ignoring default port 80/443', () => {
    const req1 = createMockReq({ host: 'game.production.net:443' });
    assert.equal(isRequestOriginAllowed('https://game.production.net', req1, allowedOrigins), true);

    const req2 = createMockReq({ host: 'game.production.net:80' });
    assert.equal(isRequestOriginAllowed('http://game.production.net', req2, allowedOrigins), true);
  });

  test('rejects cross-origin request not in allowedOrigins and not matching host', () => {
    const req = createMockReq({ host: 'mycustomdomain.com' });
    assert.equal(isRequestOriginAllowed('https://evil-attacker.com', req, allowedOrigins), false);
    assert.equal(isRequestOriginAllowed('http://subdomain.mycustomdomain.com', req, allowedOrigins), false);
  });

  test('when origin is missing, allows if referer is same-origin or in allowedOrigins', () => {
    const req1 = createMockReq({ host: 'mycustomdomain.com', referer: 'https://mycustomdomain.com/lobby' });
    assert.equal(isRequestOriginAllowed(undefined, req1, allowedOrigins), true);

    const req2 = createMockReq({ host: 'other.com', referer: 'https://game.example.com/play' });
    assert.equal(isRequestOriginAllowed(undefined, req2, allowedOrigins), true);

    const req3 = createMockReq({ host: 'mycustomdomain.com', referer: 'https://evil.com/phishing' });
    assert.equal(isRequestOriginAllowed(undefined, req3, allowedOrigins), false);
  });

  test('when origin is missing, allows if sec-fetch-site is same-origin', () => {
    const req = createMockReq({ host: 'mycustomdomain.com', secFetchSite: 'same-origin' });
    assert.equal(isRequestOriginAllowed(undefined, req, allowedOrigins), true);
  });

  test('when origin is missing without referer or sec-fetch-site, strictly rejects', () => {
    const req = createMockReq({ host: 'mycustomdomain.com' });
    assert.equal(isRequestOriginAllowed(undefined, req, allowedOrigins), false);
  });
});
