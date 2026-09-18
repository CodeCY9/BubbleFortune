import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Client, Room } from 'colyseus.js';
import type { DuelActionType, DuelClientSnapshot } from '../packages/protocol/src/duel';
import type { SurvivorActionType, SurvivorClientSnapshot, SurvivorPublicSnapshot } from '../packages/protocol/src/survivor';
import type {
  TournamentClientSnapshot,
  TournamentCommandResult,
  TournamentPublicSnapshot,
  TournamentFormat,
  TournamentSize
} from '../packages/protocol/src/tournament';
import { ensureDuelGuestSession } from './api/duel';
import { formatMoney } from './types/game';
import { InviteQr } from './components/InviteQr';
import { fetchTournamentReplay, fetchTournamentRooms, type TournamentReplaySummary, type TournamentRoomSummary } from './api/tournament';
import { PwaControls } from './components/PwaControls';
import { FullscreenToggle } from './components/FullscreenToggle';
import { SettingsDialog } from './components/SettingsDialog';
import { ShareControls } from './components/ShareControls';
import { ReplayViewer } from './components/ReplayViewer';
import { MultiplayerStage3D } from './components/MultiplayerStage3D';
import { useTheme } from './themes';
import { usePreferences } from './hooks/usePreferences';
import { useDialog } from './hooks/useDialog';
import { getLanguage, translate, translateTournament, useLanguage, type TournamentMessageKey } from './i18n';
import { ArrowLeft, Award, Sparkles, Trophy, Users, Eye, RefreshCw, Settings } from 'lucide-react';
import './components/MultiplayerLobbyHub.css';

const TOURNAMENT_SESSION_KEY = 'bf-tournament-reconnect';

function wsEndpoint(): string {
  if (typeof window === 'undefined') return 'ws://127.0.0.1:2567/game';
  return `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/game`;
}

type TournamentSnapshot = TournamentClientSnapshot | { public: TournamentPublicSnapshot };

export function TournamentApp() {
  const { preferences, effectiveQuality, effectiveReducedMotion, updatePreference, resetPreferences } = usePreferences();
  const { dialogRef, isOpen, openDialog, closeDialog, handleCancel } = useDialog();
  const { theme, setTheme, availableThemes } = useTheme(effectiveQuality);
  const language = useLanguage();
  const tm = (key: TournamentMessageKey, replacements: Record<string, string | number> = {}) =>
    Object.entries(replacements).reduce(
      (text, [name, value]) => text.replace(new RegExp(`\\{${name}\\}`, 'g'), String(value)),
      translateTournament(key, language),
    );
  const [room, setRoom] = useState<Room | null>(null);
  const roomRef = useRef<Room | null>(null);
  const [snapshot, setSnapshot] = useState<TournamentSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nickname, setNickname] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [roomPassword, setRoomPassword] = useState('');
  const [size, setSize] = useState<TournamentSize>(8);
  const [format, setFormat] = useState<TournamentFormat>('duel');
  const [allowSpectators, setAllowSpectators] = useState(true);
  const [allowEmotes, setAllowEmotes] = useState(true);
  const [ranked, setRanked] = useState(true);
  const [spectator, setSpectator] = useState(false);
  const [publicRooms, setPublicRooms] = useState<TournamentRoomSummary[]>([]);
  const [publicRoomsLoading, setPublicRoomsLoading] = useState(false);
  const [offerAmount, setOfferAmount] = useState('');
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [replay, setReplay] = useState<TournamentReplaySummary | null>(null);
  const [replayError, setReplayError] = useState<string | null>(null);
  const sequenceRef = useRef(0);
  const clientRef = useRef<Client | null>(null);
  const reconnectingRef = useRef(false);
  const intentionalLeaveRef = useRef(false);
  const [reconnecting, setReconnecting] = useState(false);

  const publicState = snapshot?.public;
  const privateState = 'private' in (snapshot || {}) ? (snapshot as TournamentClientSnapshot).private : null;
  const activeMatch = privateState?.activeMatch ?? null;
  const activeDuel = activeMatch && 'public' in activeMatch && activeMatch.public.ruleVersion === 'duel-26-v1' ? activeMatch as DuelClientSnapshot : null;
  const activeSurvivor = activeMatch && 'public' in activeMatch && activeMatch.public.ruleVersion === 'survivor-26-v1' ? activeMatch as SurvivorClientSnapshot : null;
  const publicActiveMatch = publicState ? publicState.rounds.flatMap((round) => round.matches).find((match) => match.matchId === publicState.activeMatchId) ?? null : null;
  const loadReplay = async () => {
    if (!publicState) return;
    const result = await fetchTournamentReplay(publicState.tournamentId);
    if (result.ok && result.data) { setReplay(result.data); setReplayError(null); } else setReplayError(result.error?.message || translateTournament('replayError', language));
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room');
    const isSpectator = params.get('spectator') === '1';
    if (roomParam) setRoomCode(roomParam);
    if (isSpectator) setSpectator(true);
  }, []);

  const loadPublicRooms = useCallback(async (signal?: AbortSignal) => {
    setPublicRoomsLoading(true);
    try {
      const result = await fetchTournamentRooms(signal);
      if (result.ok && result.data) setPublicRooms(result.data.items);
      else if (!signal?.aborted) setPublicRooms([]);
    } catch {
      if (!signal?.aborted) setPublicRooms([]);
    } finally {
      if (!signal?.aborted) setPublicRoomsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (room || publicState) return;
    const controller = new AbortController();
    void loadPublicRooms(controller.signal);
    return () => controller.abort();
  }, [loadPublicRooms, publicState, room]);

  useEffect(() => {
    const roomTheme = publicState?.themeId;
    if (roomTheme && roomTheme !== theme) {
      setTheme(roomTheme as typeof theme);
    }
  }, [publicState?.themeId, setTheme, theme]);

  const attach = useCallback((nextRoom: Room) => {
    roomRef.current = nextRoom;
    setRoom(nextRoom);
    if (nextRoom.reconnectionToken) sessionStorage.setItem(TOURNAMENT_SESSION_KEY, nextRoom.reconnectionToken);
    const applySnapshot = (next: TournamentSnapshot) => {
      if ('private' in next && next.private.seatId !== null) {
        sequenceRef.current = Math.max(sequenceRef.current, next.private.lastCommandSequence);
      }
      setSnapshot((previous) => {
        if (previous && next.public.tournamentId === previous.public.tournamentId && next.public.stateVersion < previous.public.stateVersion) {
          return previous;
        }
        return next;
      });
      if (next.public.phase === 'FINISHED') sessionStorage.removeItem(TOURNAMENT_SESSION_KEY);
    };
    nextRoom.onMessage('snapshot', (next: TournamentSnapshot) => {
      applySnapshot(next);
    });
    nextRoom.onMessage('command_result', (result: TournamentCommandResult) => {
      if (!result.success) setError(result.error?.message || translateTournament('errorCommand', language));
      if (result.snapshot) applySnapshot(result.snapshot);
    });
    nextRoom.onMessage('pong', (pong: { sentAt?: number }) => {
      if (typeof pong?.sentAt === 'number') setLatencyMs(Math.max(0, Date.now() - pong.sentAt));
    });
    nextRoom.onLeave(() => {
      roomRef.current = null;
      setRoom(null);
      if (intentionalLeaveRef.current) {
        intentionalLeaveRef.current = false;
        sessionStorage.removeItem(TOURNAMENT_SESSION_KEY);
        setSnapshot(null);
        setError(translateTournament('left', language));
        return;
      }
      const token = sessionStorage.getItem(TOURNAMENT_SESSION_KEY);
      if (!token || reconnectingRef.current || !clientRef.current) {
        setError(translateTournament('left', language));
        return;
      }
      reconnectingRef.current = true;
      setReconnecting(true);
      setError(translateTournament('disconnected', language));
      void clientRef.current.reconnect(token).then((reconnected) => {
        reconnectingRef.current = false;
        setReconnecting(false);
        setError(null);
        attach(reconnected);
      }).catch(() => {
        reconnectingRef.current = false;
        setReconnecting(false);
        setError(translateTournament('restoreFailed', language));
      });
    });
  }, [language]);

  useEffect(() => {
    const token = sessionStorage.getItem(TOURNAMENT_SESSION_KEY);
    if (!token || roomRef.current) return;
    clientRef.current = clientRef.current || new Client(wsEndpoint());
    reconnectingRef.current = true;
    setReconnecting(true);
    setError(translateTournament('restoring', language));
    void clientRef.current.reconnect(token).then((nextRoom) => {
      reconnectingRef.current = false;
      setReconnecting(false);
      setError(null);
      attach(nextRoom);
    }).catch(() => {
      reconnectingRef.current = false;
      setReconnecting(false);
      sessionStorage.removeItem(TOURNAMENT_SESSION_KEY);
      setError(null);
    });
  }, [attach]);

  useEffect(() => {
    if (!room) return;
    const timer = window.setInterval(() => room.send('ping', { sentAt: Date.now() }), 5000);
    return () => window.clearInterval(timer);
  }, [room]);

  useEffect(() => () => {
    intentionalLeaveRef.current = true;
    try { roomRef.current?.leave(false); } catch { /* ignore */ }
    roomRef.current = null;
  }, []);

  const connect = async (mode: 'create' | 'join') => {
    setError(null);
    try {
      if (!spectator) await ensureDuelGuestSession();
      const client = clientRef.current || new Client(wsEndpoint());
      clientRef.current = client;
      const trimmedNickname = Array.from(nickname.trim()).slice(0, 16).join('');
      const nextRoom = mode === 'create'
        ? await client.create('tournament_26', {
            size,
            format,
            nickname: trimmedNickname,
            allowSpectators,
            allowEmotes,
            ranked: roomPassword.trim() ? false : ranked,
            isPrivate: Boolean(roomPassword.trim()),
            themeId: theme,
            password: roomPassword.trim() || undefined,
          })
        : await client.joinById(roomCode.trim(), {
            nickname: trimmedNickname,
            isSpectator: spectator,
            password: roomPassword.trim() || undefined,
          });
      attach(nextRoom);
    } catch (cause: any) {
      const message = cause?.message?.includes('Invalid room password')
        ? translateTournament('badPassword', language)
        : cause?.message?.includes('Tournament room passwords require')
          ? translateTournament('passwordShort', language)
          : cause?.message || translateTournament('joinFailed', language);
      setError(message);
    }
  };

  const sendCommand = (payload: Record<string, unknown>) => {
    if (!room || !publicState || !('private' in (snapshot || {}))) return;
    const command = {
      ...payload,
      tournamentId: publicState.tournamentId,
      stateVersion: publicState.stateVersion,
      commandSequence: ++sequenceRef.current,
      idempotencyKey: crypto.randomUUID()
    };
    room.send('command', command);
  };

  const sendDuelCommand = (type: DuelActionType, extra: Record<string, unknown> = {}) => {
    if (!room || !publicState || !activeDuel || !privateState || privateState.seatId === null) return;
    if (!privateState.allowedActions.includes('MATCH_COMMAND')) return;
    const duel = activeDuel.public;
    const duelPrivate = activeDuel.private;
    room.send('command', {
      type: 'MATCH_COMMAND',
      tournamentId: publicState.tournamentId,
      stateVersion: publicState.stateVersion,
      commandSequence: ++sequenceRef.current,
      idempotencyKey: crypto.randomUUID(),
      matchId: duel.matchId,
      duelCommand: {
        type,
        matchId: duel.matchId,
        roomId: duel.roomId,
        stateVersion: duel.stateVersion,
        commandSequence: duelPrivate.lastCommandSequence + 1,
        idempotencyKey: crypto.randomUUID(),
        ...extra
      }
    });
  };

  const sendSurvivorCommand = (type: SurvivorActionType, extra: Record<string, unknown> = {}) => {
    if (!room || !publicState || !activeSurvivor || !privateState || privateState.seatId === null) return;
    if (!privateState.allowedActions.includes('MATCH_COMMAND')) return;
    const survivor = activeSurvivor.public;
    const survivorPrivate = activeSurvivor.private;
    room.send('command', {
      type: 'MATCH_COMMAND',
      tournamentId: publicState.tournamentId,
      stateVersion: publicState.stateVersion,
      commandSequence: ++sequenceRef.current,
      idempotencyKey: crypto.randomUUID(),
      matchId: survivor.matchId,
      survivorCommand: {
        type,
        matchId: survivor.matchId,
        stateVersion: survivor.stateVersion,
        commandSequence: survivorPrivate.lastCommandSequence + 1,
        idempotencyKey: crypto.randomUUID(),
        ...extra
      }
    });
  };

  const myDuelRole = useMemo(() => {
    if (!activeDuel || privateState?.seatId === null || privateState?.seatId === undefined) return null;
    return activeDuel.public.seats[privateState.seatId as 0 | 1]?.role ?? null;
  }, [activeDuel, privateState?.seatId]);

  if (!room || !publicState) {
    return (
      <div className="multiplayer-hub-viewport">
        <div className="multiplayer-hub-inner">
          {/* 顶部大厅导航栏 */}
          <header className="multiplayer-hub-header">
            <div className="multiplayer-hub-title-group">
              <div
                className="multiplayer-hub-icon-wrap"
                style={{ background: 'rgba(129, 140, 248, 0.2)', color: '#a5b4fc' }}
              >
                <Award size={26} />
              </div>
              <div>
                <h1 className="multiplayer-hub-title-text">
                  <span>{translateTournament('title', language)}</span>
                  <span style={{ fontSize: '0.72rem', padding: '2px 8px', borderRadius: 8, background: 'rgba(129,140,248,0.25)', color: '#c7d2fe' }}>
                    天梯巡回淘汰赛
                  </span>
                </h1>
                <div className="multiplayer-hub-desc">{translateTournament('intro', language)}</div>
              </div>
            </div>

            <div className="multiplayer-hub-header-actions">
              <FullscreenToggle compact />
              <button
                type="button"
                onClick={openDialog}
                className="lobby-quick-btn"
                aria-label={translate('settings.title', language)}
              >
                <Settings size={16} color="#fcd34d" />
                <span>{translate('settings.title', language)}</span>
              </button>
              <button
                type="button"
                onClick={() => window.location.assign('/')}
                className="app-shell-back-btn"
              >
                <ArrowLeft size={16} />
                <span>返回大厅</span>
              </button>
            </div>
          </header>

          {error && (
            <div role="alert" style={{ padding: '12px 16px', borderRadius: 12, background: 'rgba(239,68,68,0.18)', border: '1px solid rgba(239,68,68,0.4)', color: '#fca5a5', fontSize: '0.9rem' }}>
              {error}
            </div>
          )}

          {/* 双栏核心筹备区 */}
          <div className="multiplayer-hub-grid">
            {/* 左栏：创建锦标赛配置 */}
            <section className="multiplayer-hub-card">
              <h2 className="multiplayer-card-title">
                <Trophy size={18} />
                <span>创建锦标赛</span>
              </h2>

              <div className="multiplayer-form-field">
                <label className="multiplayer-field-label">{translateTournament('nickname', language)}</label>
                <input
                  className="multiplayer-input-styled"
                  value={nickname}
                  onChange={(event) => setNickname(event.target.value)}
                  maxLength={16}
                  placeholder={translateTournament('nicknamePlaceholder', language)}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="multiplayer-form-field">
                  <label className="multiplayer-field-label">{translateTournament('format', language)}</label>
                  <select
                    className="multiplayer-input-styled"
                    value={format}
                    onChange={(event) => setFormat(event.target.value as TournamentFormat)}
                    style={{ cursor: 'pointer' }}
                  >
                    <option value="duel" style={{ background: '#121426' }}>{translateTournament('duel', language)}</option>
                    <option value="survivor" style={{ background: '#121426' }}>{translateTournament('survivor', language)}</option>
                  </select>
                </div>

                <div className="multiplayer-form-field">
                  <label className="multiplayer-field-label">{translateTournament('size', language)}</label>
                  <select
                    className="multiplayer-input-styled"
                    value={size}
                    onChange={(event) => setSize(Number(event.target.value) as TournamentSize)}
                    style={{ cursor: 'pointer' }}
                  >
                    <option value={8} style={{ background: '#121426' }}>{translateTournament('players8', language)}</option>
                    <option value={16} style={{ background: '#121426' }}>{translateTournament('players16', language)}</option>
                    <option value={32} style={{ background: '#121426' }}>{translateTournament('players32', language)}</option>
                  </select>
                </div>
              </div>

              <div className="multiplayer-form-field">
                <label className="multiplayer-field-label">{translateTournament('theme', language)}</label>
                <select
                  className="multiplayer-input-styled"
                  value={theme}
                  onChange={(event) => setTheme(event.target.value as typeof theme)}
                  style={{ cursor: 'pointer' }}
                >
                  {availableThemes.map((item) => (
                    <option key={item.id} value={item.id} style={{ background: '#121426' }}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="multiplayer-toggles-grid">
                <label className={`multiplayer-toggle-card ${allowSpectators ? 'checked' : ''}`}>
                  <input
                    type="checkbox"
                    checked={allowSpectators}
                    onChange={(event) => setAllowSpectators(event.target.checked)}
                    style={{ accentColor: '#f59e0b' }}
                  />
                  <span>{translateTournament('allowSpectators', language)}</span>
                </label>

                <label className={`multiplayer-toggle-card ${allowEmotes ? 'checked' : ''}`}>
                  <input
                    type="checkbox"
                    checked={allowEmotes}
                    onChange={(event) => setAllowEmotes(event.target.checked)}
                    style={{ accentColor: '#f59e0b' }}
                  />
                  <span>{translateTournament('allowEmotes', language)}</span>
                </label>

                <label className={`multiplayer-toggle-card ${ranked && !roomPassword.trim() ? 'checked' : ''}`}>
                  <input
                    type="checkbox"
                    checked={ranked}
                    onChange={(event) => setRanked(event.target.checked)}
                    disabled={Boolean(roomPassword.trim())}
                    style={{ accentColor: '#f59e0b' }}
                  />
                  <span>{translateTournament('ranked', language)}</span>
                </label>
              </div>

              <div className="multiplayer-form-field">
                <label className="multiplayer-field-label">{translateTournament('password', language)}</label>
                <input
                  type="password"
                  className="multiplayer-input-styled"
                  value={roomPassword}
                  onChange={(event) => setRoomPassword(event.target.value.slice(0, 64))}
                  maxLength={64}
                  placeholder="留空为公开赛事，输入设为私密"
                  autoComplete="current-password"
                />
              </div>

              <button
                type="button"
                className="btn-primary"
                onClick={() => connect('create')}
                style={{ minHeight: 46, borderRadius: 12, fontWeight: 800, fontSize: '0.95rem', marginTop: 8 }}
              >
                {translateTournament('create', language)}
              </button>
            </section>

            {/* 右栏：加入指定赛事与公开列表 */}
            <section className="multiplayer-hub-card">
              <h2 className="multiplayer-card-title">
                <Users size={18} />
                <span>加入锦标赛事</span>
              </h2>

              <div className="multiplayer-form-field">
                <label className="multiplayer-field-label">{translateTournament('roomId', language)}</label>
                <div style={{ display: 'flex', gap: 10 }}>
                  <input
                    className="multiplayer-input-styled"
                    value={roomCode}
                    onChange={(event) => setRoomCode(event.target.value)}
                    placeholder={translateTournament('roomId', language)}
                    style={{ flex: 1 }}
                  />
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => connect('join')}
                    disabled={!roomCode.trim()}
                    style={{ minHeight: 42, padding: '8px 20px', borderRadius: 10, fontWeight: 800, whiteSpace: 'nowrap' }}
                  >
                    {translateTournament('join', language)}
                  </button>
                </div>
              </div>

              <label className={`multiplayer-toggle-card ${spectator ? 'checked' : ''}`} style={{ alignSelf: 'flex-start' }}>
                <input
                  type="checkbox"
                  checked={spectator}
                  onChange={() => setSpectator((v) => !v)}
                  style={{ accentColor: '#f59e0b' }}
                />
                <Eye size={15} />
                <span>{spectator ? translateTournament('spectatorOn', language) : translateTournament('spectatorOff', language)}</span>
              </label>

              {/* 公开赛事列表 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <span style={{ fontSize: '0.85rem', fontWeight: 800, color: '#fcd34d' }}>
                      {translateTournament('publicTitle', language)}
                    </span>
                    <span style={{ fontSize: '0.75rem', color: '#9ca3af', marginLeft: 8 }}>
                      {translateTournament('publicIntro', language)}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => void loadPublicRooms()}
                    disabled={publicRoomsLoading}
                    className="lobby-quick-btn"
                    style={{ minHeight: 32, padding: '4px 10px', fontSize: '0.75rem' }}
                  >
                    <RefreshCw size={12} className={publicRoomsLoading ? 'spin' : ''} />
                    <span>{publicRoomsLoading ? translateTournament('loading', language) : translateTournament('refresh', language)}</span>
                  </button>
                </div>

                {publicRooms.length === 0 ? (
                  <div style={{ padding: '18px', borderRadius: 12, background: 'rgba(255,255,255,0.03)', color: '#9ca3af', textAlign: 'center', fontSize: '0.82rem' }}>
                    {publicRoomsLoading ? translateTournament('loadingRooms', language) : translateTournament('noRooms', language)}
                  </div>
                ) : (
                  <div style={{ display: 'grid', gap: 8, maxHeight: 240, overflowY: 'auto' }}>
                    {publicRooms.map((item) => (
                      <div key={item.roomId} className="multiplayer-room-item">
                        <div className="multiplayer-room-info">
                          <span className="multiplayer-room-code">{item.roomId}</span>
                          <span className="multiplayer-room-meta">
                            {item.players}/{item.maxPlayers} 选手 · {item.themeId === 'starry-neon' ? translateTournament('themeNeon', language) : translateTournament('themeClassic', language)}
                            {item.allowSpectators ? ' · 允许观战' : ''}
                          </span>
                        </div>
                        <button
                          type="button"
                          className="lobby-quick-btn"
                          onClick={() => {
                            setRoomCode(item.roomId);
                            setSpectator(false);
                          }}
                          style={{ minHeight: 34, padding: '4px 12px', fontSize: '0.78rem' }}
                        >
                          {translateTournament('fillRoom', language)}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          </div>

          <PwaControls activeGame={false} />
          <SettingsDialog
            dialogRef={dialogRef}
            isOpen={isOpen}
            onClose={closeDialog}
            onCancel={handleCancel}
            preferences={preferences}
            effectiveQuality={effectiveQuality}
            effectiveReducedMotion={effectiveReducedMotion}
            onUpdatePreference={updatePreference}
            onResetPreferences={resetPreferences}
            isGameOver={false}
            phase="MODE_SELECT"
            theme={theme}
            onSelectTheme={setTheme}
          />
        </div>
      </div>
    );
  }

  const isWaiting = publicState.phase === 'WAITING';
  const isFinished = publicState.phase === 'FINISHED';
  const mySeat = privateState?.seatId === null || privateState?.seatId === undefined ? null : publicState.seats[privateState.seatId];
  return (
    <main style={{ minHeight: '100dvh', padding: 'calc(20px + env(safe-area-inset-top, 0px)) calc(20px + env(safe-area-inset-right, 0px)) calc(20px + env(safe-area-inset-bottom, 0px)) calc(20px + env(safe-area-inset-left, 0px))', background: 'var(--bg-stage)', color: '#fff' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '16px' }}><div><h1 style={{ margin: 0, fontSize: '1.4rem' }}>{translateTournament('title', language)} · {publicState.size} · {publicState.format === 'survivor' ? translateTournament('survivor', language) : translateTournament('duel', language)}</h1><span style={{ color: '#94a3b8', fontSize: '.8rem' }}>{translateTournament('room', language)} {publicState.roomId} · {isWaiting ? translateTournament('waiting', language) : isFinished ? translateTournament('finished', language) : translateTournament('running', language)} · {publicState.ranked ? translateTournament('rankedRoom', language) : translateTournament('casualRoom', language)} · {publicState.allowEmotes ? translateTournament('emotesOn', language) : translateTournament('emotesOff', language)} · {tm('latency', { value: latencyMs === null ? '—' : `${latencyMs} ms` })}</span></div><div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}><FullscreenToggle compact /><button type="button" onClick={openDialog} aria-label={translate('settings.title', language)} style={secondaryButton}>{translate('settings.title', language)}</button><button type="button" onClick={() => { intentionalLeaveRef.current = true; room.leave(true); }} style={secondaryButton}>{translateTournament('leave', language)}</button></div></header>
      {error && <div role="alert" style={{ padding: '10px 14px', borderRadius: '10px', background: 'rgba(239,68,68,.15)', color: '#fca5a5', marginBottom: '12px' }}>{error}</div>}
      {isWaiting ? <section style={panelStyle}><h2 style={{ marginTop: 0 }}>{translateTournament('seats', language)}</h2><InviteQr url={`${window.location.origin}/tournament?room=${encodeURIComponent(publicState.roomId)}`} /><div style={gridStyle}>{publicState.seats.map((seat) => <div key={seat.seatId} style={{ padding: '12px', borderRadius: '10px', background: seat.occupied ? 'rgba(99,102,241,.18)' : 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.1)' }}>#{seat.seatId + 1} {seat.nickname}<div style={{ color: seat.ready ? '#86efac' : '#94a3b8', fontSize: '.8rem', marginTop: '4px' }}>{seat.occupied ? (seat.ready ? translateTournament('ready', language) : translateTournament('notReady', language)) : translateTournament('emptySeat', language)}</div></div>)}</div>{!spectator && privateState?.allowedActions.includes('READY') && <button type="button" onClick={() => sendCommand({ type: 'READY', ready: !mySeat?.ready })} style={primaryButton}>{mySeat?.ready ? translateTournament('cancelReady', language) : translateTournament('readyButton', language)}</button>}{!spectator && privateState?.allowedActions.includes('START') && <button type="button" onClick={() => sendCommand({ type: 'START' })} style={{ ...primaryButton, marginLeft: '10px' }}>{translateTournament('start', language)}</button>}</section> : <>
        <section style={panelStyle}><h2 style={{ marginTop: 0 }}>{translateTournament('bracket', language)}</h2>{publicState.rounds.map((round) => <div key={round.roundIndex} style={{ marginBottom: '14px' }}><h3 style={{ fontSize: '.95rem', color: '#c4b5fd' }}>{tm('round', { round: round.roundIndex })}</h3><div style={gridStyle}>{round.matches.map((match) => <div key={match.matchId} style={{ padding: '10px', borderRadius: '10px', background: match.status === 'ACTIVE' ? 'rgba(245,158,11,.16)' : 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.1)' }}><div style={{ fontSize: '.75rem', color: '#94a3b8' }}>{match.matchId}</div><div>#{(match.playerSeatIds[0] ?? 0) + 1} vs #{(match.playerSeatIds[1] ?? 0) + 1}</div><div style={{ fontSize: '.78rem', color: '#94a3b8' }}>{match.status === 'ACTIVE' ? translateTournament('active', language) : match.status === 'COMPLETED' ? `${tm('completed', { seat: (match.winnerSeatId ?? 0) + 1 })}${match.tieBreakUsed ? translateTournament('tieBreak', language) : ''}` : match.status === 'BYE' ? translateTournament('bye', language) : translateTournament('waitingMatch', language)}</div></div>)}</div></div>)}</section>
        {activeDuel && <TournamentDuelPanel duel={activeDuel} role={myDuelRole} offerAmount={offerAmount} setOfferAmount={setOfferAmount} onCommand={sendDuelCommand} lowQuality={effectiveQuality === 'low'} reducedMotion={effectiveReducedMotion} />}
        {activeSurvivor && <TournamentSurvivorPanel match={activeSurvivor} onCommand={sendSurvivorCommand} lowQuality={effectiveQuality === 'low'} reducedMotion={effectiveReducedMotion} />}
        {!activeMatch && publicActiveMatch?.format === 'duel' && publicActiveMatch.duel && <TournamentSpectatorDuelPanel duel={publicActiveMatch.duel} lowQuality={effectiveQuality === 'low'} reducedMotion={effectiveReducedMotion} />}
        {!activeMatch && publicActiveMatch?.format === 'survivor' && publicActiveMatch.survivor && <TournamentSpectatorSurvivorPanel survivor={publicActiveMatch.survivor} lowQuality={effectiveQuality === 'low'} reducedMotion={effectiveReducedMotion} />}
        {isFinished && <section style={panelStyle}><button type="button" onClick={loadReplay} style={secondaryButton}>{translateTournament('replay', language)}</button>{replayError && <p role="alert" style={{ color: '#fca5a5' }}>{replayError}</p>}{replay && <ReplayViewer title={tm('replayTitle', { count: replay.matches.length })} events={replay.events} describe={(event) => `#${event.seq ?? '?'} · ${event.type || 'event'}`} />}</section>}
        {isFinished && publicState.result && <section style={panelStyle}><h2 style={{ marginTop: 0 }}>{translateTournament('finalRanking', language)}</h2><ol style={{ lineHeight: 1.9 }}>{publicState.result.rankings.map((entry) => <li key={entry.seatId}>{entry.nickname} · {formatMoney(entry.score)} {entry.rank === 1 ? '🏆' : tm('rankSuffix', { rank: entry.rank })}</li>)}</ol>{!spectator && <ShareControls resultId={publicState.result.resultId} mode="tournament" />}</section>}
      </>}
      <PwaControls activeGame={!isFinished} />
      <SettingsDialog
        dialogRef={dialogRef}
        isOpen={isOpen}
        onClose={closeDialog}
        onCancel={handleCancel}
        preferences={preferences}
        effectiveQuality={effectiveQuality}
        effectiveReducedMotion={effectiveReducedMotion}
        onUpdatePreference={updatePreference}
        onResetPreferences={resetPreferences}
        isGameOver={isFinished}
        phase={publicState.phase}
        theme={theme}
        onSelectTheme={setTheme}
      />
    </main>
  );
}

function TournamentSpectatorDuelPanel({ duel, lowQuality, reducedMotion }: { duel: import('../packages/protocol/src/duel').DuelPublicSnapshot; lowQuality: boolean; reducedMotion: boolean }) {
  return <section style={panelStyle}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}><h2 style={{ marginTop: 0 }}>{translateTournament('spectatorDuel', getLanguage())}</h2><span style={{ color: '#fcd34d' }}>{duel.phase}</span></div>
    <MultiplayerStage3D boxes={duel.boxes} personalBoxId={duel.playerBoxId} phase={duel.phase} currentChooserSeatId={null} mySeatId={null} allowedActions={[]} onSelectBox={() => undefined} onOpenBox={() => undefined} playerBoxLabel={translateTournament('challengerCase', getLanguage())} lowQuality={lowQuality} reducedMotion={reducedMotion} />
    <div style={gridStyle}>{duel.boxes.map((box) => <div key={box.id} style={{ minHeight: '62px', borderRadius: '10px', border: '1px solid rgba(255,255,255,.12)', background: box.status === 'opened' ? 'rgba(34,197,94,.15)' : box.status === 'selected' ? 'rgba(245,158,11,.2)' : 'rgba(255,255,255,.05)', color: '#fff', display: 'grid', placeItems: 'center' }}>#{box.id}<br />{box.revealedAmount !== undefined ? formatMoney(box.revealedAmount) : box.status}</div>)}</div>
    <p style={{ color: '#94a3b8' }}>{translateTournament('hiddenDuel', getLanguage())}</p>
  </section>;
}

function TournamentDuelPanel({ duel, role, offerAmount, setOfferAmount, onCommand, lowQuality, reducedMotion }: { duel: DuelClientSnapshot; role: string | null; offerAmount: string; setOfferAmount: (value: string) => void; onCommand: (type: DuelActionType, extra?: Record<string, unknown>) => void; lowQuality: boolean; reducedMotion: boolean }) {
  const language = useLanguage();
  const [animating, setAnimating] = useState(false);
  const allowed = animating ? [] : duel.private.allowedActions;
  const canSelect = allowed.includes('SELECT_BOX');
  const canOpen = allowed.includes('OPEN_BOX');
  return <section style={panelStyle}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}><h2 style={{ marginTop: 0 }}>{translateTournament('spectatorDuel', language)} · {role === 'CHALLENGER' ? translateTournament('roleChallenger', language) : role === 'BANKER' ? translateTournament('roleBanker', language) : translateTournament('roleSpectator', language)}</h2><span style={{ color: '#fcd34d' }}>{duel.public.phase}</span></div>
    <MultiplayerStage3D boxes={duel.public.boxes} personalBoxId={duel.public.playerBoxId} phase={duel.public.phase} currentChooserSeatId={duel.public.challengerSeatId} mySeatId={duel.private.seatId} allowedActions={allowed} onSelectBox={(boxId) => onCommand('SELECT_BOX', { boxId })} onOpenBox={(boxId) => onCommand('OPEN_BOX', { boxId })} playerBoxLabel={role === 'CHALLENGER' ? translateTournament('personalCase', language) : translateTournament('challengerCase', language)} lowQuality={lowQuality} reducedMotion={reducedMotion} onAnimationChange={(boxId) => setAnimating(boxId !== null)} />
    <div style={gridStyle}>{duel.public.boxes.map((box) => <button key={box.id} type="button" disabled={animating || (!canSelect && !canOpen)} onClick={() => onCommand(canSelect ? 'SELECT_BOX' : 'OPEN_BOX', { boxId: box.id })} style={{ minHeight: '62px', borderRadius: '10px', border: '1px solid rgba(255,255,255,.12)', background: box.status === 'opened' ? 'rgba(34,197,94,.15)' : box.status === 'selected' ? 'rgba(245,158,11,.2)' : 'rgba(255,255,255,.05)', color: '#fff', cursor: animating ? 'not-allowed' : 'pointer' }}>#{box.id}<br />{box.revealedAmount !== undefined ? formatMoney(box.revealedAmount) : box.status}</button>)}</div>
    {duel.public.currentOffer && !animating && <div style={{ marginTop: '14px', padding: '12px', borderRadius: '10px', background: 'rgba(245,158,11,.12)' }}>{translateTournament('currentOffer', language)}{formatMoney(duel.public.currentOffer.amount)}<div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>{allowed.includes('ACCEPT_OFFER') && <button type="button" onClick={() => onCommand('ACCEPT_OFFER', { offerId: duel.public.currentOffer?.offerId })} style={primaryButton}>{translateTournament('accept', language)}</button>}{allowed.includes('REJECT_OFFER') && <button type="button" onClick={() => onCommand('REJECT_OFFER', { offerId: duel.public.currentOffer?.offerId })} style={secondaryButton}>{translateTournament('reject', language)}</button>}</div></div>}
    {allowed.includes('SUBMIT_OFFER') && <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}><input value={offerAmount} onChange={(event) => setOfferAmount(event.target.value.replace(/\D/g, ''))} style={{ ...inputStyle, flex: 1 }} placeholder={translateTournament('offerPlaceholder', language)} /><button type="button" onClick={() => onCommand('SUBMIT_OFFER', { amount: Number(offerAmount) })} style={primaryButton}>{translateTournament('submitOffer', language)}</button></div>}
    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '12px' }}>{allowed.includes('KEEP_BOX') && <button type="button" onClick={() => onCommand('KEEP_BOX')} style={primaryButton}>{translateTournament('keep', language)}</button>}{allowed.includes('SWAP_BOX') && <button type="button" onClick={() => { const target = duel.public.boxes.find((box) => box.status === 'unopened'); if (target) onCommand('SWAP_BOX', { targetBoxId: target.id }); }} style={secondaryButton}>{translateTournament('swap', language)}</button>}{allowed.includes('CONTINUE_ROUND') && <button type="button" onClick={() => onCommand('CONTINUE_ROUND')} style={primaryButton}>{translateTournament('continueRound', language)}</button>}</div>
  </section>;
}

function TournamentSurvivorPanel({ match, onCommand, lowQuality, reducedMotion }: { match: SurvivorClientSnapshot; onCommand: (type: SurvivorActionType, extra?: Record<string, unknown>) => void; lowQuality: boolean; reducedMotion: boolean }) {
  const language = useLanguage();
  const tm = (key: TournamentMessageKey, replacements: Record<string, string | number> = {}) =>
    Object.entries(replacements).reduce(
      (text, [name, value]) => text.replace(new RegExp(`\\{${name}\\}`, 'g'), String(value)),
      translateTournament(key, language),
    );
  const [animating, setAnimating] = useState(false);
  const allowed = animating ? [] : match.private.allowedActions;
  const ownSeat = match.private.seatId;
  const canSelect = allowed.includes('SELECT_BOX');
  const canOpen = allowed.includes('OPEN_BOX');
  const canActOnBox = canSelect || canOpen;
  const offer = match.private.currentOffer;
  const ownBoxId = ownSeat === null ? null : match.public.seats.find((seat) => seat.seatId === ownSeat)?.personalBoxId ?? null;
  return <section style={panelStyle}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}><h2 style={{ marginTop: 0 }}>{translateTournament('quickSurvivor', language)}</h2><span style={{ color: '#fcd34d' }}>{match.public.phase}</span></div>
    <p style={{ color: '#cbd5e1' }}>{tm('round', { round: match.public.roundIndex || 1 })} · {translateTournament('currentAction', language)}{match.public.currentChooserSeatId === ownSeat ? translateTournament('you', language) : tm('playerSeat', { seat: (match.public.currentChooserSeatId ?? 0) + 1 })}</p>
    <MultiplayerStage3D boxes={match.public.boxes} personalBoxId={ownBoxId} phase={match.public.phase} currentChooserSeatId={match.public.currentChooserSeatId} mySeatId={ownSeat} allowedActions={allowed} onSelectBox={(boxId) => onCommand('SELECT_BOX', { boxId })} onOpenBox={(boxId) => onCommand('OPEN_BOX', { boxId })} playerBoxLabel={translateTournament('personalCase', language)} lowQuality={lowQuality} reducedMotion={reducedMotion} onAnimationChange={(boxId) => setAnimating(boxId !== null)} />
    <div style={gridStyle}>{match.public.boxes.map((box) => { const actionable = !animating && canActOnBox && box.status === 'unopened'; return <button key={box.id} type="button" disabled={!actionable} onClick={() => onCommand(canSelect ? 'SELECT_BOX' : 'OPEN_BOX', { boxId: box.id })} style={{ minHeight: '62px', borderRadius: '10px', border: '1px solid rgba(255,255,255,.12)', background: box.status === 'opened' ? 'rgba(34,197,94,.15)' : box.status === 'selected' ? 'rgba(245,158,11,.2)' : 'rgba(255,255,255,.05)', color: '#fff', cursor: actionable ? 'pointer' : 'default' }}>#{box.id}<br />{box.revealedAmount !== undefined ? formatMoney(box.revealedAmount) : box.status}</button>; })}</div>
    {offer && !animating && <div style={{ marginTop: '14px', padding: '12px', borderRadius: '10px', background: 'rgba(245,158,11,.12)' }}>{translateTournament('privateOffer', language)}{formatMoney(offer.amount)}<div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>{allowed.includes('ACCEPT_OFFER') && <button type="button" onClick={() => onCommand('ACCEPT_OFFER', { offerId: offer.offerId })} style={primaryButton}>{translateTournament('accept', language)}</button>}{allowed.includes('REJECT_OFFER') && <button type="button" onClick={() => onCommand('REJECT_OFFER', { offerId: offer.offerId })} style={secondaryButton}>{translateTournament('reject', language)}</button>}</div></div>}
    {allowed.includes('SEND_EMOTE') && <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '12px' }} aria-label={translateTournament('emotes', language)}>{['👍', '👏', '🎉', '🔥', '💰', '😮'].map((emoji) => <button key={emoji} type="button" onClick={() => onCommand('SEND_EMOTE', { emoji })} style={secondaryButton} aria-label={tm('sendEmote', { emoji })}>{emoji}</button>)}</div>}
  </section>;
}

function TournamentSpectatorSurvivorPanel({ survivor, lowQuality, reducedMotion }: { survivor: SurvivorPublicSnapshot; lowQuality: boolean; reducedMotion: boolean }) {
  const language = useLanguage();
  return <section style={panelStyle}><div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}><h2 style={{ marginTop: 0 }}>{translateTournament('spectatorSurvivor', language)}</h2><span style={{ color: '#fcd34d' }}>{survivor.phase}</span></div><MultiplayerStage3D boxes={survivor.boxes} personalBoxId={null} phase={survivor.phase} currentChooserSeatId={null} mySeatId={null} allowedActions={[]} onSelectBox={() => undefined} onOpenBox={() => undefined} playerBoxLabel={translateTournament('personalCase', language)} lowQuality={lowQuality} reducedMotion={reducedMotion} /><div style={gridStyle}>{survivor.boxes.map((box) => <div key={box.id} style={{ minHeight: '62px', borderRadius: '10px', border: '1px solid rgba(255,255,255,.12)', background: box.status === 'opened' ? 'rgba(34,197,94,.15)' : box.status === 'selected' ? 'rgba(245,158,11,.2)' : 'rgba(255,255,255,.05)', color: '#fff', display: 'grid', placeItems: 'center' }}>#{box.id}<br />{box.revealedAmount !== undefined ? formatMoney(box.revealedAmount) : box.status}</div>)}</div><p style={{ color: '#94a3b8' }}>{translateTournament('hiddenSurvivor', language)}</p></section>;
}

const panelStyle: React.CSSProperties = { padding: '18px', borderRadius: '16px', background: 'rgba(15,23,42,.88)', border: '1px solid rgba(129,140,248,.22)', marginBottom: '16px' };
const gridStyle: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(96px, 1fr))', gap: '8px', marginBottom: '16px' };
const inputStyle: React.CSSProperties = { display: 'block', width: '100%', marginTop: '6px', minHeight: '44px', padding: '8px 10px', borderRadius: '8px', border: '1px solid rgba(255,255,255,.16)', background: 'rgba(0,0,0,.25)', color: '#fff', boxSizing: 'border-box' };
const primaryButton: React.CSSProperties = { minHeight: '44px', padding: '8px 16px', borderRadius: '9px', border: '1px solid rgba(251,191,36,.4)', background: 'linear-gradient(135deg,#7c3aed,#a21caf)', color: '#fff', fontWeight: 800, cursor: 'pointer' };
const secondaryButton: React.CSSProperties = { ...primaryButton, background: 'rgba(255,255,255,.08)', borderColor: 'rgba(255,255,255,.18)' };
