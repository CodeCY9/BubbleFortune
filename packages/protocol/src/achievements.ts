export const ACHIEVEMENT_DEFINITIONS = [
  { id: 'first-settlement', name: '首次结算', description: '完成任意模式的一局结算。' },
  { id: 'multiplayer', name: '多人对局', description: '完成一局多人模式。' },
  { id: 'duel-winner', name: '对决胜者', description: '在双人资本家对决中获胜。' },
  { id: 'auction-winner', name: '竞拍赢家', description: '在多人资本竞拍中获得第一名。' },
  { id: 'survivor-winner', name: '箱王', description: '在箱王生存战中获得第一名。' },
  { id: 'tournament-winner', name: '赛事冠军', description: '赢得一场锦标赛。' },
  { id: 'fairness-check', name: '公平可查', description: '完成支持公平证明的对局。' },
] as const;

export type AchievementId = (typeof ACHIEVEMENT_DEFINITIONS)[number]['id'];

export interface AchievementItem {
  id: AchievementId;
  name: string;
  description: string;
  unlockedAt: number;
  metadata?: Record<string, unknown>;
}

export interface AchievementListResponse {
  items: AchievementItem[];
}

