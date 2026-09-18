import type { AchievementItem, AchievementListResponse } from '../../packages/protocol/src/achievements';
import { safeFetchJson } from './history';

function isAchievementListResponse(data: unknown): data is AchievementListResponse {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const value = data as { items?: unknown };
  return Array.isArray(value.items) && value.items.every((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    const row = item as Record<string, unknown>;
    return typeof row.id === 'string'
      && typeof row.name === 'string'
      && typeof row.description === 'string'
      && typeof row.unlockedAt === 'number'
      && Number.isFinite(row.unlockedAt);
  });
}

export async function fetchAchievements() {
  return safeFetchJson<AchievementListResponse>('/api/achievements', {}, isAchievementListResponse);
}

export type { AchievementItem };
