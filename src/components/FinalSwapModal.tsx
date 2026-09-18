import React, { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { ArrowLeftRight, Lock, Eye, Sparkles } from 'lucide-react';
import { BoxData, formatMoney } from '../types/game';
import { translate, useLanguage } from '../i18n';

interface FinalSwapModalProps {
  playerBox: BoxData | null;
  remainingBox: BoxData | null;
  onResolveSwap: (swap: boolean) => void;
  isPending?: boolean;
  lastRevealedBox?: { id: number; value: number } | null;
  remainingAmounts?: number[];
}

export const FinalSwapModal: React.FC<FinalSwapModalProps> = ({
  playerBox,
  remainingBox,
  onResolveSwap,
  isPending = false,
  lastRevealedBox = null,
  remainingAmounts = [],
}) => {
  const language = useLanguage();
  const msg = (key: Parameters<typeof translate>[0], replacements: Record<string, string | number> = {}) =>
    Object.entries(replacements).reduce(
      (text, [name, value]) => text.replace(new RegExp(`\\{${name}\\}`, 'g'), String(value)),
      translate(key, language),
    );

  const [isMinimized, setIsMinimized] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const keepBtnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!isMinimized) {
      keepBtnRef.current?.focus();
    }
  }, [isMinimized]);

  // Sort remaining amounts ascending so lower is on left and higher on right
  const sortedRemainingAmounts = useMemo(() => {
    return [...remainingAmounts].sort((a, b) => a - b);
  }, [remainingAmounts]);

  // Escape must NEVER make a game decision (neither keep nor swap); trap Tab within modal
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      // Pressing Escape toggles peek state
      setIsMinimized((prev) => !prev);
      return;
    }

    if (e.key === 'Tab') {
      const container = containerRef.current;
      if (!container) return;
      const focusable = container.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [tabindex="0"]'
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
  }, []);

  // When minimized, render unobtrusive floating bar at bottom
  if (isMinimized) {
    return (
      <div
        className="final-swap-minibar"
        role="region"
        aria-label={msg('final.restoreModal')}
        onClick={() => setIsMinimized(false)}
      >
        <ArrowLeftRight size={18} color="#facc15" />
        <span style={{ fontSize: '0.88rem', fontWeight: 700 }}>
          {msg('final.minimizedBar', {
            player: playerBox?.id ?? '—',
            remaining: remainingBox?.id ?? '—',
          })}
        </span>
        <button
          type="button"
          className="btn-primary"
          style={{
            padding: '5px 14px',
            fontSize: '0.8rem',
            borderRadius: '16px',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
          }}
          onClick={(e) => {
            e.stopPropagation();
            setIsMinimized(false);
          }}
        >
          <Eye size={14} />
          <span>{msg('final.restoreModal')}</span>
        </button>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="final-swap-title"
      onKeyDown={handleKeyDown}
      tabIndex={-1}
      className="final-swap-backdrop"
    >
      <div className="final-swap-card">
        {/* Peek Stage / Minimize Button */}
        <button
          type="button"
          className="final-swap-peek-btn"
          onClick={() => setIsMinimized(true)}
          title={msg('final.peekStage')}
          aria-label={msg('final.peekStage')}
        >
          <Eye size={14} />
          <span>{msg('final.peekStage')}</span>
        </button>

        {/* Just Opened Box Chip */}
        {lastRevealedBox && (
          <div
            className={`final-swap-chip-last ${
              lastRevealedBox.value >= 5000 ? 'high-tier' : 'low-tier'
            }`}
          >
            <Sparkles size={14} />
            <span>{msg('final.lastOpened', { box: lastRevealedBox.id })}: </span>
            <span style={{ fontFamily: 'var(--font-mono, monospace)', fontWeight: 800 }}>
              {formatMoney(lastRevealedBox.value)}
            </span>
          </div>
        )}

        {/* Icon Header */}
        <div
          style={{
            width: '56px',
            height: '56px',
            margin: '0 auto 10px auto',
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #f59e0b, #b45309)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#000000',
            boxShadow: '0 4px 16px rgba(245, 158, 11, 0.4)',
          }}
        >
          <ArrowLeftRight size={28} />
        </div>

        <div style={{ fontSize: '0.8rem', fontWeight: 800, color: '#fcd34d', textTransform: 'uppercase', letterSpacing: '1px' }}>
          {msg('final.title')}
        </div>
        <h2 id="final-swap-title" style={{ fontSize: 'clamp(1.3rem, 4.2vw, 1.7rem)', fontWeight: 900, margin: '6px 0 10px 0', color: '#ffffff' }}>
          {msg('final.question')}
        </h2>

        {/* Remaining 2 Amounts Showcase */}
        {sortedRemainingAmounts.length === 2 ? (
          <div style={{ margin: '14px 0 18px 0' }}>
            <div style={{ fontSize: '0.76rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>
              {msg('final.remainingTitle')}
            </div>
            <div className="final-swap-amounts-board">
              <div
                className={`final-swap-amount-plaque ${
                  sortedRemainingAmounts[0] >= 500000
                    ? 'million-tier'
                    : sortedRemainingAmounts[0] >= 5000
                    ? 'high-tier'
                    : 'low-tier'
                }`}
              >
                {formatMoney(sortedRemainingAmounts[0])}
              </div>
              <span className="final-swap-versus">{msg('final.versus')}</span>
              <div
                className={`final-swap-amount-plaque ${
                  sortedRemainingAmounts[1] >= 500000
                    ? 'million-tier'
                    : sortedRemainingAmounts[1] >= 5000
                    ? 'high-tier'
                    : 'low-tier'
                }`}
              >
                {formatMoney(sortedRemainingAmounts[1])}
              </div>
            </div>
            <p style={{ color: '#9ca3af', fontSize: '0.84rem', margin: '6px 0 0 0', lineHeight: 1.45 }}>
              {msg('final.amountsHint', {
                player: playerBox?.id ?? '—',
                remaining: remainingBox?.id ?? '—',
              })}
            </p>
          </div>
        ) : (
          <p style={{ color: '#9ca3af', fontSize: '0.9rem', marginBottom: '20px', lineHeight: 1.5 }}>
            {msg('final.body', { player: playerBox?.id ?? '—', remaining: remainingBox?.id ?? '—' })}
          </p>
        )}

        {/* Keep / Swap Action Buttons */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '12px', marginTop: '16px' }}>
          <button
            ref={keepBtnRef}
            onClick={() => onResolveSwap(false)}
            disabled={isPending}
            className="btn-primary"
            style={{
              minHeight: '46px',
              padding: '14px',
              borderRadius: '12px',
              fontSize: '0.95rem',
            }}
          >
            <Lock size={18} />
            <span>{msg('final.keep', { box: playerBox?.id ?? '—' })}</span>
          </button>

          <button
            onClick={() => onResolveSwap(true)}
            disabled={isPending}
            className="btn-primary"
            style={{
              minHeight: '46px',
              padding: '14px',
              borderRadius: '12px',
              fontSize: '0.95rem',
              background: 'linear-gradient(135deg, #3b82f6, #1d4ed8)',
              color: '#ffffff',
            }}
          >
            <ArrowLeftRight size={18} />
            <span>{msg('final.swap', { box: remainingBox?.id ?? '—' })}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
