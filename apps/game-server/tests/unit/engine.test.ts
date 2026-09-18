import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from '../../src/engine/GameEngine';
import { FakeClock } from '../../src/engine/clock';
import { MONEY_VALUES, TOTAL_BOXES, ROUND_TARGETS } from '../../../../packages/protocol/src/config';
import { validateClientCommand } from '../../../../packages/protocol/src/validation';
import { ClientCommand, PublicSnapshot } from '../../../../packages/protocol/src/types';

function createFixedEngine(clock?: FakeClock) {
  const fakeClock = clock || new FakeClock(1000000);
  // deterministic box amounts: box 1 gets MONEY_VALUES[0], box 2 gets MONEY_VALUES[1], etc.
  const customMap = new Map<number, number>();
  for (let i = 0; i < TOTAL_BOXES; i++) {
    customMap.set(i + 1, MONEY_VALUES[i]);
  }
  const engine = new GameEngine({
    gameId: 'test_game',
    clock: fakeClock,
    customBoxAmountMap: customMap
  });
  return { engine, clock: fakeClock, customMap };
}

describe('GameEngine - 26 independent secure values', () => {
  test('generates exactly 26 boxes matching MONEY_VALUES with random shuffle and completes timeout path to unique settlement', () => {
    const engine = new GameEngine();
    const snapshot = engine.getPublicSnapshot();
    assert.equal(snapshot.boxes.length, 26);
    assert.equal(snapshot.unopenedCount, 26);

    // Drive game via FakeClock timeouts all the way to FINAL_SWAP and settlement
    const clock = new FakeClock(1000);
    const autoEngine = new GameEngine({ clock, gameId: 'timeout_full_game' });
    
    // Selecting timeout (30s) -> auto selects a lucky box
    clock.tick(30000);
    assert.equal(autoEngine.getPhase(), 'OPENING');
    const playerBoxId = autoEngine.getPublicSnapshot().currentPlayerBoxId;
    assert.ok(playerBoxId);

    // Loop through all rounds until FINISHED
    // ROUND_TARGETS = [6, 5, 4, 3, 2, 1, 1, 1, 1] (24 boxes opened by timeouts of 20s, offers rejected by timeouts of 30s)
    let safetyLoop = 0;
    while (autoEngine.getPhase() !== 'FINISHED' && safetyLoop < 100) {
      safetyLoop++;
      const currentPhase = autoEngine.getPhase();
      if (currentPhase === 'OPENING') {
        clock.tick(20000);
      } else if (currentPhase === 'OFFERING') {
        clock.tick(30000);
      } else if (currentPhase === 'FINAL_SWAP') {
        // At FINAL_SWAP, 30s timeout defaults to KEEP_BOX
        clock.tick(30000);
      } else {
        clock.tick(30000);
      }
    }

    assert.equal(autoEngine.getPhase(), 'FINISHED');
    const settlement = autoEngine.getSettlement();
    assert.ok(settlement);
    assert.equal(settlement.outcomeType, 'FINAL_KEEP');
    assert.equal(settlement.originalPlayerBoxId, playerBoxId);
    assert.equal(settlement.finalPlayerBoxId, playerBoxId);

    // Verify allBoxes: exactly 26 boxes, amounts strictly equal to MONEY_VALUES when sorted
    assert.ok(settlement.allBoxes);
    assert.equal(settlement.allBoxes.length, 26);
    const actualSorted = settlement.allBoxes.map(b => b.amount).sort((a, b) => a - b);
    const expectedSorted = [...MONEY_VALUES].sort((a, b) => a - b);
    assert.deepEqual(actualSorted, expectedSorted);

    // Player won amount must match their box amount
    const playerBox = settlement.allBoxes.find(b => b.id === playerBoxId);
    assert.ok(playerBox);
    assert.equal(settlement.wonAmount, playerBox.amount);

    // Verify settlement uniqueness: extra tick does not change resultId
    const initialResultId = settlement.resultId;
    clock.tick(50000);
    assert.equal(autoEngine.getSettlement()?.resultId, initialResultId);
  });
});

describe('GameEngine - Secret Isolation in Snapshots', () => {
  function verifyNoSecretLeak(snapshot: PublicSnapshot) {
    for (const box of snapshot.boxes) {
      if (box.status === 'unopened' || box.status === 'selected') {
        assert.equal('amount' in box, false, `Unopened box ${box.id} must not have 'amount'`);
        assert.equal('value' in box, false, `Unopened box ${box.id} must not have 'value'`);
        assert.equal('revealedAmount' in box, false, `Unopened box ${box.id} must not have 'revealedAmount'`);
      }
    }
    const raw = JSON.stringify(snapshot);
    assert.equal(raw.includes('"boxAmountMap"'), false, 'Snapshot must not contain boxAmountMap');
    assert.equal(raw.includes('"riskFactor"'), false, 'Snapshot must not contain riskFactor');
    assert.equal(raw.includes('"ev"'), false, 'Snapshot must not contain ev');
  }

  test('initial SELECTING snapshot does not leak unopened amounts or banker parameters', () => {
    const { engine } = createFixedEngine();
    const snapshot = engine.getPublicSnapshot();
    assert.equal(snapshot.phase, 'SELECTING');
    verifyNoSecretLeak(snapshot);
  });

  test('OPENING snapshot does not leak unopened amounts', () => {
    const { engine } = createFixedEngine();
    engine.processCommand({
      type: 'SELECT_BOX',
      gameId: 'test_game',
      stateVersion: 1,
      commandSequence: 1,
      idempotencyKey: 'k1',
      boxId: 1
    });
    const snapshot = engine.getPublicSnapshot();
    assert.equal(snapshot.phase, 'OPENING');
    assert.equal(snapshot.currentPlayerBoxId, 1);
    verifyNoSecretLeak(snapshot);
  });

  test('OFFERING snapshot reveals only opened boxes, not remaining unopened or player box', () => {
    const { engine } = createFixedEngine();
    engine.processCommand({
      type: 'SELECT_BOX',
      gameId: 'test_game',
      stateVersion: 1,
      commandSequence: 1,
      idempotencyKey: 'k1',
      boxId: 1
    });

    // Round 1 requires 6 boxes (open boxes 2, 3, 4, 5, 6, 7)
    let ver = 2;
    let seq = 2;
    for (let b = 2; b <= 7; b++) {
      const res = engine.processCommand({
        type: 'OPEN_BOX',
        gameId: 'test_game',
        stateVersion: ver,
        commandSequence: seq,
        idempotencyKey: 'k_open_' + b,
        boxId: b
      });
      assert.equal(res.success, true);
      ver = res.stateVersion;
      seq++;
    }

    const snapshot = engine.getPublicSnapshot();
    assert.equal(snapshot.phase, 'OFFERING');
    assert.ok(snapshot.currentOffer);
    assert.ok(snapshot.currentOffer.amount > 0);
    verifyNoSecretLeak(snapshot);
  });
});

describe('GameEngine - Strict Validations and Rejections', () => {
  test('rejects opening player lucky box during OPENING phase', () => {
    const { engine } = createFixedEngine();
    engine.processCommand({
      type: 'SELECT_BOX',
      gameId: 'test_game',
      stateVersion: 1,
      commandSequence: 1,
      idempotencyKey: 'k1',
      boxId: 1
    });

    const res = engine.processCommand({
      type: 'OPEN_BOX',
      gameId: 'test_game',
      stateVersion: 2,
      commandSequence: 2,
      idempotencyKey: 'k2',
      boxId: 1 // player's box
    });

    assert.equal(res.success, false);
    assert.equal(res.error?.code, 'INVALID_BOX');
    assert.equal(res.stateVersion, 2); // stateVersion does not change on error
  });

  test('rejects out of bound box IDs', () => {
    const { engine } = createFixedEngine();
    const res0 = engine.processCommand({
      type: 'SELECT_BOX',
      gameId: 'test_game',
      stateVersion: 1,
      commandSequence: 1,
      idempotencyKey: 'k1',
      boxId: 0
    });
    assert.equal(res0.success, false);
    assert.equal(res0.error?.code, 'INVALID_BOX');

    const res27 = engine.processCommand({
      type: 'SELECT_BOX',
      gameId: 'test_game',
      stateVersion: 1,
      commandSequence: 1,
      idempotencyKey: 'k2',
      boxId: 27
    });
    assert.equal(res27.success, false);
    assert.equal(res27.error?.code, 'INVALID_BOX');
  });

  test('rejects command in invalid phase', () => {
    const { engine } = createFixedEngine();
    // Cannot OPEN_BOX during SELECTING
    const res = engine.processCommand({
      type: 'OPEN_BOX',
      gameId: 'test_game',
      stateVersion: 1,
      commandSequence: 1,
      idempotencyKey: 'k1',
      boxId: 5
    });
    assert.equal(res.success, false);
    assert.equal(res.error?.code, 'INVALID_PHASE');
  });

  test('rejects stale stateVersion', () => {
    const { engine } = createFixedEngine();
    engine.processCommand({
      type: 'SELECT_BOX',
      gameId: 'test_game',
      stateVersion: 1,
      commandSequence: 1,
      idempotencyKey: 'k1',
      boxId: 1
    });

    // stateVersion is now 2. Sending stateVersion 1 must be rejected
    const res = engine.processCommand({
      type: 'OPEN_BOX',
      gameId: 'test_game',
      stateVersion: 1, // stale!
      commandSequence: 2,
      idempotencyKey: 'k2',
      boxId: 2
    });
    assert.equal(res.success, false);
    assert.equal(res.error?.code, 'STALE_VERSION');
  });

  test('rejects out of sequence command', () => {
    const { engine } = createFixedEngine();
    engine.processCommand({
      type: 'SELECT_BOX',
      gameId: 'test_game',
      stateVersion: 1,
      commandSequence: 1,
      idempotencyKey: 'k1',
      boxId: 1
    });

    // Sequence 1 was last. Sequence 3 (skipping 2) must be rejected
    const res = engine.processCommand({
      type: 'OPEN_BOX',
      gameId: 'test_game',
      stateVersion: 2,
      commandSequence: 3, // out of sequence!
      idempotencyKey: 'k2',
      boxId: 2
    });
    assert.equal(res.success, false);
    assert.equal(res.error?.code, 'OUT_OF_SEQUENCE');
  });

  test('rejects idempotency conflict (same key, different payload)', () => {
    const { engine } = createFixedEngine();
    const res1 = engine.processCommand({
      type: 'SELECT_BOX',
      gameId: 'test_game',
      stateVersion: 1,
      commandSequence: 1,
      idempotencyKey: 'shared_key',
      boxId: 1
    });
    assert.equal(res1.success, true);

    // Reuse shared_key with different payload
    const res2 = engine.processCommand({
      type: 'OPEN_BOX',
      gameId: 'test_game',
      stateVersion: 2,
      commandSequence: 2,
      idempotencyKey: 'shared_key',
      boxId: 2
    });
    assert.equal(res2.success, false);
    assert.equal(res2.error?.code, 'IDEMPOTENCY_CONFLICT');
  });

  test('rejects payload with tampered extra fields (e.g. injected amount)', () => {
    const tampered = {
      type: 'ACCEPT_OFFER',
      gameId: 'test_game',
      stateVersion: 1,
      commandSequence: 1,
      idempotencyKey: 'k1',
      offerId: 'off_1',
      amount: 1000000 // Tampered field!
    };
    const validation = validateClientCommand(tampered);
    assert.equal(validation.valid, false);
    assert.equal(validation.error?.code, 'INVALID_PAYLOAD');
    assert.ok(validation.error?.message.includes('unknown field'));
  });

  test('rejects expired offer or mismatched offerId', () => {
    const { engine, clock } = createFixedEngine();
    engine.processCommand({
      type: 'SELECT_BOX',
      gameId: 'test_game',
      stateVersion: 1,
      commandSequence: 1,
      idempotencyKey: 'k1',
      boxId: 1
    });

    let ver = 2;
    let seq = 2;
    for (let b = 2; b <= 7; b++) {
      const res = engine.processCommand({
        type: 'OPEN_BOX',
        gameId: 'test_game',
        stateVersion: ver,
        commandSequence: seq,
        idempotencyKey: 'k_open_' + b,
        boxId: b
      });
      ver = res.stateVersion;
      seq++;
    }

    const offer = engine.getPublicSnapshot().currentOffer!;
    assert.ok(offer);

    // Wrong offerId
    const resWrong = engine.processCommand({
      type: 'ACCEPT_OFFER',
      gameId: 'test_game',
      stateVersion: ver,
      commandSequence: seq,
      idempotencyKey: 'k_acc_wrong',
      offerId: 'wrong_offer_id'
    });
    assert.equal(resWrong.success, false);
    assert.equal(resWrong.error?.code, 'OFFER_EXPIRED');

    // Advance clock past expiration
    clock.tick(35000); // 35 seconds later
    // Timeout handler auto-rejects offer on expiry!
    assert.equal(engine.getPhase(), 'OPENING');
  });
});

describe('GameEngine - Idempotent Success & Single Settlement', () => {
  test('identical command replay returns exact same result and does not increment stateVersion', () => {
    const { engine } = createFixedEngine();
    const cmd: ClientCommand = {
      type: 'SELECT_BOX',
      gameId: 'test_game',
      stateVersion: 1,
      commandSequence: 1,
      idempotencyKey: 'k_select_1',
      boxId: 10
    };

    const res1 = engine.processCommand(cmd);
    assert.equal(res1.success, true);
    assert.equal(res1.stateVersion, 2);

    // Replay exact same command
    const res2 = engine.processCommand(cmd);
    assert.equal(res2.success, true);
    assert.equal(res2.stateVersion, 2); // Version remains 2!
    assert.deepEqual(res1.event, res2.event);
  });

  test('settlement has unique resultId and is never overwritten on duplicate command', () => {
    const { engine } = createFixedEngine();
    engine.processCommand({
      type: 'SELECT_BOX',
      gameId: 'test_game',
      stateVersion: 1,
      commandSequence: 1,
      idempotencyKey: 'k1',
      boxId: 1
    });

    let ver = 2;
    let seq = 2;
    for (let b = 2; b <= 7; b++) {
      const res = engine.processCommand({
        type: 'OPEN_BOX',
        gameId: 'test_game',
        stateVersion: ver,
        commandSequence: seq,
        idempotencyKey: 'k_open_' + b,
        boxId: b
      });
      ver = res.stateVersion;
      seq++;
    }

    const offerId = engine.getPublicSnapshot().currentOffer!.offerId;
    const acceptCmd: ClientCommand = {
      type: 'ACCEPT_OFFER',
      gameId: 'test_game',
      stateVersion: ver,
      commandSequence: seq,
      idempotencyKey: 'k_accept',
      offerId
    };

    const res1 = engine.processCommand(acceptCmd);
    assert.equal(res1.success, true);
    assert.equal(engine.getPhase(), 'FINISHED');
    const settlement1 = engine.getSettlement()!;
    assert.ok(settlement1.resultId);

    // Replay accept command
    const res2 = engine.processCommand(acceptCmd);
    assert.equal(res2.success, true);
    const settlement2 = engine.getSettlement()!;
    assert.equal(settlement1.resultId, settlement2.resultId);
    assert.equal(settlement1.wonAmount, settlement2.wonAmount);
  });
});

describe('GameEngine - 24 Boxes Boundary and FINAL_SWAP', () => {
  test('rejects keep/swap during first 24 boxes, then reaches FINAL_SWAP and handles keep/swap', () => {
    const { engine } = createFixedEngine();

    // Select box 1
    engine.processCommand({
      type: 'SELECT_BOX',
      gameId: 'test_game',
      stateVersion: 1,
      commandSequence: 1,
      idempotencyKey: 'k1',
      boxId: 1
    });

    // Before 24 boxes: KEEP_BOX and SWAP_BOX must be rejected
    const keepEarly = engine.processCommand({
      type: 'KEEP_BOX',
      gameId: 'test_game',
      stateVersion: 2,
      commandSequence: 2,
      idempotencyKey: 'k_early_keep'
    });
    assert.equal(keepEarly.success, false);
    assert.equal(keepEarly.error?.code, 'INVALID_PHASE');

    // Open boxes 2 through 25 (total 24 boxes opened!)
    // We open round by round, rejecting offers along the way
    let ver = 2;
    let seq = 2;
    let currentBox = 2;

    for (let round = 0; round < ROUND_TARGETS.length; round++) {
      const target = ROUND_TARGETS[round];
      for (let i = 0; i < target; i++) {
        const res = engine.processCommand({
          type: 'OPEN_BOX',
          gameId: 'test_game',
          stateVersion: ver,
          commandSequence: seq,
          idempotencyKey: 'open_' + currentBox,
          boxId: currentBox
        });
        assert.equal(res.success, true, `Failed opening box ${currentBox}`);
        ver = res.stateVersion;
        seq++;
        currentBox++;
      }

      if (round < ROUND_TARGETS.length - 1) {
        // Banker offer phase
        assert.equal(engine.getPhase(), 'OFFERING');
        const offerId = engine.getPublicSnapshot().currentOffer!.offerId;
        const rejRes = engine.processCommand({
          type: 'REJECT_OFFER',
          gameId: 'test_game',
          stateVersion: ver,
          commandSequence: seq,
          idempotencyKey: 'rej_' + round,
          offerId
        });
        assert.equal(rejRes.success, true);
        ver = rejRes.stateVersion;
        seq++;
      }
    }

    // Now 24 boxes opened! Total unopened = 2 (Box 1 and Box 26)
    assert.equal(engine.getPhase(), 'FINAL_SWAP');
    const snap = engine.getPublicSnapshot();
    assert.equal(snap.unopenedCount, 2);
    assert.equal(snap.currentOffer, null); // No offer in FINAL_SWAP!

    // In FINAL_SWAP: ACCEPT_OFFER and REJECT_OFFER must be rejected!
    const accFinal = engine.processCommand({
      type: 'ACCEPT_OFFER',
      gameId: 'test_game',
      stateVersion: ver,
      commandSequence: seq,
      idempotencyKey: 'k_acc_final',
      offerId: 'dummy'
    });
    assert.equal(accFinal.success, false);
    assert.equal(accFinal.error?.code, 'INVALID_PHASE');

    // In FINAL_SWAP: SWAP_BOX to box 26 succeeds!
    const swapRes = engine.processCommand({
      type: 'SWAP_BOX',
      gameId: 'test_game',
      stateVersion: ver,
      commandSequence: seq,
      idempotencyKey: 'k_swap_final',
      targetBoxId: 26
    });
    assert.equal(swapRes.success, true);
    assert.equal(engine.getPhase(), 'FINISHED');

    const settlement = engine.getSettlement()!;
    assert.equal(settlement.outcomeType, 'FINAL_SWAP');
    assert.equal(settlement.originalPlayerBoxId, 1);
    assert.equal(settlement.finalPlayerBoxId, 26);
    assert.equal(settlement.wonAmount, MONEY_VALUES[25]); // Box 26 amount
    assert.equal(settlement.allBoxes?.length, 26);
  });
});

describe('GameEngine - Fake Clock Timeouts', () => {
  test('SELECTING phase timeout auto-selects box in 30s', () => {
    const clock = new FakeClock(1000);
    const engine = new GameEngine({ clock });
    assert.equal(engine.getPhase(), 'SELECTING');

    // Advance 30 seconds
    clock.tick(30001);
    assert.equal(engine.getPhase(), 'OPENING');
    assert.ok(engine.getCurrentPlayerBoxId() !== null);
  });

  test('OPENING phase timeout auto-opens unopened box in 20s', () => {
    const clock = new FakeClock(1000);
    const engine = new GameEngine({ clock });
    // Advance selecting
    clock.tick(30001);
    assert.equal(engine.getPhase(), 'OPENING');
    const snapBefore = engine.getPublicSnapshot();
    const openedBefore = snapBefore.totalOpenedBoxes;

    // Advance 20 seconds
    clock.tick(20001);
    const snapAfter = engine.getPublicSnapshot();
    assert.equal(snapAfter.totalOpenedBoxes, openedBefore + 1);
  });

  test('OFFERING phase timeout auto-rejects offer in 30s', () => {
    const clock = new FakeClock(1000);
    const engine = new GameEngine({ clock });
    // Selecting
    engine.processCommand({
      type: 'SELECT_BOX',
      gameId: engine.gameId,
      stateVersion: 1,
      commandSequence: 1,
      idempotencyKey: 'k1',
      boxId: 1
    });

    // Open 6 boxes in round 1
    let ver = 2;
    let seq = 2;
    for (let b = 2; b <= 7; b++) {
      const res = engine.processCommand({
        type: 'OPEN_BOX',
        gameId: engine.gameId,
        stateVersion: ver,
        commandSequence: seq,
        idempotencyKey: 'open_' + b,
        boxId: b
      });
      ver = res.stateVersion;
      seq++;
    }

    assert.equal(engine.getPhase(), 'OFFERING');
    // Advance 30s
    clock.tick(30001);
    // Auto-rejected offer, now back to OPENING in round 2!
    assert.equal(engine.getPhase(), 'OPENING');
    assert.equal(engine.getPublicSnapshot().currentRound, 2);
  });

  test('mutating command arriving at or after deadline triggers timeout first and rejects command', () => {
    const clock = new FakeClock(1000);
    const engine = new GameEngine({ clock, gameId: 'deadline_test' });
    assert.equal(engine.getPhase(), 'SELECTING');

    // Fast-forward clock to exactly deadline (now + 30_000 = 31_000)
    clock.tick(30000);

    // Player tries to select box late
    const lateRes = engine.processCommand({
      type: 'SELECT_BOX',
      gameId: 'deadline_test',
      stateVersion: 1,
      commandSequence: 1,
      idempotencyKey: 'late_select',
      boxId: 5
    });

    // Authoritative timeout executed first -> state changed to OPENING, command rejected as STALE_VERSION
    assert.equal(lateRes.success, false);
    assert.equal(lateRes.error?.code, 'STALE_VERSION');
    assert.equal(engine.getPhase(), 'OPENING');
  });

  test('processCommand intercepts command arriving at exact deadline (now >= deadlineTimestamp) without timer callback, and accepts command at deadline - 1ms', () => {
    class ManualNowClock {
      public currentTime = 1000;
      now() {
        return this.currentTime;
      }
      setTimeout(_fn: () => void, _ms: number) {
        return { cancel() {} };
      }
    }

    const clock = new ManualNowClock();
    const engine = new GameEngine({ clock, gameId: 'precise_deadline' });
    assert.equal(engine.getPhase(), 'SELECTING');
    // Selecting timeout is 30s -> deadline is 1000 + 30000 = 31000

    // 1. At deadline - 1ms (30999), mutating command must succeed!
    clock.currentTime = 30999;
    const okRes = engine.processCommand({
      type: 'SELECT_BOX',
      gameId: 'precise_deadline',
      stateVersion: 1,
      commandSequence: 1,
      idempotencyKey: 'valid_at_minus_1ms',
      boxId: 7
    });
    assert.equal(okRes.success, true);
    assert.equal(okRes.stateVersion, 2);
    assert.equal(engine.getPhase(), 'OPENING');
    // Opening timeout is 20s -> new deadline is 30999 + 20000 = 50999

    // 2. At exact deadline (50999), processCommand directly executes timeout and rejects mutating command as STALE_VERSION
    clock.currentTime = 50999;
    const lateRes = engine.processCommand({
      type: 'OPEN_BOX',
      gameId: 'precise_deadline',
      stateVersion: 2,
      commandSequence: 2,
      idempotencyKey: 'late_at_exact_deadline',
      boxId: 9
    });
    assert.equal(lateRes.success, false);
    assert.equal(lateRes.error?.code, 'STALE_VERSION');
    assert.equal(lateRes.idempotencyKey, 'late_at_exact_deadline');
    assert.ok(lateRes.snapshot);
    // Timeout was executed authoritatively: stateVersion became 3
    assert.equal(lateRes.snapshot.stateVersion, 3);
  });

  test('idempotent replay of earlier success still returns cached result even after deadline', () => {
    const clock = new FakeClock(1000);
    const engine = new GameEngine({ clock, gameId: 'deadline_idemp' });

    const cmd: ClientCommand = {
      type: 'SELECT_BOX',
      gameId: 'deadline_idemp',
      stateVersion: 1,
      commandSequence: 1,
      idempotencyKey: 'timely_select',
      boxId: 3
    };

    const res1 = engine.processCommand(cmd);
    assert.equal(res1.success, true);
    assert.equal(res1.stateVersion, 2);

    // Advance clock past deadline
    clock.tick(50000);

    // Replay the exact same command
    const res2 = engine.processCommand(cmd);
    assert.equal(res2.success, true);
    assert.equal(res2.stateVersion, 2);
    assert.equal(res2.idempotencyKey, 'timely_select');
  });

  test('rejects command with wrong gameId', () => {
    const { engine } = createFixedEngine();
    const res = engine.processCommand({
      type: 'SELECT_BOX',
      gameId: 'completely_wrong_game_id',
      stateVersion: 1,
      commandSequence: 1,
      idempotencyKey: 'k_wrong_game',
      boxId: 1
    });
    assert.equal(res.success, false);
    assert.equal(res.error?.code, 'INVALID_PAYLOAD');
  });

  test('canonical idempotency handles property key reordering', () => {
    const { engine } = createFixedEngine();
    // cmd1 with keys in order A
    const cmd1: any = {
      type: 'SELECT_BOX',
      gameId: 'test_game',
      stateVersion: 1,
      commandSequence: 1,
      idempotencyKey: 'canonical_k',
      boxId: 1
    };

    const res1 = engine.processCommand(cmd1);
    assert.equal(res1.success, true);

    // cmd2 with same properties in different order
    const cmd2: any = {
      boxId: 1,
      idempotencyKey: 'canonical_k',
      commandSequence: 1,
      stateVersion: 1,
      gameId: 'test_game',
      type: 'SELECT_BOX'
    };

    const res2 = engine.processCommand(cmd2);
    assert.equal(res2.success, true);
    assert.equal(res2.stateVersion, res1.stateVersion);
  });

  test('snapshot contains lastCommandSequence and serverNow; command result snapshot reflects newly accepted sequence', () => {
    const { engine, clock } = createFixedEngine();
    const initialSnap = engine.getPublicSnapshot();
    assert.equal(initialSnap.lastCommandSequence, 0);
    assert.equal(initialSnap.serverNow, clock.now());

    const res = engine.processCommand({
      type: 'SELECT_BOX',
      gameId: 'test_game',
      stateVersion: 1,
      commandSequence: 1,
      idempotencyKey: 'seq_k1',
      boxId: 8
    });

    assert.equal(res.success, true);
    assert.ok(res.snapshot);
    // Snapshot inside result must have lastCommandSequence === 1
    assert.equal(res.snapshot.lastCommandSequence, 1);
    assert.equal(res.idempotencyKey, 'seq_k1');
  });

  test('rejects invalid payload at engine entry and returns public snapshot and legal idempotencyKey', () => {
    const { engine } = createFixedEngine();
    const res = engine.processCommand({
      type: 'INVALID_TYPE',
      idempotencyKey: 'valid_idemp_key'
    });
    assert.equal(res.success, false);
    assert.equal(res.error?.code, 'INVALID_PAYLOAD');
    assert.equal(res.idempotencyKey, 'valid_idemp_key');
    assert.ok(res.snapshot);
  });

  test('broadcast event snapshot and command result snapshot have identical sequence and stateVersion', () => {
    const { engine } = createFixedEngine();
    let broadcastSnap: PublicSnapshot | null = null;
    engine.setOnEventHandler((_event, snapshot) => {
      broadcastSnap = snapshot;
    });

    const res = engine.processCommand({
      type: 'SELECT_BOX',
      gameId: 'test_game',
      stateVersion: 1,
      commandSequence: 1,
      idempotencyKey: 'bc_seq_1',
      boxId: 4
    });

    assert.equal(res.success, true);
    assert.ok(broadcastSnap);
    assert.ok(res.snapshot);
    const bSnap = broadcastSnap as PublicSnapshot;
    const rSnap = res.snapshot as PublicSnapshot;
    assert.equal(bSnap.lastCommandSequence, rSnap.lastCommandSequence);
    assert.equal(bSnap.stateVersion, rSnap.stateVersion);
    assert.equal(bSnap.lastCommandSequence, 1);
    assert.equal(bSnap.stateVersion, 2);
  });
});

