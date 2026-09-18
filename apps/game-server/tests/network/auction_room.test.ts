import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Client, Room } from 'colyseus.js';
import { createAppServer } from '../../src/server';
import { AuctionClientSnapshot, AuctionCommandResult } from '../../../../packages/protocol/src/auction';

function sendAndExpect<T>(
  room: Room,
  sendType: string,
  payload: any,
  expectType: string,
  timeoutMs = 5000
): Promise<T> {
  let timer: NodeJS.Timeout;
  let unsub: () => void;

  const messagePromise = new Promise<T>((resolve) => {
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
      reject(new Error(`Timed out waiting for message "${expectType}" after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  room.send(sendType, payload);

  return Promise.race([messagePromise, timeoutPromise]).finally(() => {
    clearTimeout(timer);
  });
}

describe('AuctionRoom Network Integration Tests (127.0.0.1)', () => {
  let app: ReturnType<typeof createAppServer>;
  let port: number;
  let wsUrl: string;
  let httpBaseUrl: string;

  before(async () => {
    app = createAppServer();
    port = await app.listen(0, '127.0.0.1');
    wsUrl = `ws://127.0.0.1:${port}`;
    httpBaseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    if (app) {
      await app.close();
    }
  });

  test('spectator joins auction room, receives read-only public projection, and sends reactions', { timeout: 10000 }, async () => {
    const client = new Client(wsUrl);
    // Create room as spectator
    const room = await client.create<any>('auction_26', { isSpectator: true, nickname: 'Spec_1' });
    try {
      assert.ok(room.roomId);

      // Request snapshot
      const snapshot = await sendAndExpect<AuctionClientSnapshot>(room, 'request_snapshot', {}, 'snapshot', 5000);
      assert.equal(snapshot.public.phase, 'WAITING');
      assert.equal(snapshot.public.isPrivate, false);
      assert.equal(snapshot.public.ranked, true);
      assert.equal(snapshot.public.allowSpectators, true);
      assert.equal(snapshot.private.isSpectator, true);
      assert.equal(snapshot.private.seatId, null);
      assert.deepEqual(snapshot.private.allowedActions, ['SEND_EMOTE']);

      // Spectator attempts to execute game command -> rejected
      const forbiddenCmdRes = await sendAndExpect<AuctionCommandResult>(
        room,
        'command',
        {
          type: 'READY',
          ready: true,
          stateVersion: 1,
          commandSequence: 1,
          idempotencyKey: 'spec_forbidden_ready'
        },
        'command_result',
        5000
      );
      assert.equal(forbiddenCmdRes.success, false);
      assert.equal(forbiddenCmdRes.error?.code, 'UNAUTHORIZED');

      // Spectator sends valid reaction via command -> accepted
      const reactionRes = await sendAndExpect<AuctionCommandResult>(
        room,
        'command',
        {
          type: 'SEND_REACTION',
          emoji: '🎉',
          stateVersion: 1,
          commandSequence: 2,
          idempotencyKey: 'spec_react_1'
        },
        'command_result',
        5000
      );
      assert.equal(reactionRes.success, true);
    } finally {
      await room.leave();
    }
  });

  test('rejects room creation with injected cheat parameters', { timeout: 5000 }, async () => {
    const client = new Client(wsUrl);
    await assert.rejects(
      async () => {
        await client.create<any>('auction_26', {
          customBoxAmountMap: { 1: 1000000 }
        });
      },
      /Custom game configuration is not permitted via network/
    );
  });

  test('HTTP auction endpoints require authentication and handle unauthenticated access gracefully', async () => {
    // GET /api/auction/history without auth -> 503 (if db disabled) or 401 (if db enabled)
    const res = await new Promise<any>((resolve) => {
      http.get(`${httpBaseUrl}/api/auction/history`, (r) => {
        let data = '';
        r.on('data', (chunk) => (data += chunk));
        r.on('end', () => resolve({ status: r.statusCode, data: JSON.parse(data) }));
      });
    });

    assert.ok(res.status === 503 || res.status === 401);
  });

  test('rejects spectator join when allowSpectators is false', { timeout: 5000 }, async () => {
    const client = new Client(wsUrl);
    await assert.rejects(
      async () => {
        await client.create<any>('auction_26', {
          isSpectator: true,
          allowSpectators: false,
          nickname: 'Spec_Denied'
        });
      },
      /Spectators are not allowed in this room/
    );
  });

  test('room creation options are reflected in public snapshot and joiner options do not overwrite config', { timeout: 10000 }, async () => {
    const client1 = new Client(wsUrl);
    const room1 = await client1.create<any>('auction_26', {
      isSpectator: true,
      isPrivate: true,
      password: 'test1234',
      ranked: false,
      allowSpectators: true,
      nickname: 'Creator'
    });

    try {
      const snap1 = await sendAndExpect<AuctionClientSnapshot>(room1, 'request_snapshot', {}, 'snapshot', 5000);
      assert.equal(snap1.public.isPrivate, true);
      assert.equal(snap1.public.ranked, false);
      assert.equal(snap1.public.allowSpectators, true);

      // Second spectator joins attempting to pass conflicting options
      const client2 = new Client(wsUrl);
      const room2 = await client2.joinById<any>(room1.roomId, {
        isSpectator: true,
        isPrivate: false,
        password: 'test1234',
        ranked: true,
        nickname: 'Joiner'
      });

      try {
        const snap2 = await sendAndExpect<AuctionClientSnapshot>(room2, 'request_snapshot', {}, 'snapshot', 5000);
        // Room configuration is unchanged and preserved from creation
        assert.equal(snap2.public.isPrivate, true);
        assert.equal(snap2.public.ranked, false);
        assert.equal(snap2.public.allowSpectators, true);
      } finally {
        await room2.leave();
      }
    } finally {
      await room1.leave();
    }
  });
});
