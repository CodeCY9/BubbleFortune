import crypto from 'node:crypto';
import {
  ROUND_TARGETS,
  MONEY_VALUES,
  TOTAL_BOXES
} from '../../../../packages/protocol/src/config';
import {
  AuditEvent,
  PublicBox,
  PublicOffer,
  PublicError
} from '../../../../packages/protocol/src/types';
import {
  DUEL_RULE_VERSION,
  DUEL_TIMEOUT_SECONDS,
  DUEL_BANKER_BUDGET,
  DuelActionType,
  DuelClientSnapshot,
  DuelCommand,
  DuelCommandResult,
  DuelFairnessProof,
  DuelOfferHistoryEntry,
  DuelOfferRange,
  DuelPhase,
  DuelPrivateView,
  DuelPublicSnapshot,
  DuelResult,
  DuelRole,
  DuelRoundResult,
  DuelSeatId,
  DuelSeatInfo,
  CompletedDuelRecord,
  validateDuelCommand
} from '../../../../packages/protocol/src/duel';
import { canonicalJsonStringify } from '../../../../packages/protocol/src/canonical';
import { FAIRNESS_ALGORITHM, GENESIS_PREVIOUS_HASH } from '../../../../packages/protocol/src/fairness';
import { Clock, ClockTimer, SystemClock } from './clock';
import { createAuditEvent } from './audit';
import { generateFairnessBundle } from './fairness';

interface SeatInternal {
  seatId: DuelSeatId;
  occupied: boolean;
  nickname: string;
  connected: boolean;
  ready: boolean;
  role: DuelRole | null;
  score: number;
  lastCommandSequence: number;
  idempotencyCache: Map<string, { payloadHash: string; result: DuelCommandResult }>;
  disconnectTimestamp: number | null;
}

export interface DuelEngineOptions {
  roomId: string;
  matchId?: string;
  clock?: Clock;
  randomIntFn?: (min: number, max: number) => number;
  isPrivate?: boolean;
  ranked?: boolean;
}

export class DuelEngine {
  public readonly roomId: string;
  public readonly matchId: string;
  public readonly ruleVersion = DUEL_RULE_VERSION;
  public readonly isPrivate: boolean;
  public readonly ranked: boolean;
  private stateVersion = 1;
  private phase: DuelPhase = 'WAITING';
  private roundIndex = 0; // 0=WAITING, 1=Round 1, 2=Round 2
  private boxRound = 0; // 1..9
  private boxesLeftToOpenThisRound = 0;
  private hostSeatId: DuelSeatId | null = 0;
  private challengerSeatId: DuelSeatId | null = null;
  private bankerSeatId: DuelSeatId | null = null;
  private deadlineTimestamp: number | null = null;
  private playerBoxId: number | null = null;
  private readonly openedBoxIds = new Set<number>();
  private readonly openedBoxOrder: number[] = [];
  private boxAmountMap = new Map<number, number>();
  private currentOffer: PublicOffer | null = null;
  private readonly offerHistory: DuelOfferHistoryEntry[] = [];
  private readonly roundResults: DuelRoundResult[] = [];
  private readonly fairnessCommitments: Record<number, string> = {};
  private result: DuelResult | null = null;
  private completedRecord: CompletedDuelRecord | null = null;
  private continueReady: [boolean, boolean] = [false, false];

  private readonly clock: Clock;
  private readonly randomInt: (min: number, max: number) => number;
  private readonly seats: [SeatInternal, SeatInternal];
  private readonly auditTrail: AuditEvent[] = [];
  private readonly roundFairnessData = new Map<
    number,
    { algorithm: string; seed: string; salt: string; commitment: string; boxAmountMap: Map<number, number> }
  >();

  private activeTimer: ClockTimer | null = null;
  private seatDisconnectTimers: [ClockTimer | null, ClockTimer | null] = [null, null];
  private onEventHandler?: (event: any, snapshot: DuelPublicSnapshot) => void;
  private onStateChangeHandler?: (event?: any) => void;

  private static readonly MAX_IDEMPOTENCY_ENTRIES = 500;

  constructor(options: DuelEngineOptions) {
    this.roomId = options.roomId;
    this.matchId = options.matchId || `duel_${crypto.randomUUID()}`;
    this.clock = options.clock || new SystemClock();
    this.randomInt = options.randomIntFn || crypto.randomInt;
    this.isPrivate = options.isPrivate === true;
    this.ranked = options.ranked !== false;

    this.seats = [
      {
        seatId: 0,
        occupied: false,
        nickname: '玩家1',
        connected: false,
        ready: false,
        role: null,
        score: 0,
        lastCommandSequence: 0,
        idempotencyCache: new Map(),
        disconnectTimestamp: null
      },
      {
        seatId: 1,
        occupied: false,
        nickname: '玩家2',
        connected: false,
        ready: false,
        role: null,
        score: 0,
        lastCommandSequence: 0,
        idempotencyCache: new Map(),
        disconnectTimestamp: null
      }
    ];

    this.recordAuditEvent('MATCH_CREATED', {
      roomId: this.roomId,
      matchId: this.matchId,
      ruleVersion: this.ruleVersion,
      isPrivate: this.isPrivate,
      ranked: this.ranked
    });
  }

  public setOnEventHandler(handler: (event: any, snapshot: DuelPublicSnapshot) => void): void {
    this.onEventHandler = handler;
  }

  public setOnStateChange(handler: (event?: any) => void): void {
    this.onStateChangeHandler = handler;
  }

  private notifyStateChange(event?: any): void {
    if (this.onEventHandler && event) {
      this.onEventHandler(event, this.getPublicSnapshot());
    }
    if (this.onStateChangeHandler) {
      this.onStateChangeHandler(event);
    }
  }

  private sanitizeNickname(nickname?: string, fallback: string = '玩家'): string {
    if (!nickname || typeof nickname !== 'string') return fallback;
    const clean = Array.from(nickname.trim()).slice(0, 16).join('');
    return clean.length > 0 ? clean : fallback;
  }

  public joinSeat(seatId: DuelSeatId, nickname?: string): boolean {
    if (this.phase !== 'WAITING') return false;
    const seat = this.seats[seatId];
    if (seat.occupied) return false;

    // Clean slate when occupying seat
    seat.occupied = true;
    seat.connected = true;
    seat.nickname = this.sanitizeNickname(nickname, `玩家${seatId + 1}`);
    seat.ready = false;
    seat.score = 0;
    seat.role = null;
    seat.lastCommandSequence = 0;
    seat.idempotencyCache.clear();
    seat.disconnectTimestamp = null;

    if (this.seatDisconnectTimers[seatId]) {
      this.seatDisconnectTimers[seatId]!.cancel();
      this.seatDisconnectTimers[seatId] = null;
    }

    if (this.hostSeatId === null) {
      this.hostSeatId = seatId;
    }

    this.stateVersion++;
    this.recordAuditEvent('PLAYER_JOINED', { seatId, nickname: seat.nickname });
    this.notifyStateChange({ type: 'PLAYER_JOINED', seatId });
    return true;
  }

  /**
   * Tournament coordinator hook. A bracket match has already completed its
   * lobby checks in the parent room, so both duel seats start ready without
   * consuming either player's first client command sequence.
   */
  public startTournamentMatch(): boolean {
    if (this.phase !== 'WAITING' || !this.seats[0].occupied || !this.seats[1].occupied) {
      return false;
    }
    this.seats[0].ready = true;
    this.seats[1].ready = true;
    this.startRound(1);
    return true;
  }

  public leaveSeat(seatId: DuelSeatId): void {
    if (this.phase === 'WAITING') {
      const seat = this.seats[seatId];
      if (!seat.occupied) return;
      seat.occupied = false;
      seat.connected = false;
      seat.ready = false;
      seat.role = null;
      seat.score = 0;
      seat.lastCommandSequence = 0;
      seat.idempotencyCache.clear();
      seat.disconnectTimestamp = null;
      seat.nickname = `玩家${seatId + 1}`;

      if (this.seatDisconnectTimers[seatId]) {
        this.seatDisconnectTimers[seatId]!.cancel();
        this.seatDisconnectTimers[seatId] = null;
      }

      if (this.hostSeatId === seatId || this.hostSeatId === null) {
        const otherSeatId: DuelSeatId = seatId === 0 ? 1 : 0;
        this.hostSeatId = this.seats[otherSeatId].occupied ? otherSeatId : null;
      } else {
        const otherSeatId: DuelSeatId = seatId === 0 ? 1 : 0;
        if (!this.seats[otherSeatId].occupied) {
          this.hostSeatId = null;
        }
      }

      // Clear ready of remaining player when seat change happens
      this.seats[0].ready = false;
      this.seats[1].ready = false;

      this.stateVersion++;
      this.recordAuditEvent('PLAYER_LEFT_LOBBY', { seatId });
      this.notifyStateChange({ type: 'PLAYER_LEFT_LOBBY', seatId });
    }
  }

  public setConnected(seatId: DuelSeatId, connected: boolean): boolean {
    const seat = this.seats[seatId];
    if (!seat.occupied) return false;

    if (connected) {
      // Reconnecting
      if (this.phase !== 'WAITING' && this.phase !== 'FINISHED') {
        // Check if grace period already expired before allowing reconnection
        if (
          seat.disconnectTimestamp !== null &&
          this.clock.now() - seat.disconnectTimestamp >= DUEL_TIMEOUT_SECONDS.RECONNECT_GRACE * 1000
        ) {
          this.checkDisconnectExpirations();
          return false;
        }
      }

      seat.connected = true;
      seat.disconnectTimestamp = null;
      if (this.seatDisconnectTimers[seatId]) {
        this.seatDisconnectTimers[seatId]!.cancel();
        this.seatDisconnectTimers[seatId] = null;
      }

      if (this.phase !== 'FINISHED') {
        this.stateVersion++;
        this.recordAuditEvent('PLAYER_RECONNECTED', { seatId });
      }
      this.notifyStateChange({ type: 'PLAYER_RECONNECTED', seatId });
      return true;
    } else {
      // Disconnecting
      seat.connected = false;
      seat.disconnectTimestamp = this.clock.now();

      if (this.phase !== 'FINISHED') {
        this.stateVersion++;
        this.recordAuditEvent('PLAYER_DISCONNECTED', { seatId });

        // Disconnection timer: 120s grace period (runs in WAITING and active match)
        if (!this.seatDisconnectTimers[seatId]) {
          this.seatDisconnectTimers[seatId] = this.clock.setTimeout(() => {
            this.handleDisconnectExpiry(seatId);
          }, DUEL_TIMEOUT_SECONDS.RECONNECT_GRACE * 1000);
        }
      }
      this.notifyStateChange({ type: 'PLAYER_DISCONNECTED', seatId });
      return true;
    }
  }

  private checkDisconnectExpirations(): boolean {
    if (this.phase === 'WAITING' || this.phase === 'FINISHED') return false;
    const now = this.clock.now();
    const s0Expired =
      !this.seats[0].connected &&
      this.seats[0].disconnectTimestamp !== null &&
      now - this.seats[0].disconnectTimestamp >= DUEL_TIMEOUT_SECONDS.RECONNECT_GRACE * 1000;
    const s1Expired =
      !this.seats[1].connected &&
      this.seats[1].disconnectTimestamp !== null &&
      now - this.seats[1].disconnectTimestamp >= DUEL_TIMEOUT_SECONDS.RECONNECT_GRACE * 1000;

    if (s0Expired && s1Expired) {
      this.finishMatch('BOTH_FORFEIT');
      return true;
    }
    if (s0Expired) {
      this.finishMatch('TIMEOUT_DISCONNECT', 0);
      return true;
    }
    if (s1Expired) {
      this.finishMatch('TIMEOUT_DISCONNECT', 1);
      return true;
    }
    return false;
  }

  private handleDisconnectExpiry(seatId: DuelSeatId): void {
    this.seatDisconnectTimers[seatId] = null;
    if (this.phase === 'FINISHED') return;

    if (this.phase === 'WAITING') {
      // Expired in WAITING: release seat, transfer host, clear ready
      this.leaveSeat(seatId);
      return;
    }

    const otherSeatId: DuelSeatId = seatId === 0 ? 1 : 0;
    const otherSeat = this.seats[otherSeatId];

    if (!otherSeat.connected && otherSeat.disconnectTimestamp !== null) {
      const elapsed = this.clock.now() - otherSeat.disconnectTimestamp;
      if (elapsed >= DUEL_TIMEOUT_SECONDS.RECONNECT_GRACE * 1000) {
        this.finishMatch('BOTH_FORFEIT');
        return;
      }
    }

    this.finishMatch('TIMEOUT_DISCONNECT', seatId);
  }

  private clearActiveTimer(): void {
    if (this.activeTimer) {
      this.activeTimer.cancel();
      this.activeTimer = null;
    }
    this.deadlineTimestamp = null;
  }

  private clearAllTimers(): void {
    this.clearActiveTimer();
    for (let i = 0; i < 2; i++) {
      if (this.seatDisconnectTimers[i]) {
        this.seatDisconnectTimers[i]!.cancel();
        this.seatDisconnectTimers[i] = null;
      }
    }
  }

  public getStateVersion(): number {
    return this.stateVersion;
  }

  public getPhase(): DuelPhase {
    return this.phase;
  }

  public isFinished(): boolean {
    return this.phase === 'FINISHED';
  }

  public isSeatOccupied(seatId: DuelSeatId): boolean {
    return this.seats[seatId].occupied;
  }

  public getPublicSnapshot(): DuelPublicSnapshot {
    const boxes: PublicBox[] = [];
    for (let id = 1; id <= TOTAL_BOXES; id++) {
      if (this.openedBoxIds.has(id)) {
        boxes.push({
          id,
          status: 'opened',
          revealedAmount: this.boxAmountMap.get(id) ?? 0
        });
      } else if (this.playerBoxId === id) {
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

    const seatsInfo: [DuelSeatInfo, DuelSeatInfo] = [
      {
        seatId: 0,
        occupied: this.seats[0].occupied,
        nickname: this.seats[0].nickname,
        connected: this.seats[0].connected,
        ready: this.seats[0].ready,
        continueReady: this.continueReady[0],
        role: this.seats[0].role,
        score: this.seats[0].score
      },
      {
        seatId: 1,
        occupied: this.seats[1].occupied,
        nickname: this.seats[1].nickname,
        connected: this.seats[1].connected,
        ready: this.seats[1].ready,
        continueReady: this.continueReady[1],
        role: this.seats[1].role,
        score: this.seats[1].score
      }
    ];

    return {
      roomId: this.roomId,
      matchId: this.matchId,
      ruleVersion: this.ruleVersion,
      isPrivate: this.isPrivate,
      ranked: this.ranked,
      stateVersion: this.stateVersion,
      serverNow: this.clock.now(),
      phase: this.phase,
      roundIndex: this.roundIndex,
      boxRound: this.boxRound,
      boxesLeftToOpenThisRound: this.boxesLeftToOpenThisRound,
      seats: seatsInfo,
      hostSeatId: this.hostSeatId,
      challengerSeatId: this.challengerSeatId,
      deadlineTimestamp: this.deadlineTimestamp,
      boxes,
      openedBoxIds: [...this.openedBoxOrder],
      playerBoxId: this.playerBoxId,
      currentOffer: this.currentOffer ? { ...this.currentOffer } : null,
      offerHistory: this.offerHistory.map((o) => ({ ...o })),
      roundResults: this.roundResults.map((r) => ({ ...r })),
      fairnessCommitments: { ...this.fairnessCommitments },
      result: this.result ? { ...this.result } : null
    };
  }

  public getPrivateView(seatId: DuelSeatId): DuelPrivateView {
    const seat = this.seats[seatId];
    const allowedActions = this.getAllowedActions(seatId);

    let offerRange: DuelOfferRange | undefined = undefined;
    if (
      this.phase === 'SUBMITTING_OFFER' &&
      this.bankerSeatId === seatId &&
      allowedActions.includes('SUBMIT_OFFER')
    ) {
      offerRange = this.calculateLegalOfferRange();
    }

    return {
      seatId,
      lastCommandSequence: seat.lastCommandSequence,
      allowedActions,
      ...(offerRange ? { offerRange } : {})
    };
  }

  public getClientSnapshot(seatId: DuelSeatId): DuelClientSnapshot {
    return {
      public: this.getPublicSnapshot(),
      private: this.getPrivateView(seatId)
    };
  }

  public getAllowedActions(seatId: DuelSeatId): DuelActionType[] {
    const seat = this.seats[seatId];
    if (!seat.occupied) return [];

    switch (this.phase) {
      case 'WAITING': {
        const actions: DuelActionType[] = ['READY', 'LEAVE'];
        if (
          this.hostSeatId === seatId &&
          this.seats[0].connected &&
          this.seats[1].connected &&
          this.seats[0].ready &&
          this.seats[1].ready
        ) {
          actions.push('START');
        }
        return actions;
      }
      case 'SELECTING': {
        const actions: DuelActionType[] = ['LEAVE'];
        if (this.challengerSeatId === seatId && this.playerBoxId === null) {
          actions.unshift('SELECT_BOX');
        }
        return actions;
      }
      case 'OPENING': {
        const actions: DuelActionType[] = ['LEAVE'];
        if (this.challengerSeatId === seatId && this.boxesLeftToOpenThisRound > 0) {
          actions.unshift('OPEN_BOX');
        }
        return actions;
      }
      case 'SUBMITTING_OFFER': {
        const actions: DuelActionType[] = ['LEAVE'];
        if (this.bankerSeatId === seatId) {
          actions.unshift('SUBMIT_OFFER');
        }
        return actions;
      }
      case 'OFFERING': {
        const actions: DuelActionType[] = ['LEAVE'];
        if (this.challengerSeatId === seatId) {
          actions.unshift('ACCEPT_OFFER', 'REJECT_OFFER');
        }
        return actions;
      }
      case 'FINAL_SWAP': {
        const actions: DuelActionType[] = ['LEAVE'];
        if (this.challengerSeatId === seatId) {
          actions.unshift('KEEP_BOX', 'SWAP_BOX');
        }
        return actions;
      }
      case 'ROUND_COMPLETE': {
        if (this.continueReady[seatId]) {
          return ['LEAVE'];
        }
        return ['CONTINUE_ROUND', 'LEAVE'];
      }
      case 'FINISHED': {
        return ['LEAVE'];
      }
      default:
        return [];
    }
  }

  public calculateLegalOfferRange(): DuelOfferRange {
    let unopenedSum = 0;
    let unopenedCount = 0;

    for (let id = 1; id <= TOTAL_BOXES; id++) {
      if (!this.openedBoxIds.has(id)) {
        unopenedSum += this.boxAmountMap.get(id) ?? 0;
        unopenedCount++;
      }
    }

    const E = unopenedCount > 0 ? unopenedSum / unopenedCount : 0;
    const r = this.boxRound; // 1-based, matches current round of offers
    const min = Math.max(1, Math.floor(E * (0.3 + 0.06 * (r - 1))));
    const max = Math.min(DUEL_BANKER_BUDGET, Math.ceil(E * 1.2));
    const safeMin = Math.min(min, max);

    return {
      min: safeMin,
      max,
      step: 1
    };
  }

  public processCommand(seatId: DuelSeatId, rawPayload: unknown): DuelCommandResult {
    const rawIdempotencyKey =
      rawPayload &&
      typeof rawPayload === 'object' &&
      !Array.isArray(rawPayload) &&
      typeof (rawPayload as any).idempotencyKey === 'string' &&
      (rawPayload as any).idempotencyKey.length > 0 &&
      (rawPayload as any).idempotencyKey.length <= 128
        ? (rawPayload as any).idempotencyKey
        : undefined;

    const seat = this.seats[seatId];
    if (!seat.occupied) {
      return {
        success: false,
        stateVersion: this.stateVersion,
        idempotencyKey: rawIdempotencyKey,
        error: { code: 'UNAUTHORIZED', message: 'Seat is not occupied' }
      };
    }

    const validation = validateDuelCommand(rawPayload);
    if (!validation.valid || !validation.command) {
      return {
        success: false,
        stateVersion: this.stateVersion,
        idempotencyKey: rawIdempotencyKey,
        snapshot: this.getClientSnapshot(seatId),
        error: validation.error || { code: 'INVALID_PAYLOAD', message: 'Invalid payload' }
      };
    }

    const cmd = validation.command;
    const idempotencyKey = cmd.idempotencyKey;
    const payloadHash = this.hashPayload(rawPayload);

    // Idempotency check per actor: return fresh snapshot of current state
    const cached = seat.idempotencyCache.get(idempotencyKey);
    if (cached) {
      if (cached.payloadHash === payloadHash) {
        this.checkDisconnectExpirations();
        return {
          ...cached.result,
          stateVersion: this.stateVersion,
          snapshot: this.getClientSnapshot(seatId)
        };
      } else {
        return {
          success: false,
          stateVersion: this.stateVersion,
          idempotencyKey,
          snapshot: this.getClientSnapshot(seatId),
          error: { code: 'IDEMPOTENCY_CONFLICT', message: 'Idempotency conflict with differing payload' }
        };
      }
    }

    // Check disconnect expirations after validation & cache check
    if (this.checkDisconnectExpirations()) {
      return {
        success: false,
        stateVersion: this.stateVersion,
        idempotencyKey,
        snapshot: this.getClientSnapshot(seatId),
        error: { code: 'INVALID_PHASE', message: 'Match concluded due to disconnection timeout' }
      };
    }

    // Sequence check per actor
    if (cmd.commandSequence !== seat.lastCommandSequence + 1) {
      return {
        success: false,
        stateVersion: this.stateVersion,
        idempotencyKey,
        snapshot: this.getClientSnapshot(seatId),
        error: {
          code: 'OUT_OF_SEQUENCE',
          message: `Expected sequence ${seat.lastCommandSequence + 1}, got ${cmd.commandSequence}`
        }
      };
    }

    // State version check
    if (cmd.stateVersion !== this.stateVersion) {
      return {
        success: false,
        stateVersion: this.stateVersion,
        idempotencyKey,
        snapshot: this.getClientSnapshot(seatId),
        error: {
          code: 'STALE_VERSION',
          message: `Expected stateVersion ${this.stateVersion}, got ${cmd.stateVersion}`
        }
      };
    }

    // Allowed action check
    const allowed = this.getAllowedActions(seatId);
    if (!allowed.includes(cmd.type)) {
      return {
        success: false,
        stateVersion: this.stateVersion,
        idempotencyKey,
        snapshot: this.getClientSnapshot(seatId),
        error: {
          code: 'INVALID_PHASE',
          message: `Action ${cmd.type} not allowed in phase ${this.phase} for seat ${seatId}`
        }
      };
    }

    // Deadline check: now >= deadlineTimestamp rejects expired action
    if (
      this.deadlineTimestamp !== null &&
      this.clock.now() >= this.deadlineTimestamp &&
      cmd.type !== 'LEAVE'
    ) {
      return {
        success: false,
        stateVersion: this.stateVersion,
        idempotencyKey,
        snapshot: this.getClientSnapshot(seatId),
        error: {
          code: 'OFFER_EXPIRED',
          message: 'Action deadline has expired'
        }
      };
    }

    // Process specific action
    const prevSeq = seat.lastCommandSequence;
    seat.lastCommandSequence = cmd.commandSequence;

    const executionError = this.executeAction(seatId, cmd);
    if (executionError) {
      seat.lastCommandSequence = prevSeq;
      return {
        success: false,
        stateVersion: this.stateVersion,
        idempotencyKey,
        snapshot: this.getClientSnapshot(seatId),
        error: executionError
      };
    }

    const commandResult: DuelCommandResult = {
      success: true,
      stateVersion: this.stateVersion,
      idempotencyKey,
      snapshot: this.getClientSnapshot(seatId)
    };

    // Cache idempotency result with bounded size
    if (seat.idempotencyCache.size >= DuelEngine.MAX_IDEMPOTENCY_ENTRIES) {
      const firstKey = seat.idempotencyCache.keys().next().value;
      if (firstKey) seat.idempotencyCache.delete(firstKey);
    }
    seat.idempotencyCache.set(idempotencyKey, { payloadHash, result: commandResult });

    return commandResult;
  }

  private executeAction(seatId: DuelSeatId, cmd: DuelCommand): PublicError | null {
    switch (cmd.type) {
      case 'READY': {
        this.seats[seatId].ready = cmd.ready;
        this.stateVersion++;
        this.recordAuditEvent('READY_TOGGLED', { seatId, ready: cmd.ready });
        this.notifyStateChange({ type: 'READY_TOGGLED', seatId, ready: cmd.ready });
        return null;
      }
      case 'START': {
        if (
          !this.seats[0].connected ||
          !this.seats[1].connected ||
          !this.seats[0].ready ||
          !this.seats[1].ready
        ) {
          return { code: 'INVALID_PHASE', message: 'Both players must be connected and ready' };
        }
        this.startRound(1);
        return null;
      }
      case 'SELECT_BOX': {
        if (this.playerBoxId !== null) {
          return { code: 'INVALID_BOX', message: 'Player box already selected' };
        }
        this.playerBoxId = cmd.boxId;
        this.clearActiveTimer();
        this.stateVersion++;
        this.recordAuditEvent('BOX_SELECTED', { seatId, boxId: cmd.boxId });
        this.transitionToOpening();
        return null;
      }
      case 'OPEN_BOX': {
        if (cmd.boxId === this.playerBoxId) {
          return { code: 'INVALID_BOX', message: 'Cannot open player lucky box' };
        }
        if (this.openedBoxIds.has(cmd.boxId)) {
          return { code: 'INVALID_BOX', message: 'Box is already opened' };
        }
        this.openedBoxIds.add(cmd.boxId);
        this.openedBoxOrder.push(cmd.boxId);
        this.boxesLeftToOpenThisRound--;
        this.clearActiveTimer();
        this.stateVersion++;
        const revealedAmount = this.boxAmountMap.get(cmd.boxId)!;
        this.recordAuditEvent('BOX_OPENED', { seatId, boxId: cmd.boxId, revealedAmount });

        if (this.boxesLeftToOpenThisRound > 0) {
          this.setDeadlineTimer(DUEL_TIMEOUT_SECONDS.OPEN_BOX, () => this.autoOpenBox());
          this.notifyStateChange({ type: 'BOX_OPENED', boxId: cmd.boxId, revealedAmount });
        } else {
          if (this.boxRound < 9) {
            this.transitionToSubmittingOffer();
          } else {
            this.transitionToFinalChoice();
          }
        }
        return null;
      }
      case 'SUBMIT_OFFER': {
        const range = this.calculateLegalOfferRange();
        if (cmd.amount < range.min || cmd.amount > range.max) {
          return {
            code: 'INVALID_PAYLOAD',
            message: `Offer amount ${cmd.amount} out of legal range [${range.min}, ${range.max}]`
          };
        }
        this.clearActiveTimer();
        const offerId = 'off_' + crypto.randomUUID();
        const expiresAt = this.clock.now() + DUEL_TIMEOUT_SECONDS.CHALLENGER_DECISION * 1000;
        this.currentOffer = {
          offerId,
          amount: cmd.amount,
          expiresAt
        };
        this.offerHistory.push({
          offerId,
          round: this.boxRound,
          roundIndex: this.roundIndex,
          amount: cmd.amount,
          expiresAt,
          outcome: 'PENDING'
        });
        this.phase = 'OFFERING';
        this.stateVersion++;
        this.setDeadlineTimer(DUEL_TIMEOUT_SECONDS.CHALLENGER_DECISION, () => this.autoRejectOffer());
        this.recordAuditEvent('OFFER_SUBMITTED', {
          bankerSeatId: seatId,
          offerId,
          amount: cmd.amount,
          expiresAt
        });
        this.notifyStateChange({ type: 'OFFER_SUBMITTED', offerId, amount: cmd.amount });
        return null;
      }
      case 'ACCEPT_OFFER': {
        if (!this.currentOffer || this.currentOffer.offerId !== cmd.offerId) {
          return { code: 'INVALID_PAYLOAD', message: 'Offer ID mismatch or no active offer' };
        }
        this.clearActiveTimer();
        const acceptedAmount = this.currentOffer.amount;
        const offerEntry = this.offerHistory.find((o) => o.offerId === cmd.offerId);
        if (offerEntry) offerEntry.outcome = 'ACCEPTED';
        this.currentOffer = null;
        this.recordAuditEvent('OFFER_ACCEPTED', { challengerSeatId: seatId, offerId: cmd.offerId, amount: acceptedAmount });
        this.finishRound('OFFER_ACCEPTED', acceptedAmount);
        return null;
      }
      case 'REJECT_OFFER': {
        if (!this.currentOffer || this.currentOffer.offerId !== cmd.offerId) {
          return { code: 'INVALID_PAYLOAD', message: 'Offer ID mismatch or no active offer' };
        }
        this.clearActiveTimer();
        const offerEntry = this.offerHistory.find((o) => o.offerId === cmd.offerId);
        if (offerEntry) offerEntry.outcome = 'REJECTED';
        this.currentOffer = null;
        this.recordAuditEvent('OFFER_REJECTED', { challengerSeatId: seatId, offerId: cmd.offerId });
        this.advanceToNextBoxRound();
        return null;
      }
      case 'KEEP_BOX': {
        this.clearActiveTimer();
        const originalAmount = this.boxAmountMap.get(this.playerBoxId!)!;
        this.recordAuditEvent('FINAL_CHOICE_KEEP', {
          challengerSeatId: seatId,
          boxId: this.playerBoxId,
          amount: originalAmount
        });
        this.finishRound('FINAL_KEEP', undefined, this.playerBoxId!, originalAmount);
        return null;
      }
      case 'SWAP_BOX': {
        const otherBoxId = this.getOtherRemainingBoxId();
        if (cmd.targetBoxId !== otherBoxId) {
          return { code: 'INVALID_BOX', message: `Invalid swap target. Must be box ${otherBoxId}` };
        }
        this.clearActiveTimer();
        const swapAmount = this.boxAmountMap.get(otherBoxId)!;
        this.recordAuditEvent('FINAL_CHOICE_SWAP', {
          challengerSeatId: seatId,
          originalBoxId: this.playerBoxId,
          newBoxId: otherBoxId,
          amount: swapAmount
        });
        this.finishRound('FINAL_SWAP', undefined, otherBoxId, swapAmount);
        return null;
      }
      case 'CONTINUE_ROUND': {
        this.continueReady[seatId] = true;
        this.stateVersion++;
        this.recordAuditEvent('CONTINUE_ROUND_ACK', { seatId });
        if (this.continueReady[0] && this.continueReady[1]) {
          this.clearActiveTimer();
          this.startRound(2);
        } else {
          this.notifyStateChange({ type: 'CONTINUE_ROUND_ACK', seatId });
        }
        return null;
      }
      case 'LEAVE': {
        if (this.phase === 'WAITING') {
          this.leaveSeat(seatId);
          return null;
        }
        if (this.phase !== 'FINISHED') {
          this.finishMatch('FORFEIT', seatId);
          return null;
        }
        return null;
      }
    }
  }

  private startRound(round: 1 | 2): void {
    // Only clear phase timer, NOT disconnect timers!
    this.clearActiveTimer();
    this.roundIndex = round;
    this.boxRound = 1;
    this.boxesLeftToOpenThisRound = ROUND_TARGETS[0];
    this.playerBoxId = null;
    this.openedBoxIds.clear();
    this.openedBoxOrder.length = 0;
    this.currentOffer = null;
    this.continueReady = [false, false];

    if (round === 1) {
      // Crypto random role assignment
      const challenger = this.randomInt(0, 2) as DuelSeatId;
      const banker: DuelSeatId = challenger === 0 ? 1 : 0;
      this.challengerSeatId = challenger;
      this.bankerSeatId = banker;
    } else {
      // Role swap for round 2
      const prevChallenger = this.challengerSeatId!;
      this.challengerSeatId = prevChallenger === 0 ? 1 : 0;
      this.bankerSeatId = prevChallenger;
    }

    this.seats[this.challengerSeatId].role = 'CHALLENGER';
    this.seats[this.bankerSeatId].role = 'BANKER';

    // Generate independent fairness bundle for this round using duel ruleVersion and specific gameId
    const gameId = `${this.matchId}_r${round}`;
    const bundle = generateFairnessBundle(gameId, { ruleVersion: DUEL_RULE_VERSION });
    this.roundFairnessData.set(round, bundle);
    this.fairnessCommitments[round] = bundle.commitment;
    this.boxAmountMap = bundle.boxAmountMap;

    this.phase = 'SELECTING';
    this.stateVersion++;
    this.setDeadlineTimer(DUEL_TIMEOUT_SECONDS.SELECT_PLAYER_BOX, () => this.autoSelectBox());

    this.recordAuditEvent('ROUND_STARTED', {
      roundIndex: round,
      challengerSeatId: this.challengerSeatId,
      bankerSeatId: this.bankerSeatId,
      commitment: bundle.commitment
    });
    this.notifyStateChange({ type: 'ROUND_STARTED', roundIndex: round });
  }

  private transitionToOpening(): void {
    this.phase = 'OPENING';
    this.boxRound = 1;
    this.boxesLeftToOpenThisRound = ROUND_TARGETS[0];
    this.stateVersion++;
    this.setDeadlineTimer(DUEL_TIMEOUT_SECONDS.OPEN_BOX, () => this.autoOpenBox());
    this.notifyStateChange({ type: 'ROUND_OPENING_STARTED', boxRound: this.boxRound });
  }

  private advanceToNextBoxRound(): void {
    this.boxRound++;
    this.boxesLeftToOpenThisRound = ROUND_TARGETS[this.boxRound - 1];
    this.phase = 'OPENING';
    this.stateVersion++;
    this.setDeadlineTimer(DUEL_TIMEOUT_SECONDS.OPEN_BOX, () => this.autoOpenBox());
    this.notifyStateChange({ type: 'BOX_ROUND_ADVANCED', boxRound: this.boxRound });
  }

  private transitionToSubmittingOffer(): void {
    this.phase = 'SUBMITTING_OFFER';
    this.stateVersion++;
    this.setDeadlineTimer(DUEL_TIMEOUT_SECONDS.BANKER_OFFER, () => this.autoSkipOffer());
    this.notifyStateChange({ type: 'SUBMITTING_OFFER', boxRound: this.boxRound });
  }

  private transitionToFinalChoice(): void {
    this.phase = 'FINAL_SWAP';
    this.stateVersion++;
    this.setDeadlineTimer(DUEL_TIMEOUT_SECONDS.FINAL_CHOICE, () => this.autoKeepBox());
    this.notifyStateChange({ type: 'FINAL_CHOICE_READY' });
  }

  private finishRound(
    outcomeType: 'OFFER_ACCEPTED' | 'FINAL_KEEP' | 'FINAL_SWAP',
    acceptedOfferAmount?: number,
    finalPlayerBoxId?: number,
    finalPlayerBoxAmount?: number
  ): void {
    const originalPlayerBoxAmount = this.boxAmountMap.get(this.playerBoxId!)!;
    let challengerProfit = 0;
    let bankerProfit = 0;

    if (outcomeType === 'OFFER_ACCEPTED') {
      challengerProfit = acceptedOfferAmount!;
      bankerProfit = originalPlayerBoxAmount - acceptedOfferAmount!;
    } else {
      challengerProfit = finalPlayerBoxAmount!;
      bankerProfit = 0; // 未成交0
    }

    this.seats[this.challengerSeatId!].score += challengerProfit;
    this.seats[this.bankerSeatId!].score += bankerProfit;

    const highestOffer = this.offerHistory
      .filter((o) => o.roundIndex === this.roundIndex && o.outcome !== 'PENDING')
      .reduce((max, o) => (o.amount > max ? o.amount : max), 0);

    const roundResult: DuelRoundResult = {
      roundIndex: this.roundIndex,
      challengerSeatId: this.challengerSeatId!,
      bankerSeatId: this.bankerSeatId!,
      outcomeType,
      originalPlayerBoxId: this.playerBoxId!,
      finalPlayerBoxId: finalPlayerBoxId ?? this.playerBoxId!,
      originalPlayerBoxAmount,
      ...(finalPlayerBoxAmount !== undefined ? { finalPlayerBoxAmount } : {}),
      ...(acceptedOfferAmount !== undefined ? { acceptedOfferAmount } : {}),
      highestOfferAmount: highestOffer,
      challengerProfit,
      bankerProfit
    };

    this.roundResults.push(roundResult);
    this.stateVersion++;

    this.recordAuditEvent('ROUND_COMPLETED', {
      roundIndex: this.roundIndex,
      roundResult,
      scores: {
        0: this.seats[0].score,
        1: this.seats[1].score
      }
    });

    if (this.roundIndex === 1) {
      this.phase = 'ROUND_COMPLETE';
      this.continueReady = [false, false];
      this.setDeadlineTimer(DUEL_TIMEOUT_SECONDS.ROUND_INTERMISSION, () => {
        if (this.checkDisconnectExpirations()) return;
        this.startRound(2);
      });
      this.notifyStateChange({ type: 'ROUND_COMPLETED', roundResult });
    } else {
      this.finishMatch('NORMAL');
    }
  }

  private finishMatch(
    reason: 'NORMAL' | 'FORFEIT' | 'TIMEOUT_DISCONNECT' | 'BOTH_FORFEIT',
    forfeitingSeatId?: DuelSeatId
  ): void {
    if (this.phase === 'FINISHED') return; // Idempotency guard

    this.clearAllTimers();
    this.phase = 'FINISHED';

    let winnerSeatId: DuelSeatId | null = null;
    if (reason === 'FORFEIT' || reason === 'TIMEOUT_DISCONNECT') {
      winnerSeatId = forfeitingSeatId === 0 ? 1 : 0;
    } else if (reason === 'BOTH_FORFEIT') {
      winnerSeatId = null;
    } else {
      const s0 = this.seats[0].score;
      const s1 = this.seats[1].score;
      if (s0 > s1) winnerSeatId = 0;
      else if (s1 > s0) winnerSeatId = 1;
      else winnerSeatId = null;
    }

    const fairnessProofs: DuelFairnessProof[] = [];
    for (const [rIdx, bundle] of this.roundFairnessData.entries()) {
      const finalBoxes = Array.from({ length: TOTAL_BOXES }, (_, i) => ({
        id: i + 1,
        amount: bundle.boxAmountMap.get(i + 1)!
      }));
      fairnessProofs.push({
        roundIndex: rIdx,
        algorithm: bundle.algorithm,
        gameId: `${this.matchId}_r${rIdx}`,
        matchId: this.matchId,
        ruleVersion: this.ruleVersion,
        seed: bundle.seed,
        salt: bundle.salt,
        amounts: Array.from(MONEY_VALUES),
        roundTargets: Array.from(ROUND_TARGETS),
        commitment: bundle.commitment,
        finalBoxes
      });
    }

    const resultId = 'res_' + crypto.randomUUID();

    // Record MATCH_FINISHED event BEFORE snapshotting auditTrail into result!
    this.recordAuditEvent('MATCH_FINISHED', {
      resultId,
      winnerSeatId,
      reason,
      finalScores: {
        0: this.seats[0].score,
        1: this.seats[1].score
      }
    });

    this.result = {
      resultId,
      matchId: this.matchId,
      ruleVersion: this.ruleVersion,
      winnerSeatId,
      reason,
      finalScores: {
        0: this.seats[0].score,
        1: this.seats[1].score
      },
      forfeitedSeatId: forfeitingSeatId ?? null,
      rounds: [...this.roundResults],
      fairnessProofs,
      auditTrail: [...this.auditTrail]
    };

    const completedAt = this.clock.now();
    const record: CompletedDuelRecord = {
      matchId: this.matchId,
      resultId: this.result.resultId,
      ruleVersion: this.ruleVersion,
      completedAt,
      seats: [
        { seatId: 0, nickname: this.seats[0].nickname },
        { seatId: 1, nickname: this.seats[1].nickname }
      ],
      result: this.result
    };
    this.completedRecord = Object.freeze(record);

    this.stateVersion++;
    this.notifyStateChange({ type: 'MATCH_FINISHED', result: this.result });
  }

  // --- Timeout Handlers ---

  private setDeadlineTimer(seconds: number, callback: () => void): void {
    this.clearActiveTimer();
    this.deadlineTimestamp = this.clock.now() + seconds * 1000;
    this.activeTimer = this.clock.setTimeout(() => {
      this.activeTimer = null;
      this.deadlineTimestamp = null;
      callback();
    }, seconds * 1000);
  }

  private autoSelectBox(): void {
    if (this.checkDisconnectExpirations()) return;
    if (this.phase !== 'SELECTING' || this.playerBoxId !== null) return;
    const boxId = this.randomInt(1, TOTAL_BOXES + 1);
    this.playerBoxId = boxId;
    this.stateVersion++;
    this.recordAuditEvent('AUTO_SELECT_BOX', { boxId });
    this.transitionToOpening();
  }

  private autoOpenBox(): void {
    if (this.checkDisconnectExpirations()) return;
    if (this.phase !== 'OPENING' || this.boxesLeftToOpenThisRound <= 0) return;
    const unopened: number[] = [];
    for (let id = 1; id <= TOTAL_BOXES; id++) {
      if (id !== this.playerBoxId && !this.openedBoxIds.has(id)) {
        unopened.push(id);
      }
    }
    if (unopened.length === 0) return;
    const idx = this.randomInt(0, unopened.length);
    const boxId = unopened[idx];

    this.openedBoxIds.add(boxId);
    this.openedBoxOrder.push(boxId);
    this.boxesLeftToOpenThisRound--;
    this.stateVersion++;
    const revealedAmount = this.boxAmountMap.get(boxId)!;
    this.recordAuditEvent('AUTO_OPEN_BOX', { boxId, revealedAmount });

    if (this.boxesLeftToOpenThisRound > 0) {
      this.setDeadlineTimer(DUEL_TIMEOUT_SECONDS.OPEN_BOX, () => this.autoOpenBox());
      this.notifyStateChange({ type: 'BOX_OPENED', boxId, revealedAmount });
    } else {
      if (this.boxRound < 9) {
        this.transitionToSubmittingOffer();
      } else {
        this.transitionToFinalChoice();
      }
    }
  }

  private autoSkipOffer(): void {
    if (this.checkDisconnectExpirations()) return;
    if (this.phase !== 'SUBMITTING_OFFER') return;
    this.recordAuditEvent('OFFER_SKIPPED_TIMEOUT', { boxRound: this.boxRound });
    this.advanceToNextBoxRound();
  }

  private autoRejectOffer(): void {
    if (this.checkDisconnectExpirations()) return;
    if (this.phase !== 'OFFERING' || !this.currentOffer) return;
    const offerEntry = this.offerHistory.find((o) => o.offerId === this.currentOffer?.offerId);
    if (offerEntry) offerEntry.outcome = 'REJECTED';
    this.currentOffer = null;
    this.recordAuditEvent('OFFER_REJECTED_TIMEOUT', { boxRound: this.boxRound });
    this.advanceToNextBoxRound();
  }

  private autoKeepBox(): void {
    if (this.checkDisconnectExpirations()) return;
    if (this.phase !== 'FINAL_SWAP' || this.openedBoxIds.size !== 24) return;
    const originalAmount = this.boxAmountMap.get(this.playerBoxId!)!;
    this.recordAuditEvent('AUTO_FINAL_KEEP', {
      boxId: this.playerBoxId,
      amount: originalAmount
    });
    this.finishRound('FINAL_KEEP', undefined, this.playerBoxId!, originalAmount);
  }

  private getOtherRemainingBoxId(): number {
    for (let id = 1; id <= TOTAL_BOXES; id++) {
      if (id !== this.playerBoxId && !this.openedBoxIds.has(id)) {
        return id;
      }
    }
    return 1;
  }

  public getCompletedRecord(): CompletedDuelRecord | null {
    return this.completedRecord;
  }

  private recordAuditEvent(type: string, payload: Record<string, unknown>): void {
    if (this.phase === 'FINISHED' && type !== 'MATCH_FINISHED') {
      return; // Do not append further events once match is finished
    }

    const previousHash =
      this.auditTrail.length === 0
        ? GENESIS_PREVIOUS_HASH
        : this.auditTrail[this.auditTrail.length - 1].hash;

    const event = createAuditEvent({
      seq: this.auditTrail.length + 1,
      timestamp: this.clock.now(),
      type,
      payload: {
        roundIndex: this.roundIndex,
        boxRound: this.boxRound,
        ...payload
      },
      previousHash
    });

    this.auditTrail.push(event);
  }

  private hashPayload(payload: unknown): string {
    const canonical = canonicalJsonStringify(payload);
    return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
  }

  public dispose(): void {
    this.clearAllTimers();
  }
}
