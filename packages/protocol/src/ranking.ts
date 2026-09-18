/**
 * Protocol types and DTOs for BubbleFortune V1.0 Ranking, Profiles, Reports, and Admin.
 * All public types contain whitelist data only. No secrets or credentials leaked.
 */

export const RANKING_RULE_VERSION = 'season-v1';
export const DEFAULT_ELO = 1000;
export const DEFAULT_K_FACTOR = 32;
export const DEFAULT_SEASON_DURATION_MS = 28 * 24 * 60 * 60 * 1000; // 4 weeks in UTC milliseconds

/** Public leaderboard dimensions. Values are allow-listed by the server. */
export type RankingBoard =
  | 'elo'
  | 'net_profit'
  | 'challenger_profit'
  | 'banker_profit'
  | 'win_rate'
  | 'survivor_wins'
  | 'tournament_wins'
  | 'matches'
  | 'single_highest'
  | 'single_margin';

export type SeasonStatus = 'upcoming' | 'active' | 'completed' | 'archived';

export interface SeasonSummary {
  seasonId: string;
  name: string;
  ruleVersion: string;
  startAt: number;
  endAt: number;
  status: SeasonStatus;
  createdAt: number;
}

export interface SeasonListResponse {
  items: SeasonSummary[];
  activeSeasonId: string | null;
}

export interface RankingEntry {
  rank: number;
  nickname?: string;
  elo: number;
  winRate: number;
  roleBalanceReturnRate: number;
  netProfit: number;
  challengerProfit?: number;
  bankerProfit?: number;
  matchesPlayed: number;
  forfeitRate: number;
  survivorGamesPlayed?: number;
  survivorWins?: number;
  tournamentGamesPlayed?: number;
  tournamentWins?: number;
  singleGamesPlayed?: number;
  singleHighestProfit?: number;
  singleBestDealMargin?: number;
}

export interface RankingListResponse {
  seasonId: string;
  board?: RankingBoard;
  items: RankingEntry[];
  total: number;
  limit: number;
  offset: number;
}

export interface ProfileSummary {
  guestId: string;
  nickname?: string;
  elo: number;
  rank: number | null;
  seasonId: string;
  matchesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  forfeits: number;
  winRate: number;
  roleBalanceReturnRate: number;
  netProfit: number;
  forfeitRate: number;
  singleGamesPlayed: number;
  /** Highest authoritative payout recorded in classic solo history. */
  singleHighestProfit?: number;
  /** Highest accepted-offer margin (offer minus original box amount). */
  singleBestDealMargin?: number;
  duelGamesPlayed: number;
  auctionGamesPlayed: number;
  survivorGamesPlayed?: number;
  survivorWins?: number;
  tournamentGamesPlayed?: number;
  tournamentWins?: number;
  createdAt: number;
}

export type ReportStatus = 'pending' | 'reviewed' | 'actioned' | 'dismissed';
export type ReportCategory = 'cheating' | 'harassment' | 'exploit' | 'collusion' | 'other' | string;
export type ReportTargetType = 'guest' | 'match' | 'share' | string;

export interface Report {
  id: string;
  reporterGuestId: string;
  targetType: ReportTargetType;
  targetId: string;
  category: ReportCategory;
  reason: string;
  ipFingerprint: string;
  status: ReportStatus;
  resolutionNotes?: string | null;
  createdAt: number;
  resolvedAt?: number | null;
}

export interface CreateReportRequest {
  targetType: ReportTargetType;
  targetId: string;
  category: ReportCategory;
  reason?: string;
}

export interface CreateReportResponse {
  reportId: string;
  status: ReportStatus;
}

export interface AdminConfig {
  key: string;
  value: any;
  version: number;
  description?: string;
  updatedAt: number;
  updatedBy: string;
}

export interface AdminAuditLogItem {
  id: string;
  adminId: string;
  action: string;
  targetType: string;
  targetId: string;
  details: any;
  ipFingerprint?: string;
  createdAt: number;
}

export interface AdminBanItem {
  id: string;
  guestId: string;
  flagType: string;
  severity: string;
  reason: string;
  ipFingerprint?: string;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface AdminThemeItem {
  themeId: string;
  name: string;
  enabled: boolean;
  config?: any;
  updatedAt: number;
}

export interface AdminMetrics {
  totalGuests: number;
  activeGuests24h: number;
  totalSingleGames: number;
  totalDuelGames: number;
  totalAuctionGames: number;
  totalSurvivorGames: number;
  totalTournamentGames: number;
  pendingReports: number;
  activeBans: number;
  systemHealth: 'healthy' | 'degraded' | 'unhealthy';
}
