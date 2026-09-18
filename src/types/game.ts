import { MONEY_VALUES as PROTOCOL_MONEY_VALUES } from '../../packages/protocol/src/config';

export interface ClosedBoxData {
  id: number; // 1 to 26
  isOpened: false;
  isPlayerBox: boolean;
  value?: never;
  revealedAmount?: never;
}

export interface OpenedBoxData {
  id: number; // 1 to 26
  isOpened: true;
  isPlayerBox: boolean;
  value: number;
  revealedAmount: number;
}

export type BoxData = ClosedBoxData | OpenedBoxData;

export type GamePhase =
  | 'MODE_SELECT'
  | 'CHOOSE_PLAYER_BOX'
  | 'OPEN_BOXES'
  | 'BANKER_OFFER'
  | 'FINAL_SWAP'
  | 'GAME_OVER';

export type UIPhase = GamePhase;

export const MONEY_VALUES = PROTOCOL_MONEY_VALUES;

export function formatMoney(amount: number): string {
  return amount.toLocaleString('en-US');
}

