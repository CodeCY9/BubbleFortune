import React, { useEffect, useState, useRef } from 'react';
import { Shield, CheckCircle, AlertTriangle, Download, RefreshCw, X, ShieldAlert, FileText } from 'lucide-react';
import type { CompletedGameRecord, PublicSettlement, AuditEvent } from '../../packages/protocol/src/types';
import { useModalLifecycle } from '../hooks/useModalLifecycle';
import {
  verifyGameFairness,
  downloadFairnessProofJson,
  FairnessVerificationOutcome,
} from '../utils/fairnessStorage';
import { translate, useLanguage, type TranslationKey } from '../i18n';

interface FairnessModalProps {
  isOpen: boolean;
  onClose: () => void;
  record:
    | CompletedGameRecord
    | {
        gameId: string;
        ruleVersion?: string;
        settlement: PublicSettlement;
        auditTrail?: AuditEvent[];
      }
    | null;
}

export const FairnessModal: React.FC<FairnessModalProps> = ({ isOpen, onClose, record }) => {
  const language = useLanguage();
  const msg = (key: TranslationKey, replacements: Record<string, string | number> = {}) =>
    Object.entries(replacements).reduce(
      (text, [name, value]) => text.replace(new RegExp(`\\{${name}\\}`, 'g'), String(value)),
      translate(key, language),
    );
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [loading, setLoading] = useState(false);
  const [outcome, setOutcome] = useState<FairnessVerificationOutcome | null>(null);
  const [revision, setRevision] = useState(0);
  useModalLifecycle(dialogRef, isOpen && Boolean(record));

  useEffect(() => {
    let cancelled = false;
    setOutcome(null);
    if (!isOpen || !record) return;
    setLoading(true);
    verifyGameFairness(record).then(res => {
      if (!cancelled) setOutcome(res);
    }).catch(() => {
      if (!cancelled) setOutcome({ valid: false, status: 'INVALID', message: translate('fairness.retryError', language),
        hasInitialCommitment: false, error: 'EXCEPTION' });
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [isOpen, record, revision]);

  if (!isOpen || !record) return null;

  const handleDownload = () => {
    downloadFairnessProofJson(record, outcome);
  };

  const handleReverify = () => {
    setRevision(value => value + 1);
  };

  const proof = record.settlement?.fairnessProof;

  return (
    <dialog
      ref={dialogRef}
      aria-label={msg('fairness.aria')}
      className="fairness-native-dialog"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      style={{
        padding: 0,
        borderRadius: '20px',
        border: '1.5px solid rgba(245, 158, 11, 0.4)',
        background: 'rgba(15, 23, 42, 0.98)',
        color: '#ffffff',
        maxWidth: '620px',
        width: '90vw',
        maxHeight: '85vh',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.8), 0 0 30px rgba(245, 158, 11, 0.2)',
        overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', maxHeight: '85vh' }}>
        {/* Modal Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 20px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
            background: 'rgba(0, 0, 0, 0.3)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '10px',
                background: 'rgba(245, 158, 11, 0.2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fcd34d',
              }}
            >
              <Shield size={20} />
            </div>
            <div>
              <div style={{ fontSize: '1.05rem', fontWeight: 800 }}>{msg('fairness.title')}</div>
              <div style={{ fontSize: '0.75rem', color: '#9ca3af' }}>
                {msg('fairness.subtitle')}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={msg('fairness.close')}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#9ca3af',
              cursor: 'pointer',
              padding: '6px',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: '44px',
              minWidth: '44px',
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Modal Body */}
        <div style={{ padding: '20px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Verification Status Banner */}
          {loading ? (
            <div
              style={{
                padding: '20px',
                borderRadius: '14px',
                background: 'rgba(255, 255, 255, 0.05)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '10px',
                color: '#fcd34d',
                fontSize: '0.9rem',
              }}
            >
              <RefreshCw size={18} className="spin" />
              <span>{msg('fairness.loading')}</span>
            </div>
          ) : outcome ? (
            <div
              style={{
                padding: '16px',
                borderRadius: '14px',
                background:
                  outcome.status === 'VERIFIED'
                    ? 'rgba(16, 185, 129, 0.15)'
                    : outcome.status === 'SELF_CONSISTENT'
                    ? 'rgba(6, 182, 212, 0.15)'
                    : 'rgba(239, 68, 68, 0.15)',
                border:
                  outcome.status === 'VERIFIED'
                    ? '1px solid rgba(16, 185, 129, 0.4)'
                    : outcome.status === 'SELF_CONSISTENT'
                    ? '1px solid rgba(6, 182, 212, 0.4)'
                    : '1px solid rgba(239, 68, 68, 0.4)',
                display: 'flex',
                gap: '12px',
                alignItems: 'flex-start',
              }}
            >
              {outcome.status === 'VERIFIED' && (
                <CheckCircle size={22} style={{ color: '#10b981', flexShrink: 0, marginTop: '2px' }} />
              )}
              {outcome.status === 'SELF_CONSISTENT' && (
                <Shield size={22} style={{ color: '#06b6d4', flexShrink: 0, marginTop: '2px' }} />
              )}
              {(outcome.status === 'TAMPERED' || outcome.status === 'INVALID') && (
                <ShieldAlert size={22} style={{ color: '#ef4444', flexShrink: 0, marginTop: '2px' }} />
              )}
              {outcome.status === 'UNSUPPORTED' && (
                <AlertTriangle size={22} style={{ color: '#f59e0b', flexShrink: 0, marginTop: '2px' }} />
              )}
              <div>
                <div
                  style={{
                    fontSize: '0.95rem',
                    fontWeight: 800,
                    color:
                      outcome.status === 'VERIFIED'
                        ? '#34d399'
                        : outcome.status === 'SELF_CONSISTENT'
                        ? '#67e8f9'
                        : '#f87171',
                  }}
                >
                  {outcome.message}
                </div>
                <div style={{ fontSize: '0.8rem', color: '#d1d5db', marginTop: '4px', lineHeight: 1.4 }}>
                  {outcome.status === 'VERIFIED' &&
                    msg('fairness.verifiedBody')}
                  {outcome.status === 'SELF_CONSISTENT' &&
                    msg('fairness.selfConsistentBody')}
                  {outcome.status === 'TAMPERED' &&
                    msg('fairness.tamperedBody')}
                  {outcome.status === 'UNSUPPORTED' &&
                    msg('fairness.unsupportedBody')}
                </div>
              </div>
            </div>
          ) : null}

          {/* Detailed cryptographic fields */}
          {proof && (
            <div
              style={{
                background: 'rgba(0, 0, 0, 0.3)',
                borderRadius: '12px',
                padding: '14px',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
                fontSize: '0.8rem',
              }}
            >
              <div>
                <span style={{ color: '#9ca3af' }}>{msg('fairness.gameId')} </span>
                <span style={{ fontFamily: 'var(--font-mono)', color: '#ffffff' }}>{record.gameId}</span>
              </div>
              {outcome?.pinnedCommitment && (
                <div>
                  <span style={{ color: '#9ca3af' }}>{msg('fairness.initialCommitment')} </span>
                  <div
                    style={{
                      fontFamily: 'var(--font-mono)',
                      color: '#fcd34d',
                      fontSize: '0.72rem',
                      wordBreak: 'break-all',
                      background: 'rgba(0,0,0,0.4)',
                      padding: '6px',
                      borderRadius: '6px',
                      marginTop: '2px',
                    }}
                  >
                    {outcome.pinnedCommitment}
                  </div>
                </div>
              )}
              <div>
                <span style={{ color: '#9ca3af' }}>{msg('fairness.proofCommitment')} </span>
                <div
                  style={{
                    fontFamily: 'var(--font-mono)',
                    color: '#a78bfa',
                    fontSize: '0.72rem',
                    wordBreak: 'break-all',
                    background: 'rgba(0,0,0,0.4)',
                    padding: '6px',
                    borderRadius: '6px',
                    marginTop: '2px',
                  }}
                >
                  {proof.commitment}
                </div>
              </div>
              <div>
                <span style={{ color: '#9ca3af' }}>{msg('fairness.seed')} </span>
                <div
                  style={{
                    fontFamily: 'var(--font-mono)',
                    color: '#e5e7eb',
                    fontSize: '0.72rem',
                    wordBreak: 'break-all',
                    background: 'rgba(0,0,0,0.4)',
                    padding: '6px',
                    borderRadius: '6px',
                    marginTop: '2px',
                  }}
                >
                  {proof.seed}
                </div>
              </div>
              <div>
                <span style={{ color: '#9ca3af' }}>{msg('fairness.salt')} </span>
                <div
                  style={{
                    fontFamily: 'var(--font-mono)',
                    color: '#e5e7eb',
                    fontSize: '0.72rem',
                    wordBreak: 'break-all',
                    background: 'rgba(0,0,0,0.4)',
                    padding: '6px',
                    borderRadius: '6px',
                    marginTop: '2px',
                  }}
                >
                  {proof.salt}
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#9ca3af', paddingTop: '4px' }}>
                <span>{msg('fairness.algorithm', { value: proof.algorithm })}</span>
                <span>{msg('fairness.ruleVersion', { value: proof.ruleVersion })}</span>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '14px 20px',
            borderTop: '1px solid rgba(255, 255, 255, 0.1)',
            background: 'rgba(0, 0, 0, 0.3)',
            flexWrap: 'wrap',
            gap: '10px',
          }}
        >
          {proof && (
            <button
              type="button"
              onClick={handleDownload}
              className="btn-outline"
              style={{
                minHeight: '44px',
                padding: '8px 16px',
                borderRadius: '10px',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                background: 'rgba(255, 255, 255, 0.08)',
                color: '#ffffff',
                fontSize: '0.85rem',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <Download size={16} />
              <span>{msg('fairness.download')}</span>
            </button>
          )}

          <div style={{ display: 'flex', gap: '8px', marginLeft: 'auto' }}>
            <button
              type="button"
              onClick={handleReverify}
              disabled={loading}
              style={{
                minHeight: '44px',
                padding: '8px 16px',
                borderRadius: '10px',
                border: '1px solid rgba(245, 158, 11, 0.4)',
                background: 'rgba(245, 158, 11, 0.15)',
                color: '#fcd34d',
                fontSize: '0.85rem',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <RefreshCw size={15} className={loading ? 'spin' : ''} />
              <span>{msg('fairness.reverify')}</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="btn-primary"
              style={{
                minHeight: '44px',
                padding: '8px 20px',
                borderRadius: '10px',
                fontSize: '0.85rem',
              }}
            >
              {msg('fairness.done')}
            </button>
          </div>
        </div>
      </div>
    </dialog>
  );
};
