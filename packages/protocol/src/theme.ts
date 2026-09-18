/** Public, non-gameplay room theme identifiers. */
export const ROOM_THEME_IDS = ['classic', 'starry-neon'] as const;
export type RoomThemeId = (typeof ROOM_THEME_IDS)[number];

export function isRoomThemeId(value: unknown): value is RoomThemeId {
  return typeof value === 'string' && (ROOM_THEME_IDS as readonly string[]).includes(value);
}

/** Invalid or absent network values always fall back to the safe classic theme. */
export function normalizeRoomThemeId(value: unknown): RoomThemeId {
  return isRoomThemeId(value) ? value : 'classic';
}
