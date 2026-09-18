import crypto from 'node:crypto';
import {
  RULE_VERSION,
  TOTAL_BOXES,
  MONEY_VALUES,
  ROUND_TARGETS,
  TOTAL_BOXES_TO_OPEN_BEFORE_FINAL,
  TIMEOUT_SECONDS
} from '../../../../packages/protocol/src/config';
import {
  AiType,
  AuditEvent,
  BoxStatus,
  ClientCommand,
  CommandResult,
  CompletedGameRecord,
  FairnessProof,
  FairnessPublicInfo,
  GamePhase,
  PublicBox,
  PublicGameEvent,
  PublicOffer,
  OfferOutcome,
  PublicOfferHistoryEntry,
  PublicSettlement,
  PublicSnapshot
} from '../../../../packages/protocol/src/types';
import { canonicalJsonStringify } from '../../../../packages/protocol/src/canonical';
import { FAIRNESS_ALGORITHM, GENESIS_PREVIOUS_HASH } from '../../../../packages/protocol/src/fairness';
import { validateClientCommand } from '../../../../packages/protocol/src/validation';
import { Clock, SystemClock } from './clock';
import {
  AiBehaviorSummary,
  AI_STRATEGY_VERSION,
  calculateBankerOfferDetails as calculateAiBankerOfferDetails,
  isValidAiType
} from './ai';
import { createAuditEvent } from './audit';
import { generateFairnessBundle } from './fairness';

interface CachedCommand {
  payloadHash: string;
  result: CommandResult;
}

export interface GameEngineOptions {
  gameId?: string;
  clock?: Clock;
  customBoxAmountMap?: Map<number, number> | number[];
  amountValues?: readonly number[];
  randomIntFn?: (min: number, max: number) => number;
  aiType?: AiType;
  seed?: string;
  salt?: string;
  ruleVersion?: string;
  openingTimeoutSeconds?: number;
}

export class GameEngine {
  public readonly gameId: string;
  public readonly aiType: AiType;
  private readonly clock: Clock;
  private readonly randomInt: (min: number, max: number) => number;
  private readonly amountValues: readonly number[];
  private readonly ruleVersion: string;
  private readonly openingTimeoutSeconds: number;

  // Fairness commitment state
  private readonly fairnessSupported: boolean;
  private readonly seed: string | null = null;
  private readonly salt: string | null = null;
  private readonly commitment: string | null = null;

  // Audit trail & offer history
  private readonly auditTrail: AuditEvent[] = [];
  private readonly offerHistory: PublicOfferHistoryEntry[] = [];
  private completedAt: number | null = null;

  // Secret internal box mapping
  private readonly boxAmountMap: Map<number, number>;
  private originalPlayerBoxId: number | null = null;
  private currentPlayerBoxId: number | null = null;
  private phase: GamePhase = 'SELECTING';
  private stateVersion = 1;
  private lastCommandSequence = 0;
  private currentRound = 1;
  private boxesOpenedThisRound = 0;
  private totalOpenedBoxes = 0;
  private readonly openedBoxIds = new Set<number>();
  private currentOffer: PublicOffer | null = null;
  private deadlineTimestamp: number | null = null;
  private activeTimer: { cancel: () => void } | null = null;
  private settlement: PublicSettlement | null = null;

  // Server-only decision history. It is never included in a public snapshot.
  private consecutiveOfferRejections = 0;
  private acceptedOfferCount = 0;
  private offerTimeoutCount = 0;

  // Idempotency cache: bounded LRU
  private readonly idempotencyCache = new Map<string, CachedCommand>();
  private static readonly MAX_IDEMPOTENCY_ENTRIES = 500;

  // Event listener for room broadcasting
  private onEventHandler?: (event: PublicGameEvent, snapshot: PublicSnapshot) => void;

  constructor(options: GameEngineOptions = {}) {
    this.gameId = options.gameId || ('game_' + crypto.randomUUID());
    this.clock = options.clock || new SystemClock();
    this.randomInt = options.randomIntFn || crypto.randomInt;
    this.ruleVersion = options.ruleVersion || RULE_VERSION;
    this.openingTimeoutSeconds = Number.isFinite(options.openingTimeoutSeconds)
      ? Math.max(1, Math.floor(options.openingTimeoutSeconds!))
      : TIMEOUT_SECONDS.OPEN_BOX;

    if (options.aiType !== undefined) {
      if (!isValidAiType(options.aiType)) {
        throw new Error(`Invalid aiType: ${options.aiType}`);
      }
      this.aiType = options.aiType;
    } else {
      this.aiType = 'conservative';
    }

    if (options.customBoxAmountMap) {
      // Custom mapping for engine unit tests; explicitly not supported for fairness proofs
      this.fairnessSupported = false;
      this.seed = null;
      this.salt = null;
      this.commitment = null;

      if (Array.isArray(options.customBoxAmountMap)) {
        if (options.customBoxAmountMap.length !== TOTAL_BOXES) {
          throw new Error('customBoxAmountMap array must have exactly 26 items');
        }
        this.boxAmountMap = new Map();
        for (let i = 0; i < TOTAL_BOXES; i++) {
          this.boxAmountMap.set(i + 1, options.customBoxAmountMap[i]);
        }
      } else {
        if (options.customBoxAmountMap.size !== TOTAL_BOXES) {
          throw new Error('customBoxAmountMap Map must have exactly 26 items');
        }
        this.boxAmountMap = new Map(options.customBoxAmountMap);
      }
      this.amountValues = Array.from(this.boxAmountMap.values());
    } else {
      // Standard game: generate fairness bundle with seed, salt, commitment and HMAC-FY shuffle
      this.fairnessSupported = true;
      const bundle = generateFairnessBundle(this.gameId, {
        seed: options.seed,
        salt: options.salt,
        ruleVersion: this.ruleVersion,
        amounts: options.amountValues
      });
      this.seed = bundle.seed;
      this.salt = bundle.salt;
      this.commitment = bundle.commitment;
      this.boxAmountMap = bundle.boxAmountMap;
      this.amountValues = Array.from(options.amountValues || MONEY_VALUES);
    }

    // Record initial GAME_CREATED event in audit chain (public info only!)
    this.recordAuditEvent('GAME_CREATED', {
      gameId: this.gameId,
      ruleVersion: this.ruleVersion,
      aiType: this.aiType,
      aiStrategyVersion: AI_STRATEGY_VERSION,
      fairnessSupported: this.fairnessSupported,
      commitment: this.commitment
    });

    // Arm the initial timeout for choosing player box (30s)
    this.armTimeout('SELECTING', TIMEOUT_SECONDS.SELECT_PLAYER_BOX);
  }

  public setOnEventHandler(handler: (event: PublicGameEvent, snapshot: PublicSnapshot) => void) {
    this.onEventHandler = handler;
  }

  private recordAuditEvent(type: string, payload: Record<string, unknown>): AuditEvent {
    const seq = this.auditTrail.length + 1;
    const previousHash =
      this.auditTrail.length === 0
        ? GENESIS_PREVIOUS_HASH
        : this.auditTrail[this.auditTrail.length - 1].hash;

    const event = createAuditEvent({
      seq,
      timestamp: this.clock.now(),
      type,
      payload,
      previousHash
    });

    this.auditTrail.push(event);
    return event;
  }

  private getClonedAuditTrail(): AuditEvent[] {
    return this.auditTrail.map((e) => ({
      ...e,
      payload: { ...e.payload }
    }));
  }

  private armTimeout(phase: GamePhase, seconds: number): void {
    if (this.activeTimer) {
      this.activeTimer.cancel();
      this.activeTimer = null;
    }
    const ms = seconds * 1000;
    this.deadlineTimestamp = this.clock.now() + ms;
    this.activeTimer = this.clock.setTimeout(() => {
      this.handleTimeout(phase);
    }, ms);
  }

  private clearTimer(): void {
    if (this.activeTimer) {
      this.activeTimer.cancel();
      this.activeTimer = null;
    }
    this.deadlineTimestamp = null;
  }

  private handleTimeout(phase: GamePhase): void {
    if (this.phase !== phase || this.phase === 'FINISHED') return;

    if (phase === 'SELECTING') {
      const available = this.getAvailableUnopenedBoxIds();
      if (available.length > 0) {
        const randomIndex = this.randomInt(0, available.length);
        this.executeSelectBox(available[randomIndex], undefined, 'timeout');
      }
    } else if (phase === 'OPENING') {
      const candidates = this.getAvailableUnopenedBoxIds().filter(
        (id) => id !== this.currentPlayerBoxId
      );
      if (candidates.length > 0) {
        const randomIndex = this.randomInt(0, candidates.length);
        this.executeOpenBox(candidates[randomIndex], undefined, 'timeout');
      }
    } else if (phase === 'OFFERING') {
      if (this.currentOffer) {
        this.executeRejectOffer(this.currentOffer.offerId, undefined, 'timeout');
      }
    } else if (phase === 'FINAL_SWAP') {
      this.executeKeepBox(undefined, 'timeout');
    }
  }

  private getAvailableUnopenedBoxIds(): number[] {
    const list: number[] = [];
    for (let id = 1; id <= TOTAL_BOXES; id++) {
      if (!this.openedBoxIds.has(id)) {
        list.push(id);
      }
    }
    return list;
  }

  private calculateBankerOffer(): { amount: number; dialogue: string } {
    const unopenedIds = this.getAvailableUnopenedBoxIds();
    const unopenedAmounts = unopenedIds.map((id) => this.boxAmountMap.get(id)!);
    const behavior: AiBehaviorSummary = {
      consecutiveRejections: this.consecutiveOfferRejections,
      acceptedOffers: this.acceptedOfferCount,
      timeoutCount: this.offerTimeoutCount
    };
    return calculateAiBankerOfferDetails({
      aiType: this.aiType,
      round: this.currentRound,
      unopenedAmounts,
      behavior,
      randomIntFn: this.randomInt
    });
  }

  public processCommand(rawInput: unknown): CommandResult {
    // 1. Snapshot request (read-only, does not mutate state or consume sequence)
    if (
      rawInput &&
      typeof rawInput === 'object' &&
      (rawInput as Record<string, unknown>).type === 'REQUEST_SNAPSHOT'
    ) {
      return {
        success: true,
        stateVersion: this.stateVersion,
        snapshot: this.getPublicSnapshot()
      };
    }

    // 2. Validate client command at entry point to prevent type bypass
    const validation = validateClientCommand(rawInput);
    if (!validation.valid || !validation.command) {
      const rawObj =
        rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput)
          ? (rawInput as Record<string, unknown>)
          : null;
      const extractedKey =
        typeof rawObj?.idempotencyKey === 'string' && rawObj.idempotencyKey.length <= 128
          ? rawObj.idempotencyKey
          : undefined;
      return {
        success: false,
        idempotencyKey: extractedKey,
        stateVersion: this.stateVersion,
        snapshot: this.getPublicSnapshot(),
        error: validation.error || { code: 'INVALID_PAYLOAD', message: 'Invalid command payload' }
      };
    }

    if (validation.command.type === 'REQUEST_SNAPSHOT') {
      return {
        success: true,
        stateVersion: this.stateVersion,
        snapshot: this.getPublicSnapshot()
      };
    }

    const command = validation.command;

    // 3. Compute canonical payload hash for idempotency checking (property order independent)
    const payloadHash = canonicalJsonStringify(command);

    // 4. IDEMPOTENCY CHECK MUST HAPPEN FIRST before gameId, version, sequence, or deadline check!
    const cached = this.idempotencyCache.get(command.idempotencyKey);
    if (cached) {
      if (cached.payloadHash === payloadHash) {
        // Exact duplicate request -> return previous result immediately without executing again
        return cached.result;
      } else {
        // Same key, different payload -> conflict error
        return {
          success: false,
          idempotencyKey: command.idempotencyKey,
          stateVersion: this.stateVersion,
          snapshot: this.getPublicSnapshot(),
          error: {
            code: 'IDEMPOTENCY_CONFLICT',
            message: 'Idempotency key reused with different command payload'
          }
        };
      }
    }

    // 5. Validate gameId against this engine's gameId
    if (command.gameId !== this.gameId) {
      return {
        success: false,
        idempotencyKey: command.idempotencyKey,
        stateVersion: this.stateVersion,
        snapshot: this.getPublicSnapshot(),
        error: {
          code: 'INVALID_PAYLOAD',
          message: `Game ID mismatch: expected ${this.gameId}, got ${command.gameId}`
        }
      };
    }

    // 6. Deadline check: at now >= deadline execute authoritative timeout FIRST via same path
    const now = this.clock.now();
    if (this.deadlineTimestamp !== null && now >= this.deadlineTimestamp && this.phase !== 'FINISHED') {
      this.handleTimeout(this.phase);
      return {
        success: false,
        idempotencyKey: command.idempotencyKey,
        stateVersion: this.stateVersion,
        snapshot: this.getPublicSnapshot(),
        error: {
          code: 'STALE_VERSION',
          message: 'Command arrived after phase deadline expired'
        }
      };
    }

    // 7. Stale version check: command must specify the current stateVersion
    if (command.stateVersion !== this.stateVersion) {
      return {
        success: false,
        idempotencyKey: command.idempotencyKey,
        stateVersion: this.stateVersion,
        snapshot: this.getPublicSnapshot(),
        error: {
          code: 'STALE_VERSION',
          message: `State version mismatch: expected ${this.stateVersion}, got ${command.stateVersion}`
        }
      };
    }

    // 8. Sequence check: must be strictly increasing
    if (command.commandSequence !== this.lastCommandSequence + 1) {
      return {
        success: false,
        idempotencyKey: command.idempotencyKey,
        stateVersion: this.stateVersion,
        snapshot: this.getPublicSnapshot(),
        error: {
          code: 'OUT_OF_SEQUENCE',
          message: `Command sequence out of order: expected ${this.lastCommandSequence + 1}, got ${command.commandSequence}`
        }
      };
    }

    // 9. Game must not be finished
    if (this.phase === 'FINISHED') {
      return {
        success: false,
        idempotencyKey: command.idempotencyKey,
        stateVersion: this.stateVersion,
        snapshot: this.getPublicSnapshot(),
        error: {
          code: 'INVALID_PHASE',
          message: 'Game is already finished'
        }
      };
    }

    // 10. Dispatch command by type with commandSequence passed to ensure coherent broadcast/result snapshots
    let res: CommandResult;
    switch (command.type) {
      case 'SELECT_BOX':
        res = this.executeSelectBox(command.boxId, command.commandSequence, 'player');
        break;
      case 'OPEN_BOX':
        res = this.executeOpenBox(command.boxId, command.commandSequence, 'player');
        break;
      case 'ACCEPT_OFFER':
        res = this.executeAcceptOffer(command.offerId, command.commandSequence, 'player');
        break;
      case 'REJECT_OFFER':
        res = this.executeRejectOffer(command.offerId, command.commandSequence, 'player');
        break;
      case 'KEEP_BOX':
        res = this.executeKeepBox(command.commandSequence, 'player');
        break;
      case 'SWAP_BOX':
        res = this.executeSwapBox(command.targetBoxId, command.commandSequence, 'player');
        break;
      default:
        res = {
          success: false,
          stateVersion: this.stateVersion,
          snapshot: this.getPublicSnapshot(),
          error: { code: 'INVALID_PAYLOAD', message: 'Unknown command' }
        };
        break;
    }

    res.idempotencyKey = command.idempotencyKey;
    if (!res.snapshot) {
      res.snapshot = this.getPublicSnapshot();
    }

    if (res.success) {
      this.recordIdempotency(command.idempotencyKey, payloadHash, res);
    }

    return res;
  }

  private recordIdempotency(key: string, payloadHash: string, result: CommandResult) {
    if (this.idempotencyCache.size >= GameEngine.MAX_IDEMPOTENCY_ENTRIES) {
      const firstKey = this.idempotencyCache.keys().next().value;
      if (firstKey !== undefined) {
        this.idempotencyCache.delete(firstKey);
      }
    }
    this.idempotencyCache.set(key, { payloadHash, result });
  }

  private executeSelectBox(
    boxId: number,
    commandSequence?: number,
    source: 'player' | 'timeout' = 'player'
  ): CommandResult {
    if (this.phase !== 'SELECTING') {
      return {
        success: false,
        stateVersion: this.stateVersion,
        snapshot: this.getPublicSnapshot(),
        error: {
          code: 'INVALID_PHASE',
          message: 'Player box can only be selected during SELECTING phase'
        }
      };
    }

    if (boxId < 1 || boxId > TOTAL_BOXES) {
      return {
        success: false,
        stateVersion: this.stateVersion,
        snapshot: this.getPublicSnapshot(),
        error: { code: 'INVALID_BOX', message: 'Box ID out of bounds' }
      };
    }

    if (commandSequence !== undefined) {
      this.lastCommandSequence = commandSequence;
    }

    this.originalPlayerBoxId = boxId;
    this.currentPlayerBoxId = boxId;
    this.phase = 'OPENING';
    this.stateVersion++;

    // Arm timer for opening box in round 1 (20s)
    this.armTimeout('OPENING', this.openingTimeoutSeconds);

    // Record audit event FIRST before generating snapshot
    this.recordAuditEvent('BOX_SELECTED', {
      boxId,
      source
    });

    const event: PublicGameEvent = {
      type: 'BOX_SELECTED',
      boxId,
      stateVersion: this.stateVersion
    };
    const snapshot = this.getPublicSnapshot();
    this.notifyEvent(event, snapshot);

    return {
      success: true,
      stateVersion: this.stateVersion,
      event,
      snapshot
    };
  }

  private executeOpenBox(
    boxId: number,
    commandSequence?: number,
    source: 'player' | 'timeout' = 'player'
  ): CommandResult {
    if (this.phase !== 'OPENING') {
      return {
        success: false,
        stateVersion: this.stateVersion,
        snapshot: this.getPublicSnapshot(),
        error: { code: 'INVALID_PHASE', message: 'Boxes can only be opened during OPENING phase' }
      };
    }

    if (boxId < 1 || boxId > TOTAL_BOXES) {
      return {
        success: false,
        stateVersion: this.stateVersion,
        snapshot: this.getPublicSnapshot(),
        error: { code: 'INVALID_BOX', message: 'Box ID out of bounds' }
      };
    }

    if (boxId === this.currentPlayerBoxId) {
      return {
        success: false,
        stateVersion: this.stateVersion,
        snapshot: this.getPublicSnapshot(),
        error: {
          code: 'INVALID_BOX',
          message: 'Cannot open player selected box during regular opening'
        }
      };
    }

    if (this.openedBoxIds.has(boxId)) {
      return {
        success: false,
        stateVersion: this.stateVersion,
        snapshot: this.getPublicSnapshot(),
        error: { code: 'INVALID_BOX', message: 'Box has already been opened' }
      };
    }

    if (commandSequence !== undefined) {
      this.lastCommandSequence = commandSequence;
    }

    // Open box
    this.openedBoxIds.add(boxId);
    this.boxesOpenedThisRound++;
    this.totalOpenedBoxes++;
    const revealedAmount = this.boxAmountMap.get(boxId)!;
    this.stateVersion++;

    // Record audit event for box open
    this.recordAuditEvent('BOX_OPENED', {
      boxId,
      revealedAmount,
      round: this.currentRound,
      source
    });

    const openEvent: PublicGameEvent = {
      type: 'BOX_OPENED',
      boxId,
      revealedAmount,
      stateVersion: this.stateVersion
    };

    // Check game progression:
    // If total opened boxes reaches 24 (only 2 boxes remain unopened), transition directly to FINAL_SWAP!
    if (this.totalOpenedBoxes >= TOTAL_BOXES_TO_OPEN_BEFORE_FINAL) {
      this.phase = 'FINAL_SWAP';
      this.currentOffer = null;
      this.armTimeout('FINAL_SWAP', TIMEOUT_SECONDS.FINAL_CHOICE);
    } else {
      const currentTarget = ROUND_TARGETS[this.currentRound - 1] ?? 1;
      if (this.boxesOpenedThisRound >= currentTarget) {
        // Round complete -> Banker Offer Phase!
        this.phase = 'OFFERING';
        const offerDecision = this.calculateBankerOffer();
        const offerId = 'off_' + crypto.randomUUID();
        const expiresAt = this.clock.now() + TIMEOUT_SECONDS.BANKER_OFFER * 1000;
        this.currentOffer = {
          offerId,
          amount: offerDecision.amount,
          expiresAt,
          dialogue: offerDecision.dialogue
        };
        this.offerHistory.push({
          offerId,
          round: this.currentRound,
          amount: offerDecision.amount,
          expiresAt,
          outcome: 'PENDING',
          dialogue: offerDecision.dialogue
        });
        this.recordAuditEvent('OFFER_MADE', {
          offerId,
          round: this.currentRound,
          amount: offerDecision.amount,
          dialogue: offerDecision.dialogue,
          expiresAt
        });
        this.armTimeout('OFFERING', TIMEOUT_SECONDS.BANKER_OFFER);
      } else {
        // Still opening boxes in current round
        this.armTimeout('OPENING', this.openingTimeoutSeconds);
      }
    }

    const snapshot = this.getPublicSnapshot();
    this.notifyEvent(openEvent, snapshot);

    return {
      success: true,
      stateVersion: this.stateVersion,
      event: openEvent,
      snapshot
    };
  }

  private executeAcceptOffer(
    offerId: string,
    commandSequence?: number,
    source: 'player' | 'timeout' = 'player'
  ): CommandResult {
    if (this.phase !== 'OFFERING') {
      return {
        success: false,
        stateVersion: this.stateVersion,
        snapshot: this.getPublicSnapshot(),
        error: { code: 'INVALID_PHASE', message: 'Offers can only be accepted during OFFERING phase' }
      };
    }

    if (!this.currentOffer || this.currentOffer.offerId !== offerId) {
      return {
        success: false,
        stateVersion: this.stateVersion,
        snapshot: this.getPublicSnapshot(),
        error: { code: 'OFFER_EXPIRED', message: 'Offer ID mismatch or no active offer' }
      };
    }

    if (this.clock.now() >= this.currentOffer.expiresAt) {
      return {
        success: false,
        stateVersion: this.stateVersion,
        snapshot: this.getPublicSnapshot(),
        error: { code: 'OFFER_EXPIRED', message: 'Offer has expired' }
      };
    }

    if (commandSequence !== undefined) {
      this.lastCommandSequence = commandSequence;
    }

    this.clearTimer();
    const acceptedAmount = this.currentOffer.amount;
    this.acceptedOfferCount++;
    this.consecutiveOfferRejections = 0;
    this.phase = 'FINISHED';
    this.completedAt = this.clock.now();
    this.stateVersion++;

    // Update outcome in offer history
    const histEntry = this.offerHistory.find((o) => o.offerId === offerId);
    if (histEntry) {
      histEntry.outcome = 'ACCEPTED';
    }

    this.recordAuditEvent('OFFER_ACCEPTED', {
      offerId,
      amount: acceptedAmount,
      source
    });

    const resultId = 'res_' + crypto.randomUUID();
    const finalBoxAmount = this.boxAmountMap.get(this.currentPlayerBoxId!)!;
    const originalBoxAmount = this.boxAmountMap.get(this.originalPlayerBoxId!)!;
    const highestOfferAmount =
      this.offerHistory.length > 0 ? Math.max(...this.offerHistory.map((o) => o.amount)) : 0;

    let fairnessProof: FairnessProof | null = null;
    if (this.fairnessSupported && this.seed && this.salt && this.commitment) {
      fairnessProof = {
        algorithm: FAIRNESS_ALGORITHM,
        gameId: this.gameId,
        ruleVersion: this.ruleVersion,
        seed: this.seed,
        salt: this.salt,
        amounts: [...this.amountValues],
        roundTargets: [...ROUND_TARGETS],
        commitment: this.commitment
      };
    }

    this.recordAuditEvent('GAME_SETTLED', {
      resultId,
      wonAmount: acceptedAmount,
      outcomeType: 'OFFER_ACCEPTED',
      originalPlayerBoxId: this.originalPlayerBoxId!,
      finalPlayerBoxId: this.currentPlayerBoxId!,
      originalBoxAmount,
      highestOfferAmount
    });

    this.settlement = {
      resultId,
      wonAmount: acceptedAmount,
      outcomeType: 'OFFER_ACCEPTED',
      originalPlayerBoxId: this.originalPlayerBoxId!,
      finalPlayerBoxId: this.currentPlayerBoxId!,
      acceptedOfferAmount: acceptedAmount,
      finalBoxAmount,
      allBoxes: this.getAllBoxesRevealed(),
      fairnessProof,
      auditTrail: this.getClonedAuditTrail(),
      originalBoxAmount,
      highestOfferAmount
    };
    this.currentOffer = null;

    const event: PublicGameEvent = {
      type: 'OFFER_ACCEPTED',
      offerId,
      amount: acceptedAmount,
      stateVersion: this.stateVersion
    };

    const snapshot = this.getPublicSnapshot();
    this.notifyEvent(event, snapshot);

    return {
      success: true,
      stateVersion: this.stateVersion,
      event,
      snapshot
    };
  }

  private executeRejectOffer(
    offerId: string,
    commandSequence?: number,
    source: 'player' | 'timeout' = 'player'
  ): CommandResult {
    if (this.phase !== 'OFFERING') {
      return {
        success: false,
        stateVersion: this.stateVersion,
        snapshot: this.getPublicSnapshot(),
        error: { code: 'INVALID_PHASE', message: 'Offers can only be rejected during OFFERING phase' }
      };
    }

    if (!this.currentOffer || this.currentOffer.offerId !== offerId) {
      return {
        success: false,
        stateVersion: this.stateVersion,
        snapshot: this.getPublicSnapshot(),
        error: { code: 'OFFER_EXPIRED', message: 'Offer ID mismatch or no active offer' }
      };
    }

    if (commandSequence !== undefined) {
      this.lastCommandSequence = commandSequence;
    }

    this.clearTimer();
    this.currentOffer = null;

    // Update outcome in offer history: timeout is EXPIRED, explicit command is REJECTED
    const outcome: OfferOutcome = source === 'timeout' ? 'EXPIRED' : 'REJECTED';
    if (source === 'timeout') this.offerTimeoutCount++;
    this.consecutiveOfferRejections++;
    const histEntry = this.offerHistory.find((o) => o.offerId === offerId);
    if (histEntry) {
      histEntry.outcome = outcome;
    }

    this.recordAuditEvent('OFFER_REJECTED', {
      offerId,
      nextRound: this.currentRound + 1,
      source,
      outcome
    });

    this.currentRound++;
    this.boxesOpenedThisRound = 0;
    this.phase = 'OPENING';
    this.stateVersion++;

    // Arm timeout for next round opening
        this.armTimeout('OPENING', this.openingTimeoutSeconds);

    const event: PublicGameEvent = {
      type: 'OFFER_REJECTED',
      offerId,
      nextRound: this.currentRound,
      stateVersion: this.stateVersion
    };

    const snapshot = this.getPublicSnapshot();
    this.notifyEvent(event, snapshot);

    return {
      success: true,
      stateVersion: this.stateVersion,
      event,
      snapshot
    };
  }

  private executeKeepBox(
    commandSequence?: number,
    source: 'player' | 'timeout' = 'player'
  ): CommandResult {
    if (this.phase !== 'FINAL_SWAP') {
      return {
        success: false,
        stateVersion: this.stateVersion,
        snapshot: this.getPublicSnapshot(),
        error: { code: 'INVALID_PHASE', message: 'Keep box only valid during FINAL_SWAP phase' }
      };
    }

    if (commandSequence !== undefined) {
      this.lastCommandSequence = commandSequence;
    }

    this.clearTimer();
    this.phase = 'FINISHED';
    this.completedAt = this.clock.now();
    this.stateVersion++;

    const resultId = 'res_' + crypto.randomUUID();
    const wonAmount = this.boxAmountMap.get(this.currentPlayerBoxId!)!;
    const originalBoxAmount = this.boxAmountMap.get(this.originalPlayerBoxId!)!;
    const highestOfferAmount =
      this.offerHistory.length > 0 ? Math.max(...this.offerHistory.map((o) => o.amount)) : 0;

    let fairnessProof: FairnessProof | null = null;
    if (this.fairnessSupported && this.seed && this.salt && this.commitment) {
      fairnessProof = {
        algorithm: FAIRNESS_ALGORITHM,
        gameId: this.gameId,
        ruleVersion: this.ruleVersion,
        seed: this.seed,
        salt: this.salt,
        amounts: [...this.amountValues],
        roundTargets: [...ROUND_TARGETS],
        commitment: this.commitment
      };
    }

    this.recordAuditEvent('FINAL_KEEP', {
      boxId: this.currentPlayerBoxId!,
      amount: wonAmount,
      source
    });

    this.recordAuditEvent('GAME_SETTLED', {
      resultId,
      wonAmount,
      outcomeType: 'FINAL_KEEP',
      originalPlayerBoxId: this.originalPlayerBoxId!,
      finalPlayerBoxId: this.currentPlayerBoxId!,
      originalBoxAmount,
      highestOfferAmount
    });

    this.settlement = {
      resultId,
      wonAmount,
      outcomeType: 'FINAL_KEEP',
      originalPlayerBoxId: this.originalPlayerBoxId!,
      finalPlayerBoxId: this.currentPlayerBoxId!,
      finalBoxAmount: wonAmount,
      allBoxes: this.getAllBoxesRevealed(),
      fairnessProof,
      auditTrail: this.getClonedAuditTrail(),
      originalBoxAmount,
      highestOfferAmount
    };

    const event: PublicGameEvent = {
      type: 'FINAL_KEEP',
      boxId: this.currentPlayerBoxId!,
      amount: wonAmount,
      stateVersion: this.stateVersion
    };

    const snapshot = this.getPublicSnapshot();
    this.notifyEvent(event, snapshot);

    return {
      success: true,
      stateVersion: this.stateVersion,
      event,
      snapshot
    };
  }

  private executeSwapBox(
    targetBoxId: number,
    commandSequence?: number,
    source: 'player' | 'timeout' = 'player'
  ): CommandResult {
    if (this.phase !== 'FINAL_SWAP') {
      return {
        success: false,
        stateVersion: this.stateVersion,
        snapshot: this.getPublicSnapshot(),
        error: { code: 'INVALID_PHASE', message: 'Swap box only valid during FINAL_SWAP phase' }
      };
    }

    if (targetBoxId < 1 || targetBoxId > TOTAL_BOXES) {
      return {
        success: false,
        stateVersion: this.stateVersion,
        snapshot: this.getPublicSnapshot(),
        error: { code: 'INVALID_BOX', message: 'Target box ID out of bounds' }
      };
    }

    if (targetBoxId === this.currentPlayerBoxId) {
      return {
        success: false,
        stateVersion: this.stateVersion,
        snapshot: this.getPublicSnapshot(),
        error: { code: 'INVALID_BOX', message: 'Cannot swap with player currently chosen box' }
      };
    }

    if (this.openedBoxIds.has(targetBoxId)) {
      return {
        success: false,
        stateVersion: this.stateVersion,
        snapshot: this.getPublicSnapshot(),
        error: { code: 'INVALID_BOX', message: 'Cannot swap with an already opened box' }
      };
    }

    if (commandSequence !== undefined) {
      this.lastCommandSequence = commandSequence;
    }

    this.clearTimer();
    const oldBoxId = this.currentPlayerBoxId!;
    this.currentPlayerBoxId = targetBoxId;
    this.phase = 'FINISHED';
    this.completedAt = this.clock.now();
    this.stateVersion++;

    const resultId = 'res_' + crypto.randomUUID();
    const wonAmount = this.boxAmountMap.get(targetBoxId)!;
    const originalBoxAmount = this.boxAmountMap.get(this.originalPlayerBoxId!)!;
    const highestOfferAmount =
      this.offerHistory.length > 0 ? Math.max(...this.offerHistory.map((o) => o.amount)) : 0;

    let fairnessProof: FairnessProof | null = null;
    if (this.fairnessSupported && this.seed && this.salt && this.commitment) {
      fairnessProof = {
        algorithm: FAIRNESS_ALGORITHM,
        gameId: this.gameId,
        ruleVersion: this.ruleVersion,
        seed: this.seed,
        salt: this.salt,
        amounts: [...this.amountValues],
        roundTargets: [...ROUND_TARGETS],
        commitment: this.commitment
      };
    }

    this.recordAuditEvent('FINAL_SWAP', {
      originalBoxId: oldBoxId,
      newBoxId: targetBoxId,
      amount: wonAmount,
      source
    });

    this.recordAuditEvent('GAME_SETTLED', {
      resultId,
      wonAmount,
      outcomeType: 'FINAL_SWAP',
      originalPlayerBoxId: this.originalPlayerBoxId!,
      finalPlayerBoxId: targetBoxId,
      originalBoxAmount,
      highestOfferAmount
    });

    this.settlement = {
      resultId,
      wonAmount,
      outcomeType: 'FINAL_SWAP',
      originalPlayerBoxId: this.originalPlayerBoxId!,
      finalPlayerBoxId: targetBoxId,
      finalBoxAmount: wonAmount,
      allBoxes: this.getAllBoxesRevealed(),
      fairnessProof,
      auditTrail: this.getClonedAuditTrail(),
      originalBoxAmount,
      highestOfferAmount
    };

    const event: PublicGameEvent = {
      type: 'FINAL_SWAP',
      originalBoxId: oldBoxId,
      newBoxId: targetBoxId,
      amount: wonAmount,
      stateVersion: this.stateVersion
    };

    const snapshot = this.getPublicSnapshot();
    this.notifyEvent(event, snapshot);

    return {
      success: true,
      stateVersion: this.stateVersion,
      event,
      snapshot
    };
  }

  private getAllBoxesRevealed(): Array<{ id: number; amount: number }> {
    const list: Array<{ id: number; amount: number }> = [];
    for (let id = 1; id <= TOTAL_BOXES; id++) {
      list.push({ id, amount: this.boxAmountMap.get(id)! });
    }
    return list;
  }

  private notifyEvent(event: PublicGameEvent, snapshot: PublicSnapshot) {
    if (this.onEventHandler) {
      this.onEventHandler(structuredClone(event), structuredClone(snapshot));
    }
  }

  public getPublicSnapshot(): PublicSnapshot {
    const boxes: PublicBox[] = [];
    for (let id = 1; id <= TOTAL_BOXES; id++) {
      if (this.openedBoxIds.has(id)) {
        boxes.push({
          id,
          status: 'opened',
          revealedAmount: this.boxAmountMap.get(id)!
        });
      } else if (id === this.currentPlayerBoxId) {
        boxes.push({
          id,
          status: 'selected'
        });
      } else {
        boxes.push({
          id,
          status: 'unopened'
        });
      }
    }

    const currentRoundIndex = this.currentRound - 1;
    const targetThisRound =
      this.phase === 'OPENING' && currentRoundIndex < ROUND_TARGETS.length
        ? ROUND_TARGETS[currentRoundIndex]
        : 0;
    const boxesToOpenThisRound =
      this.phase === 'OPENING' ? Math.max(0, targetThisRound - this.boxesOpenedThisRound) : 0;

    const fairness: FairnessPublicInfo = {
      supported: this.fairnessSupported,
      algorithm: this.fairnessSupported ? FAIRNESS_ALGORITHM : undefined,
      commitment: this.commitment ?? undefined
    };

    return {
      gameId: this.gameId,
      ruleVersion: this.ruleVersion,
      phase: this.phase,
      stateVersion: this.stateVersion,
      lastCommandSequence: this.lastCommandSequence,
      serverNow: this.clock.now(),
      originalPlayerBoxId: this.originalPlayerBoxId,
      currentPlayerBoxId: this.currentPlayerBoxId,
      currentRound: this.currentRound,
      boxesToOpenThisRound,
      totalOpenedBoxes: this.totalOpenedBoxes,
      unopenedCount: TOTAL_BOXES - this.totalOpenedBoxes,
      boxes,
      currentOffer: this.currentOffer
        ? {
            offerId: this.currentOffer.offerId,
            amount: this.currentOffer.amount,
            expiresAt: this.currentOffer.expiresAt,
            dialogue: this.currentOffer.dialogue
          }
        : null,
      deadlineTimestamp: this.deadlineTimestamp,
      settlement: this.settlement
        ? {
            ...this.settlement,
            allBoxes: this.settlement.allBoxes
              ? this.settlement.allBoxes.map((b) => ({ ...b }))
              : undefined,
            fairnessProof: this.settlement.fairnessProof
              ? {
                  ...this.settlement.fairnessProof,
                  amounts: [...this.settlement.fairnessProof.amounts],
                  roundTargets: [...this.settlement.fairnessProof.roundTargets]
                }
              : this.settlement.fairnessProof,
            auditTrail: this.settlement.auditTrail
              ? this.settlement.auditTrail.map((e) => ({
                  ...e,
                  payload: { ...e.payload }
                }))
              : undefined
          }
        : null,
      aiType: this.aiType,
      offerHistory: this.offerHistory.map((o) => ({ ...o })),
      fairness
    };
  }

  /**
   * Returns an immutable, detached record of the completed game.
   * Strictly returns null if game is not FINISHED.
   */
  public getCompletedRecord(): CompletedGameRecord | null {
    if (this.phase !== 'FINISHED' || !this.settlement || this.completedAt === null) {
      return null;
    }

    return structuredClone({
      gameId: this.gameId,
      ruleVersion: this.ruleVersion,
      aiType: this.aiType,
      aiStrategyVersion: AI_STRATEGY_VERSION,
      settlement: this.settlement,
      offerHistory: this.offerHistory,
      auditTrail: this.auditTrail,
      completedAt: this.completedAt
    });
  }

  public isFinished(): boolean {
    return this.phase === 'FINISHED';
  }

  public getStateVersion(): number {
    return this.stateVersion;
  }

  public getPhase(): GamePhase {
    return this.phase;
  }

  public getOriginalPlayerBoxId(): number | null {
    return this.originalPlayerBoxId;
  }

  public getCurrentPlayerBoxId(): number | null {
    return this.currentPlayerBoxId;
  }

  public getSettlement(): PublicSettlement | null {
    if (!this.settlement) return null;
    return structuredClone(this.settlement);
  }

  /** Metadata-only extension point for versioned modes that add a legal action
   * without changing the Classic command state machine. */
  public processMetadataCommand(commandSequence: number): CommandResult {
    if (!Number.isInteger(commandSequence) || commandSequence !== this.lastCommandSequence + 1) {
      return {
        success: false,
        stateVersion: this.stateVersion,
        snapshot: this.getPublicSnapshot(),
        error: { code: 'OUT_OF_SEQUENCE', message: 'Command sequence out of order' }
      };
    }
    this.lastCommandSequence = commandSequence;
    this.stateVersion++;
    return { success: true, stateVersion: this.stateVersion, snapshot: this.getPublicSnapshot() };
  }

  public dispose(): void {
    this.clearTimer();
  }
}
