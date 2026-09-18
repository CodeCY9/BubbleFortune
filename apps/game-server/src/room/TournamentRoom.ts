import http from 'node:http';
import crypto from 'node:crypto';
import { Room, Client } from '@colyseus/core';
import { TournamentEngine } from '../engine/TournamentEngine';
import {
  TOURNAMENT_SIZES,
  TOURNAMENT_FORMATS,
  TournamentCommandResult,
  TournamentFormat,
  TournamentSize
} from '../../../../packages/protocol/src/tournament';
import { DatabaseManager } from '../persistence/db';
import { OutboxManager } from '../persistence/outbox';
import { parseCookies } from '../http/cookies';
import { getClientIp, hashDeviceFingerprint, hashRiskFingerprint, isRequestOriginAllowed } from '../http/security';
import { normalizeRoomThemeId, type RoomThemeId } from '../../../../packages/protocol/src/theme';

interface SeatBinding {
  seatId: number;
  guestId: string;
  sessionId: string;
  tokenHash: string;
}

interface SpectatorBinding {
  sessionId: string;
  nickname: string;
}

export class TournamentRoom extends Room {
  public maxClients = 36;
  private engine!: TournamentEngine;
  private persistence?: DatabaseManager;
  private outbox?: OutboxManager;
  private allowedOrigins?: Set<string>;
  private readonly seatBindings = new Map<number, SeatBinding>();
  private readonly clientSeatMap = new Map<string, number>();
  private readonly guestBySession = new Map<string, string>();
  private readonly spectators = new Map<string, SpectatorBinding>();
  private allowSpectators = true;
  private settlementEnqueued = false;
  private passwordHash: string | null = null;
  private isPrivateRoom = false;
  private ranked = true;
  private allowEmotes = true;
  private themeId: RoomThemeId = 'classic';

  onCreate(options: any) {
    this.persistence = options?.persistence;
    this.outbox = options?.outbox;
    this.allowedOrigins = options?.allowedOrigins instanceof Set ? options.allowedOrigins : undefined;
    const requestedSize = Number(options?.size);
    const size = (TOURNAMENT_SIZES as readonly number[]).includes(requestedSize) ? requestedSize as TournamentSize : 8;
    const format = (TOURNAMENT_FORMATS as readonly string[]).includes(options?.format) ? options.format as TournamentFormat : 'duel';
    const password = typeof options?.password === 'string' ? options.password.trim() : '';
    if (password.length > 64) throw new Error('Room password is too long');
    if (password.length > 0 && password.length < 4) throw new Error('Tournament room passwords require at least 4 characters');
    this.passwordHash = password ? crypto.createHash('sha256').update(password).digest('hex') : null;
    this.isPrivateRoom = Boolean(options?.isPrivate) || Boolean(this.passwordHash);
    this.ranked = !this.isPrivateRoom && options?.ranked !== false;
    this.allowEmotes = options?.allowEmotes !== false;
    this.themeId = normalizeRoomThemeId(options?.themeId);
    this.setPrivate(this.isPrivateRoom);
    this.allowSpectators = options?.allowSpectators !== false;
    this.setMetadata({ size, format, allowSpectators: this.allowSpectators, allowEmotes: this.allowEmotes, isPrivate: this.isPrivateRoom, ranked: this.ranked, passwordRequired: Boolean(this.passwordHash), themeId: this.themeId });
    void this.persistence?.recordAnalyticsEvent({
      eventName: 'room_created',
      mode: 'tournament_26',
      matchId: this.roomId,
      metadata: { ranked: this.ranked, isPrivate: this.isPrivateRoom, size, format },
      dedupeKey: `room_created:tournament_26:${this.roomId}`
    }).catch(() => {});
    this.engine = new TournamentEngine({ roomId: this.roomId, size, format, isPrivate: this.isPrivateRoom, ranked: this.ranked, allowEmotes: this.allowEmotes });
    this.engine.setOnStateChange((event?: any) => {
      this.broadcastSnapshots();
      if (event?.type === 'BRACKET_STARTED') {
        for (const binding of this.seatBindings.values()) {
          void this.persistence?.recordAnalyticsEvent({
            eventName: 'match_started',
            mode: 'tournament_26',
            guestId: binding.guestId,
            matchId: this.engine.tournamentId,
            metadata: { ranked: this.ranked, isPrivate: this.isPrivateRoom },
            dedupeKey: `match_started:tournament_26:${this.engine.tournamentId}:${binding.guestId}`
          }).catch(() => {});
        }
      }
      this.persistIfFinished();
    });

    this.onMessage('request_snapshot', (client) => {
      if (this.spectators.has(client.sessionId)) {
        client.send('snapshot', { public: this.decoratePublicSnapshot(this.engine.getPublicSnapshot()) });
        return;
      }
      const seatId = this.clientSeatMap.get(client.sessionId);
      if (seatId === undefined) return;
      client.send('snapshot', this.decorateSnapshot(this.engine.getClientSnapshot(seatId)));
    });

    this.onMessage('ping', (client, payload) => {
      const sentAt = payload && typeof payload === 'object' && Number.isFinite((payload as any).sentAt)
        ? Number((payload as any).sentAt)
        : Number(payload);
      client.send('pong', { sentAt: Number.isFinite(sentAt) ? sentAt : Date.now(), serverAt: Date.now() });
    });

    this.onMessage('command', (client, raw) => {
      const seatId = this.clientSeatMap.get(client.sessionId);
      const idempotencyKey = raw && typeof raw === 'object' && typeof (raw as any).idempotencyKey === 'string'
        ? (raw as any).idempotencyKey : undefined;
      if (seatId === undefined || this.seatBindings.get(seatId)?.sessionId !== client.sessionId) {
        client.send('command_result', {
          success: false,
          idempotencyKey,
          stateVersion: this.engine.getStateVersion(),
          error: { code: 'UNAUTHORIZED', message: 'Unauthorized client' }
        } as TournamentCommandResult);
        return;
      }
      try {
        const result = this.engine.processCommand(seatId, raw);
        if (result.snapshot) {
          result.snapshot = this.decorateSnapshot(result.snapshot);
        }
        client.send('command_result', result);
        this.broadcastSnapshots();
        if (result.success && raw && typeof raw === 'object' && (raw as any).type === 'LEAVE') {
          try { client.leave(1000); } catch { /* room may already be closing */ }
        }
      } catch {
        client.send('command_result', {
          success: false,
          idempotencyKey,
          stateVersion: this.engine.getStateVersion(),
          snapshot: this.decorateSnapshot(this.engine.getClientSnapshot(seatId)),
          error: { code: 'INTERNAL_ERROR', message: 'Internal server error' }
        } as TournamentCommandResult);
      }
    });
  }

  public verifyClientUpgrade(req: http.IncomingMessage, allowedOrigins: Set<string>): boolean {
    const origin = req.headers.origin;
    return !origin || isRequestOriginAllowed(origin, req, allowedOrigins);
  }

  async onAuth(client: Client, options: any, context?: any) {
    const origin = context?.headers?.origin || context?.req?.headers?.origin;
    const req = context?.req || { headers: { host: (context?.headers?.host as string) || '' } };
    if (origin && this.allowedOrigins && !isRequestOriginAllowed(origin, req as any, this.allowedOrigins)) throw new Error('Invalid Origin');

    if (this.passwordHash) {
      const suppliedPassword = typeof options?.password === 'string' ? options.password.trim() : '';
      const suppliedHash = crypto.createHash('sha256').update(suppliedPassword).digest('hex');
      if (!crypto.timingSafeEqual(Buffer.from(suppliedHash, 'hex'), Buffer.from(this.passwordHash, 'hex'))) {
        throw new Error('Invalid room password');
      }
    }

    if (Boolean(options?.isSpectator || options?.spectator)) {
      if (!this.allowSpectators || this.spectators.size >= 4) throw new Error('Spectator slots are full');
      return { isSpectator: true, nickname: this.sanitizeNickname(options?.nickname, `观战者${this.spectators.size + 1}`) };
    }

    const cookieHeader = context?.headers?.cookie || context?.req?.headers?.cookie;
    const rawToken = parseCookies(cookieHeader)['bf_guest'];
    if (!rawToken || !/^[0-9a-f]{64}$/.test(rawToken)) throw new Error('Authentication required');
    if (!this.persistence) throw new Error('Database service is required');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    if (!await this.persistence.isTournamentHealthy()) throw new Error('Tournament persistence service unhealthy');
    const guest = await this.persistence.getGuestByTokenHash(tokenHash);
    if (!guest) throw new Error('Invalid guest session');
    if (await this.persistence.isGuestBanned(guest.id)) throw new Error('Guest is banned');
    if (this.engine.getPhase() !== 'WAITING') throw new Error('Tournament has already started');
    if (this.seatBindings.size >= this.engine.size) throw new Error('Tournament is full');
    if ([...this.seatBindings.values()].some((binding) => binding.guestId === guest.id)) throw new Error('Guest already joined');
    const request = context?.req as http.IncomingMessage | undefined;
    if (request) {
      try {
        await this.persistence.recordGuestRiskSignal({
          guestId: guest.id,
          ipFingerprint: hashRiskFingerprint(getClientIp(request)),
          deviceFingerprint: hashDeviceFingerprint(request)
        });
      } catch {
        // 风险遥测失败不阻塞合法入房。
      }
    }
    return { guestId: guest.id, tokenHash, nickname: this.sanitizeNickname(options?.nickname, '玩家') };
  }

  onJoin(client: Client, options: any, auth: any) {
    if (auth?.isSpectator) {
      this.spectators.set(client.sessionId, { sessionId: client.sessionId, nickname: auth.nickname });
      client.send('snapshot', { public: this.decoratePublicSnapshot(this.engine.getPublicSnapshot()) });
      return;
    }
    const seatId = this.engine.assignSeat(auth?.nickname);
    if (seatId === null) throw new Error('Tournament is full');
    this.seatBindings.set(seatId, { seatId, guestId: auth.guestId, sessionId: client.sessionId, tokenHash: auth.tokenHash });
    this.clientSeatMap.set(client.sessionId, seatId);
    this.guestBySession.set(client.sessionId, auth.guestId);
    client.send('ready', { tournamentId: this.engine.tournamentId, roomId: this.roomId, seatId, size: this.engine.size });
    client.send('snapshot', this.decorateSnapshot(this.engine.getClientSnapshot(seatId)));
  }

  async onLeave(client: Client, consented: boolean) {
    if (this.spectators.delete(client.sessionId)) return;
    const seatId = this.clientSeatMap.get(client.sessionId);
    if (seatId === undefined) return;
    const previousSessionId = client.sessionId;
    this.clientSeatMap.delete(previousSessionId);
    if (consented) {
      if (this.engine.getPhase() === 'WAITING') {
        this.engine.leaveWaitingSeat(seatId);
        this.seatBindings.delete(seatId);
      } else {
        this.engine.setConnected(seatId, false);
      }
      this.broadcastSnapshots();
      return;
    }

    this.engine.setConnected(seatId, false);
    try {
      const reconnected = await this.allowReconnection(client, 120);
      const binding = this.seatBindings.get(seatId);
      if (!binding || binding.sessionId !== previousSessionId) {
        try { reconnected.leave(1000); } catch { /* ignore */ }
        return;
      }
      binding.sessionId = reconnected.sessionId;
      this.clientSeatMap.set(reconnected.sessionId, seatId);
      this.guestBySession.delete(previousSessionId);
      this.guestBySession.set(reconnected.sessionId, binding.guestId);
      this.engine.setConnected(seatId, true);
      reconnected.send('snapshot', this.decorateSnapshot(this.engine.getClientSnapshot(seatId)));
    } catch {
      if (this.engine.getPhase() === 'WAITING') {
        const binding = this.seatBindings.get(seatId);
        if (!binding || binding.sessionId === previousSessionId) {
          this.engine.leaveWaitingSeat(seatId);
          this.seatBindings.delete(seatId);
        }
      }
      this.broadcastSnapshots();
    }
  }

  onDispose() {
    this.persistIfFinished();
    this.engine?.dispose();
  }

  private persistIfFinished() {
    if (this.settlementEnqueued || !this.persistence || !this.outbox || !this.engine.isFinished()) return;
    const record = this.engine.getCompletedRecord();
    if (!record) return;
    record.isPrivate = this.isPrivateRoom;
    record.ranked = this.ranked;
    const participantGuestIds = [...this.seatBindings.values()].map((binding) => binding.guestId);
    if (participantGuestIds.length < 2) return;
    record.seats = record.seats.map((seat) => ({ ...seat, guestId: this.seatBindings.get(seat.seatId)?.guestId }));
    try {
      this.outbox.enqueueWithRetry({
        kind: 'tournament',
        resultId: record.resultId,
        tournamentId: record.tournamentId,
        participantGuestIds,
        completedAt: record.completedAt,
        ruleVersion: record.ruleVersion,
        record
      });
      this.settlementEnqueued = true;
    } catch (error) {
      console.error('[TournamentRoom] Failed to enqueue completed tournament:', error);
    }
  }

  private broadcastSnapshots() {
    for (const [seatId, binding] of this.seatBindings) {
      const client = this.findClient(binding.sessionId);
      if (client) client.send('snapshot', this.decorateSnapshot(this.engine.getClientSnapshot(seatId)));
    }
    const publicSnapshot = { public: this.decoratePublicSnapshot(this.engine.getPublicSnapshot()) };
    for (const binding of this.spectators) {
      const client = this.findClient(binding[1].sessionId);
      if (client) client.send('snapshot', publicSnapshot);
    }
  }

  private decorateSnapshot(snapshot: any): any {
    return { ...snapshot, public: { ...snapshot.public, themeId: this.themeId } };
  }

  private decoratePublicSnapshot(snapshot: any): any {
    return { ...snapshot, themeId: this.themeId };
  }

  private findClient(sessionId: string): Client | undefined {
    for (const client of this.clients) if (client.sessionId === sessionId) return client;
    return undefined;
  }

  private sanitizeNickname(value: unknown, fallback: string): string {
    if (typeof value !== 'string') return fallback;
    const clean = Array.from(value.trim()).slice(0, 16).join('');
    return clean || fallback;
  }
}
