import type { PublicShareSummary, ShareResponse } from '../../packages/protocol/src/types';
import { safeFetchJson } from './history';

export function parseSharePath(path: string): string | null {
  return /^\/share\/([A-Za-z0-9_-]{16,128})\/?$/.exec(path)?.[1] ?? null;
}
function isShareResponse(value: unknown): value is ShareResponse {
  if (!value || typeof value !== 'object') return false;
  const data = value as ShareResponse;
  return typeof data.shareId === 'string' && typeof data.path === 'string' && parseSharePath(data.path) === data.shareId;
}
export function isPublicShare(value: unknown): value is PublicShareSummary {
  if (!value || typeof value !== 'object') return false;
  const data = value as PublicShareSummary;
  const box = (id: number) => Number.isInteger(id) && id >= 1 && id <= 26;
  return ['classic-26-v1', 'challenge-26-v2'].includes(data.mode) && ['conservative', 'aggressive', 'cold', 'inducement', 'crazy'].includes(data.aiType) &&
    Number.isFinite(data.wonAmount) && data.wonAmount >= 0 && box(data.originalPlayerBoxId) && box(data.finalPlayerBoxId) &&
    ['OFFER_ACCEPTED', 'FINAL_KEEP', 'FINAL_SWAP'].includes(data.outcomeType) &&
    (data.acceptedOfferAmount === undefined || (Number.isFinite(data.acceptedOfferAmount) && data.acceptedOfferAmount >= 0));
}
export function publicShareFields(data: PublicShareSummary): PublicShareSummary {
  return { mode: data.mode, aiType: data.aiType, wonAmount: data.wonAmount,
    originalPlayerBoxId: data.originalPlayerBoxId, finalPlayerBoxId: data.finalPlayerBoxId,
    outcomeType: data.outcomeType, ...(data.acceptedOfferAmount === undefined ? {} : { acceptedOfferAmount: data.acceptedOfferAmount }) };
}
export const createResultShare = (resultId: string) => safeFetchJson<ShareResponse>(
  `/api/history/${encodeURIComponent(resultId)}/share`, { method: 'POST', body: {} }, isShareResponse);
export async function fetchPublicShare(id: string) {
  const result = await safeFetchJson<PublicShareSummary>(`/api/share/${encodeURIComponent(id)}`,
    { credentials: 'omit', custom404Message: '未找到这份分享，请检查链接。' }, isPublicShare);
  return result.data ? { ...result, data: publicShareFields(result.data) } : result;
}
