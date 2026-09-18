import React, { useState, useEffect, useRef } from 'react';
import type {
  DuelPhase,
  DuelPrivateView,
  DuelOfferRange,
  DuelRoundResult,
  DuelSeatInfo,
  DuelSeatId,
} from '../../../packages/protocol/src/duel';
import type { PublicOffer } from '../../../packages/protocol/src/types';
import { formatMoney } from '../../types/game';
import { useModalLifecycle } from '../../hooks/useModalLifecycle';
import { Check, X, ArrowLeftRight, ShieldAlert, Play } from 'lucide-react';
import { translate, useLanguage, type TranslationKey } from '../../i18n';

interface DuelActionPanelProps {
  phase: DuelPhase;
  boxRound: number;
  boxesLeftToOpenThisRound: number;
  playerBoxId: number | null;
  remainingSwapBoxId: number | null;
  currentOffer: PublicOffer | null;
  privateState: DuelPrivateView | null;
  seats: [DuelSeatInfo, DuelSeatInfo];
  roundResults: DuelRoundResult[];
  roundIndex?: number;
  confirmDealPref: boolean;
  isPending: boolean;
  canAct: boolean;
  serverTimeOffset?: number;
  onSubmitOffer: (amount: number) => void;
  onAcceptOffer: (offerId: string) => void;
  onRejectOffer: (offerId: string) => void;
  onKeepBox: () => void;
  onSwapBox: (targetBoxId: number) => void;
  onContinueRound: () => void;
}

export const DuelActionPanel: React.FC<DuelActionPanelProps> = ({
  phase,
  boxRound,
  boxesLeftToOpenThisRound,
  playerBoxId,
  remainingSwapBoxId,
  currentOffer,
  privateState,
  seats,
  roundResults,
  roundIndex,
  confirmDealPref,
  isPending,
  canAct,
  serverTimeOffset = 0,
  onSubmitOffer,
  onAcceptOffer,
  onRejectOffer,
  onKeepBox,
  onSwapBox,
  onContinueRound,
}) => {
  const language = useLanguage();
  const msg = (key: TranslationKey, replacements: Record<string, string | number> = {}) =>
    Object.entries(replacements).reduce(
      (text, [name, value]) => text.replace(new RegExp(`\\{${name}\\}`, 'g'), String(value)),
      translate(key, language),
    );
  const mySeatId: DuelSeatId | null = privateState?.seatId ?? null;
  const mySeat = mySeatId !== null ? seats[mySeatId] : null;
  const isChallenger = mySeat?.role === 'CHALLENGER';
  const isBanker = mySeat?.role === 'BANKER';

  const allowedActions = privateState?.allowedActions ?? [];

  // Banker offer state
  const offerRange: DuelOfferRange = privateState?.offerRange ?? { min: 1, max: 1000000, step: 1 };
  const [offerInput, setOfferInput] = useState<string>('');
  const [offerError, setOfferError] = useState<string | null>(null);

  // Challenger confirm deal modal state
  const [dealModalOfferId, setDealModalOfferId] = useState<string | null>(null);
  const dealDialogRef = useRef<HTMLDialogElement | null>(null);
  const isDealModalOpen = Boolean(dealModalOfferId && currentOffer && currentOffer.offerId === dealModalOfferId);

  useModalLifecycle(dealDialogRef, isDealModalOpen);

  // Live timer for reactive offer expiration calculation
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!currentOffer || typeof currentOffer.expiresAt !== 'number') return;
    const interval = setInterval(() => {
      setNow(Date.now());
    }, 500);
    return () => clearInterval(interval);
  }, [currentOffer]);

  // Check offer expiration against server deadline
  const isOfferExpired = Boolean(
    currentOffer &&
      typeof currentOffer.expiresAt === 'number' &&
      now + serverTimeOffset >= currentOffer.expiresAt
  );

  // If phase changes or offer changes/expires, automatically close confirm deal modal
  useEffect(() => {
    if (phase !== 'OFFERING' || !currentOffer || currentOffer.offerId !== dealModalOfferId || isOfferExpired) {
      setDealModalOfferId(null);
    }
  }, [phase, currentOffer, dealModalOfferId, isOfferExpired]);

  // Reset banker offer input when phase changes to SUBMITTING_OFFER
  useEffect(() => {
    if (phase === 'SUBMITTING_OFFER') {
      setOfferInput('');
      setOfferError(null);
    }
  }, [phase]);

  const handleBankerOfferSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canAct || isPending || !allowedActions.includes('SUBMIT_OFFER')) return;
    const val = parseInt(offerInput, 10);
    if (isNaN(val) || val < offerRange.min || val > offerRange.max) {
      setOfferError(msg('duel.action.offerRangeError', { min: formatMoney(offerRange.min), max: formatMoney(offerRange.max) }));
      return;
    }
    setOfferError(null);
    onSubmitOffer(val);
  };

  const handleAcceptClick = () => {
    if (!currentOffer || !canAct || isPending || isOfferExpired) return;
    if (confirmDealPref) {
      setDealModalOfferId(currentOffer.offerId);
    } else {
      onAcceptOffer(currentOffer.offerId);
    }
  };

  return (
    <div className="duel-action-dock" role="region" aria-label={translate('duel.action.aria', language)}>
      {/* 1. SELECTING PHASE */}
      {phase === 'SELECTING' && (
        <div className="duel-action-prompt">
          {isChallenger ? (
            <span>{translate('duel.action.selectChallenger', language)}</span>
          ) : (
            <span>{translate('duel.action.selectWaiting', language)}</span>
          )}
        </div>
      )}

      {/* 2. OPENING PHASE */}
      {phase === 'OPENING' && (
        <div className="duel-action-prompt">
          {!canAct ? (
            <span>{translate('duel.action.openingReveal', language)}</span>
          ) : isChallenger ? (
            <span>{msg('duel.action.openingPrompt', { round: boxRound, count: boxesLeftToOpenThisRound })}</span>
          ) : (
            <span>{msg('duel.action.openingWatching', { count: boxesLeftToOpenThisRound })}</span>
          )}
        </div>
      )}

      {/* 3. SUBMITTING_OFFER PHASE */}
      {phase === 'SUBMITTING_OFFER' && (
        <div style={{ width: '100%', maxWidth: '500px', textAlign: 'center' }}>
          {isBanker ? (
            <form onSubmit={handleBankerOfferSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div className="duel-action-prompt">
                {msg('duel.action.offerPrompt', { min: formatMoney(offerRange.min), max: formatMoney(offerRange.max) })}
              </div>
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
                <input
                  type="number"
                  min={offerRange.min}
                  max={offerRange.max}
                  step={offerRange.step}
                  placeholder={msg('duel.action.offerPlaceholder', { min: formatMoney(offerRange.min) })}
                  value={offerInput}
                  onChange={(e) => {
                    setOfferInput(e.target.value);
                    setOfferError(null);
                  }}
                  className="duel-input"
                  style={{ flex: 1, maxWidth: '280px', textAlign: 'center', fontSize: '1.1rem', fontWeight: 800 }}
                  autoFocus
                  disabled={!canAct || isPending || !allowedActions.includes('SUBMIT_OFFER')}
                />
                <button
                  type="submit"
                  disabled={!canAct || isPending || !offerInput || !allowedActions.includes('SUBMIT_OFFER')}
                  className="duel-action-btn btn-primary"
                  style={{ minWidth: '110px' }}
                >
                  {translate('duel.action.submitOffer', language)}
                </button>
              </div>
              {offerError && (
                <div style={{ color: '#f87171', fontSize: '0.8rem', fontWeight: 700 }}>
                  {offerError}
                </div>
              )}
            </form>
          ) : (
            <div className="duel-action-prompt">
              {msg('duel.action.offerWaiting', { round: boxRound })}
            </div>
          )}
        </div>
      )}

      {/* 4. OFFERING PHASE */}
      {phase === 'OFFERING' && currentOffer && (
        <div style={{ width: '100%', textAlign: 'center' }}>
          <div style={{ marginBottom: '8px' }}>
            <span style={{ fontSize: '0.9rem', color: '#d1d5db' }}>{msg('duel.action.currentOffer', { round: boxRound })}</span>
            <span style={{ fontSize: '1.6rem', fontWeight: 900, color: '#34d399', marginLeft: '6px' }}>
              {formatMoney(currentOffer.amount)}
            </span>
          </div>

          {isChallenger ? (
            <div className="duel-btn-row">
              <button
                type="button"
                disabled={!canAct || isPending || !allowedActions.includes('ACCEPT_OFFER') || isOfferExpired}
                onClick={handleAcceptClick}
                className="duel-action-btn accept"
              >
                <Check size={18} />
                <span>{translate('duel.action.acceptOffer', language)}</span>
              </button>
              <button
                type="button"
                disabled={!canAct || isPending || !allowedActions.includes('REJECT_OFFER') || isOfferExpired}
                onClick={() => onRejectOffer(currentOffer.offerId)}
                className="duel-action-btn reject"
              >
                <X size={18} />
                <span>{translate('duel.action.rejectOffer', language)}</span>
              </button>
            </div>
          ) : (
            <div className="duel-action-prompt">
              {translate('duel.action.offerWaitingDecision', language)}
            </div>
          )}
        </div>
      )}

      {/* 5. FINAL_SWAP PHASE */}
      {phase === 'FINAL_SWAP' && (
        <div style={{ width: '100%', textAlign: 'center' }}>
          <div className="duel-action-prompt" style={{ marginBottom: '10px' }}>
            {msg('duel.action.finalBoxes', { player: playerBoxId ?? '—', target: remainingSwapBoxId ?? '—' })}
          </div>

          {isChallenger ? (
            <div className="duel-btn-row">
              <button
                type="button"
                disabled={!canAct || isPending || !allowedActions.includes('KEEP_BOX')}
                onClick={onKeepBox}
                className="duel-action-btn keep"
              >
                <span>{msg('duel.action.keepBox', { box: playerBoxId ?? '—' })}</span>
              </button>
              {remainingSwapBoxId !== null && (
                <button
                  type="button"
                  disabled={!canAct || isPending || !allowedActions.includes('SWAP_BOX')}
                  onClick={() => onSwapBox(remainingSwapBoxId)}
                  className="duel-action-btn swap"
                >
                  <ArrowLeftRight size={18} />
                  <span>{msg('duel.action.swapBox', { box: remainingSwapBoxId })}</span>
                </button>
              )}
            </div>
          ) : (
            <div className="duel-action-prompt">
              {translate('duel.action.finalWaiting', language)}
            </div>
          )}
        </div>
      )}

      {/* 6. ROUND_COMPLETE PHASE */}
      {phase === 'ROUND_COMPLETE' && (() => {
        const latestRoundResult = roundResults.length > 0 ? roundResults[roundResults.length - 1] : null;
        const displayRoundIndex = roundIndex ?? (latestRoundResult?.roundIndex ?? 1);

        return (
          <div style={{ width: '100%', maxWidth: '540px', textAlign: 'center' }}>
            <div style={{ fontSize: '1.15rem', fontWeight: 800, color: '#fcd34d', marginBottom: '8px' }}>
              {msg('duel.action.roundComplete', { round: displayRoundIndex })}
            </div>

            {latestRoundResult && (
              <div
                style={{
                  background: 'rgba(0, 0, 0, 0.4)',
                  borderRadius: '12px',
                  padding: '10px 16px',
                  marginBottom: '12px',
                  display: 'flex',
                  justifyContent: 'space-around',
                  fontSize: '0.9rem',
                }}
              >
                <div>
                  <span style={{ color: '#9ca3af' }}>{translate('duel.action.challengerProfit', language)}</span>
                  <strong style={{ color: latestRoundResult.challengerProfit >= 0 ? '#34d399' : '#f87171' }}>
                    {latestRoundResult.challengerProfit >= 0 ? '+' : ''}{formatMoney(latestRoundResult.challengerProfit)}
                  </strong>
                </div>
                <div>
                  <span style={{ color: '#9ca3af' }}>{translate('duel.action.bankerProfit', language)}</span>
                  <strong style={{ color: latestRoundResult.bankerProfit >= 0 ? '#34d399' : '#f87171' }}>
                    {latestRoundResult.bankerProfit >= 0 ? '+' : ''}{formatMoney(latestRoundResult.bankerProfit)}
                  </strong>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.85rem', color: '#d1d5db' }}>
                {displayRoundIndex < 2
                  ? translate('duel.action.nextRound', language)
                  : translate('duel.action.finalSettlement', language)}
              </span>
              <button
                type="button"
                disabled={!canAct || isPending || !allowedActions.includes('CONTINUE_ROUND') || mySeat?.continueReady}
                onClick={onContinueRound}
                className="duel-action-btn btn-primary"
                style={{ minHeight: '40px', padding: '8px 18px', fontSize: '0.85rem' }}
              >
                <Play size={16} />
                <span>{mySeat?.continueReady ? translate('duel.action.ready', language) : translate('duel.action.continue', language)}</span>
              </button>
            </div>
          </div>
        );
      })()}

      {/* Deal Confirmation Native Dialog */}
      <dialog
        ref={dealDialogRef}
        aria-labelledby="confirm-deal-title"
        className="history-native-dialog"
        onCancel={(e) => {
          e.preventDefault();
          setDealModalOfferId(null);
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
          <h3 id="confirm-deal-title" style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800 }}>
            {translate('duel.action.confirmTitle', language)}
          </h3>
        </div>
        <p style={{ fontSize: '0.95rem', color: '#d1d5db', lineHeight: 1.5, marginBottom: '20px' }}>
          {msg('duel.action.confirmBody', { amount: currentOffer ? formatMoney(currentOffer.amount) : '' })}
        </p>
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={() => setDealModalOfferId(null)}
            className="btn-secondary"
            style={{ minHeight: '44px', padding: '8px 18px' }}
          >
            {translate('duel.action.consider', language)}
          </button>
          <button
            type="button"
            disabled={!canAct || isPending || isOfferExpired}
            onClick={() => {
              if (currentOffer) {
                onAcceptOffer(currentOffer.offerId);
              }
              setDealModalOfferId(null);
            }}
            className="duel-action-btn accept"
            style={{ minHeight: '44px', padding: '8px 22px' }}
          >
            {translate('duel.action.confirmDeal', language)}
          </button>
        </div>
      </dialog>
    </div>
  );
};
