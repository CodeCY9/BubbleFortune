export interface AnalyticsDailyPoint {
  day: string;
  eventName: string;
  mode: string | null;
  count: number;
  uniqueGuests: number;
}

export interface AnalyticsModeSummary {
  mode: string;
  events: number;
  completed: number;
  uniqueGuests: number;
}

export interface AnalyticsRetentionSummary {
  eligible1d: number;
  retained1d: number;
  eligible7d: number;
  retained7d: number;
  eligible30d: number;
  retained30d: number;
}

export interface AnalyticsSummary {
  generatedAt: number;
  windowDays: number;
  totals: {
    events: number;
    uniqueGuests: number;
    completedMatches: number;
  };
  byMode: AnalyticsModeSummary[];
  daily: AnalyticsDailyPoint[];
  retention: AnalyticsRetentionSummary;
}
