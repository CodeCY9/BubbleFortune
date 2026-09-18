import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Check, Play, Info, AlertTriangle, History, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import type { AiType, PublicOfferHistoryEntry } from '../../packages/protocol/src/types';
import { formatMoney } from '../types/game';
import { validateDealAcceptance } from '../utils/preferences';
import { getAiPresentation, translate, useLanguage, type TranslationKey } from '../i18n';

const AI_PROFILES: Record<
  AiType,
  {
    avatar: string;
  }
> = {
  conservative: {
    avatar: '/assets/character_banker_thinking.png',
  },
  aggressive: {
    avatar: '/assets/character_banker_confident.png',
  },
  cold: {
    avatar: '/assets/character_banker_sinister.png',
  },
  inducement: {
    avatar: '/assets/character_banker_explaining.png',
  },
  crazy: {
    avatar: '/assets/character_banker_pointing.png',
  },
};

interface BankerModalProps {
  bankerOffer: number;
  offerId?: string | null;
  currentRound: number;
  aiType?: AiType;
  offerHistory?: PublicOfferHistoryEntry[];
  onAcceptDeal: () => void;
  onRejectDeal: () => void;
  isPending?: boolean;
  remainingMoneyNode?: React.ReactNode;
  confirmDeal?: boolean;
  deadlineTimestamp?: number | null;
  serverTimeOffset?: number;
  reducedMotion?: boolean;
  acceptDisabled?: boolean;
  acceptDisabledLabel?: string;
  onDeclineRaise?: () => void;
  raiseDeclineAvailable?: boolean;
}

export const BankerModal: React.FC<BankerModalProps> = ({
  bankerOffer,
  offerId,
  currentRound,
  aiType = 'conservative',
  offerHistory = [],
  onAcceptDeal,
  onRejectDeal,
  isPending = false,
  remainingMoneyNode,
  confirmDeal = false,
  deadlineTimestamp = null,
  serverTimeOffset = 0,
  reducedMotion = false,
  acceptDisabled = false,
  acceptDisabledLabel,
  onDeclineRaise,
  raiseDeclineAvailable = false,
}) => {
  const language = useLanguage();
  const msg = (key: TranslationKey, vars?: Record<string, string | number>) => {
    let value = translate(key, language);
    for (const [name, replacement] of Object.entries(vars ?? {})) {
      value = value.replace(new RegExp(`\\{${name}\\}`, 'g'), String(replacement));
    }
    return value;
  };
  const profile = AI_PROFILES[aiType] || AI_PROFILES.conservative;
  const localizedProfile = getAiPresentation(aiType, language);
  const quoteKeyByAi: Record<AiType, TranslationKey> = {
    conservative: 'banker.quote.conservative',
    aggressive: 'banker.quote.aggressive',
    cold: 'banker.quote.cold',
    inducement: 'banker.quote.inducement',
    crazy: 'banker.quote.crazy',
  };
  const serverDialogue = offerId
    ? offerHistory.find((item) => item.offerId === offerId)?.dialogue
    : undefined;
  const displayedDialogue = serverDialogue || msg(quoteKeyByAi[aiType]);
  const [displayedOffer, setDisplayedOffer] = useState(bankerOffer);
  const [confirmingOffer, setConfirmingOffer] = useState<{
    offerId: string;
    amount: number;
  } | null>(null);

  const acceptBtnRef = useRef<HTMLButtonElement | null>(null);
  const confirmDialogRef = useRef<HTMLDialogElement | null>(null);
  const confirmAcceptBtnRef = useRef<HTMLButtonElement | null>(null);
  const historyRailRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (historyRailRef.current) {
      historyRailRef.current.scrollLeft = historyRailRef.current.scrollWidth;
    }
  }, [offerHistory.length]);

  // Animate offer display unless reducedMotion is active
  useEffect(() => {
    if (reducedMotion) {
      setDisplayedOffer(bankerOffer);
      return;
    }

    let start = 0;
    const duration = 800;
    const stepTime = 20;
    const steps = duration / stepTime;
    const increment = bankerOffer / steps;

    const timer = setInterval(() => {
      start += increment;
      if (start >= bankerOffer) {
        setDisplayedOffer(bankerOffer);
        clearInterval(timer);
      } else {
        setDisplayedOffer(Math.round(start));
      }
    }, stepTime);

    return () => clearInterval(timer);
  }, [bankerOffer, reducedMotion]);

  const closeConfirmDialog = useCallback(() => {
    setConfirmingOffer(null);
  }, []);

  const isConfirmOpen = confirmingOffer !== null;

  // DOM-safe dialog open / close & focus management
  useEffect(() => {
    const dialog = confirmDialogRef.current;
    if (!dialog) return;

    let frame: number;
    if (isConfirmOpen) {
      if (!dialog.open) {
        try {
          dialog.showModal();
        } catch {}
      }
      frame = requestAnimationFrame(() => {
        confirmAcceptBtnRef.current?.focus();
      });
    } else {
      if (dialog.open) {
        try {
          dialog.close();
        } catch {}
      }
      frame = requestAnimationFrame(() => {
        if (acceptBtnRef.current && !acceptBtnRef.current.disabled) {
          acceptBtnRef.current.focus();
        }
      });
    }
    return () => cancelAnimationFrame(frame);
  }, [isConfirmOpen]);

  // Continuous watcher: cancel confirmation if offer amount or offerId changes or becomes invalid
  useEffect(() => {
    if (confirmingOffer) {
      if (
        !offerId ||
        offerId.trim() === '' ||
        confirmingOffer.amount !== bankerOffer ||
        confirmingOffer.offerId !== offerId
      ) {
        closeConfirmDialog();
      }
    }
  }, [bankerOffer, offerId, confirmingOffer, closeConfirmDialog]);

  // Continuous watcher: cancel confirmation if deadline has expired or deadline is missing
  useEffect(() => {
    if (!confirmingOffer) return;
    if (deadlineTimestamp === null || deadlineTimestamp === undefined || !Number.isFinite(deadlineTimestamp)) {
      closeConfirmDialog();
      return;
    }
    const checkExpiration = () => {
      const now = Date.now() + serverTimeOffset;
      if (now >= deadlineTimestamp) {
        closeConfirmDialog();
      }
    };
    checkExpiration();
    const interval = setInterval(checkExpiration, 100);
    return () => clearInterval(interval);
  }, [confirmingOffer, deadlineTimestamp, serverTimeOffset, closeConfirmDialog]);

  const handleAcceptClick = () => {
    if (confirmDeal) {
      if (!offerId || offerId.trim() === '') {
        return;
      }
      setConfirmingOffer({
        offerId,
        amount: bankerOffer,
      });
    } else {
      onAcceptDeal();
    }
  };

  const handleConfirmedAccept = () => {
    const now = Date.now() + serverTimeOffset;
    const check = validateDealAcceptance({
      confirmingOffer,
      currentOfferId: offerId,
      currentOfferAmount: bankerOffer,
      currentPhase: 'BANKER_OFFER',
      isPending,
      deadlineTimestamp,
      serverNow: now,
      requireDeadline: true,
    });

    if (check.valid) {
      closeConfirmDialog();
      onAcceptDeal();
    } else {
      closeConfirmDialog();
    }
  };

  return (
    <div
      className="banker-modal-container"
      role="region"
      aria-label={msg('banker.panelAria')}
    >
      <div
        className="glass-panel glow-purple banker-card-panel"
        style={{
          padding: 'clamp(14px, 3vw, 24px) clamp(16px, 4vw, 32px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'clamp(12px, 3vw, 24px)',
          borderRadius: '20px',
          flexWrap: 'wrap',
          boxSizing: 'border-box',
          background: 'rgba(20, 14, 38, 0.97)',
          border: '1.5px solid rgba(139, 92, 246, 0.5)',
          boxShadow: '0 12px 40px rgba(0, 0, 0, 0.75), 0 0 30px rgba(139, 92, 246, 0.25)',
          maxHeight: 'calc(100vh - 120px)',
          overflowY: 'auto',
          position: 'relative',
        }}
      >
        {/* Left: Avatar & Character Profile */}
        <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
          <div
            style={{
              width: 'clamp(64px, 14vw, 110px)',
              height: 'clamp(64px, 14vw, 110px)',
              borderRadius: '50%',
              background: 'linear-gradient(135deg, #4C1D95, #7C3AED)',
              border: '3px solid #8B5CF6',
              boxShadow: '0 0 20px rgba(139, 92, 246, 0.6)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
            }}
          >
            <img
              src={profile.avatar}
              alt={localizedProfile.name}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                transform: 'scale(1.15)',
              }}
            />
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '0.9rem', fontWeight: 800, color: '#FACC15' }}>{localizedProfile.name}</div>
            <div style={{ fontSize: '0.75rem', color: '#A78BFA' }}>{localizedProfile.tag}</div>
          </div>
        </div>

        {/* Center: Offer Info, Dialogue & History */}
        <div style={{ flex: '1 1 200px', display: 'flex', flexDirection: 'column', gap: '6px', minWidth: '160px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '0.85rem', color: '#E5E7EB', fontWeight: 700 }}>
              {msg('banker.roundOffer', { round: currentRound })}
            </span>
            <Info size={14} color="#9CA3AF" />
          </div>

          {/* Character attitude dialogue (no EV / multipliers) */}
          <div
            style={{
              position: 'relative',
              fontSize: '0.82rem',
              color: '#e0e7ff',
              fontStyle: 'italic',
              background: 'linear-gradient(135deg, rgba(88, 28, 135, 0.25) 0%, rgba(30, 27, 75, 0.4) 100%)',
              border: '1px solid rgba(139, 92, 246, 0.35)',
              borderLeft: '3px solid #a855f7',
              padding: '7px 12px',
              borderRadius: '8px',
              lineHeight: 1.4,
              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.2)',
            }}
          >
            “{displayedDialogue}”
          </div>

          <div
            style={{
              fontSize: 'clamp(1.85rem, 6.5vw, 3.6rem)',
              fontWeight: 900,
              fontFamily: 'var(--font-mono)',
              color: '#FACC15',
              lineHeight: 1.1,
              textShadow: '0 0 20px rgba(250, 204, 21, 0.4)',
              whiteSpace: 'nowrap',
            }}
          >
            {formatMoney(displayedOffer)}
          </div>

          {/* Offer History Trend Rail (fixed height, non-expanding, horizontal scroll) */}
          {offerHistory.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', marginTop: '2px', maxWidth: '100%' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 600 }}>
                  <History size={12} color="#facc15" />
                  <span>{msg('banker.history')}</span>
                  <span style={{ opacity: 0.65, fontSize: '0.68rem' }}>({offerHistory.length})</span>
                </span>
              </div>

              <div ref={historyRailRef} className="banker-history-rail">
                {offerHistory.map((item, idx) => {
                  const prevAmount = idx > 0 ? offerHistory[idx - 1].amount : null;
                  const diff = prevAmount !== null ? item.amount - prevAmount : 0;
                  const pct = prevAmount !== null && prevAmount > 0 ? Math.round((diff / prevAmount) * 100) : 0;
                  const isCurrent = item.offerId === offerId || idx === offerHistory.length - 1;

                  return (
                    <div
                      key={item.offerId}
                      className={`banker-trend-chip${isCurrent ? ' active-current' : ''}`}
                      title={msg('banker.historyRound', { round: item.round, amount: formatMoney(item.amount) })}
                    >
                      <span style={{ color: isCurrent ? '#fef08a' : '#94a3b8', fontSize: '0.7rem' }}>
                        R{item.round}
                      </span>
                      <span>{formatMoney(item.amount)}</span>
                      {prevAmount !== null && (
                        <span className={`banker-trend-indicator ${diff > 0 ? 'up' : diff < 0 ? 'down' : 'neutral'}`}>
                          {diff > 0 ? (
                            <>
                              <TrendingUp size={10} />
                              <span>+{pct}%</span>
                            </>
                          ) : diff < 0 ? (
                            <>
                              <TrendingDown size={10} />
                              <span>{pct}%</span>
                            </>
                          ) : (
                            <>
                              <Minus size={10} />
                              <span>0%</span>
                            </>
                          )}
                        </span>
                      )}
                      {item.outcome === 'ACCEPTED' && (
                        <span style={{ fontSize: '0.65rem', background: 'rgba(16, 185, 129, 0.25)', color: '#34d399', padding: '1px 4px', borderRadius: '3px' }}>
                          ✓
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Mobile only details/summary for remaining amounts */}
        {remainingMoneyNode && (
          <details
            className="show-mobile"
            style={{
              width: '100%',
              margin: '4px 0',
              background: 'rgba(255, 255, 255, 0.05)',
              borderRadius: '10px',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              padding: '6px 10px',
              boxSizing: 'border-box',
            }}
          >
            <summary
              style={{
                fontSize: '0.8rem',
                color: '#FACC15',
                fontWeight: 700,
                cursor: 'pointer',
                userSelect: 'none',
                outline: 'none',
              }}
            >
              {msg('banker.remaining')}
            </summary>
            <div
              style={{
                maxHeight: '120px',
                overflowY: 'auto',
                marginTop: '6px',
                WebkitOverflowScrolling: 'touch',
              }}
            >
              {remainingMoneyNode}
            </div>
          </details>
        )}

        {/* Right: Actions (>=44px touch targets) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', flex: '1 1 160px', minWidth: '140px' }}>
          <button
            ref={acceptBtnRef}
            onClick={handleAcceptClick}
            disabled={isPending || !!confirmingOffer || acceptDisabled}
            className="btn-deal"
            style={{
              minHeight: '44px',
              padding: '12px 16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
            }}
          >
            <Check size={20} />
            <span style={{ fontSize: '1.05rem' }}>{acceptDisabled ? (acceptDisabledLabel || msg('banker.disabledEarly')) : msg('banker.accept')}</span>
          </button>

          <button
            onClick={onRejectDeal}
            disabled={isPending || !!confirmingOffer}
            className="btn-no-deal"
            style={{
              minHeight: '44px',
              padding: '12px 16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
            }}
          >
            <Play size={20} />
            <span style={{ fontSize: '1.05rem' }}>{msg('banker.reject')}</span>
          </button>

          {onDeclineRaise && raiseDeclineAvailable && (
            <button
              type="button"
              onClick={onDeclineRaise}
              disabled={isPending || !!confirmingOffer}
              className="btn-no-deal"
              style={{
                minHeight: '44px',
                padding: '10px 14px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                border: '1px solid rgba(251,191,36,.55)',
                color: '#fcd34d',
                background: 'rgba(120,53,15,.25)',
              }}
            >
              <AlertTriangle size={18} />
              <span style={{ fontSize: '0.9rem' }}>{msg('banker.declineRaise')}</span>
            </button>
          )}
        </div>

        {/* Native Dialog for Secondary Deal Confirmation */}
        <dialog
          ref={confirmDialogRef}
          className="deal-confirm-dialog"
          onCancel={(e) => {
            e.preventDefault();
            closeConfirmDialog();
          }}
          aria-labelledby="confirm-deal-title"
        >
          {confirmingOffer && (
            <div className="deal-confirm-dialog-content">
              <div
                style={{
                  width: '48px',
                  height: '48px',
                  borderRadius: '50%',
                  background: 'rgba(250, 204, 21, 0.2)',
                  border: '1px solid #facc15',
                  color: '#facc15',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 12px auto',
                }}
              >
                <AlertTriangle size={24} />
              </div>
              <h3 id="confirm-deal-title" style={{ fontSize: '1.25rem', fontWeight: 800, color: '#ffffff', margin: '0 0 6px 0' }}>
                {msg('banker.confirmTitle')}
              </h3>
              <p style={{ color: '#9ca3af', fontSize: '0.85rem', margin: '0 0 12px 0' }}>
                {msg('banker.confirmBody')}
              </p>
              <div
                style={{
                  fontSize: 'clamp(1.8rem, 5vw, 2.4rem)',
                  fontWeight: 900,
                  fontFamily: 'var(--font-mono)',
                  color: '#facc15',
                  marginBottom: '18px',
                }}
              >
                {formatMoney(confirmingOffer.amount)}
              </div>
              <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
                <button
                  ref={confirmAcceptBtnRef}
                  onClick={handleConfirmedAccept}
                  disabled={isPending}
                  className="btn-deal"
                  style={{
                    minHeight: '44px',
                    padding: '10px 24px',
                    fontSize: '1rem',
                  }}
                >
                  {msg('banker.confirm')}
                </button>
                <button
                  type="button"
                  onClick={closeConfirmDialog}
                  className="btn-no-deal"
                  style={{
                    minHeight: '44px',
                    padding: '10px 20px',
                    fontSize: '1rem',
                    background: 'rgba(255, 255, 255, 0.1)',
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                    color: '#ffffff',
                  }}
                >
                  {msg('banker.later')}
                </button>
              </div>
            </div>
          )}
        </dialog>
      </div>
    </div>
  );
};
