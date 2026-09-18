import React, { useEffect, useRef, useState } from 'react';
import {
  Sparkles,
  DollarSign,
  ArrowRight,
  Check,
  X,
  Repeat,
  ShieldAlert,
  Clock,
  Eye,
  Lock,
} from 'lucide-react';
import type {
  AuctionPhase,
  AuctionRole,
  AuctionCurrentOffer,
  AuctionRoundResult,
  AuctionPrivateView,
} from '../../packages/protocol/src/auction';
import { formatMoney } from '../types/game';
import { useModalLifecycle } from '../hooks/useModalLifecycle';
import { translate, useLanguage, type TranslationKey } from '../i18n';

interface AuctionActionPanelProps {
  phase: AuctionPhase;
  myRole: AuctionRole | null;
  isSpectator: boolean;
  isPending: boolean;
  boxRound: number;
  boxesLeftToOpenThisRound: number;
  playerBoxId: number | null;
  remainingSwapBoxId: number | null;
  currentOffer: AuctionCurrentOffer | null;
  roundResults: AuctionRoundResult[];
  roundIndex: number;
  privateState: AuctionPrivateView | null;
  confirmDealPref: boolean;
  serverTimeOffset?: number;
  onAcceptOffer: (offerId: string) => void;
  onRejectOffer: (offerId: string) => void;
  onKeepBox: () => void;
  onSwapBox: (targetBoxId: number) => void;
  onSubmitBid: (amount: number) => void;
  onContinueRound: () => void;
}

export const AuctionActionPanel: React.FC<AuctionActionPanelProps> = ({
  phase,
  myRole,
  isSpectator,
  isPending,
  boxesLeftToOpenThisRound,
  playerBoxId,
  remainingSwapBoxId,
  currentOffer,
  roundResults,
  roundIndex,
  privateState,
  confirmDealPref,
  serverTimeOffset = 0,
  onAcceptOffer,
  onRejectOffer,
  onKeepBox,
  onSwapBox,
  onSubmitBid,
  onContinueRound,
}) => {
  const language = useLanguage();
  const msg = (key: TranslationKey, replacements: Record<string, string | number> = {}) =>
    Object.entries(replacements).reduce(
      (text, [name, value]) => text.replace(new RegExp(`\\{${name}\\}`, 'g'), String(value)),
      translate(key, language),
    );
  const isChallenger = myRole === 'CHALLENGER';
  const isCapitalist = myRole === 'CAPITALIST';
  const myCapital = privateState?.myCapital ?? 0;
  const myBid = privateState?.myBid ?? null;

  const [bidInput, setBidInput] = useState<string>('');
  const [bidError, setBidError] = useState<string | null>(null);
  const [confirmOfferId, setConfirmOfferId] = useState<string | null>(null);
  const confirmDialogRef = useRef<HTMLDialogElement | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const offerDeadline = currentOffer?.deadlineTimestamp ?? null;
  const isOfferExpired = offerDeadline !== null && now + serverTimeOffset >= offerDeadline;
  const isConfirmOpen = Boolean(
    confirmOfferId &&
      currentOffer &&
      currentOffer.offerId === confirmOfferId &&
      phase === 'OFFERING' &&
      !isOfferExpired
  );

  useModalLifecycle(confirmDialogRef, isConfirmOpen);

  useEffect(() => {
    if (!isConfirmOpen) {
      setConfirmOfferId(null);
    }
  }, [isConfirmOpen]);

  useEffect(() => {
    if (phase !== 'OFFERING' || !currentOffer?.deadlineTimestamp) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [phase, currentOffer?.offerId, currentOffer?.deadlineTimestamp]);

  const handleAcceptClick = () => {
    if (!currentOffer || isPending || isOfferExpired) return;
    if (confirmDealPref) {
      setConfirmOfferId(currentOffer.offerId);
      return;
    }
    onAcceptOffer(currentOffer.offerId);
  };

  const handleBidSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseInt(bidInput, 10);
    if (isNaN(parsed) || parsed <= 0) {
      setBidError(translate('auction.action.bidPositiveError', language));
      return;
    }
    if (parsed > myCapital) {
      setBidError(msg('auction.action.bidCapitalError', { amount: formatMoney(myCapital) }));
      return;
    }
    setBidError(null);
    onSubmitBid(parsed);
  };

  const handleQuickPercent = (percent: number) => {
    const val = Math.floor((myCapital * percent) / 100);
    setBidInput(String(Math.max(1, val)));
    setBidError(null);
  };

  const currentRoundResult = roundResults.find((r) => r.roundIndex === roundIndex);

  return (
    <div
      className="auction-action-panel glass-card-gold"
      style={{
        padding: '16px 20px',
        margin: '0 auto',
        maxWidth: '720px',
        width: '100%',
        boxSizing: 'border-box',
        borderRadius: '16px',
        background: 'linear-gradient(135deg, rgba(26, 18, 50, 0.95) 0%, rgba(14, 10, 30, 0.98) 100%)',
        border: '1.5px solid rgba(245, 158, 11, 0.4)',
        boxShadow: '0 8px 30px rgba(0, 0, 0, 0.7)',
        zIndex: 15,
      }}
    >
      {/* 1. SPECTATOR BANNER */}
      {isSpectator && (
        <div style={{ textAlign: 'center', color: '#67e8f9', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
          <Eye size={18} />
          <span style={{ fontSize: '0.95rem' }}>
            {translate('auction.action.spectator', language)}
          </span>
        </div>
      )}

      {/* 2. CHALLENGER PHASES */}
      {!isSpectator && isChallenger && (
        <div>
          {phase === 'SELECTING' && (
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#fcd34d', marginBottom: '4px' }}>
                  {translate('auction.action.selectTitle', language)}
              </div>
              <div style={{ fontSize: '0.85rem', color: '#9ca3af' }}>
                {translate('auction.action.selectBody', language)}
              </div>
            </div>
          )}

          {phase === 'OPENING' && (
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#ffffff', marginBottom: '4px' }}>
                {translate('auction.action.openTitle', language)}
              </div>
              <div style={{ fontSize: '0.9rem', color: '#fcd34d' }}>
                {msg('auction.action.openBody', { count: boxesLeftToOpenThisRound })}
              </div>
            </div>
          )}

          {phase === 'BIDDING' && (
            <div style={{ textAlign: 'center', padding: '6px 0' }}>
              <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#fcd34d', marginBottom: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                <Clock size={18} className="spin" />
                <span>{translate('auction.action.biddingTitle', language)}</span>
              </div>
              <div style={{ fontSize: '0.85rem', color: '#9ca3af' }}>
                {translate('auction.action.biddingBody', language)}
              </div>
            </div>
          )}

          {phase === 'OFFERING' && currentOffer && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '0.85rem', color: '#9ca3af', letterSpacing: '1px' }}>
                  {translate('auction.action.highestBid', language)}
                </div>
                <div
                  style={{
                    fontSize: '2.2rem',
                    fontWeight: 900,
                    color: '#fcd34d',
                    textShadow: '0 0 20px rgba(245, 158, 11, 0.5)',
                    margin: '4px 0',
                  }}
                >
                  {formatMoney(currentOffer.amount)}
                </div>
                <div style={{ fontSize: '0.8rem', color: '#d1d5db' }}>
                  {translate('auction.action.offerBody', language)}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '16px', width: '100%', maxWidth: '400px' }}>
                <button
                  type="button"
                  disabled={isPending || isOfferExpired}
                  onClick={handleAcceptClick}
                  className="duel-action-btn accept"
                  style={{
                    flex: 1,
                    minHeight: '48px',
                    fontSize: '1.05rem',
                    fontWeight: 900,
                    borderRadius: '12px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                  }}
                >
                  <Check size={20} />
                  <span>{translate('auction.action.deal', language)}</span>
                </button>

                <button
                  type="button"
                  disabled={isPending || isOfferExpired}
                  onClick={() => onRejectOffer(currentOffer.offerId)}
                  className="duel-action-btn reject"
                  style={{
                    flex: 1,
                    minHeight: '48px',
                    fontSize: '1.05rem',
                    fontWeight: 900,
                    borderRadius: '12px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                  }}
                >
                  <X size={20} />
                  <span>{translate('auction.action.noDeal', language)}</span>
                </button>
              </div>
            </div>
          )}

          {phase === 'FINAL_SWAP' && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '1.2rem', fontWeight: 900, color: '#fcd34d' }}>
                  {translate('auction.action.finalTitle', language)}
                </div>
                <div style={{ fontSize: '0.85rem', color: '#d1d5db', marginTop: '4px' }}>
                  {msg('auction.action.finalBody', { player: playerBoxId ?? '—', target: remainingSwapBoxId ?? '—' })}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '16px', width: '100%', maxWidth: '400px' }}>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={onKeepBox}
                  className="btn-primary"
                  style={{ flex: 1, minHeight: '48px', fontSize: '1rem', fontWeight: 800, borderRadius: '12px' }}
                >
                  {msg('auction.action.keepBox', { box: playerBoxId ?? '—' })}
                </button>

                {remainingSwapBoxId !== null && (
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => onSwapBox(remainingSwapBoxId)}
                    className="btn-secondary"
                    style={{
                      flex: 1,
                      minHeight: '48px',
                      fontSize: '1rem',
                      fontWeight: 800,
                      borderRadius: '12px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px',
                    }}
                  >
                    <Repeat size={18} />
                    <span>{msg('auction.action.swapBox', { box: remainingSwapBoxId })}</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {phase === 'ROUND_COMPLETE' && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '1.15rem', fontWeight: 800, color: '#10b981' }}>
                  {translate('auction.action.roundComplete', language)}
                </div>
                {currentRoundResult && (
                  <div style={{ fontSize: '0.9rem', color: '#ffffff', marginTop: '4px' }}>
                    {translate('auction.action.challengerProfit', language)}<strong style={{ color: '#fcd34d' }}>+{formatMoney(currentRoundResult.challengerProfit)}</strong>
                  </div>
                )}
              </div>
              <button
                type="button"
                disabled={isPending}
                onClick={onContinueRound}
                className="btn-primary"
                style={{ minHeight: '44px', padding: '8px 28px', fontSize: '1rem', fontWeight: 800, borderRadius: '12px' }}
              >
                {translate('auction.action.continueRound', language)}
              </button>
            </div>
          )}
        </div>
      )}

      <dialog
        ref={confirmDialogRef}
        aria-labelledby="auction-confirm-deal-title"
        className="history-native-dialog"
        onCancel={(event) => {
          event.preventDefault();
          setConfirmOfferId(null);
        }}
        style={{
          padding: '24px',
          borderRadius: '20px',
          border: '1.5px solid rgba(245, 158, 11, 0.4)',
          background: 'linear-gradient(135deg, #20173d 0%, #120e26 100%)',
          color: '#ffffff',
          maxWidth: '480px',
          width: '90vw',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.8), 0 0 24px rgba(245, 158, 11, 0.2)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#f59e0b', marginBottom: '12px' }}>
          <ShieldAlert size={24} />
          <h3 id="auction-confirm-deal-title" style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800 }}>
            {translate('auction.action.confirmTitle', language)}
          </h3>
        </div>
        <p style={{ fontSize: '0.95rem', color: '#d1d5db', lineHeight: 1.5, marginBottom: '20px' }}>
          {msg('auction.action.confirmBody', { amount: currentOffer ? formatMoney(currentOffer.amount) : '' })}
        </p>
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={() => setConfirmOfferId(null)}
            className="btn-secondary"
            style={{ minHeight: '44px', padding: '8px 18px' }}
          >
            {translate('auction.action.consider', language)}
          </button>
          <button
            type="button"
            disabled={isPending || isOfferExpired || !currentOffer || currentOffer.offerId !== confirmOfferId}
            onClick={() => {
              if (currentOffer && currentOffer.offerId === confirmOfferId) {
                onAcceptOffer(currentOffer.offerId);
              }
              setConfirmOfferId(null);
            }}
            className="duel-action-btn accept"
            style={{ minHeight: '44px', padding: '8px 22px' }}
          >
            {translate('auction.action.confirmDeal', language)}
          </button>
        </div>
      </dialog>

      {/* 3. CAPITALIST PHASES */}
      {!isSpectator && isCapitalist && (
        <div>
          {(phase === 'SELECTING' || phase === 'OPENING') && (
            <div style={{ textAlign: 'center', padding: '6px 0' }}>
              <div style={{ fontSize: '1rem', fontWeight: 800, color: '#9ca3af', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                <Lock size={16} />
                <span>{translate('auction.action.capitalistWaiting', language)}</span>
              </div>
              <div style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: '2px' }}>
                {translate('auction.action.capitalistWaitingBody', language)}
              </div>
            </div>
          )}

          {phase === 'BIDDING' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
                <div>
                  <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#fcd34d' }}>
                    {translate('auction.action.sealedTitle', language)}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: '#9ca3af' }}>
                    {translate('auction.action.sealedBody', language)}
                  </div>
                </div>
                <div style={{ fontSize: '0.85rem', color: '#e5e7eb' }}>
                  {translate('auction.action.availableCapital', language)}<strong style={{ color: '#fcd34d' }}>{formatMoney(myCapital)}</strong>
                </div>
              </div>

              {myBid !== null && myBid !== undefined ? (
                <div
                  style={{
                    background: 'rgba(16, 185, 129, 0.15)',
                    border: '1px solid rgba(16, 185, 129, 0.4)',
                    padding: '12px',
                    borderRadius: '10px',
                    textAlign: 'center',
                    color: '#a7f3d0',
                  }}
                >
                  <div style={{ fontSize: '1.1rem', fontWeight: 800 }}>
                    {translate('auction.action.submittedBid', language)}{formatMoney(myBid)}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: '#6ee7b7', marginTop: '2px' }}>
                    {translate('auction.action.submittedBidBody', language)}
                  </div>
                </div>
              ) : (
                <form onSubmit={handleBidSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <input
                      type="number"
                      placeholder={msg('auction.action.bidPlaceholder', { amount: formatMoney(myCapital) })}
                      value={bidInput}
                      min="1"
                      max={myCapital}
                      step="1"
                      onChange={(e) => {
                        setBidInput(e.target.value);
                        setBidError(null);
                      }}
                      className="duel-input"
                      style={{ flex: 1, minWidth: '180px' }}
                    />
                    <button
                      type="submit"
                      disabled={isPending || !bidInput}
                      className="btn-primary"
                      style={{ minHeight: '44px', padding: '8px 24px', fontWeight: 800, borderRadius: '12px' }}
                    >
                      {translate('auction.action.submitBid', language)}
                    </button>
                  </div>

                  {/* Quick percentage buttons */}
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.75rem', color: '#9ca3af', alignSelf: 'center', marginRight: '4px' }}>
                      {translate('auction.action.quickBid', language)}
                    </span>
                    {[10, 25, 50, 75, 100].map((pct) => (
                      <button
                        key={pct}
                        type="button"
                        onClick={() => handleQuickPercent(pct)}
                        className="btn-secondary"
                        style={{ minHeight: '30px', padding: '2px 10px', fontSize: '0.75rem', borderRadius: '6px' }}
                      >
                        {pct === 100 ? translate('auction.action.allCapital', language) : `${pct}%`}
                      </button>
                    ))}
                  </div>

                  {bidError && (
                    <div style={{ fontSize: '0.8rem', color: '#f87171' }}>
                      {bidError}
                    </div>
                  )}
                </form>
              )}
            </div>
          )}

          {phase === 'OFFERING' && (
            <div style={{ textAlign: 'center', padding: '6px 0' }}>
              <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#fcd34d', marginBottom: '4px' }}>
                {msg('auction.action.offerDelivered', { amount: formatMoney(currentOffer?.amount ?? 0) })}
              </div>
              <div style={{ fontSize: '0.85rem', color: '#9ca3af' }}>
                {translate('auction.action.offerDeliveredBody', language)}
              </div>
            </div>
          )}

          {phase === 'FINAL_SWAP' && (
            <div style={{ textAlign: 'center', padding: '6px 0' }}>
              <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#fcd34d', marginBottom: '4px' }}>
                {translate('auction.action.finalWatching', language)}
              </div>
              <div style={{ fontSize: '0.85rem', color: '#9ca3af' }}>
                {translate('auction.action.finalWatchingBody', language)}
              </div>
            </div>
          )}

          {phase === 'ROUND_COMPLETE' && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '1.15rem', fontWeight: 800, color: '#10b981' }}>
                  {translate('auction.action.roundComplete', language)}
                </div>
                {currentRoundResult && currentRoundResult.winningCapitalistSeatId !== null && (
                  <div style={{ fontSize: '0.85rem', color: '#ffffff', marginTop: '2px' }}>
                    {translate('auction.action.capitalistProfit', language)}{formatMoney(currentRoundResult.capitalistProfits[currentRoundResult.winningCapitalistSeatId!] ?? 0)}
                  </div>
                )}
              </div>
              <button
                type="button"
                disabled={isPending}
                onClick={onContinueRound}
                className="btn-primary"
                style={{ minHeight: '44px', padding: '8px 28px', fontSize: '1rem', fontWeight: 800, borderRadius: '12px' }}
              >
                {translate('auction.action.roundReady', language)}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
