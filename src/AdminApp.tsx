import React, { useState, useEffect, useCallback } from 'react';
import {
  loginAdminSession,
  logoutAdminSession,
  fetchAdminMetrics,
  fetchAdminAnalytics,
  fetchAdminConfig,
  saveAdminConfig,
  fetchAdminThemes,
  updateAdminTheme,
  fetchAdminReports,
  updateAdminReportStatus,
  fetchAdminBans,
  createAdminBan,
  deactivateAdminBan,
  fetchAdminSeasons,
  createAdminSeason,
  updateAdminSeason,
  type AdminMetrics,
  type AdminAnalyticsSummary,
  type AdminThemesResponse,
  type AdminReportItem,
  type AdminBanItem,
  type AdminSeasonItem,
  type AdminConfigItem,
} from './api/admin';
import { translate, useLanguage } from './i18n';

function formatDate(timestamp: number | null | undefined, language: 'zh-CN' | 'en-US'): string {
  if (!timestamp) return '-';
  try {
    const d = new Date(timestamp);
    return d.toLocaleString(language, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  } catch {
    return String(timestamp);
  }
}

export function AdminApp() {
  const language = useLanguage();
  const text = (key: Parameters<typeof translate>[0], replacements: Record<string, string | number> = {}) =>
    Object.entries(replacements).reduce(
      (value, [name, replacement]) => value.replace(new RegExp(`\\{${name}\\}`, 'g'), String(replacement)),
      translate(key, language),
    );
  // Security guarantee: admin token strictly resides in React state only!
  const [adminToken, setAdminToken] = useState<string | null>(null);
  const [inputToken, setInputToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  // Tab navigation
  const [activeTab, setActiveTab] = useState<'metrics' | 'analytics' | 'seasons' | 'themes' | 'reports' | 'bans' | 'config'>('metrics');

  // Dashboard dataset
  const [metrics, setMetrics] = useState<AdminMetrics | null>(null);
  const [analytics, setAnalytics] = useState<AdminAnalyticsSummary | null>(null);
  const [seasons, setSeasons] = useState<AdminSeasonItem[]>([]);
  const [themes, setThemes] = useState<AdminThemesResponse | null>(null);
  const [reports, setReports] = useState<AdminReportItem[]>([]);
  const [bans, setBans] = useState<AdminBanItem[]>([]);
  const [configs, setConfigs] = useState<AdminConfigItem[]>([]);
  const [configDrafts, setConfigDrafts] = useState<Record<string, string>>({});

  // Loading & notification states
  const [isLoading, setIsLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Reports tab filters and actions
  const [reportFilter, setReportFilter] = useState<'all' | 'pending' | 'actioned' | 'dismissed'>('pending');
  const [reportNoteMap, setReportNoteMap] = useState<Record<string, string>>({});

  // Form states for minimal creation
  const [showNewSeasonForm, setShowNewSeasonForm] = useState(false);
  const [newSeasonId, setNewSeasonId] = useState('');
  const [newSeasonName, setNewSeasonName] = useState('');
  const [newSeasonRule, setNewSeasonRule] = useState('classic-26-v1');
  const [newSeasonStartDays, setNewSeasonStartDays] = useState(0);
  const [newSeasonEndDays, setNewSeasonEndDays] = useState(30);

  const [showNewBanForm, setShowNewBanForm] = useState(false);
  const [newBanGuestId, setNewBanGuestId] = useState('');
  const [newBanReason, setNewBanReason] = useState('');
  const [newBanSeverity, setNewBanSeverity] = useState('critical');

  const flashMessage = (type: 'success' | 'error', text: string) => {
    setActionMessage({ type, text });
    setTimeout(() => {
      setActionMessage((prev) => (prev?.text === text ? null : prev));
    }, 4500);
  };

  // Load all dashboard data
  const loadAllData = useCallback(async (token: string) => {
    setIsLoading(true);
    try {
      const [mRes, aRes, sRes, tRes, rRes, bRes, cRes] = await Promise.all([
        fetchAdminMetrics(token),
        fetchAdminAnalytics(token),
        fetchAdminSeasons(token),
        fetchAdminThemes(token),
        fetchAdminReports(token, { limit: 100 }),
        fetchAdminBans(token),
        fetchAdminConfig(token),
      ]);

      if (mRes.ok && mRes.data) setMetrics(mRes.data);
      if (aRes.ok && aRes.data) setAnalytics(aRes.data);
      if (sRes.ok && sRes.data) setSeasons(sRes.data.items);
      if (tRes.ok && tRes.data) setThemes(tRes.data);
      if (rRes.ok && rRes.data) setReports(rRes.data.items);
      if (bRes.ok && bRes.data) setBans(bRes.data.items);
      if (cRes.ok && cRes.data) {
        setConfigs(cRes.data.items);
        setConfigDrafts(Object.fromEntries(cRes.data.items.map((item) => [item.key, JSON.stringify(item.value, null, 2)])));
      }

      if (!mRes.ok && mRes.error) {
        flashMessage('error', `${text('admin.error.metrics')}: ${mRes.error.message}`);
      }
    } catch {
      flashMessage('error', text('admin.error.login'));
    } finally {
      setIsLoading(false);
    }
  }, [language]);

  // Fetch when token is set
  useEffect(() => {
    if (adminToken) {
      loadAllData(adminToken);
    }
  }, [adminToken, loadAllData]);

  // Handle Login
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = inputToken.trim();
    if (!token) {
      setLoginError(text('admin.error.tokenRequired'));
      return;
    }

    setIsLoggingIn(true);
    setLoginError(null);

    const result = await loginAdminSession(token);
    setIsLoggingIn(false);

    if (result.ok && result.data?.authenticated) {
      setAdminToken(token);
      setInputToken('');
      flashMessage('success', text('admin.success.login'));
    } else {
      setLoginError(result.error?.message || text('admin.error.login'));
    }
  };

  // Handle Logout
  const handleLogout = () => {
    void logoutAdminSession();
    setAdminToken(null);
    setInputToken('');
    setMetrics(null);
    setAnalytics(null);
    setSeasons([]);
    setThemes(null);
    setReports([]);
    setBans([]);
    setConfigs([]);
    setConfigDrafts({});
    setActionMessage(null);
  };

  // --- Specific Operations ---

  const refreshMetrics = async () => {
    if (!adminToken) return;
    const res = await fetchAdminMetrics(adminToken);
    if (res.ok && res.data) {
      setMetrics(res.data);
      flashMessage('success', text('admin.success.metrics'));
    } else {
      flashMessage('error', res.error?.message || text('admin.error.metrics'));
    }
  };

  const refreshAnalytics = async () => {
    if (!adminToken) return;
    const res = await fetchAdminAnalytics(adminToken);
    if (res.ok && res.data) {
      setAnalytics(res.data);
      flashMessage('success', text('admin.success.analytics'));
    } else {
      flashMessage('error', res.error?.message || text('admin.error.analytics'));
    }
  };

  const refreshSeasons = async () => {
    if (!adminToken) return;
    const res = await fetchAdminSeasons(adminToken);
    if (res.ok && res.data) {
      setSeasons(res.data.items);
      flashMessage('success', text('admin.success.seasons'));
    } else {
      flashMessage('error', res.error?.message || text('admin.error.seasons'));
    }
  };

  const refreshThemes = async () => {
    if (!adminToken) return;
    const res = await fetchAdminThemes(adminToken);
    if (res.ok && res.data) {
      setThemes(res.data);
      flashMessage('success', text('admin.success.themes'));
    } else {
      flashMessage('error', res.error?.message || text('admin.error.themes'));
    }
  };

  const refreshReports = async () => {
    if (!adminToken) return;
    const res = await fetchAdminReports(adminToken, { limit: 100 });
    if (res.ok && res.data) {
      setReports(res.data.items);
      flashMessage('success', text('admin.success.reports'));
    } else {
      flashMessage('error', res.error?.message || text('admin.error.reports'));
    }
  };

  const refreshBans = async () => {
    if (!adminToken) return;
    const res = await fetchAdminBans(adminToken);
    if (res.ok && res.data) {
      setBans(res.data.items);
      flashMessage('success', text('admin.success.bans'));
    } else {
      flashMessage('error', res.error?.message || text('admin.error.bans'));
    }
  };

  const handleSaveConfig = async (item: AdminConfigItem) => {
    if (!adminToken) return;
    try {
      const value = JSON.parse(configDrafts[item.key] ?? JSON.stringify(item.value));
      const res = await saveAdminConfig(adminToken, item.key, value, item.description);
      if (res.ok && res.data) {
        setConfigs((current) => current.map((entry) => entry.key === item.key ? res.data! : entry));
        setConfigDrafts((current) => ({ ...current, [item.key]: JSON.stringify(res.data!.value, null, 2) }));
        flashMessage('success', text('admin.success.configSaved', { key: item.key }));
      } else {
        flashMessage('error', res.error?.message || text('admin.error.configSave'));
      }
    } catch {
      flashMessage('error', text('admin.error.configJson', { key: item.key }));
    }
  };

  // Season status update
  const handleUpdateSeasonStatus = async (seasonId: string, status: 'upcoming' | 'active' | 'completed') => {
    if (!adminToken) return;
    const res = await updateAdminSeason(adminToken, seasonId, { status });
    if (res.ok) {
      flashMessage('success', text('admin.success.seasonStatus', { id: seasonId, status }));
      refreshSeasons();
    } else {
      flashMessage('error', res.error?.message || text('admin.error.seasonStatus'));
    }
  };

  // Create new season
  const handleCreateSeason = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminToken) return;
    const now = Date.now();
    const startAt = now + newSeasonStartDays * 24 * 3600 * 1000;
    const endAt = now + newSeasonEndDays * 24 * 3600 * 1000;

    const res = await createAdminSeason(adminToken, {
      id: newSeasonId.trim(),
      name: newSeasonName.trim(),
      ruleVersion: newSeasonRule.trim(),
      startAt,
      endAt,
      status: 'upcoming',
    });

    if (res.ok) {
      flashMessage('success', text('admin.success.seasonCreated', { name: newSeasonName }));
      setShowNewSeasonForm(false);
      setNewSeasonId('');
      setNewSeasonName('');
      refreshSeasons();
    } else {
      flashMessage('error', res.error?.message || text('admin.error.seasonCreate'));
    }
  };

  // Theme operations
  const handleSetThemeActive = async (themeId: string) => {
    if (!adminToken) return;
    const res = await updateAdminTheme(adminToken, themeId, { setActive: true });
    if (res.ok && res.data) {
      setThemes(res.data);
      flashMessage('success', text('admin.success.themeActive', { id: themeId }));
    } else {
      flashMessage('error', res.error?.message || text('admin.error.themeActive'));
    }
  };

  const handleToggleThemeEnable = async (themeId: string, currentEnabled: boolean) => {
    if (!adminToken) return;
    const res = await updateAdminTheme(adminToken, themeId, { enabled: !currentEnabled });
    if (res.ok && res.data) {
      setThemes(res.data);
      flashMessage('success', text('admin.success.themeToggle', { id: themeId, state: !currentEnabled ? text('admin.themes.enable') : text('admin.themes.disable') }));
    } else {
      flashMessage('error', res.error?.message || text('admin.error.themeToggle'));
    }
  };

  // Report status update
  const handleResolveReport = async (reportId: string, status: 'actioned' | 'dismissed' | 'reviewed') => {
    if (!adminToken) return;
    const notes = reportNoteMap[reportId] || '';
    const res = await updateAdminReportStatus(adminToken, reportId, status, notes);
    if (res.ok) {
      flashMessage('success', text('admin.success.reportStatus', { status: status === 'actioned' ? text('admin.reportStatus.resolved') : status === 'dismissed' ? text('admin.reportStatus.dismissed') : text('admin.reportStatus.reviewed') }));
      refreshReports();
    } else {
      flashMessage('error', res.error?.message || text('admin.error.reportStatus'));
    }
  };

  // Ban guest directly from report
  const handleBanGuest = async (guestId: string, defaultReason?: string) => {
    if (!adminToken) return;
    const reason = prompt(text('admin.prompt.banReason'), defaultReason || text('admin.prompt.defaultBanReason'));
    if (!reason) return;

    const res = await createAdminBan(adminToken, {
      guestId,
      reason,
      severity: 'critical',
      excludeRanking: true,
    });

    if (res.ok) {
      flashMessage('success', text('admin.success.banGuest', { id: guestId }));
      refreshBans();
      refreshMetrics();
    } else {
      flashMessage('error', res.error?.message || text('admin.error.banGuest'));
    }
  };

  // Manual ban creation form
  const handleManualBanSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminToken) return;
    if (!newBanGuestId.trim()) {
      flashMessage('error', text('admin.error.guestId'));
      return;
    }

    const res = await createAdminBan(adminToken, {
      guestId: newBanGuestId.trim(),
      reason: newBanReason.trim() || text('admin.prompt.defaultBanReason'),
      severity: newBanSeverity,
      excludeRanking: true,
    });

    if (res.ok) {
      flashMessage('success', text('admin.success.manualBan', { id: newBanGuestId }));
      setShowNewBanForm(false);
      setNewBanGuestId('');
      setNewBanReason('');
      refreshBans();
      refreshMetrics();
    } else {
      flashMessage('error', res.error?.message || text('admin.error.manualBan'));
    }
  };

  // Unban guest
  const handleUnbanGuest = async (banId: string) => {
    if (!adminToken) return;
    if (!confirm(text('admin.confirm.unban'))) return;

    const res = await deactivateAdminBan(adminToken, banId);
    if (res.ok) {
      flashMessage('success', text('admin.success.unban'));
      refreshBans();
      refreshMetrics();
    } else {
      flashMessage('error', res.error?.message || text('admin.error.unban'));
    }
  };

  // Filtered reports
  const filteredReports = reports.filter((r) => {
    if (reportFilter === 'all') return true;
    return r.status === reportFilter;
  });

  // ================= RENDER: LOGIN FORM =================
  if (!adminToken) {
    return (
      <main className="admin-root-container">
        <div className="admin-login-wrapper">
          <header className="admin-login-header">
            <div className="admin-brand-icon" aria-hidden="true">⚙️</div>
            <h1 className="admin-login-title">{text('admin.title')}</h1>
            <p className="admin-login-subtitle">{text('admin.login.subtitle')}</p>
          </header>

          <aside className="admin-security-banner" role="note">
            <div className="security-banner-icon" aria-hidden="true">🛡️</div>
            <div className="security-banner-text">
              <strong>{text('admin.security.title')}</strong>
              <p>{text('admin.security.body')}</p>
            </div>
          </aside>

          {loginError && (
            <div className="admin-alert admin-alert-error" role="alert">
              <span aria-hidden="true">⚠️</span>
              <span>{loginError}</span>
            </div>
          )}

          <form onSubmit={handleLogin} className="admin-login-form" aria-label={text('admin.login.aria')}>
            <div className="admin-form-group">
              <label htmlFor="admin-token-input" className="admin-label">
                {text('admin.token.label')}
              </label>
              <div className="admin-input-group">
                <input
                  id="admin-token-input"
                  type={showToken ? 'text' : 'password'}
                  className="admin-input"
                  value={inputToken}
                  onChange={(e) => setInputToken(e.target.value)}
                  placeholder={text('admin.token.placeholder')}
                  autoComplete="off"
                  spellCheck="false"
                  required
                />
                <button
                  type="button"
                  className="admin-btn admin-btn-secondary admin-btn-toggle"
                  onClick={() => setShowToken(!showToken)}
                  aria-label={showToken ? text('admin.token.hide') : text('admin.token.show')}
                >
                  {showToken ? text('admin.hide') : text('admin.show')}
                </button>
              </div>
            </div>

            <button
              type="submit"
              className="admin-btn admin-btn-primary admin-btn-block"
              disabled={isLoggingIn}
            >
              {isLoggingIn ? text('admin.login.verifying') : text('admin.login.submit')}
            </button>
          </form>

          <footer className="admin-login-footer">
            <a href="/" className="admin-back-link">
              {text('admin.backLobby')}
            </a>
          </footer>
        </div>
      </main>
    );
  }

  // ================= RENDER: DASHBOARD =================
  return (
    <div className="admin-root-container admin-dashboard-layout">
      {/* Admin Top Header */}
      <header className="admin-top-bar" role="banner">
        <div className="admin-bar-left">
          <span className="admin-badge-logo" aria-hidden="true">⚙️</span>
          <div className="admin-title-area">
            <h1 className="admin-header-title">{text('admin.title')}</h1>
            <span className="admin-header-sub">{text('admin.dashboard.subtitle')}</span>
          </div>
        </div>

        <div className="admin-bar-center">
          <div className="admin-memory-pill" title={text('admin.memoryTitle')}>
            <span className="admin-dot-pulse" aria-hidden="true"></span>
            <span>{text('admin.memoryOnly')}</span>
          </div>
        </div>

        <div className="admin-bar-right">
          <button
            type="button"
            className="admin-btn admin-btn-secondary"
            onClick={() => loadAllData(adminToken)}
            disabled={isLoading}
            aria-label={text('admin.refreshAria')}
          >
            {isLoading ? text('admin.refreshing') : text('admin.refreshAll')}
          </button>
          <a href="/" className="admin-btn admin-btn-outline" target="_blank" rel="noreferrer">
            {text('admin.frontendLobby')}
          </a>
          <button
            type="button"
            className="admin-btn admin-btn-danger"
            onClick={handleLogout}
            aria-label={text('admin.logoutAria')}
          >
            {text('admin.logout')}
          </button>
        </div>
      </header>

      {/* Global Feedback Banner */}
      {actionMessage && (
        <div
          className={`admin-feedback-banner admin-feedback-${actionMessage.type}`}
          role="status"
          aria-live="polite"
        >
          <span>{actionMessage.type === 'success' ? '✅' : '❌'}</span>
          <span>{actionMessage.text}</span>
        </div>
      )}

      {/* Navigation Tabs */}
      <nav className="admin-nav-tabs" aria-label={text('admin.nav.aria')}>
        <button
          type="button"
          className={`admin-tab-btn ${activeTab === 'metrics' ? 'active' : ''}`}
          onClick={() => setActiveTab('metrics')}
        >
          {text('admin.nav.metrics')}
        </button>
        <button
          type="button"
          className={`admin-tab-btn ${activeTab === 'analytics' ? 'active' : ''}`}
          onClick={() => setActiveTab('analytics')}
        >
          {text('admin.nav.analytics')}
        </button>
        <button
          type="button"
          className={`admin-tab-btn ${activeTab === 'seasons' ? 'active' : ''}`}
          onClick={() => setActiveTab('seasons')}
        >
          {text('admin.nav.seasons', { count: seasons.length })}
        </button>
        <button
          type="button"
          className={`admin-tab-btn ${activeTab === 'themes' ? 'active' : ''}`}
          onClick={() => setActiveTab('themes')}
        >
          {text('admin.nav.themes')}
        </button>
        <button
          type="button"
          className={`admin-tab-btn ${activeTab === 'reports' ? 'active' : ''}`}
          onClick={() => setActiveTab('reports')}
        >
          {text('admin.nav.reports', { count: reports.filter((r) => r.status === 'pending').length })}
        </button>
        <button
          type="button"
          className={`admin-tab-btn ${activeTab === 'bans' ? 'active' : ''}`}
          onClick={() => setActiveTab('bans')}
        >
          {text('admin.nav.bans', { count: bans.length })}
        </button>
        <button
          type="button"
          className={`admin-tab-btn ${activeTab === 'config' ? 'active' : ''}`}
          onClick={() => setActiveTab('config')}
        >
          {text('admin.nav.config', { count: configs.length })}
        </button>
      </nav>

      {/* Main Content Area */}
      <main className="admin-main-stage" role="main">
        {/* ================= TAB 1: METRICS ================= */}
        {activeTab === 'metrics' && (
          <section className="admin-card-section" aria-labelledby="metrics-title">
            <div className="admin-section-header">
              <h2 id="metrics-title" className="admin-section-heading">
                {text('admin.metrics.title')}
              </h2>
              <button
                type="button"
                className="admin-btn admin-btn-sm admin-btn-secondary"
                onClick={refreshMetrics}
                disabled={isLoading}
              >
                {text('admin.metrics.refresh')}
              </button>
            </div>

            {metrics ? (
              <div className="admin-metrics-grid">
                <div className="admin-metric-card">
                  <span className="metric-label">{text('admin.metrics.totalGuests')}</span>
                  <strong className="metric-value">{metrics.totalGuests}</strong>
                  <span className="metric-sub">{text('admin.metrics.guestBase')}</span>
                </div>

                <div className="admin-metric-card">
                  <span className="metric-label">{text('admin.metrics.survivorGames')}</span>
                  <strong className="metric-value">{metrics.totalSurvivorGames}</strong>
                  <span className="metric-sub">{text('admin.metrics.survivorDone')}</span>
                </div>

                <div className="admin-metric-card">
                  <span className="metric-label">{text('admin.metrics.tournamentGames')}</span>
                  <strong className="metric-value">{metrics.totalTournamentGames}</strong>
                  <span className="metric-sub">{text('admin.metrics.tournamentDone')}</span>
                </div>

                <div className="admin-metric-card highlight">
                  <span className="metric-label">{text('admin.metrics.activeGuests')}</span>
                  <strong className="metric-value">{metrics.activeGuests24h}</strong>
                  <span className="metric-sub">{text('admin.metrics.frontendHeat')}</span>
                </div>

                <div className="admin-metric-card">
                  <span className="metric-label">{text('admin.metrics.singleGames')}</span>
                  <strong className="metric-value">{metrics.totalSingleGames}</strong>
                  <span className="metric-sub">{text('admin.metrics.singleDone')}</span>
                </div>

                <div className="admin-metric-card">
                  <span className="metric-label">{text('admin.metrics.duelGames')}</span>
                  <strong className="metric-value">{metrics.totalDuelGames}</strong>
                  <span className="metric-sub">{text('admin.metrics.duelTotal')}</span>
                </div>

                <div className="admin-metric-card">
                  <span className="metric-label">{text('admin.metrics.auctionGames')}</span>
                  <strong className="metric-value">{metrics.totalAuctionGames}</strong>
                  <span className="metric-sub">{text('admin.metrics.auctionDone')}</span>
                </div>

                <div className={`admin-metric-card ${metrics.pendingReports > 0 ? 'warning' : ''}`}>
                  <span className="metric-label">{text('admin.metrics.pendingReports')}</span>
                  <strong className="metric-value">{metrics.pendingReports}</strong>
                  <span className="metric-sub">
                    {metrics.pendingReports > 0 ? text('admin.metrics.pendingReportsYes') : text('admin.metrics.pendingReportsNo')}
                  </span>
                </div>

                <div className="admin-metric-card">
                  <span className="metric-label">{text('admin.metrics.activeBans')}</span>
                  <strong className="metric-value">{metrics.activeBans}</strong>
                  <span className="metric-sub">{text('admin.metrics.bansHint')}</span>
                </div>

                <div className="admin-metric-card success">
                  <span className="metric-label">{text('admin.metrics.health')}</span>
                  <strong className="metric-value status-online">
                    <span className="dot online" aria-hidden="true"></span>
                    {metrics.systemHealth.toUpperCase()}
                  </strong>
                  <span className="metric-sub">{text('admin.metrics.healthHint')}</span>
                </div>
              </div>
            ) : (
              <p className="admin-empty-text">{text('admin.metrics.empty')}</p>
            )}
          </section>
        )}

        {activeTab === 'analytics' && (
          <section className="admin-card-section" aria-labelledby="analytics-title">
            <div className="admin-section-header">
              <div>
                <h2 id="analytics-title" className="admin-section-heading">{text('admin.analytics.title')}</h2>
                <p className="admin-section-desc">{text('admin.analytics.description')}</p>
              </div>
              <button type="button" className="admin-btn admin-btn-sm admin-btn-secondary" onClick={refreshAnalytics} disabled={isLoading}>{text('admin.analytics.refresh')}</button>
            </div>
            {analytics ? <>
              <div className="admin-metrics-grid">
                <div className="admin-metric-card"><span className="metric-label">{text('admin.analytics.eventsWindow', { days: analytics.windowDays })}</span><strong className="metric-value">{analytics.totals.events}</strong><span className="metric-sub">{text('admin.analytics.events')}</span></div>
                <div className="admin-metric-card"><span className="metric-label">{text('admin.analytics.activeGuests')}</span><strong className="metric-value">{analytics.totals.uniqueGuests}</strong><span className="metric-sub">{text('admin.analytics.uniqueGuests')}</span></div>
                <div className="admin-metric-card"><span className="metric-label">{text('admin.analytics.completedMatches')}</span><strong className="metric-value">{analytics.totals.completedMatches}</strong><span className="metric-sub">{text('admin.analytics.authoritative')}</span></div>
                <div className="admin-metric-card"><span className="metric-label">{text('admin.analytics.retention1d')}</span><strong className="metric-value">{analytics.retention.eligible1d ? `${Math.round(analytics.retention.retained1d / analytics.retention.eligible1d * 100)}%` : '—'}</strong><span className="metric-sub">{analytics.retention.retained1d}/{analytics.retention.eligible1d}</span></div>
                <div className="admin-metric-card"><span className="metric-label">{text('admin.analytics.retention7d')}</span><strong className="metric-value">{analytics.retention.eligible7d ? `${Math.round(analytics.retention.retained7d / analytics.retention.eligible7d * 100)}%` : '—'}</strong><span className="metric-sub">{analytics.retention.retained7d}/{analytics.retention.eligible7d}</span></div>
                <div className="admin-metric-card"><span className="metric-label">{text('admin.analytics.retention30d')}</span><strong className="metric-value">{analytics.retention.eligible30d ? `${Math.round(analytics.retention.retained30d / analytics.retention.eligible30d * 100)}%` : '—'}</strong><span className="metric-sub">{analytics.retention.retained30d}/{analytics.retention.eligible30d}</span></div>
              </div>
              <div className="admin-table-container" style={{ marginTop: '18px' }}><table className="admin-table" aria-label={text('admin.analytics.byModeAria')}><thead><tr><th>{text('admin.analytics.mode')}</th><th>{text('admin.analytics.eventCount')}</th><th>{text('admin.analytics.completed')}</th><th>{text('admin.analytics.unique')}</th></tr></thead><tbody>{analytics.byMode.map((item) => <tr key={item.mode}><td>{item.mode}</td><td>{item.events}</td><td>{item.completed}</td><td>{item.uniqueGuests}</td></tr>)}</tbody></table></div>
            </> : <p className="admin-empty-text">{text('admin.analytics.empty')}</p>}
          </section>
        )}

        {/* ================= TAB 2: SEASONS ================= */}
        {activeTab === 'seasons' && (
          <section className="admin-card-section" aria-labelledby="seasons-title">
            <div className="admin-section-header">
              <div>
                <h2 id="seasons-title" className="admin-section-heading">
                  {text('admin.seasons.title')}
                </h2>
                <p className="admin-section-desc">{text('admin.seasons.description')}</p>
              </div>
              <div className="admin-btn-group">
                <button
                  type="button"
                  className="admin-btn admin-btn-sm admin-btn-secondary"
                  onClick={refreshSeasons}
                  disabled={isLoading}
                >
                  {text('admin.seasons.refresh')}
                </button>
                <button
                  type="button"
                  className="admin-btn admin-btn-sm admin-btn-primary"
                  onClick={() => setShowNewSeasonForm(!showNewSeasonForm)}
                >
                  {showNewSeasonForm ? text('admin.seasons.collapseNew') : text('admin.seasons.new')}
                </button>
              </div>
            </div>

            {/* Collapsible New Season Form */}
            {showNewSeasonForm && (
              <form onSubmit={handleCreateSeason} className="admin-inline-form-card" aria-label={text('admin.seasons.formAria')}>
                <h3 className="admin-subheading">{text('admin.seasons.formTitle')}</h3>
                <div className="admin-form-row">
                  <div className="admin-form-field">
                    <label htmlFor="season-id">{text('admin.seasons.id')}</label>
                    <input
                      id="season-id"
                      type="text"
                      className="admin-input"
                      value={newSeasonId}
                      onChange={(e) => setNewSeasonId(e.target.value)}
                      placeholder={text('admin.seasons.idPlaceholder')}
                      required
                    />
                  </div>
                  <div className="admin-form-field">
                    <label htmlFor="season-name">{text('admin.seasons.name')}</label>
                    <input
                      id="season-name"
                      type="text"
                      className="admin-input"
                      value={newSeasonName}
                      onChange={(e) => setNewSeasonName(e.target.value)}
                      placeholder={text('admin.seasons.namePlaceholder')}
                      required
                    />
                  </div>
                  <div className="admin-form-field">
                    <label htmlFor="season-rule">{text('admin.seasons.rule')}</label>
                    <input
                      id="season-rule"
                      type="text"
                      className="admin-input"
                      value={newSeasonRule}
                      onChange={(e) => setNewSeasonRule(e.target.value)}
                      placeholder={text('admin.seasons.rulePlaceholder')}
                      required
                    />
                  </div>
                </div>

                <div className="admin-form-row">
                  <div className="admin-form-field">
                    <label htmlFor="season-start">{text('admin.seasons.start')}</label>
                    <input
                      id="season-start"
                      type="number"
                      className="admin-input"
                      value={newSeasonStartDays}
                      onChange={(e) => setNewSeasonStartDays(Number(e.target.value))}
                    />
                  </div>
                  <div className="admin-form-field">
                    <label htmlFor="season-end">{text('admin.seasons.end')}</label>
                    <input
                      id="season-end"
                      type="number"
                      className="admin-input"
                      value={newSeasonEndDays}
                      onChange={(e) => setNewSeasonEndDays(Number(e.target.value))}
                    />
                  </div>
                  <div className="admin-form-field admin-field-btn">
                    <button type="submit" className="admin-btn admin-btn-primary">
                      {text('admin.seasons.create')}
                    </button>
                  </div>
                </div>
              </form>
            )}

            {/* Seasons Table */}
            <div className="admin-table-container">
              <table className="admin-table" aria-label={text('admin.seasons.tableAria')}>
                <thead>
                  <tr>
                    <th>{text('admin.seasons.tableId')}</th>
                    <th>{text('admin.seasons.tableName')}</th>
                    <th>{text('admin.seasons.tableRule')}</th>
                    <th>{text('admin.seasons.tableStart')}</th>
                    <th>{text('admin.seasons.tableEnd')}</th>
                    <th>{text('admin.seasons.tableStatus')}</th>
                    <th>{text('admin.seasons.tableActions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {seasons.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="admin-empty-cell">
                        {text('admin.seasons.empty')}
                      </td>
                    </tr>
                  ) : (
                    seasons.map((s) => (
                      <tr key={s.seasonId}>
                        <td className="font-mono">{s.seasonId}</td>
                        <td className="font-bold">{s.name}</td>
                        <td className="font-mono">{s.ruleVersion}</td>
                        <td>{formatDate(s.startAt, language)}</td>
                        <td>{formatDate(s.endAt, language)}</td>
                        <td>
                          <span
                            className={`admin-status-badge ${
                              s.status === 'active'
                                ? 'status-active'
                                : s.status === 'completed'
                                ? 'status-ended'
                                : 'status-pending'
                            }`}
                          >
                            {s.status === 'active' ? text('admin.seasons.active') : s.status === 'completed' ? text('admin.seasons.completed') : text('admin.seasons.upcoming')}
                          </span>
                        </td>
                        <td>
                          <div className="admin-btn-group">
                            {s.status !== 'active' && (
                              <button
                                type="button"
                                className="admin-btn admin-btn-xs admin-btn-success"
                                onClick={() => handleUpdateSeasonStatus(s.seasonId, 'active')}
                              >
                                {text('admin.seasons.activate')}
                              </button>
                            )}
                            {s.status === 'active' && (
                              <button
                                type="button"
                                className="admin-btn admin-btn-xs admin-btn-warning"
                                onClick={() => handleUpdateSeasonStatus(s.seasonId, 'completed')}
                              >
                                {text('admin.seasons.complete')}
                              </button>
                            )}
                            {s.status === 'completed' && (
                              <button
                                type="button"
                                className="admin-btn admin-btn-xs admin-btn-secondary"
                                onClick={() => handleUpdateSeasonStatus(s.seasonId, 'upcoming')}
                              >
                                {text('admin.seasons.reopen')}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* ================= TAB 3: THEMES ================= */}
        {activeTab === 'themes' && (
          <section className="admin-card-section" aria-labelledby="themes-title">
            <div className="admin-section-header">
              <div>
                <h2 id="themes-title" className="admin-section-heading">
                  {text('admin.themes.title')}
                </h2>
                <p className="admin-section-desc">{text('admin.themes.description')}</p>
              </div>
              <button
                type="button"
                className="admin-btn admin-btn-sm admin-btn-secondary"
                onClick={refreshThemes}
                disabled={isLoading}
              >
                {text('admin.themes.refresh')}
              </button>
            </div>

            {themes ? (
              <div className="admin-themes-wrapper">
                <div className="admin-active-theme-card">
                  <span className="card-label">{text('admin.themes.activeGlobal')}</span>
                  <div className="card-content">
                    <strong className="theme-active-title">{themes.activeTheme}</strong>
                    <span className="theme-active-badge">ACTIVE</span>
                  </div>
                </div>

                <div className="admin-theme-items-grid">
                  {['classic', 'starry-neon', ...(themes.availableThemes || []).filter((t) => t !== 'classic' && t !== 'starry-neon')].map((themeKey) => {
                    const isAvailable = themes.availableThemes?.includes(themeKey);
                    const isActive = themes.activeTheme === themeKey;

                    return (
                      <div key={themeKey} className={`admin-theme-card ${isActive ? 'current' : ''}`}>
                        <div className="theme-card-top">
                          <h3 className="theme-name">{themeKey === 'classic' ? text('admin.themes.classicName') : themeKey === 'starry-neon' ? text('admin.themes.starryName') : themeKey}</h3>
                          {isActive && <span className="admin-status-badge status-active">{text('admin.themes.current')}</span>}
                        </div>

                        <p className="theme-id-tag">{text('admin.themes.identifier')} <code>{themeKey}</code></p>
                        <p className="theme-desc">
                          {themeKey === 'classic'
                            ? text('admin.themes.classicDescription')
                            : themeKey === 'starry-neon'
                            ? text('admin.themes.starryDescription')
                            : text('admin.themes.customDescription')}
                        </p>

                        <div className="theme-card-actions">
                          {!isActive && (
                            <button
                              type="button"
                              className="admin-btn admin-btn-sm admin-btn-primary"
                              onClick={() => handleSetThemeActive(themeKey)}
                            >
                              {text('admin.themes.setCurrent')}
                            </button>
                          )}
                          <button
                            type="button"
                            className={`admin-btn admin-btn-sm ${isAvailable ? 'admin-btn-outline' : 'admin-btn-secondary'}`}
                            onClick={() => handleToggleThemeEnable(themeKey, isAvailable)}
                          >
                            {isAvailable ? text('admin.themes.disable') : text('admin.themes.enable')}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <p className="admin-empty-text">{text('admin.themes.empty')}</p>
            )}
          </section>
        )}

        {/* ================= TAB 4: REPORTS ================= */}
        {activeTab === 'reports' && (
          <section className="admin-card-section" aria-labelledby="reports-title">
            <div className="admin-section-header">
              <div>
                <h2 id="reports-title" className="admin-section-heading">
                  {text('admin.reports.title')}
                </h2>
                <p className="admin-section-desc">{text('admin.reports.description')}</p>
              </div>
              <div className="admin-btn-group">
                <button
                  type="button"
                  className="admin-btn admin-btn-sm admin-btn-secondary"
                  onClick={refreshReports}
                  disabled={isLoading}
                >
                  {text('admin.reports.refresh')}
                </button>
              </div>
            </div>

            {/* Filter Bar */}
            <div className="admin-filter-bar" role="toolbar" aria-label={text('admin.reports.filterAria')}>
              <span className="filter-label">{text('admin.reports.filterLabel')}</span>
              {(['pending', 'all', 'actioned', 'dismissed'] as const).map((filter) => (
                <button
                  key={filter}
                  type="button"
                  className={`admin-filter-btn ${reportFilter === filter ? 'active' : ''}`}
                  onClick={() => setReportFilter(filter)}
                >
                  {filter === 'pending'
                    ? text('admin.reports.pending')
                    : filter === 'all'
                    ? text('admin.reports.all')
                    : filter === 'actioned'
                    ? text('admin.reports.actioned')
                    : text('admin.reports.dismissed')}
                </button>
              ))}
            </div>

            {/* Reports Table */}
            <div className="admin-table-container">
              <table className="admin-table" aria-label={text('admin.reports.tableAria')}>
                <thead>
                  <tr>
                    <th>{text('admin.reports.id')}</th>
                    <th>{text('admin.reports.targetType')}</th>
                    <th>{text('admin.reports.targetId')}</th>
                    <th>{text('admin.reports.category')}</th>
                    <th>{text('admin.reports.reason')}</th>
                    <th>{text('admin.reports.created')}</th>
                    <th>{text('admin.reports.status')}</th>
                    <th>{text('admin.reports.notes')}</th>
                    <th>{text('admin.reports.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredReports.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="admin-empty-cell">
                        {text('admin.reports.empty')}
                      </td>
                    </tr>
                  ) : (
                    filteredReports.map((r) => (
                      <tr key={r.id}>
                        <td className="font-mono text-sm">{r.id.slice(0, 8)}…</td>
                        <td>
                          <span className="admin-badge-type">{r.targetType}</span>
                        </td>
                        <td className="font-mono text-sm">{r.targetId}</td>
                        <td>
                          <span className="admin-badge-category">
                            {r.category === 'cheating'
                              ? text('admin.reports.category.cheating')
                              : r.category === 'match_fixing'
                              ? text('admin.reports.category.matchFixing')
                              : r.category === 'stall'
                              ? text('admin.reports.category.stall')
                              : r.category === 'harassment'
                              ? text('admin.reports.category.harassment')
                              : r.category}
                          </span>
                        </td>
                        <td className="admin-cell-reason" title={r.reason}>
                          {r.reason}
                        </td>
                        <td>{formatDate(r.createdAt, language)}</td>
                        <td>
                          <span
                            className={`admin-status-badge ${
                              r.status === 'pending'
                                ? 'status-pending'
                                : r.status === 'actioned'
                                ? 'status-active'
                                : 'status-ended'
                            }`}
                          >
                            {r.status === 'pending' ? text('admin.reports.status.pending') : r.status === 'actioned' ? text('admin.reports.status.actioned') : r.status === 'dismissed' ? text('admin.reports.status.dismissed') : r.status}
                          </span>
                        </td>
                        <td>
                          <input
                            type="text"
                            className="admin-input admin-input-sm"
                            placeholder={text('admin.reports.notesPlaceholder')}
                            defaultValue={r.resolutionNotes || ''}
                            onChange={(e) =>
                              setReportNoteMap((prev) => ({ ...prev, [r.id]: e.target.value }))
                            }
                          />
                        </td>
                        <td>
                          <div className="admin-btn-group">
                            {r.status === 'pending' && (
                              <>
                                <button
                                  type="button"
                                  className="admin-btn admin-btn-xs admin-btn-success"
                                  onClick={() => handleResolveReport(r.id, 'actioned')}
                                  title={text('admin.reports.resolveTitle')}
                                >
                                  {text('admin.reports.resolve')}
                                </button>
                                <button
                                  type="button"
                                  className="admin-btn admin-btn-xs admin-btn-secondary"
                                  onClick={() => handleResolveReport(r.id, 'dismissed')}
                                  title={text('admin.reports.dismissTitle')}
                                >
                                  {text('admin.reports.dismiss')}
                                </button>
                              </>
                            )}
                            {r.targetType === 'guest' && (
                              <button
                                type="button"
                                className="admin-btn admin-btn-xs admin-btn-danger"
                                onClick={() => handleBanGuest(r.targetId, text('admin.prompt.reportReason', { id: r.id, reason: r.reason }))}
                                title={text('admin.reports.banTitle')}
                              >
                                {text('admin.reports.ban')}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* ================= TAB 5: BANS ================= */}
        {activeTab === 'bans' && (
          <section className="admin-card-section" aria-labelledby="bans-title">
            <div className="admin-section-header">
              <div>
                <h2 id="bans-title" className="admin-section-heading">
                  {text('admin.bans.title')}
                </h2>
                <p className="admin-section-desc">{text('admin.bans.description')}</p>
              </div>
              <div className="admin-btn-group">
                <button
                  type="button"
                  className="admin-btn admin-btn-sm admin-btn-secondary"
                  onClick={refreshBans}
                  disabled={isLoading}
                >
                  {text('admin.bans.refresh')}
                </button>
                <button
                  type="button"
                  className="admin-btn admin-btn-sm admin-btn-danger"
                  onClick={() => setShowNewBanForm(!showNewBanForm)}
                >
                  {showNewBanForm ? text('admin.bans.collapseNew') : text('admin.bans.new')}
                </button>
              </div>
            </div>

            {/* Collapsible New Ban Form */}
            {showNewBanForm && (
              <form onSubmit={handleManualBanSubmit} className="admin-inline-form-card" aria-label={text('admin.bans.formAria')}>
                <h3 className="admin-subheading">{text('admin.bans.formTitle')}</h3>
                <div className="admin-form-row">
                  <div className="admin-form-field">
                    <label htmlFor="ban-guest-id">{text('admin.bans.guestId')}</label>
                    <input
                      id="ban-guest-id"
                      type="text"
                      className="admin-input font-mono"
                      value={newBanGuestId}
                      onChange={(e) => setNewBanGuestId(e.target.value)}
                      placeholder={text('admin.bans.guestPlaceholder')}
                      required
                    />
                  </div>
                  <div className="admin-form-field">
                    <label htmlFor="ban-reason">{text('admin.bans.reason')}</label>
                    <input
                      id="ban-reason"
                      type="text"
                      className="admin-input"
                      value={newBanReason}
                      onChange={(e) => setNewBanReason(e.target.value)}
                      placeholder={text('admin.bans.reasonPlaceholder')}
                    />
                  </div>
                  <div className="admin-form-field">
                    <label htmlFor="ban-severity">{text('admin.bans.severity')}</label>
                    <select
                      id="ban-severity"
                      className="admin-input"
                      value={newBanSeverity}
                      onChange={(e) => setNewBanSeverity(e.target.value)}
                    >
                      <option value="critical">{text('admin.bans.critical')}</option>
                      <option value="high">{text('admin.bans.high')}</option>
                      <option value="medium">{text('admin.bans.medium')}</option>
                    </select>
                  </div>
                  <div className="admin-form-field admin-field-btn">
                    <button type="submit" className="admin-btn admin-btn-danger">
                      {text('admin.bans.create')}
                    </button>
                  </div>
                </div>
              </form>
            )}

            {/* Bans Table */}
            <div className="admin-table-container">
              <table className="admin-table" aria-label={text('admin.bans.tableAria')}>
                <thead>
                  <tr>
                    <th>{text('admin.bans.recordId')}</th>
                    <th>{text('admin.bans.guestId')}</th>
                    <th>{text('admin.bans.flagType')}</th>
                    <th>{text('admin.bans.severity')}</th>
                    <th>{text('admin.bans.reason')}</th>
                    <th>{text('admin.bans.created')}</th>
                    <th>{text('admin.reports.status')}</th>
                    <th>{text('admin.reports.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {bans.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="admin-empty-cell">
                        {text('admin.bans.empty')}
                      </td>
                    </tr>
                  ) : (
                    bans.map((b) => (
                      <tr key={b.id}>
                        <td className="font-mono text-sm">{b.id.slice(0, 8)}…</td>
                        <td className="font-mono text-sm">{b.guestId}</td>
                        <td>
                          <span className="admin-badge-category">{b.flagType}</span>
                        </td>
                        <td>
                          <span className="admin-badge-danger">{b.severity}</span>
                        </td>
                        <td>{b.reason}</td>
                        <td>{formatDate(b.createdAt, language)}</td>
                        <td>
                          <span className={`admin-status-badge ${b.isActive ? 'status-danger' : 'status-ended'}`}>
                            {b.isActive ? text('admin.bans.active') : text('admin.bans.inactive')}
                          </span>
                        </td>
                        <td>
                          {b.isActive && (
                            <button
                              type="button"
                              className="admin-btn admin-btn-xs admin-btn-secondary"
                              onClick={() => handleUnbanGuest(b.id)}
                            >
                              {text('admin.bans.remove')}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {activeTab === 'config' && (
          <section className="admin-card-section" aria-labelledby="config-title">
            <div className="admin-section-header">
              <div>
                <h2 id="config-title" className="admin-section-heading">{text('admin.config.title')}</h2>
                <p className="admin-section-desc">{text('admin.config.description')}</p>
              </div>
            </div>
            {configs.length === 0 ? <p className="admin-empty-text">{text('admin.config.empty')}</p> : configs.map((item) => (
              <div key={item.key} className="admin-inline-form-card" style={{ marginBottom: 12 }}>
                <div className="admin-section-header">
                  <div><strong className="font-mono">{item.key}</strong><p className="admin-section-desc">{item.description || text('admin.config.missingDescription')} · v{item.version}</p></div>
                  <button type="button" className="admin-btn admin-btn-sm admin-btn-primary" onClick={() => handleSaveConfig(item)}>{text('admin.config.save')}</button>
                </div>
                <textarea className="admin-input font-mono" rows={8} value={configDrafts[item.key] || ''} onChange={(event) => setConfigDrafts((current) => ({ ...current, [item.key]: event.target.value }))} aria-label={text('admin.config.aria', { key: item.key })} />
              </div>
            ))}
          </section>
        )}
      </main>
    </div>
  );
}

export default AdminApp;
