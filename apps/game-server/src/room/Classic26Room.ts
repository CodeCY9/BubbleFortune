import crypto from 'node:crypto';
import { Room, Client } from '@colyseus/core';
import { GameEngine } from '../engine/GameEngine';
import { validateClientCommand } from '../../../../packages/protocol/src/validation';
import { TIMEOUT_SECONDS } from '../../../../packages/protocol/src/config';
import { PublicSnapshot, CommandResult, AiType } from '../../../../packages/protocol/src/types';
import { isValidAiType } from '../engine/ai';
import { DatabaseManager } from '../persistence/db';
import { OutboxManager } from '../persistence/outbox';
import { parseCookies } from '../http/cookies';

export class Classic26Room extends Room {
  public maxClients = 1;
  private engine!: GameEngine;
  private ownerSessionId: string | null = null;
  private ownerGuestId: string | null = null;
  private persistence?: DatabaseManager;
  private outbox?: OutboxManager;
  private settlementEnqueued = false;
  private connectedClient: Client | null = null;
  private messageTimestamps: number[] = [];
  private static readonly RATE_LIMIT_MAX_PER_SEC = 100;

  onCreate(options: any) {
    // Strictly disallow any client injection of box amounts, seeds, or formulas
    if (options && typeof options === 'object') {
      const forbidden = ['customBoxAmountMap', 'seed', 'boxAmountMap', 'ev', 'values'];
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
      mode: 'classic_26',
      matchId: this.roomId,
      metadata: { aiType: options?.aiType || 'conservative' },
      dedupeKey: `room_created:classic_26:${this.roomId}`
    }).catch(() => {});

    let aiType: AiType = 'conservative';
    if (options && typeof options === 'object' && options.aiType !== undefined) {
      if (!isValidAiType(options.aiType)) {
        throw new Error(`Invalid aiType: ${options.aiType}`);
      }
      aiType = options.aiType;
    }

    this.engine = new GameEngine({
      gameId: 'game_' + this.roomId,
      aiType
    });

    // Notify connected client on server events with both event AND full authorized snapshot
    this.engine.setOnEventHandler((event, snapshot) => {
      this.broadcast('game_event', { event, snapshot });
      if (event.type === 'GAME_SETTLED' || snapshot.phase === 'FINISHED') {
        this.handleGameSettled();
      }
    });

    // Handle client messages
    this.onMessage('request_snapshot', (client) => {
      if (this.ownerSessionId && client.sessionId !== this.ownerSessionId) {
        client.send('error', { code: 'UNAUTHORIZED', message: 'Unauthorized client' });
        return;
      }
      if (!this.checkRateLimit(client)) {
        return;
      }
      const snapshot = this.engine.getPublicSnapshot();
      client.send('snapshot', snapshot);
    });

    this.onMessage('ping', (client, payload) => {
      const sentAt = payload && typeof payload === 'object' && Number.isFinite((payload as any).sentAt)
        ? Number((payload as any).sentAt)
        : Number(payload);
      client.send('pong', { sentAt: Number.isFinite(sentAt) ? sentAt : Date.now(), serverAt: Date.now() });
    });

    this.onMessage('command', (client, rawPayload) => {
      const idempotencyKey =
        rawPayload &&
        typeof rawPayload === 'object' &&
        !Array.isArray(rawPayload) &&
        typeof (rawPayload as any).idempotencyKey === 'string' &&
        (rawPayload as any).idempotencyKey.length <= 128
          ? (rawPayload as any).idempotencyKey
          : undefined;

      try {
        if (this.ownerSessionId && client.sessionId !== this.ownerSessionId) {
          client.send('command_result', {
            success: false,
            idempotencyKey,
            stateVersion: this.engine.getStateVersion(),
            snapshot: this.engine.getPublicSnapshot(),
            error: { code: 'UNAUTHORIZED', message: 'Unauthorized client' }
          } as CommandResult);
          return;
        }

        if (!this.checkRateLimit(client)) {
          client.send('command_result', {
            success: false,
            idempotencyKey,
            stateVersion: this.engine.getStateVersion(),
            snapshot: this.engine.getPublicSnapshot(),
            error: { code: 'RATE_LIMITED', message: 'Too many requests' }
          } as CommandResult);
          return;
        }

        const result = this.engine.processCommand(rawPayload);
        client.send('command_result', result);

        if (this.engine.isFinished()) {
          this.handleGameSettled();
        }
      } catch (err: any) {
        client.send('command_result', {
          success: false,
          idempotencyKey,
          stateVersion: this.engine.getStateVersion(),
          snapshot: this.engine.getPublicSnapshot(),
          error: { code: 'INTERNAL_ERROR', message: 'Internal server error' }
        } as CommandResult);
      }
    });
  }

  private handleGameSettled(): void {
    if (this.settlementEnqueued) return;
    if (!this.engine || !this.engine.isFinished()) return;
    const record = this.engine.getCompletedRecord();
    if (!record) return;

    if (this.persistence && this.ownerGuestId && this.outbox) {
      try {
        this.outbox.enqueue({
          resultId: record.settlement.resultId,
          ownerId: this.ownerGuestId,
          gameId: record.gameId,
          completedAt: record.completedAt,
          ruleVersion: record.ruleVersion,
          aiType: record.aiType,
          aiStrategyVersion: record.aiStrategyVersion,
          record
        });
        this.settlementEnqueued = true;
      } catch (err) {
        console.error('[Classic26Room] Failed to enqueue completed game to outbox (will retry on dispose)');
      }
    }
  }

  private checkRateLimit(client: Client): boolean {
    const now = Date.now();
    this.messageTimestamps = this.messageTimestamps.filter((t) => now - t < 1000);
    if (this.messageTimestamps.length >= Classic26Room.RATE_LIMIT_MAX_PER_SEC) {
      client.send('error', { code: 'RATE_LIMITED', message: 'Too many requests' });
      return false;
    }
    this.messageTimestamps.push(now);
    return true;
  }

  async onAuth(client: Client, options: any, context?: any) {
    if (this.persistence) {
      try {
        const cookieHeader =
          context?.headers?.cookie || context?.req?.headers?.cookie;
        const cookies = parseCookies(cookieHeader);
        const rawToken = cookies['bf_guest'];
        if (!rawToken || !/^[0-9a-f]{64}$/.test(rawToken)) {
          throw new Error('Authentication required');
        }

        const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
        const guest = await this.persistence.getGuestByTokenHash(tokenHash);
        if (!guest) {
          throw new Error('Invalid guest session');
        }

        if (await this.persistence.isGuestBanned(guest.id)) {
          throw new Error('Guest is banned');
        }

        if (!this.ownerGuestId) {
          this.ownerGuestId = guest.id;
        } else if (this.ownerGuestId !== guest.id) {
          throw new Error('Room is single-player and locked to original owner');
        }
      } catch (err: any) {
        if (
          err.message === 'Authentication required' ||
          err.message === 'Invalid guest session' ||
          err.message === 'Guest is banned' ||
          err.message === 'Room is single-player and locked to original owner'
        ) {
          throw err;
        }
        console.error('[Classic26Room] onAuth database error (suppressing raw details)');
        throw new Error('Authentication service unavailable');
      }
    }

    // Single player room: store ownerSessionId permanently on creation/first join
    if (!this.ownerSessionId) {
      this.ownerSessionId = client.sessionId;
      return true;
    }

    // Reject any client that is not the permanent room owner, even if currently disconnected
    if (client.sessionId !== this.ownerSessionId) {
      throw new Error('Room is single-player and locked to original owner');
    }
    return true;
  }

  onJoin(client: Client, options: any) {
    this.connectedClient = client;
    if (this.ownerGuestId) {
      void this.persistence?.recordAnalyticsEvent({
        eventName: 'match_started',
        mode: 'classic_26',
        guestId: this.ownerGuestId,
        matchId: this.engine.gameId,
        metadata: { aiType: this.engine.aiType },
        dedupeKey: `match_started:classic_26:${this.engine.gameId}:${this.ownerGuestId}`
      }).catch(() => {});
    }
    // Welcome client and provide basic status; client sends request_snapshot to avoid race conditions
    client.send('ready', {
      gameId: this.engine.gameId,
      stateVersion: this.engine.getStateVersion()
    });
  }

  async onLeave(client: Client, consented: boolean) {
    this.connectedClient = null;
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
    this.handleGameSettled();
    if (this.engine) {
      this.engine.dispose();
    }
  }

  public getEngine(): GameEngine {
    return this.engine;
  }

  public getCompletedRecord() {
    return this.engine.getCompletedRecord();
  }
}
