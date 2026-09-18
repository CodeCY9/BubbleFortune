import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { AuctionEngine } from '../../src/engine/AuctionEngine';
import { FakeClock } from '../../src/engine/clock';
import {
  AUCTION_INITIAL_CAPITAL,
  AUCTION_MIN_PLAYERS,
  AUCTION_MAX_PLAYERS,
  AUCTION_RULE_VERSION,
  AuctionCommand
} from '../../../../packages/protocol/src/auction';

function setupLobby(playerCount = 3, clock?: FakeClock) {
  const fakeClock = clock || new FakeClock(1000000);
  const engine = new AuctionEngine({
    roomId: 'test_auction_room',
    matchId: 'test_auction_match',
    clock: fakeClock
  });

  const seatIds: number[] = [];
  for (let i = 0; i < playerCount; i++) {
    const seatId = engine.assignNextAvailableSeat(`Player_${i + 1}`);
    assert.notEqual(seatId, null);
    seatIds.push(seatId!);
  }

  return { engine, clock: fakeClock, seatIds };
}

function readyAndStart(engine: AuctionEngine, seatIds: number[]) {
  for (let i = 0; i < seatIds.length; i++) {
    const sId = seatIds[i];
    const res = engine.processCommand(sId, {
      type: 'READY',
      ready: true,
      stateVersion: engine.getStateVersion(),
      commandSequence: 1,
      idempotencyKey: `ready_${sId}`
    });
    assert.equal(res.success, true);
  }

  // Host starts
  const startRes = engine.processCommand(seatIds[0], {
    type: 'START',
    stateVersion: engine.getStateVersion(),
    commandSequence: 2,
    idempotencyKey: 'start_game'
  });
  assert.equal(startRes.success, true);
  assert.equal(engine.getPhase(), 'SELECTING');
}

describe('AuctionEngine - Room, Lobby & Start Requirements', () => {
  test('room configuration defaults to isPrivate=false, ranked=true, allowSpectators=true, and preserves custom settings', () => {
    const defaultEngine = new AuctionEngine({ roomId: 'default_room' });
    assert.equal(defaultEngine.isPrivate, false);
    assert.equal(defaultEngine.ranked, true);
    assert.equal(defaultEngine.allowSpectators, true);
    const defSnap = defaultEngine.getPublicSnapshot();
    assert.equal(defSnap.isPrivate, false);
    assert.equal(defSnap.ranked, true);
    assert.equal(defSnap.allowSpectators, true);

    const customEngine = new AuctionEngine({
      roomId: 'custom_room',
      isPrivate: true,
      ranked: false,
      allowSpectators: false
    });
    assert.equal(customEngine.isPrivate, true);
    assert.equal(customEngine.ranked, false);
    assert.equal(customEngine.allowSpectators, false);
    const customSnap = customEngine.getPublicSnapshot();
    assert.equal(customSnap.isPrivate, true);
    assert.equal(customSnap.ranked, false);
    assert.equal(customSnap.allowSpectators, false);
  });

  test('rejects starting with fewer than minimum players (3)', () => {
    const { engine, seatIds } = setupLobby(2);
    // Ready both
    engine.processCommand(seatIds[0], {
      type: 'READY',
      ready: true,
      stateVersion: engine.getStateVersion(),
      commandSequence: 1,
      idempotencyKey: 'ready_0'
    });
    engine.processCommand(seatIds[1], {
      type: 'READY',
      ready: true,
      stateVersion: engine.getStateVersion(),
      commandSequence: 1,
      idempotencyKey: 'ready_1'
    });

    const startRes = engine.processCommand(seatIds[0], {
      type: 'START',
      stateVersion: engine.getStateVersion(),
      commandSequence: 2,
      idempotencyKey: 'start_fail'
    });
    assert.equal(startRes.success, false);
    assert.equal(startRes.error?.code, 'INVALID_PAYLOAD');
  });

  test('rejects start if not all players are ready', () => {
    const { engine, seatIds } = setupLobby(3);
    // Only 2 ready
    engine.processCommand(seatIds[0], {
      type: 'READY',
      ready: true,
      stateVersion: engine.getStateVersion(),
      commandSequence: 1,
      idempotencyKey: 'ready_0'
    });
    engine.processCommand(seatIds[1], {
      type: 'READY',
      ready: true,
      stateVersion: engine.getStateVersion(),
      commandSequence: 1,
      idempotencyKey: 'ready_1'
    });

    const startRes = engine.processCommand(seatIds[0], {
      type: 'START',
      stateVersion: engine.getStateVersion(),
      commandSequence: 2,
      idempotencyKey: 'start_not_ready'
    });
    assert.equal(startRes.success, false);
    assert.equal(startRes.error?.code, 'INVALID_PHASE');
  });

  test('non-host player cannot start the match', () => {
    const { engine, seatIds } = setupLobby(3);
    for (const sId of seatIds) {
      engine.processCommand(sId, {
        type: 'READY',
        ready: true,
        stateVersion: engine.getStateVersion(),
        commandSequence: 1,
        idempotencyKey: `ready_${sId}`
      });
    }

    const startRes = engine.processCommand(seatIds[1], {
      type: 'START',
      stateVersion: engine.getStateVersion(),
      commandSequence: 2,
      idempotencyKey: 'start_non_host'
    });
    assert.equal(startRes.success, false);
    assert.equal(startRes.error?.code, 'UNAUTHORIZED');
  });
});

describe('AuctionEngine - Secret Isolation & Projections', () => {
  test('public snapshot never leaks unopened box amounts, secret bids, or other players capital', () => {
    const { engine, seatIds } = setupLobby(3);
    readyAndStart(engine, seatIds);

    const pubSnap = engine.getPublicSnapshot();
    // 1. Boxes check: all unopened boxes have NO amount field
    for (const box of pubSnap.boxes) {
      if (box.status !== 'opened') {
        assert.equal((box as any).amount, undefined);
        assert.equal((box as any).revealedAmount, undefined);
      }
    }

    // 2. Seats check: public seat info does NOT include capital
    for (const seat of pubSnap.seats) {
      assert.equal((seat as any).capital, undefined);
      assert.equal((seat as any).remainingCapital, undefined);
    }

    // 3. Private view check: seat 0 sees its own capital
    const priv0 = engine.getClientSnapshot(seatIds[0]).private;
    assert.equal(priv0.myCapital, AUCTION_INITIAL_CAPITAL);

    // 4. Fairness check: commitments published, but NO secret seeds or mappings
    assert.ok(pubSnap.fairnessCommitments[1]);
    assert.equal((pubSnap as any).seed, undefined);
    assert.equal((pubSnap as any).salt, undefined);
    assert.equal((pubSnap as any).boxAmountMap, undefined);
  });
});

describe('AuctionEngine - Sealed Bidding, Tie-Breaking & Challenger Decision', () => {
  test('sealed bids: capitalists submit bids, tie-breaks by receive sequence, challenger does not see bidder identity', () => {
    const { engine, seatIds } = setupLobby(3);
    readyAndStart(engine, seatIds);

    // Challenger is seat 0
    const snap = engine.getPublicSnapshot();
    assert.equal(snap.challengerSeatId, seatIds[0]);

    // Seat 0 selects lucky box 1
    const selRes = engine.processCommand(seatIds[0], {
      type: 'SELECT_BOX',
      boxId: 1,
      stateVersion: engine.getStateVersion(),
      commandSequence: 3,
      idempotencyKey: 'sel_1'
    });
    assert.equal(selRes.success, true);
    assert.equal(engine.getPhase(), 'OPENING');

    // Challenger opens 6 boxes (box 2 to 7) for round 1
    for (let b = 2; b <= 7; b++) {
      const openRes = engine.processCommand(seatIds[0], {
        type: 'OPEN_BOX',
        boxId: b,
        stateVersion: engine.getStateVersion(),
        commandSequence: 2 + b,
        idempotencyKey: `open_${b}`
      });
      assert.equal(openRes.success, true);
    }

    // Round 1 opening quota (6 boxes) fulfilled -> transitions to BIDDING
    assert.equal(engine.getPhase(), 'BIDDING');

    // Capitalists are seat 1 and seat 2
    // Seat 1 submits bid 50,000
    const bid1Res = engine.processCommand(seatIds[1], {
      type: 'SUBMIT_BID',
      amount: 50000,
      stateVersion: engine.getStateVersion(),
      commandSequence: 2,
      idempotencyKey: 'bid_1'
    });
    assert.equal(bid1Res.success, true);

    // Seat 1 cannot submit a second bid
    const dupBid1 = engine.processCommand(seatIds[1], {
      type: 'SUBMIT_BID',
      amount: 60000,
      stateVersion: engine.getStateVersion(),
      commandSequence: 3,
      idempotencyKey: 'bid_1_dup'
    });
    assert.equal(dupBid1.success, false);
    assert.equal(dupBid1.error?.code, 'INVALID_PHASE');

    // Public snapshot during BIDDING: reveals seatIds that submitted, but NOT amounts
    const biddingPub = engine.getPublicSnapshot();
    assert.deepEqual(biddingPub.bidsSubmittedSeats, [seatIds[1]]);
    assert.equal(biddingPub.currentOffer, null);

    // Seat 2 submits identical bid 50,000 (tie case!)
    const bid2Res = engine.processCommand(seatIds[2], {
      type: 'SUBMIT_BID',
      amount: 50000,
      stateVersion: engine.getStateVersion(),
      commandSequence: 2,
      idempotencyKey: 'bid_2'
    });
    assert.equal(bid2Res.success, true);

    // All active capitalists have submitted -> auto transitions to OFFERING
    assert.equal(engine.getPhase(), 'OFFERING');

    // Check public offer: amount is 50,000
    const offerPub = engine.getPublicSnapshot().currentOffer;
    assert.ok(offerPub);
    assert.equal(offerPub.amount, 50000);
    // CRITICAL: Public snapshot and Challenger do NOT see winning seat ID!
    assert.equal((offerPub as any).winningSeatId, undefined);
    assert.equal((offerPub as any).bankerSeatId, undefined);

    // Challenger accepts the offer
    const accRes = engine.processCommand(seatIds[0], {
      type: 'ACCEPT_OFFER',
      offerId: offerPub.offerId,
      stateVersion: engine.getStateVersion(),
      commandSequence: 10,
      idempotencyKey: 'accept_offer_1'
    });
    assert.equal(accRes.success, true);
    assert.equal(engine.getPhase(), 'ROUND_COMPLETE');

    // In round result: Tie break was resolved in favor of Seat 1 (earlier receive sequence)
    const roundResults = engine.getPublicSnapshot().roundResults;
    assert.equal(roundResults.length, 1);
    const r1 = roundResults[0];
    assert.equal(r1.winningCapitalistSeatId, seatIds[1]);
    assert.equal(r1.winningBidAmount, 50000);
    assert.equal(r1.challengerProfit, 50000);

    // Capital checks:
    // Seat 1 paid 50,000: remaining capital = 1,000,000 - 50,000 = 950,000
    const privSeat1 = engine.getClientSnapshot(seatIds[1]).private;
    assert.equal(privSeat1.myCapital, AUCTION_INITIAL_CAPITAL - 50000);

    // Seat 2 lost bid: remaining capital UNCHANGED (1,000,000)
    const privSeat2 = engine.getClientSnapshot(seatIds[2]).private;
    assert.equal(privSeat2.myCapital, AUCTION_INITIAL_CAPITAL);
  });

  test('bidding reject offer: bids released, no capital deducted, continue opening boxes', () => {
    const { engine, seatIds } = setupLobby(3);
    readyAndStart(engine, seatIds);

    // Seat 0 selects box 1
    engine.processCommand(seatIds[0], {
      type: 'SELECT_BOX',
      boxId: 1,
      stateVersion: engine.getStateVersion(),
      commandSequence: 3,
      idempotencyKey: 'sel_1'
    });

    // Open 6 boxes (2..7)
    for (let b = 2; b <= 7; b++) {
      engine.processCommand(seatIds[0], {
        type: 'OPEN_BOX',
        boxId: b,
        stateVersion: engine.getStateVersion(),
        commandSequence: 2 + b,
        idempotencyKey: `open_${b}`
      });
    }

    assert.equal(engine.getPhase(), 'BIDDING');

    // Seat 1 bids 100,000; Seat 2 bids 200,000
    engine.processCommand(seatIds[1], {
      type: 'SUBMIT_BID',
      amount: 100000,
      stateVersion: engine.getStateVersion(),
      commandSequence: 2,
      idempotencyKey: 'bid_1'
    });
    engine.processCommand(seatIds[2], {
      type: 'SUBMIT_BID',
      amount: 200000,
      stateVersion: engine.getStateVersion(),
      commandSequence: 2,
      idempotencyKey: 'bid_2'
    });

    assert.equal(engine.getPhase(), 'OFFERING');
    const offer = engine.getPublicSnapshot().currentOffer!;
    assert.equal(offer.amount, 200000);

    // Challenger REJECTS offer
    const rejRes = engine.processCommand(seatIds[0], {
      type: 'REJECT_OFFER',
      offerId: offer.offerId,
      stateVersion: engine.getStateVersion(),
      commandSequence: 10,
      idempotencyKey: 'rej_1'
    });
    assert.equal(rejRes.success, true);

    // Back to OPENING phase for boxRound 2 (target: ROUND_TARGETS[1] = 5 boxes)
    assert.equal(engine.getPhase(), 'OPENING');
    assert.equal(engine.getPublicSnapshot().boxRound, 2);
    assert.equal(engine.getPublicSnapshot().boxesLeftToOpenThisRound, 5);

    // Capitalist balances: both still have full 1,000,000
    assert.equal(engine.getClientSnapshot(seatIds[1]).private.myCapital, AUCTION_INITIAL_CAPITAL);
    assert.equal(engine.getClientSnapshot(seatIds[2]).private.myCapital, AUCTION_INITIAL_CAPITAL);
  });
});

describe('AuctionEngine - Timeouts & Autoplay', () => {
  test('timeouts drive selecting, opening, bidding, offer rejection, final swap, and round rotation', () => {
    const clock = new FakeClock(1000);
    const { engine, seatIds } = setupLobby(3, clock);
    readyAndStart(engine, seatIds);

    // SELECTING timeout (30s) -> auto selects box
    clock.tick(30000);
    assert.equal(engine.getPhase(), 'OPENING');
    assert.ok(engine.getPublicSnapshot().playerBoxId);

    // Drive round 1 entirely with timeouts through 24 boxes opened and FINAL_SWAP
    let safety = 0;
    while (engine.getPhase() !== 'ROUND_COMPLETE' && safety < 100) {
      safety++;
      const ph = engine.getPhase();
      if (ph === 'OPENING') {
        clock.tick(20000); // OPEN_BOX timeout
      } else if (ph === 'BIDDING') {
        clock.tick(20000); // BIDDING timeout (no bids submitted)
      } else if (ph === 'OFFERING') {
        clock.tick(30000); // CHALLENGER_DECISION timeout -> reject
      } else if (ph === 'FINAL_SWAP') {
        clock.tick(30000); // FINAL_SWAP timeout -> keep
      }
    }

    assert.equal(engine.getPhase(), 'ROUND_COMPLETE');
    const r1 = engine.getPublicSnapshot().roundResults[0];
    assert.equal(r1.outcomeType, 'FINAL_KEEP');

    // Advance to round 2 via ROUND_INTERMISSION timeout (30s)
    clock.tick(30000);
    assert.equal(engine.getPhase(), 'SELECTING');
    assert.equal(engine.getPublicSnapshot().roundIndex, 2);
    assert.equal(engine.getPublicSnapshot().challengerSeatId, seatIds[1]); // Rotated to seat 1!
  });
});

describe('AuctionEngine - Forfeits, Disconnects & Survivor Win', () => {
  test('disconnect grace period (120s) and early end when down to 1 survivor', () => {
    const clock = new FakeClock(1000);
    const { engine, seatIds } = setupLobby(3, clock);
    readyAndStart(engine, seatIds);

    // Seat 2 disconnects
    engine.handleClientDisconnect(seatIds[2]);
    assert.equal(engine.getSeat(seatIds[2])?.connected, false);

    // 60s passes (within grace period) -> reconnects
    clock.tick(60000);
    const reconnected = engine.handleClientReconnect(seatIds[2]);
    assert.equal(reconnected, true);
    assert.equal(engine.getSeat(seatIds[2])?.connected, true);

    // Seat 2 disconnects again and expires (120s)
    engine.handleClientDisconnect(seatIds[2]);
    clock.tick(120000);
    assert.equal(engine.getSeat(seatIds[2])?.forfeited, true);

    // Game continues because 2 survivors remain (Seat 0 and Seat 1)
    assert.notEqual(engine.getPhase(), 'FINISHED');

    // Seat 1 voluntarily leaves -> forfeits
    const leaveRes = engine.processCommand(seatIds[1], {
      type: 'LEAVE',
      stateVersion: engine.getStateVersion(),
      commandSequence: 2,
      idempotencyKey: 'leave_1'
    });
    assert.equal(leaveRes.success, true);
    assert.equal(engine.getSeat(seatIds[1])?.forfeited, true);

    // Now only Seat 0 remains (< 2 survivors) -> match finishes immediately with SURVIVOR_WIN
    assert.equal(engine.getPhase(), 'FINISHED');
    const res = engine.getResult()!;
    assert.equal(res.reason, 'SURVIVOR_WIN');
    assert.equal(res.winnerSeatId, seatIds[0]);

    const completed = engine.getCompletedRecord()!;
    assert.ok(completed);
    assert.equal(completed.isPrivate, false);
    assert.equal(completed.ranked, true);
    assert.equal(completed.allowSpectators, true);
  });
});

describe('AuctionEngine - Quick Reactions & Idempotency', () => {
  test('processes whitelisted reactions and rejects unknown ones', () => {
    const { engine } = setupLobby(3);
    const valid = engine.processReaction(true, 'Spectator1', '🎉');
    assert.equal(valid, true);
    assert.equal(engine.getPublicSnapshot().lastReaction?.emoji, '🎉');

    const invalid = engine.processReaction(true, 'Spectator1', '👾');
    assert.equal(invalid, false);
  });

  test('idempotent replay returns cached result with same stateVersion', () => {
    const { engine, seatIds } = setupLobby(3);
    const cmd: AuctionCommand = {
      type: 'READY',
      ready: true,
      stateVersion: engine.getStateVersion(),
      commandSequence: 1,
      idempotencyKey: 'idem_ready'
    };

    const res1 = engine.processCommand(seatIds[0], cmd);
    assert.equal(res1.success, true);
    const verAfter = engine.getStateVersion();

    // Replay same command
    const res2 = engine.processCommand(seatIds[0], cmd);
    assert.equal(res2.success, true);
    assert.equal(engine.getStateVersion(), verAfter); // No state increment

    // Same idempotencyKey with conflicting payload is rejected
    const conflictCmd: AuctionCommand = {
      type: 'READY',
      ready: false,
      stateVersion: engine.getStateVersion(),
      commandSequence: 2,
      idempotencyKey: 'idem_ready'
    };
    const resConflict = engine.processCommand(seatIds[0], conflictCmd);
    assert.equal(resConflict.success, false);
    assert.equal(resConflict.error?.code, 'IDEMPOTENCY_CONFLICT');
  });
});
