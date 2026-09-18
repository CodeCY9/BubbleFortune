const fs = require('fs');
const path = require('path');

function write(filePath, content) {
  const fullPath = path.resolve(filePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content.trim() + '\n', 'utf8');
  console.log('Wrote:', filePath);
}

// 1. packages/protocol/src/config.ts
write('packages/protocol/src/config.ts', `/**
 * Public configuration and constants for Classic 26 Box game.
 * Only public rules and lists are exported.
 * Internal banker formulas, secret box mappings, and EV weights MUST NOT be exported here.
 */

export const RULE_VERSION = 'classic-26-v1';

export const TOTAL_BOXES = 26;

// 26 public money values in ascending order
export const MONEY_VALUES = [
  // Low Tier (13 items)
  1, 5, 10, 25, 50, 75, 100, 200, 300, 400, 500, 750, 1000,
  // High Tier (13 items)
  2500, 5000, 10000, 25000, 50000, 75000, 100000, 200000, 300000, 400000, 500000, 750000, 1000000
] as const;

// Boxes to open per round across 9 rounds.
// 6 + 5 + 4 + 3 + 2 + 1 + 1 + 1 + 1 = 24 boxes opened.
// After 24 boxes are opened, exactly 2 boxes remain: player's lucky box and 1 remaining box.
// At that point, the game transitions directly to FINAL_SWAP (no banker offer).
export const ROUND_TARGETS = [6, 5, 4, 3, 2, 1, 1, 1, 1] as const;

export const TOTAL_ROUNDS = ROUND_TARGETS.length; // 9 rounds
export const TOTAL_BOXES_TO_OPEN_BEFORE_FINAL = 24;

export const TIMEOUT_SECONDS = {
  SELECT_PLAYER_BOX: 30,
  OPEN_BOX: 20,
  BANKER_OFFER: 30,
  FINAL_CHOICE: 30,
  RECONNECT_GRACE: 120
} as const;
`);

// 2. packages/protocol/src/types.ts
write('packages/protocol/src/types.ts', `/**
 * Public protocol types for Classic 26 Box game.
 * Whitelist data only. No secret state or EV calculation logic here.
 */

export type GamePhase =
  | 'SELECTING'    // Player selecting lucky box
  | 'OPENING'      // Opening boxes in current round
  | 'OFFERING'     // Banker has made an offer, waiting for accept or reject
  | 'FINAL_SWAP'   // 2 unopened boxes remain (player box + 1 other); keep or swap
  | 'FINISHED';    // Game concluded

export type BoxStatus = 'unopened' | 'selected' | 'opened';

// Whitelist box definition: unopened/selected boxes have NO value or amount fields at all!
export type PublicBox =
  | { id: number; status: 'unopened' }
  | { id: number; status: 'selected' }
  | { id: number; status: 'opened'; revealedAmount: number };

export interface PublicOffer {
  offerId: string;
  amount: number;
  expiresAt: number; // Unix epoch ms
}

export type OutcomeType = 'OFFER_ACCEPTED' | 'FINAL_KEEP' | 'FINAL_SWAP';

export interface PublicSettlement {
  resultId: string;
  wonAmount: number;
  outcomeType: OutcomeType;
  originalPlayerBoxId: number;
  finalPlayerBoxId: number;
  acceptedOfferAmount?: number;
  finalBoxAmount?: number;
  allBoxes?: Array<{ id: number; amount: number }>;
}

export interface PublicSnapshot {
  gameId: string;
  ruleVersion: string;
  phase: GamePhase;
  stateVersion: number;
  originalPlayerBoxId: number | null;
  currentPlayerBoxId: number | null;
  currentRound: number;
  boxesToOpenThisRound: number;
  totalOpenedBoxes: number;
  unopenedCount: number;
  boxes: PublicBox[];
  currentOffer: PublicOffer | null;
  deadlineTimestamp: number | null;
  settlement: PublicSettlement | null;
}

export type PublicGameEvent =
  | { type: 'BOX_SELECTED'; boxId: number; stateVersion: number }
  | { type: 'BOX_OPENED'; boxId: number; revealedAmount: number; stateVersion: number }
  | { type: 'OFFER_MADE'; offerId: string; amount: number; expiresAt: number; stateVersion: number }
  | { type: 'OFFER_ACCEPTED'; offerId: string; amount: number; stateVersion: number }
  | { type: 'OFFER_REJECTED'; offerId: string; nextRound: number; stateVersion: number }
  | { type: 'FINAL_KEEP'; boxId: number; amount: number; stateVersion: number }
  | { type: 'FINAL_SWAP'; originalBoxId: number; newBoxId: number; amount: number; stateVersion: number }
  | { type: 'GAME_SETTLED'; settlement: PublicSettlement; stateVersion: number }
  | { type: 'AUTO_ACTION_TIMEOUT'; reason: string; stateVersion: number };

// Base fields required for every state-mutating command
export interface CommandHeader {
  gameId: string;
  stateVersion: number;
  commandSequence: number;
  idempotencyKey: string;
}

export interface SelectBoxCommand extends CommandHeader {
  type: 'SELECT_BOX';
  boxId: number;
}

export interface OpenBoxCommand extends CommandHeader {
  type: 'OPEN_BOX';
  boxId: number;
}

export interface AcceptOfferCommand extends CommandHeader {
  type: 'ACCEPT_OFFER';
  offerId: string;
}

export interface RejectOfferCommand extends CommandHeader {
  type: 'REJECT_OFFER';
  offerId: string;
}

export interface KeepBoxCommand extends CommandHeader {
  type: 'KEEP_BOX';
}

export interface SwapBoxCommand extends CommandHeader {
  type: 'SWAP_BOX';
  targetBoxId: number;
}

export interface RequestSnapshotCommand {
  type: 'REQUEST_SNAPSHOT';
}

export type ClientCommand =
  | SelectBoxCommand
  | OpenBoxCommand
  | AcceptOfferCommand
  | RejectOfferCommand
  | KeepBoxCommand
  | SwapBoxCommand
  | RequestSnapshotCommand;

export type ErrorCode =
  | 'INVALID_PAYLOAD'
  | 'IDEMPOTENCY_CONFLICT'
  | 'STALE_VERSION'
  | 'OUT_OF_SEQUENCE'
  | 'INVALID_PHASE'
  | 'INVALID_BOX'
  | 'OFFER_EXPIRED'
  | 'RATE_LIMITED'
  | 'UNAUTHORIZED'
  | 'ROOM_FULL'
  | 'INTERNAL_ERROR';

export interface PublicError {
  code: ErrorCode;
  message: string;
}

export interface CommandResult {
  success: boolean;
  stateVersion: number;
  snapshot?: PublicSnapshot;
  event?: PublicGameEvent;
  error?: PublicError;
}
`);

// 3. packages/protocol/src/validation.ts
write('packages/protocol/src/validation.ts', `import { ClientCommand, ErrorCode, PublicError } from './types';

const MAX_PAYLOAD_BYTES = 2048;
const MAX_STRING_LEN = 128;

const ALLOWED_COMMAND_TYPES = new Set([
  'SELECT_BOX',
  'OPEN_BOX',
  'ACCEPT_OFFER',
  'REJECT_OFFER',
  'KEEP_BOX',
  'SWAP_BOX',
  'REQUEST_SNAPSHOT'
]);

const ALLOWED_KEYS_BY_TYPE: Record<string, Set<string>> = {
  REQUEST_SNAPSHOT: new Set(['type']),
  SELECT_BOX: new Set(['type', 'gameId', 'stateVersion', 'commandSequence', 'idempotencyKey', 'boxId']),
  OPEN_BOX: new Set(['type', 'gameId', 'stateVersion', 'commandSequence', 'idempotencyKey', 'boxId']),
  ACCEPT_OFFER: new Set(['type', 'gameId', 'stateVersion', 'commandSequence', 'idempotencyKey', 'offerId']),
  REJECT_OFFER: new Set(['type', 'gameId', 'stateVersion', 'commandSequence', 'idempotencyKey', 'offerId']),
  KEEP_BOX: new Set(['type', 'gameId', 'stateVersion', 'commandSequence', 'idempotencyKey']),
  SWAP_BOX: new Set(['type', 'gameId', 'stateVersion', 'commandSequence', 'idempotencyKey', 'targetBoxId'])
};

export interface ValidationResult {
  valid: boolean;
  command?: ClientCommand;
  error?: PublicError;
}

export function validateClientCommand(raw: unknown): ValidationResult {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      valid: false,
      error: { code: 'INVALID_PAYLOAD', message: 'Payload must be a non-null object' }
    };
  }

  // Check JSON size limit
  try {
    const jsonStr = JSON.stringify(raw);
    if (jsonStr.length > MAX_PAYLOAD_BYTES) {
      return {
        valid: false,
        error: { code: 'INVALID_PAYLOAD', message: 'Payload exceeds size limit' }
      };
    }
  } catch {
    return {
      valid: false,
      error: { code: 'INVALID_PAYLOAD', message: 'Payload serialization failure' }
    };
  }

  const obj = raw as Record<string, unknown>;

  if (typeof obj.type !== 'string' || !ALLOWED_COMMAND_TYPES.has(obj.type)) {
    return {
      valid: false,
      error: { code: 'INVALID_PAYLOAD', message: 'Missing or unknown command type' }
    };
  }

  if (obj.type === 'REQUEST_SNAPSHOT') {
    const keys = Object.keys(obj);
    if (keys.length !== 1) {
      return {
        valid: false,
        error: { code: 'INVALID_PAYLOAD', message: 'Unexpected fields in snapshot request' }
      };
    }
    return { valid: true, command: { type: 'REQUEST_SNAPSHOT' } };
  }

  const allowedKeys = ALLOWED_KEYS_BY_TYPE[obj.type];
  if (!allowedKeys) {
    return {
      valid: false,
      error: { code: 'INVALID_PAYLOAD', message: 'Unsupported command type' }
    };
  }

  // Reject ANY unknown fields (such as injected amount, value, ev, etc.)
  for (const k of Object.keys(obj)) {
    if (!allowedKeys.has(k)) {
      return {
        valid: false,
        error: { code: 'INVALID_PAYLOAD', message: 'Payload contains unknown field: ' + k }
      };
    }
  }

  // Validate common header fields
  if (typeof obj.gameId !== 'string' || obj.gameId.length === 0 || obj.gameId.length > MAX_STRING_LEN) {
    return {
      valid: false,
      error: { code: 'INVALID_PAYLOAD', message: 'Invalid gameId' }
    };
  }

  if (
    typeof obj.stateVersion !== 'number' ||
    !Number.isInteger(obj.stateVersion) ||
    obj.stateVersion < 0
  ) {
    return {
      valid: false,
      error: { code: 'INVALID_PAYLOAD', message: 'stateVersion must be a non-negative integer' }
    };
  }

  if (
    typeof obj.commandSequence !== 'number' ||
    !Number.isInteger(obj.commandSequence) ||
    obj.commandSequence < 1
  ) {
    return {
      valid: false,
      error: { code: 'INVALID_PAYLOAD', message: 'commandSequence must be a positive integer' }
    };
  }

  if (
    typeof obj.idempotencyKey !== 'string' ||
    obj.idempotencyKey.length === 0 ||
    obj.idempotencyKey.length > MAX_STRING_LEN
  ) {
    return {
      valid: false,
      error: { code: 'INVALID_PAYLOAD', message: 'Invalid idempotencyKey' }
    };
  }

  // Validate specific command fields
  if (obj.type === 'SELECT_BOX' || obj.type === 'OPEN_BOX') {
    if (
      typeof obj.boxId !== 'number' ||
      !Number.isInteger(obj.boxId) ||
      obj.boxId < 1 ||
      obj.boxId > 26
    ) {
      return {
        valid: false,
        error: { code: 'INVALID_BOX', message: 'boxId must be an integer between 1 and 26' }
      };
    }
  } else if (obj.type === 'ACCEPT_OFFER' || obj.type === 'REJECT_OFFER') {
    if (
      typeof obj.offerId !== 'string' ||
      obj.offerId.length === 0 ||
      obj.offerId.length > MAX_STRING_LEN
    ) {
      return {
        valid: false,
        error: { code: 'INVALID_PAYLOAD', message: 'Invalid offerId' }
      };
    }
  } else if (obj.type === 'SWAP_BOX') {
    if (
      typeof obj.targetBoxId !== 'number' ||
      !Number.isInteger(obj.targetBoxId) ||
      obj.targetBoxId < 1 ||
      obj.targetBoxId > 26
    ) {
      return {
        valid: false,
        error: { code: 'INVALID_BOX', message: 'targetBoxId must be an integer between 1 and 26' }
      };
    }
  }

  return {
    valid: true,
    command: obj as unknown as ClientCommand
  };
}
`);

// 4. packages/protocol/src/index.ts
write('packages/protocol/src/index.ts', `export * from './config';
export * from './types';
export * from './validation';
`);

// 5. apps/game-server/src/engine/clock.ts
write('apps/game-server/src/engine/clock.ts', `export interface ClockTimer {
  cancel(): void;
}

export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): ClockTimer;
}

export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }

  setTimeout(fn: () => void, ms: number): ClockTimer {
    const handle = setTimeout(fn, ms);
    return {
      cancel: () => clearTimeout(handle)
    };
  }
}

export class FakeClock implements Clock {
  private currentTime: number;
  private timers: Array<{ id: number; dueTime: number; fn: () => void; cancelled: boolean }> = [];
  private nextTimerId = 1;

  constructor(initialTime = 1000000) {
    this.currentTime = initialTime;
  }

  now(): number {
    return this.currentTime;
  }

  setTimeout(fn: () => void, ms: number): ClockTimer {
    const timer = {
      id: this.nextTimerId++,
      dueTime: this.currentTime + ms,
      fn,
      cancelled: false
    };
    this.timers.push(timer);
    return {
      cancel: () => {
        timer.cancelled = true;
      }
    };
  }

  tick(ms: number): void {
    this.currentTime += ms;
    while (true) {
      const activeDue = this.timers
        .filter(t => !t.cancelled && t.dueTime <= this.currentTime)
        .sort((a, b) => a.dueTime - b.dueTime);
      if (activeDue.length === 0) break;
      const next = activeDue[0];
      next.cancelled = true;
      next.fn();
    }
  }

  advanceToNext(): boolean {
    const active = this.timers
      .filter(t => !t.cancelled)
      .sort((a, b) => a.dueTime - b.dueTime);
    if (active.length === 0) return false;
    const next = active[0];
    this.tick(Math.max(0, next.dueTime - this.currentTime));
    return true;
  }

  hasPendingTimers(): boolean {
    return this.timers.some(t => !t.cancelled);
  }
}
`);

// 6. apps/game-server/src/engine/GameEngine.ts
write('apps/game-server/src/engine/GameEngine.ts', `import crypto from 'node:crypto';
import {
  RULE_VERSION,
  TOTAL_BOXES,
  MONEY_VALUES,
  ROUND_TARGETS,
  TOTAL_BOXES_TO_OPEN_BEFORE_FINAL,
  TIMEOUT_SECONDS
} from '../../../../packages/protocol/src/config';
import {
  GamePhase,
  PublicBox,
  PublicOffer,
  PublicSettlement,
  PublicSnapshot,
  PublicGameEvent,
  ClientCommand,
  CommandResult,
  PublicError
} from '../../../../packages/protocol/src/types';
import { Clock, SystemClock } from './clock';

interface CachedCommand {
  payloadHash: string;
  result: CommandResult;
}

export interface GameEngineOptions {
  gameId?: string;
  clock?: Clock;
  customBoxAmountMap?: Map<number, number> | number[];
  randomIntFn?: (min: number, max: number) => number;
}

export class GameEngine {
  public readonly gameId: string;
  private readonly clock: Clock;
  private readonly randomInt: (min: number, max: number) => number;

  // Secret internal state
  private readonly boxAmountMap: Map<number, number>;
  private originalPlayerBoxId: number | null = null;
  private currentPlayerBoxId: number | null = null;
  private phase: GamePhase = 'SELECTING';
  private stateVersion = 1;
  private lastCommandSequence = 0;
  private currentRound = 1;
  private boxesOpenedThisRound = 0;
  private totalOpenedBoxes = 0;
  private readonly openedBoxIds = new Set<number>();
  private currentOffer: PublicOffer | null = null;
  private deadlineTimestamp: number | null = null;
  private activeTimer: { cancel: () => void } | null = null;
  private settlement: PublicSettlement | null = null;

  // Idempotency cache: bounded LRU
  private readonly idempotencyCache = new Map<string, CachedCommand>();
  private static readonly MAX_IDEMPOTENCY_ENTRIES = 500;

  // Event listener for room broadcasting
  private onEventHandler?: (event: PublicGameEvent, snapshot: PublicSnapshot) => void;

  constructor(options: GameEngineOptions = {}) {
    this.gameId = options.gameId || ('game_' + crypto.randomUUID());
    this.clock = options.clock || new SystemClock();
    this.randomInt = options.randomIntFn || crypto.randomInt;

    if (options.customBoxAmountMap) {
      if (Array.isArray(options.customBoxAmountMap)) {
        if (options.customBoxAmountMap.length !== TOTAL_BOXES) {
          throw new Error('customBoxAmountMap array must have exactly 26 items');
        }
        this.boxAmountMap = new Map();
        for (let i = 0; i < TOTAL_BOXES; i++) {
          this.boxAmountMap.set(i + 1, options.customBoxAmountMap[i]);
        }
      } else {
        if (options.customBoxAmountMap.size !== TOTAL_BOXES) {
          throw new Error('customBoxAmountMap Map must have exactly 26 items');
        }
        this.boxAmountMap = new Map(options.customBoxAmountMap);
      }
    } else {
      // Secure Fisher-Yates shuffle using crypto.randomInt
      this.boxAmountMap = this.generateSecureBoxMapping();
    }

    // Arm the initial timeout for choosing player box (30s)
    this.armTimeout('SELECTING', TIMEOUT_SECONDS.SELECT_PLAYER_BOX);
  }

  public setOnEventHandler(handler: (event: PublicGameEvent, snapshot: PublicSnapshot) => void) {
    this.onEventHandler = handler;
  }

  private generateSecureBoxMapping(): Map<number, number> {
    const values = [...MONEY_VALUES];
    for (let i = values.length - 1; i > 0; i--) {
      // crypto.randomInt(min, max) returns min <= r < max
      const j = this.randomInt(0, i + 1);
      const temp = values[i];
      values[i] = values[j];
      values[j] = temp;
    }
    const map = new Map<number, number>();
    for (let i = 0; i < TOTAL_BOXES; i++) {
      map.set(i + 1, values[i]);
    }
    return map;
  }

  private armTimeout(phase: GamePhase, seconds: number): void {
    if (this.activeTimer) {
      this.activeTimer.cancel();
      this.activeTimer = null;
    }
    const ms = seconds * 1000;
    this.deadlineTimestamp = this.clock.now() + ms;
    this.activeTimer = this.clock.setTimeout(() => {
      this.handleTimeout(phase);
    }, ms);
  }

  private clearTimer(): void {
    if (this.activeTimer) {
      this.activeTimer.cancel();
      this.activeTimer = null;
    }
    this.deadlineTimestamp = null;
  }

  private handleTimeout(phase: GamePhase): void {
    if (this.phase !== phase || this.phase === 'FINISHED') return;

    if (phase === 'SELECTING') {
      // Auto-select smallest available box
      const available = this.getAvailableUnopenedBoxIds();
      if (available.length > 0) {
        this.executeSelectBox(available[0]);
      }
    } else if (phase === 'OPENING') {
      // Auto-open first available unopened non-player box
      const candidates = this.getAvailableUnopenedBoxIds().filter(
        id => id !== this.currentPlayerBoxId
      );
      if (candidates.length > 0) {
        this.executeOpenBox(candidates[0]);
      }
    } else if (phase === 'OFFERING') {
      // Auto-reject offer
      if (this.currentOffer) {
        this.executeRejectOffer(this.currentOffer.offerId);
      }
    } else if (phase === 'FINAL_SWAP') {
      // Auto-keep box
      this.executeKeepBox();
    }
  }

  private getAvailableUnopenedBoxIds(): number[] {
    const list: number[] = [];
    for (let id = 1; id <= TOTAL_BOXES; id++) {
      if (!this.openedBoxIds.has(id)) {
        list.push(id);
      }
    }
    return list;
  }

  // Calculate Banker Offer strictly inside server. Formula:
  // Math.max(10, Math.round((ev * Math.min(0.35 + round * 0.08, 0.95)) / 100) * 100)
  private calculateBankerOffer(): number {
    const unopenedIds = this.getAvailableUnopenedBoxIds();
    if (unopenedIds.length === 0) return 10;

    let sum = 0;
    for (const id of unopenedIds) {
      sum += this.boxAmountMap.get(id) || 0;
    }
    const ev = sum / unopenedIds.length;
    const riskFactor = Math.min(0.35 + this.currentRound * 0.08, 0.95);
    const offer = Math.round((ev * riskFactor) / 100) * 100;
    return Math.max(10, offer);
  }

  public processCommand(command: ClientCommand): CommandResult {
    // 1. Snapshot request (read-only, does not mutate state or consume sequence)
    if (command.type === 'REQUEST_SNAPSHOT') {
      return {
        success: true,
        stateVersion: this.stateVersion,
        snapshot: this.getPublicSnapshot()
      };
    }

    // 2. Compute payload hash for idempotency checking
    const payloadHash = JSON.stringify(command);

    // 3. IDEMPOTENCY CHECK MUST HAPPEN FIRST before version or sequence check!
    const cached = this.idempotencyCache.get(command.idempotencyKey);
    if (cached) {
      if (cached.payloadHash === payloadHash) {
        // Exact duplicate request -> return previous result immediately without executing again
        return cached.result;
      } else {
        // Same key, different payload -> conflict error
        return {
          success: false,
          stateVersion: this.stateVersion,
          error: {
            code: 'IDEMPOTENCY_CONFLICT',
            message: 'Idempotency key reused with different command payload'
          }
        };
      }
    }

    // 4. Stale version check: command must specify the current stateVersion
    if (command.stateVersion !== this.stateVersion) {
      return {
        success: false,
        stateVersion: this.stateVersion,
        error: {
          code: 'STALE_VERSION',
          message: \`State version mismatch: expected \${this.stateVersion}, got \${command.stateVersion}\`
        }
      };
    }

    // 5. Sequence check: must be strictly increasing
    if (command.commandSequence !== this.lastCommandSequence + 1) {
      return {
        success: false,
        stateVersion: this.stateVersion,
        error: {
          code: 'OUT_OF_SEQUENCE',
          message: \`Command sequence out of order: expected \${this.lastCommandSequence + 1}, got \${command.commandSequence}\`
        }
      };
    }

    // 6. Game must not be finished
    if (this.phase === 'FINISHED') {
      return {
        success: false,
        stateVersion: this.stateVersion,
        error: {
          code: 'INVALID_PHASE',
          message: 'Game is already finished'
        }
      };
    }

    // 7. Dispatch command by type
    let res: CommandResult;
    switch (command.type) {
      case 'SELECT_BOX':
        res = this.executeSelectBox(command.boxId);
        break;
      case 'OPEN_BOX':
        res = this.executeOpenBox(command.boxId);
        break;
      case 'ACCEPT_OFFER':
        res = this.executeAcceptOffer(command.offerId);
        break;
      case 'REJECT_OFFER':
        res = this.executeRejectOffer(command.offerId);
        break;
      case 'KEEP_BOX':
        res = this.executeKeepBox();
        break;
      case 'SWAP_BOX':
        res = this.executeSwapBox(command.targetBoxId);
        break;
      default:
        res = {
          success: false,
          stateVersion: this.stateVersion,
          error: { code: 'INVALID_PAYLOAD', message: 'Unknown command' }
        };
        break;
    }

    // If command succeeded, advance command sequence and record in idempotency cache
    if (res.success) {
      this.lastCommandSequence = command.commandSequence;
      this.recordIdempotency(command.idempotencyKey, payloadHash, res);
    }

    return res;
  }

  private recordIdempotency(key: string, payloadHash: string, result: CommandResult) {
    if (this.idempotencyCache.size >= GameEngine.MAX_IDEMPOTENCY_ENTRIES) {
      const firstKey = this.idempotencyCache.keys().next().value;
      if (firstKey !== undefined) {
        this.idempotencyCache.delete(firstKey);
      }
    }
    this.idempotencyCache.set(key, { payloadHash, result });
  }

  private executeSelectBox(boxId: number): CommandResult {
    if (this.phase !== 'SELECTING') {
      return {
        success: false,
        stateVersion: this.stateVersion,
        error: { code: 'INVALID_PHASE', message: 'Player box can only be selected during SELECTING phase' }
      };
    }

    if (boxId < 1 || boxId > TOTAL_BOXES) {
      return {
        success: false,
        stateVersion: this.stateVersion,
        error: { code: 'INVALID_BOX', message: 'Box ID out of bounds' }
      };
    }

    this.originalPlayerBoxId = boxId;
    this.currentPlayerBoxId = boxId;
    this.phase = 'OPENING';
    this.stateVersion++;

    // Arm timer for opening box in round 1 (20s)
    this.armTimeout('OPENING', TIMEOUT_SECONDS.OPEN_BOX);

    const event: PublicGameEvent = {
      type: 'BOX_SELECTED',
      boxId,
      stateVersion: this.stateVersion
    };
    const snapshot = this.getPublicSnapshot();
    this.notifyEvent(event, snapshot);

    return {
      success: true,
      stateVersion: this.stateVersion,
      event,
      snapshot
    };
  }

  private executeOpenBox(boxId: number): CommandResult {
    if (this.phase !== 'OPENING') {
      return {
        success: false,
        stateVersion: this.stateVersion,
        error: { code: 'INVALID_PHASE', message: 'Boxes can only be opened during OPENING phase' }
      };
    }

    if (boxId < 1 || boxId > TOTAL_BOXES) {
      return {
        success: false,
        stateVersion: this.stateVersion,
        error: { code: 'INVALID_BOX', message: 'Box ID out of bounds' }
      };
    }

    if (boxId === this.currentPlayerBoxId) {
      return {
        success: false,
        stateVersion: this.stateVersion,
        error: { code: 'INVALID_BOX', message: 'Cannot open player selected box during regular opening' }
      };
    }

    if (this.openedBoxIds.has(boxId)) {
      return {
        success: false,
        stateVersion: this.stateVersion,
        error: { code: 'INVALID_BOX', message: 'Box has already been opened' }
      };
    }

    // Open box
    this.openedBoxIds.add(boxId);
    this.boxesOpenedThisRound++;
    this.totalOpenedBoxes++;
    const revealedAmount = this.boxAmountMap.get(boxId)!;
    this.stateVersion++;

    const openEvent: PublicGameEvent = {
      type: 'BOX_OPENED',
      boxId,
      revealedAmount,
      stateVersion: this.stateVersion
    };

    // Check game progression:
    // If total opened boxes reaches 24 (only 2 boxes remain unopened), transition directly to FINAL_SWAP!
    if (this.totalOpenedBoxes >= TOTAL_BOXES_TO_OPEN_BEFORE_FINAL) {
      this.phase = 'FINAL_SWAP';
      this.currentOffer = null;
      this.armTimeout('FINAL_SWAP', TIMEOUT_SECONDS.FINAL_CHOICE);
    } else {
      const currentTarget = ROUND_TARGETS[this.currentRound - 1] ?? 1;
      if (this.boxesOpenedThisRound >= currentTarget) {
        // Round complete -> Banker Offer Phase!
        this.phase = 'OFFERING';
        const offerAmount = this.calculateBankerOffer();
        const offerId = 'off_' + crypto.randomUUID();
        const expiresAt = this.clock.now() + TIMEOUT_SECONDS.BANKER_OFFER * 1000;
        this.currentOffer = {
          offerId,
          amount: offerAmount,
          expiresAt
        };
        this.armTimeout('OFFERING', TIMEOUT_SECONDS.BANKER_OFFER);
      } else {
        // Still opening boxes in current round
        this.armTimeout('OPENING', TIMEOUT_SECONDS.OPEN_BOX);
      }
    }

    const snapshot = this.getPublicSnapshot();
    this.notifyEvent(openEvent, snapshot);

    return {
      success: true,
      stateVersion: this.stateVersion,
      event: openEvent,
      snapshot
    };
  }

  private executeAcceptOffer(offerId: string): CommandResult {
    if (this.phase !== 'OFFERING') {
      return {
        success: false,
        stateVersion: this.stateVersion,
        error: { code: 'INVALID_PHASE', message: 'Offers can only be accepted during OFFERING phase' }
      };
    }

    if (!this.currentOffer || this.currentOffer.offerId !== offerId) {
      return {
        success: false,
        stateVersion: this.stateVersion,
        error: { code: 'OFFER_EXPIRED', message: 'Offer ID mismatch or no active offer' }
      };
    }

    if (this.clock.now() > this.currentOffer.expiresAt) {
      return {
        success: false,
        stateVersion: this.stateVersion,
        error: { code: 'OFFER_EXPIRED', message: 'Offer has expired' }
      };
    }

    this.clearTimer();
    const acceptedAmount = this.currentOffer.amount;
    this.phase = 'FINISHED';
    this.stateVersion++;

    const resultId = 'res_' + crypto.randomUUID();
    const finalBoxAmount = this.boxAmountMap.get(this.currentPlayerBoxId!)!;

    this.settlement = {
      resultId,
      wonAmount: acceptedAmount,
      outcomeType: 'OFFER_ACCEPTED',
      originalPlayerBoxId: this.originalPlayerBoxId!,
      finalPlayerBoxId: this.currentPlayerBoxId!,
      acceptedOfferAmount: acceptedAmount,
      finalBoxAmount,
      allBoxes: this.getAllBoxesRevealed()
    };
    this.currentOffer = null;

    const event: PublicGameEvent = {
      type: 'OFFER_ACCEPTED',
      offerId,
      amount: acceptedAmount,
      stateVersion: this.stateVersion
    };

    const snapshot = this.getPublicSnapshot();
    this.notifyEvent(event, snapshot);

    return {
      success: true,
      stateVersion: this.stateVersion,
      event,
      snapshot
    };
  }

  private executeRejectOffer(offerId: string): CommandResult {
    if (this.phase !== 'OFFERING') {
      return {
        success: false,
        stateVersion: this.stateVersion,
        error: { code: 'INVALID_PHASE', message: 'Offers can only be rejected during OFFERING phase' }
      };
    }

    if (!this.currentOffer || this.currentOffer.offerId !== offerId) {
      return {
        success: false,
        stateVersion: this.stateVersion,
        error: { code: 'OFFER_EXPIRED', message: 'Offer ID mismatch or no active offer' }
      };
    }

    this.clearTimer();
    this.currentOffer = null;
    this.currentRound++;
    this.boxesOpenedThisRound = 0;
    this.phase = 'OPENING';
    this.stateVersion++;

    // Arm timeout for next round opening
    this.armTimeout('OPENING', TIMEOUT_SECONDS.OPEN_BOX);

    const event: PublicGameEvent = {
      type: 'OFFER_REJECTED',
      offerId,
      nextRound: this.currentRound,
      stateVersion: this.stateVersion
    };

    const snapshot = this.getPublicSnapshot();
    this.notifyEvent(event, snapshot);

    return {
      success: true,
      stateVersion: this.stateVersion,
      event,
      snapshot
    };
  }

  private executeKeepBox(): CommandResult {
    if (this.phase !== 'FINAL_SWAP') {
      return {
        success: false,
        stateVersion: this.stateVersion,
        error: { code: 'INVALID_PHASE', message: 'Keep box only valid during FINAL_SWAP phase' }
      };
    }

    this.clearTimer();
    this.phase = 'FINISHED';
    this.stateVersion++;

    const resultId = 'res_' + crypto.randomUUID();
    const wonAmount = this.boxAmountMap.get(this.currentPlayerBoxId!)!;

    this.settlement = {
      resultId,
      wonAmount,
      outcomeType: 'FINAL_KEEP',
      originalPlayerBoxId: this.originalPlayerBoxId!,
      finalPlayerBoxId: this.currentPlayerBoxId!,
      finalBoxAmount: wonAmount,
      allBoxes: this.getAllBoxesRevealed()
    };

    const event: PublicGameEvent = {
      type: 'FINAL_KEEP',
      boxId: this.currentPlayerBoxId!,
      amount: wonAmount,
      stateVersion: this.stateVersion
    };

    const snapshot = this.getPublicSnapshot();
    this.notifyEvent(event, snapshot);

    return {
      success: true,
      stateVersion: this.stateVersion,
      event,
      snapshot
    };
  }

  private executeSwapBox(targetBoxId: number): CommandResult {
    if (this.phase !== 'FINAL_SWAP') {
      return {
        success: false,
        stateVersion: this.stateVersion,
        error: { code: 'INVALID_PHASE', message: 'Swap box only valid during FINAL_SWAP phase' }
      };
    }

    if (targetBoxId < 1 || targetBoxId > TOTAL_BOXES) {
      return {
        success: false,
        stateVersion: this.stateVersion,
        error: { code: 'INVALID_BOX', message: 'Target box ID out of bounds' }
      };
    }

    if (targetBoxId === this.currentPlayerBoxId) {
      return {
        success: false,
        stateVersion: this.stateVersion,
        error: { code: 'INVALID_BOX', message: 'Cannot swap with player currently chosen box' }
      };
    }

    if (this.openedBoxIds.has(targetBoxId)) {
      return {
        success: false,
        stateVersion: this.stateVersion,
        error: { code: 'INVALID_BOX', message: 'Cannot swap with an already opened box' }
      };
    }

    this.clearTimer();
    const oldBoxId = this.currentPlayerBoxId!;
    this.currentPlayerBoxId = targetBoxId;
    this.phase = 'FINISHED';
    this.stateVersion++;

    const resultId = 'res_' + crypto.randomUUID();
    const wonAmount = this.boxAmountMap.get(targetBoxId)!;

    this.settlement = {
      resultId,
      wonAmount,
      outcomeType: 'FINAL_SWAP',
      originalPlayerBoxId: this.originalPlayerBoxId!,
      finalPlayerBoxId: targetBoxId,
      finalBoxAmount: wonAmount,
      allBoxes: this.getAllBoxesRevealed()
    };

    const event: PublicGameEvent = {
      type: 'FINAL_SWAP',
      originalBoxId: oldBoxId,
      newBoxId: targetBoxId,
      amount: wonAmount,
      stateVersion: this.stateVersion
    };

    const snapshot = this.getPublicSnapshot();
    this.notifyEvent(event, snapshot);

    return {
      success: true,
      stateVersion: this.stateVersion,
      event,
      snapshot
    };
  }

  private getAllBoxesRevealed(): Array<{ id: number; amount: number }> {
    const list: Array<{ id: number; amount: number }> = [];
    for (let id = 1; id <= TOTAL_BOXES; id++) {
      list.push({ id, amount: this.boxAmountMap.get(id)! });
    }
    return list;
  }

  private notifyEvent(event: PublicGameEvent, snapshot: PublicSnapshot) {
    if (this.onEventHandler) {
      this.onEventHandler(event, snapshot);
    }
  }

  public getPublicSnapshot(): PublicSnapshot {
    const boxes: PublicBox[] = [];
    for (let id = 1; id <= TOTAL_BOXES; id++) {
      if (this.openedBoxIds.has(id)) {
        boxes.push({
          id,
          status: 'opened',
          revealedAmount: this.boxAmountMap.get(id)!
        });
      } else if (id === this.currentPlayerBoxId) {
        boxes.push({
          id,
          status: 'selected'
        });
      } else {
        boxes.push({
          id,
          status: 'unopened'
        });
      }
    }

    const currentRoundIndex = this.currentRound - 1;
    const targetThisRound = (this.phase === 'OPENING' && currentRoundIndex < ROUND_TARGETS.length)
      ? ROUND_TARGETS[currentRoundIndex]
      : 0;
    const boxesToOpenThisRound = this.phase === 'OPENING'
      ? Math.max(0, targetThisRound - this.boxesOpenedThisRound)
      : 0;

    return {
      gameId: this.gameId,
      ruleVersion: RULE_VERSION,
      phase: this.phase,
      stateVersion: this.stateVersion,
      originalPlayerBoxId: this.originalPlayerBoxId,
      currentPlayerBoxId: this.currentPlayerBoxId,
      currentRound: this.currentRound,
      boxesToOpenThisRound,
      totalOpenedBoxes: this.totalOpenedBoxes,
      unopenedCount: TOTAL_BOXES - this.totalOpenedBoxes,
      boxes,
      currentOffer: this.currentOffer ? {
        offerId: this.currentOffer.offerId,
        amount: this.currentOffer.amount,
        expiresAt: this.currentOffer.expiresAt
      } : null,
      deadlineTimestamp: this.deadlineTimestamp,
      settlement: this.settlement ? { ...this.settlement } : null
    };
  }

  public isFinished(): boolean {
    return this.phase === 'FINISHED';
  }

  public getStateVersion(): number {
    return this.stateVersion;
  }

  public getPhase(): GamePhase {
    return this.phase;
  }

  public getOriginalPlayerBoxId(): number | null {
    return this.originalPlayerBoxId;
  }

  public getCurrentPlayerBoxId(): number | null {
    return this.currentPlayerBoxId;
  }

  public getSettlement(): PublicSettlement | null {
    return this.settlement;
  }

  public dispose(): void {
    this.clearTimer();
  }
}
`);

// 7. apps/game-server/src/room/Classic26Room.ts
write('apps/game-server/src/room/Classic26Room.ts', `import { Room, Client } from '@colyseus/core';
import { GameEngine } from '../engine/GameEngine';
import { validateClientCommand } from '../../../../packages/protocol/src/validation';
import { TIMEOUT_SECONDS } from '../../../../packages/protocol/src/config';
import { PublicSnapshot, CommandResult } from '../../../../packages/protocol/src/types';

export class Classic26Room extends Room {
  public maxClients = 1;
  private engine!: GameEngine;
  private connectedClient: Client | null = null;

  onCreate(options: any) {
    this.engine = new GameEngine({
      gameId: 'game_' + this.roomId,
      customBoxAmountMap: options?.customBoxAmountMap
    });

    // Notify connected client on server events
    this.engine.setOnEventHandler((event, snapshot) => {
      this.broadcast('game_event', event);
    });

    // Handle client messages
    this.onMessage('request_snapshot', (client) => {
      if (this.connectedClient && client.sessionId !== this.connectedClient.sessionId) {
        client.send('error', { code: 'UNAUTHORIZED', message: 'Unauthorized client' });
        return;
      }
      const snapshot = this.engine.getPublicSnapshot();
      client.send('snapshot', snapshot);
    });

    this.onMessage('command', (client, rawPayload) => {
      if (this.connectedClient && client.sessionId !== this.connectedClient.sessionId) {
        client.send('command_result', {
          success: false,
          stateVersion: this.engine.getStateVersion(),
          error: { code: 'UNAUTHORIZED', message: 'Unauthorized client' }
        } as CommandResult);
        return;
      }

      const validation = validateClientCommand(rawPayload);
      if (!validation.valid || !validation.command) {
        client.send('command_result', {
          success: false,
          stateVersion: this.engine.getStateVersion(),
          error: validation.error
        } as CommandResult);
        return;
      }

      const result = this.engine.processCommand(validation.command);
      client.send('command_result', result);
    });
  }

  onAuth(client: Client, options: any) {
    // Single player room: reject any second client joining
    if (this.clients.length >= 1 && (!this.connectedClient || client.sessionId !== this.connectedClient.sessionId)) {
      throw new Error('Room is full');
    }
    return true;
  }

  onJoin(client: Client, options: any) {
    this.connectedClient = client;
    // Welcome client and provide basic status; client sends request_snapshot to get state
    client.send('ready', {
      gameId: this.engine.gameId,
      stateVersion: this.engine.getStateVersion()
    });
  }

  async onLeave(client: Client, consented: boolean) {
    if (consented) {
      // Intentional exit -> dispose room
      this.disconnect();
      return;
    }

    // Abnormal disconnect: allow reconnection for 120 seconds.
    // Engine timers continue running during this period!
    try {
      await this.allowReconnection(client, TIMEOUT_SECONDS.RECONNECT_GRACE);
      // Client reconnected successfully!
      this.connectedClient = client;
    } catch (e) {
      // 120 seconds expired without reconnecting -> dispose room
      this.disconnect();
    }
  }

  onDispose() {
    if (this.engine) {
      this.engine.dispose();
    }
  }

  // Helper for tests to inspect engine
  public getEngine(): GameEngine {
    return this.engine;
  }
}
`);

// 8. apps/game-server/src/server.ts
write('apps/game-server/src/server.ts', `import http from 'node:http';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { Classic26Room } from './room/Classic26Room';

export interface AppServerOptions {
  port?: number;
  host?: string;
  server?: http.Server;
}

export function createAppServer(options: AppServerOptions = {}) {
  const httpServer = options.server || http.createServer();
  const transport = new WebSocketTransport({
    server: httpServer
  });

  const gameServer = new Server({
    transport
  });

  // Define room
  gameServer.define('classic_26', Classic26Room);

  return {
    httpServer,
    gameServer,
    listen: (port = options.port || 2567, host = options.host || '0.0.0.0'): Promise<number> => {
      return new Promise((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(port, host, () => {
          const addr = httpServer.address();
          const actualPort = typeof addr === 'object' && addr ? addr.port : port;
          resolve(actualPort);
        });
      });
    },
    close: async (): Promise<void> => {
      await gameServer.gracefullyShutdown();
      return new Promise((resolve) => {
        httpServer.close(() => resolve());
      });
    }
  };
}
`);

// 9. apps/game-server/src/index.ts
write('apps/game-server/src/index.ts', `import { createAppServer } from './server';

const PORT = Number(process.env.PORT) || 2567;
const HOST = process.env.HOST || '0.0.0.0';

async function main() {
  const app = createAppServer();
  const actualPort = await app.listen(PORT, HOST);
  console.log(\`[game-server] BubbleFortune Classic 26 Server listening on http://\${HOST}:\${actualPort}\`);

  const shutdown = async () => {
    console.log('[game-server] Shutting down gracefully...');
    await app.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[game-server] Startup error:', err);
  process.exit(1);
});
`);

// 10. tsconfig.server.json
write('tsconfig.server.json', `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "types": ["node"],
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "isolatedModules": true,
    "noEmit": true
  },
  "include": [
    "packages/protocol/src/**/*",
    "apps/game-server/src/**/*",
    "apps/game-server/tests/**/*"
  ]
}
`);

// 11. apps/game-server/tests/unit/engine.test.ts
write('apps/game-server/tests/unit/engine.test.ts', `import { test, describe } from 'node:test';
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
  test('generates exactly 26 boxes matching MONEY_VALUES with random shuffle', () => {
    const engine = new GameEngine();
    const snapshot = engine.getPublicSnapshot();
    assert.equal(snapshot.boxes.length, 26);
    assert.equal(snapshot.unopenedCount, 26);

    // Let game finish via timeouts to inspect allBoxes in settlement
    const clock = new FakeClock();
    const autoEngine = new GameEngine({ clock });
    // Advance selecting timeout
    clock.tick(31000);
    assert.equal(autoEngine.getPhase(), 'OPENING');
  });
});

describe('GameEngine - Secret Isolation in Snapshots', () => {
  function verifyNoSecretLeak(snapshot: PublicSnapshot) {
    for (const box of snapshot.boxes) {
      if (box.status === 'unopened' || box.status === 'selected') {
        assert.equal('amount' in box, false, \`Unopened box \${box.id} must not have 'amount'\`);
        assert.equal('value' in box, false, \`Unopened box \${box.id} must not have 'value'\`);
        assert.equal('revealedAmount' in box, false, \`Unopened box \${box.id} must not have 'revealedAmount'\`);
      }
    }
    const raw = JSON.stringify(snapshot);
    assert.equal(raw.includes('boxAmountMap'), false, 'Snapshot must not contain boxAmountMap');
    assert.equal(raw.includes('riskFactor'), false, 'Snapshot must not contain riskFactor');
    assert.equal(raw.includes('ev'), false, 'Snapshot must not contain ev');
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
        assert.equal(res.success, true, \`Failed opening box \${currentBox}\`);
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
});
`);

// 12. apps/game-server/tests/network/colyseus_integration.test.ts
write('apps/game-server/tests/network/colyseus_integration.test.ts', `import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from 'colyseus.js';
import { createAppServer } from '../../src/server';
import { PublicSnapshot, CommandResult } from '../../../../packages/protocol/src/types';

describe('Colyseus Network Integration Tests (127.0.0.1)', () => {
  let app: ReturnType<typeof createAppServer>;
  let port: number;
  let serverUrl: string;

  before(async () => {
    // Start server on 127.0.0.1 with dynamic port
    app = createAppServer();
    port = await app.listen(0, '127.0.0.1');
    serverUrl = \`ws://127.0.0.1:\${port}\`;
    console.log('[test] Started integration test server on', serverUrl);
  });

  after(async () => {
    if (app) {
      await app.close();
      console.log('[test] Closed integration test server');
    }
  });

  test('full flow: create -> snapshot -> select -> open 6 boxes -> offer -> accept', async () => {
    const client = new Client(serverUrl);
    const room = await client.create('classic_26');
    assert.ok(room.roomId);

    // Helper to send message and wait for specific response
    const waitForMessage = <T>(type: string): Promise<T> => {
      return new Promise((resolve) => {
        room.onMessage(type, (msg) => {
          resolve(msg as T);
        });
      });
    };

    // Request snapshot
    room.send('request_snapshot', {});
    const snapshot = await waitForMessage<PublicSnapshot>('snapshot');
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
    room.send('command', {
      type: 'SELECT_BOX',
      gameId: snapshot.gameId,
      stateVersion: 1,
      commandSequence: 1,
      idempotencyKey: 'net_k1',
      boxId: 1
    });

    const selectRes = await waitForMessage<CommandResult>('command_result');
    assert.equal(selectRes.success, true);
    assert.equal(selectRes.stateVersion, 2);
    assert.equal(selectRes.snapshot?.currentPlayerBoxId, 1);
    assert.equal(selectRes.snapshot?.phase, 'OPENING');

    // Open boxes 2..7 (6 boxes for round 1)
    let curVer = selectRes.stateVersion;
    let curSeq = 2;
    let lastRes = selectRes;

    for (let boxId = 2; boxId <= 7; boxId++) {
      room.send('command', {
        type: 'OPEN_BOX',
        gameId: snapshot.gameId,
        stateVersion: curVer,
        commandSequence: curSeq,
        idempotencyKey: 'net_open_' + boxId,
        boxId
      });

      lastRes = await waitForMessage<CommandResult>('command_result');
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
    room.send('command', {
      type: 'ACCEPT_OFFER',
      gameId: snapshot.gameId,
      stateVersion: curVer,
      commandSequence: curSeq,
      idempotencyKey: 'net_accept',
      offerId: offer.offerId
    });

    const acceptRes = await waitForMessage<CommandResult>('command_result');
    assert.equal(acceptRes.success, true);
    assert.equal(acceptRes.snapshot?.phase, 'FINISHED');
    assert.ok(acceptRes.snapshot?.settlement);
    assert.equal(acceptRes.snapshot?.settlement.outcomeType, 'OFFER_ACCEPTED');
    assert.equal(acceptRes.snapshot?.settlement.wonAmount, offer.amount);

    await room.leave();
  });

  test('second client is rejected when joining active single player room', async () => {
    const client1 = new Client(serverUrl);
    const room1 = await client1.create('classic_26');
    assert.ok(room1.roomId);

    const client2 = new Client(serverUrl);
    await assert.rejects(
      async () => {
        await client2.joinById(room1.roomId);
      },
      /Room is full|matchmake failed|not found/i,
      'Second client must be rejected from joining single player room'
    );

    await room1.leave();
  });

  test('abnormal disconnect allows reconnection with token, preserving state without secret leak', async () => {
    const client1 = new Client(serverUrl);
    const room1 = await client1.create('classic_26');

    // Helper
    const waitForMessage = <T>(type: string): Promise<T> => {
      return new Promise((resolve) => {
        room1.onMessage(type, (msg) => {
          resolve(msg as T);
        });
      });
    };

    // Make 1 move
    room1.send('command', {
      type: 'SELECT_BOX',
      gameId: 'reconnect_game',
      stateVersion: 1,
      commandSequence: 1,
      idempotencyKey: 'rec_k1',
      boxId: 5
    });
    const moveRes = await waitForMessage<CommandResult>('command_result');
    assert.equal(moveRes.success, true);
    assert.equal(moveRes.stateVersion, 2);

    const token = room1.reconnectionToken;
    assert.ok(token);

    // Simulate unexpected drop: close underlying socket directly
    (room1.connection as any).transport.ws.close();

    // Wait a brief tick for server to register onLeave
    await new Promise((r) => setTimeout(r, 150));

    // Reconnect with client2 using token
    const client2 = new Client(serverUrl);
    const reconnectedRoom = await client2.reconnect(token);
    assert.equal(reconnectedRoom.sessionId, room1.sessionId);

    // Request snapshot on reconnected room
    const snapPromise = new Promise<PublicSnapshot>((resolve) => {
      reconnectedRoom.onMessage('snapshot', (msg) => resolve(msg as PublicSnapshot));
    });
    reconnectedRoom.send('request_snapshot', {});
    const reconnectedSnap = await snapPromise;

    assert.equal(reconnectedSnap.stateVersion, 2);
    assert.equal(reconnectedSnap.currentPlayerBoxId, 5);
    assert.equal(reconnectedSnap.phase, 'OPENING');

    // Verify no secret leak
    for (const b of reconnectedSnap.boxes) {
      if (b.status !== 'opened') {
        assert.equal('amount' in b, false);
        assert.equal('value' in b, false);
      }
    }

    await reconnectedRoom.leave();
  });

  test('reconnection with bogus token is rejected', async () => {
    const client = new Client(serverUrl);
    const room = await client.create('classic_26');
    const roomId = room.roomId;
    await room.leave();

    const bogusClient = new Client(serverUrl);
    await assert.rejects(
      async () => {
        await bogusClient.reconnect(roomId + ':invalid_token_xyz_123');
      },
      /reconnection token|matchmake failed|not found/i
    );
  });
});
`);

console.log('Finished writing network tests.');




