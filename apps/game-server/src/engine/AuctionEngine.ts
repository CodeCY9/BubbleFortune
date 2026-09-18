import crypto from 'node:crypto';
import {
  ROUND_TARGETS,
  MONEY_VALUES,
  TOTAL_BOXES
} from '../../../../packages/protocol/src/config';
import {
  AuditEvent,
  PublicBox,
  PublicError
} from '../../../../packages/protocol/src/types';
import {
  AUCTION_RULE_VERSION,
  AUCTION_INITIAL_CAPITAL,
  AUCTION_MIN_PLAYERS,
  AUCTION_MAX_PLAYERS,
  AUCTION_TIMEOUT_SECONDS,
  AUCTION_ALLOWED_EMOJIS,
  AuctionActionType,
  AuctionClientSnapshot,
  AuctionCommand,
  AuctionCommandResult,
  AuctionCurrentOffer,
  AuctionFairnessProof,
  AuctionPhase,
  AuctionPrivateView,
  AuctionPublicSnapshot,
  AuctionRanking,
  AuctionReactionEvent,
  AuctionResult,
  AuctionRole,
  AuctionRoundResult,
  AuctionSeatInfo,
  CompletedAuctionRecord,
  validateAuctionCommand
} from '../../../../packages/protocol/src/auction';
import { canonicalJsonStringify } from '../../../../packages/protocol/src/canonical';
import { GENESIS_PREVIOUS_HASH } from '../../../../packages/protocol/src/fairness';
import { Clock, ClockTimer, SystemClock } from './clock';
import { createAuditEvent } from './audit';
import { generateFairnessBundle } from './fairness';

interface InternalSeat {
  seatId: number;
  occupied: boolean;
  nickname: string;
  connected: boolean;
  ready: boolean;
  continueReady: boolean;
  role: AuctionRole | null;
  score: number;
  capital: number;
  forfeited: boolean;
  lastCommandSequence: number;
  idempotencyCache: Map<string, { payloadHash: string; result: AuctionCommandResult }>;
  disconnectTimestamp: number | null;
}

interface SubmittedBid {
  seatId: number;
  amount: number;
  receiveSeq: number;
  timestamp: number;
}

export interface AuctionEngineOptions {
  roomId: string;
  matchId?: string;
  clock?: Clock;
  randomIntFn?: (min: number, max: number) => number;
  isPrivate?: boolean;
  ranked?: boolean;
  allowSpectators?: boolean;
  allowEmotes?: boolean;
  showBidHistory?: boolean;
}

export class AuctionEngine {
  public readonly roomId: string;
  public readonly matchId: string;
  public readonly ruleVersion = AUCTION_RULE_VERSION;
  public readonly isPrivate: boolean;
  public readonly ranked: boolean;
  public readonly allowSpectators: boolean;
  public readonly allowEmotes: boolean;
  public readonly showBidHistory: boolean;
  private stateVersion = 1;
  private phase: AuctionPhase = 'WAITING';
  private roundIndex = 0; // 0=WAITING, 1..N
  private totalRounds = 0;
  private challengerOrder: number[] = [];
  private challengerRotationIndex = 0;
  private boxRound = 0; // 1..9
  private boxesLeftToOpenThisRound = 0;
  private hostSeatId: number | null = 0;
  private challengerSeatId: number | null = null;
  private deadlineTimestamp: number | null = null;
  private playerBoxId: number | null = null;
  private readonly openedBoxIds = new Set<number>();
  private readonly openedBoxOrder: number[] = [];
  private boxAmountMap = new Map<number, number>();

  private readonly currentBids = new Map<number, SubmittedBid>();
  private bidSequenceCounter = 0;
  private currentOfferInternal: {
    offerId: string;
    amount: number;
    winningSeatId: number;
    deadlineTimestamp: number | null;
  } | null = null;

  private readonly roundResults: AuctionRoundResult[] = [];
  private readonly fairnessCommitments: Record<number, string> = {};
  private result: AuctionResult | null = null;
  private completedRecord: CompletedAuctionRecord | null = null;

  private readonly clock: Clock;
  private readonly randomInt: (min: number, max: number) => number;
  private readonly seats: InternalSeat[] = [];
  private spectatorCount = 0;
  private lastReaction: AuctionReactionEvent | null = null;

  private readonly auditTrail: AuditEvent[] = [];
  private readonly roundFairnessData = new Map<
    number,
    { algorithm: string; seed: string; salt: string; commitment: string; boxAmountMap: Map<number, number> }
  >();

  private activeTimer: ClockTimer | null = null;
  private seatDisconnectTimers = new Map<number, ClockTimer>();
  private onEventHandler?: (event: any, snapshot: AuctionPublicSnapshot) => void;
  private onStateChangeHandler?: (event?: any) => void;

  private static readonly MAX_IDEMPOTENCY_ENTRIES = 500;

  constructor(options: AuctionEngineOptions) {
    this.roomId = options.roomId;
    this.matchId = options.matchId || `auction_${crypto.randomUUID()}`;
    this.clock = options.clock || new SystemClock();
    this.randomInt = options.randomIntFn || crypto.randomInt;
    this.isPrivate = typeof options.isPrivate === 'boolean' ? options.isPrivate : Boolean(options.isPrivate ?? false);
    this.ranked = typeof options.ranked === 'boolean' ? options.ranked : (options.ranked !== undefined ? Boolean(options.ranked) : true);
    this.allowSpectators = typeof options.allowSpectators === 'boolean' ? options.allowSpectators : (options.allowSpectators !== undefined ? Boolean(options.allowSpectators) : true);
    this.allowEmotes = options.allowEmotes !== false;
    this.showBidHistory = options.showBidHistory !== false;

    for (let i = 0; i < AUCTION_MAX_PLAYERS; i++) {
      this.seats.push({
        seatId: i,
        occupied: false,
        nickname: `玩家${i + 1}`,
        connected: false,
        ready: false,
        continueReady: false,
        role: null,
        score: 0,
        capital: AUCTION_INITIAL_CAPITAL,
        forfeited: false,
        lastCommandSequence: 0,
        idempotencyCache: new Map(),
        disconnectTimestamp: null
      });
    }

    this.recordAuditEvent('MATCH_CREATED', {
      roomId: this.roomId,
      matchId: this.matchId,
      ruleVersion: this.ruleVersion,
      isPrivate: this.isPrivate,
      ranked: this.ranked,
      allowSpectators: this.allowSpectators,
      allowEmotes: this.allowEmotes,
      showBidHistory: this.showBidHistory
    });
  }

  public setOnEventHandler(handler: (event: any, snapshot: AuctionPublicSnapshot) => void): void {
    this.onEventHandler = handler;
  }

  public setOnStateChange(handler: (event?: any) => void): void {
    this.onStateChangeHandler = handler;
  }

  private notifyStateChange(event?: any): void {
    if (this.onStateChangeHandler) {
      this.onStateChangeHandler(event);
    }
  }

  public setSpectatorCount(count: number): void {
    this.spectatorCount = Math.max(0, count);
  }

  public getSpectatorCount(): number {
    return this.spectatorCount;
  }

  public getStateVersion(): number {
    return this.stateVersion;
  }

  public getPhase(): AuctionPhase {
    return this.phase;
  }

  public isFinished(): boolean {
    return this.phase === 'FINISHED';
  }

  public getResult(): AuctionResult | null {
    return this.result ? JSON.parse(JSON.stringify(this.result)) : null;
  }

  public getCompletedRecord(): CompletedAuctionRecord | null {
    return this.completedRecord ? JSON.parse(JSON.stringify(this.completedRecord)) : null;
  }

  public getSeat(seatId: number): InternalSeat | undefined {
    return this.seats[seatId];
  }

  public getOccupiedSeats(): InternalSeat[] {
    return this.seats.filter((s) => s.occupied);
  }

  public getActivePlayers(): InternalSeat[] {
    return this.seats.filter((s) => s.occupied && !s.forfeited);
  }

  // --- Seat Allocation & Disconnects ---

  public assignNextAvailableSeat(nickname: string): number | null {
    if (this.phase !== 'WAITING') {
      return null;
    }
    const available = this.seats.find((s) => !s.occupied);
    if (!available) {
      return null;
    }
    available.occupied = true;
    available.connected = true;
    available.ready = false;
    available.continueReady = false;
    available.nickname = nickname ? nickname.slice(0, 16) : `玩家${available.seatId + 1}`;
    available.score = 0;
    available.capital = AUCTION_INITIAL_CAPITAL;
    available.forfeited = false;
    available.lastCommandSequence = 0;
    available.idempotencyCache.clear();
    available.disconnectTimestamp = null;

    if (this.hostSeatId === null) {
      this.hostSeatId = available.seatId;
    }

    this.stateVersion++;
    this.recordAuditEvent('PLAYER_JOINED', { seatId: available.seatId, nickname: available.nickname });
    this.notifyStateChange({ type: 'PLAYER_JOINED', seatId: available.seatId });
    return available.seatId;
  }

  public handleClientDisconnect(seatId: number): void {
    const seat = this.seats[seatId];
    if (!seat || !seat.occupied) return;

    seat.connected = false;
    seat.disconnectTimestamp = this.clock.now();

    if (this.phase === 'WAITING') {
      seat.ready = false;
      const timer = this.clock.setTimeout(() => {
        this.handleGracePeriodTimeout(seatId);
      }, AUCTION_TIMEOUT_SECONDS.RECONNECT_GRACE * 1000);

      this.seatDisconnectTimers.set(seatId, timer);
      this.stateVersion++;
      this.notifyStateChange({ type: 'PLAYER_DISCONNECTED_WAITING', seatId });
      return;
    }

    if (this.phase === 'FINISHED' || seat.forfeited) {
      return;
    }

    this.recordAuditEvent('PLAYER_DISCONNECTED', {
      seatId,
      stateVersion: this.stateVersion,
      phase: this.phase
    });

    const timer = this.clock.setTimeout(() => {
      this.handleGracePeriodTimeout(seatId);
    }, AUCTION_TIMEOUT_SECONDS.RECONNECT_GRACE * 1000);

    this.seatDisconnectTimers.set(seatId, timer);
    this.stateVersion++;
    this.notifyStateChange({ type: 'PLAYER_DISCONNECTED', seatId });
  }

  public handleClientReconnect(seatId: number): boolean {
    const seat = this.seats[seatId];
    if (!seat || !seat.occupied || seat.forfeited) return false;

    const timer = this.seatDisconnectTimers.get(seatId);
    if (timer) {
      timer.cancel();
      this.seatDisconnectTimers.delete(seatId);
    }

    seat.connected = true;
    seat.disconnectTimestamp = null;
    this.stateVersion++;

    this.recordAuditEvent('PLAYER_RECONNECTED', {
      seatId,
      stateVersion: this.stateVersion,
      phase: this.phase
    });

    this.notifyStateChange({ type: 'PLAYER_RECONNECTED', seatId });
    return true;
  }

  public releaseWaitingSeat(seatId: number): void {
    const seat = this.seats[seatId];
    if (!seat || !seat.occupied || this.phase !== 'WAITING') return;

    const timer = this.seatDisconnectTimers.get(seatId);
    if (timer) {
      timer.cancel();
      this.seatDisconnectTimers.delete(seatId);
    }

    seat.occupied = false;
    seat.connected = false;
    seat.ready = false;
    seat.continueReady = false;
    seat.forfeited = false;
    seat.role = null;
    seat.disconnectTimestamp = null;
    seat.lastCommandSequence = 0;
    seat.idempotencyCache.clear();

    if (this.hostSeatId === seatId) {
      const nextHost = this.seats.find((s) => s.occupied && s.connected);
      this.hostSeatId = nextHost ? nextHost.seatId : null;
    }

    this.stateVersion++;
    this.recordAuditEvent('WAITING_PLAYER_RELEASED', { seatId });
    this.notifyStateChange({ type: 'WAITING_PLAYER_RELEASED', seatId });
  }

  private handleGracePeriodTimeout(seatId: number): void {
    this.seatDisconnectTimers.delete(seatId);
    const seat = this.seats[seatId];
    if (!seat || !seat.occupied || seat.forfeited || seat.connected) return;

    if (this.phase === 'WAITING') {
      this.releaseWaitingSeat(seatId);
      return;
    }

    this.forfeitPlayer(seatId, 'TIMEOUT_DISCONNECT');
  }

  public forfeitPlayer(seatId: number, reason: 'FORFEIT' | 'TIMEOUT_DISCONNECT'): void {
    const seat = this.seats[seatId];
    if (!seat || !seat.occupied || seat.forfeited) return;

    const timer = this.seatDisconnectTimers.get(seatId);
    if (timer) {
      timer.cancel();
      this.seatDisconnectTimers.delete(seatId);
    }

    seat.forfeited = true;
    seat.connected = false;
    this.stateVersion++;

    this.recordAuditEvent('PLAYER_FORFEITED', {
      seatId,
      reason,
      stateVersion: this.stateVersion,
      roundIndex: this.roundIndex
    });

    // Check how many players are still surviving
    const activeSurvivors = this.getActivePlayers();

    if (activeSurvivors.length < 2) {
      // Game cannot continue with less than 2 players
      const finishReason = activeSurvivors.length === 1 ? 'SURVIVOR_WIN' : 'FORFEIT_ALL';
      this.finishMatch(finishReason);
      return;
    }

    // If current challenger forfeited during their active round
    if (this.challengerSeatId === seatId && this.phase !== 'ROUND_COMPLETE' && this.phase !== 'FINISHED') {
      // Abort current round without fabricating profit
      this.cancelActiveTimer();
      this.recordAuditEvent('ROUND_ABORTED_CHALLENGER_FORFEIT', {
        roundIndex: this.roundIndex,
        challengerSeatId: seatId
      });

      this.roundResults.push({
        roundIndex: this.roundIndex,
        challengerSeatId: seatId,
        outcomeType: 'FORFEIT',
        originalPlayerBoxId: this.playerBoxId || 0,
        finalPlayerBoxId: this.playerBoxId || 0,
        originalPlayerBoxAmount: this.playerBoxId ? (this.boxAmountMap.get(this.playerBoxId) || 0) : 0,
        challengerProfit: 0,
        capitalistProfits: {},
        capitalDeductions: {}
      });

      this.advanceToNextChallengerOrFinish();
      return;
    }

    // If forfeiting player was a capitalist in BIDDING phase
    if (this.phase === 'BIDDING') {
      this.currentBids.delete(seatId);
      this.checkBiddingCompletion();
    } else if (this.phase === 'OFFERING' && this.currentOfferInternal?.winningSeatId === seatId) {
      // Winning bidder disconnected before challenger decided
      // To ensure fairness and no deadlock, cancel offer and continue opening
      this.cancelActiveTimer();
      this.currentOfferInternal = null;
      this.boxRound++;
      if (this.boxRound <= 9 && this.openedBoxIds.size < 24) {
        this.boxesLeftToOpenThisRound = ROUND_TARGETS[this.boxRound - 1];
        this.phase = 'OPENING';
        this.startPhaseTimer(AUCTION_TIMEOUT_SECONDS.OPEN_BOX, () => this.handleOpeningTimeout());
      } else {
        this.phase = 'FINAL_SWAP';
        this.startPhaseTimer(AUCTION_TIMEOUT_SECONDS.FINAL_CHOICE, () => this.handleFinalSwapTimeout());
      }
      this.notifyStateChange({ type: 'OFFER_CANCELLED_BIDDER_FORFEIT', seatId });
    } else {
      this.notifyStateChange({ type: 'PLAYER_FORFEITED', seatId });
    }
  }

  // --- Snapshot Projections ---

  public getPublicSnapshot(): AuctionPublicSnapshot {
    const publicBoxes: PublicBox[] = [];
    for (let id = 1; id <= TOTAL_BOXES; id++) {
      if (this.openedBoxIds.has(id)) {
        publicBoxes.push({
          id,
          status: 'opened',
          revealedAmount: this.boxAmountMap.get(id) ?? 0
        });
      } else if (this.playerBoxId === id) {
        publicBoxes.push({
          id,
          status: 'selected'
        });
      } else {
        publicBoxes.push({
          id,
          status: 'unopened'
        });
      }
    }

    const seatsInfo: AuctionSeatInfo[] = this.seats.map((s) => ({
      seatId: s.seatId,
      occupied: s.occupied,
      nickname: s.nickname,
      connected: s.connected,
      ready: s.ready,
      continueReady: s.continueReady,
      role: s.role,
      score: s.score,
      forfeited: s.forfeited
    }));

    const bidsSubmittedSeats = Array.from(this.currentBids.keys()).sort((a, b) => a - b);

    const publicOffer: AuctionCurrentOffer | null =
      this.phase === 'OFFERING' && this.currentOfferInternal
        ? {
            offerId: this.currentOfferInternal.offerId,
            amount: this.currentOfferInternal.amount,
            deadlineTimestamp: this.currentOfferInternal.deadlineTimestamp
          }
        : null;

    return {
      roomId: this.roomId,
      matchId: this.matchId,
      ruleVersion: this.ruleVersion,
      isPrivate: this.isPrivate,
      ranked: this.ranked,
      allowSpectators: this.allowSpectators,
      allowEmotes: this.allowEmotes,
      showBidHistory: this.showBidHistory,
      stateVersion: this.stateVersion,
      serverNow: this.clock.now(),
      phase: this.phase,
      roundIndex: this.roundIndex,
      totalRounds: this.totalRounds,
      boxRound: this.boxRound,
      boxesLeftToOpenThisRound: this.boxesLeftToOpenThisRound,
      seats: seatsInfo,
      spectatorCount: this.spectatorCount,
      hostSeatId: this.hostSeatId,
      challengerSeatId: this.challengerSeatId,
      deadlineTimestamp: this.deadlineTimestamp,
      boxes: publicBoxes,
      openedBoxIds: Array.from(this.openedBoxOrder),
      playerBoxId: this.playerBoxId,
      bidsSubmittedSeats,
      currentOffer: publicOffer,
      roundResults: this.showBidHistory ? JSON.parse(JSON.stringify(this.roundResults)) : [],
      fairnessCommitments: { ...this.fairnessCommitments },
      result: this.getResult(),
      lastReaction: this.lastReaction ? { ...this.lastReaction } : null
    };
  }

  public getClientSnapshot(seatId: number | null): AuctionClientSnapshot {
    const pub = this.getPublicSnapshot();
    const isSpectator = seatId === null || seatId < 0 || seatId >= AUCTION_MAX_PLAYERS || !this.seats[seatId].occupied;

    if (isSpectator) {
      return {
        public: pub,
        private: {
          seatId: null,
          isSpectator: true,
          lastCommandSequence: 0,
          allowedActions: this.allowEmotes ? ['SEND_EMOTE'] : []
        }
      };
    }

    const seat = this.seats[seatId];
    const allowedActions = this.computeAllowedActions(seat);
    const myBid = this.currentBids.has(seatId) ? this.currentBids.get(seatId)!.amount : null;

    return {
      public: pub,
      private: {
        seatId: seat.seatId,
        isSpectator: false,
        myCapital: seat.capital,
        myBid,
        lastCommandSequence: seat.lastCommandSequence,
        allowedActions
      }
    };
  }

  private computeAllowedActions(seat: InternalSeat): AuctionActionType[] {
    if (seat.forfeited) return this.allowEmotes ? ['SEND_EMOTE'] : [];

    const actions: AuctionActionType[] = [ ...(this.allowEmotes ? ['SEND_EMOTE' as const] : []), 'LEAVE' ];

    if (this.phase === 'WAITING') {
      actions.push('READY');
      if (this.hostSeatId === seat.seatId) {
        const occupied = this.getOccupiedSeats();
        const canStart =
          occupied.length >= AUCTION_MIN_PLAYERS &&
          occupied.length <= AUCTION_MAX_PLAYERS &&
          occupied.every((s) => s.connected && s.ready);
        if (canStart) {
          actions.push('START');
        }
      }
      return actions;
    }

    if (this.phase === 'SELECTING') {
      if (this.challengerSeatId === seat.seatId) {
        actions.push('SELECT_BOX');
      }
      return actions;
    }

    if (this.phase === 'OPENING') {
      if (this.challengerSeatId === seat.seatId) {
        actions.push('OPEN_BOX');
      }
      return actions;
    }

    if (this.phase === 'BIDDING') {
      if (seat.role === 'CAPITALIST' && !this.currentBids.has(seat.seatId) && seat.capital > 0) {
        actions.push('SUBMIT_BID');
      }
      return actions;
    }

    if (this.phase === 'OFFERING') {
      if (this.challengerSeatId === seat.seatId && this.currentOfferInternal) {
        actions.push('ACCEPT_AUCTION', 'REJECT_AUCTION');
      }
      return actions;
    }

    if (this.phase === 'FINAL_SWAP') {
      if (this.challengerSeatId === seat.seatId) {
        actions.push('KEEP_BOX', 'SWAP_BOX');
      }
      return actions;
    }

    if (this.phase === 'ROUND_COMPLETE') {
      if (!seat.continueReady) {
        actions.push('CONTINUE_ROUND');
      }
      return actions;
    }

    return actions;
  }

  // --- Command Processing ---

  public processReaction(isSpectator: boolean, nickname: string, emoji: string): boolean {
    if (!this.allowEmotes) return false;
    if (!AUCTION_ALLOWED_EMOJIS.has(emoji)) return false;

    this.lastReaction = {
      senderNickname: nickname.slice(0, 16),
      isSpectator,
      emoji,
      timestamp: this.clock.now()
    };
    this.stateVersion++;
    this.notifyStateChange({ type: 'REACTION', reaction: this.lastReaction });
    return true;
  }

  public processCommand(seatId: number, rawPayload: unknown): AuctionCommandResult {
    const seat = this.seats[seatId];
    if (!seat || !seat.occupied) {
      return {
        success: false,
        stateVersion: this.stateVersion,
        error: { code: 'UNAUTHORIZED', message: 'Seat is not occupied' }
      };
    }

    const valRes = validateAuctionCommand(rawPayload);
    if (!valRes.valid || !valRes.command) {
      return {
        success: false,
        idempotencyKey: (rawPayload as any)?.idempotencyKey,
        stateVersion: this.stateVersion,
        snapshot: this.getClientSnapshot(seatId),
        error: valRes.error || { code: 'INVALID_PAYLOAD', message: 'Command validation failed' }
      };
    }

    const cmd = valRes.command;

    // Idempotency check
    const payloadHash = crypto.createHash('sha256').update(canonicalJsonStringify(cmd)).digest('hex');
    const cached = seat.idempotencyCache.get(cmd.idempotencyKey);
    if (cached) {
      if (cached.payloadHash === payloadHash) {
        return cached.result;
      }
      return {
        success: false,
        idempotencyKey: cmd.idempotencyKey,
        stateVersion: this.stateVersion,
        snapshot: this.getClientSnapshot(seatId),
        error: { code: 'IDEMPOTENCY_CONFLICT', message: 'Conflicting payload for idempotencyKey' }
      };
    }

    // Validate matchId and roomId if provided
    if (cmd.matchId !== undefined && cmd.matchId !== this.matchId) {
      return {
        success: false,
        idempotencyKey: cmd.idempotencyKey,
        stateVersion: this.stateVersion,
        snapshot: this.getClientSnapshot(seatId),
        error: {
          code: 'INVALID_PAYLOAD',
          message: `Match ID mismatch: expected ${this.matchId}, got ${cmd.matchId}`
        }
      };
    }

    if (cmd.roomId !== undefined && cmd.roomId !== this.roomId) {
      return {
        success: false,
        idempotencyKey: cmd.idempotencyKey,
        stateVersion: this.stateVersion,
        snapshot: this.getClientSnapshot(seatId),
        error: {
          code: 'INVALID_PAYLOAD',
          message: `Room ID mismatch: expected ${this.roomId}, got ${cmd.roomId}`
        }
      };
    }

    // Check stateVersion & commandSequence (must be exactly lastCommandSequence + 1)
    if (cmd.stateVersion !== this.stateVersion) {
      return {
        success: false,
        idempotencyKey: cmd.idempotencyKey,
        stateVersion: this.stateVersion,
        snapshot: this.getClientSnapshot(seatId),
        error: { code: 'STALE_VERSION', message: 'State version mismatch' }
      };
    }

    if (cmd.commandSequence !== seat.lastCommandSequence + 1) {
      return {
        success: false,
        idempotencyKey: cmd.idempotencyKey,
        stateVersion: this.stateVersion,
        snapshot: this.getClientSnapshot(seatId),
        error: {
          code: 'OUT_OF_SEQUENCE',
          message: `Command sequence out of order: expected ${seat.lastCommandSequence + 1}, got ${cmd.commandSequence}`
        }
      };
    }

    // Check timeout deadline
    if (this.deadlineTimestamp !== null && this.clock.now() >= this.deadlineTimestamp && this.phase !== 'FINISHED') {
      this.triggerActiveTimeout();
      return {
        success: false,
        idempotencyKey: cmd.idempotencyKey,
        stateVersion: this.stateVersion,
        snapshot: this.getClientSnapshot(seatId),
        error: { code: 'OFFER_EXPIRED', message: 'Action deadline has passed' }
      };
    }

    const res = this.executeCommand(seat, cmd);

    seat.lastCommandSequence = cmd.commandSequence;
    this.cacheIdempotencyResult(seat, cmd.idempotencyKey, payloadHash, res);

    if (res.success) {
      this.notifyStateChange({ type: 'COMMAND_SUCCESS', commandType: cmd.type, seatId });
    }

    return res;
  }

  private cacheIdempotencyResult(
    seat: InternalSeat,
    key: string,
    hash: string,
    result: AuctionCommandResult
  ): void {
    if (seat.idempotencyCache.size >= AuctionEngine.MAX_IDEMPOTENCY_ENTRIES) {
      const firstKey = seat.idempotencyCache.keys().next().value;
      if (firstKey) seat.idempotencyCache.delete(firstKey);
    }
    seat.idempotencyCache.set(key, { payloadHash: hash, result });
  }

  private executeCommand(seat: InternalSeat, cmd: AuctionCommand): AuctionCommandResult {
    switch (cmd.type) {
      case 'READY':
        return this.handleReady(seat, cmd.ready, cmd.idempotencyKey);
      case 'START':
        return this.handleStart(seat, cmd.idempotencyKey);
      case 'SELECT_BOX':
        return this.handleSelectBox(seat, cmd.boxId, cmd.idempotencyKey);
      case 'OPEN_BOX':
        return this.handleOpenBox(seat, cmd.boxId, cmd.idempotencyKey);
      case 'SUBMIT_BID':
        return this.handleSubmitBid(seat, cmd.amount, cmd.idempotencyKey);
      case 'ACCEPT_AUCTION':
      case 'ACCEPT_OFFER':
        return this.handleAcceptOffer(seat, cmd.offerId, cmd.idempotencyKey);
      case 'REJECT_AUCTION':
      case 'REJECT_OFFER':
        return this.handleRejectOffer(seat, cmd.offerId, cmd.idempotencyKey);
      case 'KEEP_BOX':
        return this.handleKeepBox(seat, cmd.idempotencyKey);
      case 'SWAP_BOX':
        return this.handleSwapBox(seat, cmd.targetBoxId, cmd.idempotencyKey);
      case 'CONTINUE_ROUND':
        return this.handleContinueRound(seat, cmd.idempotencyKey);
      case 'LEAVE':
        return this.handleLeave(seat, cmd.idempotencyKey);
      case 'SEND_EMOTE':
      case 'SEND_REACTION':
        return this.handleSendReaction(seat, cmd.emoji, cmd.idempotencyKey);
      default:
        return {
          success: false,
          idempotencyKey: (cmd as any)?.idempotencyKey,
          stateVersion: this.stateVersion,
          snapshot: this.getClientSnapshot(seat.seatId),
          error: { code: 'INVALID_PAYLOAD', message: 'Unhandled command type' }
        };
    }
  }

  private handleSendReaction(seat: InternalSeat, emoji: string, key: string): AuctionCommandResult {
    const ok = this.processReaction(false, seat.nickname, emoji);
    if (!ok) {
      return {
        success: false,
        idempotencyKey: key,
        stateVersion: this.stateVersion,
        snapshot: this.getClientSnapshot(seat.seatId),
        error: { code: 'INVALID_PAYLOAD', message: 'Emoji is not allowed' }
      };
    }
    return {
      success: true,
      idempotencyKey: key,
      stateVersion: this.stateVersion,
      snapshot: this.getClientSnapshot(seat.seatId)
    };
  }

  // --- Command Handlers ---

  private handleReady(seat: InternalSeat, ready: boolean, key: string): AuctionCommandResult {
    if (this.phase !== 'WAITING') {
      return {
        success: false,
        idempotencyKey: key,
        stateVersion: this.stateVersion,
        snapshot: this.getClientSnapshot(seat.seatId),
        error: { code: 'INVALID_PHASE', message: 'Can only ready up during WAITING phase' }
      };
    }

    seat.ready = ready;
    this.stateVersion++;
    return {
      success: true,
      idempotencyKey: key,
      stateVersion: this.stateVersion,
      snapshot: this.getClientSnapshot(seat.seatId)
    };
  }

  private handleStart(seat: InternalSeat, key: string): AuctionCommandResult {
    if (this.phase !== 'WAITING') {
      return {
        success: false,
        idempotencyKey: key,
        stateVersion: this.stateVersion,
        snapshot: this.getClientSnapshot(seat.seatId),
        error: { code: 'INVALID_PHASE', message: 'Can only start during WAITING phase' }
      };
    }

    if (this.hostSeatId !== seat.seatId) {
      return {
        success: false,
        idempotencyKey: key,
        stateVersion: this.stateVersion,
        snapshot: this.getClientSnapshot(seat.seatId),
        error: { code: 'UNAUTHORIZED', message: 'Only host can start the game' }
      };
    }

    const occupied = this.getOccupiedSeats();
    if (occupied.length < AUCTION_MIN_PLAYERS || occupied.length > AUCTION_MAX_PLAYERS) {
      return {
        success: false,
        idempotencyKey: key,
        stateVersion: this.stateVersion,
        snapshot: this.getClientSnapshot(seat.seatId),
        error: {
          code: 'INVALID_PAYLOAD',
          message: `Player count must be between ${AUCTION_MIN_PLAYERS} and ${AUCTION_MAX_PLAYERS}`
        }
      };
    }

    if (!occupied.every((s) => s.connected && s.ready)) {
      return {
        success: false,
        idempotencyKey: key,
        stateVersion: this.stateVersion,
        snapshot: this.getClientSnapshot(seat.seatId),
        error: { code: 'INVALID_PHASE', message: 'All players must be connected and ready' }
      };
    }

    this.challengerOrder = occupied.map((s) => s.seatId).sort((a, b) => a - b);
    this.totalRounds = this.challengerOrder.length;
    this.challengerRotationIndex = 0;

    this.recordAuditEvent('MATCH_STARTED', {
      totalPlayers: occupied.length,
      challengerOrder: this.challengerOrder
    });

    this.startNextRound();

    return {
      success: true,
      idempotencyKey: key,
      stateVersion: this.stateVersion,
      snapshot: this.getClientSnapshot(seat.seatId)
    };
  }

  private startNextRound(): void {
    this.roundIndex++;
    const currentChallengerSeatId = this.challengerOrder[this.challengerRotationIndex];
    this.challengerSeatId = currentChallengerSeatId;

    // Reset roles
    for (const s of this.seats) {
      if (s.occupied) {
        s.continueReady = false;
        if (s.seatId === this.challengerSeatId) {
          s.role = 'CHALLENGER';
        } else {
          s.role = 'CAPITALIST';
        }
      }
    }

    // Generate independent round fairness bundle
    const roundGameId = `${this.matchId}_round_${this.roundIndex}`;
    const bundle = generateFairnessBundle(roundGameId, { ruleVersion: this.ruleVersion });
    this.roundFairnessData.set(this.roundIndex, {
      algorithm: bundle.algorithm,
      seed: bundle.seed,
      salt: bundle.salt,
      commitment: bundle.commitment,
      boxAmountMap: bundle.boxAmountMap
    });
    this.fairnessCommitments[this.roundIndex] = bundle.commitment;
    this.boxAmountMap = bundle.boxAmountMap;

    this.boxRound = 1;
    this.boxesLeftToOpenThisRound = ROUND_TARGETS[0];
    this.playerBoxId = null;
    this.openedBoxIds.clear();
    this.openedBoxOrder.length = 0;
    this.currentBids.clear();
    this.currentOfferInternal = null;

    this.phase = 'SELECTING';
    this.stateVersion++;

    this.recordAuditEvent('ROUND_STARTED', {
      roundIndex: this.roundIndex,
      challengerSeatId: this.challengerSeatId,
      commitment: bundle.commitment
    });

    this.startPhaseTimer(AUCTION_TIMEOUT_SECONDS.SELECT_PLAYER_BOX, () => this.handleSelectingTimeout());
  }

  private handleSelectBox(seat: InternalSeat, boxId: number, key: string): AuctionCommandResult {
    if (this.phase !== 'SELECTING') {
      return {
        success: false,
        idempotencyKey: key,
        stateVersion: this.stateVersion,
        snapshot: this.getClientSnapshot(seat.seatId),
        error: { code: 'INVALID_PHASE', message: 'Can only select box during SELECTING phase' }
      };
    }

    if (this.challengerSeatId !== seat.seatId) {
      return {
        success: false,
        idempotencyKey: key,
        stateVersion: this.stateVersion,
        snapshot: this.getClientSnapshot(seat.seatId),
        error: { code: 'UNAUTHORIZED', message: 'Only challenger can select player lucky box' }
      };
    }

    if (typeof boxId !== 'number' || !Number.isSafeInteger(boxId) || boxId < 1 || boxId > TOTAL_BOXES) {
      return {
        success: false,
        idempotencyKey: key,
        stateVersion: this.stateVersion,
        snapshot: this.getClientSnapshot(seat.seatId),
        error: { code: 'INVALID_BOX', message: `boxId must be an integer between 1 and ${TOTAL_BOXES}` }
      };
    }

    if (this.openedBoxIds.has(boxId)) {
      return {
        success: false,
        idempotencyKey: key,
        stateVersion: this.stateVersion,
        snapshot: this.getClientSnapshot(seat.seatId),
        error: { code: 'INVALID_BOX', message: 'Box is already opened' }
      };
    }

    this.cancelActiveTimer();
    this.playerBoxId = boxId;
    this.phase = 'OPENING';
    this.stateVersion++;

    this.recordAuditEvent('BOX_SELECTED', {
      seatId: seat.seatId,
      boxId
    });

    this.startPhaseTimer(AUCTION_TIMEOUT_SECONDS.OPEN_BOX, () => this.handleOpeningTimeout());

    return {
      success: true,
      idempotencyKey: key,
      stateVersion: this.stateVersion,
      snapshot: this.getClientSnapshot(seat.seatId)
    };
  }

  private handleOpenBox(seat: InternalSeat, boxId: number, key: string): AuctionCommandResult {
    if (this.phase !== 'OPENING') {
      return {
        success: false,
        idempotencyKey: key,
        stateVersion: this.stateVersion,
        snapshot: this.getClientSnapshot(seat.seatId),
        error: { code: 'INVALID_PHASE', message: 'Can only open box during OPENING phase' }
      };
    }

    if (this.challengerSeatId !== seat.seatId) {
      return {
        success: false,
        idempotencyKey: key,
        stateVersion: this.stateVersion,
        snapshot: this.getClientSnapshot(seat.seatId),
        error: { code: 'UNAUTHORIZED', message: 'Only challenger can open boxes' }
      };
    }

    if (typeof boxId !== 'number' || !Number.isSafeInteger(boxId) || boxId < 1 || boxId > TOTAL_BOXES) {
      return {
        success: false,
        idempotencyKey: key,
        stateVersion: this.stateVersion,
        snapshot: this.getClientSnapshot(seat.seatId),
        error: { code: 'INVALID_BOX', message: `boxId must be an integer between 1 and ${TOTAL_BOXES}` }
      };
    }

    if (boxId === this.playerBoxId) {
      return {
        success: false,
        idempotencyKey: key,
        stateVersion: this.stateVersion,
        snapshot: this.getClientSnapshot(seat.seatId),
        error: { code: 'INVALID_BOX', message: 'Cannot open personal lucky box during opening phase' }
      };
    }

    if (this.openedBoxIds.has(boxId)) {
      return {
        success: false,
        idempotencyKey: key,
        stateVersion: this.stateVersion,
        snapshot: this.getClientSnapshot(seat.seatId),
        error: { code: 'INVALID_BOX', message: 'Box is already opened' }
      };
    }

    this.cancelActiveTimer();
    this.openedBoxIds.add(boxId);
    this.openedBoxOrder.push(boxId);
    this.boxesLeftToOpenThisRound--;

    const revealedAmount = this.boxAmountMap.get(boxId)!;
    this.recordAuditEvent('BOX_OPENED', {
      boxId,
      amount: revealedAmount,
      boxesLeftToOpenThisRound: this.boxesLeftToOpenThisRound
    });

    if (this.boxesLeftToOpenThisRound > 0) {
      // Continue opening boxes in this round
      this.stateVersion++;
      this.startPhaseTimer(AUCTION_TIMEOUT_SECONDS.OPEN_BOX, () => this.handleOpeningTimeout());
    } else {
      // Round opened boxes quota reached
      if (this.openedBoxIds.size >= 24) {
        // 24 boxes opened -> transition directly to FINAL_SWAP
        this.phase = 'FINAL_SWAP';
        this.stateVersion++;
        this.startPhaseTimer(AUCTION_TIMEOUT_SECONDS.FINAL_CHOICE, () => this.handleFinalSwapTimeout());
      } else {
        // Transition to BIDDING phase for capitalists
        this.phase = 'BIDDING';
        this.currentBids.clear();
        this.stateVersion++;
        this.startPhaseTimer(AUCTION_TIMEOUT_SECONDS.BIDDING, () => this.handleBiddingTimeout());
      }
    }

    return {
      success: true,
      idempotencyKey: key,
      stateVersion: this.stateVersion,
      snapshot: this.getClientSnapshot(seat.seatId)
    };
  }

  private handleSubmitBid(seat: InternalSeat, amount: number, key: string): AuctionCommandResult {
    if (this.phase !== 'BIDDING') {
      return {
        success: false,
        idempotencyKey: key,
        stateVersion: this.stateVersion,
        snapshot: this.getClientSnapshot(seat.seatId),
        error: { code: 'INVALID_PHASE', message: 'Can only submit bid during BIDDING phase' }
      };
    }

    if (seat.role !== 'CAPITALIST') {
      return {
        success: false,
        idempotencyKey: key,
        stateVersion: this.stateVersion,
        snapshot: this.getClientSnapshot(seat.seatId),
        error: { code: 'UNAUTHORIZED', message: 'Only capitalists can submit bids' }
      };
    }

    if (this.currentBids.has(seat.seatId)) {
      return {
        success: false,
        idempotencyKey: key,
        stateVersion: this.stateVersion,
        snapshot: this.getClientSnapshot(seat.seatId),
        error: { code: 'INVALID_PHASE', message: 'Bid already submitted for this round' }
      };
    }

    if (amount > seat.capital) {
      return {
        success: false,
        idempotencyKey: key,
        stateVersion: this.stateVersion,
        snapshot: this.getClientSnapshot(seat.seatId),
        error: { code: 'INVALID_PAYLOAD', message: 'Bid exceeds remaining available capital' }
      };
    }

    this.currentBids.set(seat.seatId, {
      seatId: seat.seatId,
      amount,
      receiveSeq: ++this.bidSequenceCounter,
      timestamp: this.clock.now()
    });

    this.recordAuditEvent('BID_SUBMITTED', {
      seatId: seat.seatId,
      receiveSeq: this.bidSequenceCounter
      // Amount is audited in server internal audit trail
    });

    this.stateVersion++;

    // Check if all active capitalists have submitted
    this.checkBiddingCompletion();

    return {
      success: true,
      idempotencyKey: key,
      stateVersion: this.stateVersion,
      snapshot: this.getClientSnapshot(seat.seatId)
    };
  }

  private checkBiddingCompletion(): void {
    if (this.phase !== 'BIDDING') return;

    const activeCapitalists = this.getActivePlayers().filter((s) => s.role === 'CAPITALIST');
    if (activeCapitalists.length > 0 && this.currentBids.size >= activeCapitalists.length) {
      this.cancelActiveTimer();
      this.resolveBidsAndTransition();
    }
  }

  private resolveBidsAndTransition(): void {
    const bids = Array.from(this.currentBids.values());

    if (bids.length === 0) {
      // No bids submitted
      this.recordAuditEvent('BIDS_EVALUATED_EMPTY', { roundIndex: this.roundIndex, boxRound: this.boxRound });
      this.advanceAfterOfferOrBidding();
      return;
    }

    // Sort descending by amount, tie-break by earlier receive sequence
    bids.sort((a, b) => {
      if (b.amount !== a.amount) {
        return b.amount - a.amount;
      }
      return a.receiveSeq - b.receiveSeq;
    });

    const winningBid = bids[0];

    this.currentOfferInternal = {
      offerId: `offer_${crypto.randomUUID()}`,
      amount: winningBid.amount,
      winningSeatId: winningBid.seatId,
      deadlineTimestamp: this.clock.now() + AUCTION_TIMEOUT_SECONDS.CHALLENGER_DECISION * 1000
    };

    this.phase = 'OFFERING';
    this.stateVersion++;

    this.recordAuditEvent('HIGHEST_BID_REVEALED', {
      offerId: this.currentOfferInternal.offerId,
      amount: this.currentOfferInternal.amount
    });

    this.startPhaseTimer(AUCTION_TIMEOUT_SECONDS.CHALLENGER_DECISION, () => this.handleChallengerDecisionTimeout());
  }

  private handleAcceptOffer(seat: InternalSeat, offerId: string, key: string): AuctionCommandResult {
    if (this.phase !== 'OFFERING' || !this.currentOfferInternal) {
      return {
        success: false,
        idempotencyKey: key,
        stateVersion: this.stateVersion,
        snapshot: this.getClientSnapshot(seat.seatId),
        error: { code: 'INVALID_PHASE', message: 'Can only accept offer during OFFERING phase' }
      };
    }

    if (this.challengerSeatId !== seat.seatId) {
      return {
        success: false,
        idempotencyKey: key,
        stateVersion: this.stateVersion,
        snapshot: this.getClientSnapshot(seat.seatId),
        error: { code: 'UNAUTHORIZED', message: 'Only challenger can accept the offer' }
      };
    }

    if (this.currentOfferInternal.offerId !== offerId) {
      return {
        success: false,
        idempotencyKey: key,
        stateVersion: this.stateVersion,
        snapshot: this.getClientSnapshot(seat.seatId),
        error: { code: 'OFFER_EXPIRED', message: 'Offer ID does not match current offer' }
      };
    }

    this.cancelActiveTimer();

    const offerAmount = this.currentOfferInternal.amount;
    const winnerSeat = this.seats[this.currentOfferInternal.winningSeatId];
    const playerBoxAmount = this.boxAmountMap.get(this.playerBoxId!)!;

    // Challenger gains offerAmount
    seat.score += offerAmount;

    // Winner capitalist pays offerAmount from capital, gains boxAmount - offerAmount profit
    winnerSeat.capital -= offerAmount;
    const winnerProfit = playerBoxAmount - offerAmount;
    winnerSeat.score += winnerProfit;

    const capitalistProfits: Record<number, number> = {};
    const capitalDeductions: Record<number, number> = {};

    for (const s of this.seats) {
      if (s.occupied && s.seatId !== seat.seatId) {
        if (s.seatId === winnerSeat.seatId) {
          capitalistProfits[s.seatId] = winnerProfit;
          capitalDeductions[s.seatId] = offerAmount;
        } else {
          capitalistProfits[s.seatId] = 0;
          capitalDeductions[s.seatId] = 0;
        }
      }
    }

    // Reveal challenger lucky box
    this.openedBoxIds.add(this.playerBoxId!);
    this.openedBoxOrder.push(this.playerBoxId!);

    const roundRes: AuctionRoundResult = {
      roundIndex: this.roundIndex,
      challengerSeatId: seat.seatId,
      outcomeType: 'OFFER_ACCEPTED',
      originalPlayerBoxId: this.playerBoxId!,
      finalPlayerBoxId: this.playerBoxId!,
      originalPlayerBoxAmount: playerBoxAmount,
      finalPlayerBoxAmount: playerBoxAmount,
      acceptedOfferAmount: offerAmount,
      winningCapitalistSeatId: winnerSeat.seatId,
      winningBidAmount: offerAmount,
      challengerProfit: offerAmount,
      capitalistProfits,
      capitalDeductions
    };

    this.roundResults.push(roundRes);
    this.recordAuditEvent('OFFER_ACCEPTED', {
      roundIndex: this.roundIndex,
      offerAmount,
      winningSeatId: winnerSeat.seatId,
      playerBoxAmount,
      winnerProfit
    });

    this.phase = 'ROUND_COMPLETE';
    this.currentOfferInternal = null;
    this.stateVersion++;

    this.startPhaseTimer(AUCTION_TIMEOUT_SECONDS.ROUND_INTERMISSION, () => this.handleRoundIntermissionTimeout());

    return {
      success: true,
      idempotencyKey: key,
      stateVersion: this.stateVersion,
      snapshot: this.getClientSnapshot(seat.seatId)
    };
  }

  private handleRejectOffer(seat: InternalSeat, offerId: string, key: string): AuctionCommandResult {
    if (this.phase !== 'OFFERING' || !this.currentOfferInternal) {
      return {
        success: false,
        idempotencyKey: key,
        stateVersion: this.stateVersion,
        snapshot: this.getClientSnapshot(seat.seatId),
        error: { code: 'INVALID_PHASE', message: 'Can only reject offer during OFFERING phase' }
      };
    }

    if (this.challengerSeatId !== seat.seatId) {
      return {
        success: false,
        idempotencyKey: key,
        stateVersion: this.stateVersion,
        snapshot: this.getClientSnapshot(seat.seatId),
        error: { code: 'UNAUTHORIZED', message: 'Only challenger can reject the offer' }
      };
    }

    if (this.currentOfferInternal.offerId !== offerId) {
      return {
        success: false,
        idempotencyKey: key,
        stateVersion: this.stateVersion,
        snapshot: this.getClientSnapshot(seat.seatId),
        error: { code: 'OFFER_EXPIRED', message: 'Offer ID does not match current offer' }
      };
    }

    this.cancelActiveTimer();
    this.recordAuditEvent('OFFER_REJECTED', {
      roundIndex: this.roundIndex,
      offerId
    });

    this.currentOfferInternal = null;
    this.advanceAfterOfferOrBidding();

    return {
      success: true,
      idempotencyKey: key,
      stateVersion: this.stateVersion,
      snapshot: this.getClientSnapshot(seat.seatId)
    };
  }

  private advanceAfterOfferOrBidding(): void {
    this.boxRound++;
    if (this.boxRound <= 9 && this.openedBoxIds.size < 24) {
      this.boxesLeftToOpenThisRound = ROUND_TARGETS[this.boxRound - 1];
      this.phase = 'OPENING';
      this.stateVersion++;
      this.startPhaseTimer(AUCTION_TIMEOUT_SECONDS.OPEN_BOX, () => this.handleOpeningTimeout());
    } else {
      this.phase = 'FINAL_SWAP';
      this.stateVersion++;
      this.startPhaseTimer(AUCTION_TIMEOUT_SECONDS.FINAL_CHOICE, () => this.handleFinalSwapTimeout());
    }
  }

  private handleKeepBox(seat: InternalSeat, key: string): AuctionCommandResult {
    return this.resolveFinalChoice(seat, false, key);
  }

  private handleSwapBox(seat: InternalSeat, targetBoxId: number, key: string): AuctionCommandResult {
    if (typeof targetBoxId !== 'number' || !Number.isSafeInteger(targetBoxId) || targetBoxId < 1 || targetBoxId > TOTAL_BOXES) {
      return {
        success: false,
        idempotencyKey: key,
        stateVersion: this.stateVersion,
        snapshot: this.getClientSnapshot(seat.seatId),
        error: { code: 'INVALID_BOX', message: `targetBoxId must be an integer between 1 and ${TOTAL_BOXES}` }
      };
    }

    if (targetBoxId === this.playerBoxId) {
      return {
        success: false,
        idempotencyKey: key,
        stateVersion: this.stateVersion,
        snapshot: this.getClientSnapshot(seat.seatId),
        error: { code: 'INVALID_BOX', message: 'Cannot swap box with current player box' }
      };
    }

    if (this.openedBoxIds.has(targetBoxId)) {
      return {
        success: false,
        idempotencyKey: key,
        stateVersion: this.stateVersion,
        snapshot: this.getClientSnapshot(seat.seatId),
        error: { code: 'INVALID_BOX', message: 'Swap target box is already opened' }
      };
    }

    const unopened = this.getUnopenedBoxes().filter((b) => b !== this.playerBoxId);
    if (unopened.length !== 1 || unopened[0] !== targetBoxId) {
      return {
        success: false,
        idempotencyKey: key,
        stateVersion: this.stateVersion,
        snapshot: this.getClientSnapshot(seat.seatId),
        error: { code: 'INVALID_BOX', message: 'Swap target must be the single remaining unopened box' }
      };
    }

    return this.resolveFinalChoice(seat, true, key, targetBoxId);
  }

  private resolveFinalChoice(
    seat: InternalSeat,
    swap: boolean,
    key?: string,
    targetBoxId?: number
  ): AuctionCommandResult {
    if (this.phase !== 'FINAL_SWAP') {
      return {
        success: false,
        idempotencyKey: key,
        stateVersion: this.stateVersion,
        snapshot: this.getClientSnapshot(seat.seatId),
        error: { code: 'INVALID_PHASE', message: 'Can only make final choice during FINAL_SWAP phase' }
      };
    }

    if (this.challengerSeatId !== seat.seatId) {
      return {
        success: false,
        idempotencyKey: key,
        stateVersion: this.stateVersion,
        snapshot: this.getClientSnapshot(seat.seatId),
        error: { code: 'UNAUTHORIZED', message: 'Only challenger can make the final choice' }
      };
    }

    this.cancelActiveTimer();

    const originalBoxId = this.playerBoxId!;
    const unopenedOther = this.getUnopenedBoxes().find((b) => b !== originalBoxId)!;
    const finalBoxId = swap && targetBoxId ? targetBoxId : originalBoxId;

    const originalAmount = this.boxAmountMap.get(originalBoxId)!;
    const finalAmount = this.boxAmountMap.get(finalBoxId)!;

    // Challenger gets final box amount
    seat.score += finalAmount;

    // Capitalists get 0 profit in final swap
    const capitalistProfits: Record<number, number> = {};
    const capitalDeductions: Record<number, number> = {};
    for (const s of this.seats) {
      if (s.occupied && s.seatId !== seat.seatId) {
        capitalistProfits[s.seatId] = 0;
        capitalDeductions[s.seatId] = 0;
      }
    }

    // Reveal both remaining boxes
    this.openedBoxIds.add(originalBoxId);
    this.openedBoxIds.add(unopenedOther);
    this.openedBoxOrder.push(originalBoxId, unopenedOther);

    const roundRes: AuctionRoundResult = {
      roundIndex: this.roundIndex,
      challengerSeatId: seat.seatId,
      outcomeType: swap ? 'FINAL_SWAP' : 'FINAL_KEEP',
      originalPlayerBoxId: originalBoxId,
      finalPlayerBoxId: finalBoxId,
      originalPlayerBoxAmount: originalAmount,
      finalPlayerBoxAmount: finalAmount,
      challengerProfit: finalAmount,
      capitalistProfits,
      capitalDeductions
    };

    this.roundResults.push(roundRes);
    this.recordAuditEvent(swap ? 'FINAL_SWAP_CHOSEN' : 'FINAL_KEEP_CHOSEN', {
      roundIndex: this.roundIndex,
      originalBoxId,
      finalBoxId,
      wonAmount: finalAmount
    });

    this.phase = 'ROUND_COMPLETE';
    this.stateVersion++;

    this.startPhaseTimer(AUCTION_TIMEOUT_SECONDS.ROUND_INTERMISSION, () => this.handleRoundIntermissionTimeout());

    return {
      success: true,
      idempotencyKey: key,
      stateVersion: this.stateVersion,
      snapshot: this.getClientSnapshot(seat.seatId)
    };
  }

  private handleContinueRound(seat: InternalSeat, key: string): AuctionCommandResult {
    if (this.phase !== 'ROUND_COMPLETE') {
      return {
        success: false,
        idempotencyKey: key,
        stateVersion: this.stateVersion,
        snapshot: this.getClientSnapshot(seat.seatId),
        error: { code: 'INVALID_PHASE', message: 'Can only continue during ROUND_COMPLETE phase' }
      };
    }

    seat.continueReady = true;
    this.stateVersion++;

    const active = this.getActivePlayers();
    if (active.every((s) => s.continueReady)) {
      this.cancelActiveTimer();
      this.advanceToNextChallengerOrFinish();
    }

    return {
      success: true,
      idempotencyKey: key,
      stateVersion: this.stateVersion,
      snapshot: this.getClientSnapshot(seat.seatId)
    };
  }

  private handleLeave(seat: InternalSeat, key: string): AuctionCommandResult {
    if (this.phase === 'WAITING') {
      this.releaseWaitingSeat(seat.seatId);
      return {
        success: true,
        idempotencyKey: key,
        stateVersion: this.stateVersion,
        snapshot: this.getClientSnapshot(seat.seatId)
      };
    }

    // Match in progress -> forfeit
    this.forfeitPlayer(seat.seatId, 'FORFEIT');
    return {
      success: true,
      idempotencyKey: key,
      stateVersion: this.stateVersion,
      snapshot: this.getClientSnapshot(seat.seatId)
    };
  }

  // --- Round Transition & Finishing ---

  private advanceToNextChallengerOrFinish(): void {
    const activeSurvivors = this.getActivePlayers();
    if (activeSurvivors.length < 2) {
      this.finishMatch(activeSurvivors.length === 1 ? 'SURVIVOR_WIN' : 'FORFEIT_ALL');
      return;
    }

    // Find next challenger who has not forfeited
    this.challengerRotationIndex++;
    while (
      this.challengerRotationIndex < this.challengerOrder.length &&
      this.seats[this.challengerOrder[this.challengerRotationIndex]].forfeited
    ) {
      this.challengerRotationIndex++;
    }

    if (this.challengerRotationIndex >= this.challengerOrder.length) {
      // All scheduled challenger rounds completed
      this.finishMatch('NORMAL');
    } else {
      this.startNextRound();
    }
  }

  private finishMatch(reason: 'NORMAL' | 'FORFEIT_ALL' | 'SURVIVOR_WIN' | 'TIMEOUT_DISCONNECT'): void {
    if (this.phase === 'FINISHED') return;
    this.cancelActiveTimer();
    this.phase = 'FINISHED';

    // Build fairness proofs for all rounds that were started
    const fairnessProofs: AuctionFairnessProof[] = [];
    for (let r = 1; r <= this.roundIndex; r++) {
      const fd = this.roundFairnessData.get(r);
      if (fd) {
        const finalBoxes: Array<{ id: number; amount: number }> = [];
        for (let i = 1; i <= TOTAL_BOXES; i++) {
          finalBoxes.push({ id: i, amount: fd.boxAmountMap.get(i)! });
        }
        fairnessProofs.push({
          roundIndex: r,
          algorithm: fd.algorithm,
          gameId: `${this.matchId}_round_${r}`,
          matchId: this.matchId,
          ruleVersion: this.ruleVersion,
          seed: fd.seed,
          salt: fd.salt,
          amounts: Array.from(MONEY_VALUES),
          roundTargets: Array.from(ROUND_TARGETS),
          commitment: fd.commitment,
          finalBoxes
        });
      }
    }

    // Compute rankings
    const rankings: AuctionRanking[] = this.seats
      .filter((s) => s.occupied)
      .map((s) => ({
        seatId: s.seatId,
        nickname: s.nickname,
        score: s.score,
        remainingCapital: s.capital,
        rank: 0,
        forfeited: s.forfeited
      }));

    // Sort rankings: non-forfeited first, then highest score, then highest remaining capital, then seatId
    rankings.sort((a, b) => {
      if (a.forfeited !== b.forfeited) {
        return a.forfeited ? 1 : -1;
      }
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      if (b.remainingCapital !== a.remainingCapital) {
        return b.remainingCapital - a.remainingCapital;
      }
      return a.seatId - b.seatId;
    });

    rankings.forEach((r, idx) => {
      r.rank = idx + 1;
    });

    const winnerSeatId = rankings.length > 0 && !rankings[0].forfeited ? rankings[0].seatId : null;

    const finalScores: Record<number, number> = {};
    for (const s of this.seats) {
      if (s.occupied) {
        finalScores[s.seatId] = s.score;
      }
    }

    const forfeitedSeatIds = this.seats.filter((s) => s.occupied && s.forfeited).map((s) => s.seatId);

    this.result = {
      resultId: `res_${crypto.randomUUID()}`,
      matchId: this.matchId,
      ruleVersion: this.ruleVersion,
      winnerSeatId,
      reason,
      rankings,
      finalScores,
      forfeitedSeatIds,
      rounds: JSON.parse(JSON.stringify(this.roundResults)),
      fairnessProofs,
      auditTrail: JSON.parse(JSON.stringify(this.auditTrail))
    };

    const completedSeats = this.seats
      .filter((s) => s.occupied)
      .map((s) => ({ seatId: s.seatId, nickname: s.nickname }));

    this.completedRecord = {
      matchId: this.matchId,
      resultId: this.result.resultId,
      ruleVersion: this.ruleVersion,
      completedAt: this.clock.now(),
      isPrivate: this.isPrivate,
      ranked: this.ranked,
      allowSpectators: this.allowSpectators,
      seats: completedSeats,
      result: this.result
    };

    this.stateVersion++;
    this.recordAuditEvent('MATCH_FINISHED', {
      resultId: this.result.resultId,
      winnerSeatId,
      reason
    });

    this.notifyStateChange({ type: 'MATCH_FINISHED', result: this.result });
  }

  // --- Timeout Handlers ---

  private startPhaseTimer(seconds: number, callback: () => void): void {
    this.cancelActiveTimer();
    this.deadlineTimestamp = this.clock.now() + seconds * 1000;
    this.activeTimer = this.clock.setTimeout(() => {
      this.activeTimer = null;
      this.deadlineTimestamp = null;
      callback();
    }, seconds * 1000);
  }

  private cancelActiveTimer(): void {
    if (this.activeTimer) {
      this.activeTimer.cancel();
      this.activeTimer = null;
    }
    this.deadlineTimestamp = null;
  }

  private triggerActiveTimeout(): void {
    if (this.activeTimer) {
      this.activeTimer.cancel();
      this.activeTimer = null;
    }
    this.deadlineTimestamp = null;

    switch (this.phase) {
      case 'SELECTING':
        this.handleSelectingTimeout();
        break;
      case 'OPENING':
        this.handleOpeningTimeout();
        break;
      case 'BIDDING':
        this.handleBiddingTimeout();
        break;
      case 'OFFERING':
        this.handleChallengerDecisionTimeout();
        break;
      case 'FINAL_SWAP':
        this.handleFinalSwapTimeout();
        break;
      case 'ROUND_COMPLETE':
        this.handleRoundIntermissionTimeout();
        break;
    }
  }

  private handleSelectingTimeout(): void {
    if (this.phase !== 'SELECTING') return;

    // Timeout: server randomly chooses legal unopened box
    const legalBoxes: number[] = [];
    for (let i = 1; i <= TOTAL_BOXES; i++) {
      legalBoxes.push(i);
    }
    const picked = legalBoxes[this.randomInt(0, legalBoxes.length)];
    this.playerBoxId = picked;
    this.phase = 'OPENING';
    this.stateVersion++;

    this.recordAuditEvent('SELECT_TIMEOUT_AUTO_PICK', {
      seatId: this.challengerSeatId,
      boxId: picked
    });

    this.notifyStateChange({ type: 'PHASE_TIMEOUT_AUTO_SELECT', boxId: picked });
    this.startPhaseTimer(AUCTION_TIMEOUT_SECONDS.OPEN_BOX, () => this.handleOpeningTimeout());
  }

  private handleOpeningTimeout(): void {
    if (this.phase !== 'OPENING') return;

    // Timeout: server randomly opens an unopened non-player box
    const legalBoxes = this.getUnopenedBoxes().filter((b) => b !== this.playerBoxId);
    if (legalBoxes.length === 0) return;

    const picked = legalBoxes[this.randomInt(0, legalBoxes.length)];
    this.openedBoxIds.add(picked);
    this.openedBoxOrder.push(picked);
    this.boxesLeftToOpenThisRound--;

    const amount = this.boxAmountMap.get(picked)!;
    this.recordAuditEvent('OPEN_TIMEOUT_AUTO_PICK', {
      boxId: picked,
      amount,
      boxesLeftToOpenThisRound: this.boxesLeftToOpenThisRound
    });

    if (this.boxesLeftToOpenThisRound > 0) {
      this.stateVersion++;
      this.notifyStateChange({ type: 'PHASE_TIMEOUT_AUTO_OPEN', boxId: picked });
      this.startPhaseTimer(AUCTION_TIMEOUT_SECONDS.OPEN_BOX, () => this.handleOpeningTimeout());
    } else {
      if (this.openedBoxIds.size >= 24) {
        this.phase = 'FINAL_SWAP';
        this.stateVersion++;
        this.notifyStateChange({ type: 'PHASE_TIMEOUT_AUTO_OPEN', boxId: picked });
        this.startPhaseTimer(AUCTION_TIMEOUT_SECONDS.FINAL_CHOICE, () => this.handleFinalSwapTimeout());
      } else {
        this.phase = 'BIDDING';
        this.currentBids.clear();
        this.stateVersion++;
        this.notifyStateChange({ type: 'PHASE_TIMEOUT_AUTO_OPEN', boxId: picked });
        this.startPhaseTimer(AUCTION_TIMEOUT_SECONDS.BIDDING, () => this.handleBiddingTimeout());
      }
    }
  }

  private handleBiddingTimeout(): void {
    if (this.phase !== 'BIDDING') return;

    this.recordAuditEvent('BIDDING_TIMEOUT', { roundIndex: this.roundIndex, boxRound: this.boxRound });
    this.resolveBidsAndTransition();
    this.notifyStateChange({ type: 'BIDDING_TIMEOUT' });
  }

  private handleChallengerDecisionTimeout(): void {
    if (this.phase !== 'OFFERING' || !this.currentOfferInternal) return;

    // Timeout defaults to REJECT
    this.recordAuditEvent('CHALLENGER_DECISION_TIMEOUT_REJECT', {
      roundIndex: this.roundIndex,
      offerId: this.currentOfferInternal.offerId
    });

    this.currentOfferInternal = null;
    this.advanceAfterOfferOrBidding();
    this.notifyStateChange({ type: 'CHALLENGER_DECISION_TIMEOUT_REJECT' });
  }

  private handleFinalSwapTimeout(): void {
    if (this.phase !== 'FINAL_SWAP') return;

    const challenger = this.seats[this.challengerSeatId!];
    this.resolveFinalChoice(challenger, false);
    this.notifyStateChange({ type: 'FINAL_SWAP_TIMEOUT_KEEP' });
  }

  private handleRoundIntermissionTimeout(): void {
    if (this.phase !== 'ROUND_COMPLETE') return;

    this.advanceToNextChallengerOrFinish();
    this.notifyStateChange({ type: 'ROUND_INTERMISSION_TIMEOUT' });
  }

  // --- Helpers ---

  private getUnopenedBoxes(): number[] {
    const res: number[] = [];
    for (let i = 1; i <= TOTAL_BOXES; i++) {
      if (!this.openedBoxIds.has(i)) {
        res.push(i);
      }
    }
    return res;
  }

  private recordAuditEvent(type: string, data: Record<string, unknown>): void {
    if (this.phase === 'FINISHED' && type !== 'MATCH_FINISHED') {
      return;
    }

    const previousHash =
      this.auditTrail.length === 0
        ? GENESIS_PREVIOUS_HASH
        : (this.auditTrail[this.auditTrail.length - 1] as any).hash || GENESIS_PREVIOUS_HASH;

    const evt = createAuditEvent({
      seq: this.auditTrail.length + 1,
      timestamp: this.clock.now(),
      type,
      payload: {
        roundIndex: this.roundIndex,
        boxRound: this.boxRound,
        ...data
      },
      previousHash
    });
    this.auditTrail.push(evt);
  }
}
