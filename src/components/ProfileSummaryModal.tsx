import React, { useEffect, useState, useRef } from 'react';
import {
  User,
  X,
  Trophy,
  Scale,
  Percent,
  DollarSign,
  Calendar,
  AlertCircle,
  RefreshCw,
  Award,
  ShieldCheck,
  Gamepad2,
  Swords,
  Gavel,
  CheckCircle2,
} from 'lucide-react';
import { fetchGuestStatus, ensureGuestSession } from '../api/history';
import { fetchProfileSummary, ProfileSummary } from '../api/ranking';
import { useModalLifecycle } from '../hooks/useModalLifecycle';
import { formatMoney } from '../types/game';
import { translate, useLanguage, type TranslationKey } from '../i18n';
import './ModalsRevamp.css';

interface ProfileSummaryModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ProfileSummaryModal: React.FC<ProfileSummaryModalProps> = ({
  isOpen,
  onClose,
}) => {
  const language = useLanguage();
  const msg = (key: TranslationKey, replacements: Record<string, string | number> = {}) =>
    Object.entries(replacements).reduce(
      (text, [name, value]) => text.replace(new RegExp(`\\{${name}\\}`, 'g'), String(value)),
      translate(key, language),
    );
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  useModalLifecycle(dialogRef, isOpen);

  const [loading, setLoading] = useState(false);
  const [creatingSession, setCreatingSession] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [isDbAvailable, setIsDbAvailable] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [profile, setProfile] = useState<ProfileSummary | null>(null);

  const loadProfileData = async () => {
    setLoading(true);
    setErrorMessage(null);

    // 1. Verify guest authentication & DB status
    const statusRes = await fetchGuestStatus();
    if (!statusRes.ok || !statusRes.data?.available) {
      setIsDbAvailable(false);
      setIsAuthenticated(false);
      setErrorMessage(
        statusRes.ok && !statusRes.data?.enabled
          ? msg('profile.dbMaintenance')
          : statusRes.error?.message || msg('profile.unavailable')
      );
      setLoading(false);
      return;
    }

    setIsDbAvailable(true);

    if (!statusRes.data.authenticated) {
      setIsAuthenticated(false);
      setProfile(null);
      setLoading(false);
      return;
    }

    setIsAuthenticated(true);

    // 2. Fetch profile summary
    const summaryRes = await fetchProfileSummary();
    if (summaryRes.ok && summaryRes.data) {
      setProfile(summaryRes.data);
    } else {
      setErrorMessage(summaryRes.error?.message || msg('profile.loadFailed'));
    }
    setLoading(false);
  };

  useEffect(() => {
    if (isOpen) {
      loadProfileData();
    }
  }, [isOpen]);

  const handleCreateGuest = async () => {
    setCreatingSession(true);
    setErrorMessage(null);
    try {
      const res = await ensureGuestSession();
      if (res.ok && res.data?.authenticated) {
        setIsAuthenticated(true);
        await loadProfileData();
      } else {
        setErrorMessage(res.error?.message || msg('profile.unavailable'));
      }
    } catch (err: any) {
      setErrorMessage(err?.message || msg('profile.unavailable'));
    } finally {
      setCreatingSession(false);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className="profile-native-dialog"
      aria-labelledby="profile-dialog-title"
    >
      <div className="profile-dialog-content">
        {/* Header */}
        <div className="profile-dialog-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '10px',
                background: 'rgba(59, 130, 246, 0.2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#38bdf8',
              }}
            >
              <User size={20} />
            </div>
            <div>
              <h2 id="profile-dialog-title" style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800 }}>
                {msg('profile.title')}
              </h2>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                {msg('profile.subtitle')}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label={msg('profile.close')}
            className="btn-settings-close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body content */}
        <div className="profile-dialog-body">
          {loading ? (
            <div className="profile-state-card">
              <RefreshCw size={28} className="spin" style={{ color: 'var(--gold-light)' }} />
              <div style={{ fontWeight: 600 }}>{msg('profile.loading')}</div>
            </div>
          ) : !isDbAvailable || errorMessage ? (
            <div className="profile-error-card">
              <AlertCircle size={32} color="#ef4444" style={{ margin: '0 auto 8px auto' }} />
              <div style={{ fontWeight: 700, fontSize: '1rem', color: '#fca5a5' }}>
                {!isDbAvailable ? msg('profile.dbMaintenance') : msg('profile.loadFailed')}
              </div>
              <div style={{ fontSize: '0.85rem', color: '#e5e7eb', marginTop: '6px' }}>
                {errorMessage || msg('profile.unavailable')}
              </div>
              <button
                type="button"
                onClick={loadProfileData}
                style={{
                  marginTop: '14px',
                  padding: '6px 18px',
                  borderRadius: '8px',
                  background: 'rgba(255, 255, 255, 0.1)',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  color: '#ffffff',
                  cursor: 'pointer',
                  minHeight: '38px',
                }}
              >
                {msg('profile.retry')}
              </button>
            </div>
          ) : isAuthenticated === false ? (
            <div className="profile-state-card">
              <ShieldCheck size={36} style={{ color: '#38bdf8', marginBottom: '8px' }} />
              <div style={{ fontWeight: 700, fontSize: '1.05rem', color: '#ffffff' }}>
                {msg('profile.noGuest')}
              </div>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', maxWidth: '380px', lineHeight: 1.5, margin: '8px 0 16px 0' }}>
                {msg('profile.noGuestBody')}
              </p>
              <button
                type="button"
                onClick={handleCreateGuest}
                disabled={creatingSession}
                className="btn-primary"
                style={{
                  minHeight: '40px',
                  padding: '8px 20px',
                  borderRadius: '10px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontWeight: 800,
                  cursor: creatingSession ? 'not-allowed' : 'pointer',
                }}
              >
                {creatingSession ? <RefreshCw size={16} className="spin" /> : <CheckCircle2 size={16} />}
                <span>{creatingSession ? msg('profile.creatingGuest') : msg('profile.createGuest')}</span>
              </button>
            </div>
          ) : profile ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Identity Header Card */}
              <div className="profile-hero-bar">
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div
                    style={{
                      width: '42px',
                      height: '42px',
                      borderRadius: '12px',
                      background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.3) 0%, rgba(139, 92, 246, 0.3) 100%)',
                      border: '1px solid rgba(59, 130, 246, 0.4)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#38bdf8',
                      flexShrink: 0,
                    }}
                  >
                    <User size={22} />
                  </div>
                  <div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                      {msg('profile.guestId')}
                    </div>
                    <div
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '0.92rem',
                        fontWeight: 700,
                        color: 'var(--gold-light)',
                        marginTop: '2px',
                        wordBreak: 'break-all',
                      }}
                    >
                      {profile.guestId}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                  <div
                    style={{
                      padding: '4px 10px',
                      borderRadius: '8px',
                      background: 'rgba(255, 255, 255, 0.06)',
                      border: '1px solid var(--border-glass)',
                      fontSize: '0.78rem',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    {msg('profile.season')}<strong style={{ color: '#ffffff', marginLeft: '4px' }}>{profile.seasonId}</strong>
                  </div>
                  <div
                    style={{
                      padding: '4px 10px',
                      borderRadius: '8px',
                      background: 'rgba(255, 255, 255, 0.06)',
                      border: '1px solid var(--border-glass)',
                      fontSize: '0.78rem',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    {msg('profile.createdAt')}<strong style={{ color: '#ffffff', marginLeft: '4px' }}>{new Date(profile.createdAt).toLocaleDateString(language)}</strong>
                  </div>
                </div>
              </div>

              {/* Core 4-KPI Grid */}
              <div className="profile-kpi-grid">
                {/* Elo & Rank */}
                <div className="profile-kpi-box highlight">
                  <div className="stat-label">
                    <Trophy size={14} color="var(--gold-light)" />
                    <span>{msg('profile.elo')}</span>
                  </div>
                  <div className="stat-value gold">{profile.elo}</div>
                  <div className="stat-sub">
                    {msg('profile.rank')} {profile.rank ? <strong style={{ color: 'var(--gold-light)' }}>#{profile.rank}</strong> : msg('profile.noRank')}
                  </div>
                </div>

                {/* Win Rate */}
                <div className="profile-kpi-box">
                  <div className="stat-label">
                    <Percent size={14} color="#38bdf8" />
                    <span>{msg('profile.winRate')}</span>
                  </div>
                  <div className="stat-value blue">{(profile.winRate * 100).toFixed(1)}%</div>
                  <div className="stat-sub">
                    {msg('profile.winsLossesDraws', { wins: profile.wins, losses: profile.losses, draws: profile.draws })}
                  </div>
                </div>

                {/* Role Balance Return Rate */}
                <div className="profile-kpi-box">
                  <div className="stat-label">
                    <Scale size={14} color="#c084fc" />
                    <span>{msg('profile.roleBalance')}</span>
                  </div>
                  <div className="stat-value purple">{profile.roleBalanceReturnRate.toFixed(4)}</div>
                  <div className="stat-sub">
                    {msg('profile.roleBalanceHint')}
                  </div>
                </div>

                {/* Net Profit */}
                <div className="profile-kpi-box">
                  <div className="stat-label">
                    <DollarSign size={14} color="#34d399" />
                    <span>{msg('profile.netProfit')}</span>
                  </div>
                  <div className={`stat-value ${profile.netProfit >= 0 ? 'green' : 'red'}`}>
                    {formatMoney(profile.netProfit)}
                  </div>
                  <div className="stat-sub">
                    {msg('profile.netProfitHint')}
                  </div>
                </div>
              </div>

              {/* Multi-mode Career Matrix (6-tile on desktop) */}
              <div className="profile-breakdown-card">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                  <div style={{ fontSize: '0.88rem', fontWeight: 800, color: '#ffffff' }}>
                    {msg('profile.career')}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    {msg('profile.rankedMatches')}: <strong style={{ color: 'var(--gold-light)' }}>{profile.matchesPlayed}</strong>
                  </div>
                </div>

                <div className="profile-modes-matrix">
                  <div className="mode-stat-tile">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#f59e0b' }}>
                      <Gamepad2 size={16} />
                      <span className="tile-name">{msg('profile.single')}</span>
                    </div>
                    <div className="tile-num">{profile.singleGamesPlayed}</div>
                  </div>

                  <div className="mode-stat-tile">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#38bdf8' }}>
                      <Swords size={16} />
                      <span className="tile-name">{msg('profile.duel')}</span>
                    </div>
                    <div className="tile-num">{profile.duelGamesPlayed}</div>
                  </div>

                  <div className="mode-stat-tile">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#c084fc' }}>
                      <Gavel size={16} />
                      <span className="tile-name">{msg('profile.auction')}</span>
                    </div>
                    <div className="tile-num">{profile.auctionGamesPlayed}</div>
                  </div>

                  <div className="mode-stat-tile">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#67e8f9' }}>
                      <Award size={16} />
                      <span className="tile-name">{msg('profile.survivor', { wins: profile.survivorWins ?? 0 })}</span>
                    </div>
                    <div className="tile-num">{profile.survivorGamesPlayed ?? 0}</div>
                  </div>

                  <div className="mode-stat-tile">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#fbbf24' }}>
                      <Award size={16} />
                      <span className="tile-name">{msg('profile.tournament', { wins: profile.tournamentWins ?? 0 })}</span>
                    </div>
                    <div className="tile-num">{profile.tournamentGamesPlayed ?? 0}</div>
                  </div>

                  <div className="mode-stat-tile">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#34d399' }}>
                      <Award size={16} />
                      <span className="tile-name">{msg('profile.rankedMatches')}</span>
                    </div>
                    <div className="tile-num">{profile.matchesPlayed}</div>
                  </div>
                </div>

                <div style={{ marginTop: '14px', paddingTop: '10px', borderTop: '1px solid rgba(255, 255, 255, 0.07)', fontSize: '0.78rem', color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                  <span>{msg('profile.forfeits', { count: profile.forfeits })}</span>
                  <span style={{ color: profile.forfeitRate > 0.1 ? '#f87171' : 'var(--text-secondary)' }}>
                    {msg('profile.forfeitRate', { value: (profile.forfeitRate * 100).toFixed(1) })}
                  </span>
                </div>
              </div>

              {/* Classic Solo Record Hall of Fame */}
              <div className="profile-breakdown-card">
                <div style={{ fontSize: '0.88rem', fontWeight: 800, marginBottom: '10px', color: '#ffffff' }}>
                  {msg('profile.singleRecords')}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
                  <div className="breakdown-item" style={{ padding: '12px 14px' }}>
                    <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'rgba(245, 158, 11, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Trophy size={18} color="#fbbf24" />
                    </div>
                    <div>
                      <div className="breakdown-num" style={{ color: '#fcd34d' }}>{formatMoney(profile.singleHighestProfit ?? 0)}</div>
                      <div className="breakdown-title">{msg('profile.singleHighest')}</div>
                    </div>
                  </div>
                  <div className="breakdown-item" style={{ padding: '12px 14px' }}>
                    <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'rgba(192, 132, 252, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Scale size={18} color="#c084fc" />
                    </div>
                    <div>
                      <div className="breakdown-num" style={{ color: '#e9d5ff' }}>{formatMoney(profile.singleBestDealMargin ?? 0)}</div>
                      <div className="breakdown-title">{msg('profile.singleMargin')}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div className="profile-dialog-footer">
          <button
            type="button"
            onClick={loadProfileData}
            style={{
              minHeight: '38px',
              padding: '6px 14px',
              borderRadius: '8px',
              background: 'rgba(255, 255, 255, 0.08)',
              border: '1px solid var(--border-glass)',
              color: 'var(--text-primary)',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '0.85rem',
            }}
          >
            <RefreshCw size={14} /> {msg('profile.refresh')}
          </button>

          <button
            type="button"
            onClick={onClose}
            className="btn-settings-done"
            style={{ minHeight: '38px', padding: '6px 20px' }}
          >
            {msg('profile.done')}
          </button>
        </div>
      </div>
    </dialog>
  );
};
