import React, { useState, useEffect, useRef } from 'react';
import {
  ShieldAlert,
  X,
  Send,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  Info,
} from 'lucide-react';
import { submitReport, ReportCategory } from '../api/ranking';
import { useModalLifecycle } from '../hooks/useModalLifecycle';
import { translate, useLanguage, type TranslationKey } from '../i18n';

interface ReportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  targetType: 'guest' | 'match' | 'auction' | string;
  targetId: string;
  targetDescription?: string;
}

const CATEGORIES: ReadonlyArray<{ key: ReportCategory; labelKey: TranslationKey; descKey: TranslationKey }> = [
  { key: 'cheating', labelKey: 'report.cat.cheating', descKey: 'report.cat.cheatingDesc' },
  { key: 'match_fixing', labelKey: 'report.cat.matchFixing', descKey: 'report.cat.matchFixingDesc' },
  { key: 'stall', labelKey: 'report.cat.stall', descKey: 'report.cat.stallDesc' },
  { key: 'harassment', labelKey: 'report.cat.harassment', descKey: 'report.cat.harassmentDesc' },
  { key: 'other', labelKey: 'report.cat.other', descKey: 'report.cat.otherDesc' },
] as const;

export const ReportDialog: React.FC<ReportDialogProps> = ({
  isOpen,
  onClose,
  targetType,
  targetId,
  targetDescription,
}) => {
  const language = useLanguage();
  const msg = (key: TranslationKey, replacements: Record<string, string | number> = {}) =>
    Object.entries(replacements).reduce(
      (text, [name, value]) => text.replace(new RegExp(`\\{${name}\\}`, 'g'), String(value)),
      translate(key, language),
    );
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  useModalLifecycle(dialogRef, isOpen);

  const [category, setCategory] = useState<ReportCategory>('cheating');
  const [reason, setReason] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successReportId, setSuccessReportId] = useState<string | null>(null);

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setCategory('cheating');
      setReason('');
      setErrorMessage(null);
      setSuccessReportId(null);
      setSubmitting(false);
    }
  }, [isOpen, targetId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetId || submitting) return;

    setSubmitting(true);
    setErrorMessage(null);

    try {
      const res = await submitReport({
        targetType,
        targetId,
        category,
        reason: reason.trim(),
      });

      if (res.ok && res.data?.success) {
        setSuccessReportId(res.data.reportId);
      } else {
        setErrorMessage(res.error?.message || msg('report.submitError'));
      }
    } catch (err: any) {
      setErrorMessage(err?.message || msg('report.networkError'));
    } finally {
      setSubmitting(false);
    }
  };

  const isFormValid = targetId.trim().length > 0 && reason.trim().length > 0 && reason.length <= 200;

  return (
    <dialog
      ref={dialogRef}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className="report-native-dialog"
      aria-labelledby="report-dialog-title"
    >
      <div className="report-dialog-content">
        {/* Header */}
        <div className="report-dialog-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '10px',
                background: 'rgba(239, 68, 68, 0.2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#f87171',
              }}
            >
              <ShieldAlert size={20} />
            </div>
            <div>
              <h2 id="report-dialog-title" style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800 }}>
                {msg('report.title')}
              </h2>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                {msg('report.subtitle')}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label={msg('report.close')}
            className="btn-settings-close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Target summary banner */}
        <div
          style={{
            padding: '10px 14px',
            background: 'rgba(0, 0, 0, 0.3)',
            borderRadius: '10px',
            border: '1px solid var(--border-glass)',
            fontSize: '0.82rem',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <Info size={16} style={{ color: 'var(--gold-light)', flexShrink: 0 }} />
          <div>
            <span style={{ color: 'var(--text-secondary)' }}>{msg('report.target')}</span>
            <strong style={{ color: '#ffffff' }}>{targetDescription || targetId}</strong>
            <span style={{ marginLeft: '6px', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              ({targetType === 'guest' ? msg('report.playerTarget') : msg('report.matchTarget')})
            </span>
          </div>
        </div>

        {/* Success state */}
        {successReportId ? (
          <div
            style={{
              padding: '24px 16px',
              textAlign: 'center',
              background: 'rgba(16, 185, 129, 0.1)',
              border: '1px solid rgba(16, 185, 129, 0.3)',
              borderRadius: '12px',
              margin: '12px 0',
            }}
          >
            <CheckCircle2 size={40} color="#10b981" style={{ margin: '0 auto 10px auto' }} />
            <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#ffffff' }}>{msg('report.submitted')}</div>
            <p style={{ fontSize: '0.85rem', color: '#d1fae5', marginTop: '6px', lineHeight: 1.5 }}>
              {msg('report.thanks', { id: successReportId || '' })}
            </p>
            <button
              type="button"
              onClick={onClose}
              className="btn-primary"
              style={{ minHeight: '38px', padding: '8px 24px', borderRadius: '8px', marginTop: '16px', cursor: 'pointer' }}
            >
              {msg('report.done')}
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {/* Error banner */}
            {errorMessage && (
              <div
                style={{
                  padding: '10px 14px',
                  background: 'rgba(239, 68, 68, 0.15)',
                  border: '1px solid rgba(239, 68, 68, 0.4)',
                  borderRadius: '10px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  color: '#fca5a5',
                  fontSize: '0.85rem',
                }}
              >
                <AlertCircle size={16} style={{ flexShrink: 0 }} />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* Category selection */}
            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: '0.85rem',
                  fontWeight: 700,
                  marginBottom: '8px',
                  color: '#ffffff',
                }}
              >
                {msg('report.categoryLabel')}
              </label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {CATEGORIES.map((cat) => (
                  <label
                    key={cat.key}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '10px',
                      padding: '8px 12px',
                      borderRadius: '8px',
                      background: category === cat.key ? 'rgba(239, 68, 68, 0.15)' : 'rgba(255, 255, 255, 0.03)',
                      border: `1px solid ${category === cat.key ? 'rgba(239, 68, 68, 0.4)' : 'var(--border-glass)'}`,
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <input
                      type="radio"
                      name="report-category"
                      value={cat.key}
                      checked={category === cat.key}
                      onChange={() => setCategory(cat.key)}
                      style={{ marginTop: '3px' }}
                    />
                    <div>
                      <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#ffffff' }}>{msg(cat.labelKey)}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{msg(cat.descKey)}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* Reason details */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <label
                  htmlFor="report-reason"
                  style={{
                    fontSize: '0.85rem',
                    fontWeight: 700,
                    color: '#ffffff',
                  }}
                >
                  {msg('report.reasonLabel')}
                </label>
                <span
                  style={{
                    fontSize: '0.75rem',
                    color: reason.length > 180 ? '#f87171' : 'var(--text-secondary)',
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  {msg('report.reasonCount', { count: reason.length })}
                </span>
              </div>
              <textarea
                id="report-reason"
                rows={3}
                maxLength={200}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={msg('report.reasonPlaceholder')}
                style={{
                  width: '100%',
                  padding: '10px',
                  borderRadius: '8px',
                  background: 'rgba(0, 0, 0, 0.4)',
                  border: '1px solid var(--border-glass)',
                  color: 'var(--text-primary)',
                  fontSize: '0.85rem',
                  lineHeight: 1.5,
                  resize: 'none',
                  outline: 'none',
                  fontFamily: 'inherit',
                }}
              />
            </div>

            {/* Footer Buttons */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '10px',
                marginTop: '6px',
                paddingTop: '12px',
                borderTop: '1px solid var(--border-glass)',
              }}
            >
              <button
                type="button"
                onClick={onClose}
                className="btn-settings-reset"
                style={{ minHeight: '38px', padding: '6px 16px' }}
              >
                {msg('report.cancel')}
              </button>
              <button
                type="submit"
                disabled={!isFormValid || submitting}
                className="btn-primary"
                style={{
                  minHeight: '38px',
                  padding: '6px 20px',
                  borderRadius: '8px',
                  background: !isFormValid || submitting ? 'rgba(255, 255, 255, 0.1)' : '#ef4444',
                  border: 'none',
                  color: '#ffffff',
                  fontWeight: 800,
                  fontSize: '0.85rem',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  cursor: !isFormValid || submitting ? 'not-allowed' : 'pointer',
                }}
              >
                {submitting ? (
                  <>
                    <RefreshCw size={14} className="spin" />
                    <span>{msg('report.submitting')}</span>
                  </>
                ) : (
                  <>
                    <Send size={14} />
                    <span>{msg('report.submit')}</span>
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </dialog>
  );
};
