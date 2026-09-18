export type MultiplayerShareMode = 'duel' | 'survivor' | 'tournament';

export interface MultiplayerShareRanking {
  rank: number;
  nickname: string;
  score: number;
}

export interface MultiplayerShareSummary {
  mode: MultiplayerShareMode;
  resultId: string;
  completedAt: number;
  totalPlayers: number;
  rankings: MultiplayerShareRanking[];
  winnerNickname: string | null;
  reason: string;
}

export interface MultiplayerShareResponse {
  shareId: string;
  path: string;
}
