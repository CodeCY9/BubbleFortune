import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  createClientCommand,
  shouldDropStaleSnapshot,
  isPendingCommandAckedBySnapshot,
  correlateCommandResult,
  shouldRetransmitPendingOnReconnect,
  type PendingCommand,
} from '../src/utils/clientSync';
import type { PublicSnapshot, CommandResult } from '../packages/protocol/src/types';

function createTestSnapshot(overrides: Partial<PublicSnapshot> = {}): PublicSnapshot {
  return {
    gameId: 'game_client_test',
    ruleVersion: 'classic-26-v1',
    phase: 'OPENING',
    stateVersion: 1,
    lastCommandSequence: 0,
    serverNow: 1700000000000,
    originalPlayerBoxId: 1,
    currentPlayerBoxId: 1,
    currentRound: 1,
    boxesToOpenThisRound: 6,
    totalOpenedBoxes: 0,
    unopenedCount: 26,
    boxes: Array.from({ length: 26 }, (_, i) => ({
      id: i + 1,
      status: i === 0 ? ('selected' as const) : ('unopened' as const),
    })),
    currentOffer: null,
    deadlineTimestamp: 1700000030000,
    settlement: null,
    ...overrides,
  };
}

describe('Authoritative Client Synchronization Production Logic Tests', () => {
  it('1. 命令序列单调递增并携带独立幂等键 (createClientCommand creates monotonic sequence and unique idempotencyKey)', () => {
    const cmd1 = createClientCommand('OPEN_BOX', 'game_1', 10, 3, { boxId: 5 });
    assert.strictEqual(cmd1.commandSequence, 4);
    assert.strictEqual(cmd1.stateVersion, 10);
    assert.strictEqual(cmd1.gameId, 'game_1');
    assert.ok(cmd1.idempotencyKey.length > 0);

    const cmd2 = createClientCommand('OPEN_BOX', 'game_1', 10, 4, { boxId: 6 });
    assert.strictEqual(cmd2.commandSequence, 5);
    assert.notStrictEqual(cmd1.idempotencyKey, cmd2.idempotencyKey, 'Idempotency keys must be unique');
  });

  it('2. 过滤落后状态版本快照 (shouldDropStaleSnapshot drops outdated versions)', () => {
    assert.strictEqual(shouldDropStaleSnapshot(9, 10), true, 'Version 9 < 10 must be dropped');
    assert.strictEqual(shouldDropStaleSnapshot(10, 10), false, 'Version 10 == 10 is not dropped');
    assert.strictEqual(shouldDropStaleSnapshot(11, 10), false, 'Version 11 > 10 is accepted');
  });

  it('3. 快照确认待处理命令 (isPendingCommandAckedBySnapshot detects ack when seq >= commandSeq)', () => {
    const cmd = createClientCommand('OPEN_BOX', 'game_1', 1, 2, { boxId: 7 });
    const pending: PendingCommand = { command: cmd, timestamp: Date.now() };

    // Sequence 2 has not acked command 3
    assert.strictEqual(isPendingCommandAckedBySnapshot(pending, 2), false);
    // Sequence 3 acks command 3
    assert.strictEqual(isPendingCommandAckedBySnapshot(pending, 3), true);
    // Sequence 4 also covers command 3
    assert.strictEqual(isPendingCommandAckedBySnapshot(pending, 4), true);
  });

  it('4. 结果严格关联幂等键 (correlateCommandResult strictly correlates idempotencyKey)', () => {
    const cmd = createClientCommand('OPEN_BOX', 'game_1', 1, 5, { boxId: 9 });
    const pending: PendingCommand = { command: cmd, timestamp: Date.now() };

    // Mismatched or missing idempotencyKey
    const staleResult: CommandResult = {
      commandType: 'OPEN_BOX',
      idempotencyKey: 'wrong_key',
      success: true,
    };
    const check1 = correlateCommandResult(pending, staleResult);
    assert.strictEqual(check1.matches, false);
    assert.strictEqual(check1.shouldClearPending, false);

    // Matching idempotencyKey
    const matchResult: CommandResult = {
      commandType: 'OPEN_BOX',
      idempotencyKey: cmd.idempotencyKey,
      success: true,
    };
    const check2 = correlateCommandResult(pending, matchResult);
    assert.strictEqual(check2.matches, true);
    assert.strictEqual(check2.shouldClearPending, true);
  });

  it('5. 重连快照未消费则判定需要重发 (shouldRetransmitPendingOnReconnect retransmits unconsumed pending)', () => {
    const cmd = createClientCommand('OPEN_BOX', 'game_1', 1, 4, { boxId: 10 });
    const pending: PendingCommand = { command: cmd, timestamp: Date.now() };

    // Snapshot seq is 4 (pending is 5): not consumed, MUST retransmit
    assert.strictEqual(shouldRetransmitPendingOnReconnect(pending, 4), true);

    // Snapshot seq is 5 (pending is 5): already consumed, do NOT retransmit
    assert.strictEqual(shouldRetransmitPendingOnReconnect(pending, 5), false);
  });

  it('6. 无待处理命令时不产生误触发 (Null pending handles safely)', () => {
    assert.strictEqual(isPendingCommandAckedBySnapshot(null, 10), false);
    assert.strictEqual(shouldRetransmitPendingOnReconnect(null, 10), false);
    const check = correlateCommandResult(null, {
      commandType: 'OPEN_BOX',
      idempotencyKey: 'any',
      success: true,
    });
    assert.strictEqual(check.matches, false);
  });
});
