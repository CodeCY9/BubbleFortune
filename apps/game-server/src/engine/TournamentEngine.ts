import crypto from 'node:crypto';
import type { DuelActionType, DuelClientSnapshot, DuelCommandResult, DuelPublicSnapshot, DuelRole, DuelSeatId, DuelCommand } from '../../../../packages/protocol/src/duel';
import { validateDuelCommand } from '../../../../packages/protocol/src/duel';
import type { SurvivorClientSnapshot, SurvivorCommandResult, SurvivorPublicSnapshot, SurvivorCommand } from '../../../../packages/protocol/src/survivor';
import type { AuditEvent, PublicError } from '../../../../packages/protocol/src/types';
import { createAuditEvent } from './audit';
import { GENESIS_PREVIOUS_HASH } from '../../../../packages/protocol/src/fairness';
import {
  TOURNAMENT_RULE_VERSION,
  TOURNAMENT_SIZES,
  TournamentActionType,
  TournamentClientSnapshot,
  TournamentCommand,
  TournamentCommandResult,
  TournamentMatchInfo,
  TournamentPublicSnapshot,
  TournamentRankingEntry,
  TournamentResult,
  TournamentRoundInfo,
  TournamentSeatInfo,
  TournamentSize,
  TournamentFormat,
  CompletedTournamentRecord,
  validateTournamentCommand,
  TOURNAMENT_TIEBREAK_RULE
} from '../../../../packages/protocol/src/tournament';
import { DuelEngine } from './DuelEngine';
import { SurvivorEngine } from './SurvivorEngine';

interface SeatInternal {
  seatId: number;
  occupied: boolean;
  nickname: string;
  connected: boolean;
  ready: boolean;
  eliminated: boolean;
  currentMatchId: string | null;
  lastCommandSequence: number;
  idempotencyCache: Map<string, { payloadHash: string; result: TournamentCommandResult }>;
  score: number;
  eliminatedRound: number | null;
  forfeited: boolean;
}

interface MatchInternal {
  matchId: string;
  roundIndex: number;
  playerSeatIds: [number | null, number | null];
  status: 'PENDING' | 'ACTIVE' | 'COMPLETED' | 'BYE';
  winnerSeatId: number | null;
  format: TournamentFormat;
  duel: DuelEngine | null;
  survivor: SurvivorEngine | null;
  duelSeatByTournamentSeat: Map<number, DuelSeatId>;
  survivorSeatByTournamentSeat: Map<number, number>;
  result: any | null;
  tieBreakUsed: boolean;
}

const MAX_IDEMPOTENCY_ENTRIES = 500;

export interface TournamentEngineOptions {
  roomId: string;
  tournamentId?: string;
  size: TournamentSize;
  format?: TournamentFormat;
  isPrivate?: boolean;
  ranked?: boolean;
  allowEmotes?: boolean;
}

export class TournamentEngine {
  public readonly roomId: string;
  public readonly tournamentId: string;
  public readonly ruleVersion = TOURNAMENT_RULE_VERSION;
  public readonly size: TournamentSize;
  public readonly format: TournamentFormat;
  public readonly isPrivate: boolean;
  public readonly ranked: boolean;
  public readonly allowEmotes: boolean;

  private phase: 'WAITING' | 'BRACKET' | 'FINISHED' = 'WAITING';
  private stateVersion = 1;
  private hostSeatId: number | null = 0;
  private result: TournamentResult | null = null;
  private completedAt: number | null = null;
  private readonly seats: SeatInternal[];
  private readonly rounds: MatchInternal[][] = [];
  private readonly matchById = new Map<string, MatchInternal>();
  private readonly eliminationOrder: number[] = [];
  private readonly auditTrail: AuditEvent[] = [];
  private onStateChangeHandler?: (event?: any) => void;

  constructor(options: TournamentEngineOptions) {
    if (!TOURNAMENT_SIZES.includes(options.size)) throw new Error('Unsupported tournament size');
    this.roomId = options.roomId;
    this.tournamentId = options.tournamentId || `tournament_${crypto.randomUUID()}`;
    this.size = options.size;
    this.format = options.format === 'survivor' ? 'survivor' : 'duel';
    this.isPrivate = options.isPrivate === true;
    this.ranked = options.ranked !== false;
    this.allowEmotes = options.allowEmotes !== false;
    this.seats = Array.from({ length: this.size }, (_, seatId) => ({
      seatId,
      occupied: false,
      nickname: `玩家${seatId + 1}`,
      connected: false,
      ready: false,
      eliminated: false,
      currentMatchId: null,
      lastCommandSequence: 0,
      idempotencyCache: new Map(),
      score: 0,
      eliminatedRound: null,
      forfeited: false
    }));
    this.recordAudit('GAME_CREATED', { tournamentId: this.tournamentId, size: this.size, format: this.format, isPrivate: this.isPrivate, ranked: this.ranked, ruleVersion: this.ruleVersion });
  }

  public setOnStateChange(handler: (event?: any) => void): void {
    this.onStateChangeHandler = handler;
  }

  public assignSeat(nickname?: string): number | null {
    if (this.phase !== 'WAITING') return null;
    const seat = this.seats.find((candidate) => !candidate.occupied);
    if (!seat) return null;
    seat.occupied = true;
    seat.connected = true;
    seat.ready = false;
    seat.eliminated = false;
    seat.nickname = this.sanitizeNickname(nickname, `玩家${seat.seatId + 1}`);
    seat.lastCommandSequence = 0;
    seat.idempotencyCache.clear();
    this.stateVersion++;
    this.recordAudit('PLAYER_JOINED', { seatId: seat.seatId, nickname: seat.nickname });
    this.notify({ type: 'PLAYER_JOINED', seatId: seat.seatId });
    return seat.seatId;
  }

  public leaveWaitingSeat(seatId: number): void {
    if (this.phase !== 'WAITING') return;
    const seat = this.seats[seatId];
    if (!seat?.occupied) return;
    seat.occupied = false;
    seat.connected = false;
    seat.ready = false;
    seat.nickname = `玩家${seatId + 1}`;
    seat.lastCommandSequence = 0;
    seat.idempotencyCache.clear();
    if (this.hostSeatId === seatId) {
      this.hostSeatId = this.seats.find((candidate) => candidate.occupied)?.seatId ?? null;
    }
    this.stateVersion++;
    this.recordAudit('PLAYER_LEFT_LOBBY', { seatId });
    this.notify({ type: 'PLAYER_LEFT_LOBBY', seatId });
  }

  public setConnected(seatId: number, connected: boolean): boolean {
    const seat = this.seats[seatId];
    if (!seat?.occupied) return false;
    seat.connected = connected;
    if (seat.currentMatchId) {
      const match = this.matchById.get(seat.currentMatchId);
      const localSeat = match?.duelSeatByTournamentSeat.get(seatId);
      if (match?.format === 'duel' && match.duel && localSeat !== undefined) match.duel.setConnected(localSeat, connected);
      const survivorSeat = match?.survivorSeatByTournamentSeat.get(seatId);
      if (match?.format === 'survivor' && match.survivor && survivorSeat !== undefined) {
        if (connected) match.survivor.handleReconnect(survivorSeat);
        else match.survivor.handleDisconnect(survivorSeat);
      }
    }
    this.stateVersion++;
    this.recordAudit(connected ? 'PLAYER_RECONNECTED' : 'PLAYER_DISCONNECTED', { seatId });
    this.notify({ type: connected ? 'PLAYER_RECONNECTED' : 'PLAYER_DISCONNECTED', seatId });
    return true;
  }

  public getPhase(): 'WAITING' | 'BRACKET' | 'FINISHED' { return this.phase; }
  public getStateVersion(): number { return this.stateVersion; }
  public isFinished(): boolean { return this.phase === 'FINISHED'; }
  public isSeatOccupied(seatId: number): boolean { return Boolean(this.seats[seatId]?.occupied); }
  public getSeat(seatId: number): TournamentSeatInfo | null {
    const seat = this.seats[seatId];
    return seat ? this.toSeatInfo(seat) : null;
  }

  public getPublicSnapshot(): TournamentPublicSnapshot {
    return {
      roomId: this.roomId,
      tournamentId: this.tournamentId,
      ruleVersion: this.ruleVersion,
      isPrivate: this.isPrivate,
      ranked: this.ranked,
      stateVersion: this.stateVersion,
      serverNow: Date.now(),
      phase: this.phase,
      size: this.size,
      format: this.format,
      allowEmotes: this.allowEmotes,
      hostSeatId: this.hostSeatId,
      seats: this.seats.map((seat) => this.toSeatInfo(seat)),
      rounds: this.rounds.map((round) => ({
        roundIndex: round[0]?.roundIndex ?? 0,
        matches: round.map((match) => this.toMatchInfo(match))
      })),
      activeMatchId: this.seats.find((seat) => seat.currentMatchId)?.currentMatchId ?? null,
      result: this.result ? this.copyResult(this.result) : null
    };
  }

  public getAllowedActions(seatId: number): TournamentActionType[] {
    const seat = this.seats[seatId];
    if (!seat?.occupied) return [];
    if (this.phase === 'WAITING') {
      const actions: TournamentActionType[] = ['READY', 'LEAVE'];
      if (seatId === this.hostSeatId && this.canStart()) actions.push('START');
      return actions;
    }
    if (this.phase === 'BRACKET' && seat.currentMatchId && !seat.eliminated) return ['MATCH_COMMAND', 'LEAVE'];
    return ['LEAVE'];
  }

  public getClientSnapshot(seatId: number | null): TournamentClientSnapshot {
    const activeMatch = seatId === null ? null : this.getActiveClientSnapshot(seatId);
    return {
      public: this.getPublicSnapshot(),
      private: {
        seatId,
        lastCommandSequence: seatId === null ? 0 : this.seats[seatId]?.lastCommandSequence ?? 0,
        allowedActions: seatId === null ? [] : this.getAllowedActions(seatId),
        activeMatch
      }
    };
  }

  public processCommand(seatId: number, rawPayload: unknown): TournamentCommandResult {
    const rawKey = rawPayload && typeof rawPayload === 'object' && typeof (rawPayload as any).idempotencyKey === 'string'
      ? (rawPayload as any).idempotencyKey as string : undefined;
    const seat = this.seats[seatId];
    if (!seat?.occupied) return this.fail(rawKey, 'UNAUTHORIZED', 'Seat is not occupied', seatId);

    const validation = validateTournamentCommand(rawPayload);
    if (!validation.valid || !validation.command) return this.fail(rawKey, validation.error?.code || 'INVALID_PAYLOAD', validation.error?.message || 'Invalid command', seatId);
    const command = validation.command;
    if (command.tournamentId !== this.tournamentId) return this.fail(command.idempotencyKey, 'INVALID_PAYLOAD', 'Tournament ID mismatch', seatId);

    const payloadHash = this.hashPayload(rawPayload);
    const cached = seat.idempotencyCache.get(command.idempotencyKey);
    if (cached) {
      if (cached.payloadHash === payloadHash) return { ...cached.result, stateVersion: this.stateVersion, snapshot: this.getClientSnapshot(seatId) };
      return this.fail(command.idempotencyKey, 'IDEMPOTENCY_CONFLICT', 'Idempotency conflict with differing payload', seatId);
    }
    if (command.commandSequence !== seat.lastCommandSequence + 1) return this.fail(command.idempotencyKey, 'OUT_OF_SEQUENCE', 'Command sequence is not consecutive', seatId);
    if (command.stateVersion !== this.stateVersion) return this.fail(command.idempotencyKey, 'STALE_VERSION', 'Tournament state has advanced', seatId);

    seat.lastCommandSequence = command.commandSequence;
    let duelResult: unknown;
    let survivorResult: unknown;
    let error: PublicError | null = null;
    switch (command.type) {
      case 'READY':
        if (this.phase !== 'WAITING') error = { code: 'INVALID_PHASE', message: 'Tournament has started' };
        else { seat.ready = command.ready; this.stateVersion++; this.recordAudit('READY_TOGGLED', { seatId, ready: command.ready }); }
        break;
      case 'START':
        if (seatId !== this.hostSeatId || !this.canStart()) error = { code: 'INVALID_PHASE', message: 'Host and all players must be ready' };
        else this.startBracket();
        break;
      case 'MATCH_COMMAND':
        ({ error, duelResult, survivorResult } = this.processMatchCommand(seatId, command));
        break;
      case 'LEAVE':
        ({ error, duelResult, survivorResult } = this.processLeaveCommand(seatId));
        break;
    }

    const result: TournamentCommandResult = error ? {
      success: false,
      idempotencyKey: command.idempotencyKey,
      stateVersion: this.stateVersion,
      snapshot: this.getClientSnapshot(seatId),
      error
    } : {
      success: true,
      idempotencyKey: command.idempotencyKey,
      stateVersion: this.stateVersion,
      snapshot: this.getClientSnapshot(seatId),
      ...(duelResult !== undefined ? { duelResult } : {}),
      ...(survivorResult !== undefined ? { survivorResult } : {})
    };

    if (seat.idempotencyCache.size >= MAX_IDEMPOTENCY_ENTRIES) {
      const first = seat.idempotencyCache.keys().next().value;
      if (first) seat.idempotencyCache.delete(first);
    }
    seat.idempotencyCache.set(command.idempotencyKey, { payloadHash, result });
    this.notify({ type: 'COMMAND_PROCESSED', seatId, commandType: command.type });
    return result;
  }

  public getCompletedRecord(): CompletedTournamentRecord | null {
    if (!this.result) return null;
    return {
      tournamentId: this.tournamentId,
      resultId: this.result.resultId,
      ruleVersion: this.ruleVersion,
      completedAt: this.completedAt ?? Date.now(),
      seats: this.seats.filter((seat) => seat.occupied).map((seat) => ({ seatId: seat.seatId, nickname: seat.nickname })),
      result: this.copyResult(this.result)
    };
  }

  public dispose(): void {
    for (const match of this.matchById.values()) {
      match.duel?.dispose();
      match.survivor?.dispose();
    }
    this.matchById.clear();
  }

  private processMatchCommand(seatId: number, command: Extract<TournamentCommand, { type: 'MATCH_COMMAND' }>): { error: PublicError | null; duelResult?: DuelCommandResult; survivorResult?: SurvivorCommandResult } {
    const seat = this.seats[seatId];
    if (this.phase !== 'BRACKET' || seat.currentMatchId !== command.matchId || seat.eliminated) {
      return { error: { code: 'INVALID_PHASE', message: 'Player has no active tournament match' } };
    }
    const match = this.matchById.get(command.matchId);
    if (!match || match.status !== 'ACTIVE') {
      return { error: { code: 'INVALID_PHASE', message: 'Tournament match is not active' } };
    }
    if (match.format === 'survivor') {
      const localSeat = match.survivorSeatByTournamentSeat.get(seatId);
      if (!match.survivor || localSeat === undefined || !command.survivorCommand) return { error: { code: 'INVALID_PAYLOAD', message: 'Invalid survivor command' } };
      if (command.survivorCommand.type === 'READY' || command.survivorCommand.type === 'START' || command.survivorCommand.type === 'LEAVE') {
        return { error: { code: 'INVALID_PHASE', message: 'Tournament controls the survivor lobby and leave state' } };
      }
      const survivorResult = match.survivor.processCommand(localSeat, command.survivorCommand);
      return survivorResult.success ? { error: null, survivorResult } : { error: survivorResult.error || { code: 'INVALID_PHASE', message: 'Survivor command rejected' }, survivorResult };
    }
    const localSeat = match.duelSeatByTournamentSeat.get(seatId);
    if (!match.duel || localSeat === undefined || !command.duelCommand) return { error: { code: 'INVALID_PAYLOAD', message: 'Invalid duel command' } };
    const duelValidation = validateDuelCommand(command.duelCommand);
    if (!duelValidation.valid || !duelValidation.command) return { error: duelValidation.error || { code: 'INVALID_PAYLOAD', message: 'Invalid duel command' } };
    if (duelValidation.command.type === 'READY' || duelValidation.command.type === 'START' || duelValidation.command.type === 'LEAVE') {
      return { error: { code: 'INVALID_PHASE', message: 'Tournament controls the duel lobby and leave state' } };
    }
    const duelResult = match.duel.processCommand(localSeat, duelValidation.command);
    return duelResult.success ? { error: null, duelResult } : { error: duelResult.error || { code: 'INVALID_PHASE', message: 'Duel command rejected' }, duelResult };
  }

  private processLeaveCommand(seatId: number): { error: PublicError | null; duelResult?: DuelCommandResult; survivorResult?: SurvivorCommandResult } {
    const seat = this.seats[seatId];
    if (this.phase === 'WAITING') {
      this.leaveWaitingSeat(seatId);
      return { error: null };
    }
    const match = seat.currentMatchId ? this.matchById.get(seat.currentMatchId) : undefined;
    const localSeat = match?.duelSeatByTournamentSeat.get(seatId);
    if (match?.format === 'duel' && match.duel && localSeat !== undefined && !match.duel.isFinished()) {
      const privateView = match.duel.getPrivateView(localSeat);
      const command: DuelCommand = {
        type: 'LEAVE',
        stateVersion: match.duel.getStateVersion(),
        commandSequence: privateView.lastCommandSequence + 1,
        idempotencyKey: `tournament-leave-${this.tournamentId}-${seatId}-${Date.now()}`
      };
      const duelResult = match.duel.processCommand(localSeat, command);
      return duelResult.success ? { error: null, duelResult } : { error: duelResult.error || { code: 'INVALID_PHASE', message: 'Unable to leave match' }, duelResult };
    }
    const survivorSeat = match?.survivorSeatByTournamentSeat.get(seatId);
    if (match?.format === 'survivor' && match.survivor && survivorSeat !== undefined && !match.survivor.isFinished()) {
      const privateView = match.survivor.getClientSnapshot(survivorSeat).private;
      const command: SurvivorCommand = {
        type: 'LEAVE',
        matchId: match.survivor.matchId,
        stateVersion: match.survivor.getStateVersion(),
        commandSequence: privateView.lastCommandSequence + 1,
        idempotencyKey: `tournament-leave-${this.tournamentId}-${seatId}-${Date.now()}`
      };
      const survivorResult = match.survivor.processCommand(survivorSeat, command);
      return survivorResult.success ? { error: null, survivorResult } : { error: survivorResult.error || { code: 'INVALID_PHASE', message: 'Unable to leave survivor match' }, survivorResult };
    }
    seat.eliminated = true;
    seat.forfeited = true;
    this.stateVersion++;
    this.finishIfNoActivePlayers();
    return { error: null };
  }

  private startBracket(): void {
    this.phase = 'BRACKET';
    this.stateVersion++;
    const players = this.seats.filter((seat) => seat.occupied).map((seat) => seat.seatId);
    this.createRound(players, 1);
    this.recordAudit('BRACKET_STARTED', { size: this.size });
  }

  private createRound(playerSeats: number[], roundIndex: number): void {
    const round: MatchInternal[] = [];
    for (let index = 0; index < playerSeats.length; index += 2) {
      const first = playerSeats[index] ?? null;
      const second = playerSeats[index + 1] ?? null;
      const matchId = `${this.tournamentId}_r${roundIndex}_m${round.length + 1}`;
      const match: MatchInternal = {
        matchId,
        roundIndex,
        playerSeatIds: [first, second],
        status: first !== null && second !== null ? 'PENDING' : 'BYE',
        winnerSeatId: first ?? second,
        format: this.format,
        duel: null,
        survivor: null,
        duelSeatByTournamentSeat: new Map(),
        survivorSeatByTournamentSeat: new Map(),
        result: null,
        tieBreakUsed: false
      };
      round.push(match);
      this.matchById.set(matchId, match);
      if (first !== null && second !== null) {
        if (this.format === 'survivor') {
          const survivor = new SurvivorEngine({ roomId: `${this.roomId}:${matchId}`, matchId, isPrivate: this.isPrivate, ranked: this.ranked, allowEmotes: this.allowEmotes });
          const localFirst = survivor.assignSeat(this.seats[first].nickname);
          const localSecond = survivor.assignSeat(this.seats[second].nickname);
          survivor.setOnStateChange(() => this.handleChildStateChange(match));
          match.survivor = survivor;
          if (localFirst !== null) match.survivorSeatByTournamentSeat.set(first, localFirst);
          if (localSecond !== null) match.survivorSeatByTournamentSeat.set(second, localSecond);
          match.status = survivor.startTournamentMatch() ? 'ACTIVE' : 'PENDING';
        } else {
          const duel = new DuelEngine({ roomId: `${this.roomId}:${matchId}`, matchId, isPrivate: this.isPrivate, ranked: this.ranked });
          duel.joinSeat(0, this.seats[first].nickname);
          duel.joinSeat(1, this.seats[second].nickname);
          duel.setOnStateChange(() => this.handleChildStateChange(match));
          match.duel = duel;
          match.duelSeatByTournamentSeat.set(first, 0);
          match.duelSeatByTournamentSeat.set(second, 1);
          match.status = duel.startTournamentMatch() ? 'ACTIVE' : 'PENDING';
        }
        this.seats[first].currentMatchId = matchId;
        this.seats[second].currentMatchId = matchId;
      }
    }
    this.rounds.push(round);
    this.stateVersion++;
    this.resolveByes(round);
    this.advanceIfRoundFinished(round);
  }

  private resolveByes(round: MatchInternal[]): void {
    for (const match of round) {
      if (match.status !== 'BYE' || match.winnerSeatId === null) continue;
      const winner = this.seats[match.winnerSeatId];
      winner.currentMatchId = null;
      this.recordAudit('MATCH_BYE', { matchId: match.matchId, winnerSeatId: match.winnerSeatId });
    }
  }

  private handleChildStateChange(match: MatchInternal): void {
    this.stateVersion++;
    if (match.duel?.isFinished() || match.survivor?.isFinished()) this.resolveMatch(match);
    else this.notify({ type: 'MATCH_UPDATED', matchId: match.matchId });
  }

  private resolveMatch(match: MatchInternal): void {
    if (match.status === 'COMPLETED') return;
    const duelRecord = match.duel?.getCompletedRecord();
    const survivorRecord = match.survivor?.getCompletedRecord();
    const duelResult = duelRecord?.result ?? null;
    const survivorResult = survivorRecord?.result ?? null;
    const childResult = match.format === 'survivor' ? survivorResult : duelResult;
    match.result = childResult;
    match.status = 'COMPLETED';
    let winnerSeatId: number | null = null;
    let tieBreakUsed = false;
    if (match.format === 'survivor') {
      const rankings = Array.isArray(survivorResult?.rankings) ? survivorResult.rankings : [];
      const topScore = rankings.reduce((max, entry) => Math.max(max, Number(entry.score) || 0), Number.NEGATIVE_INFINITY);
      const top = rankings.filter((entry) => Number(entry.score) === topScore && !entry.forfeited);
      if (top.length > 1) {
        winnerSeatId = this.chooseTieBreakWinner(match);
        tieBreakUsed = true;
      } else {
        const winnerLocalSeat = rankings.find((entry) => entry.rank === 1)?.seatId;
        winnerSeatId = winnerLocalSeat === undefined ? null : (match.playerSeatIds.find((seatId) => seatId !== null && match.survivorSeatByTournamentSeat.get(seatId) === winnerLocalSeat) ?? null);
      }
    } else if (duelResult?.winnerSeatId !== null && duelResult?.winnerSeatId !== undefined) {
      const localWinner = duelResult.winnerSeatId as DuelSeatId;
      winnerSeatId = match.playerSeatIds[localWinner] ?? null;
    } else if (duelResult?.reason === 'BOTH_FORFEIT') {
      winnerSeatId = null;
    } else if (match.playerSeatIds[0] !== null && match.playerSeatIds[1] !== null) {
      const score0 = duelResult?.finalScores?.[0] ?? 0;
      const score1 = duelResult?.finalScores?.[1] ?? 0;
      if (score0 === score1) {
        winnerSeatId = this.chooseTieBreakWinner(match);
        tieBreakUsed = true;
      } else {
        winnerSeatId = score0 > score1 ? match.playerSeatIds[0] : match.playerSeatIds[1];
      }
    }
    match.winnerSeatId = winnerSeatId;
    match.tieBreakUsed = tieBreakUsed;
    for (const seatId of match.playerSeatIds) {
      if (seatId === null) continue;
      const seat = this.seats[seatId];
      if (match.format === 'survivor') {
        const localSeat = match.survivorSeatByTournamentSeat.get(seatId);
        const score = survivorResult?.rankings.find((entry) => entry.seatId === localSeat)?.score;
        if (score !== undefined) seat.score = score;
      } else {
        const localSeat = match.duelSeatByTournamentSeat.get(seatId);
        if (localSeat !== undefined) seat.score = duelResult?.finalScores?.[localSeat] ?? seat.score;
      }
      seat.currentMatchId = null;
      if (seatId !== winnerSeatId) {
        seat.eliminated = true;
        seat.eliminatedRound = match.roundIndex;
        if (duelResult?.reason === 'TIMEOUT_DISCONNECT' || duelResult?.reason === 'BOTH_FORFEIT' || survivorResult?.rankings.find((entry) => entry.seatId === match.survivorSeatByTournamentSeat.get(seatId))?.forfeited) seat.forfeited = true;
        if (!this.eliminationOrder.includes(seatId)) this.eliminationOrder.push(seatId);
      }
    }
    if (match.duel) match.duel.dispose();
    if (match.survivor) match.survivor.dispose();
    this.recordAudit('MATCH_COMPLETED', {
      matchId: match.matchId,
      format: match.format,
      winnerSeatId,
      reason: duelResult?.reason,
      tieBreakUsed,
      tieBreakRule: tieBreakUsed ? TOURNAMENT_TIEBREAK_RULE : undefined
    });
    this.stateVersion++;
    this.advanceIfRoundFinished(this.rounds[match.roundIndex - 1]);
    this.notify({ type: 'MATCH_COMPLETED', matchId: match.matchId, winnerSeatId });
  }

  private advanceIfRoundFinished(round?: MatchInternal[]): void {
    if (!round || round.some((match) => match.status !== 'COMPLETED' && match.status !== 'BYE')) return;
    const winners = round.map((match) => match.winnerSeatId).filter((seatId): seatId is number => seatId !== null && !this.seats[seatId].eliminated);
    if (winners.length <= 1) {
      this.finishTournament(winners[0] ?? null);
      return;
    }
    if (this.rounds.length !== round[0]?.roundIndex) return;
    this.createRound(winners, (round[0]?.roundIndex ?? 0) + 1);
  }

  private finishIfNoActivePlayers(): void {
    const active = this.seats.filter((seat) => seat.occupied && !seat.eliminated);
    if (active.length <= 1) this.finishTournament(active[0]?.seatId ?? null);
  }

  private finishTournament(winnerSeatId: number | null): void {
    if (this.phase === 'FINISHED') return;
    this.phase = 'FINISHED';
    for (const seat of this.seats) {
      if (seat.occupied && seat.seatId !== winnerSeatId && !seat.eliminated) {
        seat.eliminated = true;
        if (!this.eliminationOrder.includes(seat.seatId)) this.eliminationOrder.push(seat.seatId);
      }
    }
    const rankingOrder = [
      ...(winnerSeatId === null ? [] : [winnerSeatId]),
      ...[...this.eliminationOrder].reverse(),
      ...this.seats.filter((seat) => seat.occupied && !this.eliminationOrder.includes(seat.seatId) && seat.seatId !== winnerSeatId).map((seat) => seat.seatId)
    ];
    const rankings: TournamentRankingEntry[] = rankingOrder.map((seatId, index) => {
      const seat = this.seats[seatId];
      return { seatId, nickname: seat.nickname, rank: index + 1, score: seat.score, eliminatedRound: seat.eliminatedRound, forfeited: seat.forfeited };
    });
    this.result = {
      resultId: `tournament_result_${crypto.randomUUID()}`,
      tournamentId: this.tournamentId,
      ruleVersion: this.ruleVersion,
      format: this.format,
      winnerSeatId,
      rankings,
      matches: [...this.matchById.values()].map((match) => ({ matchId: match.matchId, roundIndex: match.roundIndex, winnerSeatId: match.winnerSeatId, format: match.format, result: match.result, tieBreakUsed: match.tieBreakUsed })),
      auditTrail: this.auditTrail.map((event) => ({ ...event }))
    };
    this.completedAt = Date.now();
    this.stateVersion++;
    this.recordAudit('GAME_SETTLED', { winnerSeatId, resultId: this.result.resultId });
    this.result!.auditTrail = this.auditTrail.map((event) => ({ ...event }));
    this.notify({ type: 'TOURNAMENT_FINISHED', winnerSeatId });
  }

  private canStart(): boolean {
    return this.phase === 'WAITING' && this.seats.every((seat) => seat.occupied && seat.connected && seat.ready);
  }

  private getActiveClientSnapshot(seatId: number): DuelClientSnapshot | SurvivorClientSnapshot | null {
    const matchId = this.seats[seatId]?.currentMatchId;
    const match = matchId ? this.matchById.get(matchId) : undefined;
    if (!match || match.status !== 'ACTIVE') return null;
    if (match.format === 'survivor') {
      const localSeat = match.survivorSeatByTournamentSeat.get(seatId);
      if (!match.survivor || localSeat === undefined) return null;
      return match.survivor.getClientSnapshot(localSeat);
    }
    const localSeat = match.duelSeatByTournamentSeat.get(seatId);
    if (!match.duel || localSeat === undefined) return null;
    return match.duel.getClientSnapshot(localSeat);
  }

  private toSeatInfo(seat: SeatInternal): TournamentSeatInfo {
    return {
      seatId: seat.seatId,
      occupied: seat.occupied,
      nickname: seat.nickname,
      connected: seat.connected,
      ready: seat.ready,
      eliminated: seat.eliminated,
      currentMatchId: seat.currentMatchId
    };
  }

  private toMatchInfo(match: MatchInternal): TournamentMatchInfo {
    return {
      matchId: match.matchId,
      roundIndex: match.roundIndex,
      playerSeatIds: [...match.playerSeatIds] as [number | null, number | null],
      status: match.status,
      winnerSeatId: match.winnerSeatId,
      format: match.format,
      duel: match.format === 'duel' && match.duel ? match.duel.getPublicSnapshot() : null,
      survivor: match.format === 'survivor' && match.survivor ? match.survivor.getPublicSnapshot() : null,
      tieBreakUsed: match.tieBreakUsed
    };
  }

  private chooseTieBreakWinner(match: MatchInternal): number | null {
    const candidates = match.playerSeatIds.filter((seatId): seatId is number => seatId !== null && this.seats[seatId]?.occupied);
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];
    const digest = crypto.createHash('sha256')
      .update(`${this.tournamentId}:${match.matchId}:${TOURNAMENT_TIEBREAK_RULE}`)
      .digest();
    return candidates[digest[0] % candidates.length] ?? candidates[0];
  }

  private copyResult(result: TournamentResult): TournamentResult {
    return JSON.parse(JSON.stringify(result)) as TournamentResult;
  }

  private fail(idempotencyKey: string | undefined, code: PublicError['code'], message: string, seatId: number): TournamentCommandResult {
    return { success: false, idempotencyKey, stateVersion: this.stateVersion, snapshot: this.getClientSnapshot(seatId), error: { code, message } };
  }

  private sanitizeNickname(nickname: unknown, fallback: string): string {
    if (typeof nickname !== 'string') return fallback;
    const clean = Array.from(nickname.trim()).slice(0, 16).join('');
    return clean || fallback;
  }

  private hashPayload(payload: unknown): string {
    return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  }

  private recordAudit(type: string, details: Record<string, unknown>): void {
    const event = createAuditEvent({
      seq: this.auditTrail.length + 1,
      timestamp: Date.now(),
      type,
      payload: details,
      previousHash: this.auditTrail[this.auditTrail.length - 1]?.hash || GENESIS_PREVIOUS_HASH
    });
    this.auditTrail.push(event);
  }

  private notify(event?: any): void {
    if (this.onStateChangeHandler) this.onStateChangeHandler(event);
  }
}
