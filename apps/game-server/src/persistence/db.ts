import pg from 'pg';
import crypto from 'node:crypto';
import {
  CompletedGameRecord,
  HistorySummaryItem,
  PublicShareSummary
} from '../../../../packages/protocol/src/types';
import {
  CompletedDuelRecord,
  DuelHistoryDetailResponse,
  DuelHistorySummaryItem,
  DuelSeatId
} from '../../../../packages/protocol/src/duel';
import {
  CompletedAuctionRecord,
  AuctionHistoryDetailResponse,
  AuctionHistorySummaryItem,
  AuctionShareSummary
} from '../../../../packages/protocol/src/auction';
import {
  CompletedSurvivorRecord,
  SurvivorHistoryDetailResponse,
  SurvivorHistorySummaryItem,
  SURVIVOR_RULE_VERSION
} from '../../../../packages/protocol/src/survivor';
import {
  CompletedTournamentRecord,
  TournamentHistoryDetailResponse,
  TournamentHistorySummaryItem
} from '../../../../packages/protocol/src/tournament';
import {
  SeasonSummary,
  RankingEntry,
  ProfileSummary,
  Report,
  AdminConfig,
  AdminBanItem,
  AdminMetrics,
  DEFAULT_ELO,
  DEFAULT_K_FACTOR,
  RANKING_RULE_VERSION,
  type RankingBoard
} from '../../../../packages/protocol/src/ranking';
import {
  ACHIEVEMENT_DEFINITIONS,
  type AchievementId,
  type AchievementItem
} from '../../../../packages/protocol/src/achievements';
import type {
  MultiplayerShareMode,
  MultiplayerShareSummary
} from '../../../../packages/protocol/src/share';
import type { AnalyticsSummary } from '../../../../packages/protocol/src/analytics';

export interface DatabaseOptions {
  connectionString: string;
  schema?: string;
  maxConnections?: number;
}

export interface GuestRow {
  id: string;
  token_hash: string;
}

function canonicalJson(obj: any): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return `[${obj.map(canonicalJson).join(',')}]`;
  }
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

export class DatabaseManager {
  private pool: pg.Pool;
  public readonly schema: string;

  constructor(options: DatabaseOptions) {
    if (options.schema) {
      if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(options.schema)) {
        throw new Error(
          `Invalid schema name "${options.schema}": schema must match ^[a-zA-Z_][a-zA-Z0-9_]{0,62}$`
        );
      }
      this.schema = options.schema;
    } else {
      this.schema = 'public';
    }

    this.pool = new pg.Pool({
      connectionString: options.connectionString,
      max: options.maxConnections || 10,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 10000,
      statement_timeout: 5000,
      query_timeout: 5000
    });

    // Idle client error handler: log safe code without leaking internal messages or credentials
    this.pool.on('error', (err) => {
      console.error('[DatabaseManager] Idle pool client error code:', (err && (err as any).code) || 'UNKNOWN_POOL_ERR');
    });

    // Set search_path with safe rejection catch
    this.pool.on('connect', (client) => {
      client.query(`SET search_path TO "${this.schema}", public`).catch(() => {
        // Suppress unhandled rejection if client dropped before query executed
      });
    });
  }

  public async init(): Promise<void> {
    const client = await this.pool.connect();
    try {
      if (this.schema !== 'public') {
        await client.query(`CREATE SCHEMA IF NOT EXISTS "${this.schema}"`);
      }
      await client.query(`SET search_path TO "${this.schema}", public`);

      await client.query('BEGIN');

      await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version INT PRIMARY KEY,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);

      const migrationCheck = await client.query(
        'SELECT version FROM schema_migrations WHERE version = 1'
      );

      if (migrationCheck.rows.length === 0) {
        await client.query(`
          CREATE TABLE IF NOT EXISTS guests (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            token_hash VARCHAR(64) NOT NULL UNIQUE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );

          CREATE TABLE IF NOT EXISTS completed_games (
            result_id VARCHAR(64) PRIMARY KEY,
            owner_id UUID NOT NULL REFERENCES guests(id),
            game_id VARCHAR(128) NOT NULL UNIQUE,
            completed_at TIMESTAMPTZ NOT NULL,
            rule_version VARCHAR(64) NOT NULL,
            ai_type VARCHAR(32) NOT NULL,
            ai_strategy_version VARCHAR(32) NOT NULL,
            payload JSONB NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );

          CREATE INDEX IF NOT EXISTS idx_completed_games_owner_completed
            ON completed_games (owner_id, completed_at DESC);

          CREATE TABLE IF NOT EXISTS shares (
            share_id VARCHAR(64) PRIMARY KEY,
            result_id VARCHAR(64) NOT NULL REFERENCES completed_games(result_id),
            owner_id UUID NOT NULL REFERENCES guests(id),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT uq_shares_result_id UNIQUE (result_id)
          );

          INSERT INTO schema_migrations (version) VALUES (1);
        `);
      }

      const migration2Check = await client.query(
        'SELECT version FROM schema_migrations WHERE version = 2'
      );

      if (migration2Check.rows.length === 0) {
        await client.query(`
          CREATE TABLE IF NOT EXISTS completed_duels (
            result_id VARCHAR(64) PRIMARY KEY,
            match_id VARCHAR(128) NOT NULL UNIQUE,
            guest0_id UUID NOT NULL REFERENCES guests(id),
            guest1_id UUID NOT NULL REFERENCES guests(id),
            completed_at TIMESTAMPTZ NOT NULL,
            rule_version VARCHAR(64) NOT NULL,
            payload JSONB NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );

          CREATE INDEX IF NOT EXISTS idx_completed_duels_guest0_completed
            ON completed_duels (guest0_id, completed_at DESC);

          CREATE INDEX IF NOT EXISTS idx_completed_duels_guest1_completed
            ON completed_duels (guest1_id, completed_at DESC);

          INSERT INTO schema_migrations (version) VALUES (2);
        `);
      }

      const migration3Check = await client.query(
        'SELECT version FROM schema_migrations WHERE version = 3'
      );

      if (migration3Check.rows.length === 0) {
        await client.query(`
          CREATE TABLE IF NOT EXISTS completed_auctions (
            result_id VARCHAR(64) PRIMARY KEY,
            match_id VARCHAR(128) NOT NULL UNIQUE,
            completed_at TIMESTAMPTZ NOT NULL,
            rule_version VARCHAR(64) NOT NULL,
            participant_guest_ids UUID[] NOT NULL,
            payload JSONB NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );

          CREATE INDEX IF NOT EXISTS idx_completed_auctions_participants
            ON completed_auctions USING GIN (participant_guest_ids);

          CREATE INDEX IF NOT EXISTS idx_completed_auctions_completed
            ON completed_auctions (completed_at DESC);

          CREATE TABLE IF NOT EXISTS auction_shares (
            share_id VARCHAR(64) PRIMARY KEY,
            result_id VARCHAR(64) NOT NULL REFERENCES completed_auctions(result_id),
            owner_id UUID NOT NULL REFERENCES guests(id),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT uq_auction_shares_result_id UNIQUE (result_id)
          );

          INSERT INTO schema_migrations (version) VALUES (3);
        `);
      }

      const migration4Check = await client.query(
        'SELECT version FROM schema_migrations WHERE version = 4'
      );

      if (migration4Check.rows.length === 0) {
        await client.query(`
          CREATE TABLE IF NOT EXISTS seasons (
            id VARCHAR(64) PRIMARY KEY,
            name VARCHAR(128) NOT NULL,
            rule_version VARCHAR(64) NOT NULL DEFAULT 'season-v1',
            start_at TIMESTAMPTZ NOT NULL,
            end_at TIMESTAMPTZ NOT NULL,
            status VARCHAR(32) NOT NULL DEFAULT 'active',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );

          CREATE INDEX IF NOT EXISTS idx_seasons_status_time
            ON seasons (status, start_at, end_at);

          CREATE TABLE IF NOT EXISTS ranking_profiles (
            season_id VARCHAR(64) NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
            guest_id UUID NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
            elo INT NOT NULL DEFAULT 1000,
            matches_played INT NOT NULL DEFAULT 0,
            wins INT NOT NULL DEFAULT 0,
            losses INT NOT NULL DEFAULT 0,
            draws INT NOT NULL DEFAULT 0,
            forfeits INT NOT NULL DEFAULT 0,
            net_profit BIGINT NOT NULL DEFAULT 0,
            challenger_profit BIGINT NOT NULL DEFAULT 0,
            banker_profit BIGINT NOT NULL DEFAULT 0,
            role_balance_return_rate DOUBLE PRECISION NOT NULL DEFAULT 0.0,
            is_risk_excluded BOOLEAN NOT NULL DEFAULT FALSE,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (season_id, guest_id)
          );

          CREATE INDEX IF NOT EXISTS idx_ranking_profiles_leaderboard
            ON ranking_profiles (season_id, is_risk_excluded, elo DESC, net_profit DESC);

          CREATE INDEX IF NOT EXISTS idx_ranking_profiles_guest
            ON ranking_profiles (guest_id);

          CREATE TABLE IF NOT EXISTS reports (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            reporter_guest_id UUID NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
            target_type VARCHAR(32) NOT NULL,
            target_id VARCHAR(128) NOT NULL,
            category VARCHAR(64) NOT NULL,
            reason TEXT NOT NULL DEFAULT '',
            ip_fingerprint VARCHAR(64) NOT NULL,
            status VARCHAR(32) NOT NULL DEFAULT 'pending',
            resolution_notes TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            resolved_at TIMESTAMPTZ,
            CONSTRAINT uq_reports_reporter_target_category UNIQUE (reporter_guest_id, target_type, target_id, category)
          );

          CREATE INDEX IF NOT EXISTS idx_reports_status_created
            ON reports (status, created_at DESC);

          CREATE INDEX IF NOT EXISTS idx_reports_target
            ON reports (target_type, target_id);

          CREATE INDEX IF NOT EXISTS idx_reports_ip
            ON reports (ip_fingerprint, created_at DESC);

          CREATE TABLE IF NOT EXISTS risk_flags (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            guest_id UUID NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
            flag_type VARCHAR(64) NOT NULL,
            severity VARCHAR(32) NOT NULL DEFAULT 'medium',
            reason TEXT NOT NULL DEFAULT '',
            ip_fingerprint VARCHAR(64),
            metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );

          CREATE INDEX IF NOT EXISTS idx_risk_flags_guest_active
            ON risk_flags (guest_id, is_active);

          CREATE INDEX IF NOT EXISTS idx_risk_flags_ip_active
            ON risk_flags (ip_fingerprint, is_active);

          CREATE TABLE IF NOT EXISTS admin_audit_logs (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            admin_id VARCHAR(64) NOT NULL DEFAULT 'system_admin',
            action VARCHAR(64) NOT NULL,
            target_type VARCHAR(64) NOT NULL,
            target_id VARCHAR(128) NOT NULL,
            details JSONB NOT NULL DEFAULT '{}'::jsonb,
            ip_fingerprint VARCHAR(64),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );

          CREATE INDEX IF NOT EXISTS idx_audit_logs_created
            ON admin_audit_logs (created_at DESC);

          CREATE INDEX IF NOT EXISTS idx_audit_logs_action
            ON admin_audit_logs (action, created_at DESC);

          CREATE TABLE IF NOT EXISTS runtime_configs (
            key VARCHAR(128) PRIMARY KEY,
            value JSONB NOT NULL,
            version INT NOT NULL DEFAULT 1,
            description TEXT DEFAULT '',
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_by VARCHAR(64) NOT NULL DEFAULT 'system'
          );

          INSERT INTO seasons (id, name, rule_version, start_at, end_at, status)
          VALUES ('season-1', 'Season 1 (V1.0)', 'season-v1', NOW(), NOW() + INTERVAL '28 days', 'active')
          ON CONFLICT (id) DO NOTHING;

          INSERT INTO runtime_configs (key, value, version, description)
          VALUES ('themes', '{"activeTheme":"classic","availableThemes":["classic","starry-neon"]}'::jsonb, 1, 'Theme configurations')
          ON CONFLICT (key) DO NOTHING;

          INSERT INTO schema_migrations (version) VALUES (4);
        `);
      }

      const migration5Check = await client.query(
        'SELECT version FROM schema_migrations WHERE version = 5'
      );

      if (migration5Check.rows.length === 0) {
        await client.query(`
          CREATE TABLE IF NOT EXISTS completed_survivors (
            result_id VARCHAR(64) PRIMARY KEY,
            match_id VARCHAR(128) NOT NULL UNIQUE,
            completed_at TIMESTAMPTZ NOT NULL,
            rule_version VARCHAR(64) NOT NULL,
            participant_guest_ids UUID[] NOT NULL,
            payload JSONB NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );

          CREATE INDEX IF NOT EXISTS idx_completed_survivors_participants
            ON completed_survivors USING GIN (participant_guest_ids);

          CREATE INDEX IF NOT EXISTS idx_completed_survivors_completed
            ON completed_survivors (completed_at DESC);

          INSERT INTO schema_migrations (version) VALUES (5);
        `);
      }

      const migration6Check = await client.query(
        'SELECT version FROM schema_migrations WHERE version = 6'
      );

      if (migration6Check.rows.length === 0) {
        await client.query(`
          CREATE TABLE IF NOT EXISTS completed_tournaments (
            result_id VARCHAR(64) PRIMARY KEY,
            tournament_id VARCHAR(128) NOT NULL UNIQUE,
            completed_at TIMESTAMPTZ NOT NULL,
            rule_version VARCHAR(64) NOT NULL,
            participant_guest_ids UUID[] NOT NULL,
            payload JSONB NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );

          CREATE INDEX IF NOT EXISTS idx_completed_tournaments_participants
            ON completed_tournaments USING GIN (participant_guest_ids);

          CREATE INDEX IF NOT EXISTS idx_completed_tournaments_completed
            ON completed_tournaments (completed_at DESC);

          INSERT INTO schema_migrations (version) VALUES (6);
        `);
      }

      const migration7Check = await client.query(
        'SELECT version FROM schema_migrations WHERE version = 7'
      );

      if (migration7Check.rows.length === 0) {
        await client.query(`
          CREATE TABLE IF NOT EXISTS guest_risk_signals (
            guest_id UUID NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
            ip_fingerprint VARCHAR(64) NOT NULL,
            device_fingerprint VARCHAR(64) NOT NULL,
            first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (guest_id, ip_fingerprint, device_fingerprint)
          );

          CREATE INDEX IF NOT EXISTS idx_guest_risk_signals_ip
            ON guest_risk_signals (ip_fingerprint, last_seen_at DESC);

          CREATE INDEX IF NOT EXISTS idx_guest_risk_signals_device
            ON guest_risk_signals (device_fingerprint, last_seen_at DESC);

          INSERT INTO schema_migrations (version) VALUES (7);
        `);
      }

      const migration8Check = await client.query(
        'SELECT version FROM schema_migrations WHERE version = 8'
      );

      if (migration8Check.rows.length === 0) {
        await client.query(`
          CREATE TABLE IF NOT EXISTS guest_achievements (
            guest_id UUID NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
            achievement_id VARCHAR(64) NOT NULL,
            unlocked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
            PRIMARY KEY (guest_id, achievement_id)
          );

          CREATE INDEX IF NOT EXISTS idx_guest_achievements_unlocked
            ON guest_achievements (guest_id, unlocked_at DESC);

          INSERT INTO schema_migrations (version) VALUES (8);
        `);
      }

      const migration9Check = await client.query(
        'SELECT version FROM schema_migrations WHERE version = 9'
      );

      if (migration9Check.rows.length === 0) {
        await client.query(`
          ALTER TABLE ranking_profiles
            ADD COLUMN IF NOT EXISTS survivor_games INT NOT NULL DEFAULT 0,
            ADD COLUMN IF NOT EXISTS survivor_wins INT NOT NULL DEFAULT 0,
            ADD COLUMN IF NOT EXISTS tournament_games INT NOT NULL DEFAULT 0,
            ADD COLUMN IF NOT EXISTS tournament_wins INT NOT NULL DEFAULT 0;
          INSERT INTO schema_migrations (version) VALUES (9);
        `);
      }

      const migration10Check = await client.query(
        'SELECT version FROM schema_migrations WHERE version = 10'
      );

      if (migration10Check.rows.length === 0) {
        await client.query(`
          CREATE TABLE IF NOT EXISTS multiplayer_shares (
            share_id VARCHAR(64) PRIMARY KEY,
            mode VARCHAR(32) NOT NULL,
            result_id VARCHAR(64) NOT NULL,
            owner_id UUID NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT uq_multiplayer_shares_result UNIQUE (mode, result_id)
          );
          CREATE INDEX IF NOT EXISTS idx_multiplayer_shares_result
            ON multiplayer_shares (mode, result_id);
          INSERT INTO schema_migrations (version) VALUES (10);
        `);
      }

      const migration11Check = await client.query(
        'SELECT version FROM schema_migrations WHERE version = 11'
      );

      if (migration11Check.rows.length === 0) {
        await client.query(`
          CREATE TABLE IF NOT EXISTS analytics_events (
            id BIGSERIAL PRIMARY KEY,
            event_name VARCHAR(64) NOT NULL,
            mode VARCHAR(32),
            guest_id UUID REFERENCES guests(id) ON DELETE SET NULL,
            match_id VARCHAR(128),
            occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
            dedupe_key VARCHAR(192) UNIQUE
          );
          CREATE INDEX IF NOT EXISTS idx_analytics_events_occurred
            ON analytics_events (occurred_at DESC);
          CREATE INDEX IF NOT EXISTS idx_analytics_events_name_mode
            ON analytics_events (event_name, mode, occurred_at DESC);
          CREATE INDEX IF NOT EXISTS idx_analytics_events_guest
            ON analytics_events (guest_id, occurred_at DESC);
          INSERT INTO schema_migrations (version) VALUES (11);
        `);
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Healthcheck verifies connectivity and that schema migrations have been applied.
   * Cleans up timer on completion to avoid hanging event loop.
   */
  public async isHealthy(): Promise<boolean> {
    let timer: NodeJS.Timeout | null = null;
    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('DB healthcheck timeout')), 2000);
      });
      const res = await Promise.race([
        this.pool.query('SELECT 1 as ok FROM schema_migrations WHERE version >= 11 ORDER BY version DESC LIMIT 1'),
        timeoutPromise
      ]);
      return Boolean(res && res.rows && res.rows.length > 0);
    } catch {
      return false;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  public async unlockAchievement(
    guestId: string,
    achievementId: AchievementId,
    metadata: Record<string, unknown> = {}
  ): Promise<AchievementItem | null> {
    const definition = ACHIEVEMENT_DEFINITIONS.find((item) => item.id === achievementId);
    if (!definition) return null;
    const res = await this.pool.query<{ unlocked_at: Date; metadata: Record<string, unknown> }>(
      `INSERT INTO guest_achievements (guest_id, achievement_id, metadata)
       VALUES ($1, $2, $3)
       ON CONFLICT (guest_id, achievement_id) DO UPDATE SET metadata = guest_achievements.metadata
       RETURNING unlocked_at, metadata`,
      [guestId, achievementId, JSON.stringify(metadata)]
    );
    const row = res.rows[0];
    return {
      id: definition.id,
      name: definition.name,
      description: definition.description,
      unlockedAt: new Date(row.unlocked_at).getTime(),
      metadata: row.metadata || {}
    };
  }

  public async getAchievementsForGuest(guestId: string): Promise<AchievementItem[]> {
    const res = await this.pool.query<{ achievement_id: AchievementId; unlocked_at: Date; metadata: Record<string, unknown> }>(
      `SELECT achievement_id, unlocked_at, metadata
       FROM guest_achievements WHERE guest_id = $1 ORDER BY unlocked_at DESC`,
      [guestId]
    );
    return res.rows.flatMap((row) => {
      const definition = ACHIEVEMENT_DEFINITIONS.find((item) => item.id === row.achievement_id);
      return definition ? [{ id: definition.id, name: definition.name, description: definition.description, unlockedAt: new Date(row.unlocked_at).getTime(), metadata: row.metadata || {} }] : [];
    });
  }

  private async awardCompletionAchievements(guestIds: string[], ids: AchievementId[], metadata: Record<string, unknown> = {}): Promise<void> {
    await Promise.all(guestIds.filter(Boolean).flatMap((guestId) => ids.map((id) => this.unlockAchievement(guestId, id, metadata).catch(() => null))));
  }

  private async updateModeStats(
    seasonId: string,
    guestIds: string[],
    mode: 'survivor' | 'tournament',
    winnerGuestId: string | null,
    record?: { isPrivate?: boolean; ranked?: boolean }
  ): Promise<void> {
    // Private/unranked rooms remain in history but must not affect official season stats.
    if (record?.isPrivate === true || record?.ranked === false) return;
    const gameColumn = mode === 'survivor' ? 'survivor_games' : 'tournament_games';
    const winColumn = mode === 'survivor' ? 'survivor_wins' : 'tournament_wins';
    for (const guestId of guestIds.filter(Boolean)) {
      await this.getOrCreateRankingProfile(seasonId, guestId);
      await this.pool.query(
        `UPDATE ranking_profiles
         SET ${gameColumn} = ${gameColumn} + 1,
             ${winColumn} = ${winColumn} + $3,
             updated_at = NOW()
         WHERE season_id = $1 AND guest_id = $2`,
        [seasonId, guestId, winnerGuestId === guestId ? 1 : 0]
      );
    }
  }

  public async getGuestByTokenHash(tokenHash: string): Promise<GuestRow | null> {
    const res = await this.pool.query<GuestRow>(
      'SELECT id, token_hash FROM guests WHERE token_hash = $1',
      [tokenHash]
    );
    return res.rows[0] || null;
  }

  public async createGuest(tokenHash: string): Promise<GuestRow> {
    const res = await this.pool.query<GuestRow>(
      'INSERT INTO guests (token_hash) VALUES ($1) RETURNING id, token_hash',
      [tokenHash]
    );
    void this.recordAnalyticsEvent({
      eventName: 'guest_created',
      guestId: res.rows[0].id,
      dedupeKey: `guest_created:${res.rows[0].id}`
    }).catch(() => {});
    return res.rows[0];
  }

  public async touchGuest(guestId: string): Promise<void> {
    try {
      await this.pool.query(
        'UPDATE guests SET last_seen_at = NOW() WHERE id = $1',
        [guestId]
      );
    } catch {
      // Non-critical, ignore error
    }
  }

  public async recordAnalyticsEvent(data: {
    eventName: string;
    mode?: string | null;
    guestId?: string | null;
    matchId?: string | null;
    metadata?: Record<string, unknown>;
    dedupeKey?: string | null;
  }): Promise<void> {
    if (!/^[a-z0-9_.-]{1,64}$/i.test(data.eventName)) return;
    await this.pool.query(
      `INSERT INTO analytics_events (event_name, mode, guest_id, match_id, metadata, dedupe_key)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (dedupe_key) DO NOTHING`,
      [
        data.eventName,
        data.mode ?? null,
        data.guestId ?? null,
        data.matchId ?? null,
        JSON.stringify(data.metadata || {}),
        data.dedupeKey ?? null
      ]
    );
  }

  private recordMatchCompletionAnalytics(
    mode: string,
    matchId: string,
    resultId: string,
    guestIds: string[],
    metadata: Record<string, unknown> = {}
  ): void {
    for (const guestId of guestIds.filter(Boolean)) {
      void this.recordAnalyticsEvent({
        eventName: 'match_completed',
        mode,
        guestId,
        matchId,
        metadata,
        dedupeKey: `match_completed:${mode}:${resultId}:${guestId}`
      }).catch(() => {});
    }
  }

  public async getAnalyticsSummary(windowDays = 30): Promise<AnalyticsSummary> {
    const days = Math.max(1, Math.min(90, Number.isSafeInteger(windowDays) ? windowDays : 30));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const [totalsRes, modeRes, dailyRes, retentionRes] = await Promise.all([
      this.pool.query<{ events: string; unique_guests: string; completed_matches: string }>(
        `SELECT count(*) AS events,
                count(DISTINCT guest_id) AS unique_guests,
                count(*) FILTER (WHERE event_name = 'match_completed') AS completed_matches
         FROM analytics_events WHERE occurred_at >= $1`,
        [since]
      ),
      this.pool.query<{ mode: string; events: string; completed: string; unique_guests: string }>(
        `SELECT COALESCE(mode, 'unknown') AS mode,
                count(*) AS events,
                count(*) FILTER (WHERE event_name = 'match_completed') AS completed,
                count(DISTINCT guest_id) AS unique_guests
         FROM analytics_events WHERE occurred_at >= $1
         GROUP BY COALESCE(mode, 'unknown') ORDER BY events DESC`,
        [since]
      ),
      this.pool.query<{ day: string; event_name: string; mode: string | null; count: string; unique_guests: string }>(
        `SELECT to_char(date_trunc('day', occurred_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
                event_name, mode, count(*) AS count, count(DISTINCT guest_id) AS unique_guests
         FROM analytics_events WHERE occurred_at >= $1
         GROUP BY 1, event_name, mode ORDER BY day ASC, event_name ASC, mode ASC NULLS FIRST`,
        [since]
      ),
      this.pool.query<{ eligible_1d: string; retained_1d: string; eligible_7d: string; retained_7d: string; eligible_30d: string; retained_30d: string }>(
        `SELECT
           count(*) FILTER (WHERE created_at <= NOW() - INTERVAL '1 day') AS eligible_1d,
           count(*) FILTER (WHERE created_at <= NOW() - INTERVAL '1 day' AND last_seen_at >= created_at + INTERVAL '1 day') AS retained_1d,
           count(*) FILTER (WHERE created_at <= NOW() - INTERVAL '7 days') AS eligible_7d,
           count(*) FILTER (WHERE created_at <= NOW() - INTERVAL '7 days' AND last_seen_at >= created_at + INTERVAL '7 days') AS retained_7d,
           count(*) FILTER (WHERE created_at <= NOW() - INTERVAL '30 days') AS eligible_30d,
           count(*) FILTER (WHERE created_at <= NOW() - INTERVAL '30 days' AND last_seen_at >= created_at + INTERVAL '30 days') AS retained_30d
         FROM guests`
      )
    ]);
    const totals = totalsRes.rows[0];
    const retention = retentionRes.rows[0];
    return {
      generatedAt: Date.now(),
      windowDays: days,
      totals: {
        events: Number(totals?.events || 0),
        uniqueGuests: Number(totals?.unique_guests || 0),
        completedMatches: Number(totals?.completed_matches || 0)
      },
      byMode: modeRes.rows.map((row) => ({
        mode: row.mode,
        events: Number(row.events || 0),
        completed: Number(row.completed || 0),
        uniqueGuests: Number(row.unique_guests || 0)
      })),
      daily: dailyRes.rows.map((row) => ({
        day: row.day,
        eventName: row.event_name,
        mode: row.mode,
        count: Number(row.count || 0),
        uniqueGuests: Number(row.unique_guests || 0)
      })),
      retention: {
        eligible1d: Number(retention?.eligible_1d || 0),
        retained1d: Number(retention?.retained_1d || 0),
        eligible7d: Number(retention?.eligible_7d || 0),
        retained7d: Number(retention?.retained_7d || 0),
        eligible30d: Number(retention?.eligible_30d || 0),
        retained30d: Number(retention?.retained_30d || 0)
      }
    };
  }

  /** Store only keyed risk fingerprints; never persist raw request headers or IPs. */
  public async recordGuestRiskSignal(data: {
    guestId: string;
    ipFingerprint: string;
    deviceFingerprint: string;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO guest_risk_signals (
        guest_id, ip_fingerprint, device_fingerprint, first_seen_at, last_seen_at
      ) VALUES ($1, $2, $3, NOW(), NOW())
      ON CONFLICT (guest_id, ip_fingerprint, device_fingerprint)
      DO UPDATE SET last_seen_at = NOW()`,
      [data.guestId, data.ipFingerprint, data.deviceFingerprint]
    );
  }

  private async ensureAutomaticRiskFlag(data: {
    guestId: string;
    signalKey: string;
    reason: string;
    metadata: Record<string, unknown>;
  }): Promise<void> {
    const existing = await this.pool.query(
      `SELECT id FROM risk_flags
       WHERE guest_id = $1
         AND flag_type = 'MATCH_FIXING'
         AND is_active = TRUE
         AND metadata ->> 'signalKey' = $2
       LIMIT 1`,
      [data.guestId, data.signalKey]
    );
    if (existing.rows.length > 0) return;

    await this.createRiskFlag({
      guestId: data.guestId,
      flagType: 'MATCH_FIXING',
      severity: 'medium',
      reason: data.reason,
      metadata: { ...data.metadata, signalKey: data.signalKey },
      excludeRanking: true
    });
  }

  /**
   * Detects a high-confidence repeated-opponent signal without changing game
   * state. A flag requires both a shared network/device fingerprint and at
   * least five completed matches in the last 24 hours.
   */
  public async evaluateRepeatedOpponentRisk(data: {
    guestIds: string[];
    matchId: string;
    mode: 'duel' | 'auction' | 'survivor' | 'tournament';
    /** Optional authoritative result used only for server-side concession signals. */
    record?: unknown;
  }): Promise<void> {
    const guestIds = [...new Set(data.guestIds)].filter(Boolean);
    if (guestIds.length < 2) return;

    // A concession signal is deliberately narrow: it requires at least two
    // accepted bids above the revealed box value, with a negative capitalist
    // profit. It never changes the result; it only adds an auditable ranking
    // exclusion signal after the authoritative record has been stored.
    const concessionRoundsByPair = new Map<string, number>();
    const addConcession = (first: unknown, second: unknown) => {
      if (typeof first !== 'string' || typeof second !== 'string' || !first || !second || first === second) return;
      const key = [first, second].sort().join(':');
      concessionRoundsByPair.set(key, (concessionRoundsByPair.get(key) || 0) + 1);
    };
    const rounds = (data.record as any)?.result?.rounds;
    if (Array.isArray(rounds) && data.mode === 'duel') {
      for (const round of rounds) {
        const accepted = Number(round?.acceptedOfferAmount);
        const boxAmount = Number(round?.originalPlayerBoxAmount);
        const bankerProfit = Number(round?.bankerProfit);
        if (round?.outcomeType === 'OFFER_ACCEPTED' && Number.isFinite(accepted) && Number.isFinite(boxAmount) && Number.isFinite(bankerProfit) && accepted > boxAmount && bankerProfit < 0) {
          addConcession(guestIds[0], guestIds[1]);
        }
      }
    } else if (Array.isArray(rounds) && data.mode === 'auction') {
      const seats = Array.isArray((data.record as any)?.seats) ? (data.record as any).seats : [];
      const guestForSeat = (seatId: unknown) => seats.find((seat: any) => seat?.seatId === seatId)?.guestId;
      for (const round of rounds) {
        const winningSeat = round?.winningCapitalistSeatId;
        const winningBid = Number(round?.winningBidAmount);
        const boxAmount = Number(round?.originalPlayerBoxAmount);
        const profit = Number(round?.capitalistProfits?.[winningSeat]);
        const challengerGuest = guestForSeat(round?.challengerSeatId);
        const winningGuest = guestForSeat(winningSeat);
        if (round?.outcomeType === 'OFFER_ACCEPTED' && winningSeat !== null && winningSeat !== undefined && Number.isFinite(winningBid) && Number.isFinite(boxAmount) && Number.isFinite(profit) && winningBid > boxAmount && profit < 0) {
          addConcession(challengerGuest, winningGuest);
        }
      }
    }

    for (let i = 0; i < guestIds.length; i += 1) {
      for (let j = i + 1; j < guestIds.length; j += 1) {
        const first = guestIds[i];
        const second = guestIds[j];
        const frequencyQuery = data.mode === 'duel'
          ? `SELECT count(*)::int AS count FROM completed_duels
             WHERE completed_at > NOW() - INTERVAL '24 hours'
               AND ((guest0_id = $1 AND guest1_id = $2) OR (guest0_id = $2 AND guest1_id = $1))`
          : data.mode === 'auction'
            ? `SELECT count(*)::int AS count FROM completed_auctions
               WHERE completed_at > NOW() - INTERVAL '24 hours'
                 AND participant_guest_ids @> ARRAY[$1::uuid, $2::uuid]`
            : data.mode === 'survivor'
              ? `SELECT count(*)::int AS count FROM completed_survivors
                 WHERE completed_at > NOW() - INTERVAL '24 hours'
                   AND participant_guest_ids @> ARRAY[$1::uuid, $2::uuid]`
              : `SELECT count(*)::int AS count FROM completed_tournaments
                 WHERE completed_at > NOW() - INTERVAL '24 hours'
                   AND participant_guest_ids @> ARRAY[$1::uuid, $2::uuid]`;
        const [frequencyRes, sharedRes] = await Promise.all([
          this.pool.query<{ count: number }>(frequencyQuery, [first, second]),
          this.pool.query<{ count: number }>(
            `SELECT count(*)::int AS count
             FROM guest_risk_signals a
             JOIN guest_risk_signals b
               ON (a.ip_fingerprint <> '' AND a.ip_fingerprint = b.ip_fingerprint)
               OR (a.device_fingerprint <> '' AND a.device_fingerprint = b.device_fingerprint)
             WHERE a.guest_id = $1 AND b.guest_id = $2`,
            [first, second]
          )
        ]);

        const frequency = Number(frequencyRes.rows[0]?.count || 0);
        const sharedFingerprints = Number(sharedRes.rows[0]?.count || 0);
        if (frequency < 5 || sharedFingerprints < 1) continue;

        const signalKey = `${data.mode}:${[first, second].sort().join(':')}`;
        const metadata = {
          matchId: data.matchId,
          mode: data.mode,
          frequency24h: frequency,
          sharedFingerprintMatches: sharedFingerprints,
          generatedBy: 'automatic-repeated-opponent-v1'
        };
        const reason = '自动风控信号：同设备或同网络且 24 小时内高频固定对手';
        await Promise.all([
          this.ensureAutomaticRiskFlag({ guestId: first, signalKey, reason, metadata }),
          this.ensureAutomaticRiskFlag({ guestId: second, signalKey, reason, metadata })
        ]);

        const concessionRounds = concessionRoundsByPair.get([first, second].sort().join(':')) || 0;
        if (concessionRounds >= 2) {
          const concessionSignalKey = `${signalKey}:concession`;
          const concessionMetadata = {
            ...metadata,
            concessionRounds,
            generatedBy: 'automatic-concession-v1'
          };
          const concessionReason = '自动风控信号：固定对手重复出现高于箱值的成交报价且资本家负收益';
          await Promise.all([
            this.ensureAutomaticRiskFlag({ guestId: first, signalKey: concessionSignalKey, reason: concessionReason, metadata: concessionMetadata }),
            this.ensureAutomaticRiskFlag({ guestId: second, signalKey: concessionSignalKey, reason: concessionReason, metadata: concessionMetadata })
          ]);
        }
      }
    }
  }

  /**
   * Concurrency-safe completed game insertion using INSERT ON CONFLICT DO NOTHING RETURNING.
   * When uninserted due to existing record, checks existing record:
   * Returns matched: true ONLY IF ownerId, resultId, gameId, and payload JSON match exactly.
   * Otherwise returns conflictOwner: true (conflict/mismatch) to trigger quarantine.
   */
  public async insertCompletedGame(item: {
    resultId: string;
    ownerId: string;
    gameId: string;
    completedAt: number;
    ruleVersion: string;
    aiType: string;
    aiStrategyVersion: string;
    record: CompletedGameRecord;
  }): Promise<{ inserted: boolean; conflictOwner?: boolean; matched?: boolean }> {
    let wasInserted = false;
    const client = await this.pool.connect();
    try {
      let insertRes;
      try {
        insertRes = await client.query<{ result_id: string }>(
          `INSERT INTO completed_games (
            result_id,
            owner_id,
            game_id,
            completed_at,
            rule_version,
            ai_type,
            ai_strategy_version,
            payload
          ) VALUES (
            $1, $2, $3, to_timestamp($4 / 1000.0), $5, $6, $7, $8
          )
          ON CONFLICT (result_id) DO NOTHING
          RETURNING result_id`,
          [
            item.resultId,
            item.ownerId,
            item.gameId,
            item.completedAt,
            item.ruleVersion,
            item.aiType,
            item.aiStrategyVersion,
            JSON.stringify(item.record)
          ]
        );
      } catch (insertErr: any) {
        if (insertErr && insertErr.code === '23505') {
          // Unique violation (e.g. on game_id)
          insertRes = { rows: [] };
        } else {
          throw insertErr;
        }
      }

      if (insertRes.rows && insertRes.rows.length > 0) {
        wasInserted = true;
      } else {
        // Record was not inserted: verify existing rows by result_id or game_id
        const checkRes = await client.query<{
          result_id: string;
          owner_id: string;
          game_id: string;
          completed_at: Date;
          rule_version: string;
          ai_type: string;
          ai_strategy_version: string;
          payload: any;
        }>(
          'SELECT result_id, owner_id, game_id, completed_at, rule_version, ai_type, ai_strategy_version, payload FROM completed_games WHERE result_id = $1 OR game_id = $2',
          [item.resultId, item.gameId]
        );

        if (checkRes.rows.length !== 1) {
          return { inserted: false, conflictOwner: true, matched: false };
        }

        const existing = checkRes.rows[0];
        const isOwnerMatch = existing.owner_id === item.ownerId;
        const isResultMatch = existing.result_id === item.resultId;
        const isGameMatch = existing.game_id === item.gameId;
        const isRuleMatch = existing.rule_version === item.ruleVersion;
        const isAiMatch = existing.ai_type === item.aiType;
        const isAiVerMatch = existing.ai_strategy_version === item.aiStrategyVersion;

        // Deep compare payload JSON using canonicalJson for stable key comparison
        const isPayloadMatch =
          canonicalJson(existing.payload) === canonicalJson(item.record);

        if (
          isOwnerMatch &&
          isResultMatch &&
          isGameMatch &&
          isRuleMatch &&
          isAiMatch &&
          isAiVerMatch &&
          isPayloadMatch
        ) {
          return { inserted: false, conflictOwner: false, matched: true };
        } else {
          return { inserted: false, conflictOwner: true, matched: false };
        }
      }
    } finally {
      client.release();
    }

    if (wasInserted) {
      await this.awardCompletionAchievements([item.ownerId], ['first-settlement', 'fairness-check'], { mode: 'classic_26' });
      this.recordMatchCompletionAnalytics('classic_26', item.gameId, item.resultId, [item.ownerId], {
        outcome: item.record.settlement.outcomeType
      });
      return { inserted: true, conflictOwner: false, matched: false };
    }
    return { inserted: false, conflictOwner: true, matched: false };
  }

  public async getHistoryByOwner(
    ownerId: string,
    limit: number,
    offset: number
  ): Promise<{ items: HistorySummaryItem[]; total: number }> {
    const countRes = await this.pool.query<{ count: string }>(
      'SELECT count(*) AS count FROM completed_games WHERE owner_id = $1',
      [ownerId]
    );
    const total = parseInt(countRes.rows[0]?.count || '0', 10);

    const rowsRes = await this.pool.query<{
      result_id: string;
      game_id: string;
      completed_at: Date;
      rule_version: string;
      ai_type: any;
      payload: CompletedGameRecord;
    }>(
      `SELECT result_id, game_id, completed_at, rule_version, ai_type, payload
       FROM completed_games
       WHERE owner_id = $1
       ORDER BY completed_at DESC
       LIMIT $2 OFFSET $3`,
      [ownerId, limit, offset]
    );

    const items: HistorySummaryItem[] = rowsRes.rows.map((row) => {
      const settlement = row.payload.settlement;
      return {
        resultId: row.result_id,
        gameId: row.game_id,
        completedAt: new Date(row.completed_at).getTime(),
        ruleVersion: row.rule_version,
        aiType: row.ai_type,
        wonAmount: settlement.wonAmount,
        outcomeType: settlement.outcomeType,
        originalPlayerBoxId: settlement.originalPlayerBoxId,
        finalPlayerBoxId: settlement.finalPlayerBoxId,
        ...(settlement.acceptedOfferAmount !== undefined
          ? { acceptedOfferAmount: settlement.acceptedOfferAmount }
          : {})
      };
    });

    return { items, total };
  }

  public async getCompletedGame(
    resultId: string,
    ownerId: string
  ): Promise<CompletedGameRecord | null> {
    const res = await this.pool.query<{ payload: CompletedGameRecord }>(
      'SELECT payload FROM completed_games WHERE result_id = $1 AND owner_id = $2',
      [resultId, ownerId]
    );
    return res.rows[0]?.payload || null;
  }

  public async createOrGetShare(
    resultId: string,
    ownerId: string
  ): Promise<{ shareId: string } | null> {
    const gameCheck = await this.pool.query<{ result_id: string }>(
      'SELECT result_id FROM completed_games WHERE result_id = $1 AND owner_id = $2',
      [resultId, ownerId]
    );
    if (gameCheck.rows.length === 0) {
      return null;
    }

    const existing = await this.pool.query<{ share_id: string }>(
      'SELECT share_id FROM shares WHERE result_id = $1',
      [resultId]
    );
    if (existing.rows.length > 0) {
      return { shareId: existing.rows[0].share_id };
    }

    const shareId = crypto.randomBytes(32).toString('hex');
    const insertRes = await this.pool.query<{ share_id: string }>(
      `INSERT INTO shares (share_id, result_id, owner_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (result_id) DO UPDATE SET result_id = EXCLUDED.result_id
       RETURNING share_id`,
      [shareId, resultId, ownerId]
    );

    return { shareId: insertRes.rows[0].share_id };
  }

  public async getPublicShare(shareId: string): Promise<PublicShareSummary | null> {
    const res = await this.pool.query<{
      rule_version: string;
      ai_type: any;
      payload: CompletedGameRecord;
    }>(
      `SELECT cg.rule_version, cg.ai_type, cg.payload
       FROM shares s
       JOIN completed_games cg ON s.result_id = cg.result_id
       WHERE s.share_id = $1`,
      [shareId]
    );

    if (res.rows.length === 0) {
      return null;
    }

    const row = res.rows[0];
    const s = row.payload.settlement;
    return {
      mode: row.rule_version,
      aiType: row.ai_type,
      wonAmount: s.wonAmount,
      originalPlayerBoxId: s.originalPlayerBoxId,
      finalPlayerBoxId: s.finalPlayerBoxId,
      outcomeType: s.outcomeType,
      ...(s.acceptedOfferAmount !== undefined
        ? { acceptedOfferAmount: s.acceptedOfferAmount }
        : {})
    };
  }

  public async insertCompletedDuel(item: {
    resultId: string;
    matchId: string;
    guest0Id: string;
    guest1Id: string;
    completedAt: number;
    ruleVersion: string;
    record: CompletedDuelRecord;
  }): Promise<{ inserted: boolean; conflictOwner?: boolean; matched?: boolean }> {
    let wasInserted = false;
    const client = await this.pool.connect();
    try {
      let insertRes;
      try {
        insertRes = await client.query<{ result_id: string }>(
          `INSERT INTO completed_duels (
            result_id,
            match_id,
            guest0_id,
            guest1_id,
            completed_at,
            rule_version,
            payload
          ) VALUES (
            $1, $2, $3, $4, to_timestamp($5 / 1000.0), $6, $7
          )
          ON CONFLICT (result_id) DO NOTHING
          RETURNING result_id`,
          [
            item.resultId,
            item.matchId,
            item.guest0Id,
            item.guest1Id,
            item.completedAt,
            item.ruleVersion,
            JSON.stringify(item.record)
          ]
        );
      } catch (insertErr: any) {
        if (insertErr && insertErr.code === '23505') {
          insertRes = { rows: [] };
        } else {
          throw insertErr;
        }
      }

      if (insertRes.rows && insertRes.rows.length > 0) {
        wasInserted = true;
      } else {
        const checkRes = await client.query<{
          result_id: string;
          match_id: string;
          guest0_id: string;
          guest1_id: string;
          completed_at: Date;
          rule_version: string;
          payload: any;
        }>(
          'SELECT result_id, match_id, guest0_id, guest1_id, completed_at, rule_version, payload FROM completed_duels WHERE result_id = $1 OR match_id = $2',
          [item.resultId, item.matchId]
        );

        if (checkRes.rows.length !== 1) {
          return { inserted: false, conflictOwner: true, matched: false };
        }

        const existing = checkRes.rows[0];
        const isResultMatch = existing.result_id === item.resultId;
        const isMatchMatch = existing.match_id === item.matchId;
        const isGuest0Match = existing.guest0_id === item.guest0Id;
        const isGuest1Match = existing.guest1_id === item.guest1Id;
        const isRuleMatch = existing.rule_version === item.ruleVersion;
        const isPayloadMatch =
          canonicalJson(existing.payload) === canonicalJson(item.record);

        if (
          isResultMatch &&
          isMatchMatch &&
          isGuest0Match &&
          isGuest1Match &&
          isRuleMatch &&
          isPayloadMatch
        ) {
          return { inserted: false, conflictOwner: false, matched: true };
        } else {
          return { inserted: false, conflictOwner: true, matched: false };
        }
      }
    } finally {
      client.release();
    }

    if (wasInserted) {
      try {
        await this.updateRankingOnDuelSettlement(item);
      } catch (rErr) {
        console.warn('[DatabaseManager] Failed to update ranking on duel:', rErr);
      }
      const winnerGuestId = item.record.result.winnerSeatId === 0 ? item.guest0Id : item.record.result.winnerSeatId === 1 ? item.guest1Id : null;
      const ids: AchievementId[] = ['first-settlement', 'multiplayer', 'fairness-check'];
      if (winnerGuestId) await this.awardCompletionAchievements([winnerGuestId], ['duel-winner']);
      await this.awardCompletionAchievements([item.guest0Id, item.guest1Id], ids, { mode: 'duel_26' });
      if (item.record.isPrivate !== true && item.record.ranked !== false) {
        try {
          await this.evaluateRepeatedOpponentRisk({ guestIds: [item.guest0Id, item.guest1Id], matchId: item.matchId, mode: 'duel', record: item.record });
        } catch (err) {
          console.warn('[DatabaseManager] Failed to evaluate duel concession risk:', err);
        }
      }
      this.recordMatchCompletionAnalytics('duel_26', item.matchId, item.resultId, [item.guest0Id, item.guest1Id], {
        reason: item.record.result.reason,
        ranked: item.record.ranked === true
      });
      return { inserted: true, conflictOwner: false, matched: false };
    }
    return { inserted: false, conflictOwner: true, matched: false };
  }

  public async getDuelHistoryByGuest(
    guestId: string,
    limit: number,
    offset: number
  ): Promise<{ items: DuelHistorySummaryItem[]; total: number }> {
    const countRes = await this.pool.query<{ count: string }>(
      'SELECT count(*) AS count FROM completed_duels WHERE guest0_id = $1 OR guest1_id = $1',
      [guestId]
    );
    const total = parseInt(countRes.rows[0]?.count || '0', 10);

    const rowsRes = await this.pool.query<{
      result_id: string;
      match_id: string;
      guest0_id: string;
      guest1_id: string;
      completed_at: Date;
      rule_version: string;
      payload: CompletedDuelRecord;
    }>(
      `SELECT result_id, match_id, guest0_id, guest1_id, completed_at, rule_version, payload
       FROM completed_duels
       WHERE guest0_id = $1 OR guest1_id = $1
       ORDER BY completed_at DESC
       LIMIT $2 OFFSET $3`,
      [guestId, limit, offset]
    );

    const items: DuelHistorySummaryItem[] = rowsRes.rows.map((row) => {
      const mySeatId: DuelSeatId = row.guest0_id === guestId ? 0 : 1;
      const opponentSeatId: DuelSeatId = mySeatId === 0 ? 1 : 0;
      const record = row.payload;
      const res = record.result;
      const myScore = res.finalScores[mySeatId];
      const opponentScore = res.finalScores[opponentSeatId];
      const myNickname =
        record.seats?.find((s) => s.seatId === mySeatId)?.nickname ?? `玩家${mySeatId + 1}`;
      const opponentNickname =
        record.seats?.find((s) => s.seatId === opponentSeatId)?.nickname ?? `玩家${opponentSeatId + 1}`;
      let outcome: 'WIN' | 'LOSE' | 'DRAW' | 'VOID';
      if (res.reason === 'BOTH_FORFEIT') {
        outcome = 'VOID';
      } else if (res.winnerSeatId === null) {
        outcome = 'DRAW';
      } else if (res.winnerSeatId === mySeatId) {
        outcome = 'WIN';
      } else {
        outcome = 'LOSE';
      }

      return {
        resultId: row.result_id,
        matchId: row.match_id,
        completedAt: new Date(row.completed_at).getTime(),
        ruleVersion: row.rule_version,
        mySeatId,
        myScore,
        opponentScore,
        myNickname,
        opponentNickname,
        winnerSeatId: res.winnerSeatId,
        outcome,
        reason: res.reason
      };
    });

    return { items, total };
  }

  public async getCompletedDuel(
    matchId: string,
    guestId: string
  ): Promise<DuelHistoryDetailResponse | null> {
    const res = await this.pool.query<{
      guest0_id: string;
      guest1_id: string;
      payload: CompletedDuelRecord;
    }>(
      'SELECT guest0_id, guest1_id, payload FROM completed_duels WHERE match_id = $1 AND (guest0_id = $2 OR guest1_id = $2)',
      [matchId, guestId]
    );
    if (res.rows.length === 0) {
      return null;
    }
    const row = res.rows[0];
    const mySeatId: DuelSeatId = row.guest0_id === guestId ? 0 : 1;
    return {
      ...row.payload,
      mySeatId
    };
  }

  public async isDuelHealthy(): Promise<boolean> {
    let timer: NodeJS.Timeout | null = null;
    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('DB healthcheck timeout')), 2000);
      });
      const res = await Promise.race([
        this.pool.query('SELECT 1 as ok FROM schema_migrations WHERE version >= 11 ORDER BY version DESC LIMIT 1'),
        timeoutPromise
      ]);
      return Boolean(res && res.rows && res.rows.length > 0);
    } catch {
      return false;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  public async isAuctionHealthy(): Promise<boolean> {
    let timer: NodeJS.Timeout | null = null;
    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('DB healthcheck timeout')), 2000);
      });
      const res = await Promise.race([
        this.pool.query('SELECT 1 as ok FROM schema_migrations WHERE version >= 11 ORDER BY version DESC LIMIT 1'),
        timeoutPromise
      ]);
      return Boolean(res && res.rows && res.rows.length > 0);
    } catch {
      return false;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  public async insertCompletedAuction(item: {
    resultId: string;
    matchId: string;
    participantGuestIds: string[];
    completedAt: number;
    ruleVersion: string;
    record: CompletedAuctionRecord;
  }): Promise<{ inserted: boolean; conflictOwner?: boolean; matched?: boolean }> {
    let wasInserted = false;
    const client = await this.pool.connect();
    try {
      let insertRes;
      try {
        insertRes = await client.query<{ result_id: string }>(
          `INSERT INTO completed_auctions (
            result_id,
            match_id,
            completed_at,
            rule_version,
            participant_guest_ids,
            payload
          ) VALUES (
            $1, $2, to_timestamp($3 / 1000.0), $4, $5, $6
          )
          ON CONFLICT (result_id) DO NOTHING
          RETURNING result_id`,
          [
            item.resultId,
            item.matchId,
            item.completedAt,
            item.ruleVersion,
            item.participantGuestIds,
            JSON.stringify(item.record)
          ]
        );
      } catch (insertErr: any) {
        if (insertErr && insertErr.code === '23505') {
          insertRes = { rows: [] };
        } else {
          throw insertErr;
        }
      }

      if (insertRes.rows && insertRes.rows.length > 0) {
        wasInserted = true;
      } else {
        const checkRes = await client.query<{
          result_id: string;
          match_id: string;
          participant_guest_ids: string[];
          completed_at: Date;
          rule_version: string;
          payload: any;
        }>(
          'SELECT result_id, match_id, participant_guest_ids, completed_at, rule_version, payload FROM completed_auctions WHERE result_id = $1 OR match_id = $2',
          [item.resultId, item.matchId]
        );

        if (checkRes.rows.length !== 1) {
          return { inserted: false, conflictOwner: true, matched: false };
        }

        const existing = checkRes.rows[0];
        const isResultMatch = existing.result_id === item.resultId;
        const isMatchMatch = existing.match_id === item.matchId;
        const isRuleMatch = existing.rule_version === item.ruleVersion;
        const isGuestsMatch =
          Array.isArray(existing.participant_guest_ids) &&
          existing.participant_guest_ids.length === item.participantGuestIds.length &&
          item.participantGuestIds.every((g) => existing.participant_guest_ids.includes(g));
        const isPayloadMatch =
          canonicalJson(existing.payload) === canonicalJson(item.record);

        if (isResultMatch && isMatchMatch && isRuleMatch && isGuestsMatch && isPayloadMatch) {
          return { inserted: false, conflictOwner: false, matched: true };
        } else {
          return { inserted: false, conflictOwner: true, matched: false };
        }
      }
    } finally {
      client.release();
    }

    if (wasInserted) {
      try {
        await this.updateRankingOnAuctionSettlement(item);
      } catch (rErr) {
        console.warn('[DatabaseManager] Failed to update ranking on auction:', rErr);
      }
      const participantIds = item.participantGuestIds;
      const winnerSeatId = item.record.result.rankings.find((entry) => entry.rank === 1)?.seatId;
      const winnerGuestId = winnerSeatId === undefined ? null : item.record.seats.find((seat) => seat.seatId === winnerSeatId)?.guestId || participantIds[winnerSeatId];
      await this.awardCompletionAchievements(participantIds, ['first-settlement', 'multiplayer', 'fairness-check'], { mode: 'auction_26' });
      if (winnerGuestId) await this.awardCompletionAchievements([winnerGuestId], ['auction-winner']);
      if (item.record.isPrivate !== true && item.record.ranked !== false) {
        try {
          await this.evaluateRepeatedOpponentRisk({ guestIds: participantIds, matchId: item.matchId, mode: 'auction', record: item.record });
        } catch (err) {
          console.warn('[DatabaseManager] Failed to evaluate auction concession risk:', err);
        }
      }
      this.recordMatchCompletionAnalytics('auction_26', item.matchId, item.resultId, participantIds, {
        reason: item.record.result.reason,
        ranked: item.record.ranked === true
      });
      return { inserted: true, conflictOwner: false, matched: false };
    }
    return { inserted: false, conflictOwner: true, matched: false };
  }

  public async getAuctionHistoryByGuest(
    guestId: string,
    limit: number,
    offset: number
  ): Promise<{ items: AuctionHistorySummaryItem[]; total: number }> {
    const countRes = await this.pool.query<{ count: string }>(
      'SELECT count(*) AS count FROM completed_auctions WHERE $1 = ANY(participant_guest_ids)',
      [guestId]
    );
    const total = parseInt(countRes.rows[0]?.count || '0', 10);

    const rowsRes = await this.pool.query<{
      result_id: string;
      match_id: string;
      completed_at: Date;
      rule_version: string;
      payload: CompletedAuctionRecord;
    }>(
      `SELECT result_id, match_id, completed_at, rule_version, payload
       FROM completed_auctions
       WHERE $1 = ANY(participant_guest_ids)
       ORDER BY completed_at DESC
       LIMIT $2 OFFSET $3`,
      [guestId, limit, offset]
    );

    const items: AuctionHistorySummaryItem[] = rowsRes.rows.map((row) => {
      const rec = row.payload;
      const mySeat = rec.seats.find((s) => s.guestId === guestId);
      const mySeatId = mySeat !== undefined ? mySeat.seatId : 0;
      const myScore = rec.result.finalScores[mySeatId] || 0;
      const ranking = rec.result.rankings.find((r) => r.seatId === mySeatId);
      const myRank = ranking ? ranking.rank : rec.seats.length;
      const winnerSeat = rec.result.winnerSeatId !== null
        ? rec.seats.find((s) => s.seatId === rec.result.winnerSeatId)
        : null;

      return {
        resultId: row.result_id,
        matchId: row.match_id,
        completedAt: new Date(row.completed_at).getTime(),
        ruleVersion: row.rule_version,
        mySeatId,
        myScore,
        myRank,
        totalPlayers: rec.seats.length,
        myNickname: mySeat ? mySeat.nickname : `玩家${mySeatId + 1}`,
        winnerSeatId: rec.result.winnerSeatId,
        winnerNickname: winnerSeat ? winnerSeat.nickname : null,
        reason: rec.result.reason
      };
    });

    return { items, total };
  }

  public async getCompletedAuction(
    matchId: string,
    guestId: string
  ): Promise<AuctionHistoryDetailResponse | null> {
    const res = await this.pool.query<{
      payload: CompletedAuctionRecord;
    }>(
      'SELECT payload FROM completed_auctions WHERE match_id = $1 AND $2 = ANY(participant_guest_ids)',
      [matchId, guestId]
    );
    if (res.rows.length === 0) {
      return null;
    }
    const rec = res.rows[0].payload;
    const mySeat = rec.seats.find((s) => s.guestId === guestId);
    const mySeatId = mySeat !== undefined ? mySeat.seatId : 0;

    const sanitizedSeats = rec.seats.map((s) => ({
      seatId: s.seatId,
      nickname: s.nickname
    }));

    return {
      ...rec,
      seats: sanitizedSeats,
      mySeatId
    };
  }

  public async isSurvivorHealthy(): Promise<boolean> {
    try {
      const res = await this.pool.query('SELECT 1 AS ok FROM schema_migrations WHERE version >= 11 ORDER BY version DESC LIMIT 1');
      return res.rows.length > 0;
    } catch {
      return false;
    }
  }

  public async insertCompletedSurvivor(item: {
    resultId: string;
    matchId: string;
    participantGuestIds: string[];
    completedAt: number;
    ruleVersion: string;
    record: CompletedSurvivorRecord;
  }): Promise<{ inserted: boolean; conflictOwner?: boolean; matched?: boolean }> {
    const insertRes = await this.pool.query<{ result_id: string }>(
      `INSERT INTO completed_survivors (result_id, match_id, completed_at, rule_version, participant_guest_ids, payload)
       VALUES ($1, $2, to_timestamp($3 / 1000.0), $4, $5, $6)
       ON CONFLICT (result_id) DO NOTHING
       RETURNING result_id`,
      [item.resultId, item.matchId, item.completedAt, item.ruleVersion, item.participantGuestIds, JSON.stringify(item.record)]
    );
    if (insertRes.rows.length > 0) {
      const winnerSeatId = item.record.result.rankings.find((entry) => entry.rank === 1)?.seatId;
      const winnerGuestId = winnerSeatId === undefined ? null : item.record.seats.find((seat) => seat.seatId === winnerSeatId)?.guestId ?? null;
      await this.awardCompletionAchievements(item.participantGuestIds, ['first-settlement', 'multiplayer', 'fairness-check'], { mode: 'survivor_26' });
      if (winnerGuestId) await this.awardCompletionAchievements([winnerGuestId], ['survivor-winner']);
      if (item.record.isPrivate !== true && item.record.ranked !== false) {
        try { await this.evaluateRepeatedOpponentRisk({ guestIds: item.participantGuestIds, matchId: item.matchId, mode: 'survivor' }); } catch (err) { console.warn('[DatabaseManager] Failed to evaluate survivor risk:', err); }
      }
      const activeSeason = await this.getActiveSeason();
      if (activeSeason) {
        try { await this.updateModeStats(activeSeason.seasonId, item.participantGuestIds, 'survivor', winnerGuestId, item.record); } catch (err) { console.warn('[DatabaseManager] Failed to update survivor stats:', err); }
      }
      this.recordMatchCompletionAnalytics('survivor_26', item.matchId, item.resultId, item.participantGuestIds, {
        ranked: item.record.ranked === true
      });
      return { inserted: true, conflictOwner: false, matched: false };
    }

    const existing = await this.pool.query<{ result_id: string; match_id: string; rule_version: string; participant_guest_ids: string[]; payload: CompletedSurvivorRecord }>(
      'SELECT result_id, match_id, rule_version, participant_guest_ids, payload FROM completed_survivors WHERE result_id = $1 OR match_id = $2',
      [item.resultId, item.matchId]
    );
    if (existing.rows.length !== 1) return { inserted: false, conflictOwner: true, matched: false };
    const row = existing.rows[0];
    const sameGuests = row.participant_guest_ids.length === item.participantGuestIds.length && item.participantGuestIds.every((id) => row.participant_guest_ids.includes(id));
    const matched = row.result_id === item.resultId && row.match_id === item.matchId && row.rule_version === item.ruleVersion && sameGuests && canonicalJson(row.payload) === canonicalJson(item.record);
    return matched ? { inserted: false, conflictOwner: false, matched: true } : { inserted: false, conflictOwner: true, matched: false };
  }

  public async getSurvivorHistoryByGuest(guestId: string, limit: number, offset: number): Promise<{ items: SurvivorHistorySummaryItem[]; total: number }> {
    const count = await this.pool.query<{ count: string }>('SELECT count(*) AS count FROM completed_survivors WHERE $1 = ANY(participant_guest_ids)', [guestId]);
    const rows = await this.pool.query<{ result_id: string; match_id: string; completed_at: Date; rule_version: string; payload: CompletedSurvivorRecord }>(
      `SELECT result_id, match_id, completed_at, rule_version, payload FROM completed_survivors WHERE $1 = ANY(participant_guest_ids) ORDER BY completed_at DESC LIMIT $2 OFFSET $3`,
      [guestId, limit, offset]
    );
    const items = rows.rows.map((row) => {
      const seatId = row.payload.seats.find((s) => s.guestId === guestId)?.seatId ?? 0;
      const ranking = row.payload.result.rankings.find((r) => r.seatId === seatId);
      const winner = row.payload.result.rankings.find((r) => r.rank === 1);
      return { resultId: row.result_id, matchId: row.match_id, completedAt: new Date(row.completed_at).getTime(), ruleVersion: row.rule_version, mySeatId: seatId, myScore: ranking?.score ?? 0, myRank: ranking?.rank ?? row.payload.seats.length, totalPlayers: row.payload.seats.length, winnerSeatId: winner?.seatId ?? null };
    });
    return { items, total: Number(count.rows[0]?.count || 0) };
  }

  public async getCompletedSurvivor(matchId: string, guestId: string): Promise<SurvivorHistoryDetailResponse | null> {
    const res = await this.pool.query<{ payload: CompletedSurvivorRecord }>('SELECT payload FROM completed_survivors WHERE match_id = $1 AND $2 = ANY(participant_guest_ids)', [matchId, guestId]);
    if (res.rows.length === 0) return null;
    const rec = res.rows[0].payload;
    const mySeatId = rec.seats.find((s) => s.guestId === guestId)?.seatId ?? 0;
    return { ...rec, seats: rec.seats.map((s) => ({ seatId: s.seatId, nickname: s.nickname })), mySeatId };
  }

  public async isTournamentHealthy(): Promise<boolean> {
    try {
      const res = await this.pool.query('SELECT 1 AS ok FROM schema_migrations WHERE version >= 11 ORDER BY version DESC LIMIT 1');
      return res.rows.length > 0;
    } catch {
      return false;
    }
  }

  public async insertCompletedTournament(item: {
    resultId: string;
    tournamentId: string;
    participantGuestIds: string[];
    completedAt: number;
    ruleVersion: string;
    record: CompletedTournamentRecord;
  }): Promise<{ inserted: boolean; conflictOwner?: boolean; matched?: boolean }> {
    const insertRes = await this.pool.query<{ result_id: string }>(
      `INSERT INTO completed_tournaments (result_id, tournament_id, completed_at, rule_version, participant_guest_ids, payload)
       VALUES ($1, $2, to_timestamp($3 / 1000.0), $4, $5, $6)
       ON CONFLICT (result_id) DO NOTHING
       RETURNING result_id`,
      [item.resultId, item.tournamentId, item.completedAt, item.ruleVersion, item.participantGuestIds, JSON.stringify(item.record)]
    );
    if (insertRes.rows.length > 0) {
      const winnerSeatId = item.record.result.winnerSeatId;
      const winnerGuestId = winnerSeatId === null || winnerSeatId === undefined ? null : item.record.seats.find((seat) => seat.seatId === winnerSeatId)?.guestId ?? null;
      await this.awardCompletionAchievements(item.participantGuestIds, ['first-settlement', 'multiplayer', 'fairness-check'], { mode: 'tournament_26' });
      if (winnerGuestId) await this.awardCompletionAchievements([winnerGuestId], ['tournament-winner']);
      if (item.record.isPrivate !== true && item.record.ranked !== false) {
        try { await this.evaluateRepeatedOpponentRisk({ guestIds: item.participantGuestIds, matchId: item.tournamentId, mode: 'tournament' }); } catch (err) { console.warn('[DatabaseManager] Failed to evaluate tournament risk:', err); }
      }
      const activeSeason = await this.getActiveSeason();
      if (activeSeason) {
        try { await this.updateModeStats(activeSeason.seasonId, item.participantGuestIds, 'tournament', winnerGuestId, item.record); } catch (err) { console.warn('[DatabaseManager] Failed to update tournament stats:', err); }
      }
      this.recordMatchCompletionAnalytics('tournament_26', item.tournamentId, item.resultId, item.participantGuestIds, {
        ranked: item.record.ranked === true
      });
      return { inserted: true, conflictOwner: false, matched: false };
    }
    const existing = await this.pool.query<{ result_id: string; tournament_id: string; rule_version: string; participant_guest_ids: string[]; payload: CompletedTournamentRecord }>(
      'SELECT result_id, tournament_id, rule_version, participant_guest_ids, payload FROM completed_tournaments WHERE result_id = $1 OR tournament_id = $2',
      [item.resultId, item.tournamentId]
    );
    if (existing.rows.length !== 1) return { inserted: false, conflictOwner: true, matched: false };
    const row = existing.rows[0];
    const sameGuests = row.participant_guest_ids.length === item.participantGuestIds.length && item.participantGuestIds.every((id) => row.participant_guest_ids.includes(id));
    const matched = row.result_id === item.resultId && row.tournament_id === item.tournamentId && row.rule_version === item.ruleVersion && sameGuests && canonicalJson(row.payload) === canonicalJson(item.record);
    return matched ? { inserted: false, conflictOwner: false, matched: true } : { inserted: false, conflictOwner: true, matched: false };
  }

  public async getTournamentHistoryByGuest(guestId: string, limit: number, offset: number): Promise<{ items: TournamentHistorySummaryItem[]; total: number }> {
    const count = await this.pool.query<{ count: string }>('SELECT count(*) AS count FROM completed_tournaments WHERE $1 = ANY(participant_guest_ids)', [guestId]);
    const rows = await this.pool.query<{ result_id: string; tournament_id: string; completed_at: Date; rule_version: string; payload: CompletedTournamentRecord }>(
      `SELECT result_id, tournament_id, completed_at, rule_version, payload FROM completed_tournaments WHERE $1 = ANY(participant_guest_ids) ORDER BY completed_at DESC LIMIT $2 OFFSET $3`,
      [guestId, limit, offset]
    );
    const items = rows.rows.map((row) => {
      const seatId = row.payload.seats.find((seat) => seat.guestId === guestId)?.seatId ?? 0;
      const ranking = row.payload.result.rankings.find((entry) => entry.seatId === seatId);
      const winner = row.payload.result.rankings.find((entry) => entry.rank === 1);
      return { resultId: row.result_id, tournamentId: row.tournament_id, completedAt: new Date(row.completed_at).getTime(), ruleVersion: row.rule_version, mySeatId: seatId, myRank: ranking?.rank ?? row.payload.seats.length, totalPlayers: row.payload.seats.length, winnerSeatId: winner?.seatId ?? null };
    });
    return { items, total: Number(count.rows[0]?.count || 0) };
  }

  public async getCompletedTournament(tournamentId: string, guestId: string): Promise<TournamentHistoryDetailResponse | null> {
    const res = await this.pool.query<{ payload: CompletedTournamentRecord }>('SELECT payload FROM completed_tournaments WHERE tournament_id = $1 AND $2 = ANY(participant_guest_ids)', [tournamentId, guestId]);
    if (res.rows.length === 0) return null;
    const rec = res.rows[0].payload;
    const mySeatId = rec.seats.find((seat) => seat.guestId === guestId)?.seatId ?? 0;
    return { ...rec, seats: rec.seats.map((seat) => ({ seatId: seat.seatId, nickname: seat.nickname })), mySeatId };
  }

  public async createOrGetMultiplayerShare(
    mode: MultiplayerShareMode,
    resultOrMatchId: string,
    guestId: string
  ): Promise<{ shareId: string } | null> {
    if (!['duel', 'survivor', 'tournament'].includes(mode)) return null;
    let resultId: string | null = null;
    if (mode === 'duel') {
      const row = await this.pool.query<{ result_id: string }>(
        `SELECT result_id FROM completed_duels
         WHERE (result_id = $1 OR match_id = $1) AND ($2 = guest0_id OR $2 = guest1_id)`,
        [resultOrMatchId, guestId]
      );
      resultId = row.rows[0]?.result_id || null;
    } else if (mode === 'survivor') {
      const row = await this.pool.query<{ result_id: string }>(
        `SELECT result_id FROM completed_survivors
         WHERE (result_id = $1 OR match_id = $1) AND $2 = ANY(participant_guest_ids)`,
        [resultOrMatchId, guestId]
      );
      resultId = row.rows[0]?.result_id || null;
    } else {
      const row = await this.pool.query<{ result_id: string }>(
        `SELECT result_id FROM completed_tournaments
         WHERE (result_id = $1 OR tournament_id = $1) AND $2 = ANY(participant_guest_ids)`,
        [resultOrMatchId, guestId]
      );
      resultId = row.rows[0]?.result_id || null;
    }
    if (!resultId) return null;

    const existing = await this.pool.query<{ share_id: string }>(
      'SELECT share_id FROM multiplayer_shares WHERE mode = $1 AND result_id = $2',
      [mode, resultId]
    );
    if (existing.rows.length > 0) return { shareId: existing.rows[0].share_id };

    const shareId = crypto.randomBytes(32).toString('hex');
    const inserted = await this.pool.query<{ share_id: string }>(
      `INSERT INTO multiplayer_shares (share_id, mode, result_id, owner_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (mode, result_id) DO UPDATE SET result_id = EXCLUDED.result_id
       RETURNING share_id`,
      [shareId, mode, resultId, guestId]
    );
    return inserted.rows[0] ? { shareId: inserted.rows[0].share_id } : null;
  }

  public async getPublicMultiplayerShare(
    mode: MultiplayerShareMode,
    shareId: string
  ): Promise<MultiplayerShareSummary | null> {
    if (!['duel', 'survivor', 'tournament'].includes(mode)) return null;
    const share = await this.pool.query<{ result_id: string }>(
      'SELECT result_id FROM multiplayer_shares WHERE mode = $1 AND share_id = $2',
      [mode, shareId]
    );
    const resultId = share.rows[0]?.result_id;
    if (!resultId) return null;

    let row: { completed_at: Date; payload: any } | undefined;
    if (mode === 'duel') {
      const result = await this.pool.query<{ completed_at: Date; payload: any }>('SELECT completed_at, payload FROM completed_duels WHERE result_id = $1', [resultId]);
      row = result.rows[0];
    } else if (mode === 'survivor') {
      const result = await this.pool.query<{ completed_at: Date; payload: any }>('SELECT completed_at, payload FROM completed_survivors WHERE result_id = $1', [resultId]);
      row = result.rows[0];
    } else {
      const result = await this.pool.query<{ completed_at: Date; payload: any }>('SELECT completed_at, payload FROM completed_tournaments WHERE result_id = $1', [resultId]);
      row = result.rows[0];
    }
    if (!row) return null;

    const payload = row.payload || {};
    const seats = Array.isArray(payload.seats) ? payload.seats : [];
    const rawRankings = Array.isArray(payload.result?.rankings)
      ? payload.result.rankings
      : (mode === 'duel'
        ? seats.map((seat: any) => ({ seatId: seat.seatId, nickname: seat.nickname, score: Number(payload.result?.finalScores?.[seat.seatId] || 0) }))
        : []);
    const rankings = rawRankings
      .filter((entry: any) => Number.isFinite(entry?.score))
      .sort((a: any, b: any) => Number(b.score) - Number(a.score))
      .map((entry: any, index: number) => {
        const seat = seats.find((item: any) => item?.seatId === entry.seatId);
        return { rank: Number.isInteger(entry.rank) ? entry.rank : index + 1, nickname: typeof entry.nickname === 'string' ? entry.nickname : (seat?.nickname || `玩家${Number(entry.seatId || 0) + 1}`), score: Number(entry.score) };
      });
    const hasWinnerField = Object.prototype.hasOwnProperty.call(payload.result || {}, 'winnerSeatId');
    const winnerSeatId = hasWinnerField ? payload.result.winnerSeatId : undefined;
    const winner = winnerSeatId === null || winnerSeatId === undefined ? null : seats.find((item: any) => item?.seatId === winnerSeatId);
    return {
      mode,
      resultId,
      completedAt: new Date(row.completed_at).getTime(),
      totalPlayers: rankings.length || seats.length,
      rankings,
      winnerNickname: winner?.nickname || (hasWinnerField ? null : (rankings[0]?.nickname ?? null)),
      reason: typeof payload.result?.reason === 'string' ? payload.result.reason : 'COMPLETED'
    };
  }

  public async createOrGetAuctionShare(
    resultOrMatchId: string,
    guestId: string
  ): Promise<{ shareId: string } | null> {
    // The public contract accepts either the history `matchId` or the
    // internal `resultId`; normalize both to the canonical result id before
    // touching the share table.
    const auctionCheck = await this.pool.query<{ result_id: string }>(
      `SELECT result_id
       FROM completed_auctions
       WHERE (result_id = $1 OR match_id = $1)
         AND $2 = ANY(participant_guest_ids)`,
      [resultOrMatchId, guestId]
    );
    if (auctionCheck.rows.length === 0) {
      return null;
    }

    const resultId = auctionCheck.rows[0].result_id;

    const existing = await this.pool.query<{ share_id: string }>(
      'SELECT share_id FROM auction_shares WHERE result_id = $1',
      [resultId]
    );
    if (existing.rows.length > 0) {
      return { shareId: existing.rows[0].share_id };
    }

    const shareId = crypto.randomBytes(32).toString('hex');
    const insertRes = await this.pool.query<{ share_id: string }>(
      `INSERT INTO auction_shares (share_id, result_id, owner_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (result_id) DO UPDATE SET result_id = EXCLUDED.result_id
       RETURNING share_id`,
      [shareId, resultId, guestId]
    );

    return { shareId: insertRes.rows[0].share_id };
  }

  public async getPublicAuctionShare(shareId: string): Promise<AuctionShareSummary | null> {
    const res = await this.pool.query<{
      payload: CompletedAuctionRecord;
    }>(
      `SELECT ca.payload
       FROM auction_shares s
       JOIN completed_auctions ca ON s.result_id = ca.result_id
       WHERE s.share_id = $1`,
      [shareId]
    );

    if (res.rows.length === 0) {
      return null;
    }

    const rec = res.rows[0].payload;
    const winner = rec.result.winnerSeatId !== null
      ? rec.seats.find((s) => s.seatId === rec.result.winnerSeatId)
      : null;

    return {
      mode: rec.ruleVersion,
      resultId: rec.resultId,
      completedAt: rec.completedAt,
      totalPlayers: rec.seats.length,
      rankings: rec.result.rankings.map((r) => ({
        rank: r.rank,
        nickname: r.nickname,
        score: r.score,
        remainingCapital: r.remainingCapital
      })),
      winnerNickname: winner ? winner.nickname : null,
      reason: rec.result.reason
    };
  }

  public async isRankingHealthy(): Promise<boolean> {
    let timer: NodeJS.Timeout | null = null;
    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('DB healthcheck timeout')), 2000);
      });
      const res = await Promise.race([
        this.pool.query('SELECT 1 as ok FROM schema_migrations WHERE version >= 11 ORDER BY version DESC LIMIT 1'),
        timeoutPromise
      ]);
      return Boolean(res && res.rows && res.rows.length > 0);
    } catch {
      return false;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  public async getSeasons(): Promise<SeasonSummary[]> {
    const res = await this.pool.query<{
      id: string;
      name: string;
      rule_version: string;
      start_at: Date;
      end_at: Date;
      status: any;
      created_at: Date;
    }>('SELECT id, name, rule_version, start_at, end_at, status, created_at FROM seasons ORDER BY start_at DESC');

    return res.rows.map((r) => ({
      seasonId: r.id,
      name: r.name,
      ruleVersion: r.rule_version,
      startAt: new Date(r.start_at).getTime(),
      endAt: new Date(r.end_at).getTime(),
      status: r.status,
      createdAt: new Date(r.created_at).getTime()
    }));
  }

  public async getSeasonById(seasonId: string): Promise<SeasonSummary | null> {
    const res = await this.pool.query<{
      id: string;
      name: string;
      rule_version: string;
      start_at: Date;
      end_at: Date;
      status: any;
      created_at: Date;
    }>('SELECT id, name, rule_version, start_at, end_at, status, created_at FROM seasons WHERE id = $1', [seasonId]);

    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      seasonId: r.id,
      name: r.name,
      ruleVersion: r.rule_version,
      startAt: new Date(r.start_at).getTime(),
      endAt: new Date(r.end_at).getTime(),
      status: r.status,
      createdAt: new Date(r.created_at).getTime()
    };
  }

  public async getActiveSeason(): Promise<SeasonSummary | null> {
    const res = await this.pool.query<{
      id: string;
      name: string;
      rule_version: string;
      start_at: Date;
      end_at: Date;
      status: any;
      created_at: Date;
    }>(
      `SELECT id, name, rule_version, start_at, end_at, status, created_at
       FROM seasons
       WHERE status = 'active' AND start_at <= NOW() AND end_at >= NOW()
       ORDER BY start_at DESC
       LIMIT 1`
    );

    if (res.rows.length > 0) {
      const r = res.rows[0];
      return {
        seasonId: r.id,
        name: r.name,
        ruleVersion: r.rule_version,
        startAt: new Date(r.start_at).getTime(),
        endAt: new Date(r.end_at).getTime(),
        status: r.status,
        createdAt: new Date(r.created_at).getTime()
      };
    }

    const fallbackRes = await this.pool.query<{
      id: string;
      name: string;
      rule_version: string;
      start_at: Date;
      end_at: Date;
      status: any;
      created_at: Date;
    }>(
      `SELECT id, name, rule_version, start_at, end_at, status, created_at
       FROM seasons
       WHERE status = 'active'
       ORDER BY start_at DESC
       LIMIT 1`
    );

    if (fallbackRes.rows.length > 0) {
      const r = fallbackRes.rows[0];
      return {
        seasonId: r.id,
        name: r.name,
        ruleVersion: r.rule_version,
        startAt: new Date(r.start_at).getTime(),
        endAt: new Date(r.end_at).getTime(),
        status: r.status,
        createdAt: new Date(r.created_at).getTime()
      };
    }

    return null;
  }

  public async createSeason(data: {
    id: string;
    name: string;
    ruleVersion?: string;
    startAt: number;
    endAt: number;
    status?: string;
  }): Promise<SeasonSummary> {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(data.id) || !data.name.trim() || data.name.length > 120 || !data.ruleVersion || !/^[a-zA-Z0-9._-]+$/.test(data.ruleVersion) || !Number.isSafeInteger(data.startAt) || !Number.isSafeInteger(data.endAt) || data.endAt <= data.startAt || !['upcoming', 'active', 'completed', 'archived'].includes(data.status || 'active')) {
      throw new Error('Invalid season configuration');
    }
    const res = await this.pool.query<{
      id: string;
      name: string;
      rule_version: string;
      start_at: Date;
      end_at: Date;
      status: any;
      created_at: Date;
    }>(
      `INSERT INTO seasons (id, name, rule_version, start_at, end_at, status)
       VALUES ($1, $2, $3, to_timestamp($4 / 1000.0), to_timestamp($5 / 1000.0), $6)
       RETURNING id, name, rule_version, start_at, end_at, status, created_at`,
      [
        data.id,
        data.name,
        data.ruleVersion || RANKING_RULE_VERSION,
        data.startAt,
        data.endAt,
        data.status || 'active'
      ]
    );

    const r = res.rows[0];
    return {
      seasonId: r.id,
      name: r.name,
      ruleVersion: r.rule_version,
      startAt: new Date(r.start_at).getTime(),
      endAt: new Date(r.end_at).getTime(),
      status: r.status,
      createdAt: new Date(r.created_at).getTime()
    };
  }

  public async updateSeason(
    seasonId: string,
    data: { name?: string; status?: string; startAt?: number; endAt?: number }
  ): Promise<SeasonSummary | null> {
    const existing = await this.getSeasonById(seasonId);
    if (!existing) return null;

    const newName = data.name !== undefined ? data.name : existing.name;
    const newStatus = data.status !== undefined ? data.status : existing.status;
    const newStart = data.startAt !== undefined ? data.startAt : existing.startAt;
    const newEnd = data.endAt !== undefined ? data.endAt : existing.endAt;
    if (!newName.trim() || newName.length > 120 || !Number.isSafeInteger(newStart) || !Number.isSafeInteger(newEnd) || newEnd <= newStart || !['upcoming', 'active', 'completed', 'archived'].includes(newStatus)) {
      throw new Error('Invalid season configuration');
    }

    const res = await this.pool.query<{
      id: string;
      name: string;
      rule_version: string;
      start_at: Date;
      end_at: Date;
      status: any;
      created_at: Date;
    }>(
      `UPDATE seasons
       SET name = $2, status = $3, start_at = to_timestamp($4 / 1000.0), end_at = to_timestamp($5 / 1000.0)
       WHERE id = $1
       RETURNING id, name, rule_version, start_at, end_at, status, created_at`,
      [seasonId, newName, newStatus, newStart, newEnd]
    );

    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      seasonId: r.id,
      name: r.name,
      ruleVersion: r.rule_version,
      startAt: new Date(r.start_at).getTime(),
      endAt: new Date(r.end_at).getTime(),
      status: r.status,
      createdAt: new Date(r.created_at).getTime()
    };
  }

  public async getRankings(
    seasonId: string,
    limit: number = 20,
    offset: number = 0,
    board: RankingBoard = 'elo'
  ): Promise<{ items: RankingEntry[]; total: number }> {
    // Single-player boards are derived from authoritative completed records so
    // they remain available even though classic games do not change
    // multiplayer Elo profiles. The season window is applied at query time;
    // risk-excluded guests are omitted using the profile for that season.
    if (board === 'single_highest' || board === 'single_margin') {
      const marginBoard = board === 'single_margin';
      const eligibility = marginBoard
        ? `COUNT(*) FILTER (WHERE cg.payload->'settlement'->>'outcomeType' = 'OFFER_ACCEPTED') > 0`
        : 'COUNT(*) > 0';
      const metricOrder = marginBoard
        ? 'single_best_margin DESC NULLS LAST, single_games DESC, elo DESC, owner_id ASC'
        : 'single_highest DESC NULLS LAST, single_games DESC, elo DESC, owner_id ASC';
      const countRes = await this.pool.query<{ count: string }>(
        `SELECT count(*) AS count FROM (
           SELECT cg.owner_id
           FROM completed_games cg
           JOIN seasons s ON s.id = $1
           LEFT JOIN ranking_profiles rp ON rp.season_id = $1 AND rp.guest_id = cg.owner_id
           WHERE cg.completed_at >= s.start_at
             AND cg.completed_at < s.end_at
             AND cg.rule_version = 'classic-26-v1'
             AND COALESCE(rp.is_risk_excluded, FALSE) = FALSE
           GROUP BY cg.owner_id
           HAVING ${eligibility}
         ) eligible_players`,
        [seasonId]
      );
      const total = parseInt(countRes.rows[0]?.count || '0', 10);
      const rowsRes = await this.pool.query<{
        owner_id: string;
        elo: number | null;
        matches_played: number | null;
        wins: number | null;
        forfeits: number | null;
        net_profit: string | null;
        challenger_profit: string | null;
        banker_profit: string | null;
        role_balance_return_rate: number | null;
        survivor_games: number | null;
        survivor_wins: number | null;
        tournament_games: number | null;
        tournament_wins: number | null;
        single_games: number;
        single_highest: string | null;
        single_best_margin: string | null;
      }>(
        `SELECT cg.owner_id,
                COALESCE(rp.elo, $2) AS elo,
                COALESCE(rp.matches_played, 0) AS matches_played,
                COALESCE(rp.wins, 0) AS wins,
                COALESCE(rp.forfeits, 0) AS forfeits,
                COALESCE(rp.net_profit, 0) AS net_profit,
                COALESCE(rp.challenger_profit, 0) AS challenger_profit,
                COALESCE(rp.banker_profit, 0) AS banker_profit,
                COALESCE(rp.role_balance_return_rate, 0) AS role_balance_return_rate,
                COALESCE(rp.survivor_games, 0) AS survivor_games,
                COALESCE(rp.survivor_wins, 0) AS survivor_wins,
                COALESCE(rp.tournament_games, 0) AS tournament_games,
                COALESCE(rp.tournament_wins, 0) AS tournament_wins,
                COUNT(*)::int AS single_games,
                MAX(NULLIF(cg.payload->'settlement'->>'wonAmount', '')::numeric) AS single_highest,
                MAX(
                  CASE WHEN cg.payload->'settlement'->>'outcomeType' = 'OFFER_ACCEPTED'
                    THEN NULLIF(cg.payload->'settlement'->>'acceptedOfferAmount', '')::numeric
                       - NULLIF(cg.payload->'settlement'->>'originalBoxAmount', '')::numeric
                    ELSE NULL
                  END
                ) AS single_best_margin
         FROM completed_games cg
         JOIN seasons s ON s.id = $1
         LEFT JOIN ranking_profiles rp ON rp.season_id = $1 AND rp.guest_id = cg.owner_id
         WHERE cg.completed_at >= s.start_at
           AND cg.completed_at < s.end_at
           AND cg.rule_version = 'classic-26-v1'
           AND COALESCE(rp.is_risk_excluded, FALSE) = FALSE
         GROUP BY cg.owner_id, rp.elo, rp.matches_played, rp.wins, rp.forfeits,
                  rp.net_profit, rp.challenger_profit, rp.banker_profit,
                  rp.role_balance_return_rate, rp.survivor_games, rp.survivor_wins,
                  rp.tournament_games, rp.tournament_wins
         HAVING ${eligibility}
         ORDER BY ${metricOrder}
         LIMIT $3 OFFSET $4`,
        [seasonId, DEFAULT_ELO, limit, offset]
      );
      const items: RankingEntry[] = rowsRes.rows.map((row, index) => {
        const matches = Number(row.matches_played || 0);
        return {
          rank: offset + index + 1,
          elo: Number(row.elo || DEFAULT_ELO),
          winRate: matches > 0 ? Number((Number(row.wins || 0) / matches).toFixed(4)) : 0,
          roleBalanceReturnRate: Number(Number(row.role_balance_return_rate || 0).toFixed(4)),
          netProfit: Number(row.net_profit || 0),
          challengerProfit: Number(row.challenger_profit || 0),
          bankerProfit: Number(row.banker_profit || 0),
          matchesPlayed: matches,
          forfeitRate: matches > 0 ? Number((Number(row.forfeits || 0) / matches).toFixed(4)) : 0,
          survivorGamesPlayed: Number(row.survivor_games || 0),
          survivorWins: Number(row.survivor_wins || 0),
          tournamentGamesPlayed: Number(row.tournament_games || 0),
          tournamentWins: Number(row.tournament_wins || 0),
          singleGamesPlayed: Number(row.single_games || 0),
          singleHighestProfit: Number(row.single_highest || 0),
          singleBestDealMargin: row.single_best_margin === null ? undefined : Number(row.single_best_margin)
        };
      });
      return { items, total };
    }

    const boardConfig: Record<RankingBoard, { where: string; order: string }> = {
      elo: {
        where: 'TRUE',
        order: 'elo DESC, net_profit DESC, updated_at ASC'
      },
      net_profit: {
        where: 'matches_played > 0',
        order: 'net_profit DESC, matches_played DESC, elo DESC, updated_at ASC'
      },
      challenger_profit: {
        where: 'matches_played > 0',
        order: 'challenger_profit DESC, net_profit DESC, elo DESC, updated_at ASC'
      },
      banker_profit: {
        where: 'matches_played > 0',
        order: 'banker_profit DESC, net_profit DESC, elo DESC, updated_at ASC'
      },
      win_rate: {
        where: 'matches_played > 0',
        order: '(wins::numeric / NULLIF(matches_played, 0)) DESC, matches_played DESC, elo DESC, updated_at ASC'
      },
      survivor_wins: {
        where: 'survivor_games > 0',
        order: 'survivor_wins DESC, survivor_games DESC, elo DESC, updated_at ASC'
      },
      tournament_wins: {
        where: 'tournament_games > 0',
        order: 'tournament_wins DESC, tournament_games DESC, elo DESC, updated_at ASC'
      },
      matches: {
        where: 'matches_played > 0',
        order: 'matches_played DESC, elo DESC, updated_at ASC'
      },
      // Handled by the completed_games aggregation above; these entries keep
      // the allow-list exhaustive for the shared RankingBoard type.
      single_highest: {
        where: 'FALSE',
        order: 'updated_at ASC'
      },
      single_margin: {
        where: 'FALSE',
        order: 'updated_at ASC'
      }
    };
    const selectedBoard = boardConfig[board] ? board : 'elo';
    const selected = boardConfig[selectedBoard];
    const countRes = await this.pool.query<{ count: string }>(
      `SELECT count(*) AS count FROM ranking_profiles
       WHERE season_id = $1 AND is_risk_excluded = FALSE AND ${selected.where}`,
      [seasonId]
    );
    const total = parseInt(countRes.rows[0]?.count || '0', 10);

    const rowsRes = await this.pool.query<{
      guest_id: string;
      elo: number;
      matches_played: number;
      wins: number;
      losses: number;
      draws: number;
      forfeits: number;
      net_profit: string;
      challenger_profit: string;
      banker_profit: string;
      role_balance_return_rate: number;
      survivor_games: number;
      survivor_wins: number;
      tournament_games: number;
      tournament_wins: number;
      updated_at: Date;
    }>(
      `SELECT guest_id, elo, matches_played, wins, losses, draws, forfeits, net_profit, challenger_profit, banker_profit, role_balance_return_rate, survivor_games, survivor_wins, tournament_games, tournament_wins, updated_at
       FROM ranking_profiles
       WHERE season_id = $1 AND is_risk_excluded = FALSE AND ${selected.where}
       ORDER BY ${selected.order}
       LIMIT $2 OFFSET $3`,
      [seasonId, limit, offset]
    );

    const items: RankingEntry[] = rowsRes.rows.map((row, index) => {
      const matches = row.matches_played;
      const winRate = matches > 0 ? Number((row.wins / matches).toFixed(4)) : 0;
      const forfeitRate = matches > 0 ? Number((row.forfeits / matches).toFixed(4)) : 0;
      return {
        rank: offset + index + 1,
        elo: row.elo,
        winRate,
        roleBalanceReturnRate: Number(row.role_balance_return_rate.toFixed(4)),
        netProfit: Number(row.net_profit),
        challengerProfit: Number(row.challenger_profit),
        bankerProfit: Number(row.banker_profit),
        matchesPlayed: matches,
        forfeitRate,
        survivorGamesPlayed: row.survivor_games,
        survivorWins: row.survivor_wins,
        tournamentGamesPlayed: row.tournament_games,
        tournamentWins: row.tournament_wins
      };
    });

    return { items, total };
  }

  public async getProfileSummary(
    guestId: string,
    seasonId?: string
  ): Promise<ProfileSummary | null> {
    const guestRes = await this.pool.query<{ id: string; created_at: Date }>(
      'SELECT id, created_at FROM guests WHERE id = $1',
      [guestId]
    );
    if (guestRes.rows.length === 0) {
      return null;
    }
    const guest = guestRes.rows[0];

    let targetSeasonId = seasonId;
    if (!targetSeasonId) {
      const activeSeason = await this.getActiveSeason();
      targetSeasonId = activeSeason ? activeSeason.seasonId : 'season-1';
    }

    const profRes = await this.pool.query<{
      elo: number;
      matches_played: number;
      wins: number;
      losses: number;
      draws: number;
      forfeits: number;
      net_profit: string;
      role_balance_return_rate: number;
      survivor_games: number;
      survivor_wins: number;
      tournament_games: number;
      tournament_wins: number;
      is_risk_excluded: boolean;
    }>(
      'SELECT elo, matches_played, wins, losses, draws, forfeits, net_profit, role_balance_return_rate, survivor_games, survivor_wins, tournament_games, tournament_wins, is_risk_excluded FROM ranking_profiles WHERE season_id = $1 AND guest_id = $2',
      [targetSeasonId, guestId]
    );

    let rank: number | null = null;
    const prof = profRes.rows[0];
    if (prof && !prof.is_risk_excluded) {
      const rankRes = await this.pool.query<{ rank: string }>(
        `SELECT count(*) + 1 AS rank
         FROM ranking_profiles
         WHERE season_id = $1 AND is_risk_excluded = FALSE
           AND (elo > $2 OR (elo = $2 AND net_profit > $3))`,
        [targetSeasonId, prof.elo, prof.net_profit]
      );
      rank = parseInt(rankRes.rows[0]?.rank || '1', 10);
    }

    const singleCountRes = await this.pool.query<{
      count: string;
      single_highest: string;
      single_best_margin: string;
    }>(
      `SELECT
         count(*) AS count,
         COALESCE(MAX(NULLIF(payload->'settlement'->>'wonAmount', '')::numeric), 0) AS single_highest,
         COALESCE(MAX(
           CASE WHEN payload->'settlement'->>'outcomeType' = 'OFFER_ACCEPTED'
             THEN NULLIF(payload->'settlement'->>'acceptedOfferAmount', '')::numeric
                - NULLIF(payload->'settlement'->>'originalBoxAmount', '')::numeric
           END
         ), 0) AS single_best_margin
       FROM completed_games
       WHERE owner_id = $1 AND rule_version = 'classic-26-v1'`,
      [guestId]
    );
    const duelCountRes = await this.pool.query<{ count: string }>(
      'SELECT count(*) AS count FROM completed_duels WHERE guest0_id = $1 OR guest1_id = $1',
      [guestId]
    );
    const auctionCountRes = await this.pool.query<{ count: string }>(
      'SELECT count(*) AS count FROM completed_auctions WHERE $1 = ANY(participant_guest_ids)',
      [guestId]
    );
    const survivorCountRes = await this.pool.query<{ count: string }>(
      'SELECT count(*) AS count FROM completed_survivors WHERE $1 = ANY(participant_guest_ids)',
      [guestId]
    );
    const tournamentCountRes = await this.pool.query<{ count: string }>(
      'SELECT count(*) AS count FROM completed_tournaments WHERE $1 = ANY(participant_guest_ids)',
      [guestId]
    );

    const singleGamesPlayed = parseInt(singleCountRes.rows[0]?.count || '0', 10);
    const singleHighestProfit = Number(singleCountRes.rows[0]?.single_highest || 0);
    const singleBestDealMargin = Number(singleCountRes.rows[0]?.single_best_margin || 0);
    const duelGamesPlayed = parseInt(duelCountRes.rows[0]?.count || '0', 10);
    const auctionGamesPlayed = parseInt(auctionCountRes.rows[0]?.count || '0', 10);
    const survivorGamesPlayed = parseInt(survivorCountRes.rows[0]?.count || '0', 10);
    const tournamentGamesPlayed = parseInt(tournamentCountRes.rows[0]?.count || '0', 10);

    const matchesPlayed = prof ? prof.matches_played : 0;
    const wins = prof ? prof.wins : 0;
    const losses = prof ? prof.losses : 0;
    const draws = prof ? prof.draws : 0;
    const forfeits = prof ? prof.forfeits : 0;
    const netProfit = prof ? Number(prof.net_profit) : 0;
    const roleBalanceReturnRate = prof ? Number(prof.role_balance_return_rate.toFixed(4)) : 0.0;
    const elo = prof ? prof.elo : DEFAULT_ELO;
    const winRate = matchesPlayed > 0 ? Number((wins / matchesPlayed).toFixed(4)) : 0.0;
    const forfeitRate = matchesPlayed > 0 ? Number((forfeits / matchesPlayed).toFixed(4)) : 0.0;

    return {
      guestId,
      elo,
      rank,
      seasonId: targetSeasonId,
      matchesPlayed,
      wins,
      losses,
      draws,
      forfeits,
      winRate,
      roleBalanceReturnRate,
      netProfit,
      forfeitRate,
      singleGamesPlayed,
      singleHighestProfit,
      singleBestDealMargin,
      duelGamesPlayed,
      auctionGamesPlayed,
      survivorGamesPlayed,
      survivorWins: prof?.survivor_wins ?? 0,
      tournamentGamesPlayed,
      tournamentWins: prof?.tournament_wins ?? 0,
      createdAt: new Date(guest.created_at).getTime()
    };
  }

  public async createReport(data: {
    reporterGuestId: string;
    targetType: string;
    targetId: string;
    category: string;
    reason?: string;
    ipFingerprint: string;
  }): Promise<{ success: boolean; reportId?: string; conflict?: boolean; rateLimited?: boolean }> {
    try {
      // Frequency guard: same fingerprint max 10 reports per hour without storing raw IP
      const MAX_REPORTS_PER_HOUR = 10;
      const freqRes = await this.pool.query<{ count: string }>(
        `SELECT count(*) AS count FROM reports
         WHERE ip_fingerprint = $1 AND created_at > NOW() - INTERVAL '1 hour'`,
        [data.ipFingerprint]
      );
      const recentCount = parseInt(freqRes.rows[0]?.count || '0', 10);
      if (recentCount >= MAX_REPORTS_PER_HOUR) {
        return { success: false, conflict: false, rateLimited: true };
      }

      const res = await this.pool.query<{ id: string }>(
        `INSERT INTO reports (
          reporter_guest_id, target_type, target_id, category, reason, ip_fingerprint
        ) VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id`,
        [
          data.reporterGuestId,
          data.targetType,
          data.targetId,
          data.category,
          data.reason || '',
          data.ipFingerprint
        ]
      );
      return { success: true, reportId: res.rows[0].id, conflict: false, rateLimited: false };
    } catch (err: any) {
      if (err && err.code === '23505') {
        return { success: false, conflict: true, rateLimited: false };
      }
      throw err;
    }
  }

  public async getReports(options?: {
    status?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ items: Report[]; total: number }> {
    const limit = options?.limit || 20;
    const offset = options?.offset || 0;
    const status = options?.status;

    let countQuery = 'SELECT count(*) AS count FROM reports';
    const countParams: any[] = [];
    if (status) {
      countQuery += ' WHERE status = $1';
      countParams.push(status);
    }
    const countRes = await this.pool.query<{ count: string }>(countQuery, countParams);
    const total = parseInt(countRes.rows[0]?.count || '0', 10);

    let rowsQuery = `
      SELECT id, reporter_guest_id, target_type, target_id, category, reason, ip_fingerprint, status, resolution_notes, created_at, resolved_at
      FROM reports
    `;
    const rowParams: any[] = [];
    if (status) {
      rowsQuery += ' WHERE status = $1';
      rowParams.push(status);
      rowsQuery += ` ORDER BY created_at DESC LIMIT $2 OFFSET $3`;
      rowParams.push(limit, offset);
    } else {
      rowsQuery += ` ORDER BY created_at DESC LIMIT $1 OFFSET $2`;
      rowParams.push(limit, offset);
    }

    const rowsRes = await this.pool.query<{
      id: string;
      reporter_guest_id: string;
      target_type: string;
      target_id: string;
      category: string;
      reason: string;
      ip_fingerprint: string;
      status: any;
      resolution_notes: string | null;
      created_at: Date;
      resolved_at: Date | null;
    }>(rowsQuery, rowParams);

    const items: Report[] = rowsRes.rows.map((r) => ({
      id: r.id,
      reporterGuestId: r.reporter_guest_id,
      targetType: r.target_type,
      targetId: r.target_id,
      category: r.category,
      reason: r.reason,
      ipFingerprint: r.ip_fingerprint,
      status: r.status,
      resolutionNotes: r.resolution_notes,
      createdAt: new Date(r.created_at).getTime(),
      resolvedAt: r.resolved_at ? new Date(r.resolved_at).getTime() : null
    }));

    return { items, total };
  }

  public async updateReportStatus(
    reportId: string,
    status: string,
    notes?: string
  ): Promise<boolean> {
    const res = await this.pool.query(
      `UPDATE reports
       SET status = $2, resolution_notes = COALESCE($3, resolution_notes), resolved_at = NOW()
       WHERE id = $1`,
      [reportId, status, notes || null]
    );
    return (res.rowCount ?? 0) > 0;
  }

  public async isGuestRiskExcluded(guestId: string): Promise<boolean> {
    const res = await this.pool.query(
      `SELECT 1 FROM risk_flags
       WHERE guest_id = $1 AND is_active = TRUE AND flag_type IN ('BANNED', 'EXCLUDED_RANKING', 'MATCH_FIXING')
       LIMIT 1`,
      [guestId]
    );
    return res.rows.length > 0;
  }

  public async isGuestBanned(guestId: string): Promise<boolean> {
    const res = await this.pool.query(
      `SELECT 1
       FROM risk_flags
       WHERE guest_id = $1 AND is_active = TRUE AND flag_type = 'BANNED'
       LIMIT 1`,
      [guestId]
    );
    return res.rows.length > 0;
  }

  public async createRiskFlag(data: {
    guestId: string;
    flagType: string;
    severity?: string;
    reason?: string;
    ipFingerprint?: string;
    metadata?: any;
    excludeRanking?: boolean;
  }): Promise<string> {
    const res = await this.pool.query<{ id: string }>(
      `INSERT INTO risk_flags (
        guest_id, flag_type, severity, reason, ip_fingerprint, metadata, is_active
      ) VALUES ($1, $2, $3, $4, $5, $6, TRUE)
      RETURNING id`,
      [
        data.guestId,
        data.flagType,
        data.severity || 'medium',
        data.reason || '',
        data.ipFingerprint || null,
        JSON.stringify(data.metadata || {})
      ]
    );

    if (
      data.excludeRanking ||
      data.flagType === 'BANNED' ||
      data.flagType === 'EXCLUDED_RANKING'
    ) {
      await this.pool.query(
        'UPDATE ranking_profiles SET is_risk_excluded = TRUE WHERE guest_id = $1',
        [data.guestId]
      );
    }

    return res.rows[0].id;
  }

  public async getActiveBans(): Promise<AdminBanItem[]> {
    const res = await this.pool.query<{
      id: string;
      guest_id: string;
      flag_type: string;
      severity: string;
      reason: string;
      ip_fingerprint: string | null;
      is_active: boolean;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT id, guest_id, flag_type, severity, reason, ip_fingerprint, is_active, created_at, updated_at
       FROM risk_flags
       WHERE is_active = TRUE
       ORDER BY created_at DESC`
    );

    return res.rows.map((r) => ({
      id: r.id,
      guestId: r.guest_id,
      flagType: r.flag_type,
      severity: r.severity,
      reason: r.reason,
      ipFingerprint: r.ip_fingerprint || undefined,
      isActive: r.is_active,
      createdAt: new Date(r.created_at).getTime(),
      updatedAt: new Date(r.updated_at).getTime()
    }));
  }

  public async deactivateRiskFlag(id: string): Promise<boolean> {
    const res = await this.pool.query<{ guest_id: string }>(
      `UPDATE risk_flags
       SET is_active = FALSE, updated_at = NOW()
       WHERE id = $1
       RETURNING guest_id`,
      [id]
    );
    if ((res.rowCount ?? 0) === 0) return false;

    const guestId = res.rows[0].guest_id;
    const stillExcluded = await this.isGuestRiskExcluded(guestId);
    await this.pool.query(
      'UPDATE ranking_profiles SET is_risk_excluded = $2 WHERE guest_id = $1',
      [guestId, stillExcluded]
    );
    return true;
  }

  public async writeAdminAuditLog(entry: {
    adminId?: string;
    action: string;
    targetType: string;
    targetId: string;
    details?: any;
    ipFingerprint?: string;
  }): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO admin_audit_logs (
          admin_id, action, target_type, target_id, details, ip_fingerprint
        ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          entry.adminId || 'system_admin',
          entry.action,
          entry.targetType,
          entry.targetId,
          JSON.stringify(entry.details || {}),
          entry.ipFingerprint || null
        ]
      );
    } catch (err) {
      console.error('[DatabaseManager] Failed to write admin audit log:', err);
    }
  }

  public async getRuntimeConfig(key: string): Promise<AdminConfig | null> {
    const res = await this.pool.query<{
      key: string;
      value: any;
      version: number;
      description: string;
      updated_at: Date;
      updated_by: string;
    }>('SELECT key, value, version, description, updated_at, updated_by FROM runtime_configs WHERE key = $1', [key]);

    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      key: r.key,
      value: r.value,
      version: r.version,
      description: r.description,
      updatedAt: new Date(r.updated_at).getTime(),
      updatedBy: r.updated_by
    };
  }

  public async getAllRuntimeConfigs(): Promise<AdminConfig[]> {
    const res = await this.pool.query<{
      key: string;
      value: any;
      version: number;
      description: string;
      updated_at: Date;
      updated_by: string;
    }>('SELECT key, value, version, description, updated_at, updated_by FROM runtime_configs ORDER BY key ASC');

    return res.rows.map((r) => ({
      key: r.key,
      value: r.value,
      version: r.version,
      description: r.description,
      updatedAt: new Date(r.updated_at).getTime(),
      updatedBy: r.updated_by
    }));
  }

  public async setRuntimeConfig(
    key: string,
    value: any,
    description = '',
    updatedBy = 'system'
  ): Promise<AdminConfig> {
    const res = await this.pool.query<{
      key: string;
      value: any;
      version: number;
      description: string;
      updated_at: Date;
      updated_by: string;
    }>(
      `INSERT INTO runtime_configs (key, value, version, description, updated_by, updated_at)
       VALUES ($1, $2, 1, $3, $4, NOW())
       ON CONFLICT (key) DO UPDATE SET
         value = EXCLUDED.value,
         version = runtime_configs.version + 1,
         description = CASE WHEN EXCLUDED.description <> '' THEN EXCLUDED.description ELSE runtime_configs.description END,
         updated_by = EXCLUDED.updated_by,
         updated_at = NOW()
       RETURNING key, value, version, description, updated_at, updated_by`,
      [key, JSON.stringify(value), description, updatedBy]
    );
    const r = res.rows[0];
    return {
      key: r.key,
      value: r.value,
      version: r.version,
      description: r.description,
      updatedAt: new Date(r.updated_at).getTime(),
      updatedBy: r.updated_by
    };
  }

  public async getAdminMetrics(): Promise<AdminMetrics> {
    const guestsCountRes = await this.pool.query<{ count: string }>('SELECT count(*) AS count FROM guests');
    const active24hRes = await this.pool.query<{ count: string }>(
      "SELECT count(*) AS count FROM guests WHERE last_seen_at >= NOW() - INTERVAL '24 hours'"
    );
    const singleGamesRes = await this.pool.query<{ count: string }>('SELECT count(*) AS count FROM completed_games');
    const duelGamesRes = await this.pool.query<{ count: string }>('SELECT count(*) AS count FROM completed_duels');
    const auctionGamesRes = await this.pool.query<{ count: string }>('SELECT count(*) AS count FROM completed_auctions');
    const survivorGamesRes = await this.pool.query<{ count: string }>('SELECT count(*) AS count FROM completed_survivors');
    const tournamentGamesRes = await this.pool.query<{ count: string }>('SELECT count(*) AS count FROM completed_tournaments');
    const pendingReportsRes = await this.pool.query<{ count: string }>(
      "SELECT count(*) AS count FROM reports WHERE status = 'pending'"
    );
    const activeBansRes = await this.pool.query<{ count: string }>(
      "SELECT count(*) AS count FROM risk_flags WHERE is_active = TRUE AND flag_type = 'BANNED'"
    );

    return {
      totalGuests: parseInt(guestsCountRes.rows[0]?.count || '0', 10),
      activeGuests24h: parseInt(active24hRes.rows[0]?.count || '0', 10),
      totalSingleGames: parseInt(singleGamesRes.rows[0]?.count || '0', 10),
      totalDuelGames: parseInt(duelGamesRes.rows[0]?.count || '0', 10),
      totalAuctionGames: parseInt(auctionGamesRes.rows[0]?.count || '0', 10),
      totalSurvivorGames: parseInt(survivorGamesRes.rows[0]?.count || '0', 10),
      totalTournamentGames: parseInt(tournamentGamesRes.rows[0]?.count || '0', 10),
      pendingReports: parseInt(pendingReportsRes.rows[0]?.count || '0', 10),
      activeBans: parseInt(activeBansRes.rows[0]?.count || '0', 10),
      systemHealth: await this.isHealthy() ? 'healthy' : 'degraded'
    };
  }

  public async getOrCreateRankingProfile(
    seasonId: string,
    guestId: string
  ): Promise<{
    seasonId: string;
    guestId: string;
    elo: number;
    matchesPlayed: number;
    wins: number;
    losses: number;
    draws: number;
    forfeits: number;
    netProfit: number;
    challengerProfit: number;
    bankerProfit: number;
    roleBalanceReturnRate: number;
    isRiskExcluded: boolean;
  }> {
    const isExcluded = await this.isGuestRiskExcluded(guestId);
    const res = await this.pool.query<{
      season_id: string;
      guest_id: string;
      elo: number;
      matches_played: number;
      wins: number;
      losses: number;
      draws: number;
      forfeits: number;
      net_profit: string;
      challenger_profit: string;
      banker_profit: string;
      role_balance_return_rate: number;
      is_risk_excluded: boolean;
    }>(
      `INSERT INTO ranking_profiles (season_id, guest_id, elo, is_risk_excluded)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (season_id, guest_id) DO UPDATE SET is_risk_excluded = EXCLUDED.is_risk_excluded
       RETURNING season_id, guest_id, elo, matches_played, wins, losses, draws, forfeits, net_profit, challenger_profit, banker_profit, role_balance_return_rate, is_risk_excluded`,
      [seasonId, guestId, DEFAULT_ELO, isExcluded]
    );
    const row = res.rows[0];
    return {
      seasonId: row.season_id,
      guestId: row.guest_id,
      elo: row.elo,
      matchesPlayed: row.matches_played,
      wins: row.wins,
      losses: row.losses,
      draws: row.draws,
      forfeits: row.forfeits,
      netProfit: Number(row.net_profit),
      challengerProfit: Number(row.challenger_profit),
      bankerProfit: Number(row.banker_profit),
      roleBalanceReturnRate: row.role_balance_return_rate,
      isRiskExcluded: row.is_risk_excluded
    };
  }

  public async applyProfileUpdate(
    seasonId: string,
    guestId: string,
    deltas: {
      elo: number;
      matchesDelta: number;
      winsDelta: number;
      lossesDelta: number;
      drawsDelta: number;
      forfeitsDelta: number;
      netProfitDelta: number;
      challengerProfitDelta: number;
      bankerProfitDelta: number;
    }
  ): Promise<void> {
    const existing = await this.getOrCreateRankingProfile(seasonId, guestId);
    const newChallenger = existing.challengerProfit + deltas.challengerProfitDelta;
    const newBanker = existing.bankerProfit + deltas.bankerProfitDelta;
    const roleBalanceReturnRate =
      newChallenger === 0 && newBanker === 0
        ? 1.0
        : newChallenger > 0 && newBanker > 0
          ? Math.max(0, Math.min(10, newChallenger / newBanker))
          : 0.0;

    await this.pool.query(
      `UPDATE ranking_profiles
       SET elo = $3,
           matches_played = matches_played + $4,
           wins = wins + $5,
           losses = losses + $6,
           draws = draws + $7,
           forfeits = forfeits + $8,
           net_profit = net_profit + $9,
           challenger_profit = challenger_profit + $10,
           banker_profit = banker_profit + $11,
           role_balance_return_rate = $12,
           updated_at = NOW()
       WHERE season_id = $1 AND guest_id = $2`,
      [
        seasonId,
        guestId,
        deltas.elo,
        deltas.matchesDelta,
        deltas.winsDelta,
        deltas.lossesDelta,
        deltas.drawsDelta,
        deltas.forfeitsDelta,
        deltas.netProfitDelta,
        deltas.challengerProfitDelta,
        deltas.bankerProfitDelta,
        roleBalanceReturnRate
      ]
    );
  }


  public async updateRankingOnDuelSettlement(item: {
    resultId: string;
    matchId: string;
    guest0Id: string;
    guest1Id: string;
    completedAt: number;
    ruleVersion: string;
    record: CompletedDuelRecord;
  }): Promise<void> {
    const rec = item.record;
    if ((rec as any).isPrivate === true || (rec as any).private === true || rec.ranked !== true) {
      return;
    }

    await this.evaluateRepeatedOpponentRisk({
      guestIds: [item.guest0Id, item.guest1Id],
      matchId: item.matchId,
      mode: 'duel'
    });

    const activeSeason = await this.getActiveSeason();
    if (!activeSeason) return;
    const seasonId = activeSeason.seasonId;

    const isExcluded0 = await this.isGuestRiskExcluded(item.guest0Id);
    const isExcluded1 = await this.isGuestRiskExcluded(item.guest1Id);
    if (isExcluded0 || isExcluded1) {
      return;
    }

    const p0 = await this.getOrCreateRankingProfile(seasonId, item.guest0Id);
    const p1 = await this.getOrCreateRankingProfile(seasonId, item.guest1Id);

    const r0 = p0.elo;
    const r1 = p1.elo;
    const e0 = 1 / (1 + Math.pow(10, (r1 - r0) / 400));
    const e1 = 1 / (1 + Math.pow(10, (r0 - r1) / 400));

    let s0 = 0.5;
    let s1 = 0.5;
    const winner = rec.result.winnerSeatId;
    if (winner === 0) {
      s0 = 1.0;
      s1 = 0.0;
    } else if (winner === 1) {
      s0 = 0.0;
      s1 = 1.0;
    }

    const delta0 = Math.round(DEFAULT_K_FACTOR * (s0 - e0));
    const delta1 = Math.round(DEFAULT_K_FACTOR * (s1 - e1));

    const newElo0 = Math.max(100, r0 + delta0);
    const newElo1 = Math.max(100, r1 + delta1);

    const reason = rec.result.reason;
    const isForfeit0 = (winner === 1 && (reason === 'FORFEIT' || reason === 'TIMEOUT_DISCONNECT')) || reason === 'BOTH_FORFEIT';
    const isForfeit1 = (winner === 0 && (reason === 'FORFEIT' || reason === 'TIMEOUT_DISCONNECT')) || reason === 'BOTH_FORFEIT';

    const net0 = rec.result.finalScores ? (rec.result.finalScores[0] || 0) : 0;
    const net1 = rec.result.finalScores ? (rec.result.finalScores[1] || 0) : 0;

    let challengerProfit0 = 0;
    let bankerProfit0 = 0;
    let challengerProfit1 = 0;
    let bankerProfit1 = 0;

    if (Array.isArray(rec.result.rounds)) {
      for (const round of rec.result.rounds) {
        if (round.challengerSeatId === 0) {
          challengerProfit0 += round.challengerProfit || 0;
          bankerProfit1 += round.bankerProfit || 0;
        } else {
          challengerProfit1 += round.challengerProfit || 0;
          bankerProfit0 += round.bankerProfit || 0;
        }
      }
    }

    await this.applyProfileUpdate(seasonId, item.guest0Id, {
      elo: newElo0,
      matchesDelta: 1,
      winsDelta: winner === 0 ? 1 : 0,
      lossesDelta: winner === 1 ? 1 : 0,
      drawsDelta: winner === null ? 1 : 0,
      forfeitsDelta: isForfeit0 ? 1 : 0,
      netProfitDelta: net0,
      challengerProfitDelta: challengerProfit0,
      bankerProfitDelta: bankerProfit0
    });

    await this.applyProfileUpdate(seasonId, item.guest1Id, {
      elo: newElo1,
      matchesDelta: 1,
      winsDelta: winner === 1 ? 1 : 0,
      lossesDelta: winner === 0 ? 1 : 0,
      drawsDelta: winner === null ? 1 : 0,
      forfeitsDelta: isForfeit1 ? 1 : 0,
      netProfitDelta: net1,
      challengerProfitDelta: challengerProfit1,
      bankerProfitDelta: bankerProfit1
    });
  }

  public async updateRankingOnAuctionSettlement(item: {
    resultId: string;
    matchId: string;
    participantGuestIds: string[];
    completedAt: number;
    ruleVersion: string;
    record: CompletedAuctionRecord;
  }): Promise<void> {
    const rec = item.record;
    // Only explicitly ranked, non-private auction records may affect Elo;
    // legacy records without the V1 room flags remain historical-only.
    if (rec.isPrivate === true || (rec as any).private === true || rec.ranked !== true) {
      return;
    }

    await this.evaluateRepeatedOpponentRisk({
      guestIds: item.participantGuestIds,
      matchId: item.matchId,
      mode: 'auction'
    });

    const activeSeason = await this.getActiveSeason();
    if (!activeSeason) return;
    const seasonId = activeSeason.seasonId;

    const excludedParticipant = await Promise.all(
      item.participantGuestIds.map((gId) => this.isGuestRiskExcluded(gId))
    );
    // A match with any risk-excluded participant is excluded as a whole;
    // otherwise the remaining players would receive distorted pairwise Elo.
    if (excludedParticipant.some(Boolean)) return;
    const validGuestIds = item.participantGuestIds;
    if (validGuestIds.length < 2) return;

    const seatToGuest = new Map<number, string>();
    for (const seat of rec.seats) {
      if (seat.guestId && validGuestIds.includes(seat.guestId)) {
        seatToGuest.set(seat.seatId, seat.guestId);
      }
    }

    const profiles = new Map<number, { elo: number; guestId: string }>();
    for (const [seatId, guestId] of seatToGuest.entries()) {
      const prof = await this.getOrCreateRankingProfile(seasonId, guestId);
      profiles.set(seatId, { elo: prof.elo, guestId });
    }

    const N = profiles.size;
    if (N < 2) return;

    const seatRanks = new Map<number, number>();
    for (const r of rec.result.rankings) {
      seatRanks.set(r.seatId, r.rank);
    }

    const seatIds = Array.from(profiles.keys());
    const challengerProfitBySeat = new Map<number, number>();
    const capitalistProfitBySeat = new Map<number, number>();
    for (const round of rec.result.rounds || []) {
      challengerProfitBySeat.set(
        round.challengerSeatId,
        (challengerProfitBySeat.get(round.challengerSeatId) || 0) + (round.challengerProfit || 0)
      );
      for (const [seatKey, profit] of Object.entries(round.capitalistProfits || {})) {
        const seatId = Number(seatKey);
        capitalistProfitBySeat.set(seatId, (capitalistProfitBySeat.get(seatId) || 0) + (profit || 0));
      }
    }
    for (const i of seatIds) {
      const profI = profiles.get(i)!;
      const rankI = seatRanks.get(i) ?? N;
      let sumScoreDiff = 0;

      for (const j of seatIds) {
        if (i === j) continue;
        const profJ = profiles.get(j)!;
        const rankJ = seatRanks.get(j) ?? N;

        const e_ij = 1 / (1 + Math.pow(10, (profJ.elo - profI.elo) / 400));
        let s_ij = 0.5;
        if (rankI < rankJ) s_ij = 1.0;
        else if (rankI > rankJ) s_ij = 0.0;

        sumScoreDiff += (s_ij - e_ij);
      }

      const deltaElo = Math.round((DEFAULT_K_FACTOR / (N - 1)) * sumScoreDiff);
      const newElo = Math.max(100, profI.elo + deltaElo);

      const ranking = rec.result.rankings ? rec.result.rankings.find((r) => r.seatId === i) : undefined;
      const isForfeit = ranking?.forfeited === true || (Array.isArray(rec.result.forfeitedSeatIds) && rec.result.forfeitedSeatIds.includes(i));
      const tiedAtRank = Array.from(seatRanks.values()).filter((rank) => rank === rankI).length > 1;
      const isWin = rankI === 1 && !tiedAtRank;
      const isLoss = rankI === N && !tiedAtRank;
      const netProfit = rec.result.finalScores ? (rec.result.finalScores[i] || 0) : 0;

      await this.applyProfileUpdate(seasonId, profI.guestId, {
        elo: newElo,
        matchesDelta: 1,
        winsDelta: isWin ? 1 : 0,
        lossesDelta: isLoss ? 1 : 0,
        drawsDelta: !isWin && !isLoss ? 1 : 0,
        forfeitsDelta: isForfeit ? 1 : 0,
        netProfitDelta: netProfit,
        challengerProfitDelta: challengerProfitBySeat.get(i) || 0,
        bankerProfitDelta: capitalistProfitBySeat.get(i) || 0
      });
    }
  }

  /**
   * Drops schema for test tear-down. Strictly constrained to test schemas with test_schema_ prefix.
   */
  public async dropSchema(): Promise<void> {
    if (!this.schema.startsWith('test_schema_')) {
      throw new Error('dropSchema is strictly restricted to test schemas starting with test_schema_');
    }
    await this.pool.query(`DROP SCHEMA IF EXISTS "${this.schema}" CASCADE`);
  }

  public async close(): Promise<void> {
    await this.pool.end();
  }
}
