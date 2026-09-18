import type { RoomThemeId } from '../../packages/protocol/src/theme';

export interface PublicDuelRoomSummary {
  roomId: string;
  players: number;
  maxPlayers: 2;
  ranked: boolean;
  passwordRequired: boolean;
  showOfferHistory?: boolean;
  themeId?: RoomThemeId;
  ruleVersion: 'duel-26-v1';
}

export async function fetchPublicDuelRooms(signal?: AbortSignal): Promise<PublicDuelRoomSummary[]> {
  const response = await fetch('/api/duel/rooms', {
    credentials: 'include',
    cache: 'no-store',
    signal,
  });
  if (!response.ok) throw new Error('PUBLIC_DUEL_ROOMS_UNAVAILABLE');
  const payload = await response.json() as { items?: unknown };
  if (!Array.isArray(payload.items)) return [];
  return payload.items.filter((item): item is PublicDuelRoomSummary => {
    if (!item || typeof item !== 'object') return false;
    const room = item as Partial<PublicDuelRoomSummary>;
    return typeof room.roomId === 'string'
      && Number.isFinite(room.players)
      && room.maxPlayers === 2
      && typeof room.ranked === 'boolean'
      && typeof room.passwordRequired === 'boolean'
      && (room.showOfferHistory === undefined || typeof room.showOfferHistory === 'boolean')
      && (room.themeId === undefined || room.themeId === 'classic' || room.themeId === 'starry-neon')
      && room.ruleVersion === 'duel-26-v1';
  });
}
