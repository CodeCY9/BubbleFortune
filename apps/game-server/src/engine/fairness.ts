import crypto from 'node:crypto';
import { MONEY_VALUES, ROUND_TARGETS, RULE_VERSION, TOTAL_BOXES } from '../../../../packages/protocol/src/config';
import { canonicalJsonStringify } from '../../../../packages/protocol/src/canonical';
import { COMMIT_PREFIX, FAIRNESS_ALGORITHM, SHUFFLE_MSG_PREFIX } from '../../../../packages/protocol/src/fairness';

export interface FairnessBundle {
  algorithm: string;
  seed: string;
  salt: string;
  commitment: string;
  boxAmountMap: Map<number, number>;
  counter: number;
}

export function computeCommitmentNode(data: {
  algorithm: string;
  amounts: readonly number[] | number[];
  gameId: string;
  roundTargets: readonly number[] | number[];
  ruleVersion: string;
  salt: string;
  seed: string;
}): string {
  const canonical = canonicalJsonStringify({
    algorithm: data.algorithm,
    amounts: Array.from(data.amounts),
    gameId: data.gameId,
    roundTargets: Array.from(data.roundTargets),
    ruleVersion: data.ruleVersion,
    salt: data.salt,
    seed: data.seed
  });

  return crypto
    .createHash('sha256')
    .update(COMMIT_PREFIX + canonical, 'utf8')
    .digest('hex');
}

export function shuffleBoxesWithHmacNode(
  seedHex: string,
  saltHex: string,
  amounts: readonly number[] | number[]
): { values: number[]; counter: number; boxAmountMap: Map<number, number> } {
  const values = Array.from(amounts);
  const seedBuffer = Buffer.from(seedHex, 'hex');
  let counter = 0;

  for (let i = values.length - 1; i > 0; ) {
    const n = i + 1;
    const msg = `${SHUFFLE_MSG_PREFIX}${saltHex}:${counter}`;
    const hmac = crypto.createHmac('sha256', seedBuffer).update(msg, 'utf8').digest();
    const val = hmac.readUInt32BE(0);
    counter++;

    const limit = Math.floor(0x100000000 / n) * n;
    if (val < limit) {
      const j = val % n;
      const tmp = values[i];
      values[i] = values[j];
      values[j] = tmp;
      i--;
    }
  }

  const boxAmountMap = new Map<number, number>();
  for (let idx = 0; idx < values.length; idx++) {
    boxAmountMap.set(idx + 1, values[idx]);
  }

  return { values, counter, boxAmountMap };
}

export function generateFairnessBundle(
  gameId: string,
  options: { seed?: string; salt?: string; ruleVersion?: string; amounts?: readonly number[] } = {}
): FairnessBundle {
  const seed = options.seed || crypto.randomBytes(32).toString('hex').toLowerCase();
  const salt = options.salt || crypto.randomBytes(32).toString('hex').toLowerCase();
  const ruleVersion = options.ruleVersion || RULE_VERSION;
  const amounts = Array.from(options.amounts || MONEY_VALUES);
  if (amounts.length !== TOTAL_BOXES || amounts.some((amount) => !Number.isSafeInteger(amount) || amount < 0)) {
    throw new Error('Fairness amount pool must contain exactly 26 non-negative safe integers');
  }

  const { counter, boxAmountMap } = shuffleBoxesWithHmacNode(seed, salt, amounts);

  const commitment = computeCommitmentNode({
    algorithm: FAIRNESS_ALGORITHM,
    amounts,
    gameId,
    roundTargets: ROUND_TARGETS,
    ruleVersion,
    salt,
    seed
  });

  return {
    algorithm: FAIRNESS_ALGORITHM,
    seed,
    salt,
    commitment,
    boxAmountMap,
    counter
  };
}
