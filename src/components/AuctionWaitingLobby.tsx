import React, { useState } from 'react';
import {
  Users,
  Crown,
  CheckCircle2,
  Clock,
  LogOut,
  Play,
  Copy,
  Check,
  Eye,
  EyeOff,
  Sparkles,
  Lock,
  Globe,
  Trophy,
} from 'lucide-react';
import type { AuctionPublicSnapshot } from '../../packages/protocol/src/auction';
import { AUCTION_MIN_PLAYERS, AUCTION_MAX_PLAYERS, AUCTION_MAX_SPECTATORS } from '../../packages/protocol/src/auction';
import { InviteQr } from './InviteQr';
import { translate, useLanguage } from '../i18n';

interface AuctionWaitingLobbyProps {
  roomId: string;
  publicState: AuctionPublicSnapshot;
  mySeatId: number | null;
  isHost: boolean;
  isSpectator: boolean;
  isPending: boolean;
  onReady: (ready: boolean) => void;
  onStart: () => void;
  onLeave: () => void;
}

export const AuctionWaitingLobby: React.FC<AuctionWaitingLobbyProps> = ({
  roomId,
  publicState,
  mySeatId,
  isHost,
  isSpectator,
  isPending,
  onReady,
  onStart,
  onLeave,
}) => {
  const [copied, setCopied] = useState(false);
  const language = useLanguage();
  const inviteUrl = `${window.location.origin}/auction?room=${encodeURIComponent(roomId)}`;

  const handleCopyLink = () => {
    navigator.clipboard.writeText(inviteUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const seats = publicState.seats || [];
  const occupiedSeats = seats.filter((s) => s.occupied);
  const occupiedCount = occupiedSeats.length;
  const allReady =
    occupiedCount >= AUCTION_MIN_PLAYERS &&
    occupiedSeats.every((s) => s.ready && s.connected);

  const mySeat = mySeatId !== null ? seats.find((s) => s.seatId === mySeatId) : null;
  const isMyReady = mySeat?.ready ?? false;

  return (
    <div className="duel-entrance-overlay" style={{ zIndex: 60 }}>
      <div className="duel-card" style={{ maxWidth: '640px', width: '100%' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <div className="duel-title" style={{ margin: 0 }}>
            <Users size={26} color="#f59e0b" />
            <span>{translate('auction.waitingTitle', language)}</span>
          </div>
          <button
            type="button"
            onClick={onLeave}
            className="btn-secondary"
            style={{ minHeight: '36px', padding: '4px 12px', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <LogOut size={16} />
            <span>{translate('auction.leaveRoom', language)}</span>
          </button>
        </div>

        {/* Room ID Badge & Copy Button */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'rgba(0, 0, 0, 0.4)',
            border: '1px solid rgba(245, 158, 11, 0.3)',
            borderRadius: '12px',
            padding: '10px 16px',
            marginBottom: '12px',
            flexWrap: 'wrap',
            gap: '8px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '0.85rem', color: '#9ca3af' }}>{translate('auction.roomCode', language)}</span>
            <span style={{ fontFamily: 'monospace', fontSize: '1.2rem', fontWeight: 800, color: '#fcd34d' }}>
              {roomId}
            </span>
          </div>
          <button
            type="button"
            onClick={handleCopyLink}
            className="btn-primary"
            style={{
              minHeight: '36px',
              padding: '6px 14px',
              fontSize: '0.85rem',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            {copied ? <Check size={16} /> : <Copy size={16} />}
            <span>{copied ? translate('duel.copiedInvite', language) : translate('duel.copyInvite', language)}</span>
          </button>
        </div>
        <InviteQr url={inviteUrl} />

        {/* Room Configuration Badges */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            flexWrap: 'wrap',
            marginBottom: '14px',
          }}
        >
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              padding: '4px 10px',
              borderRadius: '8px',
              fontSize: '0.8rem',
              fontWeight: 600,
              background: publicState.isPrivate ? 'rgba(239, 68, 68, 0.15)' : 'rgba(16, 185, 129, 0.15)',
              border: publicState.isPrivate ? '1px solid rgba(239, 68, 68, 0.3)' : '1px solid rgba(16, 185, 129, 0.3)',
              color: publicState.isPrivate ? '#fca5a5' : '#6ee7b7',
            }}
          >
            {publicState.isPrivate ? <Lock size={13} /> : <Globe size={13} />}
            <span>{publicState.isPrivate ? translate('auction.private', language) : translate('auction.public', language)}</span>
          </div>

          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              padding: '4px 10px',
              borderRadius: '8px',
              fontSize: '0.8rem',
              fontWeight: 600,
              background: publicState.ranked ? 'rgba(245, 158, 11, 0.15)' : 'rgba(156, 163, 175, 0.15)',
              border: publicState.ranked ? '1px solid rgba(245, 158, 11, 0.3)' : '1px solid rgba(156, 163, 175, 0.3)',
              color: publicState.ranked ? '#fcd34d' : '#d1d5db',
            }}
          >
            <Trophy size={13} />
            <span>{publicState.ranked ? translate('auction.ranked', language) : translate('auction.unranked', language)}</span>
          </div>

          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              padding: '4px 10px',
              borderRadius: '8px',
              fontSize: '0.8rem',
              fontWeight: 600,
              background: publicState.allowSpectators ? 'rgba(6, 182, 212, 0.15)' : 'rgba(107, 114, 128, 0.15)',
              border: publicState.allowSpectators ? '1px solid rgba(6, 182, 212, 0.3)' : '1px solid rgba(107, 114, 128, 0.3)',
              color: publicState.allowSpectators ? '#67e8f9' : '#9ca3af',
            }}
          >
            {publicState.allowSpectators ? <Eye size={13} /> : <EyeOff size={13} />}
            <span>{publicState.allowSpectators ? translate('auction.allowSpectators', language) : translate('auction.noSpectators', language)}</span>
          </div>
        </div>

        {/* Notice Info */}
        <div
          style={{
            fontSize: '0.85rem',
            color: '#d1d5db',
            marginBottom: '16px',
            background: 'rgba(245, 158, 11, 0.08)',
            padding: '10px 14px',
            borderRadius: '10px',
            border: '1px solid rgba(245, 158, 11, 0.2)',
          }}
        >
            <span>{translate('auction.notice', language)
              .replace('{min}', String(AUCTION_MIN_PLAYERS))
              .replace('{max}', String(AUCTION_MAX_PLAYERS))
              .replace('{players}', String(occupiedCount))
              .replace('{maxPlayers}', String(AUCTION_MAX_PLAYERS))
              .replace('{spectators}', publicState.allowSpectators ? `${publicState.spectatorCount} / ${AUCTION_MAX_SPECTATORS}` : translate('auction.noSpectators', language))}</span>
        </div>

        {/* Seat Grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
            gap: '10px',
            marginBottom: '20px',
            maxHeight: '260px',
            overflowY: 'auto',
            paddingRight: '4px',
          }}
        >
          {Array.from({ length: AUCTION_MAX_PLAYERS }, (_, idx) => {
            const seat = seats.find((s) => s.seatId === idx);
            const isOcc = Boolean(seat && seat.occupied);
            const isMe = seat && seat.seatId === mySeatId;
            const isSeatHost = publicState.hostSeatId === idx;

            return (
              <div
                key={idx}
                style={{
                  background: isOcc
                    ? isMe
                      ? 'rgba(245, 158, 11, 0.15)'
                      : 'rgba(255, 255, 255, 0.05)'
                    : 'rgba(0, 0, 0, 0.2)',
                  border: isOcc
                    ? isMe
                      ? '1.5px solid #f59e0b'
                      : '1px solid rgba(255, 255, 255, 0.15)'
                    : '1px dashed rgba(255, 255, 255, 0.1)',
                  borderRadius: '12px',
                  padding: '10px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                  position: 'relative',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '0.75rem', color: '#9ca3af', fontWeight: 700 }}>
                    {translate('auction.seat', language).replace('{number}', String(idx + 1))}
                  </span>
                  {isSeatHost && (
                    <span title={translate('auction.host', language)} style={{ display: 'inline-flex', alignItems: 'center' }}>
                      <Crown size={14} color="#f59e0b" />
                    </span>
                  )}
                </div>

                {isOcc && seat ? (
                  <>
                    <div
                      style={{
                        fontSize: '0.9rem',
                        fontWeight: 800,
                        color: isMe ? '#fcd34d' : '#ffffff',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={seat.nickname}
                    >
                      {seat.nickname} {isMe && translate('auction.you', language)}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem', marginTop: '2px' }}>
                      {!seat.connected ? (
                        <span style={{ color: '#ef4444' }}>{translate('auction.offline', language)}</span>
                      ) : seat.ready ? (
                        <span style={{ color: '#10b981', display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
                          <CheckCircle2 size={12} /> {translate('auction.ready', language)}
                        </span>
                      ) : (
                        <span style={{ color: '#f59e0b', display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
                          <Clock size={12} /> {translate('auction.waitReady', language)}
                        </span>
                      )}
                    </div>
                  </>
                ) : (
                  <div style={{ fontSize: '0.8rem', color: '#6b7280', margin: 'auto 0' }}>
                    {translate('auction.emptySeat', language)}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Spectator Notice if current user is spectator */}
        {isSpectator && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              color: '#67e8f9',
              background: 'rgba(6, 182, 212, 0.1)',
              border: '1px solid rgba(6, 182, 212, 0.3)',
              borderRadius: '10px',
              padding: '10px 14px',
              marginBottom: '16px',
              fontSize: '0.85rem',
            }}
          >
            <Eye size={18} />
            <span>{translate('auction.spectatorNotice', language)}</span>
          </div>
        )}

        {/* Actions Footer */}
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          {!isSpectator && (
            <button
              type="button"
              disabled={isPending}
              onClick={() => onReady(!isMyReady)}
              className={isMyReady ? 'duel-action-btn reject' : 'btn-primary'}
              style={{
                minHeight: '44px',
                padding: '8px 24px',
                fontSize: '0.95rem',
                borderRadius: '12px',
                fontWeight: 800,
                cursor: isPending ? 'not-allowed' : 'pointer',
              }}
            >
              {isMyReady ? translate('auction.cancelReady', language) : translate('auction.readyButton', language)}
            </button>
          )}

          {isHost && (
            <button
              type="button"
              disabled={!allReady || isPending}
              onClick={onStart}
              className="btn-primary"
              style={{
                minHeight: '44px',
                padding: '8px 28px',
                fontSize: '0.95rem',
                borderRadius: '12px',
                fontWeight: 800,
                opacity: allReady && !isPending ? 1 : 0.5,
                cursor: allReady && !isPending ? 'pointer' : 'not-allowed',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <Play size={18} />
              <span>{translate('auction.start', language)}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
