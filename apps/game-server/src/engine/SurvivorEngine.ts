import crypto from 'node:crypto';
import {
  MONEY_VALUES,
  ROUND_TARGETS,
  TOTAL_BOXES,
  TIMEOUT_SECONDS
} from '../../../../packages/protocol/src/config';
import { FairnessBundle, generateFairnessBundle } from './fairness';
import { Clock, SystemClock } from './clock';
import { createAuditEvent } from './audit';
import { GENESIS_PREVIOUS_HASH } from '../../../../packages/protocol/src/fairness';
import {
  CompletedSurvivorRecord,
  SurvivorClientSnapshot,
  SurvivorCommandHeader,
  SurvivorCommandResult,
  SurvivorOffer,
  SurvivorPhase,
  SurvivorPublicSnapshot,
  SurvivorResult,
  SurvivorRoundResult,
  SurvivorSeatInfo,
  SURVIVOR_ALLOWED_EMOJIS,
  SURVIVOR_MAX_PLAYERS,
  SURVIVOR_MIN_PLAYERS,
  SURVIVOR_RULE_VERSION
} from '../../../../packages/protocol/src/survivor';
import { PublicBox } from '../../../../packages/protocol/src/types';

interface Seat {
  seatId: number;
  occupied: boolean;
  nickname: string;
  connected: boolean;
  ready: boolean;
  personalBoxId: number | null;
  lockedScore: number;
  active: boolean;
  forfeited: boolean;
  commandSequence: number;
  offers: SurvivorOffer | null;
  offerResolved: boolean;
  disconnectAt: number | null;
  idempotency: Map<string, SurvivorCommandResult>;
}

export interface SurvivorEngineOptions {
  roomId: string;
  matchId?: string;
  clock?: Clock;
  allowEmotes?: boolean;
  isPrivate?: boolean;
  ranked?: boolean;
}

export class SurvivorEngine {
  public readonly roomId: string;
  public readonly matchId: string;
  private readonly clock: Clock;
  private readonly allowEmotes: boolean;
  private readonly isPrivate: boolean;
  private readonly ranked: boolean;
  private readonly amounts: Map<number, number>;
  private readonly fairnessBundle: FairnessBundle;
  private readonly seats: Seat[] = Array.from({ length: SURVIVOR_MAX_PLAYERS }, (_, seatId) => ({
    seatId,
    occupied: false,
    nickname: `玩家${seatId + 1}`,
    connected: false,
    ready: false,
    personalBoxId: null,
    lockedScore: 0,
    active: true,
    forfeited: false,
    commandSequence: 0,
    offers: null,
    offerResolved: false,
    disconnectAt: null,
    idempotency: new Map()
  }));
  private phase: SurvivorPhase = 'WAITING';
  private stateVersion = 1;
  private roundIndex = 0;
  private currentChooserSeatId: number | null = null;
  private readonly openedBoxIds = new Set<number>();
  private readonly auditTrail: any[] = [];
  private readonly rounds: SurvivorRoundResult[] = [];
  private deadlineTimestamp: number | null = null;
  private timer: { cancel: () => void } | null = null;
  private hostSeatId: number | null = null;
  private spectatorCount = 0;
  private result: SurvivorResult | null = null;
  private lastEmote: { seatId: number; emoji: string; at: number } | null = null;
  private completedAt: number | null = null;
  private onStateChange?: (event?: any) => void;

  constructor(options: SurvivorEngineOptions) {
    this.roomId = options.roomId;
    this.matchId = options.matchId || `survivor_${crypto.randomUUID()}`;
    this.clock = options.clock || new SystemClock();
    this.allowEmotes = options.allowEmotes !== false;
    this.isPrivate = options.isPrivate === true;
    this.ranked = options.ranked !== false;
    const bundle = generateFairnessBundle(this.matchId, { ruleVersion: SURVIVOR_RULE_VERSION });
    this.fairnessBundle = bundle;
    this.amounts = bundle.boxAmountMap;
    this.audit('MATCH_CREATED', { matchId: this.matchId, ruleVersion: SURVIVOR_RULE_VERSION, isPrivate: this.isPrivate, ranked: this.ranked, commitment: bundle.commitment });
  }

  public setOnStateChange(handler: (event?: any) => void): void { this.onStateChange = handler; }
  public getStateVersion(): number { return this.stateVersion; }
  public getPhase(): SurvivorPhase { return this.phase; }
  public isFinished(): boolean { return this.phase === 'FINISHED'; }
  public getOccupiedSeats(): Seat[] { return this.seats.filter((s) => s.occupied); }
  public getSeat(seatId: number): Seat | undefined { return this.seats[seatId]; }
  public getHostSeatId(): number | null { return this.hostSeatId; }
  public setSpectatorCount(count: number): void {
    this.spectatorCount = Math.max(0, Math.floor(count));
    this.stateVersion++;
    this.emit({ type: 'SPECTATOR_COUNT_CHANGED', count: this.spectatorCount });
  }

  public assignSeat(nickname: string): number | null {
    if (this.phase !== 'WAITING') return null;
    const seat = this.seats.find((s) => !s.occupied);
    if (!seat) return null;
    seat.occupied = true;
    seat.connected = true;
    seat.ready = false;
    seat.nickname = Array.from(nickname || '').slice(0, 16).join('') || `玩家${seat.seatId + 1}`;
    seat.disconnectAt = null;
    if (this.hostSeatId === null) this.hostSeatId = seat.seatId;
    this.stateVersion++;
    this.emit({ type: 'PLAYER_JOINED', seatId: seat.seatId });
    return seat.seatId;
  }

  public releaseWaitingSeat(seatId: number): void {
    const seat = this.seats[seatId];
    if (!seat || !seat.occupied || this.phase !== 'WAITING') return;
    Object.assign(seat, { occupied: false, connected: false, ready: false, personalBoxId: null, disconnectAt: null });
    seat.idempotency.clear();
    if (this.hostSeatId === seatId) this.hostSeatId = this.seats.find((s) => s.occupied && s.connected)?.seatId ?? null;
    this.stateVersion++;
    this.emit({ type: 'WAITING_PLAYER_RELEASED', seatId });
  }

  public handleDisconnect(seatId: number): void {
    const seat = this.seats[seatId];
    if (!seat || !seat.occupied) return;
    seat.connected = false;
    seat.disconnectAt = this.clock.now();
    this.emit({ type: 'PLAYER_DISCONNECTED', seatId });
    if (this.phase === 'WAITING') return;
    this.clock.setTimeout(() => {
      if (seat.connected || !seat.occupied) return;
      if (this.clock.now() - (seat.disconnectAt || 0) >= TIMEOUT_SECONDS.RECONNECT_GRACE * 1000) this.forfeitPlayer(seatId);
    }, TIMEOUT_SECONDS.RECONNECT_GRACE * 1000);
  }

  public handleReconnect(seatId: number): boolean {
    const seat = this.seats[seatId];
    if (!seat?.occupied || seat.forfeited) return false;
    seat.connected = true;
    seat.disconnectAt = null;
    this.stateVersion++;
    this.emit({ type: 'PLAYER_RECONNECTED', seatId });
    return true;
  }

  public forfeitPlayer(seatId: number): void {
    const seat = this.seats[seatId];
    if (!seat?.occupied || seat.forfeited || this.phase === 'FINISHED') return;
    seat.forfeited = true;
    seat.active = false;
    seat.connected = false;
    seat.offerResolved = true;
    this.stateVersion++;
    this.audit('PLAYER_FORFEITED', { seatId });
    this.emit({ type: 'PLAYER_FORFEITED', seatId });
    if (this.phase !== 'WAITING') {
      const active = this.getOccupiedSeats().filter((player) => player.active && !player.forfeited);
      if (active.length <= 1) this.finish();
      else this.maybeFinishOrAdvance();
    }
  }

  public processCommand(seatId: number, raw: unknown): SurvivorCommandResult {
    const seat = this.seats[seatId];
    const input = raw as Partial<SurvivorCommandHeader>;
    const key = typeof input?.idempotencyKey === 'string' ? input.idempotencyKey : undefined;
    if (!seat?.occupied || !key) return this.error(key, 'UNAUTHORIZED', 'Invalid seat or command', seat?.seatId ?? null);
    const cached = seat.idempotency.get(key);
    if (cached) return cached;
    if (input.matchId !== this.matchId || input.stateVersion !== this.stateVersion || input.commandSequence !== seat.commandSequence + 1) {
      return this.error(key, 'STALE_VERSION', '当前对局快照已更新，请重试', seat.seatId);
    }
    if (this.phase === 'FINISHED') return this.error(key, 'INVALID_PHASE', '对局已结束', seat.seatId);

    let result: SurvivorCommandResult;
    switch (input.type) {
      case 'READY': result = this.ready(seat, input.ready !== false); break;
      case 'START': result = this.start(seat); break;
      case 'SELECT_BOX': result = this.selectPersonal(seat, input.boxId); break;
      case 'OPEN_BOX': result = this.openBox(seat, input.boxId); break;
      case 'ACCEPT_OFFER': result = this.acceptOffer(seat, input.offerId); break;
      case 'REJECT_OFFER': result = this.rejectOffer(seat, input.offerId); break;
      case 'SEND_EMOTE': result = this.sendEmote(seat, input.emoji); break;
      case 'LEAVE': this.forfeitPlayer(seat.seatId); result = this.success(key); break;
      default: result = this.error(key, 'INVALID_PAYLOAD', '未知命令', seat.seatId); break;
    }
    if (result.success) {
      seat.commandSequence = input.commandSequence!;
      result.idempotencyKey = key;
      result.stateVersion = this.stateVersion;
      result.snapshot = this.getClientSnapshot(seatId);
      seat.idempotency.set(key, result);
    }
    return result;
  }

  public getClientSnapshot(seatId: number | null): SurvivorClientSnapshot {
    const seat = seatId === null ? undefined : this.seats[seatId];
    return {
      public: this.getPublicSnapshot(),
      private: {
        seatId,
        isSpectator: seatId === null,
        lastCommandSequence: seat?.commandSequence ?? 0,
        currentOffer: seat?.offers ? { ...seat.offers } : null,
        allowedActions: this.allowedActions(seat)
      }
    };
  }

  public getCompletedRecord(): CompletedSurvivorRecord | null {
    if (!this.result || this.completedAt === null) return null;
    return {
      matchId: this.matchId,
      resultId: this.result.resultId,
      ruleVersion: SURVIVOR_RULE_VERSION,
      completedAt: this.completedAt,
      seats: this.getOccupiedSeats().map((s) => ({ seatId: s.seatId, nickname: s.nickname })),
      result: structuredClone(this.result)
    };
  }

  public dispose(): void { this.timer?.cancel(); this.timer = null; }

  private ready(seat: Seat, value: boolean): SurvivorCommandResult {
    if (this.phase !== 'WAITING') return this.error(undefined, 'INVALID_PHASE', '等待阶段已结束', seat.seatId);
    seat.ready = value;
    this.stateVersion++;
    this.emit({ type: 'PLAYER_READY', seatId: seat.seatId, ready: value });
    return this.success();
  }

  private start(seat: Seat): SurvivorCommandResult {
    const players = this.getOccupiedSeats();
    if (seat.seatId !== this.hostSeatId || players.length < SURVIVOR_MIN_PLAYERS || !players.every((p) => p.ready && p.connected)) {
      return this.error(undefined, 'INVALID_PHASE', '需要至少两名在线且准备完成的玩家', seat.seatId);
    }
    this.phase = 'SELECTING_PERSONAL';
    this.stateVersion++;
    this.armTimer(TIMEOUT_SECONDS.SELECT_PLAYER_BOX, () => {
      const used = new Set(players.map((p) => p.personalBoxId).filter((id): id is number => id !== null));
      for (const p of players) if (p.personalBoxId === null) p.personalBoxId = this.pickUnopened(used);
      this.beginOpening();
    });
    this.emit({ type: 'MATCH_STARTED' });
    return this.success();
  }

  /** Starts a two-player survivor match from a tournament bracket without exposing a second lobby. */
  public startTournamentMatch(): boolean {
    if (this.phase !== 'WAITING') return false;
    const players = this.getOccupiedSeats();
    if (players.length < SURVIVOR_MIN_PLAYERS || !players.every((player) => player.connected)) return false;
    for (const player of players) player.ready = true;
    this.phase = 'SELECTING_PERSONAL';
    this.stateVersion++;
    this.armTimer(TIMEOUT_SECONDS.SELECT_PLAYER_BOX, () => {
      const used = new Set(players.map((player) => player.personalBoxId).filter((id): id is number => id !== null));
      for (const player of players) if (player.personalBoxId === null) player.personalBoxId = this.pickUnopened(used);
      this.beginOpening();
    });
    this.audit('MATCH_STARTED', { mode: 'TOURNAMENT' });
    this.emit({ type: 'MATCH_STARTED', mode: 'TOURNAMENT' });
    return true;
  }

  private selectPersonal(seat: Seat, boxId?: number): SurvivorCommandResult {
    if (this.phase !== 'SELECTING_PERSONAL' || !Number.isInteger(boxId) || boxId! < 1 || boxId! > TOTAL_BOXES) return this.error(undefined, 'INVALID_BOX', '个人箱选择无效', seat.seatId);
    if (this.seats.some((s) => s.seatId !== seat.seatId && s.personalBoxId === boxId)) return this.error(undefined, 'INVALID_BOX', '该箱子已被其他玩家选择', seat.seatId);
    seat.personalBoxId = boxId!;
    this.stateVersion++;
    if (this.getOccupiedSeats().every((p) => p.personalBoxId !== null)) this.beginOpening();
    return this.success();
  }

  private beginOpening(): void {
    this.timer?.cancel();
    this.phase = 'OPENING';
    this.currentChooserSeatId = this.getOccupiedSeats().find((s) => s.active && !s.forfeited)?.seatId ?? null;
    this.stateVersion++;
    this.armTimer(TIMEOUT_SECONDS.OPEN_BOX, () => this.autoOpen());
    this.emit({ type: 'OPENING_STARTED', seatId: this.currentChooserSeatId });
  }

  private openBox(seat: Seat, boxId?: number): SurvivorCommandResult {
    if (this.phase !== 'OPENING' || this.currentChooserSeatId !== seat.seatId || !Number.isInteger(boxId)) return this.error(undefined, 'INVALID_PHASE', '当前不是你的开箱回合', seat.seatId);
    const id = boxId!;
    if (id < 1 || id > TOTAL_BOXES || this.openedBoxIds.has(id) || this.seats.some((s) => s.personalBoxId === id)) return this.error(undefined, 'INVALID_BOX', '不能打开个人箱或已打开箱', seat.seatId);
    this.openedBoxIds.add(id);
    this.stateVersion++;
    this.phase = 'OFFERING';
    this.currentReveal = this.amounts.get(id) ?? 0;
    const expiresAt = this.clock.now() + TIMEOUT_SECONDS.BANKER_OFFER * 1000;
    const avg = this.remainingAverage();
    for (const p of this.getOccupiedSeats()) {
      p.offerResolved = !p.active || p.forfeited;
      p.offers = p.active && !p.forfeited ? { offerId: `surv_offer_${crypto.randomUUID()}`, amount: Math.max(1, Math.round(avg * 0.5)), expiresAt } : null;
    }
    this.armTimer(TIMEOUT_SECONDS.BANKER_OFFER, () => {
      for (const p of this.getOccupiedSeats()) if (p.active && !p.forfeited) p.offerResolved = true;
      this.maybeFinishOrAdvance();
    });
    this.audit('NEUTRAL_BOX_OPENED', { seatId: seat.seatId, boxId: id, roundIndex: this.roundIndex });
    this.emit({ type: 'BOX_OPENED', seatId: seat.seatId, boxId: id });
    return this.success();
  }

  private acceptOffer(seat: Seat, offerId?: string): SurvivorCommandResult {
    if (this.phase !== 'OFFERING' || !seat.offers || seat.offers.offerId !== offerId || !seat.active) return this.error(undefined, 'INVALID_PHASE', '报价已失效', seat.seatId);
    seat.lockedScore += seat.offers.amount;
    seat.active = false;
    seat.offerResolved = true;
    seat.offers = null;
    this.stateVersion++;
    this.emit({ type: 'OFFER_ACCEPTED', seatId: seat.seatId });
    this.maybeFinishOrAdvance();
    return this.success();
  }

  private rejectOffer(seat: Seat, offerId?: string): SurvivorCommandResult {
    if (this.phase !== 'OFFERING' || !seat.offers || seat.offers.offerId !== offerId || !seat.active) return this.error(undefined, 'INVALID_PHASE', '报价已失效', seat.seatId);
    seat.offers = null;
    seat.offerResolved = true;
    this.stateVersion++;
    this.emit({ type: 'OFFER_REJECTED', seatId: seat.seatId });
    this.maybeFinishOrAdvance();
    return this.success();
  }

  private sendEmote(seat: Seat, emoji?: string): SurvivorCommandResult {
    if (!this.allowEmotes || this.phase === 'FINISHED' || typeof emoji !== 'string' || !SURVIVOR_ALLOWED_EMOJIS.has(emoji)) {
      return this.error(undefined, 'INVALID_PAYLOAD', '不支持的快捷表情', seat.seatId);
    }
    this.lastEmote = { seatId: seat.seatId, emoji, at: this.clock.now() };
    this.stateVersion++;
    this.audit('EMOTE_SENT', { seatId: seat.seatId, emoji });
    this.emit({ type: 'EMOTE_SENT', seatId: seat.seatId, emoji });
    return this.success();
  }

  private maybeFinishOrAdvance(): void {
    if (this.phase !== 'OFFERING') return;
    const active = this.getOccupiedSeats().filter((s) => s.active && !s.forfeited);
    if (active.some((s) => !s.offerResolved)) return;
    const openedId = [...this.openedBoxIds].at(-1)!;
    this.rounds.push({ roundIndex: this.roundIndex, chooserSeatId: this.currentChooserSeatId!, openedBoxId: openedId, openedAmount: this.amounts.get(openedId) ?? 0, acceptedOffers: Object.fromEntries(this.getOccupiedSeats().filter((s) => !s.active).map((s) => [s.seatId, s.lockedScore])) });
    this.currentReveal = null;
    const neutralRemain = this.remainingNeutralIds();
    if (active.length === 0 || neutralRemain.length === 0) {
      this.finish();
      return;
    }
    this.roundIndex++;
    this.currentChooserSeatId = this.nextActiveSeat();
    this.phase = 'OPENING';
    this.stateVersion++;
    this.armTimer(TIMEOUT_SECONDS.OPEN_BOX, () => this.autoOpen());
    this.emit({ type: 'ROUND_ADVANCED', roundIndex: this.roundIndex, seatId: this.currentChooserSeatId });
  }

  private autoOpen(): void {
    if (this.phase !== 'OPENING' || this.currentChooserSeatId === null) return;
    const seat = this.seats[this.currentChooserSeatId];
    const id = this.remainingNeutralIds()[0];
    if (seat && id) this.openBox(seat, id);
  }

  private finish(): void {
    if (this.phase === 'FINISHED') return;
    this.timer?.cancel();
    for (const seat of this.getOccupiedSeats()) {
      if (seat.active && !seat.forfeited && seat.personalBoxId !== null) seat.lockedScore += this.amounts.get(seat.personalBoxId) ?? 0;
      seat.offers = null;
    }
    const rankings = this.getOccupiedSeats().map((s) => ({ seatId: s.seatId, nickname: s.nickname, score: s.lockedScore, forfeited: s.forfeited, rank: 0 })).sort((a, b) => b.score - a.score || a.seatId - b.seatId).map((r, i) => ({ ...r, rank: i + 1 }));
    const finalBoxes = Array.from({ length: TOTAL_BOXES }, (_, i) => ({ id: i + 1, amount: this.amounts.get(i + 1)! }));
    this.result = {
      resultId: `surv_res_${crypto.randomUUID()}`,
      matchId: this.matchId,
      ruleVersion: SURVIVOR_RULE_VERSION,
      rankings,
      rounds: structuredClone(this.rounds),
      fairnessProof: {
        algorithm: this.fairnessBundle.algorithm,
        gameId: this.matchId,
        ruleVersion: SURVIVOR_RULE_VERSION,
        seed: this.fairnessBundle.seed,
        salt: this.fairnessBundle.salt,
        amounts: Array.from(MONEY_VALUES),
        roundTargets: Array.from(ROUND_TARGETS),
        commitment: this.fairnessBundle.commitment,
        finalBoxes
      },
      auditTrail: structuredClone(this.auditTrail)
    };
    this.completedAt = this.clock.now();
    this.phase = 'FINISHED';
    this.stateVersion++;
    this.audit('MATCH_SETTLED', { resultId: this.result.resultId });
    this.emit({ type: 'MATCH_SETTLED' });
  }

  private remainingNeutralIds(): number[] {
    return Array.from({ length: TOTAL_BOXES }, (_, i) => i + 1).filter((id) => !this.openedBoxIds.has(id) && !this.seats.some((s) => s.personalBoxId === id));
  }
  private pickUnopened(used: Set<number>): number {
    const id = this.remainingNeutralIds().find((v) => !used.has(v)) ?? 1;
    used.add(id);
    return id;
  }
  private nextActiveSeat(): number | null {
    const players = this.getOccupiedSeats();
    if (!players.length) return null;
    const start = this.currentChooserSeatId ?? -1;
    return players.find((s) => s.active && !s.forfeited && s.seatId > start)?.seatId ?? players.find((s) => s.active && !s.forfeited)?.seatId ?? null;
  }
  private remainingAverage(): number {
    const ids = this.remainingNeutralIds();
    if (!ids.length) return 1;
    return ids.reduce((sum, id) => sum + (this.amounts.get(id) ?? 0), 0) / ids.length;
  }
  private armTimer(seconds: number, callback: () => void): void { this.timer?.cancel(); this.timer = this.clock.setTimeout(callback, seconds * 1000); this.deadlineTimestamp = this.clock.now() + seconds * 1000; }
  private success(idempotencyKey?: string): SurvivorCommandResult { return { success: true, idempotencyKey, stateVersion: this.stateVersion, snapshot: undefined }; }
  private error(idempotencyKey: string | undefined, code: any, message: string, seatId: number | null = null): SurvivorCommandResult { return { success: false, idempotencyKey, stateVersion: this.stateVersion, snapshot: this.getClientSnapshot(seatId), error: { code, message } }; }
  private allowedActions(seat?: Seat): any[] {
    if (!seat || this.phase === 'FINISHED') return [];
    const emote = this.allowEmotes ? ['SEND_EMOTE'] : [];
    if (this.phase === 'WAITING') return ['READY', ...(this.hostSeatId === seat.seatId ? ['START'] : []), ...emote, 'LEAVE'];
    if (this.phase === 'SELECTING_PERSONAL' && seat.personalBoxId === null) return ['SELECT_BOX', ...emote, 'LEAVE'];
    if (this.phase === 'OPENING' && this.currentChooserSeatId === seat.seatId) return ['OPEN_BOX', ...emote, 'LEAVE'];
    if (this.phase === 'OFFERING' && seat.offers) return ['ACCEPT_OFFER', 'REJECT_OFFER', ...emote, 'LEAVE'];
    return [...emote, 'LEAVE'];
  }
  private audit(type: string, payload: Record<string, unknown>): void { const previousHash = this.auditTrail.at(-1)?.hash ?? GENESIS_PREVIOUS_HASH; this.auditTrail.push(createAuditEvent({ seq: this.auditTrail.length + 1, timestamp: this.clock.now(), type, payload, previousHash })); }
  private emit(event?: any): void { this.onStateChange?.(event); }

  private currentReveal: number | null = null;
  public getPublicSnapshot(): SurvivorPublicSnapshot {
    const boxes: PublicBox[] = Array.from({ length: TOTAL_BOXES }, (_, i) => i + 1).map((id) => this.openedBoxIds.has(id) ? ({ id, status: 'opened', revealedAmount: this.amounts.get(id)! } as PublicBox) : this.seats.some((s) => s.personalBoxId === id) ? ({ id, status: 'selected' } as PublicBox) : ({ id, status: 'unopened' } as PublicBox));
    const seatInfo: SurvivorSeatInfo[] = this.getOccupiedSeats().map((s) => ({ seatId: s.seatId, occupied: s.occupied, nickname: s.nickname, connected: s.connected, ready: s.ready, personalBoxId: s.personalBoxId, lockedScore: s.lockedScore, active: s.active, forfeited: s.forfeited }));
    return { roomId: this.roomId, matchId: this.matchId, ruleVersion: SURVIVOR_RULE_VERSION, isPrivate: this.isPrivate, ranked: this.ranked, stateVersion: this.stateVersion, serverNow: this.clock.now(), phase: this.phase, roundIndex: this.roundIndex, currentChooserSeatId: this.currentChooserSeatId, spectatorCount: this.spectatorCount, allowEmotes: this.allowEmotes, seats: seatInfo, boxes, openedBoxIds: [...this.openedBoxIds], deadlineTimestamp: this.deadlineTimestamp, currentRevealedAmount: this.currentReveal, fairnessCommitment: this.fairnessBundle.commitment, lastEmote: this.lastEmote ? { ...this.lastEmote } : null, result: this.result ? structuredClone(this.result) : null };
  }
}
