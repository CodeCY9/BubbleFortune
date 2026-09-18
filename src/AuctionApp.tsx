import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useAuctionGameState, mapAuctionPhaseToUIPhase } from './hooks/useAuctionGameState';
import { usePreferences } from './hooks/usePreferences';
import { useModalLifecycle } from './hooks/useModalLifecycle';
import { LowMoneyLadder, HighMoneyLadder } from './components/MoneyLadder';
import { SettingsDialog } from './components/SettingsDialog';
import { HistoryModal } from './components/HistoryModal';
import { useTheme } from './themes';
import { PwaNotice } from './components/PwaControls';
import { AuctionWaitingLobby } from './components/AuctionWaitingLobby';
import { AuctionHeader } from './components/AuctionHeader';
import { AuctionSeatList } from './components/AuctionSeatList';
import { AuctionActionPanel } from './components/AuctionActionPanel';
import { AuctionEmoteBar } from './components/AuctionEmoteBar';
import { AuctionFinishedModal } from './components/AuctionFinishedModal';
import { fetchAuctionRooms, type AuctionRoomSummary } from './api/auction';
import { translate, useLanguage } from './i18n';
import {
  Users,
  Shield,
  History,
  Home,
  AlertTriangle,
  RefreshCw,
  LogOut,
  Sparkles,
  Eye,
} from 'lucide-react';
import './duel.css';

// Lazy load Stage3D with named export resolution to prevent runtime default export failure
const Stage3D = React.lazy(() =>
  import('./components/Stage3D').then((m) => ({ default: m.Stage3D }))
);

export function AuctionApp() {
  const language = useLanguage();
  const msg = (key: Parameters<typeof translate>[0], replacements: Record<string, string | number> = {}) =>
    Object.entries(replacements).reduce(
      (text, [name, value]) => text.replace(new RegExp(`\\{${name}\\}`, 'g'), String(value)),
      translate(key, language),
    );
  const {
    preferences,
    effectiveQuality,
    effectiveReducedMotion,
    updatePreference,
    resetPreferences,
    handleFpsWindow,
  } = usePreferences();

  const { theme, setTheme, availableThemes } = useTheme(effectiveQuality);

  const {
    presentation,
    authority,
    publicState,
    privateState,
    connectionStatus,
    isPending,
    error,
    serverNow,
    serverTimeOffset,
    latencyMs,
    deadlineTimestamp,
    mySeatId,
    myRole,
    isSpectator,
    isHost,
    storedSession,
    hasStoredSession,
    createRoom,
    joinRoom,
    reconnectStoredSession,
    discardStoredSession,
    sendReady,
    sendStart,
    selectBox,
    openBox,
    submitBid,
    acceptOffer,
    rejectOffer,
    keepBox,
    swapBox,
    continueRound,
    sendEmote,
    leaveRoom,
    handleBoxClick,
    handleBoxAnimationComplete,
    clearError,
  } = useAuctionGameState({
    soundEnabled: preferences.sound,
    fastMode: preferences.fast,
  });

  // URL query parameter parsing (?room=<roomId>)
  const [urlRoomCode, setUrlRoomCode] = useState<string>('');
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const room = params.get('room') || '';
      if (room) {
        setUrlRoomCode(room.trim());
      }
    }
  }, []);

  // Entrance state
  const [activeTab, setActiveTab] = useState<'CREATE' | 'JOIN'>('CREATE');
  const [nicknameInput, setNicknameInput] = useState<string>('');
  const [roomCodeInput, setRoomCodeInput] = useState<string>('');
  const [joinAsSpectator, setJoinAsSpectator] = useState<boolean>(false);
  const [confirmDiscard, setConfirmDiscard] = useState<boolean>(false);

  // Room configuration state (only sent on create)
  const [isPrivate, setIsPrivate] = useState<boolean>(false);
  const [roomPassword, setRoomPassword] = useState<string>('');
  const [ranked, setRanked] = useState<boolean>(true);
  const [allowSpectators, setAllowSpectators] = useState<boolean>(true);
  const [allowEmotes, setAllowEmotes] = useState<boolean>(true);
  const [showBidHistory, setShowBidHistory] = useState<boolean>(true);
  const [publicRooms, setPublicRooms] = useState<AuctionRoomSummary[]>([]);
  const [publicRoomsLoading, setPublicRoomsLoading] = useState(false);

  // Pre-fill room code if in URL
  useEffect(() => {
    if (urlRoomCode) {
      setRoomCodeInput(urlRoomCode);
      setActiveTab('JOIN');
    }
  }, [urlRoomCode]);

  const loadPublicRooms = useCallback(async (signal?: AbortSignal) => {
    setPublicRoomsLoading(true);
    try {
      setPublicRooms(await fetchAuctionRooms(signal));
    } catch {
      if (!signal?.aborted) setPublicRooms([]);
    } finally {
      if (!signal?.aborted) setPublicRoomsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (publicState) return;
    const controller = new AbortController();
    void loadPublicRooms(controller.signal);
    return () => controller.abort();
  }, [loadPublicRooms, publicState]);

  // The room creator chooses the cosmetic theme; all participants follow the authoritative snapshot.
  useEffect(() => {
    if (publicState?.themeId && publicState.themeId !== theme) {
      setTheme(publicState.themeId as typeof theme);
    }
  }, [publicState?.themeId, setTheme, theme]);

  // Dialog states
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isLeaveModalOpen, setIsLeaveModalOpen] = useState(false);
  const [screenShakeActive, setScreenShakeActive] = useState(false);

  useEffect(() => {
    if (!preferences.screenShake || presentation.openingBoxId === null) {
      setScreenShakeActive(false);
      return;
    }
    setScreenShakeActive(true);
    const timer = window.setTimeout(() => setScreenShakeActive(false), 320);
    return () => window.clearTimeout(timer);
  }, [presentation.openingBoxId, preferences.screenShake]);

  const leaveDialogRef = useRef<HTMLDialogElement | null>(null);
  const settingsDialogRef = useRef<HTMLDialogElement | null>(null);
  useModalLifecycle(leaveDialogRef, isLeaveModalOpen);
  useModalLifecycle(settingsDialogRef, isSettingsOpen);

  const handleNicknameChange = (val: string) => {
    const chars = Array.from(val);
    if (chars.length <= 16) {
      setNicknameInput(val);
    }
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = Array.from(nicknameInput.trim()).slice(0, 16).join('');
    await createRoom(trimmed, joinAsSpectator, {
      isPrivate,
      ranked,
      allowSpectators,
      allowEmotes,
      showBidHistory,
      themeId: theme,
      password: isPrivate ? roomPassword.trim() : undefined,
    });
  };

  const handleJoinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedCode = roomCodeInput.trim();
    if (!trimmedCode) return;
    const trimmedNick = Array.from(nicknameInput.trim()).slice(0, 16).join('');
    await joinRoom(trimmedCode, trimmedNick, joinAsSpectator, roomPassword.trim() || undefined);
  };

  const handleLeaveClick = () => {
    const phase = presentation.phase;
    const isActiveMatch = phase !== 'WAITING' && phase !== 'FINISHED';
    if (isActiveMatch && !isSpectator) {
      setIsLeaveModalOpen(true);
    } else {
      leaveRoom(false);
    }
  };

  const handleConfirmLeave = async () => {
    setIsLeaveModalOpen(false);
    await leaveRoom(true);
  };

  // Stage interaction permissions:
  // CAPITALIST and SPECTATOR can NEVER click 3D boxes or HTML case selector!
  // CHALLENGER can only click during SELECTING or OPENING
  const isChallenger = myRole === 'CHALLENGER';
  const canInteractStage =
    isChallenger &&
    !isPending &&
    presentation.openingBoxId === null &&
    (presentation.phase === 'SELECTING' || presentation.phase === 'OPENING');

  // Challenger box label
  const challengerNickname =
    publicState?.seats.find((s) => s.seatId === publicState.challengerSeatId)?.nickname;
  const playerBoxLabel = challengerNickname
    ? msg('auction.challengerBoxNamed', { name: challengerNickname })
    : translate('auction.challengerBox', language);

  // Remaining other box for FINAL_SWAP
  const remainingSwapBoxId = useMemo(() => {
    if (presentation.phase !== 'FINAL_SWAP' || presentation.playerBoxId === null) {
      return null;
    }
    const otherBox = presentation.boxes.find(
      (b) => !b.isOpened && b.id !== presentation.playerBoxId
    );
    return otherBox?.id ?? null;
  }, [presentation.phase, presentation.playerBoxId, presentation.boxes]);

  const hasRoomConflict =
    hasStoredSession &&
    storedSession &&
    urlRoomCode &&
    storedSession.roomId !== urlRoomCode;

  const uiPhase = mapAuctionPhaseToUIPhase(presentation.phase);

  return (
    <div className={`duel-app-container${screenShakeActive ? ' screen-shake-active' : ''}`}>
      <PwaNotice onOpenSettings={() => setIsSettingsOpen(true)} />

      {/* 1. ENTRANCE & ROOM CONFLICT OVERLAY */}
      {!publicState && (
        <div className="duel-entrance-overlay">
          <div className="duel-card" role="region" aria-label={msg('auction.entrance.aria')}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <div className="duel-title">
                <Users size={28} color="#f59e0b" />
                <span>{msg('auction.entrance.title')}</span>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  onClick={() => setIsHistoryOpen(true)}
                  className="btn-secondary"
                  style={{ minHeight: '38px', padding: '6px 12px', fontSize: '0.85rem', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                >
                  <History size={16} />
                  <span>{msg('auction.entrance.history')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => window.location.assign('/')}
                  className="btn-secondary"
                  style={{ minHeight: '38px', padding: '6px 12px', fontSize: '0.85rem', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                >
                  <Home size={16} />
                  <span>{msg('auction.entrance.lobby')}</span>
                </button>
              </div>
            </div>

            <div className="duel-subtitle">
              {msg('auction.entrance.subtitle')}<br />
              {msg('auction.entrance.spectatorSupport')}
            </div>

            {/* Existing Session Conflict Alert */}
            {hasRoomConflict && (
              <div
                style={{
                  background: 'rgba(245, 158, 11, 0.15)',
                  border: '1.5px solid rgba(245, 158, 11, 0.4)',
                  borderRadius: '14px',
                  padding: '14px',
                  marginBottom: '16px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#fcd34d', fontWeight: 800, marginBottom: '6px' }}>
                  <AlertTriangle size={18} />
                  <span>{msg('auction.entrance.conflictTitle')}</span>
                </div>
                <div style={{ fontSize: '0.85rem', color: '#d1d5db', lineHeight: 1.5, marginBottom: '12px' }}>
                  {msg('auction.entrance.conflictBody', { stored: storedSession?.roomId || '', invited: urlRoomCode })}
                </div>
                {confirmDiscard ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <span style={{ fontSize: '0.8rem', color: '#f87171' }}>
                      {msg('auction.entrance.discardWarning')}
                    </span>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        type="button"
                        onClick={() => {
                          discardStoredSession();
                          setConfirmDiscard(false);
                        }}
                        className="duel-action-btn reject"
                        style={{ minHeight: '36px', padding: '4px 14px', fontSize: '0.8rem' }}
                      >
                        {msg('auction.entrance.discardLocal')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDiscard(false)}
                        className="btn-secondary"
                        style={{ minHeight: '36px', padding: '4px 14px', fontSize: '0.8rem' }}
                      >
                        {msg('auction.entrance.cancel')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      onClick={reconnectStoredSession}
                      className="duel-action-btn btn-primary"
                      style={{ minHeight: '38px', padding: '6px 16px', fontSize: '0.85rem' }}
                    >
                      {msg('auction.entrance.recoverOriginal')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDiscard(true)}
                      className="btn-secondary"
                      style={{ minHeight: '38px', padding: '6px 14px', fontSize: '0.85rem' }}
                    >
                      {msg('auction.entrance.discard')}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Existing Session Recovery Option (No conflict) */}
            {hasStoredSession && !hasRoomConflict && (
              <div
                style={{
                  background: 'rgba(16, 185, 129, 0.15)',
                  border: '1.5px solid rgba(16, 185, 129, 0.4)',
                  borderRadius: '14px',
                  padding: '14px',
                  marginBottom: '16px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '12px',
                  flexWrap: 'wrap',
                }}
              >
                <div>
                  <div style={{ fontWeight: 800, color: '#6ee7b7' }}>{msg('auction.entrance.activeTitle')}</div>
                  <div style={{ fontSize: '0.8rem', color: '#d1d5db' }}>{msg('auction.entrance.roomNumber', { room: storedSession?.roomId || '' })}</div>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    type="button"
                    onClick={reconnectStoredSession}
                    className="duel-action-btn accept"
                    style={{ minHeight: '38px', padding: '6px 16px', fontSize: '0.85rem' }}
                  >
                    {msg('auction.entrance.recover')}
                  </button>
                  <button
                    type="button"
                    onClick={discardStoredSession}
                    className="btn-secondary"
                    style={{ minHeight: '38px', padding: '6px 12px', fontSize: '0.85rem' }}
                  >
                    {msg('auction.entrance.discard')}
                  </button>
                </div>
              </div>
            )}

            {/* Error banner */}
            {error && (
              <div
                style={{
                  background: 'rgba(239, 68, 68, 0.2)',
                  border: '1px solid rgba(239, 68, 68, 0.4)',
                  borderRadius: '12px',
                  padding: '10px 14px',
                  color: '#fca5a5',
                  fontSize: '0.85rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: '16px',
                }}
              >
                <span>{error}</span>
                <button
                  type="button"
                  onClick={clearError}
                  style={{ background: 'transparent', border: 'none', color: '#fca5a5', cursor: 'pointer' }}
                >
                  ✕
                </button>
              </div>
            )}

            {/* Nickname Input */}
            <div className="duel-input-group">
              <label htmlFor="auction-nickname-input" className="duel-input-label">
                {msg('auction.entrance.nickname')}
              </label>
              <input
                id="auction-nickname-input"
                type="text"
                value={nicknameInput}
                onChange={(e) => handleNicknameChange(e.target.value)}
                placeholder={msg('auction.entrance.nicknamePlaceholder')}
                className="duel-input"
                maxLength={32}
              />
            </div>

            <div className="duel-input-group">
              <label htmlFor="auction-theme-select" className="duel-input-label">{msg('auction.entrance.theme')}</label>
              <select id="auction-theme-select" value={theme} onChange={(e) => setTheme(e.target.value as typeof theme)} className="duel-input">
                {availableThemes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </div>

            {/* Spectator Checkbox Toggle */}
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.85rem', color: '#d1d5db' }}>
                <input
                  type="checkbox"
                  checked={joinAsSpectator}
                  onChange={(e) => setJoinAsSpectator(e.target.checked)}
                  style={{ width: '16px', height: '16px', accentColor: '#f59e0b' }}
                />
                <Eye size={16} color="#67e8f9" />
                <span>{msg('auction.entrance.joinSpectator')}</span>
              </label>
            </div>

            {/* Tabs: Create vs Join */}
            <div className="duel-tabs">
              <button
                type="button"
                className={`duel-tab-btn ${activeTab === 'CREATE' ? 'active' : ''}`}
                onClick={() => setActiveTab('CREATE')}
              >
                {msg('auction.entrance.createTab')}
              </button>
              <button
                type="button"
                className={`duel-tab-btn ${activeTab === 'JOIN' ? 'active' : ''}`}
                onClick={() => setActiveTab('JOIN')}
              >
                {msg('auction.entrance.joinTab')}
              </button>
            </div>

            {activeTab === 'CREATE' ? (
              <form onSubmit={handleCreateSubmit}>
                <div style={{ fontSize: '0.85rem', color: '#9ca3af', marginBottom: '16px', lineHeight: 1.5 }}>
                  {msg('auction.entrance.createIntro')}
                </div>

                <div
                  style={{
                    background: 'rgba(0, 0, 0, 0.25)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '12px',
                    padding: '12px 14px',
                    marginBottom: '16px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px',
                  }}
                >
                  <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#f59e0b', marginBottom: '2px' }}>
                    {msg('auction.entrance.configTitle')}
                  </div>
                  <div style={{ color: '#cbd5e1', fontSize: '0.8rem', lineHeight: 1.5 }}>
                    {msg('auction.entrance.configSummary')}
                  </div>

                  <label
                    htmlFor="auction-config-private"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '10px',
                      cursor: 'pointer',
                      fontSize: '0.85rem',
                      color: '#e5e7eb',
                    }}
                  >
                    <input
                      id="auction-config-private"
                      type="checkbox"
                      checked={isPrivate}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setIsPrivate(checked);
                        if (checked) setRanked(false);
                      }}
                      style={{ width: '16px', height: '16px', accentColor: '#f59e0b', cursor: 'pointer' }}
                    />
                    <span>{msg('auction.entrance.private')}</span>
                  </label>

                  {isPrivate && (
                    <div className="duel-input-group" style={{ margin: 0 }}>
                      <label htmlFor="auction-room-password-create" className="duel-input-label">
                        {msg('auction.entrance.password')}
                      </label>
                      <input
                        id="auction-room-password-create"
                        type="password"
                        value={roomPassword}
                        onChange={(e) => setRoomPassword(e.target.value.slice(0, 64))}
                        minLength={4}
                        maxLength={64}
                        required
                        autoComplete="new-password"
                        className="duel-input"
                      />
                    </div>
                  )}

                  <label
                    htmlFor="auction-config-ranked"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '10px',
                      cursor: 'pointer',
                      fontSize: '0.85rem',
                      color: '#e5e7eb',
                    }}
                  >
                    <input
                      id="auction-config-ranked"
                      type="checkbox"
                      checked={ranked}
                      onChange={(e) => setRanked(e.target.checked)}
                      disabled={isPrivate}
                      style={{ width: '16px', height: '16px', accentColor: '#f59e0b', cursor: isPrivate ? 'not-allowed' : 'pointer' }}
                    />
                    <span>{msg('auction.entrance.ranked')}</span>
                  </label>

                  <label
                    htmlFor="auction-config-allow-spectators"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '10px',
                      cursor: 'pointer',
                      fontSize: '0.85rem',
                      color: '#e5e7eb',
                    }}
                  >
                    <input
                      id="auction-config-allow-spectators"
                      type="checkbox"
                      checked={allowSpectators}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setAllowSpectators(checked);
                        if (!checked && joinAsSpectator) {
                          setJoinAsSpectator(false);
                        }
                      }}
                      style={{ width: '16px', height: '16px', accentColor: '#f59e0b', cursor: 'pointer' }}
                    />
                    <span>{msg('auction.entrance.spectators')}</span>
                  </label>

                  <label
                    htmlFor="auction-config-allow-emotes"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontSize: '0.85rem', color: '#e5e7eb' }}
                  >
                    <input
                      id="auction-config-allow-emotes"
                      type="checkbox"
                      checked={allowEmotes}
                      onChange={(e) => setAllowEmotes(e.target.checked)}
                      style={{ width: '16px', height: '16px', accentColor: '#f59e0b', cursor: 'pointer' }}
                    />
                    <span>{msg('auction.entrance.emotes')}</span>
                  </label>

                  <label
                    htmlFor="auction-config-show-bid-history"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontSize: '0.85rem', color: '#e5e7eb' }}
                  >
                    <input
                      id="auction-config-show-bid-history"
                      type="checkbox"
                      checked={showBidHistory}
                      onChange={(e) => setShowBidHistory(e.target.checked)}
                      style={{ width: '16px', height: '16px', accentColor: '#f59e0b', cursor: 'pointer' }}
                    />
                    <span>{msg('auction.entrance.bidHistory')}</span>
                  </label>
                </div>

                <button
                  type="submit"
                  disabled={isPending || connectionStatus === 'connecting'}
                  className="btn-primary"
                  style={{ width: '100%', minHeight: '46px', fontSize: '1rem', fontWeight: 800, borderRadius: '12px' }}
                >
                  {connectionStatus === 'connecting' ? msg('auction.entrance.creating') : msg('auction.entrance.create')}
                </button>
              </form>
            ) : (
              <form onSubmit={handleJoinSubmit}>
                <div className="duel-input-group">
                  <label htmlFor="auction-room-code-input" className="duel-input-label">
                    {msg('auction.entrance.roomCode')}
                  </label>
                  <input
                    id="auction-room-code-input"
                    type="text"
                    value={roomCodeInput}
                    onChange={(e) => setRoomCodeInput(e.target.value)}
                    placeholder={msg('auction.entrance.roomCodePlaceholder')}
                    className="duel-input"
                    required
                  />
                </div>
                <div className="duel-input-group">
                  <label htmlFor="auction-room-password-join" className="duel-input-label">
                    {msg('auction.entrance.joinPassword')}
                  </label>
                  <input
                    id="auction-room-password-join"
                    type="password"
                    value={roomPassword}
                    onChange={(e) => setRoomPassword(e.target.value.slice(0, 64))}
                    maxLength={64}
                    autoComplete="current-password"
                    className="duel-input"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isPending || connectionStatus === 'connecting' || !roomCodeInput.trim()}
                  className="btn-primary"
                  style={{ width: '100%', minHeight: '46px', fontSize: '1rem', fontWeight: 800, borderRadius: '12px' }}
                >
                  {connectionStatus === 'connecting' ? msg('auction.entrance.connecting') : msg('auction.entrance.join')}
                </button>
              </form>
            )}

            <section aria-label={msg('auction.entrance.publicRoomsAria')} style={{ marginTop: '18px', paddingTop: '16px', borderTop: '1px solid rgba(255,255,255,.1)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', marginBottom: '10px' }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: '1rem', color: '#fcd34d' }}>{msg('auction.entrance.publicRooms')}</h2>
                  <p style={{ margin: '4px 0 0', color: '#94a3b8', fontSize: '.78rem' }}>{msg('auction.entrance.publicDescription')}</p>
                </div>
                <button type="button" className="btn-secondary" onClick={() => void loadPublicRooms()} disabled={publicRoomsLoading} style={{ minHeight: '36px', padding: '5px 10px', fontSize: '.78rem', display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                  <RefreshCw size={14} className={publicRoomsLoading ? 'spin' : undefined} /> {msg('auction.entrance.refresh')}
                </button>
              </div>
              {publicRooms.length === 0 ? (
                <div style={{ padding: '12px', borderRadius: '10px', background: 'rgba(255,255,255,.04)', color: '#94a3b8', fontSize: '.82rem' }}>
                  {publicRoomsLoading ? msg('auction.entrance.publicLoading') : msg('auction.entrance.noPublic')}
                </div>
              ) : (
                <div style={{ display: 'grid', gap: '8px' }}>
                  {publicRooms.map((room) => (
                    <div key={room.roomId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', padding: '10px 12px', borderRadius: '10px', background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.1)' }}>
                      <div style={{ minWidth: 0 }}>
                        <strong style={{ color: '#fff' }}>{room.roomId}</strong>
                        <span style={{ marginLeft: '8px', color: '#94a3b8', fontSize: '.78rem' }}>{msg('auction.entrance.roomSummary', { players: room.players, maxPlayers: room.maxPlayers, ranked: room.ranked ? msg('auction.entrance.rankedLabel') : msg('auction.entrance.casualLabel'), theme: room.themeId === 'starry-neon' ? msg('auction.entrance.starryTheme') : msg('auction.entrance.classicTheme'), spectators: room.allowSpectators ? msg('auction.entrance.spectatorLabel') : '' })}</span>
                      </div>
                      <button type="button" className="btn-secondary" onClick={() => { setRoomCodeInput(room.roomId); setActiveTab('JOIN'); setJoinAsSpectator(false); }} style={{ minHeight: '36px', padding: '5px 12px', fontSize: '.78rem', whiteSpace: 'nowrap' }}>{msg('auction.entrance.fillRoom')}</button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      )}

      {/* 2. WAITING LOBBY OVERLAY */}
      {publicState && presentation.phase === 'WAITING' && (
        <AuctionWaitingLobby
          roomId={publicState.roomId}
          publicState={publicState}
          mySeatId={mySeatId}
          isHost={isHost}
          isSpectator={isSpectator}
          isPending={isPending}
          onReady={sendReady}
          onStart={sendStart}
          onLeave={handleLeaveClick}
        />
      )}

      {/* 3. GAME ARENA VIEW */}
      {publicState && presentation.phase !== 'WAITING' && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            width: '100%',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          {/* Header */}
          <AuctionHeader
            roomId={publicState.roomId}
            roundIndex={presentation.roundIndex}
            totalRounds={publicState.totalRounds}
            challengerNickname={challengerNickname}
            phase={presentation.phase}
            deadlineTimestamp={deadlineTimestamp}
            serverNow={serverNow}
            serverTimeOffset={serverTimeOffset}
            latencyMs={latencyMs}
            spectatorCount={publicState.spectatorCount}
            soundEnabled={preferences.sound}
            onToggleSound={() => updatePreference('sound', !preferences.sound)}
            onOpenSettings={() => setIsSettingsOpen(true)}
            onOpenHistory={() => setIsHistoryOpen(true)}
            onLeave={handleLeaveClick}
            isSpectator={isSpectator}
          />

          {/* Seat List */}
          <AuctionSeatList
            seats={presentation.seats}
            mySeatId={mySeatId}
            challengerSeatId={publicState.challengerSeatId}
            phase={presentation.phase}
            bidsSubmittedSeats={presentation.bidsSubmittedSeats}
            privateState={privateState}
          />

          {/* Error Banner if any */}
          {error && (
            <div
              style={{
                position: 'absolute',
                top: '120px',
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: 30,
                background: 'rgba(239, 68, 68, 0.95)',
                color: '#ffffff',
                padding: '8px 16px',
                borderRadius: '10px',
                fontSize: '0.85rem',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
              }}
            >
              <span>{error}</span>
              <button
                type="button"
                onClick={clearError}
                style={{ background: 'transparent', border: 'none', color: '#ffffff', cursor: 'pointer', fontWeight: 800 }}
              >
                ✕
              </button>
            </div>
          )}

          {/* Arena Center: Ladders + 3D Stage */}
          <main
            className="duel-arena"
            style={{
              flex: 1,
              display: 'flex',
              position: 'relative',
              overflow: 'hidden',
              minHeight: 0,
            }}
          >
            {/* Low Money Ladder */}
            <aside className="duel-ladder low-ladder" style={{ width: '130px', zIndex: 10 }}>
              <LowMoneyLadder boxes={presentation.boxes} playerBoxId={presentation.playerBoxId} />
            </aside>

            {/* 3D Stage */}
            <div className="duel-stage-container" style={{ flex: 1, position: 'relative', height: '100%' }}>
              <React.Suspense fallback={<div className="stage-loading">{translate('game.stageLoading', language)}</div>}>
                <Stage3D
                  boxes={presentation.boxes}
                  playerBoxId={presentation.playerBoxId}
                  phase={uiPhase}
                  onBoxClick={handleBoxClick}
                  onBoxAnimationComplete={(boxId) => {
                    handleBoxAnimationComplete(boxId);
                    if (preferences.haptics && typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
                      try { navigator.vibrate(18); } catch { /* optional haptics */ }
                    }
                  }}
                  openingBoxId={presentation.openingBoxId}
                  fastMode={preferences.fast}
                  isPending={isPending}
                  connectionStatus={connectionStatus}
                  effectiveQuality={effectiveQuality}
                  effectiveReducedMotion={effectiveReducedMotion}
                  onFpsWindow={handleFpsWindow}
                  canInteract={canInteractStage}
                  playerBoxLabel={playerBoxLabel}
                />
              </React.Suspense>
            </div>

            {/* High Money Ladder */}
            <aside className="duel-ladder high-ladder" style={{ width: '130px', zIndex: 10 }}>
              <HighMoneyLadder boxes={presentation.boxes} playerBoxId={presentation.playerBoxId} />
            </aside>
          </main>

          {/* Action Panel */}
          <AuctionActionPanel
            phase={presentation.phase}
            myRole={myRole}
            isSpectator={isSpectator}
            isPending={isPending}
            boxRound={presentation.boxRound}
            boxesLeftToOpenThisRound={presentation.boxesLeftToOpenThisRound}
            playerBoxId={presentation.playerBoxId}
            remainingSwapBoxId={remainingSwapBoxId}
            currentOffer={presentation.currentOffer}
            roundResults={presentation.roundResults}
            roundIndex={presentation.roundIndex}
            privateState={privateState}
            confirmDealPref={preferences.confirmDeal}
            serverTimeOffset={serverTimeOffset}
            onAcceptOffer={acceptOffer}
            onRejectOffer={rejectOffer}
            onKeepBox={keepBox}
            onSwapBox={swapBox}
            onSubmitBid={submitBid}
            onContinueRound={continueRound}
          />

          {/* Emote Reaction Bar */}
          <AuctionEmoteBar
            onSendEmote={sendEmote}
            lastReaction={publicState.lastReaction}
            disabled={connectionStatus !== 'connected'}
          />
        </div>
      )}

      {/* 4. FINISHED MODAL */}
      {presentation.phase === 'FINISHED' && presentation.result && (
        <AuctionFinishedModal
          result={presentation.result}
          mySeatId={mySeatId}
          onOpenHistory={() => setIsHistoryOpen(true)}
          onLeave={handleConfirmLeave}
        />
      )}

      {/* 5. LEAVE CONFIRMATION MODAL */}
      <dialog
        ref={leaveDialogRef}
        className="glass-card-gold"
        style={{
          borderRadius: '16px',
          padding: '24px',
          maxWidth: '440px',
          width: '90%',
          border: '1.5px solid rgba(239, 68, 68, 0.4)',
          background: 'rgba(20, 15, 35, 0.98)',
          color: '#ffffff',
          boxShadow: '0 20px 40px rgba(0, 0, 0, 0.8)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#f87171', fontWeight: 800, fontSize: '1.1rem', marginBottom: '10px' }}>
          <AlertTriangle size={22} />
          <span>{msg('auction.entrance.leaveTitle')}</span>
        </div>
        <p style={{ fontSize: '0.9rem', color: '#d1d5db', lineHeight: 1.5, marginBottom: '20px' }}>
          {msg('auction.entrance.leaveBody')}
        </p>
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={() => setIsLeaveModalOpen(false)}
            className="btn-secondary"
            style={{ minHeight: '38px', padding: '6px 16px' }}
          >
            {msg('auction.entrance.stay')}
          </button>
          <button
            type="button"
            onClick={handleConfirmLeave}
            className="duel-action-btn reject"
            style={{ minHeight: '38px', padding: '6px 16px' }}
          >
            {msg('auction.entrance.confirmLeave')}
          </button>
        </div>
      </dialog>

      {/* 6. SETTINGS & HISTORY DIALOGS */}
      <SettingsDialog
        dialogRef={settingsDialogRef}
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        onCancel={() => setIsSettingsOpen(false)}
        preferences={preferences}
        effectiveQuality={effectiveQuality}
        effectiveReducedMotion={effectiveReducedMotion}
        onUpdatePreference={updatePreference}
        onResetPreferences={resetPreferences}
        deadlineTimestamp={deadlineTimestamp}
        serverTimeOffset={serverTimeOffset}
        isGameOver={presentation.phase === 'FINISHED' || presentation.phase === 'WAITING'}
        phase="AUCTION"
        theme={theme}
        onSelectTheme={setTheme}
      />

      <HistoryModal
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
      />
    </div>
  );
}
