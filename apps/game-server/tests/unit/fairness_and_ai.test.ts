import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from '../../src/engine/GameEngine';
import { FakeClock } from '../../src/engine/clock';
import {
  MONEY_VALUES,
  ROUND_TARGETS,
  RULE_VERSION,
  TOTAL_BOXES
} from '../../../../packages/protocol/src/config';
import {
  FAIRNESS_ALGORITHM,
  verifyFairnessProof,
  verifyAuditTrailWebCrypto,
  computeCommitmentWebCrypto,
  shuffleWithHmacFyWebCrypto,
  GENESIS_PREVIOUS_HASH
} from '../../../../packages/protocol/src/fairness';
import { verifyAuditTrailSync } from '../../src/engine/audit';
import { calculateBankerOffer as calculateAiBankerOffer } from '../../src/engine/ai';
import { canonicalJsonStringify } from '../../../../packages/protocol/src/canonical';

const FIXED_VECTOR = {
  seed: '00'.repeat(32),
  salt: '11'.repeat(32),
  gameId: 'fairness-vector-1',
  ruleVersion: 'classic-26-v1',
  algorithm: 'hmac-sha256-fy-v1',
  commitment: '0440068d20082bb60b6d8d6d3571d8e9b7d17788597312f0d01ab7b45ecd9996',
  counter: 25,
  mapping: [
    750, 1, 1000, 50, 200000, 100000, 10000, 5, 2500, 500, 300, 75,
    300000, 500000, 400000, 400, 100, 750000, 10, 75000, 25000, 200,
    1000000, 5000, 50000, 25
  ]
};

// Recursive inspector to ensure absolutely no secret/seed/salt/unopened amount leaks
function assertNoSecrets(obj: unknown, path = 'root'): void {
  if (obj === null || typeof obj !== 'object') {
    return;
  }

  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      assertNoSecrets(obj[i], `${path}[${i}]`);
    }
    return;
  }

  const record = obj as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    const lower = key.toLowerCase();
    assert.ok(
      lower !== 'seed' && lower !== 'salt' && lower !== 'boxamountmap',
      `Secret leak detected at ${path}.${key}`
    );

    // If box object in snapshot is unopened or selected, it must never contain amount or revealedAmount
    if (record.status === 'unopened' || record.status === 'selected') {
      assert.equal(
        record.revealedAmount,
        undefined,
        `Secret box amount leaked on ${record.status} box at ${path}`
      );
      assert.equal(
        record.amount,
        undefined,
        `Secret box amount leaked on ${record.status} box at ${path}`
      );
    }

    assertNoSecrets(record[key], `${path}.${key}`);
  }
}

describe('Fairness V1 - Fixed Test Vector & Verification', () => {
  test('matches upstream Codex Python independent calculation exactly', async (t) => {
    // 1. Verify commitment calculation with WebCrypto
    const commitment = await computeCommitmentWebCrypto({
      algorithm: FIXED_VECTOR.algorithm,
      amounts: MONEY_VALUES,
      gameId: FIXED_VECTOR.gameId,
      roundTargets: ROUND_TARGETS,
      ruleVersion: FIXED_VECTOR.ruleVersion,
      salt: FIXED_VECTOR.salt,
      seed: FIXED_VECTOR.seed
    });
    assert.equal(commitment, FIXED_VECTOR.commitment);

    // 2. Verify Fisher-Yates HMAC-SHA256 shuffle with WebCrypto
    const { values, counter } = await shuffleWithHmacFyWebCrypto(
      FIXED_VECTOR.seed,
      FIXED_VECTOR.salt,
      MONEY_VALUES
    );
    assert.equal(counter, FIXED_VECTOR.counter);
    assert.deepEqual(values, FIXED_VECTOR.mapping);

    // 3. Verify via GameEngine initialization using FakeClock
    const clock = new FakeClock(1000);
    const engine = new GameEngine({
      gameId: FIXED_VECTOR.gameId,
      seed: FIXED_VECTOR.seed,
      salt: FIXED_VECTOR.salt,
      clock
    });
    t.after(() => engine.dispose());

    const snapshot = engine.getPublicSnapshot();
    assert.equal(snapshot.fairness?.supported, true);
    assert.equal(snapshot.fairness?.algorithm, 'hmac-sha256-fy-v1');
    assert.equal(snapshot.fairness?.commitment, FIXED_VECTOR.commitment);
  });

  test('full game using fixed vector produces verifiable proof matching initial commitment', async (t) => {
    const clock = new FakeClock(1000);
    const engine = new GameEngine({
      gameId: FIXED_VECTOR.gameId,
      seed: FIXED_VECTOR.seed,
      salt: FIXED_VECTOR.salt,
      clock
    });
    t.after(() => engine.dispose());

    const initialCommitment = engine.getPublicSnapshot().fairness?.commitment!;
    assert.equal(initialCommitment, FIXED_VECTOR.commitment);

    // Select box 1
    engine.processCommand({
      type: 'SELECT_BOX',
      boxId: 1,
      gameId: FIXED_VECTOR.gameId,
      stateVersion: 1,
      commandSequence: 1,
      idempotencyKey: 'cmd_sel_1'
    });

    // Open boxes 2, 3, 4, 5, 6, 7 (round 1 completes: 6 boxes)
    let seq = 2;
    let v = 2;
    for (let b = 2; b <= 7; b++) {
      const res = engine.processCommand({
        type: 'OPEN_BOX',
        boxId: b,
        gameId: FIXED_VECTOR.gameId,
        stateVersion: v,
        commandSequence: seq,
        idempotencyKey: `cmd_open_${b}`
      });
      assert.equal(res.success, true);
      v = res.stateVersion;
      seq++;
    }

    assert.equal(engine.getPhase(), 'OFFERING');
    const snapOffering = engine.getPublicSnapshot();
    const offerId = snapOffering.currentOffer?.offerId!;

    // Accept offer to conclude game
    const acceptRes = engine.processCommand({
      type: 'ACCEPT_OFFER',
      offerId,
      gameId: FIXED_VECTOR.gameId,
      stateVersion: v,
      commandSequence: seq,
      idempotencyKey: 'cmd_accept'
    });
    assert.equal(acceptRes.success, true);
    assert.equal(engine.getPhase(), 'FINISHED');

    const settlement = engine.getSettlement()!;
    assert.ok(settlement.fairnessProof);
    assert.equal(settlement.fairnessProof.commitment, FIXED_VECTOR.commitment);
    assert.equal(settlement.fairnessProof.seed, FIXED_VECTOR.seed);
    assert.equal(settlement.fairnessProof.salt, FIXED_VECTOR.salt);
    assert.equal(settlement.originalBoxAmount, FIXED_VECTOR.mapping[0]);

    // Verify proof with WebCrypto against initial commitment and finalBoxes
    const verification = await verifyFairnessProof(settlement.fairnessProof, {
      initialCommitment,
      finalBoxes: settlement.allBoxes
    });

    assert.equal(verification.valid, true);
    assert.equal(verification.status, 'VERIFIED');
    assert.equal(verification.commitmentMatches, true);
    assert.equal(verification.initialCommitmentMatches, true);
    assert.equal(verification.boxMappingMatches, true);

    // Verify audit trail with both Node and WebCrypto
    assert.ok(settlement.auditTrail);
    const auditResSync = verifyAuditTrailSync(settlement.auditTrail);
    assert.equal(auditResSync.valid, true);
    const auditResWeb = await verifyAuditTrailWebCrypto(settlement.auditTrail);
    assert.equal(auditResWeb.valid, true);

    // Verify completed record
    const record = engine.getCompletedRecord();
    assert.ok(record);
    assert.equal(record.gameId, FIXED_VECTOR.gameId);
    assert.equal(record.aiStrategyVersion, 'ai-v1');
    assert.equal(record.settlement.wonAmount, settlement.wonAmount);
  });
});

describe('Fairness V1 - Incomplete Mapping, Tampering & Schema Defense', () => {
  const baseProof = {
    algorithm: FIXED_VECTOR.algorithm,
    amounts: [...MONEY_VALUES],
    gameId: FIXED_VECTOR.gameId,
    roundTargets: [...ROUND_TARGETS],
    ruleVersion: FIXED_VECTOR.ruleVersion,
    salt: FIXED_VECTOR.salt,
    seed: FIXED_VECTOR.seed,
    commitment: FIXED_VECTOR.commitment
  };

  const validBoxes = FIXED_VECTOR.mapping.map((amount, idx) => ({
    id: idx + 1,
    amount
  }));

  test('missing finalBoxes returns INCOMPLETE and boxMappingMatches=false, not valid', async () => {
    // Missing finalBoxes
    const res = await verifyFairnessProof(baseProof, {
      initialCommitment: FIXED_VECTOR.commitment
    });
    assert.equal(res.valid, false);
    assert.equal(res.status, 'INCOMPLETE');
    assert.equal(res.boxMappingMatches, false);
    assert.equal(res.commitmentMatches, true);
    assert.match(res.error || '', /final box mapping/);
  });

  test('rejects unknown algorithm or ruleVersion', async () => {
    const unknownAlgo = { ...baseProof, algorithm: 'sha256-only' };
    const resAlgo = await verifyFairnessProof(unknownAlgo, { finalBoxes: validBoxes });
    assert.equal(resAlgo.valid, false);
    assert.match(resAlgo.error || '', /Unsupported algorithm/);

    const unknownVer = { ...baseProof, ruleVersion: 'classic-26-v2' };
    const resVer = await verifyFairnessProof(unknownVer, { finalBoxes: validBoxes });
    assert.equal(resVer.valid, false);
    assert.match(resVer.error || '', /Unsupported ruleVersion/);
  });

  test('rejects tampered seed or salt', async () => {
    const tamperedSeed = '01' + '00'.repeat(31);
    const proofSeed = { ...baseProof, seed: tamperedSeed };
    const resSeed = await verifyFairnessProof(proofSeed, {
      initialCommitment: FIXED_VECTOR.commitment,
      finalBoxes: validBoxes
    });
    assert.equal(resSeed.valid, false);

    const tamperedSalt = '12' + '11'.repeat(31);
    const proofSalt = { ...baseProof, salt: tamperedSalt };
    const resSalt = await verifyFairnessProof(proofSalt, {
      initialCommitment: FIXED_VECTOR.commitment,
      finalBoxes: validBoxes
    });
    assert.equal(resSalt.valid, false);
  });

  test('rejects initial commitment mismatch', async () => {
    const fakeInitialCommitment = 'f'.repeat(64);
    const res = await verifyFairnessProof(baseProof, {
      initialCommitment: fakeInitialCommitment,
      finalBoxes: validBoxes
    });
    assert.equal(res.valid, false);
    assert.equal(res.initialCommitmentMatches, false);
    assert.match(res.error || '', /Initial commitment mismatch/);
  });

  test('rejects tampered final box amounts or missing/duplicate IDs', async () => {
    // Swapped box amounts
    const tamperedBoxes = validBoxes.map((b) => ({ ...b }));
    const tmp = tamperedBoxes[0].amount;
    tamperedBoxes[0].amount = tamperedBoxes[1].amount;
    tamperedBoxes[1].amount = tmp;

    const resSwap = await verifyFairnessProof(baseProof, {
      initialCommitment: FIXED_VECTOR.commitment,
      finalBoxes: tamperedBoxes
    });
    assert.equal(resSwap.valid, false);
    assert.equal(resSwap.boxMappingMatches, false);

    // Duplicate box ID
    const duplicateBoxes = validBoxes.map((b) => ({ ...b }));
    duplicateBoxes[1].id = 1;
    const resDup = await verifyFairnessProof(baseProof, {
      initialCommitment: FIXED_VECTOR.commitment,
      finalBoxes: duplicateBoxes
    });
    assert.equal(resDup.valid, false);
  });

  test('rejects malformed seed (non-hex, uppercase, invalid length) safely without throwing', async () => {
    assert.equal((await verifyFairnessProof({ ...baseProof, seed: '00'.repeat(31) })).valid, false);
    assert.equal((await verifyFairnessProof({ ...baseProof, seed: 'GG'.repeat(32) })).valid, false);
    assert.equal((await verifyFairnessProof({ ...baseProof, seed: 'AA'.repeat(32) })).valid, false);
    assert.equal((await verifyFairnessProof(null)).valid, false);
    assert.equal((await verifyFairnessProof(undefined)).valid, false);
    assert.equal((await verifyFairnessProof('string-proof')).valid, false);
  });

  test('audit trail verification strictly validates schema, genesis, linkage, and end event', async (t) => {
    const clock = new FakeClock(1000);
    const engine = new GameEngine({ clock });
    t.after(() => engine.dispose());

    engine.processCommand({
      type: 'SELECT_BOX',
      boxId: 1,
      gameId: engine.gameId,
      stateVersion: 1,
      commandSequence: 1,
      idempotencyKey: 'k1'
    });

    while (!engine.isFinished()) {
      clock.tick(35000);
    }

    const trail = engine.getSettlement()!.auditTrail!;
    assert.ok(trail.length > 2);

    // 1. Valid trail passes
    assert.equal(verifyAuditTrailSync(trail).valid, true);
    assert.equal((await verifyAuditTrailWebCrypto(trail)).valid, true);

    // 2. Truncated chain without GAME_SETTLED is rejected
    const truncated = trail.slice(0, -1);
    const truncResSync = verifyAuditTrailSync(truncated);
    assert.equal(truncResSync.valid, false);
    assert.match(truncResSync.error || '', /GAME_SETTLED/);
    const truncResWeb = await verifyAuditTrailWebCrypto(truncated);
    assert.equal(truncResWeb.valid, false);
    assert.match(truncResWeb.error || '', /GAME_SETTLED/);

    // 3. Tampered payload is rejected
    const tamperedPayload = trail.map((e) => ({ ...e, payload: { ...e.payload } }));
    tamperedPayload[1].payload.cheated = true;
    assert.equal(verifyAuditTrailSync(tamperedPayload).valid, false);
    assert.equal((await verifyAuditTrailWebCrypto(tamperedPayload)).valid, false);

    // 4. Invalid timestamp or non-object is rejected safely without throw
    const badTimestamp = trail.map((e) => ({ ...e }));
    badTimestamp[1].timestamp = -100;
    assert.equal(verifyAuditTrailSync(badTimestamp).valid, false);
    assert.equal((await verifyAuditTrailWebCrypto(badTimestamp)).valid, false);

    assert.equal(verifyAuditTrailSync(null).valid, false);
    assert.equal((await verifyAuditTrailWebCrypto([])).valid, false);
  });

  test('customBoxAmountMap explicitly marks fairness unsupported and produces no proof', () => {
    const clock = new FakeClock(1000);
    const engine = new GameEngine({
      customBoxAmountMap: [...MONEY_VALUES],
      clock
    });
    const snap = engine.getPublicSnapshot();
    assert.equal(snap.fairness?.supported, false);
    assert.equal(snap.fairness?.commitment, undefined);
    assert.equal(snap.fairness?.algorithm, undefined);

    while (!engine.isFinished()) {
      clock.tick(35000);
    }
    const settlement = engine.getSettlement()!;
    assert.equal(settlement.fairnessProof, null);
    assert.equal(engine.getCompletedRecord()?.settlement.fairnessProof, null);
  });
});

describe('Fairness V1 - Comprehensive Zero-Leakage & Mutation Isolation', () => {
  test('recursively scans all ongoing snapshots and error responses for secret leakage', (t) => {
    const clock = new FakeClock(1000);
    const engine = new GameEngine({ gameId: 'leak_scan_game', clock });
    t.after(() => engine.dispose());

    // SELECTING
    const snap1 = engine.getPublicSnapshot();
    assertNoSecrets(snap1, 'snap_selecting');
    assert.equal(snap1.settlement, null);
    assert.equal(engine.getCompletedRecord(), null);

    // Move to OPENING
    engine.processCommand({
      type: 'SELECT_BOX',
      boxId: 1,
      gameId: engine.gameId,
      stateVersion: 1,
      commandSequence: 1,
      idempotencyKey: 's1'
    });
    const snap2 = engine.getPublicSnapshot();
    assertNoSecrets(snap2, 'snap_opening');

    // Error response check
    const errRes = engine.processCommand({
      type: 'OPEN_BOX',
      boxId: 1, // Cannot open selected box
      gameId: engine.gameId,
      stateVersion: 2,
      commandSequence: 2,
      idempotencyKey: 'err1'
    });
    assert.equal(errRes.success, false);
    assertNoSecrets(errRes, 'err_response');

    // State version mismatch error check
    const staleRes = engine.processCommand({
      type: 'OPEN_BOX',
      boxId: 2,
      gameId: engine.gameId,
      stateVersion: 999,
      commandSequence: 2,
      idempotencyKey: 'err2'
    });
    assert.equal(staleRes.success, false);
    assertNoSecrets(staleRes, 'stale_response');

    // Open round 1 boxes (boxes 2..7) to reach OFFERING
    let v = 2;
    let seq = 2;
    for (let b = 2; b <= 7; b++) {
      const res = engine.processCommand({
        type: 'OPEN_BOX',
        boxId: b,
        gameId: engine.gameId,
        stateVersion: v,
        commandSequence: seq,
        idempotencyKey: `scan_open_${b}`
      });
      assert.equal(res.success, true);
      v = res.stateVersion;
      seq++;
    }

    // OFFERING phase secret check
    assert.equal(engine.getPhase(), 'OFFERING');
    const snapOffering = engine.getPublicSnapshot();
    assertNoSecrets(snapOffering, 'snap_offering');

    // Progress to FINAL_SWAP (open through box 25, rejecting offers)
    for (let b = 8; b <= 25; b++) {
      if (engine.getPhase() === 'OFFERING') {
        const off = engine.getPublicSnapshot().currentOffer!;
        const rejRes = engine.processCommand({
          type: 'REJECT_OFFER',
          offerId: off.offerId,
          gameId: engine.gameId,
          stateVersion: v,
          commandSequence: seq,
          idempotencyKey: `scan_rej_${seq}`
        });
        assert.equal(rejRes.success, true);
        v = rejRes.stateVersion;
        seq++;
      }

      const res = engine.processCommand({
        type: 'OPEN_BOX',
        boxId: b,
        gameId: engine.gameId,
        stateVersion: v,
        commandSequence: seq,
        idempotencyKey: `scan_open_${b}`
      });
      assert.equal(res.success, true);
      v = res.stateVersion;
      seq++;
    }

    // FINAL_SWAP phase secret check
    assert.equal(engine.getPhase(), 'FINAL_SWAP');
    const snapFinalSwap = engine.getPublicSnapshot();
    assertNoSecrets(snapFinalSwap, 'snap_final_swap');
  });

  test('getSettlement and getCompletedRecord have deep mutation isolation and stable completedAt', (t) => {
    const clock = new FakeClock(1000);
    const engine = new GameEngine({ clock });
    t.after(() => engine.dispose());

    while (!engine.isFinished()) {
      clock.tick(35000);
    }

    // 1. Stable completedAt across clock ticks
    const rec1 = engine.getCompletedRecord()!;
    const initialCompletedAt = rec1.completedAt;
    assert.ok(typeof initialCompletedAt === 'number' && initialCompletedAt > 0);

    clock.tick(60000); // 1 minute later
    const rec2 = engine.getCompletedRecord()!;
    assert.equal(rec2.completedAt, initialCompletedAt);
    assert.equal(canonicalJsonStringify(rec1), canonicalJsonStringify(rec2));

    // 2. getSettlement returns detached clone
    const s1 = engine.getSettlement()!;
    const s2 = engine.getSettlement()!;
    assert.notEqual(s1, s2);
    assert.notEqual(s1.allBoxes, s2.allBoxes);
    assert.notEqual(s1.fairnessProof, s2.fairnessProof);
    assert.notEqual(s1.auditTrail, s2.auditTrail);

    // Mutate s1 deeply
    s1.wonAmount = -88888;
    s1.allBoxes![0].amount = -77777;
    if (s1.fairnessProof) s1.fairnessProof.seed = 'tainted';
    s1.auditTrail![0].type = 'TAINTED';

    // Verify engine state and s2 are completely untouched
    assert.notEqual(s2.wonAmount, -88888);
    assert.notEqual(s2.allBoxes![0].amount, -77777);
    if (s2.fairnessProof) assert.notEqual(s2.fairnessProof.seed, 'tainted');
    assert.notEqual(s2.auditTrail![0].type, 'TAINTED');
    assert.notEqual(engine.getSettlement()!.wonAmount, -88888);
  });

  test('duplicate idempotent commands do not grow audit trail', (t) => {
    const clock = new FakeClock(1000);
    const engine = new GameEngine({ clock });
    t.after(() => engine.dispose());

    // Command 1
    const cmd1 = {
      type: 'SELECT_BOX' as const,
      boxId: 5,
      gameId: engine.gameId,
      stateVersion: 1,
      commandSequence: 1,
      idempotencyKey: 'idem_key_1'
    };
    const res1 = engine.processCommand(cmd1);
    assert.equal(res1.success, true);
    assert.equal(res1.stateVersion, 2);

    // Duplicate Command 1 replay
    const res1Dup = engine.processCommand(cmd1);
    assert.equal(res1Dup.success, true);
    assert.equal(res1Dup.stateVersion, 2);

    // Settle game to inspect audit trail
    while (!engine.isFinished()) {
      clock.tick(35000);
    }

    const trail = engine.getSettlement()!.auditTrail!;
    const selectEvents = trail.filter((e) => e.type === 'BOX_SELECTED');
    assert.equal(selectEvents.length, 1); // Exactly 1 event, not duplicated!
  });

  test('timeout during OFFERING records outcome EXPIRED in offerHistory and audit trail', (t) => {
    const clock = new FakeClock(1000);
    const engine = new GameEngine({ clock });
    t.after(() => engine.dispose());

    // Select box 1
    engine.processCommand({
      type: 'SELECT_BOX',
      boxId: 1,
      gameId: engine.gameId,
      stateVersion: 1,
      commandSequence: 1,
      idempotencyKey: 'sel_to'
    });

    // Open round 1 boxes (6 boxes)
    let seq = 2;
    let v = 2;
    for (let b = 2; b <= 7; b++) {
      engine.processCommand({
        type: 'OPEN_BOX',
        boxId: b,
        gameId: engine.gameId,
        stateVersion: v,
        commandSequence: seq,
        idempotencyKey: `open_to_${b}`
      });
      v++;
      seq++;
    }

    assert.equal(engine.getPhase(), 'OFFERING');
    assert.equal(engine.getPublicSnapshot().offerHistory?.[0].outcome, 'PENDING');

    // Trigger 30s timeout on OFFERING
    clock.tick(30000);
    assert.equal(engine.getPhase(), 'OPENING');

    const snap = engine.getPublicSnapshot();
    assert.equal(snap.offerHistory?.[0].outcome, 'EXPIRED');

    // Complete game and verify audit trail records EXPIRED
    while (!engine.isFinished()) {
      clock.tick(35000);
    }

    const trail = engine.getSettlement()!.auditTrail!;
    const rejectEvent = trail.find((e) => e.type === 'OFFER_REJECTED');
    assert.ok(rejectEvent);
    assert.equal(rejectEvent.payload.source, 'timeout');
    assert.equal(rejectEvent.payload.outcome, 'EXPIRED');
  });
});

describe('AI Strategies V1 - Full Game Paths & Branching', () => {
  test('Conservative AI: 24 boxes opened -> FINAL_SWAP -> KEEP branch full verification', async (t) => {
    const clock = new FakeClock(1000);
    const engine = new GameEngine({ aiType: 'conservative', clock, gameId: 'cons_keep_game' });
    t.after(() => engine.dispose());

    const initialCommitment = engine.getPublicSnapshot().fairness?.commitment!;
    assert.ok(initialCommitment);

    // 1. Select box 1
    engine.processCommand({
      type: 'SELECT_BOX',
      boxId: 1,
      gameId: engine.gameId,
      stateVersion: 1,
      commandSequence: 1,
      idempotencyKey: 'c_sel'
    });

    // 2. Open 24 boxes (boxes 2 to 25), rejecting all offers
    let v = 2;
    let seq = 2;
    for (let b = 2; b <= 25; b++) {
      if (engine.getPhase() === 'OFFERING') {
        const offId = engine.getPublicSnapshot().currentOffer!.offerId;
        const resRej = engine.processCommand({
          type: 'REJECT_OFFER',
          offerId: offId,
          gameId: engine.gameId,
          stateVersion: v,
          commandSequence: seq,
          idempotencyKey: `c_rej_${seq}`
        });
        assert.equal(resRej.success, true);
        v = resRej.stateVersion;
        seq++;
      }

      const resOpen = engine.processCommand({
        type: 'OPEN_BOX',
        boxId: b,
        gameId: engine.gameId,
        stateVersion: v,
        commandSequence: seq,
        idempotencyKey: `c_open_${b}`
      });
      assert.equal(resOpen.success, true);
      v = resOpen.stateVersion;
      seq++;
    }

    // 24 boxes opened -> must be in FINAL_SWAP
    assert.equal(engine.getPhase(), 'FINAL_SWAP');

    // 3. Choose KEEP_BOX
    const resKeep = engine.processCommand({
      type: 'KEEP_BOX',
      gameId: engine.gameId,
      stateVersion: v,
      commandSequence: seq,
      idempotencyKey: 'c_keep'
    });
    assert.equal(resKeep.success, true);
    assert.equal(engine.getPhase(), 'FINISHED');

    const settlement = engine.getSettlement()!;
    assert.equal(settlement.outcomeType, 'FINAL_KEEP');
    assert.equal(settlement.originalPlayerBoxId, 1);
    assert.equal(settlement.finalPlayerBoxId, 1);

    // Verify proof
    const proofRes = await verifyFairnessProof(settlement.fairnessProof, {
      initialCommitment,
      finalBoxes: settlement.allBoxes
    });
    assert.equal(proofRes.valid, true);
    assert.equal(proofRes.status, 'VERIFIED');

    // Verify audit trail
    assert.equal(verifyAuditTrailSync(settlement.auditTrail).valid, true);
    assert.equal((await verifyAuditTrailWebCrypto(settlement.auditTrail)).valid, true);

    const record = engine.getCompletedRecord()!;
    assert.equal(record.aiStrategyVersion, 'ai-v1');
    assert.equal(record.settlement.outcomeType, 'FINAL_KEEP');
  });

  test('Cold AI: 24 boxes opened -> FINAL_SWAP -> SWAP branch full verification', async (t) => {
    const clock = new FakeClock(1000);
    const engine = new GameEngine({ aiType: 'cold', clock, gameId: 'cold_swap_game' });
    t.after(() => engine.dispose());

    const initialCommitment = engine.getPublicSnapshot().fairness?.commitment!;

    // 1. Select box 1
    engine.processCommand({
      type: 'SELECT_BOX',
      boxId: 1,
      gameId: engine.gameId,
      stateVersion: 1,
      commandSequence: 1,
      idempotencyKey: 'cold_sel'
    });

    // 2. Open 24 boxes (boxes 2 to 25), rejecting all offers
    let v = 2;
    let seq = 2;
    for (let b = 2; b <= 25; b++) {
      if (engine.getPhase() === 'OFFERING') {
        const offId = engine.getPublicSnapshot().currentOffer!.offerId;
        const resRej = engine.processCommand({
          type: 'REJECT_OFFER',
          offerId: offId,
          gameId: engine.gameId,
          stateVersion: v,
          commandSequence: seq,
          idempotencyKey: `cold_rej_${seq}`
        });
        v = resRej.stateVersion;
        seq++;
      }

      const resOpen = engine.processCommand({
        type: 'OPEN_BOX',
        boxId: b,
        gameId: engine.gameId,
        stateVersion: v,
        commandSequence: seq,
        idempotencyKey: `cold_open_${b}`
      });
      v = resOpen.stateVersion;
      seq++;
    }

    assert.equal(engine.getPhase(), 'FINAL_SWAP');

    // 3. Choose SWAP_BOX with box 26
    const resSwap = engine.processCommand({
      type: 'SWAP_BOX',
      targetBoxId: 26,
      gameId: engine.gameId,
      stateVersion: v,
      commandSequence: seq,
      idempotencyKey: 'cold_swap'
    });
    assert.equal(resSwap.success, true);
    assert.equal(engine.getPhase(), 'FINISHED');

    const settlement = engine.getSettlement()!;
    assert.equal(settlement.outcomeType, 'FINAL_SWAP');
    assert.equal(settlement.originalPlayerBoxId, 1);
    assert.equal(settlement.finalPlayerBoxId, 26);

    // Verify proof & audit trail
    const proofRes = await verifyFairnessProof(settlement.fairnessProof, {
      initialCommitment,
      finalBoxes: settlement.allBoxes
    });
    assert.equal(proofRes.valid, true);
    assert.equal(proofRes.status, 'VERIFIED');
    assert.equal(verifyAuditTrailSync(settlement.auditTrail).valid, true);
  });

  test('Aggressive AI: accepts offer in offering phase and settles cleanly', async (t) => {
    const clock = new FakeClock(1000);
    const engine = new GameEngine({ aiType: 'aggressive', clock, gameId: 'agg_accept_game' });
    t.after(() => engine.dispose());

    const initialCommitment = engine.getPublicSnapshot().fairness?.commitment!;

    engine.processCommand({
      type: 'SELECT_BOX',
      boxId: 10,
      gameId: engine.gameId,
      stateVersion: 1,
      commandSequence: 1,
      idempotencyKey: 'agg_sel'
    });

    let v = 2;
    let seq = 2;
    for (let b = 1; b <= 6; b++) {
      const resOpen = engine.processCommand({
        type: 'OPEN_BOX',
        boxId: b,
        gameId: engine.gameId,
        stateVersion: v,
        commandSequence: seq,
        idempotencyKey: `agg_open_${b}`
      });
      v = resOpen.stateVersion;
      seq++;
    }

    assert.equal(engine.getPhase(), 'OFFERING');
    const offer = engine.getPublicSnapshot().currentOffer!;

    const resAcc = engine.processCommand({
      type: 'ACCEPT_OFFER',
      offerId: offer.offerId,
      gameId: engine.gameId,
      stateVersion: v,
      commandSequence: seq,
      idempotencyKey: 'agg_acc'
    });
    assert.equal(resAcc.success, true);
    assert.equal(engine.getPhase(), 'FINISHED');

    const settlement = engine.getSettlement()!;
    assert.equal(settlement.outcomeType, 'OFFER_ACCEPTED');
    assert.equal(settlement.wonAmount, offer.amount);

    const proofRes = await verifyFairnessProof(settlement.fairnessProof, {
      initialCommitment,
      finalBoxes: settlement.allBoxes
    });
    assert.equal(proofRes.valid, true);
    assert.equal(proofRes.status, 'VERIFIED');
    assert.equal(verifyAuditTrailSync(settlement.auditTrail).valid, true);
  });

  test('rejects invalid aiType at GameEngine constructor', () => {
    assert.throws(
      () => new GameEngine({ aiType: 'invalid_ai' as any }),
      /Invalid aiType/i
    );
  });
});

