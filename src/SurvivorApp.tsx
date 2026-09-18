import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Client, Room } from 'colyseus.js';
import type { SurvivorClientSnapshot, SurvivorCommandResult } from '../packages/protocol/src/survivor';
import { fetchSurvivorRooms } from './api/survivor';
import { InviteQr } from './components/InviteQr';
import { PwaControls } from './components/PwaControls';
import { FullscreenToggle } from './components/FullscreenToggle';
import { SettingsDialog } from './components/SettingsDialog';
import { ShareControls } from './components/ShareControls';
import { MultiplayerStage3D } from './components/MultiplayerStage3D';
import { usePreferences } from './hooks/usePreferences';
import { useDialog } from './hooks/useDialog';
import { useTheme } from './themes';
import { getLanguage, translate, useLanguage, type TranslationKey } from './i18n';
import { ArrowLeft, Users, Shield, Lock, Eye, Sparkles, RefreshCw, Settings } from 'lucide-react';
import './components/MultiplayerLobbyHub.css';

const SURVIVOR_SESSION_KEY = 'bf-survivor-reconnect';

function endpoint() {
  if (typeof window === 'undefined') return 'ws://127.0.0.1:2567/game';
  return `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/game`;
}

export function SurvivorApp() {
  const { preferences, effectiveQuality, effectiveReducedMotion, updatePreference, resetPreferences } = usePreferences();
  const { dialogRef, isOpen, openDialog, closeDialog, handleCancel } = useDialog();
  const { theme, setTheme, availableThemes } = useTheme(effectiveQuality);
  const language = useLanguage();
  const msg = (key: TranslationKey, replacements: Record<string, string | number> = {}) =>
    Object.entries(replacements).reduce(
      (text, [name, value]) => text.replace(new RegExp(`\\{${name}\\}`, 'g'), String(value)),
      translate(key, language),
    );
  const [nickname, setNickname] = useState('');
  const [roomCode, setRoomCode] = useState(new URLSearchParams(location.search).get('room') || '');
  const [spectator, setSpectator] = useState(false);
  const [allowSpectators, setAllowSpectators] = useState(true);
  const [allowEmotes, setAllowEmotes] = useState(true);
  const [ranked, setRanked] = useState(true);
  const [isPrivate, setIsPrivate] = useState(false);
  const [roomPassword, setRoomPassword] = useState('');
  const [rooms, setRooms] = useState<Array<{ roomId: string; players: number; maxPlayers: number; allowSpectators: boolean; themeId?: 'classic' | 'starry-neon' }>>([]);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [snapshot, setSnapshot] = useState<SurvivorClientSnapshot | null>(null);
  const [presentationAnimatingBoxId, setPresentationAnimatingBoxId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const roomRef = useRef<Room | null>(null);
  const seatRef = useRef<number | null>(null);
  const seqRef = useRef(0);
  const snapRef = useRef<SurvivorClientSnapshot | null>(null);
  const reconnectingRef = useRef(false);
  const intentionalLeaveRef = useRef(false);
  const client = useMemo(() => new Client(endpoint()), []);

  const attachRoom = (room: Room) => {
    roomRef.current = room;
    if (room.reconnectionToken) sessionStorage.setItem(SURVIVOR_SESSION_KEY, room.reconnectionToken);
    room.onMessage('ready', (payload: { seatId: number | null }) => { seatRef.current = payload.seatId; });
    const applySnapshot = (next: SurvivorClientSnapshot) => {
      const previous = snapRef.current;
      if (previous && next.public.matchId === previous.public.matchId && next.public.stateVersion < previous.public.stateVersion) {
        return;
      }
      if (previous && next.public.matchId !== previous.public.matchId) {
        setPresentationAnimatingBoxId(null);
      }
      if (previous && next.public.matchId === previous.public.matchId && next.public.openedBoxIds.length > previous.public.openedBoxIds.length) {
        const openedBefore = new Set(previous.public.openedBoxIds);
        const openedNow = next.public.openedBoxIds.find((id) => !openedBefore.has(id));
        if (openedNow !== undefined) setPresentationAnimatingBoxId(openedNow);
      }
      if (next.private.seatId !== null) {
        seqRef.current = Math.max(seqRef.current, next.private.lastCommandSequence);
      }
      snapRef.current = next;
      setSnapshot(next);
      if (next.public.phase === 'FINISHED') sessionStorage.removeItem(SURVIVOR_SESSION_KEY);
    };
    room.onMessage('snapshot', (next: SurvivorClientSnapshot) => {
      applySnapshot(next);
    });
    room.onMessage('command_result', (result: SurvivorCommandResult) => {
      if (!result.success) {
        setError(result.error?.message || translate('survivor.error.command', getLanguage()));
      }
      if (result.snapshot) {
        applySnapshot(result.snapshot);
      }
    });
    room.onMessage('pong', (payload: { sentAt?: number }) => { if (typeof payload?.sentAt === 'number') setLatencyMs(Math.max(0, Date.now() - payload.sentAt)); });
    room.onError(() => setError(translate('survivor.error.connection', getLanguage())));
    room.onLeave(() => {
      roomRef.current = null;
      if (intentionalLeaveRef.current) {
        intentionalLeaveRef.current = false;
        sessionStorage.removeItem(SURVIVOR_SESSION_KEY);
        setSnapshot(null);
        return;
      }
      const token = sessionStorage.getItem(SURVIVOR_SESSION_KEY);
      if (!token || reconnectingRef.current) return;
      reconnectingRef.current = true;
      setReconnecting(true);
      setError(translate('survivor.error.disconnected', getLanguage()));
      void client.reconnect(token).then((nextRoom) => {
        reconnectingRef.current = false;
        setReconnecting(false);
        setError(null);
        attachRoom(nextRoom);
        nextRoom.send('request_snapshot');
      }).catch(() => {
        reconnectingRef.current = false;
        setReconnecting(false);
        setError(translate('survivor.error.restoreFailed', getLanguage()));
      });
    });
  };

  useEffect(() => {
    const token = sessionStorage.getItem(SURVIVOR_SESSION_KEY);
    if (!token || roomRef.current) return;
    setReconnecting(true);
    setError(translate('survivor.error.restoring', getLanguage()));
    reconnectingRef.current = true;
    void client.reconnect(token).then((room) => {
      reconnectingRef.current = false;
      setReconnecting(false);
      setError(null);
      attachRoom(room);
      room.send('request_snapshot');
    }).catch(() => {
      reconnectingRef.current = false;
      setReconnecting(false);
      sessionStorage.removeItem(SURVIVOR_SESSION_KEY);
      setError(null);
    });
  }, []);

  useEffect(() => {
    if (snapshot) return;
    fetchSurvivorRooms().then((result) => {
      if (result.ok && result.data) setRooms(result.data.items);
    }).catch(() => { /* public room list is optional */ });
  }, [snapshot]);

  useEffect(() => {
    setPresentationAnimatingBoxId(null);
  }, [snapshot?.public.matchId]);

  useEffect(() => {
    const roomTheme = snapshot?.public.themeId;
    if (roomTheme && roomTheme !== theme) {
      setTheme(roomTheme as typeof theme);
    }
  }, [snapshot?.public.themeId, setTheme, theme]);

  useEffect(() => () => { intentionalLeaveRef.current = true; try { roomRef.current?.leave(false); } catch {} }, []);

  const connect = async () => {
    setError(null);
    try {
      const room = roomCode.trim()
        ? await client.joinById(roomCode.trim(), { nickname: nickname.trim() || translate('survivor.defaultPlayer', language), spectator, password: roomPassword.trim() || undefined })
        : await client.create('survivor_26', {
            nickname: nickname.trim() || translate('survivor.defaultPlayer', language),
            spectator,
            allowSpectators,
            allowEmotes,
            ranked: isPrivate ? false : ranked,
            isPrivate,
            themeId: theme,
            password: isPrivate ? roomPassword.trim() : undefined,
          });
      attachRoom(room);
      room.send('request_snapshot');
    } catch (err) {
      const message = err instanceof Error && err.message.includes('Invalid room password')
        ? translate('survivor.error.badPassword', language)
        : err instanceof Error && err.message.includes('Survivor room passwords require')
          ? translate('survivor.error.passwordShort', language)
          : err instanceof Error ? err.message : translate('survivor.error.joinFailed', language);
      setError(message);
    }
  };

  useEffect(() => {
    const room = roomRef.current;
    if (!room) return;
    const timer = window.setInterval(() => room.send('ping', { sentAt: Date.now() }), 5000);
    return () => window.clearInterval(timer);
  }, [snapshot]);

  const send = (type: string, extra: Record<string, unknown> = {}) => {
    const room = roomRef.current;
    const current = snapRef.current;
    if (!room || !current) return;
    const command = {
      type,
      matchId: current.public.matchId,
      stateVersion: current.public.stateVersion,
      commandSequence: ++seqRef.current,
      idempotencyKey: crypto.randomUUID(),
      ...extra,
    };
    room.send('command', command);
  };

  if (!snapshot) {
    return (
      <div className="multiplayer-hub-viewport">
        <div className="multiplayer-hub-inner">
          {/* 顶部大厅导航栏 */}
          <header className="multiplayer-hub-header">
            <div className="multiplayer-hub-title-group">
              <div
                className="multiplayer-hub-icon-wrap"
                style={{ background: 'rgba(192, 132, 252, 0.2)', color: '#d8b4fe' }}
              >
                <Users size={26} />
              </div>
              <div>
                <h1 className="multiplayer-hub-title-text">
                  <span>{translate('survivor.title', language)}</span>
                  <span style={{ fontSize: '0.72rem', padding: '2px 8px', borderRadius: 8, background: 'rgba(192,132,252,0.25)', color: '#e9d5ff' }}>
                    2~6 人博弈
                  </span>
                </h1>
                <div className="multiplayer-hub-desc">{translate('survivor.intro', language)}</div>
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
            {/* 左栏：创建房间配置 */}
            <section className="multiplayer-hub-card">
              <h2 className="multiplayer-card-title">
                <Sparkles size={18} />
                <span>创建新对局</span>
              </h2>

              <div className="multiplayer-form-field">
                <label className="multiplayer-field-label">{translate('survivor.nickname', language)}</label>
                <input
                  className="multiplayer-input-styled"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  maxLength={16}
                  placeholder={translate('survivor.defaultPlayer', language)}
                />
              </div>

              <div className="multiplayer-form-field">
                <label className="multiplayer-field-label">{translate('survivor.theme', language)}</label>
                <select
                  className="multiplayer-input-styled"
                  value={theme}
                  onChange={(e) => setTheme(e.target.value as typeof theme)}
                  style={{ cursor: 'pointer' }}
                >
                  {availableThemes.map((item) => (
                    <option key={item.id} value={item.id} style={{ background: '#121426', color: '#fff' }}>
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
                    onChange={(e) => setAllowSpectators(e.target.checked)}
                    style={{ accentColor: '#f59e0b' }}
                  />
                  <span>{translate('survivor.allowSpectators', language)}</span>
                </label>

                <label className={`multiplayer-toggle-card ${allowEmotes ? 'checked' : ''}`}>
                  <input
                    type="checkbox"
                    checked={allowEmotes}
                    onChange={(e) => setAllowEmotes(e.target.checked)}
                    style={{ accentColor: '#f59e0b' }}
                  />
                  <span>{translate('survivor.allowEmotes', language)}</span>
                </label>

                <label className={`multiplayer-toggle-card ${ranked && !isPrivate ? 'checked' : ''}`}>
                  <input
                    type="checkbox"
                    checked={ranked}
                    onChange={(e) => setRanked(e.target.checked)}
                    disabled={isPrivate}
                    style={{ accentColor: '#f59e0b' }}
                  />
                  <span>{translate('survivor.ranked', language)}</span>
                </label>

                <label className={`multiplayer-toggle-card ${isPrivate ? 'checked' : ''}`}>
                  <input
                    type="checkbox"
                    checked={isPrivate}
                    onChange={(e) => setIsPrivate(e.target.checked)}
                    style={{ accentColor: '#f59e0b' }}
                  />
                  <span>{translate('survivor.private', language)}</span>
                </label>
              </div>

              {isPrivate && (
                <div className="multiplayer-form-field">
                  <label className="multiplayer-field-label">{translate('survivor.password', language)}</label>
                  <input
                    type="password"
                    className="multiplayer-input-styled"
                    value={roomPassword}
                    onChange={(e) => setRoomPassword(e.target.value.slice(0, 64))}
                    maxLength={64}
                    placeholder="输入私密房间密码 (至少4位)"
                    autoComplete="current-password"
                  />
                </div>
              )}

              <button
                type="button"
                className="btn-primary"
                onClick={connect}
                disabled={reconnecting}
                style={{ minHeight: 46, borderRadius: 12, fontWeight: 800, fontSize: '0.95rem', marginTop: 8 }}
              >
                {reconnecting ? translate('survivor.reconnect', language) : '创建对局房间'}
              </button>
            </section>

            {/* 右栏：加入指定房间与公开对局 */}
            <section className="multiplayer-hub-card">
              <h2 className="multiplayer-card-title">
                <Users size={18} />
                <span>加入现有对局</span>
              </h2>

              <div className="multiplayer-form-field">
                <label className="multiplayer-field-label">{translate('survivor.roomCode', language)}</label>
                <div style={{ display: 'flex', gap: 10 }}>
                  <input
                    className="multiplayer-input-styled"
                    value={roomCode}
                    onChange={(e) => setRoomCode(e.target.value)}
                    placeholder="输入房间代码"
                    style={{ flex: 1 }}
                  />
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={connect}
                    disabled={!roomCode.trim() || reconnecting}
                    style={{ minHeight: 42, padding: '8px 20px', borderRadius: 10, fontWeight: 800, whiteSpace: 'nowrap' }}
                  >
                    {translate('survivor.connect', language)}
                  </button>
                </div>
              </div>

              <label className={`multiplayer-toggle-card ${spectator ? 'checked' : ''}`} style={{ alignSelf: 'flex-start' }}>
                <input
                  type="checkbox"
                  checked={spectator}
                  onChange={(e) => setSpectator(e.target.checked)}
                  style={{ accentColor: '#f59e0b' }}
                />
                <Eye size={15} />
                <span>{translate('survivor.joinSpectator', language)}</span>
              </label>

              {/* 公开房间列表 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '0.85rem', fontWeight: 800, color: '#fcd34d' }}>
                    {translate('survivor.publicRooms', language)}
                  </span>
                  <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>
                    {rooms.length > 0 ? `${rooms.length} 局进行中` : '暂无公开房间'}
                  </span>
                </div>

                {rooms.length === 0 ? (
                  <div style={{ padding: '18px', borderRadius: 12, background: 'rgba(255,255,255,0.03)', color: '#9ca3af', textAlign: 'center', fontSize: '0.82rem' }}>
                    暂无公开招募中的生存战房间，建议在左侧创建新对局！
                  </div>
                ) : (
                  <div style={{ display: 'grid', gap: 8, maxHeight: 240, overflowY: 'auto' }}>
                    {rooms.map((item) => (
                      <div key={item.roomId} className="multiplayer-room-item">
                        <div className="multiplayer-room-info">
                          <span className="multiplayer-room-code">{item.roomId}</span>
                          <span className="multiplayer-room-meta">
                            人数：{item.players}/{item.maxPlayers} · {item.allowSpectators ? '允许观战' : '仅限玩家'}
                          </span>
                        </div>
                        <button
                          type="button"
                          className="lobby-quick-btn"
                          onClick={() => {
                            setRoomCode(item.roomId);
                            setSpectator(false);
                            setIsPrivate(false);
                            setRoomPassword('');
                          }}
                          style={{ minHeight: 34, padding: '4px 12px', fontSize: '0.78rem' }}
                        >
                          加入
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

  const self = snapshot.public.seats.find((s) => s.seatId === snapshot.private.seatId);
  const can = (action: string) => presentationAnimatingBoxId === null && snapshot.private.allowedActions.includes(action as any);
  const emotes = ['👍', '👏', '🎉', '🔥', '💰', '😮', '🤔', '😱', '💪', '🤝'];
  const leave = () => {
    if (snapshot.private.isSpectator) {
      intentionalLeaveRef.current = true;
      try { roomRef.current?.leave(true); } catch {}
      return;
    }
    intentionalLeaveRef.current = true;
    send('LEAVE');
  };
  return (
    <main style={shell}>
      <section style={{ ...card, maxWidth: 980 }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <h1>{translate('survivor.title', language)}</h1>
            <p>{translate('survivor.room', language)} {snapshot.public.roomId} · {snapshot.public.phase} · {translate('duel.round', language).replace('{current}', String(snapshot.public.roundIndex + 1)).replace('{total}', String(9))} · {snapshot.public.ranked ? translate('survivor.ranked', language) : translate('auction.unranked', language)} · {translate('auction.spectators', language).replace('{count}', String(snapshot.public.spectatorCount))} · {msg('survivor.latency', { value: latencyMs === null ? '—' : `${latencyMs} ms` })}</p>
            {snapshot.private.isSpectator && <p style={{ color: '#67e8f9' }}>{translate('survivor.spectatorNotice', language)}</p>}
            {presentationAnimatingBoxId !== null && <p role="status" style={{ color: '#fcd34d' }}>{msg('survivor.revealing', { box: presentationAnimatingBoxId ?? '—' })}</p>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <FullscreenToggle compact />
            <button type="button" onClick={openDialog} aria-label={translate('settings.title', language)}>{translate('settings.title', language)}</button>
            <button onClick={leave}>{translate('survivor.leave', language)}</button>
          </div>
        </header>
        <InviteQr url={`${window.location.origin}/survivor?room=${encodeURIComponent(snapshot.public.roomId)}`} />
        {snapshot.public.lastEmote && <p style={{ margin: 0, color: '#fcd34d' }}>{snapshot.public.seats.find((seat) => seat.seatId === snapshot.public.lastEmote?.seatId)?.nickname || translate('survivor.player', language)} · {snapshot.public.lastEmote.emoji}</p>}
        {can('SEND_EMOTE') && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }} aria-label={translate('survivor.emotes', language)}>{emotes.map((emoji) => <button key={emoji} type="button" onClick={() => send('SEND_EMOTE', { emoji })} aria-label={msg('survivor.sendEmote', { emoji })}>{emoji}</button>)}</div>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 18 }}>
          <aside>
            <h2>{translate('survivor.players', language)}</h2>
            {snapshot.public.seats.map((seat) => <div key={seat.seatId} style={{ padding: 10, marginBottom: 8, borderRadius: 10, background: seat.seatId === snapshot.private.seatId ? 'rgba(34,211,238,.18)' : 'rgba(255,255,255,.06)' }}><strong>{seat.nickname}</strong><div>{translate('survivor.score', language)} {seat.lockedScore} · {seat.active ? translate('survivor.active', language) : translate('survivor.locked', language)}</div></div>)}
            {!snapshot.private.isSpectator && snapshot.public.phase === 'WAITING' && <><button onClick={() => send('READY', { ready: !self?.ready })}>{translate('survivor.ready', language)}</button>{snapshot.public.seats[0]?.seatId === snapshot.private.seatId && <button onClick={() => send('START')} disabled={snapshot.public.seats.length < 2}>{translate('survivor.start', language)}</button>}</>}
          </aside>
          <section>
            <h2>{translate('survivor.stage', language)}</h2>
            <MultiplayerStage3D
              boxes={snapshot.public.boxes}
              personalBoxId={self?.personalBoxId ?? null}
              phase={snapshot.public.phase}
              currentChooserSeatId={snapshot.public.currentChooserSeatId}
              mySeatId={snapshot.private.seatId}
              allowedActions={presentationAnimatingBoxId === null ? snapshot.private.allowedActions : []}
              onSelectBox={(boxId) => send('SELECT_BOX', { boxId })}
              onOpenBox={(boxId) => send('OPEN_BOX', { boxId })}
              playerBoxLabel={translate('survivor.personalBox', language)}
              lowQuality={effectiveQuality === 'low'}
              reducedMotion={effectiveReducedMotion}
              onAnimationChange={setPresentationAnimatingBoxId}
            />
            <div aria-label={translate('survivor.htmlBoxes', language)} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(44px, 1fr))', gap: 8 }}>
              {snapshot.public.boxes.map((box) => <button key={box.id} disabled={box.status !== 'unopened' || !can(snapshot.public.phase === 'SELECTING_PERSONAL' ? 'SELECT_BOX' : 'OPEN_BOX') || (snapshot.public.phase === 'OPENING' && snapshot.public.currentChooserSeatId !== snapshot.private.seatId)} onClick={() => send(snapshot.public.phase === 'SELECTING_PERSONAL' ? 'SELECT_BOX' : 'OPEN_BOX', { boxId: box.id })}>{box.status === 'opened' ? `${box.revealedAmount}` : `${translate('survivor.case', language)} ${box.id}`}</button>)}
            </div>
            {snapshot.private.currentOffer && presentationAnimatingBoxId === null && <div style={{ marginTop: 18, padding: 14, borderRadius: 12, background: 'rgba(245,158,11,.16)' }}><strong>{translate('survivor.privateOffer', language)}{snapshot.private.currentOffer.amount}</strong><div><button onClick={() => send('ACCEPT_OFFER', { offerId: snapshot.private.currentOffer?.offerId })}>{translate('survivor.deal', language)}</button><button onClick={() => send('REJECT_OFFER', { offerId: snapshot.private.currentOffer?.offerId })}>{translate('survivor.reject', language)}</button></div></div>}
            {snapshot.public.result && <div style={{ marginTop: 18 }}><h2>{translate('survivor.finalRanking', language)}</h2><p style={{ color: '#94a3b8', wordBreak: 'break-all' }}>{translate('survivor.fairness', language)}{snapshot.public.result.fairnessProof.commitment}</p>{snapshot.public.result.rankings.map((r) => <p key={r.seatId}>#{r.rank} {r.nickname}：{r.score}</p>)}{!snapshot.private.isSpectator && <ShareControls resultId={snapshot.public.result.resultId} mode="survivor" />}</div>}
          </section>
        </div>
        <PwaControls activeGame={snapshot.public.phase !== 'FINISHED'} />
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
          isGameOver={snapshot.public.phase === 'FINISHED'}
          phase={snapshot.public.phase}
          theme={theme}
          onSelectTheme={setTheme}
        />
      </section>
    </main>
  );
}

const shell: React.CSSProperties = { minHeight: '100dvh', padding: 'calc(24px + env(safe-area-inset-top, 0px)) calc(24px + env(safe-area-inset-right, 0px)) calc(24px + env(safe-area-inset-bottom, 0px)) calc(24px + env(safe-area-inset-left, 0px))', background: 'var(--bg-stage)', color: 'var(--text-primary)', boxSizing: 'border-box' };
const card: React.CSSProperties = { maxWidth: 620, margin: '0 auto', padding: 24, borderRadius: 18, background: 'var(--bg-panel)', border: '1px solid var(--border-gold)', display: 'flex', flexDirection: 'column', gap: 14 };

export default SurvivorApp;
