import React, { useEffect, useRef } from 'react';
import { AlertTriangle, LogOut, X } from 'lucide-react';
import { translate, useLanguage } from '../i18n';

interface ForfeitModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirmForfeit: () => void;
  isPending?: boolean;
}

export const ForfeitModal: React.FC<ForfeitModalProps> = ({
  isOpen,
  onClose,
  onConfirmForfeit,
  isPending = false,
}) => {
  const language = useLanguage();
  const cancelBtnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      // Focus cancel button by default to protect user against accidental keyboard confirm
      const timer = setTimeout(() => {
        cancelBtnRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // Handle ESC inside modal
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="forfeit-dialog-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        backgroundColor: 'rgba(5, 7, 18, 0.82)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="glass-card-gold"
        style={{
          width: '100%',
          maxWidth: '460px',
          background: 'linear-gradient(135deg, rgba(26, 16, 28, 0.95), rgba(15, 23, 42, 0.95))',
          border: '1px solid rgba(239, 68, 68, 0.45)',
          borderRadius: '20px',
          boxShadow: '0 20px 50px rgba(0, 0, 0, 0.8), 0 0 30px rgba(239, 68, 68, 0.2)',
          padding: '24px',
          display: 'flex',
          flexDirection: 'column',
          gap: '18px',
          animation: 'fadeIn 0.2s ease-out',
        }}
      >
        {/* Header bar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '38px',
                height: '38px',
                borderRadius: '10px',
                background: 'rgba(239, 68, 68, 0.15)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#f87171',
              }}
            >
              <AlertTriangle size={20} />
            </div>
            <h2
              id="forfeit-dialog-title"
              style={{
                margin: 0,
                fontSize: '1.15rem',
                fontWeight: 800,
                color: '#ffffff',
                letterSpacing: '0.3px',
              }}
            >
              {translate('game.forfeitModalTitle', language)}
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label={translate('settings.close', language)}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#9ca3af',
              cursor: 'pointer',
              padding: '4px',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Content body */}
        <div
          style={{
            fontSize: '0.9rem',
            lineHeight: 1.6,
            color: '#cbd5e1',
            background: 'rgba(0, 0, 0, 0.25)',
            border: '1px solid rgba(255, 255, 255, 0.06)',
            borderRadius: '12px',
            padding: '14px 16px',
          }}
        >
          {translate('game.forfeitModalBody', language)}
        </div>

        {/* Action buttons */}
        <div
          style={{
            display: 'flex',
            gap: '12px',
            justifyContent: 'flex-end',
            marginTop: '4px',
          }}
        >
          <button
            ref={cancelBtnRef}
            type="button"
            onClick={onClose}
            disabled={isPending}
            style={{
              minHeight: '44px',
              padding: '8px 20px',
              borderRadius: '12px',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              background: 'rgba(255, 255, 255, 0.08)',
              color: '#f1f5f9',
              fontWeight: 700,
              fontSize: '0.9rem',
              cursor: 'pointer',
              transition: 'background 0.2s',
            }}
          >
            {translate('game.forfeitCancel', language)}
          </button>

          <button
            type="button"
            onClick={onConfirmForfeit}
            disabled={isPending}
            style={{
              minHeight: '44px',
              padding: '8px 22px',
              borderRadius: '12px',
              border: '1px solid rgba(239, 68, 68, 0.6)',
              background: 'linear-gradient(135deg, rgba(220, 38, 38, 0.9), rgba(185, 28, 28, 0.95))',
              color: '#ffffff',
              fontWeight: 800,
              fontSize: '0.9rem',
              cursor: isPending ? 'not-allowed' : 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              boxShadow: '0 4px 14px rgba(220, 38, 38, 0.4)',
              transition: 'transform 0.15s, filter 0.2s',
            }}
          >
            <LogOut size={16} />
            <span>{translate('game.forfeitConfirm', language)}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
