import crypto from 'node:crypto';
import { MONEY_VALUES } from '../../../../packages/protocol/src/config';
import { AiType } from '../../../../packages/protocol/src/types';

export const AI_STRATEGY_VERSION = 'ai-v1';
export const ALLOWED_AI_TYPES: readonly AiType[] = ['conservative', 'aggressive', 'cold', 'inducement', 'crazy'] as const;

// The top 3 initial money values from MONEY_VALUES
export const INITIAL_TOP_3_AMOUNTS: readonly number[] = MONEY_VALUES.slice(-3); // [500000, 750000, 1000000]

export interface CalculateOfferParams {
  aiType: AiType;
  round: number;
  unopenedAmounts: number[];
  /** Server-only summary of decisions made earlier in this game. */
  behavior?: AiBehaviorSummary;
  randomIntFn?: (min: number, max: number) => number;
}

export interface AiBehaviorSummary {
  consecutiveRejections: number;
  acceptedOffers: number;
  timeoutCount: number;
}

export interface BankerOfferDecision {
  amount: number;
  dialogue: string;
}

export function isValidAiType(val: unknown): val is AiType {
  return typeof val === 'string' && (ALLOWED_AI_TYPES as readonly string[]).includes(val);
}

/**
 * Server-only calculation of Banker Offer.
 * No internal formula, EV, or multiplier is ever exported to the client.
 */
export function calculateBankerOfferDetails(params: CalculateOfferParams): BankerOfferDecision {
  const {
    aiType,
    round,
    unopenedAmounts,
    behavior = { consecutiveRejections: 0, acceptedOffers: 0, timeoutCount: 0 },
    randomIntFn = crypto.randomInt
  } = params;

  if (!unopenedAmounts || unopenedAmounts.length === 0) {
    return { amount: 10, dialogue: getBankerDialogue(aiType, round, behavior) };
  }

  // Calculate Expected Value (EV) of remaining unopened boxes
  let sum = 0;
  for (let i = 0; i < unopenedAmounts.length; i++) {
    sum += unopenedAmounts[i];
  }
  const ev = sum / unopenedAmounts.length;

  // Baseline risk factor: min(0.35 + round * 0.08, 0.95)
  const baseRiskFactor = Math.min(0.35 + round * 0.08, 0.95);
  const baseOffer = ev * baseRiskFactor;

  let multiplier = 1.0;

  switch (aiType) {
    case 'conservative':
      // Conservative uses base formula exactly
      multiplier = 1.0;
      break;

    case 'aggressive': {
      // Aggressive multiplies by independent random 80-130 integer percentage
      const pct = randomIntFn(80, 131); // 80 to 130 inclusive
      multiplier = pct / 100;
      break;
    }

    case 'cold': {
      // Cold multiplies by 0.70 + 0.30 * (ratio of initial top 3 prizes still unrevealed)
      const unrevealedTopCount = INITIAL_TOP_3_AMOUNTS.filter((val) =>
        unopenedAmounts.includes(val)
      ).length;
      const ratio = unrevealedTopCount / INITIAL_TOP_3_AMOUNTS.length;
      multiplier = 0.7 + 0.3 * ratio;
      break;
    }

    case 'inducement': {
      // Rejections are a server-only signal used to adjust the lure.
      multiplier = Math.min(1.2, 0.85 + round * 0.06 + Math.min(behavior.consecutiveRejections, 3) * 0.04);
      break;
    }

    case 'crazy': {
      const pct = randomIntFn(45, 166); // high variance, still bounded by the server
      multiplier = (pct / 100) + Math.min(0.06, behavior.timeoutCount * 0.01);
      break;
    }

    default: {
      multiplier = 1.0;
      break;
    }
  }

  const rawOffer = baseOffer * multiplier;
  const roundedOffer = Math.round(rawOffer / 100) * 100;
  const finalOffer = Math.max(10, roundedOffer);

  if (!Number.isSafeInteger(finalOffer) || finalOffer < 10) {
    throw new Error(`Calculated invalid banker offer: ${finalOffer}`);
  }

  return {
    amount: finalOffer,
    dialogue: getBankerDialogue(aiType, round, behavior)
  };
}

/**
 * Backwards-compatible amount-only API. Internal coefficients and behavior
 * inputs remain server-side; callers that need the public line use details.
 */
export function calculateBankerOffer(params: CalculateOfferParams): number {
  return calculateBankerOfferDetails(params).amount;
}

const DIALOGUE_LINES: Record<AiType, readonly string[]> = {
  conservative: [
    '我会按场上的局势给出这一轮条件，决定权在你。',
    '这是一份稳妥的报价，先看看你愿不愿意接受。'
  ],
  aggressive: [
    '我把筹码推到桌上了，别让机会从手边溜走。',
    '这一轮我很有诚意，下一次条件未必一样。'
  ],
  cold: [
    '剩下的选择会越来越少，数字只按规则说话。',
    '我不会被情绪左右，这是当前的理性条件。'
  ],
  inducement: [
    '你已经走到这里了，再考虑一下这份条件。',
    '我知道你在犹豫，这一轮可以给你更多空间。'
  ],
  crazy: [
    '局势随时会翻转，这个数字就是我的直觉。',
    '没人知道下一步会怎样，先接住眼前的机会。'
  ]
};

function getBankerDialogue(aiType: AiType, round: number, behavior: AiBehaviorSummary): string {
  const lines = DIALOGUE_LINES[aiType] || DIALOGUE_LINES.conservative;
  const index = Math.max(0, Math.floor(round) + Math.max(0, Math.floor(behavior.consecutiveRejections)) - 1) % lines.length;
  if (aiType === 'inducement' && behavior.consecutiveRejections > 0) {
    return '你已经连续考虑过几轮了，我把条件重新摆在你面前。';
  }
  if (behavior.timeoutCount > 0 && aiType === 'cold') {
    return '时间已经过去，我只按当前局面给出条件。';
  }
  return lines[index];
}
