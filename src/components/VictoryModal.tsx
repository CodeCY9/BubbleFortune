import React, { useEffect, useRef } from 'react';
import confetti from 'canvas-confetti';
import { Trophy, RefreshCw, Award, Shield, ShieldAlert, History, Home, X, Bot } from 'lucide-react';
import type { PublicSettlement, AiType, PublicOfferHistoryEntry } from '../../packages/protocol/src/types';
import { formatMoney } from '../types/game';
import { ShareControls } from './ShareControls';
import { getAiPresentation, translate, useLanguage, type TranslationKey } from '../i18n';

interface VictoryModalProps {
  settlement: PublicSettlement | null;
  onRestart: (aiType?: AiType) => void;
  onReturnToLobby?: () => void;
  onOpenHistory?: () => void;
  onOpenFairness?: () => void;
  onOpenReport?: () => void;
  onClose?: () => void;
  isPending?: boolean;
  reducedMotion?: boolean;
  currentAiType?: AiType;
  offerHistory?: PublicOfferHistoryEntry[];
}

const AI_TARGETS: ReadonlyArray<{ type: AiType }> = [
  { type: 'conservative' },
  { type: 'aggressive' },
  { type: 'cold' },
  { type: 'inducement' },
  { type: 'crazy' },
] as const;

export const VictoryModal: React.FC<VictoryModalProps> = ({
  settlement,
  onRestart,
  onReturnToLobby,
  onOpenHistory,
  onOpenFairness,
  onOpenReport,
  onClose,
  isPending = false,
  reducedMotion = false,
  currentAiType = 'conservative',
  offerHistory = [],
}) => {
  const language = useLanguage();
  const msg = (key: TranslationKey, vars?: Record<string, string | number>) => {
    let value = translate(key, language);
    for (const [name, replacement] of Object.entries(vars ?? {})) {
      value = value.replace(new RegExp(`\\{${name}\\}`, 'g'), String(replacement));
    }
    return value;
  };
  const wonAmount = settlement ? settlement.wonAmount : 0;
  const isDealAccepted = settlement?.outcomeType === 'OFFER_ACCEPTED';
  const isSwap = settlement?.outcomeType === 'FINAL_SWAP';
  const originalId = settlement?.originalPlayerBoxId;
  const finalId = settlement?.finalPlayerBoxId;

  // Resolve box amounts from settlement or allBoxes
  const originalBoxAmount =
    settlement?.originalBoxAmount ??
    settlement?.allBoxes?.find((b) => b.id === originalId)?.amount ??
    (isDealAccepted ? settlement?.finalBoxAmount : undefined);

  const finalBoxAmount =
    settlement?.finalBoxAmount ??
    settlement?.allBoxes?.find((b) => b.id === finalId)?.amount;

  const highestOffer =
    settlement?.highestOfferAmount ??
    (offerHistory && offerHistory.length > 0
      ? Math.max(...offerHistory.map((o) => o.amount))
      : undefined);

  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const restartBtnRef = useRef<HTMLButtonElement | null>(null);

  // Trigger confetti cannon on modal open unless reducedMotion is active
  useEffect(() => {
    if (reducedMotion) return;
    try {
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#f59e0b', '#fcd34d', '#10b981', '#3b82f6'],
      });
    } catch {
      // Fallback if canvas-confetti environment issue
    }
  }, [reducedMotion]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      const raf = requestAnimationFrame(() => {
        try {
          dialog.showModal();
          restartBtnRef.current?.focus();
        } catch {}
      });
      return () => cancelAnimationFrame(raf);
    }
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="victory-native-dialog"
      aria-labelledby="victory-modal-title"
      onCancel={(e) => {
        // Esc closes dialog safely without triggering game restart
        e.preventDefault();
        onClose?.();
      }}
    >
      <div
        className="glass-card-gold"
        style={{
          width: '100%',
          maxWidth: '560px',
          padding: 'clamp(20px, 4vw, 32px) clamp(16px, 3.5vw, 28px)',
          borderRadius: '24px',
          textAlign: 'center',
          boxSizing: 'border-box',
          position: 'relative',
          maxHeight: '92vh',
          overflowY: 'auto',
        }}
      >
        {/* Close Button top-right */}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label={msg('victory.closeSettlement')}
            style={{
              position: 'absolute',
              top: '16px',
              right: '16px',
              width: '44px',
              height: '44px',
              borderRadius: '50%',
              background: 'rgba(255, 255, 255, 0.08)',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              color: '#9ca3af',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.15s ease',
            }}
          >
            <X size={18} />
          </button>
        )}

        <div
          style={{
            width: '68px',
            height: '68px',
            margin: '0 auto 12px auto',
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #f59e0b, #d97706)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#000000',
            boxShadow: '0 0 28px rgba(245, 158, 11, 0.5)',
          }}
        >
          <Trophy size={36} />
        </div>

        <div
          style={{
            fontSize: '0.8rem',
            fontWeight: 800,
            color: '#fcd34d',
            textTransform: 'uppercase',
            letterSpacing: '1.5px',
          }}
        >
          {msg('victory.badge')}
        </div>
        <h2
          id="victory-modal-title"
          style={{
            fontSize: 'clamp(1.3rem, 4vw, 1.8rem)',
            fontWeight: 900,
            margin: '6px 0 14px 0',
            color: '#ffffff',
          }}
        >
          {isDealAccepted
            ? msg('victory.outcome.deal')
            : isSwap
            ? msg('victory.outcome.swap')
            : msg('victory.outcome.keep')}
        </h2>

        {/* Final Winnings Box */}
        <div
          style={{
            background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.22), rgba(16, 185, 129, 0.16))',
            border: '2px solid #f59e0b',
            borderRadius: '18px',
            padding: '16px 20px',
            margin: '0 0 16px 0',
            boxSizing: 'border-box',
          }}
        >
          <div style={{ fontSize: '0.8rem', color: '#9ca3af', fontWeight: 600 }}>
            {isDealAccepted ? msg('victory.acceptedLabel') : msg('victory.winningLabel')}
          </div>
          <div
            style={{
              fontSize: 'clamp(2.2rem, 7vw, 3.2rem)',
              fontWeight: 900,
              fontFamily: 'var(--font-mono)',
              color: '#fcd34d',
              letterSpacing: '-1px',
              textShadow: '0 0 25px rgba(245, 158, 11, 0.6)',
              margin: '6px 0',
              wordBreak: 'break-all',
            }}
          >
            {formatMoney(wonAmount)}
          </div>
        </div>

        {settlement?.insurancePremium !== undefined && (
          <div style={{ margin: '-6px 0 16px', color: '#fde68a', fontSize: '0.8rem', fontWeight: 700 }}>
            {msg('victory.insurance', {
              won: formatMoney(settlement.preInsuranceWonAmount ?? wonAmount),
              floor: formatMoney(settlement.insuranceFloor ?? 0),
              premium: formatMoney(settlement.insurancePremium),
            })}
          </div>
        )}

        {/* Objective Stats Comparison Grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
            gap: '10px',
            margin: '0 0 18px 0',
            textAlign: 'left',
          }}
        >
          {/* Original Box */}
          <div
            style={{
              background: 'rgba(255, 255, 255, 0.04)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '12px',
              padding: '10px 12px',
            }}
          >
            <div style={{ fontSize: '0.72rem', color: '#9ca3af', fontWeight: 600 }}>{msg('victory.originalBox', { box: originalId ?? '?' })}</div>
            <div
              style={{
                fontSize: '1rem',
                fontWeight: 800,
                color: '#60a5fa',
                fontFamily: 'var(--font-mono)',
                marginTop: '4px',
              }}
            >
              {originalBoxAmount !== undefined ? formatMoney(originalBoxAmount) : msg('victory.legacyAmount')}
            </div>
          </div>

          {/* Final Box (if swap or deal accepted) */}
          <div
            style={{
              background: 'rgba(255, 255, 255, 0.04)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '12px',
              padding: '10px 12px',
            }}
          >
            <div style={{ fontSize: '0.72rem', color: '#9ca3af', fontWeight: 600 }}>
              {isSwap
                ? msg('victory.finalBoxSwap', { box: finalId ?? '?' })
                : msg('victory.finalBoxKeep', { box: finalId ?? '?' })}
            </div>
            <div
              style={{
                fontSize: '1rem',
                fontWeight: 800,
                color: '#34d399',
                fontFamily: 'var(--font-mono)',
                marginTop: '4px',
              }}
            >
              {finalBoxAmount !== undefined ? formatMoney(finalBoxAmount) : msg('victory.legacyAmount')}
            </div>
          </div>

          {/* Highest Offer */}
          <div
            style={{
              background: 'rgba(255, 255, 255, 0.04)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '12px',
              padding: '10px 12px',
            }}
          >
              <div style={{ fontSize: '0.72rem', color: '#9ca3af', fontWeight: 600 }}>{msg('victory.highestOffer')}</div>
            <div
              style={{
                fontSize: '1rem',
                fontWeight: 800,
                color: '#f59e0b',
                fontFamily: 'var(--font-mono)',
                marginTop: '4px',
              }}
            >
              {highestOffer !== undefined ? formatMoney(highestOffer) : msg('victory.none')}
            </div>
          </div>
        </div>

        {settlement && <ShareControls key={settlement.resultId} resultId={settlement.resultId} />}
        {/* Primary Action: Replay with Current AI */}
        <button
          ref={restartBtnRef}
          type="button"
          onClick={() => onRestart(currentAiType)}
          disabled={isPending}
          className="btn-primary"
          style={{
            minHeight: '44px',
            width: '100%',
            padding: '12px',
            fontSize: '1.05rem',
            borderRadius: '14px',
            boxSizing: 'border-box',
            marginBottom: '10px',
            cursor: isPending ? 'not-allowed' : 'pointer',
          }}
        >
          <RefreshCw size={18} className={isPending ? 'spin' : ''} />
          <span>{msg('victory.replay', { name: currentAiType ? getAiPresentation(currentAiType, language).name : msg('victory.sameLineup') })}</span>
        </button>

        {/* Choose another AI opponent to restart */}
        <div style={{ margin: '0 0 14px 0' }}>
          <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginBottom: '6px', textAlign: 'center' }}>
            {msg('victory.chooseOther')}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
            {AI_TARGETS.map((ai) => (
              <button
                key={ai.type}
                type="button"
                onClick={() => onRestart(ai.type)}
                disabled={isPending}
                style={{
                  minHeight: '44px',
                  padding: '8px 6px',
                  borderRadius: '10px',
                  background:
                    currentAiType === ai.type
                      ? 'rgba(245, 158, 11, 0.2)'
                      : 'rgba(255, 255, 255, 0.05)',
                  border:
                    currentAiType === ai.type
                      ? '1px solid #f59e0b'
                      : '1px solid rgba(255, 255, 255, 0.1)',
                  color: currentAiType === ai.type ? '#fcd34d' : '#e5e7eb',
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  cursor: isPending ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '2px',
                  transition: 'all 0.15s ease',
                }}
              >
                <span>{getAiPresentation(ai.type, language).name}</span>
                <span style={{ fontSize: '0.68rem', color: '#9ca3af', fontWeight: 500 }}>{getAiPresentation(ai.type, language).tag}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Utility Actions Row: Fairness, History, Lobby, Close */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))',
            gap: '8px',
            borderTop: '1px solid rgba(255, 255, 255, 0.1)',
            paddingTop: '14px',
          }}
        >
          {onOpenFairness && (
            <button
              type="button"
              onClick={onOpenFairness}
              className="btn-secondary"
              style={{
                minHeight: '44px',
                padding: '8px',
                fontSize: '0.8rem',
                borderRadius: '10px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '4px',
              }}
            >
              <Shield size={16} color="#34d399" />
              <span>{msg('victory.fairness')}</span>
            </button>
          )}

          {onOpenHistory && (
            <button
              type="button"
              onClick={onOpenHistory}
              className="btn-secondary"
              style={{
                minHeight: '44px',
                padding: '8px',
                fontSize: '0.8rem',
                borderRadius: '10px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '4px',
              }}
            >
              <History size={16} color="#60a5fa" />
              <span>{msg('victory.history')}</span>
            </button>
          )}

          {onOpenReport && (
            <button
              type="button"
              onClick={onOpenReport}
              className="btn-secondary"
              aria-label={msg('victory.reportAria')}
              style={{
                minHeight: '44px',
                padding: '8px',
                fontSize: '0.8rem',
                borderRadius: '10px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '4px',
                color: '#fca5a5',
              }}
            >
              <ShieldAlert size={16} color="#ef4444" />
              <span>{msg('victory.report')}</span>
            </button>
          )}

          {onReturnToLobby && (
            <button
              type="button"
              onClick={onReturnToLobby}
              className="btn-secondary"
              style={{
                minHeight: '44px',
                padding: '8px',
                fontSize: '0.8rem',
                borderRadius: '10px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '4px',
              }}
            >
              <Home size={16} color="#f59e0b" />
              <span>{msg('victory.returnLobby')}</span>
            </button>
          )}

          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary"
              style={{
                minHeight: '44px',
                padding: '8px',
                fontSize: '0.8rem',
                borderRadius: '10px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '4px',
              }}
            >
              <X size={16} />
              <span>{msg('victory.close')}</span>
            </button>
          )}
        </div>
      </div>
    </dialog>
  );
};
