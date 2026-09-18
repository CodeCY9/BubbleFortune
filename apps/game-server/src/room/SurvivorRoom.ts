import crypto from 'node:crypto';
import http from 'node:http';
import { Room, Client } from '@colyseus/core';
import { SurvivorEngine } from '../engine/SurvivorEngine';
import { DatabaseManager } from '../persistence/db';
import { OutboxManager } from '../persistence/outbox';
import { parseCookies } from '../http/cookies';
import { getClientIp, hashDeviceFingerprint, hashRiskFingerprint } from '../http/security';
import { SURVIVOR_MAX_SPECTATORS, SURVIVOR_RULE_VERSION } from '../../../../packages/protocol/src/survivor';
import { normalizeRoomThemeId, type RoomThemeId } from '../../../../packages/protocol/src/theme';

export class SurvivorRoom extends Room {
  public maxClients = 6 + SURVIVOR_MAX_SPECTATORS;
  private engine!: SurvivorEngine;
  private persistence?: DatabaseManager;
  private outbox?: OutboxManager;
  private clientsBySeat = new Map<number, Client>();
  private seatBySession = new Map<string, number>();
  private guestBySeat = new Map<number, string>();
  private guestBySession = new Map<string, string>();
  private spectators = new Map<string, { nickname: string }>();
  private settled = false;
  private passwordHash: string | null = null;
  private allowSpectators = true;
  private allowEmotes = true;
  private isPrivateRoom = false;
  private ranked = true;
  private themeId: RoomThemeId = 'classic';

  onCreate(options: any) {
    const password = typeof options?.password === 'string' ? options.password.trim() : '';
    if (password.length > 64) throw new Error('Room password is too long');
    if (password.length > 0 && password.length < 4) throw new Error('Survivor room passwords require at least 4 characters');
    this.passwordHash = password ? crypto.createHash('sha256').update(password).digest('hex') : null;
    this.isPrivateRoom = Boolean(options?.isPrivate) || Boolean(this.passwordHash);
    this.ranked = !this.isPrivateRoom && options?.ranked !== false;
    this.themeId = normalizeRoomThemeId(options?.themeId);
    this.allowSpectators = options?.allowSpectators !== false;
    this.allowEmotes = options?.allowEmotes !== false;
    this.setPrivate(this.isPrivateRoom);
    this.setMetadata({ mode: 'survivor_26', maxPlayers: 6, allowSpectators: this.allowSpectators, allowEmotes: this.allowEmotes, isPrivate: this.isPrivateRoom, ranked: this.ranked, passwordRequired: Boolean(this.passwordHash), themeId: this.themeId });
    this.persistence = options?.persistence;
    this.outbox = options?.outbox;
    void this.persistence?.recordAnalyticsEvent({
      eventName: 'room_created',
      mode: 'survivor_26',
      matchId: this.roomId,
      metadata: { ranked: this.ranked, isPrivate: this.isPrivateRoom },
      dedupeKey: `room_created:survivor_26:${this.roomId}`
    }).catch(() => {});
    this.engine = new SurvivorEngine({ roomId: this.roomId, allowEmotes: this.allowEmotes, isPrivate: this.isPrivateRoom, ranked: this.ranked });
    this.engine.setOnStateChange((event?: any) => {
      this.broadcastSnapshots();
      if (event?.type === 'MATCH_STARTED') {
        for (const guestId of this.guestBySeat.values()) {
          void this.persistence?.recordAnalyticsEvent({
            eventName: 'match_started',
            mode: 'survivor_26',
            guestId,
            matchId: this.engine.matchId,
            metadata: { ranked: this.ranked, isPrivate: this.isPrivateRoom },
            dedupeKey: `match_started:survivor_26:${this.engine.matchId}:${guestId}`
          }).catch(() => {});
        }
      }
    });
    this.onMessage('request_snapshot', (client) => {
      if (this.spectators.has(client.sessionId)) {
        client.send('snapshot', this.decorateSnapshot(this.engine.getClientSnapshot(null)));
        return;
      }
      const seatId = this.seatBySession.get(client.sessionId);
      client.send('snapshot', this.decorateSnapshot(this.engine.getClientSnapshot(seatId ?? null)));
    });
    this.onMessage('ping', (client, payload) => {
      const sentAt = payload && typeof payload === 'object' && Number.isFinite((payload as any).sentAt)
        ? Number((payload as any).sentAt)
        : Number(payload);
      client.send('pong', { sentAt: Number.isFinite(sentAt) ? sentAt : Date.now(), serverAt: Date.now() });
    });
    this.onMessage('command', (client, raw) => {
      if (this.spectators.has(client.sessionId)) {
        client.send('command_result', {
          success: false,
          idempotencyKey: raw && typeof raw === 'object' ? (raw as any).idempotencyKey : undefined,
          stateVersion: this.engine.getStateVersion(),
          snapshot: this.decorateSnapshot(this.engine.getClientSnapshot(null)),
          error: { code: 'UNAUTHORIZED', message: '观战者不能发送游戏命令' }
        });
        return;
      }
      const seatId = this.seatBySession.get(client.sessionId);
      if (seatId === undefined) return;
      const result = this.engine.processCommand(seatId, raw);
      if (result.snapshot) {
        result.snapshot = this.decorateSnapshot(result.snapshot);
      }
      client.send('command_result', result);
      this.broadcastSnapshots();
      this.persistIfFinished();
    });
  }

  async onAuth(client: Client, options: any, context?: any) {
    if (this.passwordHash) {
      const suppliedPassword = typeof options?.password === 'string' ? options.password.trim() : '';
      const suppliedHash = crypto.createHash('sha256').update(suppliedPassword).digest('hex');
      if (!crypto.timingSafeEqual(Buffer.from(suppliedHash, 'hex'), Buffer.from(this.passwordHash, 'hex'))) {
        throw new Error('Invalid room password');
      }
    }
    if (options?.spectator || options?.isSpectator) {
      if (!this.allowSpectators || this.spectators.size >= SURVIVOR_MAX_SPECTATORS) throw new Error('Spectator slots are full');
      return {
        isSpectator: true,
        nickname: typeof options?.nickname === 'string' && options.nickname.trim()
          ? options.nickname.trim().slice(0, 16)
          : `观战者${this.spectators.size + 1}`
      };
    }
    if (!this.persistence) throw new Error('Database service is required');
    const cookieHeader = context?.headers?.cookie || context?.req?.headers?.cookie;
    const rawToken = parseCookies(cookieHeader)['bf_guest'];
    if (!rawToken || !/^[0-9a-f]{64}$/.test(rawToken)) throw new Error('Authentication required');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const guest = await this.persistence.getGuestByTokenHash(tokenHash);
    if (!guest) throw new Error('Invalid guest session');
    if (await this.persistence.isGuestBanned(guest.id)) throw new Error('Guest is banned');
    this.guestBySession.set(client.sessionId, guest.id);
    const request = context?.req as http.IncomingMessage | undefined;
    if (request) {
      try {
        await this.persistence.recordGuestRiskSignal({
          guestId: guest.id,
          ipFingerprint: hashRiskFingerprint(getClientIp(request)),
          deviceFingerprint: hashDeviceFingerprint(request)
        });
      } catch {
        // Risk telemetry must not block a valid room join.
      }
    }
    return { guestId: guest.id, tokenHash };
  }

  onJoin(client: Client, options: any, auth?: any) {
    if (auth?.isSpectator || options?.spectator || options?.isSpectator) {
      this.spectators.set(client.sessionId, { nickname: auth?.nickname || '观战者' });
      this.engine.setSpectatorCount(this.spectators.size);
      client.send('ready', { matchId: this.engine.matchId, seatId: null, isSpectator: true });
      client.send('snapshot', this.decorateSnapshot(this.engine.getClientSnapshot(null)));
      return;
    }
    const seatId = this.engine.assignSeat(options?.nickname || `玩家${this.clientsBySeat.size + 1}`);
    if (seatId === null) throw new Error('Room is full');
    this.clientsBySeat.set(seatId, client);
    this.seatBySession.set(client.sessionId, seatId);
    const guestId = this.guestBySession.get(client.sessionId) || auth?.guestId;
    if (guestId) this.guestBySeat.set(seatId, guestId);
    client.send('ready', { matchId: this.engine.matchId, seatId });
    client.send('snapshot', this.decorateSnapshot(this.engine.getClientSnapshot(seatId)));
  }

  async onLeave(client: Client, consented: boolean) {
    if (this.spectators.has(client.sessionId)) {
      this.spectators.delete(client.sessionId);
      this.engine.setSpectatorCount(this.spectators.size);
      return;
    }
    const seatId = this.seatBySession.get(client.sessionId);
    if (seatId === undefined) return;
    if (consented) {
      this.seatBySession.delete(client.sessionId);
      this.clientsBySeat.delete(seatId);
      this.guestBySession.delete(client.sessionId);
      if (this.engine.getPhase() === 'WAITING') {
        this.engine.releaseWaitingSeat(seatId);
        this.guestBySeat.delete(seatId);
      } else {
        this.engine.forfeitPlayer(seatId);
      }
      this.broadcastSnapshots();
      this.persistIfFinished();
      this.disconnectIfEmpty();
      return;
    }
    this.engine.handleDisconnect(seatId);
    try {
      const oldSessionId = client.sessionId;
      const reconnectedClient = await this.allowReconnection(client, 120);
      const bindingGuestId = this.guestBySeat.get(seatId);
      this.seatBySession.delete(oldSessionId);
      this.guestBySession.delete(oldSessionId);
      this.seatBySession.set(reconnectedClient.sessionId, seatId);
      if (bindingGuestId) this.guestBySession.set(reconnectedClient.sessionId, bindingGuestId);
      this.clientsBySeat.set(seatId, reconnectedClient);
      if (!this.engine.handleReconnect(seatId)) {
        this.seatBySession.delete(reconnectedClient.sessionId);
        this.guestBySession.delete(reconnectedClient.sessionId);
        this.clientsBySeat.delete(seatId);
        reconnectedClient.leave(4003, 'Seat is no longer available');
        return;
      }
      reconnectedClient.send('ready', { matchId: this.engine.matchId, seatId, stateVersion: this.engine.getStateVersion() });
      reconnectedClient.send('snapshot', this.decorateSnapshot(this.engine.getClientSnapshot(seatId)));
      this.broadcastSnapshots();
    } catch {
      this.seatBySession.delete(client.sessionId);
      this.guestBySession.delete(client.sessionId);
      this.clientsBySeat.delete(seatId);
      if (this.engine.getPhase() === 'WAITING') {
        this.engine.releaseWaitingSeat(seatId);
        this.guestBySeat.delete(seatId);
      } else {
        this.engine.forfeitPlayer(seatId);
      }
      this.persistIfFinished();
      this.disconnectIfEmpty();
    }
  }

  onDispose() {
    this.persistIfFinished();
    this.engine?.dispose();
  }

  private broadcastSnapshots() {
    for (const [seatId, client] of this.clientsBySeat) {
      if (client) client.send('snapshot', this.decorateSnapshot(this.engine.getClientSnapshot(seatId)));
    }
    for (const client of this.clients) {
      if (this.spectators.has(client.sessionId)) client.send('snapshot', this.decorateSnapshot(this.engine.getClientSnapshot(null)));
    }
  }

  private decorateSnapshot(snapshot: any): any {
    return { ...snapshot, public: { ...snapshot.public, themeId: this.themeId } };
  }

  private persistIfFinished() {
    if (this.settled || !this.engine.isFinished() || !this.persistence || !this.outbox) return;
    const record = this.engine.getCompletedRecord();
    if (!record) return;
    record.isPrivate = this.isPrivateRoom;
    record.ranked = this.ranked;
    const participantGuestIds = [...this.guestBySeat.values()];
    if (participantGuestIds.length < 2) return;
    record.seats = record.seats.map((seat) => ({ ...seat, guestId: this.guestBySeat.get(seat.seatId) }));
    this.outbox.enqueueWithRetry({
      kind: 'survivor',
      resultId: record.resultId,
      matchId: record.matchId,
      participantGuestIds,
      completedAt: record.completedAt,
      ruleVersion: SURVIVOR_RULE_VERSION,
      record
    });
    this.settled = true;
  }

  private disconnectIfEmpty() {
    if ([...this.clientsBySeat.values()].every((client) => !client) && this.spectators.size === 0) this.disconnect();
  }
}
