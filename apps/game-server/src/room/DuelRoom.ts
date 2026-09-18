import http from 'node:http';
import crypto from 'node:crypto';
import { Room, Client } from '@colyseus/core';
import { DuelEngine } from '../engine/DuelEngine';
import {
  DUEL_TIMEOUT_SECONDS,
  DuelCommandResult,
  DuelSeatId
} from '../../../../packages/protocol/src/duel';
import { DatabaseManager } from '../persistence/db';
import { OutboxManager } from '../persistence/outbox';
import { parseCookies } from '../http/cookies';
import { getClientIp, hashDeviceFingerprint, hashRiskFingerprint } from '../http/security';
import { normalizeRoomThemeId, type RoomThemeId } from '../../../../packages/protocol/src/theme';

interface SeatBinding {
  seatId: DuelSeatId;
  guestId: string;
  sessionId: string;
  tokenHash: string;
  nickname: string;
}

export class DuelRoom extends Room {
  public maxClients = 2;
  private engine!: DuelEngine;
  private persistence?: DatabaseManager;
  private outbox?: OutboxManager;
  private allowedOrigins?: Set<string>;
  private settlementEnqueued = false;
  private passwordHash: string | null = null;
  private ranked = true;
  private isPrivateRoom = false;
  private publicListing = true;
  private themeId: RoomThemeId = 'classic';
  private showOfferHistory = true;

  private readonly seatBindings = new Map<DuelSeatId, SeatBinding>();
  private readonly clientSeatMap = new Map<string, DuelSeatId>();
  private messageTimestamps = new Map<string, number[]>();
  private static readonly RATE_LIMIT_MAX_PER_SEC = 100;

  onCreate(options: any) {
    const password = typeof options?.password === 'string' ? options.password.trim() : '';
    if (password.length > 64) throw new Error('Room password is too long');
    if (password.length > 0 && password.length < 4) {
      throw new Error('Duel room passwords require at least 4 characters');
    }
    if (options?.isPrivate === true && password.length === 0) {
      throw new Error('Private duel rooms require a password of at least 4 characters');
    }
    this.passwordHash = password
      ? crypto.createHash('sha256').update(password).digest('hex')
      : null;
    this.isPrivateRoom = Boolean(options?.isPrivate) || Boolean(this.passwordHash);
    this.ranked = !this.isPrivateRoom && options?.ranked !== false;
    // Public rooms are discoverable through the safe lobby endpoint. Password
    // rooms and explicitly unlisted rooms remain hidden from matchmaker lists.
    this.publicListing = !this.isPrivateRoom && options?.publicListing !== false;
    this.themeId = normalizeRoomThemeId(options?.themeId);
    this.showOfferHistory = options?.showOfferHistory !== false;
    this.setPrivate(!this.publicListing);
    this.setMetadata({
      isPrivate: this.isPrivateRoom,
      ranked: this.ranked,
      publicListing: this.publicListing,
      passwordRequired: Boolean(this.passwordHash),
      themeId: this.themeId,
      showOfferHistory: this.showOfferHistory
    });

    if (options && typeof options === 'object') {
      const forbidden = ['customBoxAmountMap', 'seed', 'boxAmountMap', 'ev', 'values', 'amounts'];
      for (const k of forbidden) {
        if (k in options) {
          throw new Error('Custom game configuration is not permitted via network');
        }
      }
    }

    this.persistence = options?.persistence;
    this.outbox = options?.outbox;
    void this.persistence?.recordAnalyticsEvent({
      eventName: 'room_created',
      mode: 'duel_26',
      matchId: this.roomId,
      metadata: { ranked: this.ranked, isPrivate: this.isPrivateRoom },
      dedupeKey: `room_created:duel_26:${this.roomId}`
    }).catch(() => {});
    if (options?.allowedOrigins && options.allowedOrigins instanceof Set) {
      this.allowedOrigins = options.allowedOrigins;
    }

    this.engine = new DuelEngine({
      roomId: this.roomId,
      isPrivate: this.isPrivateRoom,
      ranked: this.ranked
    });

    // Single unified state change listener to avoid redundant duplicate broadcasts
    this.engine.setOnStateChange((event?: any) => {
      if (event?.type === 'PLAYER_LEFT_LOBBY' && typeof event.seatId === 'number') {
        const seatId = event.seatId as DuelSeatId;
        this.seatBindings.delete(seatId);
        for (const [sid, s] of Array.from(this.clientSeatMap.entries())) {
          if (s === seatId) {
            this.clientSeatMap.delete(sid);
          }
        }
        if (this.seatBindings.size === 0) {
          this.disconnect();
        }
      }
      this.broadcastSnapshots();
      if (event?.type === 'ROUND_STARTED') {
        for (const binding of this.seatBindings.values()) {
          void this.persistence?.recordAnalyticsEvent({
            eventName: 'match_started',
            mode: 'duel_26',
            guestId: binding.guestId,
            matchId: this.roomId,
            metadata: { ranked: this.ranked, isPrivate: this.isPrivateRoom },
            dedupeKey: `match_started:duel_26:${this.roomId}:${binding.guestId}`
          }).catch(() => {});
        }
      }
      if (this.engine.isFinished()) {
        this.handleMatchSettled();
      }
    });

    this.onMessage('request_snapshot', (client) => {
      const seatId = this.clientSeatMap.get(client.sessionId);
      const binding = seatId !== undefined ? this.seatBindings.get(seatId) : undefined;
      if (seatId === undefined || !binding || binding.sessionId !== client.sessionId) {
        client.send('error', { code: 'UNAUTHORIZED', message: 'Unauthorized client' });
        return;
      }
      if (!this.checkRateLimit(client)) {
        return;
      }
      client.send('snapshot', this.decorateSnapshot(this.engine.getClientSnapshot(seatId)));
    });

    this.onMessage('ping', (client, payload) => {
      const sentAt = payload && typeof payload === 'object' && Number.isFinite((payload as any).sentAt)
        ? Number((payload as any).sentAt)
        : Number(payload);
      client.send('pong', { sentAt: Number.isFinite(sentAt) ? sentAt : Date.now(), serverAt: Date.now() });
    });

    this.onMessage('command', (client, rawPayload) => {
      const seatId = this.clientSeatMap.get(client.sessionId);
      const binding = seatId !== undefined ? this.seatBindings.get(seatId) : undefined;
      const idempotencyKey =
        rawPayload &&
        typeof rawPayload === 'object' &&
        !Array.isArray(rawPayload) &&
        typeof (rawPayload as any).idempotencyKey === 'string' &&
        (rawPayload as any).idempotencyKey.length <= 128
          ? (rawPayload as any).idempotencyKey
          : undefined;

      try {
        if (seatId === undefined || !binding || binding.sessionId !== client.sessionId) {
          client.send('command_result', {
            success: false,
            idempotencyKey,
            stateVersion: this.engine.getStateVersion(),
            error: { code: 'UNAUTHORIZED', message: 'Unauthorized client' }
          } as DuelCommandResult);
          return;
        }

        if (!this.checkRateLimit(client)) {
          client.send('command_result', {
            success: false,
            idempotencyKey,
            stateVersion: this.engine.getStateVersion(),
            snapshot: this.decorateSnapshot(this.engine.getClientSnapshot(seatId)),
            error: { code: 'RATE_LIMITED', message: 'Too many requests' }
          } as DuelCommandResult);
          return;
        }

        const isLeave =
          rawPayload &&
          typeof rawPayload === 'object' &&
          (rawPayload as any).type === 'LEAVE';

        const result = this.engine.processCommand(seatId, rawPayload);
        if (result.snapshot) {
          result.snapshot = this.decorateSnapshot(result.snapshot);
        }
        client.send('command_result', result);

        if (result.success) {
          if (this.engine.getPhase() !== 'WAITING') {
            this.lock();
          }
          if (isLeave) {
            try {
              client.leave(1000);
            } catch {
              // ignore
            }
          }
        }

        if (this.engine.isFinished()) {
          this.handleMatchSettled();
        }
      } catch (err: any) {
        client.send('command_result', {
          success: false,
          idempotencyKey,
          stateVersion: this.engine.getStateVersion(),
          snapshot: seatId !== undefined ? this.decorateSnapshot(this.engine.getClientSnapshot(seatId)) : undefined,
          error: { code: 'INTERNAL_ERROR', message: 'Internal server error' }
        } as DuelCommandResult);
      }
    });
  }

  public verifyClientUpgrade(req: http.IncomingMessage, allowedOrigins: Set<string>): boolean {
    const origin = req.headers.origin;
    if (origin && !allowedOrigins.has(origin)) {
      return false;
    }

    const cookieHeader = req.headers.cookie;
    const cookies = parseCookies(cookieHeader);
    const rawToken = cookies['bf_guest'];
    if (!rawToken || !/^[0-9a-f]{64}$/.test(rawToken)) {
      return false;
    }

    const hostHeader = req.headers.host || '127.0.0.1';
    const parsedURL = new URL(req.url || '', `http://${hostHeader}`);
    const sessionId = parsedURL.searchParams.get('sessionId');

    // For any bound session, verify token hash against the bound session
    if (sessionId) {
      const binding = Array.from(this.seatBindings.values()).find(
        (b) => b.sessionId === sessionId
      );
      if (binding) {
        const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
        if (binding.tokenHash !== tokenHash) {
          return false;
        }
      }
    }

    return true;
  }

  private broadcastSnapshots(): void {
    for (const client of this.clients) {
      const seatId = this.clientSeatMap.get(client.sessionId);
      if (seatId !== undefined) {
        client.send('snapshot', this.decorateSnapshot(this.engine.getClientSnapshot(seatId)));
      }
    }
  }

  private checkRateLimit(client: Client): boolean {
    const now = Date.now();
    let timestamps = this.messageTimestamps.get(client.sessionId) || [];
    timestamps = timestamps.filter((t) => now - t < 1000);
    if (timestamps.length >= DuelRoom.RATE_LIMIT_MAX_PER_SEC) {
      client.send('error', { code: 'RATE_LIMITED', message: 'Too many requests' });
      return false;
    }
    timestamps.push(now);
    this.messageTimestamps.set(client.sessionId, timestamps);
    return true;
  }

  async onAuth(client: Client, options: any, context?: any) {
    // 1. Origin check
    const origin = context?.headers?.origin || context?.req?.headers?.origin;
    if (origin && this.allowedOrigins && !this.allowedOrigins.has(origin)) {
      throw new Error('Invalid Origin');
    }

    if (this.passwordHash) {
      const suppliedPassword = typeof options?.password === 'string' ? options.password.trim() : '';
      const suppliedHash = crypto.createHash('sha256').update(suppliedPassword).digest('hex');
      if (!crypto.timingSafeEqual(Buffer.from(suppliedHash, 'hex'), Buffer.from(this.passwordHash, 'hex'))) {
        throw new Error('Invalid room password');
      }
    }

    // 2. Cookie validation
    const cookieHeader = context?.headers?.cookie || context?.req?.headers?.cookie;
    const cookies = parseCookies(cookieHeader);
    const rawToken = cookies['bf_guest'];
    if (!rawToken || !/^[0-9a-f]{64}$/.test(rawToken)) {
      throw new Error('Authentication required');
    }

    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    // 3. Normal joins strictly require available DB and valid guest session.
    // Ordinary joins are NEVER treated as reconnects!
    if (!this.persistence) {
      throw new Error('Database service is required');
    }

    const isHealthy = await this.persistence.isDuelHealthy();
    if (!isHealthy) {
      throw new Error('Duel persistence service unhealthy');
    }

    let guest;
    try {
      guest = await this.persistence.getGuestByTokenHash(tokenHash);
    } catch {
      throw new Error('Authentication service unavailable');
    }

    if (!guest) {
      throw new Error('Invalid guest session');
    }

    if (await this.persistence.isGuestBanned(guest.id)) {
      throw new Error('Guest is banned');
    }

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

    // Check same guest not in two seats
    for (const binding of this.seatBindings.values()) {
      if (binding.guestId === guest.id) {
        throw new Error('Same guest cannot take two seats');
      }
    }

    // Room locked after start
    if (this.engine.getPhase() !== 'WAITING') {
      throw new Error('Match has already started');
    }

    // Check room full
    if (this.seatBindings.size >= 2) {
      throw new Error('Room is full');
    }

    return {
      guestId: guest.id,
      tokenHash,
      nickname: options?.nickname
    };
  }

  onJoin(client: Client, options: any, auth: any) {
    if (this.engine.getPhase() !== 'WAITING') {
      throw new Error('Match has already started');
    }

    // Atomic check on join (prevent race conditions from concurrent onAuth calls)
    if (this.seatBindings.size >= 2) {
      throw new Error('Room is full');
    }

    for (const binding of this.seatBindings.values()) {
      if (binding.guestId === auth.guestId) {
        throw new Error('Same guest cannot take two seats');
      }
    }

    const seatId: DuelSeatId = !this.seatBindings.has(0) ? 0 : 1;
    const nickname = typeof auth.nickname === 'string' && auth.nickname.trim().length > 0
      ? auth.nickname.trim()
      : `玩家${seatId + 1}`;

    const binding: SeatBinding = {
      seatId,
      guestId: auth.guestId,
      sessionId: client.sessionId,
      tokenHash: auth.tokenHash,
      nickname
    };

    this.seatBindings.set(seatId, binding);
    this.clientSeatMap.set(client.sessionId, seatId);

    const joined = this.engine.joinSeat(seatId, nickname);
    if (!joined) {
      this.seatBindings.delete(seatId);
      this.clientSeatMap.delete(client.sessionId);
      throw new Error('Failed to join seat');
    }

    client.send('ready', {
      roomId: this.roomId,
      matchId: this.engine.matchId,
      seatId,
      stateVersion: this.engine.getStateVersion()
    });
  }

  async onLeave(client: Client, consented: boolean) {
    const seatId = this.clientSeatMap.get(client.sessionId);
    if (seatId === undefined) return;
    const disconnectedSessionId = client.sessionId;

    this.messageTimestamps.delete(client.sessionId);

    if (consented) {
      if (this.engine.getPhase() === 'WAITING') {
        this.engine.leaveSeat(seatId);
        this.seatBindings.delete(seatId);
        this.clientSeatMap.delete(client.sessionId);
        if (this.seatBindings.size === 0) {
          this.disconnect();
        }
        return;
      }

      // Consented leave in active / finished match:
      // Mark connected false, retain seat owner (seatBindings) for persistence,
      // do not settle again (LEAVE command already settled it), remove client from map
      this.clientSeatMap.delete(client.sessionId);
      this.engine.setConnected(seatId, false);
      if (this.engine.isFinished()) {
        this.handleMatchSettled();
      }
      return;
    }

    // Abnormal disconnect: allow reconnection for 120s
    this.engine.setConnected(seatId, false);

    try {
      const newClient = await this.allowReconnection(client, DUEL_TIMEOUT_SECONDS.RECONNECT_GRACE);
      // Client reconnected with newClient!
      const binding = this.seatBindings.get(seatId);
      if (
        !this.engine.isSeatOccupied(seatId) ||
        !binding ||
        binding.sessionId !== disconnectedSessionId
      ) {
        try {
          newClient.leave(1000);
        } catch {
          // ignore
        }
        return;
      }
      const reconnected = this.engine.setConnected(seatId, true);
      if (!reconnected) {
        try {
          newClient.leave(1000);
        } catch {
          // ignore
        }
        return;
      }
      this.clientSeatMap.delete(client.sessionId);
      this.clientSeatMap.set(newClient.sessionId, seatId);
      binding.sessionId = newClient.sessionId;
      newClient.send('snapshot', this.decorateSnapshot(this.engine.getClientSnapshot(seatId)));
    } catch {
      // 120s expired without reconnecting
      if (this.engine.getPhase() === 'WAITING') {
        // The engine timer may already have released this seat. A new player
        // can occupy it before Colyseus rejects the old reconnection promise;
        // never let the stale connection remove that replacement binding.
        const binding = this.seatBindings.get(seatId);
        const stillOwnsSeat = !binding || binding.sessionId === disconnectedSessionId;
        if (stillOwnsSeat) {
          if (this.engine.isSeatOccupied(seatId)) {
            this.engine.leaveSeat(seatId);
          }
          if (this.seatBindings.get(seatId)?.sessionId === disconnectedSessionId) {
            this.seatBindings.delete(seatId);
          }
          if (this.clientSeatMap.get(disconnectedSessionId) === seatId) {
            this.clientSeatMap.delete(disconnectedSessionId);
          }
        }
        if (this.seatBindings.size === 0) {
          this.disconnect();
        }
      } else {
        this.handleMatchSettled();
      }
    }
  }

  private handleMatchSettled(): void {
    if (this.settlementEnqueued) return;
    if (!this.engine || !this.engine.isFinished()) return;
    const record = this.engine.getCompletedRecord();
    if (!record) return;
    record.isPrivate = this.isPrivateRoom;
    record.ranked = this.ranked;
    record.showOfferHistory = this.showOfferHistory;

    const b0 = this.seatBindings.get(0);
    const b1 = this.seatBindings.get(1);

    if (b0 && b1 && this.persistence && this.outbox) {
      try {
        this.outbox.enqueueWithRetry({
          kind: 'duel',
          resultId: record.result.resultId,
          matchId: record.matchId,
          guest0Id: b0.guestId,
          guest1Id: b1.guestId,
          completedAt: record.completedAt,
          ruleVersion: record.ruleVersion,
          record
        });
        this.settlementEnqueued = true;
      } catch (err) {
        console.error('[DuelRoom] Failed to enqueue completed duel to outbox:', err);
      }
    }
  }

  onDispose() {
    this.handleMatchSettled();
    if (this.engine) {
      this.engine.dispose();
    }
  }

  public getEngine(): DuelEngine {
    return this.engine;
  }

  private decorateSnapshot(snapshot: any): any {
    return {
      ...snapshot,
      public: {
        ...snapshot.public,
        themeId: this.themeId,
        showOfferHistory: this.showOfferHistory,
        offerHistory: this.showOfferHistory ? snapshot.public.offerHistory : []
      }
    };
  }
}
