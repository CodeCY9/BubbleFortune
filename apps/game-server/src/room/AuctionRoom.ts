import http from 'node:http';
import crypto from 'node:crypto';
import { Room, Client } from '@colyseus/core';
import { AuctionEngine } from '../engine/AuctionEngine';
import {
  AUCTION_MAX_PLAYERS,
  AUCTION_MAX_SPECTATORS,
  AUCTION_TIMEOUT_SECONDS,
  AuctionCommandResult
} from '../../../../packages/protocol/src/auction';
import { DatabaseManager } from '../persistence/db';
import { OutboxManager } from '../persistence/outbox';
import { parseCookies } from '../http/cookies';
import { getClientIp, hashDeviceFingerprint, hashRiskFingerprint } from '../http/security';
import { normalizeRoomThemeId, type RoomThemeId } from '../../../../packages/protocol/src/theme';

interface SeatBinding {
  seatId: number;
  guestId: string;
  sessionId: string;
  tokenHash: string;
  nickname: string;
}

interface SpectatorBinding {
  sessionId: string;
  nickname: string;
  lastReactionTime: number;
}

export class AuctionRoom extends Room {
  public maxClients = AUCTION_MAX_PLAYERS + AUCTION_MAX_SPECTATORS;
  private engine!: AuctionEngine;
  private persistence?: DatabaseManager;
  private outbox?: OutboxManager;
  private allowedOrigins?: Set<string>;
  private settlementEnqueued = false;

  private readonly seatBindings = new Map<number, SeatBinding>();
  private readonly clientSeatMap = new Map<string, number>();
  private readonly spectators = new Map<string, SpectatorBinding>();

  private messageTimestamps = new Map<string, number[]>();
  private static readonly RATE_LIMIT_MAX_PER_SEC = 100;
  private static readonly REACTION_RATE_LIMIT_MS = 1000;

  private isPrivate = false;
  private ranked = true;
  private allowSpectators = true;
  private allowEmotes = true;
  private showBidHistory = true;
  private passwordHash: string | null = null;
  private themeId: RoomThemeId = 'classic';

  onCreate(options: any) {
    const isPrivate = options?.isPrivate !== undefined ? Boolean(options.isPrivate) : false;
    const ranked = !isPrivate && options?.ranked !== false;
    const allowSpectators = options?.allowSpectators !== undefined ? Boolean(options.allowSpectators) : true;
    const allowEmotes = options?.allowEmotes !== undefined ? Boolean(options.allowEmotes) : true;
    const showBidHistory = options?.showBidHistory !== undefined ? Boolean(options.showBidHistory) : true;
    const password = typeof options?.password === 'string' ? options.password.trim() : '';

    if (isPrivate && password.length < 4) {
      throw new Error('Private auction rooms require a password of at least 4 characters');
    }
    if (password.length > 64) {
      throw new Error('Room password is too long');
    }

    this.isPrivate = isPrivate;
    this.ranked = ranked;
    this.allowSpectators = allowSpectators;
    this.allowEmotes = allowEmotes;
    this.showBidHistory = showBidHistory;
    this.themeId = normalizeRoomThemeId(options?.themeId);
    this.passwordHash = isPrivate
      ? crypto.createHash('sha256').update(password).digest('hex')
      : null;

    this.setPrivate(isPrivate);
    this.setMetadata({
      isPrivate,
      ranked,
      allowSpectators,
      allowEmotes,
      showBidHistory,
      passwordRequired: Boolean(this.passwordHash),
      themeId: this.themeId
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
      mode: 'auction_26',
      matchId: this.roomId,
      metadata: { ranked, isPrivate },
      dedupeKey: `room_created:auction_26:${this.roomId}`
    }).catch(() => {});
    if (options?.allowedOrigins && options.allowedOrigins instanceof Set) {
      this.allowedOrigins = options.allowedOrigins;
    }

    this.engine = new AuctionEngine({
      roomId: this.roomId,
      isPrivate,
      ranked,
      allowSpectators,
      allowEmotes,
      showBidHistory
    });

    this.engine.setOnStateChange((event?: any) => {
      if (
        (event?.type === 'PLAYER_LEFT_LOBBY' || event?.type === 'WAITING_PLAYER_RELEASED') &&
        typeof event.seatId === 'number'
      ) {
        const seatId = event.seatId as number;
        this.seatBindings.delete(seatId);
        for (const [sid, s] of Array.from(this.clientSeatMap.entries())) {
          if (s === seatId) {
            this.clientSeatMap.delete(sid);
          }
        }
        if (this.seatBindings.size === 0 && this.spectators.size === 0) {
          this.disconnect();
        }
      }
      this.broadcastSnapshots();
      if (event?.type === 'MATCH_STARTED') {
        for (const binding of this.seatBindings.values()) {
          void this.persistence?.recordAnalyticsEvent({
            eventName: 'match_started',
            mode: 'auction_26',
            guestId: binding.guestId,
            matchId: this.roomId,
            metadata: { ranked: this.ranked, isPrivate: this.isPrivate },
            dedupeKey: `match_started:auction_26:${this.roomId}:${binding.guestId}`
          }).catch(() => {});
        }
      }
      if (this.engine.isFinished()) {
        this.handleMatchSettled();
      }
    });

    this.onMessage('request_snapshot', (client) => {
      if (!this.checkRateLimit(client)) return;

      const isSpectator = this.spectators.has(client.sessionId);
      const seatId = this.clientSeatMap.get(client.sessionId);

      if (!isSpectator && seatId === undefined) {
        client.send('error', { code: 'UNAUTHORIZED', message: 'Unauthorized client' });
        return;
      }

      client.send('snapshot', this.decorateSnapshot(this.engine.getClientSnapshot(seatId ?? null)));
    });

    this.onMessage('ping', (client, payload) => {
      const sentAt = payload && typeof payload === 'object' && Number.isFinite((payload as any).sentAt)
        ? Number((payload as any).sentAt)
        : Number(payload);
      client.send('pong', { sentAt: Number.isFinite(sentAt) ? sentAt : Date.now(), serverAt: Date.now() });
    });

    this.onMessage('command', (client, rawPayload) => {
      const isSpectator = this.spectators.has(client.sessionId);
      const seatId = this.clientSeatMap.get(client.sessionId);
      const idempotencyKey =
        rawPayload &&
        typeof rawPayload === 'object' &&
        !Array.isArray(rawPayload) &&
        typeof (rawPayload as any).idempotencyKey === 'string' &&
        (rawPayload as any).idempotencyKey.length <= 128
          ? (rawPayload as any).idempotencyKey
          : undefined;

      try {
        if (!this.checkRateLimit(client)) {
          client.send('command_result', {
            success: false,
            idempotencyKey,
            stateVersion: this.engine.getStateVersion(),
            snapshot: this.decorateSnapshot(this.engine.getClientSnapshot(seatId ?? null)),
            error: { code: 'RATE_LIMITED', message: 'Too many requests' }
          } as AuctionCommandResult);
          return;
        }

        if ((rawPayload as any)?.type === 'SEND_EMOTE' && !this.allowEmotes) {
          client.send('command_result', {
            success: false,
            idempotencyKey,
            stateVersion: this.engine.getStateVersion(),
            snapshot: this.decorateSnapshot(this.engine.getClientSnapshot(seatId ?? null)),
            error: { code: 'FEATURE_DISABLED', message: '快捷表情未在本房间启用' }
          } as AuctionCommandResult);
          return;
        }

        if (isSpectator) {
          // Spectator can ONLY send SEND_EMOTE or SEND_REACTION
          if (
            rawPayload &&
            typeof rawPayload === 'object' &&
            ((rawPayload as any).type === 'SEND_EMOTE' || (rawPayload as any).type === 'SEND_REACTION')
          ) {
            const spec = this.spectators.get(client.sessionId)!;
            const now = Date.now();
            if (now - spec.lastReactionTime < AuctionRoom.REACTION_RATE_LIMIT_MS) {
              client.send('command_result', {
                success: false,
                idempotencyKey,
                stateVersion: this.engine.getStateVersion(),
                error: { code: 'RATE_LIMITED', message: 'Reaction rate limit exceeded' }
              } as AuctionCommandResult);
              return;
            }
            spec.lastReactionTime = now;
            const ok = this.engine.processReaction(true, spec.nickname, (rawPayload as any).emoji);
            client.send('command_result', {
              success: ok,
              idempotencyKey,
              stateVersion: this.engine.getStateVersion(),
              snapshot: this.decorateSnapshot(this.engine.getClientSnapshot(null))
            } as AuctionCommandResult);
          } else {
            client.send('command_result', {
              success: false,
              idempotencyKey,
              stateVersion: this.engine.getStateVersion(),
              error: { code: 'UNAUTHORIZED', message: 'Spectators can only view and react' }
            } as AuctionCommandResult);
          }
          return;
        }

        const binding = seatId !== undefined ? this.seatBindings.get(seatId) : undefined;
        if (seatId === undefined || !binding || binding.sessionId !== client.sessionId) {
          client.send('command_result', {
            success: false,
            idempotencyKey,
            stateVersion: this.engine.getStateVersion(),
            error: { code: 'UNAUTHORIZED', message: 'Unauthorized client' }
          } as AuctionCommandResult);
          return;
        }

        if (rawPayload && typeof rawPayload === 'object') {
          if ((rawPayload as any).matchId !== undefined && (rawPayload as any).matchId !== this.engine.matchId) {
            client.send('command_result', {
              success: false,
              idempotencyKey,
              stateVersion: this.engine.getStateVersion(),
              snapshot: this.decorateSnapshot(this.engine.getClientSnapshot(seatId ?? null)),
              error: { code: 'INVALID_PAYLOAD', message: `Match ID mismatch: expected ${this.engine.matchId}, got ${(rawPayload as any).matchId}` }
            } as AuctionCommandResult);
            return;
          }
          if ((rawPayload as any).roomId !== undefined && (rawPayload as any).roomId !== this.roomId) {
            client.send('command_result', {
              success: false,
              idempotencyKey,
              stateVersion: this.engine.getStateVersion(),
              snapshot: this.decorateSnapshot(this.engine.getClientSnapshot(seatId ?? null)),
              error: { code: 'INVALID_PAYLOAD', message: `Room ID mismatch: expected ${this.roomId}, got ${(rawPayload as any).roomId}` }
            } as AuctionCommandResult);
            return;
          }
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
          snapshot: this.decorateSnapshot(this.engine.getClientSnapshot(seatId ?? null)),
          error: { code: 'INTERNAL_ERROR', message: 'Internal server error processing command' }
        } as AuctionCommandResult);
      }
    });

    const handleEmoteOrReaction = (client: Client, rawPayload: any) => {
      if (!this.checkRateLimit(client)) return;
      const isSpectator = this.spectators.has(client.sessionId);
      const seatId = this.clientSeatMap.get(client.sessionId);

      let nickname = '观战者';
      if (isSpectator) {
        const spec = this.spectators.get(client.sessionId)!;
        const now = Date.now();
        if (now - spec.lastReactionTime < AuctionRoom.REACTION_RATE_LIMIT_MS) return;
        spec.lastReactionTime = now;
        nickname = spec.nickname;
      } else if (seatId !== undefined) {
        const seat = this.engine.getSeat(seatId);
        if (seat) nickname = seat.nickname;
      } else {
        return;
      }

      if (rawPayload && typeof rawPayload.emoji === 'string') {
        this.engine.processReaction(isSpectator, nickname, rawPayload.emoji);
      }
    };

    this.onMessage('reaction', handleEmoteOrReaction);
    this.onMessage('emote', handleEmoteOrReaction);
  }

  public verifyClientUpgrade(req: http.IncomingMessage, allowedOrigins?: Set<string>): boolean {
    const origin = req.headers.origin;
    if (origin && allowedOrigins && !allowedOrigins.has(origin)) {
      return false;
    }
    return true;
  }

  private checkRateLimit(client: Client): boolean {
    const now = Date.now();
    let timestamps = this.messageTimestamps.get(client.sessionId) || [];
    timestamps = timestamps.filter((t) => now - t < 1000);
    if (timestamps.length >= AuctionRoom.RATE_LIMIT_MAX_PER_SEC) {
      client.send('error', { code: 'RATE_LIMITED', message: 'Too many requests' });
      return false;
    }
    timestamps.push(now);
    this.messageTimestamps.set(client.sessionId, timestamps);
    return true;
  }

  async onAuth(client: Client, options: any, context?: any) {
    const origin = context?.headers?.origin || context?.req?.headers?.origin;
    if (origin && this.allowedOrigins && !this.allowedOrigins.has(origin)) {
      throw new Error('Invalid Origin');
    }

    const isSpectator = Boolean(options?.isSpectator || options?.spectator);

    if (this.passwordHash) {
      const suppliedPassword = typeof options?.password === 'string' ? options.password.trim() : '';
      const suppliedHash = crypto.createHash('sha256').update(suppliedPassword).digest('hex');
      const matches = crypto.timingSafeEqual(
        Buffer.from(suppliedHash, 'hex'),
        Buffer.from(this.passwordHash, 'hex')
      );
      if (!matches) {
        throw new Error('Invalid room password');
      }
    }

    if (isSpectator) {
      if (!this.allowSpectators) {
        throw new Error('Spectators are not allowed in this room');
      }
      if (this.spectators.size >= AUCTION_MAX_SPECTATORS) {
        throw new Error('Spectator slots are full');
      }
      const nickname =
        typeof options?.nickname === 'string' && options.nickname.trim().length > 0
          ? options.nickname.trim().slice(0, 16)
          : `观战者${this.spectators.size + 1}`;
      return { isSpectator: true, nickname };
    }

    // Official player auth
    const cookieHeader = context?.headers?.cookie || context?.req?.headers?.cookie;
    const cookies = parseCookies(cookieHeader);
    const rawToken = cookies['bf_guest'];
    if (!rawToken || !/^[0-9a-f]{64}$/.test(rawToken)) {
      throw new Error('Authentication required');
    }

    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    if (!this.persistence) {
      throw new Error('Database service is required');
    }

    const isHealthy = await this.persistence.isHealthy();
    if (!isHealthy) {
      throw new Error('Persistence service unhealthy');
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

    for (const binding of this.seatBindings.values()) {
      if (binding.guestId === guest.id) {
        throw new Error('Same guest cannot take multiple seats');
      }
    }

    if (this.engine.getPhase() !== 'WAITING') {
      throw new Error('Match has already started');
    }

    if (this.seatBindings.size >= AUCTION_MAX_PLAYERS) {
      throw new Error('Room is full');
    }

    return {
      isSpectator: false,
      guestId: guest.id,
      tokenHash,
      nickname: options?.nickname
    };
  }

  onJoin(client: Client, options: any, auth: any) {
    if (auth.isSpectator) {
      this.spectators.set(client.sessionId, {
        sessionId: client.sessionId,
        nickname: auth.nickname,
        lastReactionTime: 0
      });
      this.engine.setSpectatorCount(this.spectators.size);

      client.send('ready', {
        roomId: this.roomId,
        matchId: this.engine.matchId,
        isSpectator: true,
        stateVersion: this.engine.getStateVersion()
      });
      client.send('snapshot', this.decorateSnapshot(this.engine.getClientSnapshot(null)));
      return;
    }

    if (this.engine.getPhase() !== 'WAITING') {
      throw new Error('Match has already started');
    }

    if (this.seatBindings.size >= AUCTION_MAX_PLAYERS) {
      throw new Error('Room is full');
    }

    const assignedSeatId = this.engine.assignNextAvailableSeat(auth.nickname);
    if (assignedSeatId === null) {
      throw new Error('Failed to allocate seat');
    }

    const nickname =
      typeof auth.nickname === 'string' && auth.nickname.trim().length > 0
        ? auth.nickname.trim().slice(0, 16)
        : `玩家${assignedSeatId + 1}`;

    const binding: SeatBinding = {
      seatId: assignedSeatId,
      guestId: auth.guestId,
      sessionId: client.sessionId,
      tokenHash: auth.tokenHash,
      nickname
    };

    this.seatBindings.set(assignedSeatId, binding);
    this.clientSeatMap.set(client.sessionId, assignedSeatId);

    client.send('ready', {
      roomId: this.roomId,
      matchId: this.engine.matchId,
      seatId: assignedSeatId,
      stateVersion: this.engine.getStateVersion()
    });

    this.broadcastSnapshots();
  }

  async onLeave(client: Client, consented: boolean) {
    this.messageTimestamps.delete(client.sessionId);

    if (this.spectators.has(client.sessionId)) {
      this.spectators.delete(client.sessionId);
      this.engine.setSpectatorCount(this.spectators.size);
      this.broadcastSnapshots();
      return;
    }

    const seatId = this.clientSeatMap.get(client.sessionId);
    if (seatId === undefined) return;

    if (consented) {
      if (this.engine.getPhase() === 'WAITING') {
        this.clientSeatMap.delete(client.sessionId);
        this.engine.processCommand(seatId, {
          type: 'LEAVE',
          stateVersion: this.engine.getStateVersion(),
          commandSequence: (this.engine.getSeat(seatId)?.lastCommandSequence || 0) + 1,
          idempotencyKey: `leave_${crypto.randomUUID()}`
        });
        return;
      }

      // Consented leave in ongoing match -> forfeit
      this.clientSeatMap.delete(client.sessionId);
      this.engine.forfeitPlayer(seatId, 'FORFEIT');
      if (this.engine.isFinished()) {
        this.handleMatchSettled();
      }
      return;
    }

    // Unconsented disconnect -> allow reconnection
    this.engine.handleClientDisconnect(seatId);
    this.broadcastSnapshots();

    const oldSessionId = client.sessionId;
    try {
      const reconnectedClient = await this.allowReconnection(client, AUCTION_TIMEOUT_SECONDS.RECONNECT_GRACE);
      // Reconnected successfully!
      if (oldSessionId !== reconnectedClient.sessionId) {
        if (this.clientSeatMap.get(oldSessionId) === seatId) {
          this.clientSeatMap.delete(oldSessionId);
        }
      }
      this.clientSeatMap.set(reconnectedClient.sessionId, seatId);
      const binding = this.seatBindings.get(seatId);
      if (binding) {
        binding.sessionId = reconnectedClient.sessionId;
      }

      this.engine.handleClientReconnect(seatId);
      reconnectedClient.send('ready', {
        roomId: this.roomId,
        matchId: this.engine.matchId,
        seatId,
        stateVersion: this.engine.getStateVersion()
      });
      reconnectedClient.send('snapshot', this.decorateSnapshot(this.engine.getClientSnapshot(seatId)));
      this.broadcastSnapshots();
    } catch {
      // Reconnection timeout: stale old session mappings cannot remove the replacement
      const binding = this.seatBindings.get(seatId);
      if (binding && binding.sessionId === oldSessionId) {
        if (this.clientSeatMap.get(oldSessionId) === seatId) {
          this.clientSeatMap.delete(oldSessionId);
        }
        if (this.engine.getPhase() === 'WAITING') {
          this.seatBindings.delete(seatId);
          this.engine.releaseWaitingSeat(seatId);
          if (this.seatBindings.size === 0 && this.spectators.size === 0) {
            this.disconnect();
          }
        }
      }
      if (this.engine.isFinished()) {
        this.handleMatchSettled();
      }
    }
  }

  private broadcastSnapshots(): void {
    for (const client of this.clients) {
      if (this.spectators.has(client.sessionId)) {
        client.send('snapshot', this.decorateSnapshot(this.engine.getClientSnapshot(null)));
      } else {
        const seatId = this.clientSeatMap.get(client.sessionId);
        if (seatId !== undefined) {
          client.send('snapshot', this.decorateSnapshot(this.engine.getClientSnapshot(seatId)));
        }
      }
    }
  }

  private decorateSnapshot(snapshot: any): any {
    return { ...snapshot, public: { ...snapshot.public, themeId: this.themeId } };
  }

  onDispose() {
    this.handleMatchSettled();
  }

  private handleMatchSettled(): void {
    if (this.settlementEnqueued) return;
    if (!this.engine || !this.engine.isFinished()) return;

    const completed = this.engine.getCompletedRecord();
    if (!completed) return;

    // Attach guestIds to seat records
    for (const seat of completed.seats) {
      const binding = this.seatBindings.get(seat.seatId);
      if (binding) {
        seat.guestId = binding.guestId;
      }
    }

    const participantGuestIds: string[] = [];
    for (const s of completed.seats) {
      if (s.guestId) participantGuestIds.push(s.guestId);
    }

    if (this.outbox) {
      try {
        this.outbox.enqueue({
          kind: 'auction',
          resultId: completed.resultId,
          matchId: completed.matchId,
          participantGuestIds,
          completedAt: completed.completedAt,
          ruleVersion: completed.ruleVersion,
          record: completed
        });
        this.settlementEnqueued = true;
      } catch (err) {
        console.error('[AuctionRoom] Failed to enqueue completed auction (will retry on dispose):', err);
      }
    }
  }
}
