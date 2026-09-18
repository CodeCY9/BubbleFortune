import crypto from 'node:crypto';
import { Room, Client } from '@colyseus/core';
import { Challenge26Engine, CHALLENGE_RULE_VERSION } from '../engine/Challenge26Engine';
import { TIMEOUT_SECONDS } from '../../../../packages/protocol/src/config';
import { CommandResult } from '../../../../packages/protocol/src/types';
import { AiType } from '../../../../packages/protocol/src/types';
import { isValidAiType } from '../engine/ai';
import { DatabaseManager } from '../persistence/db';
import { OutboxManager } from '../persistence/outbox';
import { parseCookies } from '../http/cookies';

export class Challenge26Room extends Room {
  public maxClients = 1;
  private engine!: Challenge26Engine;
  private ownerSessionId: string | null = null;
  private ownerGuestId: string | null = null;
  private persistence?: DatabaseManager;
  private outbox?: OutboxManager;
  private settlementEnqueued = false;
  private messageTimestamps: number[] = [];
  private static readonly RATE_LIMIT_MAX_PER_SEC = 100;

  onCreate(options: any) {
    if (options && typeof options === 'object') {
      for (const key of ['customBoxAmountMap', 'seed', 'boxAmountMap', 'ev', 'values']) {
        if (key in options) throw new Error('Custom challenge configuration is not permitted via network');
      }
    }
    this.persistence = options?.persistence;
    this.outbox = options?.outbox;
    void this.persistence?.recordAnalyticsEvent({
      eventName: 'room_created',
      mode: CHALLENGE_RULE_VERSION,
      matchId: this.roomId,
      metadata: { aiType: options?.aiType || 'conservative' },
      dedupeKey: `room_created:${CHALLENGE_RULE_VERSION}:${this.roomId}`
    }).catch(() => {});
    let aiType: AiType = 'conservative';
    if (options?.aiType !== undefined) {
      if (!isValidAiType(options.aiType)) throw new Error(`Invalid aiType: ${options.aiType}`);
      aiType = options.aiType;
    }
    this.engine = new Challenge26Engine({ gameId: `challenge_${this.roomId}`, aiType });
    this.engine.setOnEventHandler((event, snapshot) => {
      this.broadcast('game_event', { event, snapshot });
      if (this.engine.isFinished()) this.handleGameSettled();
    });

    this.onMessage('request_snapshot', (client) => {
      if (!this.checkRateLimit(client)) return;
      if (this.ownerSessionId && client.sessionId !== this.ownerSessionId) {
        client.send('error', { code: 'UNAUTHORIZED', message: 'Unauthorized client' });
        return;
      }
      client.send('snapshot', this.engine.getPublicSnapshot());
    });

    this.onMessage('ping', (client, payload) => {
      const sentAt = payload && typeof payload === 'object' && Number.isFinite((payload as any).sentAt)
        ? Number((payload as any).sentAt)
        : Number(payload);
      client.send('pong', { sentAt: Number.isFinite(sentAt) ? sentAt : Date.now(), serverAt: Date.now() });
    });

    this.onMessage('command', (client, rawPayload) => {
      if (!this.checkRateLimit(client)) return;
      const key = rawPayload && typeof rawPayload === 'object' && typeof (rawPayload as any).idempotencyKey === 'string'
        ? (rawPayload as any).idempotencyKey : undefined;
      if (this.ownerSessionId && client.sessionId !== this.ownerSessionId) {
        client.send('command_result', {
          success: false,
          idempotencyKey: key,
          stateVersion: this.engine.getStateVersion(),
          snapshot: this.engine.getPublicSnapshot(),
          error: { code: 'UNAUTHORIZED', message: 'Unauthorized client' }
        } as CommandResult);
        return;
      }
      try {
        const result = this.engine.processCommand(rawPayload);
        if (key && !result.idempotencyKey) result.idempotencyKey = key;
        client.send('command_result', result);
        if (this.engine.isFinished()) this.handleGameSettled();
      } catch {
        client.send('command_result', {
          success: false,
          idempotencyKey: key,
          stateVersion: this.engine.getStateVersion(),
          snapshot: this.engine.getPublicSnapshot(),
          error: { code: 'INTERNAL_ERROR', message: 'Internal server error' }
        } as CommandResult);
      }
    });
  }

  private handleGameSettled(): void {
    if (this.settlementEnqueued || !this.persistence || !this.ownerGuestId || !this.outbox) return;
    const record = this.engine.getCompletedRecord();
    if (!record) return;
    this.outbox.enqueue({
      resultId: record.settlement.resultId,
      ownerId: this.ownerGuestId,
      gameId: record.gameId,
      completedAt: record.completedAt,
      ruleVersion: CHALLENGE_RULE_VERSION,
      aiType: record.aiType,
      aiStrategyVersion: record.aiStrategyVersion,
      record
    });
    this.settlementEnqueued = true;
  }

  private checkRateLimit(client: Client): boolean {
    const now = Date.now();
    this.messageTimestamps = this.messageTimestamps.filter((t) => now - t < 1000);
    if (this.messageTimestamps.length >= Challenge26Room.RATE_LIMIT_MAX_PER_SEC) {
      client.send('error', { code: 'RATE_LIMITED', message: 'Too many requests' });
      return false;
    }
    this.messageTimestamps.push(now);
    return true;
  }

  async onAuth(client: Client, _options: any, context?: any) {
    if (this.persistence) {
      const cookieHeader = context?.headers?.cookie || context?.req?.headers?.cookie;
      const rawToken = parseCookies(cookieHeader)['bf_guest'];
      if (!rawToken || !/^[0-9a-f]{64}$/.test(rawToken)) throw new Error('Authentication required');
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      const guest = await this.persistence.getGuestByTokenHash(tokenHash);
      if (!guest) throw new Error('Invalid guest session');
      if (await this.persistence.isGuestBanned(guest.id)) throw new Error('Guest is banned');
      if (!this.ownerGuestId) this.ownerGuestId = guest.id;
      else if (this.ownerGuestId !== guest.id) throw new Error('Challenge room is locked to original owner');
    }
    if (!this.ownerSessionId) {
      this.ownerSessionId = client.sessionId;
      return true;
    }
    if (client.sessionId !== this.ownerSessionId) throw new Error('Challenge room is locked to original owner');
    return true;
  }

  onJoin(client: Client) {
    if (this.ownerGuestId) {
      void this.persistence?.recordAnalyticsEvent({
        eventName: 'match_started',
        mode: CHALLENGE_RULE_VERSION,
        guestId: this.ownerGuestId,
        matchId: this.engine.gameId,
        metadata: { aiType: this.engine.aiType },
        dedupeKey: `match_started:${CHALLENGE_RULE_VERSION}:${this.engine.gameId}:${this.ownerGuestId}`
      }).catch(() => {});
    }
    client.send('ready', { gameId: this.engine.gameId, stateVersion: this.engine.getStateVersion() });
  }

  async onLeave(client: Client, consented: boolean) {
    if (consented) {
      this.disconnect();
      return;
    }
    try {
      await this.allowReconnection(client, TIMEOUT_SECONDS.RECONNECT_GRACE);
    } catch {
      this.disconnect();
    }
  }

  onDispose() {
    this.handleGameSettled();
    this.engine?.dispose();
  }
}
