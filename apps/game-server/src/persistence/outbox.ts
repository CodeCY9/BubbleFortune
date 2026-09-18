import fs from 'node:fs';
import path from 'node:path';
import { CompletedGameRecord } from '../../../../packages/protocol/src/types';
import { CompletedDuelRecord, DUEL_RULE_VERSION } from '../../../../packages/protocol/src/duel';
import { CompletedAuctionRecord, AUCTION_RULE_VERSION } from '../../../../packages/protocol/src/auction';
import { CompletedSurvivorRecord, SURVIVOR_RULE_VERSION } from '../../../../packages/protocol/src/survivor';
import { CompletedTournamentRecord, TOURNAMENT_RULE_VERSION } from '../../../../packages/protocol/src/tournament';
import { DatabaseManager } from './db';
import { isValidId } from '../http/security';

export interface SingleOutboxItem {
  kind?: 'single';
  resultId: string;
  ownerId: string;
  gameId: string;
  completedAt: number;
  ruleVersion: string;
  aiType: string;
  aiStrategyVersion: string;
  record: CompletedGameRecord;
}

export interface DuelOutboxItem {
  kind: 'duel';
  resultId: string;
  matchId: string;
  guest0Id: string;
  guest1Id: string;
  completedAt: number;
  ruleVersion: string;
  record: CompletedDuelRecord;
}

export interface AuctionOutboxItem {
  kind: 'auction';
  resultId: string;
  matchId: string;
  participantGuestIds: string[];
  completedAt: number;
  ruleVersion: string;
  record: CompletedAuctionRecord;
}

export interface SurvivorOutboxItem {
  kind: 'survivor';
  resultId: string;
  matchId: string;
  participantGuestIds: string[];
  completedAt: number;
  ruleVersion: string;
  record: CompletedSurvivorRecord;
}

export interface TournamentOutboxItem {
  kind: 'tournament';
  resultId: string;
  tournamentId: string;
  participantGuestIds: string[];
  completedAt: number;
  ruleVersion: string;
  record: CompletedTournamentRecord;
}

export type OutboxItem = SingleOutboxItem | DuelOutboxItem | AuctionOutboxItem | SurvivorOutboxItem | TournamentOutboxItem;

export interface OutboxOptions {
  dir: string;
  db: DatabaseManager;
  retryIntervalMs?: number;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GAME_ID_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;
const TMP_FILE_REGEX = /^[a-zA-Z0-9_-]+\.tmp\.\d+_[a-z0-9]+$/;
const KNOWN_OUTCOMES = new Set([
  'OFFER_ACCEPTED',
  'FINAL_KEEP',
  'FINAL_SWAP',
  'ROUND_REJECT_DEFAULT',
  'OFFER_REJECT_DEFAULT'
]);
const KNOWN_AI_TYPES = new Set(['conservative', 'aggressive', 'cold', 'inducement', 'crazy']);

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

export class OutboxManager {
  private dir: string;
  private db: DatabaseManager;
  private retryIntervalMs: number;
  private isClosed: boolean = false;
  private retryTimer: NodeJS.Timeout | null = null;
  private isProcessing: boolean = false;
  private hasPendingWork: boolean = false;
  private currentWorkPromise: Promise<void> | null = null;
  private pendingEnqueueMap = new Map<string, OutboxItem>();
  private pendingQuarantines = new Map<string, { item: OutboxItem; reason: string }>();

  constructor(options: OutboxOptions) {
    this.dir = options.dir;
    this.db = options.db;
    this.retryIntervalMs = options.retryIntervalMs || 2000;
  }

  public async init(): Promise<void> {
    fs.mkdirSync(this.dir, { recursive: true });

    // Clean up ONLY exact temporary files left behind from previous crashes matching TMP_FILE_REGEX
    try {
      const files = fs.readdirSync(this.dir);
      for (const file of files) {
        if (TMP_FILE_REGEX.test(file)) {
          try {
            fs.unlinkSync(path.join(this.dir, file));
          } catch {
            // ignore
          }
        }
      }
    } catch {
      // ignore
    }

    // Trigger queue processing for any existing persistent outbox items
    await this.processQueue();
  }

  /**
   * Validate outbox item structural consistency.
   * Checks UUID owner, gameId format, finite completedAt match, valid outcomeType,
   * non-negative wonAmount, and metadata equality with record.
   */
  public validateItem(item: any): item is OutboxItem {
    if (!item || typeof item !== 'object') return false;

    if (item.kind === 'duel') {
      if (typeof item.resultId !== 'string' || !isValidId(item.resultId)) return false;
      if (typeof item.matchId !== 'string' || !GAME_ID_REGEX.test(item.matchId)) return false;
      if (typeof item.guest0Id !== 'string' || !UUID_REGEX.test(item.guest0Id)) return false;
      if (typeof item.guest1Id !== 'string' || !UUID_REGEX.test(item.guest1Id)) return false;
      if (item.guest0Id === item.guest1Id) return false;
      if (typeof item.completedAt !== 'number' || !Number.isFinite(item.completedAt) || item.completedAt <= 0) return false;
      if (item.ruleVersion !== DUEL_RULE_VERSION) return false;

      const rec = item.record;
      if (!rec || typeof rec !== 'object') return false;
      if (rec.matchId !== item.matchId) return false;
      if (rec.resultId !== item.resultId) return false;
      if (rec.ruleVersion !== item.ruleVersion) return false;
      if (rec.completedAt !== item.completedAt) return false;
      if (!Array.isArray(rec.seats) || rec.seats.length !== 2) return false;
      if (rec.seats[0]?.seatId !== 0 || rec.seats[1]?.seatId !== 1) return false;

      const res = rec.result;
      if (!res || typeof res !== 'object') return false;
      if (res.resultId !== item.resultId) return false;
      if (res.matchId !== item.matchId) return false;
      if (res.ruleVersion !== item.ruleVersion) return false;
      const KNOWN_DUEL_REASONS = new Set(['NORMAL', 'FORFEIT', 'TIMEOUT_DISCONNECT', 'BOTH_FORFEIT']);
      if (typeof res.reason !== 'string' || !KNOWN_DUEL_REASONS.has(res.reason)) return false;
      if (res.winnerSeatId !== null && res.winnerSeatId !== 0 && res.winnerSeatId !== 1) return false;
      if (typeof res.finalScores !== 'object' || res.finalScores === null) return false;
      // Allow signed / negative safe integers
      if (!Number.isSafeInteger(res.finalScores[0])) return false;
      if (!Number.isSafeInteger(res.finalScores[1])) return false;
      if (!Array.isArray(res.rounds) || !Array.isArray(res.fairnessProofs) || !Array.isArray(res.auditTrail)) return false;

      return true;
    }

    if (item.kind === 'auction') {
      if (typeof item.resultId !== 'string' || !isValidId(item.resultId)) return false;
      if (typeof item.matchId !== 'string' || !GAME_ID_REGEX.test(item.matchId)) return false;
      if (!Array.isArray(item.participantGuestIds) || item.participantGuestIds.length < 2) return false;
      for (const gid of item.participantGuestIds) {
        if (typeof gid !== 'string' || !UUID_REGEX.test(gid)) return false;
      }
      if (typeof item.completedAt !== 'number' || !Number.isFinite(item.completedAt) || item.completedAt <= 0) return false;
      if (item.ruleVersion !== AUCTION_RULE_VERSION) return false;

      const rec = item.record;
      if (!rec || typeof rec !== 'object') return false;
      if (rec.matchId !== item.matchId) return false;
      if (rec.resultId !== item.resultId) return false;
      if (rec.ruleVersion !== item.ruleVersion) return false;
      if (rec.completedAt !== item.completedAt) return false;
      if (!Array.isArray(rec.seats) || rec.seats.length < 2) return false;

      const res = rec.result;
      if (!res || typeof res !== 'object') return false;
      if (res.resultId !== item.resultId) return false;
      if (res.matchId !== item.matchId) return false;
      if (res.ruleVersion !== item.ruleVersion) return false;
      const KNOWN_AUCTION_REASONS = new Set(['NORMAL', 'FORFEIT_ALL', 'SURVIVOR_WIN', 'TIMEOUT_DISCONNECT']);
      if (typeof res.reason !== 'string' || !KNOWN_AUCTION_REASONS.has(res.reason)) return false;
      if (res.winnerSeatId !== null && (typeof res.winnerSeatId !== 'number' || !Number.isSafeInteger(res.winnerSeatId))) return false;
      if (typeof res.finalScores !== 'object' || res.finalScores === null) return false;
      if (!Array.isArray(res.rankings) || !Array.isArray(res.rounds) || !Array.isArray(res.fairnessProofs) || !Array.isArray(res.auditTrail)) return false;

      return true;
    }

    if (item.kind === 'survivor') {
      if (typeof item.resultId !== 'string' || !isValidId(item.resultId)) return false;
      if (typeof item.matchId !== 'string' || !GAME_ID_REGEX.test(item.matchId)) return false;
      if (!Array.isArray(item.participantGuestIds) || item.participantGuestIds.length < 2) return false;
      if (item.participantGuestIds.some((id: unknown) => typeof id !== 'string' || !UUID_REGEX.test(id as string))) return false;
      if (typeof item.completedAt !== 'number' || !Number.isFinite(item.completedAt) || item.completedAt <= 0) return false;
      if (item.ruleVersion !== SURVIVOR_RULE_VERSION) return false;
      const rec = item.record;
      if (!rec || rec.matchId !== item.matchId || rec.resultId !== item.resultId || rec.ruleVersion !== item.ruleVersion || rec.completedAt !== item.completedAt) return false;
      if (!Array.isArray(rec.seats) || rec.seats.length < 2 || !rec.result || !Array.isArray(rec.result.rankings) || !Array.isArray(rec.result.rounds) || !Array.isArray(rec.result.auditTrail)) return false;
      return true;
    }

    if (item.kind === 'tournament') {
      if (typeof item.resultId !== 'string' || !isValidId(item.resultId)) return false;
      if (typeof item.tournamentId !== 'string' || !GAME_ID_REGEX.test(item.tournamentId)) return false;
      if (!Array.isArray(item.participantGuestIds) || item.participantGuestIds.length < 2) return false;
      if (item.participantGuestIds.some((id: unknown) => typeof id !== 'string' || !UUID_REGEX.test(id as string))) return false;
      if (typeof item.completedAt !== 'number' || !Number.isFinite(item.completedAt) || item.completedAt <= 0) return false;
      if (item.ruleVersion !== TOURNAMENT_RULE_VERSION) return false;
      const rec = item.record;
      if (!rec || rec.tournamentId !== item.tournamentId || rec.resultId !== item.resultId || rec.ruleVersion !== item.ruleVersion || rec.completedAt !== item.completedAt) return false;
      if (!Array.isArray(rec.seats) || rec.seats.length < 2 || !rec.result || !Array.isArray(rec.result.rankings) || !Array.isArray(rec.result.matches) || !Array.isArray(rec.result.auditTrail)) return false;
      return true;
    }

    if (item.kind && item.kind !== 'single') return false;
    if (typeof item.resultId !== 'string' || !isValidId(item.resultId)) return false;
    if (typeof item.ownerId !== 'string' || !UUID_REGEX.test(item.ownerId)) return false;
    if (typeof item.gameId !== 'string' || !GAME_ID_REGEX.test(item.gameId)) return false;
    if (typeof item.completedAt !== 'number' || !Number.isFinite(item.completedAt) || item.completedAt <= 0) return false;
    if (typeof item.ruleVersion !== 'string' || !item.ruleVersion) return false;
    if (typeof item.aiType !== 'string' || !KNOWN_AI_TYPES.has(item.aiType)) return false;
    if (typeof item.aiStrategyVersion !== 'string' || !item.aiStrategyVersion) return false;

    // Record payload consistency
    const rec = item.record;
    if (!rec || typeof rec !== 'object') return false;
    if (rec.gameId !== item.gameId) return false;
    if (rec.ruleVersion !== item.ruleVersion) return false;
    if (rec.aiType !== item.aiType) return false;
    if (rec.aiStrategyVersion !== item.aiStrategyVersion) return false;
    if (rec.completedAt !== item.completedAt) return false;

    const s = rec.settlement;
    if (!s || typeof s !== 'object') return false;
    if (s.resultId !== item.resultId) return false;
    if (typeof s.wonAmount !== 'number' || !Number.isFinite(s.wonAmount) || s.wonAmount < 0) return false;
    if (typeof s.outcomeType !== 'string' || !KNOWN_OUTCOMES.has(s.outcomeType)) return false;

    return true;
  }

  /**
   * Move unprocessable or corrupt items into a quarantine directory so valid outbox items
   * can proceed without being stalled indefinitely, and no data is discarded.
   */
  private quarantine(filePath: string, reason: string): void {
    try {
      const quarantineDir = path.join(this.dir, 'quarantine');
      fs.mkdirSync(quarantineDir, { recursive: true });
      const filename = path.basename(filePath);
      const dest = path.join(quarantineDir, `${Date.now()}_${filename}`);
      fs.renameSync(filePath, dest);
      console.warn(`[OutboxManager] Item quarantined (${reason}): ${filename}`);
    } catch (err) {
      console.error('[OutboxManager] Failed to quarantine corrupt outbox item:', filePath);
    }
  }

  private handleConflict(item: OutboxItem, reason: string): void {
    const success = this.writeQuarantineItem(item, reason);
    if (!success) {
      const key = `${item.resultId}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      this.pendingQuarantines.set(key, { item, reason });
      this.scheduleRetry();
    }
  }

  private writeQuarantineItem(item: OutboxItem, reason: string): boolean {
    try {
      const quarantineDir = path.join(this.dir, 'quarantine');
      fs.mkdirSync(quarantineDir, { recursive: true });
      const safeId = isValidId(item.resultId) ? item.resultId : 'conflict';
      const suffix = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      const finalDest = path.join(quarantineDir, `${safeId}_conflict_${suffix}.json`);
      const tmpDest = path.join(quarantineDir, `${safeId}_conflict_${suffix}.tmp`);

      const payload = JSON.stringify({
        reason,
        quarantinedAt: Date.now(),
        item
      });

      const fd = fs.openSync(tmpDest, 'w');
      try {
        fs.writeSync(fd, payload);
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      fs.renameSync(tmpDest, finalDest);
      console.warn(`[OutboxManager] Item quarantined (${reason}): ${safeId}`);
      return true;
    } catch (err: any) {
      console.warn(
        `[OutboxManager] Failed to write quarantine file for ${item.resultId} (${err?.code || err?.message || 'io_error'})`
      );
      return false;
    }
  }

  private retryPendingQuarantines(): void {
    if (this.pendingQuarantines.size === 0) return;
    for (const [key, entry] of Array.from(this.pendingQuarantines.entries())) {
      if (this.writeQuarantineItem(entry.item, entry.reason)) {
        this.pendingQuarantines.delete(key);
      }
    }
    if (this.pendingQuarantines.size > 0 && !this.isClosed) {
      this.scheduleRetry();
    }
  }

  /**
   * Synchronous durable enqueue with atomic file write + fsync.
   * If item with same resultId already exists, strictly compares canonical content:
   * identical content is accepted as idempotent; differing content is rejected without overwriting.
   */
  public enqueue(item: OutboxItem): void {
    if (this.isClosed) {
      throw new Error('OutboxManager is closed');
    }

    if (!this.validateItem(item)) {
      throw new Error(`Invalid OutboxItem structure for resultId: ${(item as any)?.resultId}`);
    }

    const pending = this.pendingEnqueueMap.get(item.resultId);
    if (pending) {
      if (canonicalJson(pending) !== canonicalJson(item)) {
        this.handleConflict(item, 'conflict_with_pending');
        throw new Error(`Outbox item ${item.resultId} already exists with differing content in pending queue`);
      }
    }

    const finalFile = path.join(this.dir, `${item.resultId}.json`);

    // Conflict safety: check if same resultId already exists on disk
    if (fs.existsSync(finalFile)) {
      try {
        const existingRaw = fs.readFileSync(finalFile, 'utf8');
        const existing = JSON.parse(existingRaw);
        if (canonicalJson(existing) === canonicalJson(item)) {
          // Idempotent duplicate with identical content: clear pending and process
          this.pendingEnqueueMap.delete(item.resultId);
          this.processQueue();
          return;
        } else {
          // Differing owner, gameId, or payload: reject overwrite and preserve original file
          this.handleConflict(item, 'conflict_existing_file');
          throw new Error(`Outbox item ${item.resultId} already exists with differing content`);
        }
      } catch (err: any) {
        if (err.message?.includes('already exists with differing')) throw err;
        this.quarantine(finalFile, 'corrupt_existing_file');
      }
    }

    const tmpFile = path.join(
      this.dir,
      `${item.resultId}.tmp.${Date.now()}_${Math.random().toString(36).substring(2, 8)}`
    );
    const data = JSON.stringify(item);

    const fd = fs.openSync(tmpFile, 'w');
    try {
      fs.writeSync(fd, data);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmpFile, finalFile);

    // Best-effort directory fsync (supported on POSIX, handled gracefully on Windows)
    try {
      const dirFd = fs.openSync(this.dir, 'r');
      try {
        fs.fsyncSync(dirFd);
      } finally {
        fs.closeSync(dirFd);
      }
    } catch {
      // Directory fsync is best-effort across platforms
    }

    this.pendingEnqueueMap.delete(item.resultId);

    // Trigger processing asynchronously in background
    this.processQueue();
  }

  public enqueueWithRetry(item: OutboxItem): void {
    if (this.isClosed) {
      throw new Error('OutboxManager is closed');
    }

    if (!this.validateItem(item)) {
      throw new Error(`Invalid OutboxItem structure for resultId: ${(item as any)?.resultId}`);
    }

    const pending = this.pendingEnqueueMap.get(item.resultId);
    if (pending) {
      if (canonicalJson(pending) === canonicalJson(item)) {
        return;
      } else {
        this.handleConflict(item, 'conflict_with_pending');
        throw new Error(`Outbox item ${item.resultId} already exists with differing content in pending queue`);
      }
    }

    try {
      this.enqueue(item);
    } catch (err: any) {
      if (err.message?.includes('already exists with differing')) {
        throw err;
      }
      console.warn(
        `[OutboxManager] Failed to write outbox disk file for ${item.resultId} (${err?.code || err?.message || 'write_error'}), retaining in service memory for retry`
      );
      this.pendingEnqueueMap.set(item.resultId, item);
      this.scheduleRetry();
    }
  }

  public retryPendingEnqueues(): void {
    this.retryPendingQuarantines();
    if (this.pendingEnqueueMap.size === 0) return;

    for (const [resultId, item] of Array.from(this.pendingEnqueueMap.entries())) {
      try {
        this.enqueue(item);
        this.pendingEnqueueMap.delete(resultId);
      } catch (err: any) {
        if (err.message?.includes('already exists with differing')) {
          this.pendingEnqueueMap.delete(resultId);
        } else {
          console.warn(
            `[OutboxManager] Retry write failed for ${resultId} (${err?.code || err?.message || 'write_error'})`
          );
        }
      }
    }

    if (this.pendingEnqueueMap.size > 0 && !this.isClosed) {
      this.scheduleRetry();
    }
  }

  /**
   * Single-flight asynchronous queue processor.
   * Sets this.currentWorkPromise before execution, handles work.finally,
   * and catches errors to avoid unhandled promise rejections.
   */
  public processQueue(): Promise<void> {
    this.hasPendingWork = true;

    if (this.currentWorkPromise) {
      return this.currentWorkPromise;
    }

    if (this.isClosed) {
      return Promise.resolve();
    }

    const work = Promise.resolve().then(async () => {
      this.isProcessing = true;
      while (this.hasPendingWork && !this.isClosed) {
        this.hasPendingWork = false;
        await this.processPass();
      }
    });

    this.currentWorkPromise = work;

    void work
      .finally(() => {
        this.isProcessing = false;
        this.currentWorkPromise = null;
        if (this.hasPendingWork && !this.isClosed) {
          void this.processQueue();
        }
      })
      .catch(() => {});

    return work;
  }

  private async processPass(): Promise<void> {
    this.retryPendingEnqueues();

    let files: string[] = [];
    try {
      files = fs.readdirSync(this.dir).filter((f) => f.endsWith('.json'));
    } catch {
      return;
    }

    for (const file of files) {
      if (this.isClosed) break;

      const filePath = path.join(this.dir, file);
      let item: any;
      try {
        const raw = fs.readFileSync(filePath, 'utf8');
        item = JSON.parse(raw);
      } catch {
        this.quarantine(filePath, 'bad_json');
        continue;
      }

      if (!this.validateItem(item)) {
        this.quarantine(filePath, 'invalid_structure');
        continue;
      }

      try {
        let result: { conflictOwner?: boolean };
        if (item.kind === 'duel') {
          result = await this.db.insertCompletedDuel(item);
        } else if (item.kind === 'auction') {
          result = await this.db.insertCompletedAuction(item);
        } else if (item.kind === 'survivor') {
          result = await this.db.insertCompletedSurvivor(item);
        } else if (item.kind === 'tournament') {
          result = await this.db.insertCompletedTournament(item);
        } else {
          result = await this.db.insertCompletedGame(item);
        }
        if (result.conflictOwner) {
          console.warn(`[OutboxManager] Duplicate or conflicting record for result ${item.resultId}. Quarantining.`);
          this.quarantine(filePath, 'conflict_record');
          continue;
        }
        // Successfully inserted or matched: remove from outbox
        try {
          fs.unlinkSync(filePath);
        } catch {
          // ignore
        }
      } catch (err: any) {
        // Database is temporarily unreachable or query error occurred
        // Keep file in outbox and schedule retry
        console.warn(
          `[OutboxManager] Persistence failed for ${item.resultId} (${err?.code || err?.message || 'db_error'}), scheduling retry`
        );
        this.scheduleRetry();
        break; // Stop further processing in this pass until retry
      }
    }
  }

  private scheduleRetry(): void {
    if (this.isClosed || this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.processQueue();
    }, this.retryIntervalMs);
  }

  /**
   * Drain waits for all current and pending outbox items to be committed to the database.
   * Wrapped in Promise.race with actual timer deadline to prevent infinite hangs.
   * Uses a cancellation flag so that if the timeout occurs, the internal polling loop terminates immediately.
   */
  public async drain(timeoutMs = 5000): Promise<void> {
    this.retryPendingEnqueues();

    let timer: NodeJS.Timeout | null = null;
    let cancelled = false;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Outbox drain timed out after ${timeoutMs}ms`)), timeoutMs);
    });

    const drainLoop = async () => {
      while (!cancelled && !this.isClosed) {
        this.retryPendingEnqueues();
        if (this.currentWorkPromise) {
          await this.currentWorkPromise;
        }

        if (cancelled || this.isClosed) {
          break;
        }

        let hasFiles = false;
        try {
          hasFiles = fs.readdirSync(this.dir).some((f) => f.endsWith('.json'));
        } catch {
          // ignore
        }

        if (
          !hasFiles &&
          !this.hasPendingWork &&
          !this.currentWorkPromise &&
          this.pendingEnqueueMap.size === 0 &&
          this.pendingQuarantines.size === 0
        ) {
          break;
        }

        if (cancelled || this.isClosed) {
          break;
        }

        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    };

    try {
      await Promise.race([drainLoop(), timeoutPromise]);
    } finally {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (this.pendingEnqueueMap.size > 0 || this.pendingQuarantines.size > 0) {
        console.error(
          `[OutboxManager] Could not persist ${this.pendingEnqueueMap.size} pending items and ${this.pendingQuarantines.size} quarantine items during shutdown.`
        );
      }
    }
  }

  /**
   * Bounded close: waits up to timeoutMs for active work promise before shutting down.
   */
  public async close(timeoutMs = 3000): Promise<void> {
    this.isClosed = true;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.currentWorkPromise) {
      let timer: NodeJS.Timeout | null = null;
      try {
        await Promise.race([
          this.currentWorkPromise.catch(() => {}),
          new Promise<void>((resolve) => {
            timer = setTimeout(resolve, timeoutMs);
          })
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
  }
}
