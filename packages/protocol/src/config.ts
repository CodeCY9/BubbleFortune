/**
 * Public configuration and constants for Classic 26 Box game.
 * Only public rules and lists are exported.
 * Internal banker formulas, secret box mappings, and EV weights MUST NOT be exported here.
 */

export const RULE_VERSION = 'classic-26-v1';

export const TOTAL_BOXES = 26;

// 26 public money values in ascending order
export const MONEY_VALUES = [
  // Low Tier (13 items)
  1, 5, 10, 25, 50, 75, 100, 200, 300, 400, 500, 750, 1000,
  // High Tier (13 items)
  2500, 5000, 10000, 25000, 50000, 75000, 100000, 200000, 300000, 400000, 500000, 750000, 1000000
] as const;

// Boxes to open per round across 9 rounds.
// 6 + 5 + 4 + 3 + 2 + 1 + 1 + 1 + 1 = 24 boxes opened.
// After 24 boxes are opened, exactly 2 boxes remain: player's lucky box and 1 remaining box.
// At that point, the game transitions directly to FINAL_SWAP (no banker offer).
export const ROUND_TARGETS = [6, 5, 4, 3, 2, 1, 1, 1, 1] as const;

export const TOTAL_ROUNDS = ROUND_TARGETS.length; // 9 rounds
export const TOTAL_BOXES_TO_OPEN_BEFORE_FINAL = 24;

export const TIMEOUT_SECONDS = {
  SELECT_PLAYER_BOX: 30,
  OPEN_BOX: 20,
  BANKER_OFFER: 30,
  FINAL_CHOICE: 30,
  RECONNECT_GRACE: 120
} as const;
