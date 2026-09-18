import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { Client as ColyseusClient } from 'colyseus.js';
import { createAppServer } from '../../src/server';
import { DatabaseManager } from '../../src/persistence/db';
import { OutboxManager, OutboxItem, SingleOutboxItem } from '../../src/persistence/outbox';
import { parseCookies, GUEST_COOKIE_MAX_AGE_SECONDS } from '../../src/http/cookies';
import { GameEngine } from '../../src/engine/GameEngine';
import {
  CompletedGameRecord,
  HistoryListResponse,
  PublicShareSummary,
  ShareResponse,
  GuestAuthStatus,
  PublicSnapshot,
  CommandResult
} from '../../../../packages/protocol/src/types';
// @ts-ignore
import { getOrGenerateDbPassword } from '../../../../scripts/database.mjs';

const DATABASE_URL = process.env.DATABASE_URL;

function createConsistentGameRecord(ownerId: string): SingleOutboxItem {
  const engine = new GameEngine({ aiType: 'conservative' });
  engine.processCommand({
    type: 'SELECT_BOX',
    boxId: 1,
    gameId: engine.gameId,
    stateVersion: 1,
    commandSequence: 1,
    idempotencyKey: 'fx_sel_' + crypto.randomUUID()
  });
  let curVer = 2;
  let lastRes: any;
  for (let b = 2; b <= 7; b++) {
    lastRes = engine.processCommand({
      type: 'OPEN_BOX',
      boxId: b,
      gameId: engine.gameId,
      stateVersion: curVer,
      commandSequence: b,
      idempotencyKey: `fx_open_${b}_${crypto.randomUUID()}`
    });
    curVer = lastRes.stateVersion;
  }
  const offer = lastRes.snapshot?.currentOffer;
  engine.processCommand({
    type: 'ACCEPT_OFFER',
    offerId: offer.offerId,
    gameId: engine.gameId,
    stateVersion: curVer,
    commandSequence: 8,
    idempotencyKey: 'fx_acc_' + crypto.randomUUID()
  });

  const record = engine.getCompletedRecord()!;
  return {
    kind: 'single',
    resultId: record.settlement.resultId,
    ownerId,
    gameId: record.gameId,
    completedAt: record.completedAt,
    ruleVersion: record.ruleVersion,
    aiType: record.aiType,
    aiStrategyVersion: record.aiStrategyVersion,
    record
  };
}

describe('PostgreSQL Guest Auth, History & Share Integration Tests', { skip: !DATABASE_URL && 'DATABASE_URL not set' }, () => {
  const schemaName = 'test_schema_' + crypto.randomUUID().replace(/-/g, '_');
  const tempOutboxDir = path.join(os.tmpdir(), 'bf_test_outbox_' + crypto.randomUUID());

  let app: ReturnType<typeof createAppServer>;
  let port: number;
  let baseUrl: string;
  let wsUrl: string;

  before(async () => {
    app = createAppServer({
      databaseUrl: DATABASE_URL,
      schema: schemaName,
      outboxDir: tempOutboxDir,
      publicOrigins: ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://test-client.local:3000']
    });

    port = await app.listen(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${port}`;
    wsUrl = `ws://127.0.0.1:${port}`;
  });

  after(async () => {
    if (app) {
      // Drop test schema BEFORE closing pool so dropSchema is executed successfully
      if (app.persistence) {
        try {
          await app.persistence.dropSchema();
        } catch (e) {
          console.error('Failed to drop test schema:', e);
        }
      }
      await app.close();
    }
    // Clean up temporary outbox directory with resolved root + prefix verification
    try {
      const resolved = path.resolve(tempOutboxDir);
      const expectedPrefix = path.resolve(os.tmpdir());
      if (resolved.startsWith(expectedPrefix) && resolved.includes('bf_test_outbox_')) {
        fs.rmSync(resolved, { recursive: true, force: true });
      }
    } catch {}
  });

  // Helper for HTTP requests
  async function makeRequest(
    method: string,
    reqPath: string,
    options: {
      headers?: Record<string, string>;
      body?: any;
    } = {}
  ): Promise<{ status: number; headers: http.IncomingHttpHeaders; data: any; rawText: string }> {
    return new Promise((resolve, reject) => {
      const parsed = new URL(reqPath, baseUrl);
      const reqHeaders: Record<string, string> = {
        ...(options.headers || {})
      };

      let bodyStr: string | undefined;
      if (options.body !== undefined) {
        bodyStr = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
        if (!reqHeaders['Content-Type']) {
          reqHeaders['Content-Type'] = 'application/json';
        }
        reqHeaders['Content-Length'] = String(Buffer.byteLength(bodyStr));
      }

      const req = http.request(
        parsed,
        {
          method,
          headers: reqHeaders
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            const rawText = Buffer.concat(chunks).toString('utf8');
            let data: any;
            try {
              data = JSON.parse(rawText);
            } catch {
              data = rawText;
            }
            resolve({
              status: res.statusCode || 0,
              headers: res.headers,
              data,
              rawText
            });
          });
        }
      );

      req.on('error', reject);
      if (bodyStr) {
        req.write(bodyStr);
      }
      req.end();
    });
  }

  // Helper for Colyseus send & receive
  function sendAndExpect<T>(
    room: any,
    sendType: string,
    payload: any,
    expectType: string,
    timeoutMs = 5000
  ): Promise<T> {
    let timer: NodeJS.Timeout;
    let unsub: () => void;

    const p = new Promise<T>((resolve) => {
      unsub = room.onMessage(expectType, (msg: any) => {
        if (expectType === 'command_result' && payload && typeof payload.idempotencyKey === 'string') {
          if (msg && msg.idempotencyKey === payload.idempotencyKey) {
            if (typeof unsub === 'function') unsub();
            resolve(msg as T);
          }
        } else {
          if (typeof unsub === 'function') unsub();
          resolve(msg as T);
        }
      });
    });

    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        if (typeof unsub === 'function') unsub();
        reject(new Error(`Timed out waiting for "${expectType}"`));
      }, timeoutMs);
    });

    room.send(sendType, payload);
    return Promise.race([p, timeoutPromise]).finally(() => clearTimeout(timer));
  }

  test('Guest authentication: cookie generation, SHA-256 database hash, HttpOnly/SameSite/Path & idempotent identity', { timeout: 10000 }, async () => {
    // 1. Initial GET /api/guest with no cookie
    const getRes1 = await makeRequest('GET', '/api/guest');
    assert.equal(getRes1.status, 200);
    assert.deepEqual(getRes1.data, { enabled: true, available: true, authenticated: false });
    assert.equal(getRes1.headers['cache-control'], 'no-store');

    // 2. POST /api/guest creates new guest identity (requires Origin)
    const postRes1 = await makeRequest('POST', '/api/guest', {
      headers: { Origin: 'http://localhost:3000' }
    });
    assert.equal(postRes1.status, 200);
    assert.deepEqual(postRes1.data, { enabled: true, available: true, authenticated: true });
    assert.equal(postRes1.headers['cache-control'], 'no-store');

    // Verify Set-Cookie header contains 1-year Max-Age, HttpOnly, Path=/, SameSite=Lax
    const setCookieHeader = postRes1.headers['set-cookie'];
    assert.ok(setCookieHeader);
    const cookieStr = Array.isArray(setCookieHeader) ? setCookieHeader[0] : setCookieHeader;
    assert.ok(cookieStr.includes('bf_guest='));
    assert.ok(cookieStr.includes('HttpOnly'));
    assert.ok(cookieStr.includes('Path=/'));
    assert.ok(cookieStr.includes('SameSite=Lax'));
    assert.ok(cookieStr.includes(`Max-Age=${GUEST_COOKIE_MAX_AGE_SECONDS}`));

    const cookies = parseCookies(cookieStr);
    const rawToken = cookies['bf_guest'];
    assert.ok(rawToken && rawToken.length === 64);

    // Verify token is hashed with SHA-256 in PostgreSQL (raw token never stored)
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const guestRow = await app.persistence!.getGuestByTokenHash(tokenHash);
    assert.ok(guestRow);
    assert.equal(guestRow.token_hash, tokenHash);

    // 3. GET /api/guest with existing cookie returns authenticated: true
    const getRes2 = await makeRequest('GET', '/api/guest', {
      headers: { Cookie: `bf_guest=${rawToken}` }
    });
    assert.equal(getRes2.status, 200);
    assert.deepEqual(getRes2.data, { enabled: true, available: true, authenticated: true });

    // 4. Repeated POST /api/guest with existing cookie preserves identity and renews cookie with 1-year Max-Age
    const postRes2 = await makeRequest('POST', '/api/guest', {
      headers: {
        Cookie: `bf_guest=${rawToken}`,
        Origin: 'http://localhost:3000'
      }
    });
    assert.equal(postRes2.status, 200);
    assert.deepEqual(postRes2.data, { enabled: true, available: true, authenticated: true });
    // Raw token never returned in body
    assert.equal((postRes2.data as any).rawToken, undefined);
    assert.equal((postRes2.data as any).token, undefined);

    const renewedCookieStr = Array.isArray(postRes2.headers['set-cookie'])
      ? postRes2.headers['set-cookie'][0]
      : postRes2.headers['set-cookie'];
    assert.ok(renewedCookieStr);
    assert.ok(renewedCookieStr.includes(`bf_guest=${rawToken}`));
    assert.ok(renewedCookieStr.includes(`Max-Age=${GUEST_COOKIE_MAX_AGE_SECONDS}`));

    // Same guest ID in DB
    const guestRow2 = await app.persistence!.getGuestByTokenHash(tokenHash);
    assert.equal(guestRow2?.id, guestRow.id);
  });

  test('Security & origin verification: origin required on POST, payload limit, and safe cookie parsing', { timeout: 10000 }, async () => {
    // 1. Missing Origin on POST /api/guest strictly rejected with 403 INVALID_ORIGIN
    const noOriginRes = await makeRequest('POST', '/api/guest');
    assert.equal(noOriginRes.status, 403);
    assert.equal(noOriginRes.data?.error?.code, 'INVALID_ORIGIN');

    // 2. Disallowed cross-origin rejected with 403 INVALID_ORIGIN
    const crossRes = await makeRequest('POST', '/api/guest', {
      headers: { Origin: 'http://evil-attacker.com' }
    });
    assert.equal(crossRes.status, 403);
    assert.equal(crossRes.data?.error?.code, 'INVALID_ORIGIN');

    // 3. Payload size limit on POST /api/guest (exceeding 16KiB rejected with 413)
    const largeBody = 'x'.repeat(17 * 1024);
    const largeRes = await makeRequest('POST', '/api/guest', {
      headers: {
        Origin: 'http://localhost:3000',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ padding: largeBody })
    });
    assert.equal(largeRes.status, 413);
    assert.equal(largeRes.data?.error?.code, 'PAYLOAD_TOO_LARGE');

    // 4. Bad JSON payload on POST /api/guest rejected with 400 INVALID_PAYLOAD
    const badJsonRes = await makeRequest('POST', '/api/guest', {
      headers: {
        Origin: 'http://localhost:3000',
        'Content-Type': 'application/json'
      },
      body: '{ malformed json!'
    });
    assert.equal(badJsonRes.status, 400);
    assert.equal(badJsonRes.data?.error?.code, 'INVALID_PAYLOAD');

    // 5. Safe cookie parsing: malformed percent-encoding does not throw URIError or 500
    const malformedCookieRes = await makeRequest('GET', '/api/history', {
      headers: { Cookie: 'bf_guest=%E0%A4%A' }
    });
    assert.equal(malformedCookieRes.status, 401);
    assert.equal(malformedCookieRes.data?.error?.code, 'UNAUTHORIZED');

    // 6. Null prototype cookie parsing prevents prototype pollution
    const parsedProto = parseCookies('__proto__=polluted; key=value');
    assert.equal((Object.prototype as any).polluted, undefined);
    assert.equal(parsedProto.key, 'value');

    // 7. Invalid resultId / shareId characters rejected with 400 INVALID_ID
    const invalidIdRes = await makeRequest('GET', '/api/history/invalid%20id%20with%20spaces', {
      headers: { Cookie: 'bf_guest=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' }
    });
    assert.equal(invalidIdRes.status, 400);
    assert.equal(invalidIdRes.data?.error?.code, 'INVALID_ID');
  });

  test('Authentication required on private endpoints: 401 on missing or invalid cookie', { timeout: 10000 }, async () => {
    // 1. GET /api/history without cookie -> 401
    const noAuthHist = await makeRequest('GET', '/api/history');
    assert.equal(noAuthHist.status, 401);
    assert.equal(noAuthHist.data?.error?.code, 'UNAUTHORIZED');

    // 2. GET /api/history with fake/unknown token -> 401
    const fakeToken = crypto.randomBytes(32).toString('hex');
    const fakeAuthHist = await makeRequest('GET', '/api/history', {
      headers: { Cookie: `bf_guest=${fakeToken}` }
    });
    assert.equal(fakeAuthHist.status, 401);
    assert.equal(fakeAuthHist.data?.error?.code, 'UNAUTHORIZED');

    // 3. GET /api/history/:resultId without cookie -> 401
    const noAuthDetail = await makeRequest('GET', '/api/history/res_test_123');
    assert.equal(noAuthDetail.status, 401);
    assert.equal(noAuthDetail.data?.error?.code, 'UNAUTHORIZED');

    // 4. POST /api/history/:resultId/share without cookie -> 401
    const noAuthShare = await makeRequest('POST', '/api/history/res_test_123/share', {
      headers: { Origin: 'http://localhost:3000' }
    });
    assert.equal(noAuthShare.status, 401);
    assert.equal(noAuthShare.data?.error?.code, 'UNAUTHORIZED');
  });

  test('Guest isolation, gameplay persistence, deduplication assertions, and privacy', { timeout: 15000 }, async () => {
    // Create Guest A
    const resA = await makeRequest('POST', '/api/guest', {
      headers: { Origin: 'http://localhost:3000' }
    });
    const cookieA = parseCookies(Array.isArray(resA.headers['set-cookie']) ? resA.headers['set-cookie'][0] : resA.headers['set-cookie'])['bf_guest'];
    const tokenHashA = crypto.createHash('sha256').update(cookieA).digest('hex');
    const guestA = await app.persistence!.getGuestByTokenHash(tokenHashA);
    assert.ok(guestA);

    // Create Guest B
    const resB = await makeRequest('POST', '/api/guest', {
      headers: { Origin: 'http://localhost:3000' }
    });
    const cookieB = parseCookies(Array.isArray(resB.headers['set-cookie']) ? resB.headers['set-cookie'][0] : resB.headers['set-cookie'])['bf_guest'];
    const tokenHashB = crypto.createHash('sha256').update(cookieB).digest('hex');
    const guestB = await app.persistence!.getGuestByTokenHash(tokenHashB);
    assert.ok(guestB);

    assert.notEqual(cookieA, cookieB);

    // Guest A plays a complete game over Colyseus with authentication cookie
    const colyseusClient = new ColyseusClient(wsUrl);
    colyseusClient.http.headers['Cookie'] = `bf_guest=${cookieA}`;
    const roomA = await colyseusClient.create<any>('classic_26', {});

    assert.ok(roomA.roomId);

    // 1. Initial snapshot
    const snap = await sendAndExpect<PublicSnapshot>(roomA, 'request_snapshot', {}, 'snapshot', 5000);
    assert.equal(snap.phase, 'SELECTING');

    // 2. Select box 1
    const selRes = await sendAndExpect<CommandResult>(roomA, 'command', {
      type: 'SELECT_BOX',
      boxId: 1,
      gameId: snap.gameId,
      stateVersion: 1,
      commandSequence: 1,
      idempotencyKey: 'db_sel_1'
    }, 'command_result', 5000);
    assert.equal(selRes.success, true);

    // 3. Open 6 boxes for round 1 (boxes 2..7)
    let curVer = selRes.stateVersion;
    let curSeq = 2;
    let lastRes = selRes;
    for (let b = 2; b <= 7; b++) {
      lastRes = await sendAndExpect<CommandResult>(roomA, 'command', {
        type: 'OPEN_BOX',
        boxId: b,
        gameId: snap.gameId,
        stateVersion: curVer,
        commandSequence: curSeq,
        idempotencyKey: `db_open_${b}`
      }, 'command_result', 5000);
      assert.equal(lastRes.success, true);
      curVer = lastRes.stateVersion;
      curSeq++;
    }

    // 4. In OFFERING phase: accept offer to conclude game
    assert.equal(lastRes.snapshot?.phase, 'OFFERING');
    const offer = lastRes.snapshot?.currentOffer;
    assert.ok(offer);
    assert.ok(offer.amount > 0);

    const accRes = await sendAndExpect<CommandResult>(roomA, 'command', {
      type: 'ACCEPT_OFFER',
      offerId: offer.offerId,
      gameId: snap.gameId,
      stateVersion: curVer,
      commandSequence: curSeq,
      idempotencyKey: 'db_acc_1'
    }, 'command_result', 5000);

    assert.equal(accRes.success, true);
    assert.equal(accRes.snapshot?.phase, 'FINISHED');
    const resultId = accRes.snapshot?.settlement?.resultId!;
    assert.ok(resultId);

    await roomA.leave();

    // 5. Allow outbox worker to drain and write to Postgres
    await app.outbox!.drain(5000);

    // 6. Guest A queries history: GET /api/history
    const histA = await makeRequest('GET', '/api/history', {
      headers: { Cookie: `bf_guest=${cookieA}` }
    });
    assert.equal(histA.status, 200);
    const histDataA = histA.data as HistoryListResponse;
    assert.equal(histDataA.total, 1);
    assert.equal(histDataA.items.length, 1);
    assert.equal(histDataA.items[0].resultId, resultId);
    assert.equal(histDataA.items[0].wonAmount, offer.amount);
    assert.equal(histDataA.items[0].outcomeType, 'OFFER_ACCEPTED');

    // 7. Guest A queries detailed record: GET /api/history/:resultId
    const detailA = await makeRequest('GET', `/api/history/${resultId}`, {
      headers: { Cookie: `bf_guest=${cookieA}` }
    });
    assert.equal(detailA.status, 200);
    const recA = detailA.data as CompletedGameRecord;
    assert.equal(recA.settlement.resultId, resultId);
    assert.ok(recA.auditTrail && recA.auditTrail.length > 0);
    assert.ok(recA.offerHistory && recA.offerHistory.length > 0);
    assert.ok(recA.settlement.fairnessProof);

    // 8. REAL Deduplication Assertions on PostgreSQL:
    // a) Re-inserting the exact same record with same owner returns { inserted: false, matched: true }
    const outboxItemA: SingleOutboxItem = {
      kind: 'single',
      resultId,
      ownerId: guestA.id,
      gameId: recA.gameId,
      completedAt: recA.completedAt,
      ruleVersion: recA.ruleVersion,
      aiType: recA.aiType,
      aiStrategyVersion: recA.aiStrategyVersion,
      record: recA
    };
    const dupInsert = await app.persistence!.insertCompletedGame(outboxItemA);
    assert.equal(dupInsert.inserted, false);
    assert.equal(dupInsert.matched, true);

    // b) Inserting the same resultId with a DIFFERENT owner is rejected with conflictOwner: true
    const crossOwnerInsert = await app.persistence!.insertCompletedGame({
      ...outboxItemA,
      ownerId: guestB.id
    });
    assert.equal(crossOwnerInsert.inserted, false);
    assert.equal(crossOwnerInsert.conflictOwner, true);
    assert.equal(crossOwnerInsert.matched, false);

    // c) Simultaneous first insertion race between two different owners for the SAME resultId
    const raceItemA = createConsistentGameRecord(guestA.id);
    const raceItemB = { ...raceItemA, ownerId: guestB.id };
    const [raceResA, raceResB] = await Promise.all([
      app.persistence!.insertCompletedGame(raceItemA),
      app.persistence!.insertCompletedGame(raceItemB)
    ]);
    const totalInserted = (raceResA.inserted ? 1 : 0) + (raceResB.inserted ? 1 : 0);
    const totalConflict = (raceResA.conflictOwner ? 1 : 0) + (raceResB.conflictOwner ? 1 : 0);
    assert.equal(totalInserted, 1, 'Exactly one concurrent insertion must succeed');
    assert.equal(totalConflict, 1, 'The other concurrent insertion with different owner must be flagged conflict');
    assert.equal(raceResA.matched || raceResB.matched, false);

    // d) Same owner, same resultId, but DIFFERENT gameId / payload is flagged conflictOwner: true (not matched)
    const conflictPayloadItem: SingleOutboxItem = {
      ...outboxItemA,
      record: {
        ...outboxItemA.record,
        settlement: {
          ...outboxItemA.record.settlement,
          wonAmount: 999999
        }
      }
    };
    const conflictPayloadRes = await app.persistence!.insertCompletedGame(conflictPayloadItem);
    assert.equal(conflictPayloadRes.inserted, false);
    assert.equal(conflictPayloadRes.conflictOwner, true);
    assert.equal(conflictPayloadRes.matched, false);

    // e) Concurrent insertions of new record by same owner: exactly one inserts, one matches
    const fixtureItem = createConsistentGameRecord(guestA.id);
    const [c1, c2] = await Promise.all([
      app.persistence!.insertCompletedGame(fixtureItem),
      app.persistence!.insertCompletedGame(fixtureItem)
    ]);
    const insertedCount = (c1.inserted ? 1 : 0) + (c2.inserted ? 1 : 0);
    assert.equal(insertedCount, 1);
    const matchedCount = (c1.matched ? 1 : 0) + (c2.matched ? 1 : 0);
    assert.equal(matchedCount, 1);

    // f) OutboxManager enqueue deduplication:
    // Identical content is accepted idempotently
    app.outbox!.enqueue(fixtureItem);
    app.outbox!.enqueue(fixtureItem);

    // Differing content for same resultId is rejected with an Error and does not overwrite disk
    assert.throws(() => {
      app.outbox!.enqueue({
        ...fixtureItem,
        aiType: 'cold',
        record: {
          ...fixtureItem.record,
          aiType: 'cold'
        }
      });
    }, /already exists with differing content/);

    await app.outbox!.drain(3000);

    // Total history count for guest A is now exactly 3 (original game + raceItemA + fixtureItem)
    const histAUpdated = await makeRequest('GET', '/api/history', {
      headers: { Cookie: `bf_guest=${cookieA}` }
    });
    assert.equal((histAUpdated.data as HistoryListResponse).total, 3);

    // 9. Guest B isolation test:
    // Guest B has 0 history items
    const histB = await makeRequest('GET', '/api/history', {
      headers: { Cookie: `bf_guest=${cookieB}` }
    });
    assert.equal(histB.status, 200);
    assert.equal((histB.data as HistoryListResponse).total, 0);

    // Guest B cannot read Guest A's record even by guessing resultId -> returns 404 NOT_FOUND!
    const detailB = await makeRequest('GET', `/api/history/${resultId}`, {
      headers: { Cookie: `bf_guest=${cookieB}` }
    });
    assert.equal(detailB.status, 404);
    assert.equal(detailB.data?.error?.code, 'NOT_FOUND');

    // Guest B cannot create a share for Guest A's record -> returns 404 NOT_FOUND!
    const shareB = await makeRequest('POST', `/api/history/${resultId}/share`, {
      headers: {
        Cookie: `bf_guest=${cookieB}`,
        Origin: 'http://localhost:3000'
      }
    });
    assert.equal(shareB.status, 404);
    assert.equal(shareB.data?.error?.code, 'NOT_FOUND');

    // 10. Active Share privacy & reusability:
    // Guest A creates share for own record
    const shareRes1 = await makeRequest('POST', `/api/history/${resultId}/share`, {
      headers: {
        Cookie: `bf_guest=${cookieA}`,
        Origin: 'http://localhost:3000'
      }
    });
    assert.equal(shareRes1.status, 200);
    const shareData1 = shareRes1.data as ShareResponse;
    assert.ok(shareData1.shareId);
    assert.equal(shareData1.path, `/share/${shareData1.shareId}`);

    // Repeated share call returns the SAME shareId (reusable)
    const shareRes2 = await makeRequest('POST', `/api/history/${resultId}/share`, {
      headers: {
        Cookie: `bf_guest=${cookieA}`,
        Origin: 'http://localhost:3000'
      }
    });
    assert.equal(shareRes2.status, 200);
    assert.equal((shareRes2.data as ShareResponse).shareId, shareData1.shareId);

    // Public summary GET /api/share/:shareId (anonymous, no cookie)
    const publicShare = await makeRequest('GET', `/api/share/${shareData1.shareId}`);
    assert.equal(publicShare.status, 200);
    const pubSummary = publicShare.data as PublicShareSummary;
    assert.equal(pubSummary.wonAmount, offer.amount);
    assert.equal(pubSummary.outcomeType, 'OFFER_ACCEPTED');
    assert.equal(pubSummary.aiType, 'conservative');
    assert.equal(pubSummary.mode, 'classic-26-v1');

    // Verify privacy: NO guestId, NO token, NO seed, NO salt, NO audit trail
    assert.equal((pubSummary as any).guestId, undefined);
    assert.equal((pubSummary as any).ownerId, undefined);
    assert.equal((pubSummary as any).seed, undefined);
    assert.equal((pubSummary as any).salt, undefined);
    assert.equal((pubSummary as any).auditTrail, undefined);
    assert.equal((pubSummary as any).offerHistory, undefined);
  });

  test('Durable Outbox recovery: empty init->enqueue->drain, failure retry retaining files, restart recovery, and quarantine', { timeout: 15000 }, async () => {
    // Create guest for test
    const guestRes = await makeRequest('POST', '/api/guest', {
      headers: { Origin: 'http://localhost:3000' }
    });
    const cookie = parseCookies(Array.isArray(guestRes.headers['set-cookie']) ? guestRes.headers['set-cookie'][0] : guestRes.headers['set-cookie'])['bf_guest'];
    const tokenHash = crypto.createHash('sha256').update(cookie).digest('hex');
    const guest = await app.persistence!.getGuestByTokenHash(tokenHash);
    assert.ok(guest);

    const isolatedOutboxDir = path.join(os.tmpdir(), 'bf_test_outbox_retry_' + crypto.randomUUID());
    fs.mkdirSync(isolatedOutboxDir, { recursive: true });

    try {
      // 1. Empty directory init -> enqueue -> drain (single-flight bug regression test)
      const outbox1 = new OutboxManager({
        dir: isolatedOutboxDir,
        db: app.persistence!
      });
      // init on completely empty directory: must NOT set currentWorkPromise permanently to fulfilled promise
      await outbox1.init();

      const item1 = createConsistentGameRecord(guest.id);
      outbox1.enqueue(item1);

      // Drain with timeout protection: must succeed cleanly without hanging
      await outbox1.drain(3000);

      const inDb1 = await app.persistence!.getCompletedGame(item1.resultId, guest.id);
      assert.ok(inDb1);
      assert.equal(inDb1.settlement.resultId, item1.resultId);

      // File was deleted on success
      const filesAfterDrain = fs.readdirSync(isolatedOutboxDir).filter((f) => f.endsWith('.json'));
      assert.equal(filesAfterDrain.length, 0);

      // 2. Simulated DB Outage & Failure Retry:
      // Inject temporary DB failure into insertCompletedGame
      const origInsert = app.persistence!.insertCompletedGame.bind(app.persistence);
      let failCount = 0;
      app.persistence!.insertCompletedGame = async (item) => {
        if (failCount === 0) {
          failCount++;
          throw new Error('Simulated transient DB failure');
        }
        return origInsert(item);
      };

      const itemFail = createConsistentGameRecord(guest.id);
      outbox1.enqueue(itemFail);

      // Trigger pass: DB fails, item MUST NOT be deleted and must remain on disk
      await outbox1.processQueue();

      const itemFailPath = path.join(isolatedOutboxDir, `${itemFail.resultId}.json`);
      assert.equal(fs.existsSync(itemFailPath), true, 'File must be retained on disk when DB fails');

      // Now restore DB function and process: retry succeeds and commits to Postgres
      await outbox1.processQueue();
      await outbox1.drain(3000);

      assert.equal(fs.existsSync(itemFailPath), false, 'File must be removed after successful retry');
      const inDbRetry = await app.persistence!.getCompletedGame(itemFail.resultId, guest.id);
      assert.ok(inDbRetry);

      // Restore original method
      app.persistence!.insertCompletedGame = origInsert;

      await outbox1.close();

      // 3. Restart recovery with uncommitted file in directory
      const itemRestart = createConsistentGameRecord(guest.id);
      const itemRestartFile = path.join(isolatedOutboxDir, `${itemRestart.resultId}.json`);
      fs.writeFileSync(itemRestartFile, JSON.stringify(itemRestart), 'utf8');

      // Create new OutboxManager (simulating server crash and restart)
      const outbox2 = new OutboxManager({
        dir: isolatedOutboxDir,
        db: app.persistence!
      });
      await outbox2.init();
      await outbox2.drain(3000);

      const inDbRestart = await app.persistence!.getCompletedGame(itemRestart.resultId, guest.id);
      assert.ok(inDbRestart);
      assert.equal(fs.existsSync(itemRestartFile), false);

      // 4. Quarantine corrupt item / bad JSON:
      // Corrupt file must be moved to quarantine/ and NOT deleted, while valid items continue processing
      const badJsonFile = path.join(isolatedOutboxDir, 'bad_file.json');
      fs.writeFileSync(badJsonFile, '{ invalid json content !!!', 'utf8');

      const invalidStructureFile = path.join(isolatedOutboxDir, 'invalid_structure.json');
      fs.writeFileSync(
        invalidStructureFile,
        JSON.stringify({ resultId: 'mismatched_id', ownerId: guest.id, gameId: 'g1', record: { settlement: { resultId: 'other_id' } } }),
        'utf8'
      );

      const validItemAfterBad = createConsistentGameRecord(guest.id);
      outbox2.enqueue(validItemAfterBad);

      await outbox2.drain(3000);

      // Valid item committed
      const inDbValid = await app.persistence!.getCompletedGame(validItemAfterBad.resultId, guest.id);
      assert.ok(inDbValid);

      // Bad files are quarantined in quarantine/ subdir and NOT lost
      const quarantineDir = path.join(isolatedOutboxDir, 'quarantine');
      assert.equal(fs.existsSync(quarantineDir), true);
      const quarantinedFiles = fs.readdirSync(quarantineDir);
      assert.ok(quarantinedFiles.length >= 2, 'Corrupt records must be preserved in quarantine');

      await outbox2.close();

      // 5. Fault drain timeout & cancellation verification:
      // Loop terminates cleanly on timeout, close cancels retryTimer, file retained on disk
      const mockFaultDb = {
        insertCompletedGame: async () => {
          throw new Error('Simulated persistent DB down');
        }
      } as any;

      const faultOutbox = new OutboxManager({
        dir: isolatedOutboxDir,
        db: mockFaultDb,
        retryIntervalMs: 50
      });
      await faultOutbox.init();

      const faultItem = createConsistentGameRecord(guest.id);
      faultOutbox.enqueue(faultItem);

      // Drain times out after 100ms
      await assert.rejects(faultOutbox.drain(100), /Outbox drain timed out/);

      // Close stops retry timer and pending work without lingering timers
      await faultOutbox.close(200);
      assert.equal((faultOutbox as any).retryTimer, null);

      // File is safely retained on disk
      const faultFilePath = path.join(isolatedOutboxDir, `${faultItem.resultId}.json`);
      assert.equal(fs.existsSync(faultFilePath), true);
      try { fs.unlinkSync(faultFilePath); } catch {}
    } finally {
      const resolved = path.resolve(isolatedOutboxDir);
      const expectedPrefix = path.resolve(os.tmpdir());
      if (resolved.startsWith(expectedPrefix) && resolved.includes('bf_test_outbox_retry_')) {
        fs.rmSync(resolved, { recursive: true, force: true });
      }
    }
  });

  test('Server restart query: same guest token can read history across app server restarts', { timeout: 10000 }, async () => {
    // 1. Create a guest
    const guestRes = await makeRequest('POST', '/api/guest', {
      headers: { Origin: 'http://localhost:3000' }
    });
    const cookie = parseCookies(Array.isArray(guestRes.headers['set-cookie']) ? guestRes.headers['set-cookie'][0] : guestRes.headers['set-cookie'])['bf_guest'];
    const tokenHash = crypto.createHash('sha256').update(cookie).digest('hex');
    const guest = await app.persistence!.getGuestByTokenHash(tokenHash);
    assert.ok(guest);

    // Insert a completed game for this guest
    const restartItem = createConsistentGameRecord(guest.id);
    await app.persistence!.insertCompletedGame(restartItem);

    // 2. Shut down app server
    await app.close();

    // 3. Create a new app server instance with same databaseUrl and schema
    app = createAppServer({
      databaseUrl: DATABASE_URL,
      schema: schemaName,
      outboxDir: tempOutboxDir,
      publicOrigins: ['http://localhost:3000', 'http://127.0.0.1:3000']
    });

    port = await app.listen(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${port}`;
    wsUrl = `ws://127.0.0.1:${port}`;

    // 4. Query history with original guest token after restart
    const histRes = await makeRequest('GET', '/api/history', {
      headers: { Cookie: `bf_guest=${cookie}` }
    });
    assert.equal(histRes.status, 200);
    const hist = histRes.data as HistoryListResponse;
    const found = hist.items.find((item) => item.resultId === restartItem.resultId);
    assert.ok(found);
    assert.equal(found.wonAmount, restartItem.record.settlement.wonAmount);
  });

  test('Database disabled vs failure differentiation: 200 disabled, 503 HISTORY_DISABLED, and 503 DATABASE_UNAVAILABLE', { timeout: 10000 }, async () => {
    // 1. App server with NO databaseUrl (disabled mode)
    const disabledApp = createAppServer({ databaseUrl: undefined });
    const disPort = await disabledApp.listen(0, '127.0.0.1');
    const disBase = `http://127.0.0.1:${disPort}`;

    try {
      // GET /api/guest returns 200 { enabled: false, available: false, authenticated: false }
      const res1 = await new Promise<any>((resolve) => {
        http.get(`${disBase}/api/guest`, (res) => {
          let str = '';
          res.on('data', (c) => (str += c));
          res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, data: JSON.parse(str) }));
        });
      });
      assert.equal(res1.status, 200);
      assert.deepEqual(res1.data, { enabled: false, available: false, authenticated: false });
      assert.equal(res1.headers['cache-control'], 'no-store');

      // POST /api/guest returns 503 HISTORY_DISABLED with Cache-Control: no-store
      const res2 = await new Promise<any>((resolve) => {
        const req = http.request(`${disBase}/api/guest`, { method: 'POST', headers: { Origin: 'http://localhost:3000' } }, (res) => {
          let str = '';
          res.on('data', (c) => (str += c));
          res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, data: JSON.parse(str) }));
        });
        req.end();
      });
      assert.equal(res2.status, 503);
      assert.equal(res2.data?.error?.code, 'HISTORY_DISABLED');
      assert.equal(res2.headers['cache-control'], 'no-store');

      // GET /api/history returns 503 HISTORY_DISABLED with Cache-Control: no-store
      const res3 = await new Promise<any>((resolve) => {
        http.get(`${disBase}/api/history`, (res) => {
          let str = '';
          res.on('data', (c) => (str += c));
          res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, data: JSON.parse(str) }));
        });
      });
      assert.equal(res3.status, 503);
      assert.equal(res3.data?.error?.code, 'HISTORY_DISABLED');
      assert.equal(res3.headers['cache-control'], 'no-store');
    } finally {
      await disabledApp.close();
    }

    // 2. App server with unreachable DB URL (failure mode -> 503 DATABASE_UNAVAILABLE)
    const deadDbApp = createAppServer({
      databaseUrl: 'postgresql://127.0.0.1:54329/nonexistent?connect_timeout=1'
    });
    // Listen without awaiting ensureInit crash (or listen handling failure)
    const deadPort = await new Promise<number>((resolve) => {
      deadDbApp.httpServer.listen(0, '127.0.0.1', () => {
        const addr = deadDbApp.httpServer.address();
        resolve(typeof addr === 'object' && addr ? addr.port : 0);
      });
    });
    const deadBase = `http://127.0.0.1:${deadPort}`;

    try {
      // GET /api/guest returns 503 DATABASE_UNAVAILABLE with Cache-Control: no-store
      const res4 = await new Promise<any>((resolve) => {
        http.get(`${deadBase}/api/guest`, (res) => {
          let str = '';
          res.on('data', (c) => (str += c));
          res.on('end', () => {
            let data: any;
            try { data = JSON.parse(str); } catch { data = str; }
            resolve({ status: res.statusCode, headers: res.headers, data });
          });
        });
      });
      assert.equal(res4.status, 503);
      assert.equal(res4.data?.error?.code, 'DATABASE_UNAVAILABLE');
      assert.equal(res4.headers['cache-control'], 'no-store');

      // POST /api/guest returns 503 DATABASE_UNAVAILABLE with Cache-Control: no-store
      const res5 = await new Promise<any>((resolve) => {
        const req = http.request(`${deadBase}/api/guest`, { method: 'POST', headers: { Origin: 'http://localhost:3000' } }, (res) => {
          let str = '';
          res.on('data', (c) => (str += c));
          res.on('end', () => {
            let data: any;
            try { data = JSON.parse(str); } catch { data = str; }
            resolve({ status: res.statusCode, headers: res.headers, data });
          });
        });
        req.end();
      });
      assert.equal(res5.status, 503);
      assert.equal(res5.data?.error?.code, 'DATABASE_UNAVAILABLE');
      assert.equal(res5.headers['cache-control'], 'no-store');
    } finally {
      await deadDbApp.close();
    }
  });

  test('Database script password preservation: reads POSTGRES_PASSWORD/DB_PASSWORD, throws on unparseable, and preserves secret', () => {
    const tempDir = path.join(os.tmpdir(), 'bf_test_sec_' + crypto.randomUUID());
    fs.mkdirSync(tempDir, { recursive: true });
    try {
      const secFile = path.join(tempDir, '.env.database.local');

      // 1. File does not exist: creates with POSTGRES_PASSWORD using wx flag
      const pwd1 = getOrGenerateDbPassword(secFile);
      assert.ok(pwd1 && pwd1.length === 64);
      assert.equal(fs.existsSync(secFile), true);
      const content1 = fs.readFileSync(secFile, 'utf8');
      assert.ok(content1.includes(`POSTGRES_PASSWORD=${pwd1}`));

      // 2. Existing file with POSTGRES_PASSWORD: reads and preserves exact value
      const pwd2 = getOrGenerateDbPassword(secFile);
      assert.equal(pwd2, pwd1);

      // 3. Existing file with legacy DB_PASSWORD: reads and preserves
      const legacyFile = path.join(tempDir, '.env.legacy');
      fs.writeFileSync(legacyFile, 'DB_PASSWORD=my_legacy_password_123\n', 'utf8');
      const pwdLegacy = getOrGenerateDbPassword(legacyFile);
      assert.equal(pwdLegacy, 'my_legacy_password_123');

      // 4. Corrupt/unparseable file: throws generic error and NEVER overwrites
      const corruptFile = path.join(tempDir, '.env.corrupt');
      fs.writeFileSync(corruptFile, 'SOME_UNKNOWN_KEY=corrupt\n', 'utf8');
      assert.throws(() => getOrGenerateDbPassword(corruptFile), /Unrecognized database credentials format/);
      assert.equal(fs.readFileSync(corruptFile, 'utf8'), 'SOME_UNKNOWN_KEY=corrupt\n');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('V1 Season, Ranking, Profile Summary, Reports & Risk Control', async () => {
    // 1. GET /api/seasons returns default active season
    const seasonsRes = await makeRequest('GET', '/api/seasons');
    assert.equal(seasonsRes.status, 200);
    assert.equal(seasonsRes.headers['cache-control'], 'no-store');
    assert.ok(Array.isArray(seasonsRes.data.items));
    assert.ok(seasonsRes.data.items.length >= 1);
    const activeSeasonId = seasonsRes.data.activeSeasonId;
    assert.ok(activeSeasonId);

    // GET /api/seasons/:seasonId returns details
    const seasonDetailRes = await makeRequest('GET', `/api/seasons/${activeSeasonId}`);
    assert.equal(seasonDetailRes.status, 200);
    assert.equal(seasonDetailRes.data.seasonId, activeSeasonId);
    assert.equal(seasonDetailRes.data.ruleVersion, 'season-v1');

    // GET /api/seasons/nonexistent returns 404
    const notFoundSeasonRes = await makeRequest('GET', '/api/seasons/nonexistent-id');
    assert.equal(notFoundSeasonRes.status, 404);

    // 2. GET /api/rankings returns empty or current ranking
    const rankingsRes = await makeRequest('GET', '/api/rankings');
    assert.equal(rankingsRes.status, 200);
    assert.equal(rankingsRes.headers['cache-control'], 'no-store');
    assert.equal(rankingsRes.data.seasonId, activeSeasonId);

    // 3. Guest authentication & profile summary
    const guest1 = await makeRequest('POST', '/api/guest', {
      headers: { Origin: 'http://localhost:3000' }
    });
    const guest1Cookie = guest1.headers['set-cookie']?.[0]?.split(';')[0];
    assert.ok(guest1Cookie);

    const guest2 = await makeRequest('POST', '/api/guest', {
      headers: { Origin: 'http://localhost:3000' }
    });
    const guest2Cookie = guest2.headers['set-cookie']?.[0]?.split(';')[0];
    assert.ok(guest2Cookie);

    // Unauthenticated GET /api/profile/summary returns 401
    const unauthProfile = await makeRequest('GET', '/api/profile/summary');
    assert.equal(unauthProfile.status, 401);

    // Authenticated GET /api/profile/summary
    const profileRes = await makeRequest('GET', '/api/profile/summary', {
      headers: { Cookie: guest1Cookie }
    });
    assert.equal(profileRes.status, 200);
    assert.equal(profileRes.data.elo, 1000);
    assert.equal(profileRes.data.matchesPlayed, 0);

    // Verify classic single-player game does NOT update competitive Elo or ranking profile
    const singleRecord = createConsistentGameRecord(profileRes.data.guestId);
    await app.persistence!.insertCompletedGame(singleRecord);
    const profileAfterSingle = await makeRequest('GET', '/api/profile/summary', {
      headers: { Cookie: guest1Cookie }
    });
    assert.equal(profileAfterSingle.data.singleGamesPlayed, 1);
    assert.equal(profileAfterSingle.data.matchesPlayed, 0);
    assert.equal(profileAfterSingle.data.elo, 1000);

    // 4. Reports API
    // Unauthenticated report returns 401
    const unauthReport = await makeRequest('POST', '/api/reports', {
      headers: { Origin: 'http://localhost:3000' },
      body: { targetType: 'match', targetId: 'match_123', category: 'cheating', reason: 'suspicious play' }
    });
    assert.equal(unauthReport.status, 401);

    // Authenticated report creation
    const report1 = await makeRequest('POST', '/api/reports', {
      headers: { Origin: 'http://localhost:3000', Cookie: guest1Cookie },
      body: { targetType: 'match', targetId: 'match_123', category: 'cheating', reason: 'suspicious play' }
    });
    assert.equal(report1.status, 201);
    assert.ok(report1.data.reportId);
    assert.equal(report1.data.status, 'pending');

    // Duplicate report from same guest on same target & category returns 409 Conflict
    const reportDuplicate = await makeRequest('POST', '/api/reports', {
      headers: { Origin: 'http://localhost:3000', Cookie: guest1Cookie },
      body: { targetType: 'match', targetId: 'match_123', category: 'cheating', reason: 'duplicate report' }
    });
    assert.equal(reportDuplicate.status, 409);
    assert.equal(reportDuplicate.data.error?.code, 'REPORT_CONFLICT');

    // Frequency guard: same fingerprint max 10 reports/hour. Fill up quota with distinct targetIds
    for (let i = 0; i < 9; i++) {
      const fillRes = await makeRequest('POST', '/api/reports', {
        headers: { Origin: 'http://localhost:3000', Cookie: guest1Cookie },
        body: { targetType: 'match', targetId: `match_rl_${i}`, category: 'cheating', reason: 'rl test' }
      });
      assert.equal(fillRes.status, 201);
    }
    // The 11th report from the same IP fingerprint returns 429 REPORT_RATE_LIMITED
    const rateLimitedRes = await makeRequest('POST', '/api/reports', {
      headers: { Origin: 'http://localhost:3000', Cookie: guest1Cookie },
      body: { targetType: 'match', targetId: 'match_rl_exceeded', category: 'cheating', reason: 'rl test' }
    });
    assert.equal(rateLimitedRes.status, 429);
    assert.equal(rateLimitedRes.data.error?.code, 'REPORT_RATE_LIMITED');
  });

  test('V1 Elo & Settlement Ranking Update: Duel & Auction pairwise comparison', async () => {
    // Register two guests
    const g1Res = await makeRequest('POST', '/api/guest', { headers: { Origin: 'http://localhost:3000' } });
    const g1Cookie = g1Res.headers['set-cookie']?.[0]?.split(';')[0]!;
    const g2Res = await makeRequest('POST', '/api/guest', { headers: { Origin: 'http://localhost:3000' } });
    const g2Cookie = g2Res.headers['set-cookie']?.[0]?.split(';')[0]!;

    const g1ProfBefore = await makeRequest('GET', '/api/profile/summary', { headers: { Cookie: g1Cookie } });
    const g2ProfBefore = await makeRequest('GET', '/api/profile/summary', { headers: { Cookie: g2Cookie } });
    const g1Id = g1ProfBefore.data.guestId;
    const g2Id = g2ProfBefore.data.guestId;

    assert.equal(g1ProfBefore.data.elo, 1000);
    assert.equal(g2ProfBefore.data.elo, 1000);

    // Insert completed duel where g1 (seat 0) wins over g2 (seat 1)
    const duelRecord = {
      resultId: 'res_duel_' + crypto.randomUUID(),
      matchId: 'match_duel_' + crypto.randomUUID(),
      guest0Id: g1Id,
      guest1Id: g2Id,
      completedAt: Date.now(),
      ruleVersion: 'duel-26-v1',
      record: {
        matchId: 'match_duel_test',
        resultId: 'res_duel_test',
        ruleVersion: 'duel-26-v1',
        completedAt: Date.now(),
        seats: [
          { seatId: 0 as const, nickname: 'Player 1' },
          { seatId: 1 as const, nickname: 'Player 2' }
        ],
        result: {
          resultId: 'res_duel_test',
          matchId: 'match_duel_test',
          ruleVersion: 'duel-26-v1',
          winnerSeatId: 0 as const,
          reason: 'NORMAL' as const,
          finalScores: { 0: 50000, 1: 10000 },
          rounds: [
            {
              roundIndex: 0,
              challengerSeatId: 0 as const,
              bankerSeatId: 1 as const,
              outcomeType: 'OFFER_ACCEPTED' as const,
              originalPlayerBoxId: 1,
              finalPlayerBoxId: 1,
              originalPlayerBoxAmount: 10000,
              highestOfferAmount: 25000,
              challengerProfit: 25000,
              bankerProfit: 5000
            },
            {
              roundIndex: 1,
              challengerSeatId: 1 as const,
              bankerSeatId: 0 as const,
              outcomeType: 'OFFER_ACCEPTED' as const,
              originalPlayerBoxId: 2,
              finalPlayerBoxId: 2,
              originalPlayerBoxAmount: 20000,
              highestOfferAmount: 5000,
              challengerProfit: 5000,
              bankerProfit: 25000
            }
          ],
          fairnessProofs: [],
          auditTrail: []
        }
      }
    };

    const insertDuelRes = await app.persistence!.insertCompletedDuel(duelRecord);
    assert.equal(insertDuelRes.inserted, true);

    // Check updated profiles: Winner g1 gains 16 Elo (from 1000 to 1016), Loser g2 loses 16 (from 1000 to 984)
    const g1ProfAfter = await makeRequest('GET', '/api/profile/summary', { headers: { Cookie: g1Cookie } });
    const g2ProfAfter = await makeRequest('GET', '/api/profile/summary', { headers: { Cookie: g2Cookie } });

    assert.equal(g1ProfAfter.data.elo, 1016);
    assert.equal(g1ProfAfter.data.wins, 1);
    assert.equal(g1ProfAfter.data.matchesPlayed, 1);
    assert.equal(g1ProfAfter.data.winRate, 1.0);
    assert.equal(g1ProfAfter.data.netProfit, 50000);

    assert.equal(g2ProfAfter.data.elo, 984);
    assert.equal(g2ProfAfter.data.losses, 1);
    assert.equal(g2ProfAfter.data.matchesPlayed, 1);
    assert.equal(g2ProfAfter.data.winRate, 0.0);
    assert.equal(g2ProfAfter.data.netProfit, 10000);

    // Leaderboard verifies rank 1 (elo 1016) and rank 2 (elo 984); guestId is NEVER exposed in public RankingEntry
    const rankList = await makeRequest('GET', '/api/rankings');
    assert.equal(rankList.status, 200);
    assert.equal(rankList.data.items.length, 2);
    assert.equal(rankList.data.items[0].guestId, undefined);
    assert.equal(rankList.data.items[1].guestId, undefined);
    assert.equal(rankList.data.items[0].rank, 1);
    assert.equal(rankList.data.items[0].elo, 1016);
    assert.equal(rankList.data.items[1].rank, 2);
    assert.equal(rankList.data.items[1].elo, 984);
  });

  test('V1 Admin Session, Config, Themes, Bans, Reports & Audit Logs', async () => {
    process.env.BF_ADMIN_TOKEN = 'secret_admin_token_test_2026';

    // 1. Login with invalid token returns 401
    const invalidLogin = await makeRequest('POST', '/api/admin/session', {
      headers: { 'X-Admin-Token': 'wrong_token' }
    });
    assert.equal(invalidLogin.status, 401);

    // 2. Login with valid token succeeds and sets HttpOnly SameSite=Strict bf_admin cookie
    const validLogin = await makeRequest('POST', '/api/admin/session', {
      headers: { 'X-Admin-Token': 'secret_admin_token_test_2026' }
    });
    assert.equal(validLogin.status, 200);
    assert.equal(validLogin.data.success, true);
    assert.equal(validLogin.data.authenticated, true);
    // Secret token is NOT returned in body!
    assert.equal(validLogin.data.token, undefined);

    const adminCookie = validLogin.headers['set-cookie']?.[0]?.split(';')[0];
    assert.ok(adminCookie && adminCookie.startsWith('bf_admin='));
    const setCookieStr = validLogin.headers['set-cookie']?.[0] || '';
    assert.ok(setCookieStr.includes('HttpOnly'));
    assert.ok(setCookieStr.includes('SameSite=Strict'));

    // 3. Access admin endpoints without auth returns 401
    const unauthMetrics = await makeRequest('GET', '/api/admin/metrics');
    assert.equal(unauthMetrics.status, 401);

    // 4. Access admin metrics with cookie
    const metricsRes = await makeRequest('GET', '/api/admin/metrics', {
      headers: { Cookie: adminCookie }
    });
    assert.equal(metricsRes.status, 200);
    assert.ok(typeof metricsRes.data.totalGuests === 'number');
    assert.ok(typeof metricsRes.data.totalDuelGames === 'number');

    // 5. Admin Runtime Config
    const setConfigRes = await makeRequest('POST', '/api/admin/config', {
      headers: { Cookie: adminCookie },
      body: { key: 'feature_flags', value: { duelV2: true }, description: 'Feature toggles' }
    });
    assert.equal(setConfigRes.status, 200);
    assert.equal(setConfigRes.data.key, 'feature_flags');
    assert.equal(setConfigRes.data.version, 1);

    // 6. Admin Themes
    const getThemesRes = await makeRequest('GET', '/api/admin/themes', {
      headers: { Cookie: adminCookie }
    });
    assert.equal(getThemesRes.status, 200);
    assert.deepEqual(getThemesRes.data.availableThemes, ['classic', 'starry-neon']);

    const toggleThemeRes = await makeRequest('PATCH', '/api/admin/themes/starry-neon', {
      headers: { Cookie: adminCookie },
      body: { enabled: true, setActive: true }
    });
    assert.equal(toggleThemeRes.status, 200);
    assert.equal(toggleThemeRes.data.activeTheme, 'starry-neon');

    // 7. Admin Ban
    const postGuestRes = await makeRequest('POST', '/api/guest', {
      headers: { Origin: 'http://localhost:3000' }
    });
    assert.equal(postGuestRes.status, 200);
    const guestCookieStr = Array.isArray(postGuestRes.headers['set-cookie'])
      ? postGuestRes.headers['set-cookie'][0]
      : postGuestRes.headers['set-cookie'];
    const guestToken = parseCookies(guestCookieStr!)['bf_guest'];
    const guestTokenHash = crypto.createHash('sha256').update(guestToken).digest('hex');
    const guestRow = await app.persistence!.getGuestByTokenHash(guestTokenHash);
    assert.ok(guestRow);
    const guestToBan = guestRow.id;

    const banRes = await makeRequest('POST', '/api/admin/bans', {
      headers: { Cookie: adminCookie },
      body: { guestId: guestToBan, reason: 'Botting detected', severity: 'high', excludeRanking: true }
    });
    assert.equal(banRes.status, 201);
    assert.ok(banRes.data.banId);

    // Non-existent guest returns 404
    const notFoundBanRes = await makeRequest('POST', '/api/admin/bans', {
      headers: { Cookie: adminCookie },
      body: { guestId: crypto.randomUUID(), reason: 'Fake guest' }
    });
    assert.equal(notFoundBanRes.status, 404);

    // Unban
    const unbanRes = await makeRequest('PATCH', `/api/admin/bans/${banRes.data.banId}`, {
      headers: { Cookie: adminCookie },
      body: { isActive: false }
    });
    assert.equal(unbanRes.status, 200);
    assert.equal(unbanRes.data.isActive, false);

    // 8. Admin Audit Log wrote events
    const logsRes = await (app.persistence as any).pool.query('SELECT action, target_type FROM admin_audit_logs ORDER BY created_at DESC LIMIT 10');
    assert.ok(logsRes.rows.length >= 3);
    const actions = logsRes.rows.map((r: any) => r.action);
    assert.ok(actions.includes('ADMIN_LOGIN') || actions.includes('UPDATE_CONFIG') || actions.includes('BAN_GUEST'));
  });
});
