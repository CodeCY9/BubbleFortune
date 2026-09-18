import type { MultiplayerShareMode, MultiplayerShareResponse, MultiplayerShareSummary } from '../../packages/protocol/src/share';
import { safeFetchJson, type ApiResult } from './history';

function isMode(value: string): value is MultiplayerShareMode {
  return value === 'duel' || value === 'survivor' || value === 'tournament';
}

export function parseMultiplayerSharePath(path: string): { mode: MultiplayerShareMode; shareId: string } | null {
  const match = /^\/share\/(duel|survivor|tournament)\/([A-Za-z0-9_-]{16,128})\/?$/.exec(path);
  const mode = match?.[1];
  if (!match || !mode || !isMode(mode)) return null;
  return { mode, shareId: match[2] };
}

export function isMultiplayerShareResponse(value: unknown): value is MultiplayerShareResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  return typeof data.shareId === 'string' && typeof data.path === 'string';
}

export function isMultiplayerShareSummary(value: unknown): value is MultiplayerShareSummary {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  return isMode(String(data.mode)) && typeof data.resultId === 'string' && typeof data.completedAt === 'number' && Number.isFinite(data.completedAt) && typeof data.totalPlayers === 'number' && Number.isInteger(data.totalPlayers) && Array.isArray(data.rankings) && (data.winnerNickname === null || typeof data.winnerNickname === 'string') && typeof data.reason === 'string';
}

export function createMultiplayerShare(mode: MultiplayerShareMode, id: string): Promise<ApiResult<MultiplayerShareResponse>> {
  return safeFetchJson<MultiplayerShareResponse>(`/api/${mode}/history/${encodeURIComponent(id)}/share`, { method: 'POST', body: {} }, isMultiplayerShareResponse);
}

export function fetchPublicMultiplayerShare(mode: MultiplayerShareMode, shareId: string): Promise<ApiResult<MultiplayerShareSummary>> {
  return safeFetchJson<MultiplayerShareSummary>(`/api/share/${mode}/${encodeURIComponent(shareId)}`, {}, isMultiplayerShareSummary);
}
