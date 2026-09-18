import React from 'react';
import { User, Shield, Check, DollarSign, Crown, WifiOff } from 'lucide-react';
import type { AuctionSeatInfo, AuctionPrivateView, AuctionPhase } from '../../packages/protocol/src/auction';
import { formatMoney } from '../types/game';
import { translate, useLanguage, type TranslationKey } from '../i18n';

interface AuctionSeatListProps {
  seats: AuctionSeatInfo[];
  mySeatId: number | null;
  challengerSeatId: number | null;
  phase: AuctionPhase;
  bidsSubmittedSeats: number[];
  privateState: AuctionPrivateView | null;
}

export const AuctionSeatList: React.FC<AuctionSeatListProps> = ({
  seats,
  mySeatId,
  challengerSeatId,
  phase,
  bidsSubmittedSeats,
  privateState,
}) => {
  const language = useLanguage();
  const msg = (key: TranslationKey) => translate(key, language);
  return (
    <div
      className="auction-seat-list glass-panel"
      style={{
        display: 'flex',
        gap: '8px',
        padding: '8px 12px',
        overflowX: 'auto',
        overflowY: 'hidden',
        background: 'rgba(10, 8, 20, 0.75)',
        borderBottom: '1px solid rgba(245, 158, 11, 0.2)',
        WebkitOverflowScrolling: 'touch',
        minHeight: '68px',
        alignItems: 'center',
        boxSizing: 'border-box',
      }}
      role="region"
      aria-label={msg('auction.seatList.aria')}
    >
      {seats
        .filter((s) => s.occupied)
        .map((seat) => {
          const isMe = seat.seatId === mySeatId;
          const isChallenger = seat.seatId === challengerSeatId;
          const hasBid = bidsSubmittedSeats.includes(seat.seatId);
          const isForfeited = seat.forfeited;
          const isOffline = !seat.connected;

          return (
            <div
              key={seat.seatId}
              style={{
                flex: '0 0 auto',
                minWidth: '150px',
                padding: '6px 10px',
                borderRadius: '10px',
                background: isMe
                  ? 'rgba(245, 158, 11, 0.16)'
                  : isChallenger
                  ? 'rgba(6, 182, 212, 0.12)'
                  : 'rgba(255, 255, 255, 0.04)',
                border: isMe
                  ? '1.5px solid #f59e0b'
                  : isChallenger
                  ? '1.5px solid #06b6d4'
                  : '1px solid rgba(255, 255, 255, 0.1)',
                opacity: isForfeited ? 0.5 : 1,
                display: 'flex',
                flexDirection: 'column',
                gap: '2px',
              }}
            >
              {/* Row 1: Nickname & Role Badge */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '4px' }}>
                <span
                  style={{
                    fontSize: '0.85rem',
                    fontWeight: 800,
                    color: isMe ? '#fcd34d' : '#ffffff',
                    maxWidth: '90px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={seat.nickname}
                >
                  {seat.nickname} {isMe && `(${msg('auction.seatList.me')})`}
                </span>

                {isForfeited ? (
                  <span style={{ fontSize: '0.65rem', padding: '1px 5px', borderRadius: '4px', background: 'rgba(239, 68, 68, 0.2)', color: '#f87171' }}>
                    {msg('auction.seatList.forfeited')}
                  </span>
                ) : isOffline ? (
                  <span style={{ fontSize: '0.65rem', padding: '1px 5px', borderRadius: '4px', background: 'rgba(156, 163, 175, 0.2)', color: '#9ca3af', display: 'flex', alignItems: 'center', gap: '2px' }}>
                    <WifiOff size={10} /> {msg('auction.seatList.offline')}
                  </span>
                ) : isChallenger ? (
                  <span style={{ fontSize: '0.65rem', padding: '1px 5px', borderRadius: '4px', background: 'rgba(6, 182, 212, 0.25)', color: '#67e8f9', display: 'flex', alignItems: 'center', gap: '2px' }}>
                    <Crown size={10} /> {msg('auction.seatList.challenger')}
                  </span>
                ) : (
                  <span style={{ fontSize: '0.65rem', padding: '1px 5px', borderRadius: '4px', background: 'rgba(245, 158, 11, 0.2)', color: '#fcd34d' }}>
                    {msg('auction.seatList.capitalist')}
                  </span>
                )}
              </div>

              {/* Row 2: Score & Capital */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.75rem', color: '#9ca3af' }}>
                <span>{msg('auction.seatList.score')}</span>
                <strong style={{ color: seat.score >= 0 ? '#10b981' : '#ef4444' }}>
                  {formatMoney(seat.score)}
                </strong>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.75rem', color: '#9ca3af' }}>
                <span>{msg('auction.seatList.capital')}</span>
                <strong style={{ color: isMe ? '#fcd34d' : '#6b7280' }}>
                  {isMe ? formatMoney(privateState?.myCapital ?? 0) : msg('auction.seatList.hidden')}
                </strong>
              </div>

              {/* Row 3: Bidding Phase Status */}
              {phase === 'BIDDING' && !isChallenger && (
                <div style={{ marginTop: '2px', fontSize: '0.7rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ color: '#9ca3af' }}>{msg('auction.seatList.bid')}</span>
                  {isMe ? (
                    privateState?.myBid !== undefined && privateState?.myBid !== null ? (
                      <span style={{ color: '#10b981', fontWeight: 800 }}>
                        {formatMoney(privateState.myBid)}
                      </span>
                    ) : (
                        <span style={{ color: '#f59e0b' }}>{msg('auction.seatList.waitBid')}</span>
                    )
                  ) : hasBid ? (
                    <span style={{ color: '#10b981', display: 'flex', alignItems: 'center', gap: '2px' }}>
                      <Check size={11} /> {msg('auction.seatList.bidSubmitted')}
                    </span>
                  ) : (
                    <span style={{ color: '#6b7280' }}>{msg('auction.seatList.thinking')}</span>
                  )}
                </div>
              )}
            </div>
          );
        })}
    </div>
  );
};
