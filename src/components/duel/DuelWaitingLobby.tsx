import React, { useState } from 'react';
import type {
  DuelPublicSnapshot,
  DuelPrivateView,
  DuelSeatId,
} from '../../../packages/protocol/src/duel';
import { Copy, Check, LogOut, Play, ShieldCheck, Users, RefreshCw } from 'lucide-react';
import { InviteQr } from '../InviteQr';
import { translate, translateLobby, useLanguage } from '../../i18n';

interface DuelWaitingLobbyProps {
  publicState: DuelPublicSnapshot;
  privateState: DuelPrivateView | null;
  onReady: (ready: boolean) => void;
  onStart: () => void;
  onLeave: () => void;
  isPending: boolean;
}

export const DuelWaitingLobby: React.FC<DuelWaitingLobbyProps> = ({
  publicState,
  privateState,
  onReady,
  onStart,
  onLeave,
  isPending,
}) => {
  const [copied, setCopied] = useState(false);
  const [copyFallback, setCopyFallback] = useState(false);
  const language = useLanguage();

  const mySeatId: DuelSeatId | null = privateState?.seatId ?? null;
  const isHost = mySeatId === publicState.hostSeatId;
  const mySeat = mySeatId !== null ? publicState.seats[mySeatId] : null;
  const isReady = mySeat?.ready ?? false;

  const canStart =
    Boolean(isHost && privateState?.allowedActions.includes('START'));

  const inviteUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/duel?room=${encodeURIComponent(publicState.roomId)}`
      : `/duel?room=${publicState.roomId}`;

  const handleCopyLink = async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(inviteUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      } else {
        setCopyFallback(true);
      }
    } catch {
      setCopyFallback(true);
    }
  };

  return (
    <div className="duel-entrance-overlay">
      <div className="duel-card" role="region" aria-label={translate('duel.waitingAria', language)}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <div className="duel-title" style={{ margin: 0 }}>
            <Users size={24} color="#f59e0b" />
            <span>{translate('duel.waitingTitle', language)}</span>
          </div>
          <button
            type="button"
            onClick={onLeave}
            className="duel-action-btn"
            style={{
              background: 'rgba(239, 68, 68, 0.15)',
              color: '#fca5a5',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              padding: '6px 14px',
              minHeight: '38px',
              fontSize: '0.85rem',
            }}
            title={translate('duel.leaveRoomTitle', language)}
          >
            <LogOut size={16} />
            <span>{translate('duel.leave', language)}</span>
          </button>
        </div>

        {/* Room Code & Invite Link Banner */}
        <div
          style={{
            background: 'rgba(0, 0, 0, 0.4)',
            border: '1px solid rgba(245, 158, 11, 0.25)',
            borderRadius: '14px',
            padding: '12px 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            flexWrap: 'wrap',
            marginBottom: '16px',
          }}
        >
          <div>
            <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginBottom: '2px' }}>{translate('duel.roomCode', language)}</div>
            <div className="duel-room-badge">{publicState.roomId}</div>
          </div>
          <button
            type="button"
            className="duel-action-btn"
            onClick={handleCopyLink}
            style={{
              background: 'rgba(245, 158, 11, 0.2)',
              color: '#fcd34d',
              border: '1px solid rgba(245, 158, 11, 0.4)',
              padding: '8px 16px',
            }}
          >
            {copied ? <Check size={16} color="#10b981" /> : <Copy size={16} />}
            <span>{copied ? translate('duel.copiedInvite', language) : translate('duel.copyInvite', language)}</span>
          </button>
        </div>

        {/* Fallback Selectable Input if Clipboard API Fails */}
        {copyFallback && (
          <div style={{ marginBottom: '16px' }}>
            <label htmlFor="duel-invite-input" style={{ fontSize: '0.8rem', color: '#9ca3af', display: 'block', marginBottom: '4px' }}>
              {translate('duel.manualCopy', language)}
            </label>
            <input
              id="duel-invite-input"
              type="text"
              readOnly
              value={inviteUrl}
              onFocus={(e) => e.target.select()}
              className="duel-input"
              style={{ width: '100%', fontSize: '0.85rem' }}
            />
          </div>
        )}
        <InviteQr url={inviteUrl} />
        <p role="note" style={{ margin: '10px 0 16px', color: '#94a3b8', fontSize: '0.78rem', lineHeight: 1.5 }}>
          {translateLobby('virtualNotice', language)}
        </p>

        {/* Seats Status */}
        <div className="duel-seats-grid">
          {publicState.seats.map((seat) => {
            const isMe = seat.seatId === mySeatId;
            const isSeatHost = seat.seatId === publicState.hostSeatId;
            return (
              <div
                key={seat.seatId}
                className={`duel-seat-card ${seat.occupied ? 'occupied' : ''} ${seat.ready ? 'ready' : ''}`}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '0.8rem', color: '#9ca3af', fontWeight: 700 }}>
                    {translate('duel.seat', language).replace('{number}', String(seat.seatId + 1))} {isSeatHost ? `· ${translate('duel.host', language)}` : ''}
                  </span>
                  {isMe && (
                    <span
                      style={{
                        fontSize: '0.7rem',
                        padding: '2px 6px',
                        borderRadius: '6px',
                        background: '#f59e0b',
                        color: '#000000',
                        fontWeight: 800,
                      }}
                    >
                      {translate('duel.me', language)}
                    </span>
                  )}
                </div>

                <div style={{ fontSize: '1.05rem', fontWeight: 800, color: seat.occupied ? '#ffffff' : '#6b7280' }}>
                  {seat.occupied ? seat.nickname : translate('duel.waitingPlayer', language)}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8rem', marginTop: '4px' }}>
                  {seat.occupied ? (
                    <>
                      <span
                        style={{
                          display: 'inline-block',
                          width: '8px',
                          height: '8px',
                          borderRadius: '50%',
                          background: seat.connected ? '#10b981' : '#ef4444',
                        }}
                      />
                      <span style={{ color: seat.connected ? '#6ee7b7' : '#fca5a5' }}>
                        {seat.connected ? translate('duel.online', language) : translate('duel.offline', language)}
                      </span>
                      <span style={{ marginLeft: 'auto', fontWeight: 700, color: seat.ready ? '#34d399' : '#fbbf24' }}>
                        {seat.ready ? translate('duel.ready', language) : translate('duel.notReady', language)}
                      </span>
                    </>
                  ) : (
                    <span style={{ color: '#6b7280' }}>{translate('duel.emptySeat', language)}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Instructions */}
        <div
          style={{
            background: 'rgba(255, 255, 255, 0.03)',
            borderRadius: '12px',
            padding: '12px',
            fontSize: '0.8rem',
            color: '#9ca3af',
            lineHeight: 1.5,
            marginBottom: '20px',
            display: 'flex',
            gap: '8px',
          }}
        >
          <ShieldCheck size={18} color="#f59e0b" style={{ flexShrink: 0, marginTop: '2px' }} />
          <div>
            <strong>{translate('duel.rulesTitle', language)}</strong> {translate('duel.rulesBody', language)}
          </div>
        </div>

        {/* Action Controls */}
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <button
            type="button"
            disabled={isPending}
            onClick={() => onReady(!isReady)}
            className="duel-action-btn"
            style={{
              background: isReady ? 'rgba(239, 68, 68, 0.2)' : 'rgba(16, 185, 129, 0.2)',
              color: isReady ? '#fca5a5' : '#6ee7b7',
              border: `1.5px solid ${isReady ? 'rgba(239, 68, 68, 0.4)' : 'rgba(16, 185, 129, 0.4)'}`,
              minWidth: '120px',
            }}
          >
            {isReady ? translate('duel.cancelReady', language) : translate('duel.readyButton', language)}
          </button>

          {isHost && (
            <button
              type="button"
              disabled={!canStart || isPending}
              onClick={onStart}
              className="duel-action-btn btn-primary"
              style={{
                minWidth: '140px',
                opacity: canStart ? 1 : 0.5,
                cursor: canStart ? 'pointer' : 'not-allowed',
              }}
            >
              <Play size={18} />
              <span>{translate('duel.start', language)}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
