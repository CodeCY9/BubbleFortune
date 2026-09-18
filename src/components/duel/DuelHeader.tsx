import React, { useEffect, useRef, useState } from 'react';
import type {
  DuelPublicSnapshot,
  DuelPrivateView,
  DuelSeatId,
  DuelSeatInfo,
} from '../../../packages/protocol/src/duel';
import { Settings, LogOut, Clock, Wifi, WifiOff } from 'lucide-react';
import { formatMoney } from '../../types/game';
import { soundManager } from '../../utils/audio';
import { translate, useLanguage } from '../../i18n';

interface DuelHeaderProps {
  publicState: DuelPublicSnapshot;
  privateState: DuelPrivateView | null;
  presentedSeats?: [DuelSeatInfo, DuelSeatInfo] | null;
  serverTimeOffset: number;
  latencyMs: number | null;
  connectionStatus: string;
  soundEnabled: boolean;
  onOpenSettings: () => void;
  onLeaveClick: () => void;
  onRetryConnect?: () => void;
}

export const DuelHeader: React.FC<DuelHeaderProps> = ({
  publicState,
  privateState,
  presentedSeats,
  serverTimeOffset,
  latencyMs,
  connectionStatus,
  soundEnabled,
  onOpenSettings,
  onLeaveClick,
  onRetryConnect,
}) => {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const lastCountdownCue = useRef<number | null>(null);
  const language = useLanguage();

  const mySeatId: DuelSeatId | null = privateState?.seatId ?? null;
  const activeSeats = presentedSeats ?? publicState.seats;
  const mySeat = mySeatId !== null ? activeSeats[mySeatId] : null;
  const opponentSeatId: DuelSeatId | null =
    mySeatId !== null ? (mySeatId === 0 ? 1 : 0) : null;
  const opponentSeat = opponentSeatId !== null ? activeSeats[opponentSeatId] : null;

  // Authoritative countdown calculation
  useEffect(() => {
    const deadline = publicState.deadlineTimestamp;
    if (deadline === null || publicState.phase === 'WAITING' || publicState.phase === 'FINISHED') {
      setSecondsLeft(null);
      return;
    }

    const interval = setInterval(() => {
      const serverNow = Date.now() + serverTimeOffset;
      const diffMs = deadline - serverNow;
      if (diffMs <= 0) {
        setSecondsLeft(0);
      } else {
        setSecondsLeft(Math.ceil(diffMs / 1000));
      }
    }, 200);

    return () => clearInterval(interval);
  }, [publicState.deadlineTimestamp, publicState.phase, serverTimeOffset]);

  useEffect(() => {
    if (secondsLeft === null || secondsLeft > 5) {
      lastCountdownCue.current = null;
      return;
    }
    if (soundEnabled && secondsLeft >= 1 && lastCountdownCue.current !== secondsLeft) {
      soundManager.playCountdownWarning(secondsLeft);
      lastCountdownCue.current = secondsLeft;
    }
  }, [secondsLeft, soundEnabled]);

  const isChallenger = mySeat?.role === 'CHALLENGER';
  const roleLabel = mySeat?.role === 'CHALLENGER'
    ? translate('duel.challenger', language)
    : mySeat?.role === 'BANKER'
      ? translate('duel.banker', language)
      : translate('duel.spectator', language);

  return (
    <header className="duel-header" role="banner">
      {/* Left: Round & Roles */}
      <div className="duel-header-section">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span
            style={{
              fontSize: '0.85rem',
              fontWeight: 800,
              padding: '4px 10px',
              borderRadius: '8px',
              background: 'rgba(255, 255, 255, 0.1)',
              color: '#fcd34d',
            }}
          >
            {translate('duel.round', language).replace('{current}', String(publicState.roundIndex)).replace('{total}', '2')}
          </span>
          <span className={`duel-role-pill ${isChallenger ? 'challenger' : 'banker'}`}>
            {translate('duel.myRole', language)}: {roleLabel}
          </span>
        </div>

        {/* Lucky box badge */}
        {publicState.playerBoxId !== null && (
          <div
            style={{
              fontSize: '0.8rem',
              color: '#d1d5db',
              background: 'rgba(0, 0, 0, 0.3)',
              padding: '4px 10px',
              borderRadius: '8px',
              border: '1px solid rgba(245, 158, 11, 0.3)',
            }}
          >
            {translate('duel.luckyBox', language)}: <strong style={{ color: '#fcd34d' }}>#{publicState.playerBoxId}</strong>
          </div>
        )}
      </div>

      {/* Middle: Countdown Timer & Scores */}
      <div className="duel-header-section" style={{ justifyContent: 'center' }}>
        {secondsLeft !== null && (
          <div className={`duel-timer-badge ${secondsLeft <= 5 ? 'urgent' : ''}`} aria-label={translate('duel.countdown', language).replace('{seconds}', String(secondsLeft))}>
            <Clock size={15} />
            <span>{translate('duel.countdown', language).replace('{seconds}', String(secondsLeft))}</span>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '0.85rem' }}>
          <div>
            <span style={{ color: '#9ca3af' }}>{mySeat?.nickname ?? translate('duel.you', language)}: </span>
            <strong style={{ color: (mySeat?.score ?? 0) >= 0 ? '#34d399' : '#f87171' }}>
              {(mySeat?.score ?? 0) >= 0 ? '+' : ''}{formatMoney(mySeat?.score ?? 0)}
            </strong>
          </div>
          <span style={{ color: '#6b7280' }}>vs</span>
          <div>
            <span style={{ color: '#9ca3af' }}>{opponentSeat?.nickname ?? translate('duel.opponent', language)}: </span>
            <strong style={{ color: (opponentSeat?.score ?? 0) >= 0 ? '#34d399' : '#f87171' }}>
              {(opponentSeat?.score ?? 0) >= 0 ? '+' : ''}{formatMoney(opponentSeat?.score ?? 0)}
            </strong>
          </div>
        </div>
      </div>

      {/* Right: Network & Settings & Leave */}
      <div className="duel-header-section">
        <span
          role="status"
            aria-label={latencyMs === null ? translate('duel.latencyUnknown', language) : translate('duel.latencyAria', language).replace('{value}', `${latencyMs} ms`)}
          style={{ color: latencyMs !== null && latencyMs > 180 ? '#fca5a5' : '#9ca3af', fontSize: '0.75rem' }}
        >
          <Wifi size={13} /> {latencyMs === null ? translate('duel.latencyUnknown', language) : `${latencyMs} ms`}
        </span>
        {connectionStatus !== 'connected' && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              color: '#f87171',
              fontSize: '0.8rem',
              fontWeight: 700,
            }}
          >
            <WifiOff size={16} />
            <span>{connectionStatus === 'reconnecting' ? translate('duel.reconnecting', language) : translate('duel.disconnected', language)}</span>
            {onRetryConnect && (
              <button
                type="button"
                onClick={onRetryConnect}
                className="btn-secondary"
                style={{ padding: '2px 8px', fontSize: '0.75rem', minHeight: '28px' }}
              >
                {translate('duel.retry', language)}
              </button>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={onOpenSettings}
          className="btn-secondary"
          style={{
            minHeight: '40px',
            minWidth: '40px',
            padding: '8px',
            borderRadius: '10px',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          aria-label={translate('duel.settings', language)}
        >
          <Settings size={18} />
        </button>

        <button
          type="button"
          onClick={onLeaveClick}
          className="btn-secondary"
          style={{
            minHeight: '40px',
            padding: '8px 14px',
            borderRadius: '10px',
            color: '#fca5a5',
            borderColor: 'rgba(239, 68, 68, 0.4)',
            fontSize: '0.85rem',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
          }}
          title={translate('duel.leaveTitle', language)}
        >
          <LogOut size={16} />
          <span>{translate('duel.leave', language)}</span>
        </button>
      </div>
    </header>
  );
};
