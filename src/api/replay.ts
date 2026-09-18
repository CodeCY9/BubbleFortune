import { safeFetchJson } from './history';

export interface ReplaySummary {
  resultId: string;
  matchId?: string;
  gameId?: string;
  tournamentId?: string;
  ruleVersion: string;
  completedAt: number;
  events: Array<{ seq?: number; type?: string; timestamp?: number; [key: string]: unknown }>;
}

function isReplaySummary(data: unknown): data is ReplaySummary {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const value = data as Record<string, unknown>;
  return typeof value.resultId === 'string'
    && typeof value.ruleVersion === 'string'
    && typeof value.completedAt === 'number'
    && Number.isFinite(value.completedAt)
    && Array.isArray(value.events);
}

export function fetchReplay(mode: 'classic' | 'duel' | 'auction' | 'survivor', id: string) {
  const path = mode === 'classic'
    ? `/api/history/${encodeURIComponent(id)}/replay`
    : `/api/${mode}/history/${encodeURIComponent(id)}/replay`;
  return safeFetchJson<ReplaySummary>(path, {}, isReplaySummary);
}
