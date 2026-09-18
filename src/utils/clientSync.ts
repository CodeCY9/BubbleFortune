import type {
  ClientCommand,
  CommandResult,
} from '../../packages/protocol/src/types';

export interface PendingCommand {
  command: Exclude<ClientCommand, { type: 'REQUEST_SNAPSHOT' }>;
  timestamp: number;
}

/**
 * Generate a new authoritative client command with incremented commandSequence and idempotencyKey
 */
export function createClientCommand(
  type: 'SELECT_BOX' | 'OPEN_BOX' | 'ACCEPT_OFFER' | 'REJECT_OFFER' | 'KEEP_BOX' | 'SWAP_BOX' | 'USE_INQUIRY' | 'BUY_INSURANCE' | 'DECLINE_RAISE',
  gameId: string,
  stateVersion: number,
  lastCommandSequence: number,
  params: Record<string, any> = {}
): Exclude<ClientCommand, { type: 'REQUEST_SNAPSHOT' }> {
  const commandSequence = lastCommandSequence + 1;
  const idempotencyKey =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}_${Math.random().toString(36).slice(2)}`;

  return {
    type,
    gameId,
    stateVersion,
    commandSequence,
    idempotencyKey,
    ...params,
  } as Exclude<ClientCommand, { type: 'REQUEST_SNAPSHOT' }>;
}

/**
 * Monotonic state version filter: drop outdated snapshots
 */
export function shouldDropStaleSnapshot(
  snapshotVersion: number,
  lastStateVersion: number
): boolean {
  return snapshotVersion < lastStateVersion;
}

/**
 * Check if the pending command has been acknowledged by a server snapshot's sequence
 */
export function isPendingCommandAckedBySnapshot(
  pending: PendingCommand | null,
  snapshotLastSeq: number
): boolean {
  if (!pending) return false;
  return snapshotLastSeq >= pending.command.commandSequence;
}

/**
 * Correlate incoming command_result against pending command.
 * Rejects mismatched idempotencyKey.
 */
export function correlateCommandResult(
  pending: PendingCommand | null,
  result: CommandResult
): { matches: boolean; shouldClearPending: boolean } {
  if (!pending) {
    return { matches: false, shouldClearPending: false };
  }
  if (!result.idempotencyKey || result.idempotencyKey !== pending.command.idempotencyKey) {
    return { matches: false, shouldClearPending: false };
  }
  return { matches: true, shouldClearPending: true };
}

/**
 * Check whether a pending command should be retransmitted when the first snapshot arrives after reconnect
 */
export function shouldRetransmitPendingOnReconnect(
  pending: PendingCommand | null,
  snapshotLastSeq: number
): boolean {
  if (!pending) return false;
  return snapshotLastSeq < pending.command.commandSequence;
}
