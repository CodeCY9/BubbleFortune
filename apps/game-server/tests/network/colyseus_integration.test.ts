import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Client, Room } from 'colyseus.js';
import { createAppServer } from '../../src/server';
import { PublicSnapshot, CommandResult } from '../../../../packages/protocol/src/types';

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
      // If matching command_result, match idempotencyKey when available
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
      reject(new Error(`Timed out waiting for message "${expectType}" after ${timeoutMs}ms (payload: ${JSON.stringify(payload)})`));
    }, timeoutMs);
  });

  // Attach listener BEFORE send
  room.send(sendType, payload);

  return Promise.race([messagePromise, timeoutPromise]).finally(() => {
    clearTimeout(timer);
  });
}

describe('Colyseus Network Integration Tests (127.0.0.1)', () => {
  let app: ReturnType<typeof createAppServer>;
  let port: number;
  let serverUrl: string;

  before(async () => {
    app = createAppServer();
    port = await app.listen(0, '127.0.0.1');
    serverUrl = `ws://127.0.0.1:${port}`;
  });

  after(async () => {
    if (app) {
      await app.close();
    }
  });

  test('full flow: create -> snapshot -> select -> open 6 boxes -> offer -> accept', { timeout: 15000 }, async () => {
    const client = new Client(serverUrl);
    const room = await client.create<any>('classic_26');
    try {
      assert.ok(room.roomId);

      // Request snapshot
      const snapshot = await sendAndExpect<PublicSnapshot>(room, 'request_snapshot', {}, 'snapshot', 5000);
      assert.equal(snapshot.phase, 'SELECTING');
      assert.equal(snapshot.boxes.length, 26);
      assert.equal(snapshot.unopenedCount, 26);

      // Verify no secret leak in snapshot
      for (const b of snapshot.boxes) {
        assert.equal('amount' in b, false);
        assert.equal('value' in b, false);
        assert.equal('revealedAmount' in b, false);
      }

      // Select box 1
      const selectRes = await sendAndExpect<CommandResult>(room, 'command', {
        type: 'SELECT_BOX',
        gameId: snapshot.gameId,
        stateVersion: 1,
        commandSequence: 1,
        idempotencyKey: 'net_k1',
        boxId: 1
      }, 'command_result', 5000);

      assert.equal(selectRes.success, true);
      assert.equal(selectRes.stateVersion, 2);
      assert.equal(selectRes.snapshot?.currentPlayerBoxId, 1);
      assert.equal(selectRes.snapshot?.phase, 'OPENING');

      // Open boxes 2..7 (6 boxes for round 1)
      let curVer = selectRes.stateVersion;
      let curSeq = 2;
      let lastRes = selectRes;

      for (let boxId = 2; boxId <= 7; boxId++) {
        lastRes = await sendAndExpect<CommandResult>(room, 'command', {
          type: 'OPEN_BOX',
          gameId: snapshot.gameId,
          stateVersion: curVer,
          commandSequence: curSeq,
          idempotencyKey: 'net_open_' + boxId,
          boxId
        }, 'command_result', 5000);

        assert.equal(lastRes.success, true);
        curVer = lastRes.stateVersion;
        curSeq++;
      }

      // Round 1 completed, now in OFFERING
      assert.equal(lastRes.snapshot?.phase, 'OFFERING');
      const offer = lastRes.snapshot?.currentOffer;
      assert.ok(offer);
      assert.ok(offer.amount > 0);

      // Accept offer
      const acceptRes = await sendAndExpect<CommandResult>(room, 'command', {
        type: 'ACCEPT_OFFER',
        gameId: snapshot.gameId,
        stateVersion: curVer,
        commandSequence: curSeq,
        idempotencyKey: 'net_accept',
        offerId: offer.offerId
      }, 'command_result', 5000);

      assert.equal(acceptRes.success, true);
      assert.equal(acceptRes.snapshot?.phase, 'FINISHED');
      assert.ok(acceptRes.snapshot?.settlement);
      assert.equal(acceptRes.snapshot?.settlement.outcomeType, 'OFFER_ACCEPTED');
      assert.equal(acceptRes.snapshot?.settlement.wonAmount, offer.amount);
    } finally {
      await room.leave().catch(() => {});
    }
  });

  test('duplicate command replay over network returns identical cached result', { timeout: 15000 }, async () => {
    const client = new Client(serverUrl);
    const room = await client.create<any>('classic_26');
    try {
      const snap = await sendAndExpect<PublicSnapshot>(room, 'request_snapshot', {}, 'snapshot', 5000);

      const cmd = {
        type: 'SELECT_BOX',
        gameId: snap.gameId,
        stateVersion: 1,
        commandSequence: 1,
        idempotencyKey: 'net_replay_1',
        boxId: 10
      };

      const res1 = await sendAndExpect<CommandResult>(room, 'command', cmd, 'command_result', 5000);
      assert.equal(res1.success, true);
      assert.equal(res1.stateVersion, 2);

      // Replay same command
      const res2 = await sendAndExpect<CommandResult>(room, 'command', cmd, 'command_result', 5000);
      assert.equal(res2.success, true);
      assert.equal(res2.stateVersion, 2);
      assert.equal(res2.idempotencyKey, 'net_replay_1');
    } finally {
      await room.leave().catch(() => {});
    }
  });

  for (const action of ['KEEP', 'SWAP'] as const) {
    test(`play through 24 boxes to final 2 boxes -> FINAL_SWAP branch: ${action}`, { timeout: 15000 }, async () => {
      const client = new Client(serverUrl);
      const room = await client.create<any>('classic_26');
      try {
        const snap = await sendAndExpect<PublicSnapshot>(room, 'request_snapshot', {}, 'snapshot', 5000);
        const gameId = snap.gameId;

        // Select box 1
        let res = await sendAndExpect<CommandResult>(room, 'command', {
          type: 'SELECT_BOX',
          gameId,
          stateVersion: 1,
          commandSequence: 1,
          idempotencyKey: `flow_select_${action}`,
          boxId: 1
        }, 'command_result', 5000);

        assert.equal(res.success, true);
        let curVer = res.stateVersion;
        let curSeq = 2;

        // Open boxes 2..25 (24 boxes). When OFFERING is reached, reject offer.
        // Targets per round: [6, 5, 4, 3, 2, 1, 1, 1, 1]
        let currentBoxToOpen = 2;
        for (let round = 1; round <= 9; round++) {
          const roundTargets = [6, 5, 4, 3, 2, 1, 1, 1, 1];
          const boxesThisRound = roundTargets[round - 1];

          for (let b = 0; b < boxesThisRound; b++) {
            res = await sendAndExpect<CommandResult>(room, 'command', {
              type: 'OPEN_BOX',
              gameId,
              stateVersion: curVer,
              commandSequence: curSeq,
              idempotencyKey: `open_${action}_${currentBoxToOpen}`,
              boxId: currentBoxToOpen
            }, 'command_result', 5000);

            assert.equal(res.success, true);
            curVer = res.stateVersion;
            curSeq++;
            currentBoxToOpen++;
          }

          // If not the final round (round 9), an offer is made and we reject it
          if (round < 9) {
            assert.equal(res.snapshot?.phase, 'OFFERING');
            const offer = res.snapshot.currentOffer!;
            assert.ok(offer);

            res = await sendAndExpect<CommandResult>(room, 'command', {
              type: 'REJECT_OFFER',
              gameId,
              stateVersion: curVer,
              commandSequence: curSeq,
              idempotencyKey: `reject_${action}_${round}`,
              offerId: offer.offerId
            }, 'command_result', 5000);

            assert.equal(res.success, true);
            assert.equal(res.snapshot?.phase, 'OPENING');
            curVer = res.stateVersion;
            curSeq++;
          }
        }

        // After round 9 (24 boxes opened), game must be in FINAL_SWAP!
        assert.equal(res.snapshot?.phase, 'FINAL_SWAP');
        assert.equal(res.snapshot?.unopenedCount, 2);

        // Perform KEEP_BOX or SWAP_BOX
        const finalCmd = action === 'KEEP'
          ? {
              type: 'KEEP_BOX',
              gameId,
              stateVersion: curVer,
              commandSequence: curSeq,
              idempotencyKey: `final_cmd_${action}`
            }
          : {
              type: 'SWAP_BOX',
              gameId,
              stateVersion: curVer,
              commandSequence: curSeq,
              idempotencyKey: `final_cmd_${action}`,
              targetBoxId: 26
            };

        const finalRes = await sendAndExpect<CommandResult>(room, 'command', finalCmd, 'command_result', 5000);
        assert.equal(finalRes.success, true);
        assert.equal(finalRes.snapshot?.phase, 'FINISHED');
        const settlement = finalRes.snapshot?.settlement;
        assert.ok(settlement);
        assert.ok(settlement.allBoxes);
        assert.equal(settlement.allBoxes.length, 26);
        assert.equal(settlement.originalPlayerBoxId, 1);

        if (action === 'KEEP') {
          assert.equal(settlement.outcomeType, 'FINAL_KEEP');
          assert.equal(settlement.finalPlayerBoxId, 1);
          assert.equal(finalRes.snapshot?.currentPlayerBoxId, 1);
          const box1 = settlement.allBoxes.find(b => b.id === 1);
          assert.ok(box1);
          assert.equal(settlement.wonAmount, box1.amount);
        } else {
          assert.equal(settlement.outcomeType, 'FINAL_SWAP');
          assert.equal(settlement.finalPlayerBoxId, 26);
          assert.equal(finalRes.snapshot?.currentPlayerBoxId, 26);
          const box26 = settlement.allBoxes.find(b => b.id === 26);
          assert.ok(box26);
          assert.equal(settlement.wonAmount, box26.amount);
        }

        // Duplicate final command replay preserves exact settlement resultId
        const replayRes = await sendAndExpect<CommandResult>(room, 'command', finalCmd, 'command_result', 5000);
        assert.equal(replayRes.success, true);
        assert.equal(replayRes.snapshot?.settlement?.resultId, settlement.resultId);
      } finally {
        await room.leave().catch(() => {});
      }
    });
  }

  test('second client is rejected when joining active single player room', { timeout: 15000 }, async () => {
    const client1 = new Client(serverUrl);
    const room1 = await client1.create<any>('classic_26');
    try {
      assert.ok(room1.roomId);

      const client2 = new Client(serverUrl);
      await assert.rejects(
        async () => {
          await client2.joinById(room1.roomId);
        },
        /Room is full|matchmake failed|not found|locked/i,
        'Second client must be rejected from joining single player room'
      );
    } finally {
      await room1.leave().catch(() => {});
    }
  });

  test('abnormal disconnect allows reconnection with token, preserving state without secret leak, and rejects replacement unauthorized joins', { timeout: 15000 }, async () => {
    const client1 = new Client(serverUrl);
    const room1 = await client1.create<any>('classic_26');
    let reconnectedRoom: Room | null = null;
    try {
      // Request initial snapshot to get gameId
      const snap = await sendAndExpect<PublicSnapshot>(room1, 'request_snapshot', {}, 'snapshot', 5000);
      assert.equal(snap.phase, 'SELECTING');

      // Make 1 move using authoritative gameId
      const moveRes = await sendAndExpect<CommandResult>(room1, 'command', {
        type: 'SELECT_BOX',
        gameId: snap.gameId,
        stateVersion: 1,
        commandSequence: 1,
        idempotencyKey: 'rec_k1',
        boxId: 5
      }, 'command_result', 5000);
      assert.equal(moveRes.success, true);
      assert.equal(moveRes.stateVersion, 2);

      const token = room1.reconnectionToken;
      assert.ok(token);

      // Simulate unexpected drop: close underlying socket directly
      (room1.connection as any).transport.ws.close();

      // Wait a brief tick for server to register onLeave
      await new Promise((r) => setTimeout(r, 150));

      // A third unauthorized client tries to join the room while owner is disconnected -> MUST BE REJECTED!
      const unauthorizedClient = new Client(serverUrl);
      await assert.rejects(
        async () => {
          await unauthorizedClient.joinById(room1.roomId);
        },
        /Room is single-player and locked to original owner|matchmake failed|not found|locked/i,
        'Unauthorized client must not replace disconnected owner'
      );

      // Reconnect with client2 using original owner token
      await assert.rejects(
        () => new Client(serverUrl).reconnect(room1.roomId + ':invalid_token_xyz_123'),
        /reconnect|token|expired/i,
        'Invalid token cannot recover a live reserved room'
      );
      const client2 = new Client(serverUrl);
      reconnectedRoom = await client2.reconnect(token);
      assert.equal(reconnectedRoom.sessionId, room1.sessionId);

      // Request snapshot on reconnected room
      const reconnectedSnap = await sendAndExpect<PublicSnapshot>(reconnectedRoom, 'request_snapshot', {}, 'snapshot', 5000);

      assert.equal(reconnectedSnap.stateVersion, 2);
      assert.equal(reconnectedSnap.currentPlayerBoxId, 5);
      assert.equal(reconnectedSnap.phase, 'OPENING');

      // Verify fairness commitment stability and zero secret leak on reconnection
      assert.equal(reconnectedSnap.fairness?.commitment, snap.fairness?.commitment);
      assert.ok(reconnectedSnap.fairness?.commitment);
      assert.equal((reconnectedSnap as any).seed, undefined);
      assert.equal((reconnectedSnap as any).salt, undefined);

      // Verify no secret leak
      for (const b of reconnectedSnap.boxes) {
        if (b.status !== 'opened') {
          assert.equal('amount' in b, false);
          assert.equal('value' in b, false);
          assert.equal('revealedAmount' in b, false);
        }
      }
    } finally {
      if (reconnectedRoom) {
        await reconnectedRoom.leave().catch(() => {});
      }
      // Note: room1 underlying socket was closed; calling room1.leave() would hang
    }
  });

  test('rejects room creation with injected cheat parameters', { timeout: 15000 }, async () => {
    const client = new Client(serverUrl);
    await assert.rejects(
      async () => {
        await client.create('classic_26', {
          customBoxAmountMap: [1, 2, 3]
        } as any);
      },
      /Custom game configuration is not permitted via network/i,
      'Room creation with injected custom values must be rejected'
    );
  });

  test('rejects room creation with invalid aiType', { timeout: 15000 }, async () => {
    const client = new Client(serverUrl);
    await assert.rejects(
      async () => {
        await client.create('classic_26', {
          aiType: 'non_existent_ai'
        } as any);
      },
      /Invalid aiType/i,
      'Room creation with invalid aiType must be rejected'
    );
  });

  test('reconnection to a disposed room is rejected', { timeout: 15000 }, async () => {
    const client = new Client(serverUrl);
    const room = await client.create<any>('classic_26');
    const roomId = room.roomId;
    await room.leave().catch(() => {});

    const bogusClient = new Client(serverUrl);
    await assert.rejects(
      async () => {
        await bogusClient.reconnect(roomId + ':invalid_token_xyz_123');
      },
      /reconnection token|matchmake failed|not found|disposed/i
    );
  });
});

