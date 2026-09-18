import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useDuelGameState } from './hooks/useDuelGameState';
import { usePreferences } from './hooks/usePreferences';
import { useModalLifecycle } from './hooks/useModalLifecycle';
import { mapDuelPhaseToUIPhase } from './utils/duelPresentation';
import { LowMoneyLadder, HighMoneyLadder } from './components/MoneyLadder';
import { SettingsDialog } from './components/SettingsDialog';
import { HistoryModal } from './components/HistoryModal';
import { PwaNotice } from './components/PwaControls';
import { DuelWaitingLobby } from './components/duel/DuelWaitingLobby';
import { DuelHeader } from './components/duel/DuelHeader';
import { DuelActionPanel } from './components/duel/DuelActionPanel';
import { DuelFinishedModal } from './components/duel/DuelFinishedModal';
import { formatMoney } from './types/game';
import { fetchPublicDuelRooms, PublicDuelRoomSummary } from './api/duelRooms';
import { useTheme } from './themes';
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
} from 'lucide-react';
import './duel.css';

// Lazy load Stage3D with named export resolution to prevent runtime default export failure
const Stage3D = React.lazy(() =>
  import('./components/Stage3D').then((m) => ({ default: m.Stage3D }))
);

export function DuelApp() {
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
    serverTimeOffset,
    latencyMs,
    deadlineTimestamp,
    serverNow,
    mySeatId,
    myRole,
    storedSession,
    hasStoredSession,
    createRoom,
    joinRoom,
    reconnectStoredSession,
    discardStoredSession,
    sendCommand,
    handleBoxClick,
    handleBoxAnimationComplete,
    leaveRoom,
    clearError,
  } = useDuelGameState({
    soundEnabled: preferences.sound,
    fastMode: preferences.fast,
  });

  // URL query parameter parsing (case-sensitive raw room ID)
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

  // Entrance Lobby state
  const [activeTab, setActiveTab] = useState<'CREATE' | 'JOIN'>('CREATE');
  const [nicknameInput, setNicknameInput] = useState<string>('');
  const [roomCodeInput, setRoomCodeInput] = useState<string>('');
  const [roomPassword, setRoomPassword] = useState<string>('');
  const [rankedRoom, setRankedRoom] = useState<boolean>(true);
  const [publicListing, setPublicListing] = useState<boolean>(true);
  const [showOfferHistory, setShowOfferHistory] = useState<boolean>(true);
  const [publicRooms, setPublicRooms] = useState<PublicDuelRoomSummary[]>([]);
  const [publicRoomsLoading, setPublicRoomsLoading] = useState<boolean>(false);
  const [confirmDiscard, setConfirmDiscard] = useState<boolean>(false);
  const [showLiveLogs, setShowLiveLogs] = useState<boolean>(false);

  // Pre-fill room code if provided in URL (explicit click still required to join)
  useEffect(() => {
    if (urlRoomCode) {
      setRoomCodeInput(urlRoomCode);
      setActiveTab('JOIN');
    }
  }, [urlRoomCode]);

  const loadPublicRooms = useCallback(async (signal?: AbortSignal) => {
    setPublicRoomsLoading(true);
    try {
      setPublicRooms(await fetchPublicDuelRooms(signal));
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

  // A room theme is cosmetic but authoritative for everyone in the room.
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

  const settingsDialogRef = useRef<HTMLDialogElement | null>(null);
  const leaveDialogRef = useRef<HTMLDialogElement | null>(null);
  useModalLifecycle(leaveDialogRef, isLeaveModalOpen);

  // Nickname Unicode length validation (max 16 characters)
  const handleNicknameChange = (val: string) => {
    const chars = Array.from(val);
    if (chars.length <= 16) {
      setNicknameInput(val);
    }
  };

  // Handle room creation
  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = Array.from(nicknameInput.trim()).slice(0, 16).join('');
    await createRoom(trimmed, roomPassword.trim() || undefined, rankedRoom, publicListing, theme, showOfferHistory);
  };

  // Handle room joining
  const handleJoinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedCode = roomCodeInput.trim();
    if (!trimmedCode) return;
    const trimmedNick = Array.from(nicknameInput.trim()).slice(0, 16).join('');
    await joinRoom(trimmedCode, trimmedNick, roomPassword.trim() || undefined);
  };

  // Leave click handler
  const handleLeaveClick = () => {
    const phase = presentation.phase;
    const isActiveMatch = phase !== 'WAITING' && phase !== 'FINISHED';
    if (isActiveMatch) {
      // Must prompt confirmation for active match forfeit
      setIsLeaveModalOpen(true);
    } else {
      leaveRoom(false);
    }
  };

  const handleConfirmLeave = async () => {
    setIsLeaveModalOpen(false);
    await leaveRoom(true);
  };

  // Reconnect then cleanly exit to forfeit and settle opponent
  const handleReconnectAndSurrender = async () => {
    const connected = await reconnectStoredSession();
    if (connected) {
      await leaveRoom(true);
    }
  };

  // Stage3D interaction rule:
  // Banker is always disabled; Challenger only interacts during SELECTING or OPENING
  const isChallenger = myRole === 'CHALLENGER';
  const canInteractStage =
    isChallenger &&
    !isPending &&
    (presentation.phase === 'SELECTING' || presentation.phase === 'OPENING');

  const canAct =
    connectionStatus === 'connected' &&
    !isPending &&
    presentation.openingBoxId === null;

  // Challenger label: unified "挑战者的箱子" or "<challengerNickname>的箱子", avoiding banker misleading "我的箱子"
  const challengerNickname =
    publicState?.seats.find((s) => s.role === 'CHALLENGER')?.nickname;
  const playerBoxLabel = challengerNickname
    ? msg('auction.challengerBoxNamed', { name: challengerNickname })
    : msg('auction.challengerBox');

  // Identify the other remaining unopened box for FINAL_SWAP
  const remainingSwapBoxId = useMemo(() => {
    if (presentation.phase !== 'FINAL_SWAP' || presentation.playerBoxId === null) {
      return null;
    }
    const otherBox = presentation.boxes.find(
      (b) => !b.isOpened && b.id !== presentation.playerBoxId
    );
    return otherBox?.id ?? null;
  }, [presentation.phase, presentation.playerBoxId, presentation.boxes]);

  // Is game active (for PWA controls), strictly derived from authoritative server phase
  const authPhase = authority?.public?.phase;
  const isActiveGame = authPhase
    ? authPhase !== 'WAITING' && authPhase !== 'FINISHED'
    : presentation.phase !== 'WAITING' && presentation.phase !== 'FINISHED';

  // Check room conflict with stored session (case-sensitive raw comparison)
  const hasRoomConflict =
    hasStoredSession &&
    storedSession &&
    urlRoomCode &&
    storedSession.roomId !== urlRoomCode;

  return (
    <div className={`duel-app-container${screenShakeActive ? ' screen-shake-active' : ''}`}>
      {/* PWA Update Notice */}
      <PwaNotice onOpenSettings={() => setIsSettingsOpen(true)} />

      {/* 1. ENTRANCE & ROOM CONFLICT OVERLAY */}
      {!publicState && (
        <div className="duel-entrance-overlay">
          <div className="duel-card" role="region" aria-label={msg('duel.entrance.aria')}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <div className="duel-title">
                <Users size={28} color="#f59e0b" />
                <span>{msg('duel.entrance.title')}</span>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  onClick={() => setIsHistoryOpen(true)}
                  className="btn-secondary"
                  style={{ minHeight: '38px', padding: '6px 12px', fontSize: '0.85rem', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                >
                  <History size={16} />
                  <span>{msg('duel.entrance.history')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => window.location.assign('/')}
                  className="btn-secondary"
                  style={{ minHeight: '38px', padding: '6px 12px', fontSize: '0.85rem', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                >
                  <Home size={16} />
                  <span>{msg('duel.entrance.lobby')}</span>
                </button>
              </div>
            </div>

            <div className="duel-subtitle">
              {msg('duel.entrance.subtitle')}<br />
              {msg('duel.entrance.subtitle2')}
            </div>
            <p role="note" style={{ margin: '0 0 16px', color: '#94a3b8', fontSize: '0.78rem', lineHeight: 1.5 }}>
              {msg('duel.entrance.virtualScore')}
            </p>

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
                  <span>{msg('duel.entrance.conflictTitle')}</span>
                </div>
                <div style={{ fontSize: '0.85rem', color: '#d1d5db', lineHeight: 1.5, marginBottom: '12px' }}>
                  {msg('duel.entrance.conflictBody', { stored: storedSession?.roomId || '', invited: urlRoomCode })}
                </div>
                {confirmDiscard ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <span style={{ fontSize: '0.8rem', color: '#f87171' }}>
                      {msg('duel.entrance.discardWarning')}
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
                        {msg('duel.entrance.discardLocal')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDiscard(false)}
                        className="btn-secondary"
                        style={{ minHeight: '36px', padding: '4px 14px', fontSize: '0.8rem' }}
                      >
                        {msg('duel.entrance.cancel')}
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
                      {msg('duel.entrance.recoverOriginal')}
                    </button>
                    <button
                      type="button"
                      onClick={handleReconnectAndSurrender}
                      className="btn-secondary"
                      style={{ minHeight: '38px', padding: '6px 14px', fontSize: '0.85rem', color: '#fca5a5' }}
                      title={msg('duel.entrance.recoverThenLeave')}
                    >
                      {msg('duel.entrance.recoverThenLeave')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDiscard(true)}
                      className="btn-secondary"
                      style={{ minHeight: '38px', padding: '6px 14px', fontSize: '0.85rem' }}
                    >
                      {msg('duel.entrance.discardOriginal')}
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
                  <div style={{ fontWeight: 800, color: '#6ee7b7' }}>{msg('duel.entrance.activeTitle')}</div>
                  <div style={{ fontSize: '0.8rem', color: '#d1d5db' }}>{msg('duel.entrance.roomNumber', { room: storedSession?.roomId || '' })}</div>
                </div>
                {confirmDiscard ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <span style={{ fontSize: '0.8rem', color: '#f87171' }}>
                    {msg('duel.entrance.clearWarning')}
                    </span>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        type="button"
                        onClick={() => {
                          discardStoredSession();
                          setConfirmDiscard(false);
                        }}
                        className="duel-action-btn reject"
                        style={{ minHeight: '34px', padding: '4px 12px', fontSize: '0.8rem' }}
                      >
                      {msg('duel.entrance.clear')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDiscard(false)}
                        className="btn-secondary"
                        style={{ minHeight: '34px', padding: '4px 12px', fontSize: '0.8rem' }}
                      >
                      {msg('duel.entrance.cancel')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      onClick={reconnectStoredSession}
                      className="duel-action-btn accept"
                      style={{ minHeight: '38px', padding: '6px 16px', fontSize: '0.85rem' }}
                    >
                      {msg('duel.entrance.recover')}
                    </button>
                    <button
                      type="button"
                      onClick={handleReconnectAndSurrender}
                      className="btn-secondary"
                      style={{ minHeight: '38px', padding: '6px 12px', fontSize: '0.85rem', color: '#fca5a5' }}
                      title={msg('duel.entrance.recoverThenLeave')}
                    >
                      {msg('duel.entrance.recoverThenLeave')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDiscard(true)}
                      className="btn-secondary"
                      style={{ minHeight: '38px', padding: '6px 12px', fontSize: '0.85rem' }}
                    >
                      {msg('duel.entrance.clear')}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Error notice */}
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
              <label htmlFor="duel-nickname-input" className="duel-input-label">
                {msg('duel.entrance.nickname')}
              </label>
              <input
                id="duel-nickname-input"
                type="text"
                value={nicknameInput}
                onChange={(e) => handleNicknameChange(e.target.value)}
                placeholder={msg('duel.entrance.nicknamePlaceholder')}
                className="duel-input"
                maxLength={32}
              />
            </div>

            <div className="duel-input-group">
              <label htmlFor="duel-theme-select" className="duel-input-label">{msg('duel.entrance.theme')}</label>
              <select id="duel-theme-select" value={theme} onChange={(e) => setTheme(e.target.value as typeof theme)} className="duel-input">
                {availableThemes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </div>

            {/* Tabs: Create vs Join */}
            <div className="duel-tabs">
              <button
                type="button"
                className={`duel-tab-btn ${activeTab === 'CREATE' ? 'active' : ''}`}
                onClick={() => setActiveTab('CREATE')}
              >
                {msg('duel.entrance.createTab')}
              </button>
              <button
                type="button"
                className={`duel-tab-btn ${activeTab === 'JOIN' ? 'active' : ''}`}
                onClick={() => setActiveTab('JOIN')}
              >
                {msg('duel.entrance.joinTab')}
              </button>
            </div>

            {activeTab === 'CREATE' ? (
              <form onSubmit={handleCreateSubmit}>
                <div className="duel-input-group" style={{ marginBottom: '14px' }}>
                  <label htmlFor="duel-room-password-create" className="duel-input-label">
                    {msg('duel.entrance.passwordCreate')}
                  </label>
                  <input
                    id="duel-room-password-create"
                    type="password"
                    value={roomPassword}
                    onChange={(e) => setRoomPassword(e.target.value.slice(0, 64))}
                    minLength={roomPassword.length > 0 ? 4 : undefined}
                    maxLength={64}
                    autoComplete="new-password"
                    className="duel-input"
                  />
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px', color: '#cbd5e1', fontSize: '0.9rem' }}>
                  <input type="checkbox" checked={rankedRoom} onChange={(e) => setRankedRoom(e.target.checked)} disabled={Boolean(roomPassword.trim())} />
                  {msg('duel.entrance.ranked')}
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px', color: '#cbd5e1', fontSize: '0.9rem' }}>
                  <input type="checkbox" checked={publicListing} onChange={(e) => setPublicListing(e.target.checked)} disabled={Boolean(roomPassword.trim())} />
                  {msg('duel.entrance.publicListing')}
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px', color: '#cbd5e1', fontSize: '0.9rem' }}>
                  <input type="checkbox" checked={showOfferHistory} onChange={(e) => setShowOfferHistory(e.target.checked)} />
                  {msg('duel.entrance.offerHistory')}
                </label>
                <button
                  type="submit"
                  disabled={connectionStatus === 'connecting'}
                  className="duel-action-btn btn-primary"
                  style={{ width: '100%' }}
                >
                  {connectionStatus === 'connecting' ? msg('duel.entrance.creating') : msg('duel.entrance.create')}
                </button>
              </form>
            ) : (
              <form onSubmit={handleJoinSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div className="duel-input-group" style={{ margin: 0 }}>
                  <label htmlFor="duel-roomcode-input" className="duel-input-label">
                    {msg('duel.entrance.roomCode')}
                  </label>
                  <input
                    id="duel-roomcode-input"
                    type="text"
                    value={roomCodeInput}
                    onChange={(e) => setRoomCodeInput(e.target.value.trim())}
                    placeholder={msg('duel.entrance.roomCodePlaceholder')}
                    className="duel-input"
                    required
                  />
                </div>
                <div className="duel-input-group" style={{ margin: 0 }}>
                  <label htmlFor="duel-room-password-join" className="duel-input-label">
                    {msg('duel.entrance.passwordJoin')}
                  </label>
                  <input
                    id="duel-room-password-join"
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
                  disabled={connectionStatus === 'connecting' || !roomCodeInput.trim()}
                  className="duel-action-btn btn-primary"
                  style={{ width: '100%' }}
                >
                  {connectionStatus === 'connecting' ? msg('duel.entrance.joining') : msg('duel.entrance.join')}
                </button>
              </form>
            )}

            <section aria-label={msg('duel.entrance.publicRoomsAria')} style={{ marginTop: '18px', paddingTop: '16px', borderTop: '1px solid rgba(255,255,255,.1)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', marginBottom: '10px' }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: '1rem', color: '#fcd34d' }}>{msg('duel.entrance.publicRooms')}</h2>
                  <p style={{ margin: '4px 0 0', color: '#94a3b8', fontSize: '.78rem' }}>{msg('duel.entrance.publicDescription')}</p>
                </div>
                <button type="button" className="btn-secondary" onClick={() => void loadPublicRooms()} disabled={publicRoomsLoading} style={{ minHeight: '36px', padding: '5px 10px', fontSize: '.78rem' }}>
                  <RefreshCw size={14} className={publicRoomsLoading ? 'spin' : undefined} /> {msg('duel.entrance.refresh')}
                </button>
              </div>
              {publicRooms.length === 0 ? (
                <div style={{ padding: '12px', borderRadius: '10px', background: 'rgba(255,255,255,.04)', color: '#94a3b8', fontSize: '.82rem' }}>
                  {publicRoomsLoading ? msg('duel.entrance.publicLoading') : msg('duel.entrance.noPublic')}
                </div>
              ) : (
                <div style={{ display: 'grid', gap: '8px' }}>
                  {publicRooms.map((room) => (
                    <div key={room.roomId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', padding: '10px 12px', borderRadius: '10px', background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.1)' }}>
                      <div style={{ minWidth: 0 }}>
                        <strong style={{ color: '#fff' }}>{room.roomId}</strong>
                        <span style={{ marginLeft: '8px', color: '#94a3b8', fontSize: '.78rem' }}>{msg('duel.entrance.roomSummary', { players: room.players, maxPlayers: room.maxPlayers, ranked: room.ranked ? msg('duel.entrance.rankedLabel') : msg('duel.entrance.casualLabel'), theme: room.themeId === 'starry-neon' ? msg('duel.entrance.starryTheme') : msg('duel.entrance.classicTheme'), history: room.showOfferHistory === false ? msg('duel.entrance.hiddenHistory') : '', password: room.passwordRequired ? msg('duel.entrance.passwordRequired') : '' })}</span>
                      </div>
                      <button type="button" className="btn-secondary" onClick={() => { setRoomCodeInput(room.roomId); setActiveTab('JOIN'); }} style={{ minHeight: '36px', padding: '5px 12px', fontSize: '.78rem', whiteSpace: 'nowrap' }}>{msg('duel.entrance.fillRoom')}</button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      )}

      {/* 2. WAITING ROOM VIEW */}
      {publicState && presentation.phase === 'WAITING' && (
        <DuelWaitingLobby
          publicState={publicState}
          privateState={privateState}
          onReady={(ready) => sendCommand('READY', { ready })}
          onStart={() => sendCommand('START')}
          onLeave={handleLeaveClick}
          isPending={isPending}
        />
      )}

      {/* 3. ACTIVE IN-GAME VIEW */}
      {publicState && presentation.phase !== 'WAITING' && (
        <>
          {/* Header */}
          <DuelHeader
            publicState={publicState}
            privateState={privateState}
            presentedSeats={presentation.seats}
            serverTimeOffset={serverTimeOffset}
            latencyMs={latencyMs}
            connectionStatus={connectionStatus}
            soundEnabled={preferences.sound}
            onOpenSettings={() => setIsSettingsOpen(true)}
            onLeaveClick={handleLeaveClick}
            onRetryConnect={reconnectStoredSession}
          />

          {/* Error Banner in game if any */}
          {error && (
            <div
              style={{
                position: 'absolute',
                top: '60px',
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: 40,
                background: 'rgba(239, 68, 68, 0.9)',
                color: '#ffffff',
                padding: '8px 16px',
                borderRadius: '10px',
                fontSize: '0.85rem',
                fontWeight: 700,
                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5)',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <span>{error}</span>
              <button
                type="button"
                onClick={clearError}
                style={{ background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>
          )}

          {/* Main Stage & Money Ladders */}
          <main className="duel-stage-wrapper" role="main" aria-label={msg('duel.entrance.stageAria')}>
            {/* Left Column: Low Tier Ladder */}
            <div className="duel-ladder-col" aria-label={msg('duel.entrance.lowLadderAria')}>
              <LowMoneyLadder
                boxes={presentation.boxes}
                playerBoxId={presentation.playerBoxId}
              />
            </div>

            {/* Center: Stage3D */}
            <div className="duel-stage-center">
              <React.Suspense
                fallback={
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      height: '100%',
                      color: '#fcd34d',
                      fontSize: '1rem',
                      fontWeight: 700,
                    }}
                  >
                    {msg('duel.entrance.stageLoading')}
                  </div>
                }
              >
                <Stage3D
                  key={`${presentation.matchId}:${presentation.roundIndex}:${presentation.epoch}`}
                  boxes={presentation.boxes}
                  playerBoxId={presentation.playerBoxId}
                  phase={mapDuelPhaseToUIPhase(presentation.phase)}
                  onBoxClick={handleBoxClick}
                  onBoxAnimationComplete={(boxId) => {
                    handleBoxAnimationComplete(
                      boxId,
                      presentation.epoch,
                      presentation.roundIndex,
                      presentation.matchId
                    );
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
                  onPerformance={() => {}}
                  onFpsWindow={handleFpsWindow}
                  canInteract={canInteractStage}
                  playerBoxLabel={playerBoxLabel}
                />
              </React.Suspense>
            </div>

            {/* Right Column: High Tier Ladder */}
            <div className="duel-ladder-col" aria-label={msg('duel.entrance.highLadderAria')}>
              <HighMoneyLadder
                boxes={presentation.boxes}
                playerBoxId={presentation.playerBoxId}
              />
            </div>
          </main>

          {/* Compact Live History & Offer Log Area */}
          <div style={{ width: '100%', maxWidth: '720px', margin: '0 auto', padding: '0 12px' }}>
            <button
              type="button"
              onClick={() => setShowLiveLogs(!showLiveLogs)}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#9ca3af',
                fontSize: '0.8rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '4px 8px',
                margin: '0 auto',
              }}
            >
              <History size={14} />
              <span>{showLiveLogs ? msg('duel.entrance.logsOpen') : msg('duel.entrance.logsClosed', { count: presentation.offerHistory.length })}</span>
            </button>

            {showLiveLogs && (
              <div
                style={{
                  background: 'rgba(0, 0, 0, 0.45)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: '10px',
                  padding: '8px 12px',
                  maxHeight: '120px',
                  overflowY: 'auto',
                  fontSize: '0.75rem',
                  color: '#d1d5db',
                  marginTop: '4px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                }}
              >
                {presentation.offerHistory.length === 0 ? (
                  <div style={{ color: '#6b7280' }}>{msg('duel.entrance.noOffers')}</div>
                ) : (
                  presentation.offerHistory.map((entry, idx) => (
                    <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>
	                        {msg('duel.entrance.offerLog', { roundIndex: entry.roundIndex, round: entry.round })}
                      </span>
                      <span style={{ fontWeight: 700, color: entry.outcome === 'ACCEPTED' ? '#34d399' : '#fcd34d' }}>
	                        {formatMoney(entry.amount)} {entry.outcome === 'ACCEPTED' ? `(${msg('duel.entrance.accepted')})` : entry.outcome === 'EXPIRED' ? `(${msg('duel.entrance.expired')})` : `(${msg('duel.entrance.rejected')})`}
                      </span>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Bottom Action Dock */}
          <DuelActionPanel
            phase={presentation.phase}
            boxRound={presentation.boxRound}
            boxesLeftToOpenThisRound={presentation.boxesLeftToOpenThisRound}
            playerBoxId={presentation.playerBoxId}
            remainingSwapBoxId={remainingSwapBoxId}
            currentOffer={presentation.currentOffer}
            privateState={privateState}
            seats={presentation.seats ?? publicState.seats}
            roundResults={presentation.roundResults}
            roundIndex={presentation.roundIndex}
            confirmDealPref={preferences.confirmDeal}
            isPending={isPending}
            canAct={canAct}
            serverTimeOffset={serverTimeOffset}
            onSubmitOffer={(amount) => sendCommand('SUBMIT_OFFER', { amount })}
            onAcceptOffer={(offerId) => sendCommand('ACCEPT_OFFER', { offerId })}
            onRejectOffer={(offerId) => sendCommand('REJECT_OFFER', { offerId })}
            onKeepBox={() => sendCommand('KEEP_BOX')}
            onSwapBox={(targetBoxId) => sendCommand('SWAP_BOX', { targetBoxId })}
            onContinueRound={() => sendCommand('CONTINUE_ROUND')}
          />
        </>
      )}

      {/* 4. FINISHED MODAL */}
      {publicState && presentation.phase === 'FINISHED' && presentation.result && (
        <DuelFinishedModal
          result={presentation.result}
          seats={presentation.seats ?? publicState.seats}
          mySeatId={mySeatId}
          onReturnToLobby={() => leaveRoom(false)}
        />
      )}

      {/* 5. CONFIRM LEAVE FORFEIT MODAL */}
      <dialog
        ref={leaveDialogRef}
        className="duel-native-dialog"
        aria-labelledby="leave-modal-title"
        onCancel={(e) => {
          e.preventDefault();
          setIsLeaveModalOpen(false);
        }}
      >
        <div className="duel-modal-panel">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#ef4444', marginBottom: '12px' }}>
            <AlertTriangle size={24} />
            <h3 id="leave-modal-title" style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800 }}>
              {msg('duel.entrance.leaveTitle')}
            </h3>
          </div>
          <p style={{ fontSize: '0.95rem', color: '#fca5a5', lineHeight: 1.5, marginBottom: '20px' }}>
            {msg('duel.entrance.leaveBody')}
          </p>
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={() => setIsLeaveModalOpen(false)}
              className="btn-secondary"
              style={{ minHeight: '44px', padding: '8px 18px' }}
            >
              {msg('duel.entrance.stay')}
            </button>
            <button
              type="button"
              onClick={handleConfirmLeave}
              className="duel-action-btn reject"
              style={{ minHeight: '44px', padding: '8px 22px' }}
            >
              {msg('duel.entrance.confirmLeave')}
            </button>
          </div>
        </div>
      </dialog>

      {/* 6. SETTINGS DIALOG */}
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
        isGameOver={!isActiveGame}
        phase="DUEL"
        theme={theme}
        onSelectTheme={setTheme}
      />

      {/* 7. HISTORY MODAL */}
      <HistoryModal
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
      />
    </div>
  );
}
export default DuelApp;
