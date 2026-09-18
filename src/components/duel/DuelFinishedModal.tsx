import React, { useState, useRef } from 'react';
import type {
  DuelResult,
  DuelSeatInfo,
  DuelSeatId,
} from '../../../packages/protocol/src/duel';
import { Trophy, Download, Home, FileText, ChevronDown, ChevronUp, Eye } from 'lucide-react';
import { formatMoney } from '../../types/game';
import { useModalLifecycle } from '../../hooks/useModalLifecycle';
import { ShareControls } from '../ShareControls';
import { translate, useLanguage, type TranslationKey } from '../../i18n';

interface DuelFinishedModalProps {
  result: DuelResult;
  seats: [DuelSeatInfo, DuelSeatInfo];
  mySeatId: DuelSeatId | null;
  onReturnToLobby: () => void;
  isOpen?: boolean;
  onClose?: () => void;
}

export const DuelFinishedModal: React.FC<DuelFinishedModalProps> = ({
  result,
  seats,
  mySeatId,
  onReturnToLobby,
  isOpen: controlledIsOpen,
  onClose,
}) => {
  const language = useLanguage();
  const msg = (key: TranslationKey, replacements: Record<string, string | number> = {}) =>
    Object.entries(replacements).reduce(
      (text, [name, value]) => text.replace(new RegExp(`\\{${name}\\}`, 'g'), String(value)),
      translate(key, language),
    );
  const [internalOpen, setInternalOpen] = useState(true);
  const isOpen = controlledIsOpen !== undefined ? controlledIsOpen : internalOpen;
  const dialogRef = useRef<HTMLDialogElement>(null);
  useModalLifecycle(dialogRef, isOpen);

  const [showProofs, setShowProofs] = useState(false);

  const handleClose = () => {
    if (onClose) {
      onClose();
    } else {
      setInternalOpen(false);
    }
  };

  const handleOpen = () => {
    setInternalOpen(true);
  };

  const mySeat = mySeatId !== null ? seats[mySeatId] : null;
  const opponentSeatId = mySeatId !== null ? (mySeatId === 0 ? 1 : 0) : null;
  const opponentSeat = opponentSeatId !== null ? seats[opponentSeatId] : null;

  const myScore = mySeatId !== null ? result.finalScores[mySeatId] ?? 0 : 0;
  const opponentScore =
    opponentSeatId !== null ? result.finalScores[opponentSeatId] ?? 0 : 0;

  // Determine outcome
  let outcomeTitle = translate('duel.finished.draw', language);
  let outcomeColor = '#fbbf24';

  if (result.reason === 'BOTH_FORFEIT') {
    outcomeTitle = translate('duel.finished.bothForfeit', language);
    outcomeColor = '#f87171';
  } else if (result.winnerSeatId === null) {
    outcomeTitle = translate('duel.finished.draw', language);
    outcomeColor = '#fbbf24';
  } else if (result.winnerSeatId === mySeatId) {
    outcomeTitle = translate('duel.finished.win', language);
    outcomeColor = '#34d399';
  } else {
    outcomeTitle = translate('duel.finished.lose', language);
    outcomeColor = '#f87171';
  }

  // Reason description
  let reasonDesc = translate('duel.finished.normal', language);
  if (result.reason === 'FORFEIT') {
    reasonDesc = result.forfeitedSeatId === mySeatId
      ? translate('duel.finished.forfeitSelf', language)
      : translate('duel.finished.forfeitOpponent', language);
  } else if (result.reason === 'TIMEOUT_DISCONNECT') {
    reasonDesc = translate('duel.finished.timeout', language);
  } else if (result.reason === 'BOTH_FORFEIT') {
    reasonDesc = translate('duel.finished.bothOffline', language);
  }

  // Download fairness proof JSON file
  const handleDownloadProof = () => {
    const proofData = {
      matchId: result.matchId,
      resultId: result.resultId,
      ruleVersion: result.ruleVersion,
      winnerSeatId: result.winnerSeatId,
      reason: result.reason,
      finalScores: result.finalScores,
      rounds: result.rounds,
      fairnessProofs: result.fairnessProofs,
      auditTrail: result.auditTrail,
      exportedAt: new Date().toISOString(),
    };

    const blob = new Blob([JSON.stringify(proofData, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `duel-proof-${result.matchId}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (!isOpen) {
    return (
      <div className="duel-finished-float" style={{ position: 'fixed', bottom: '24px', right: '24px', zIndex: 90 }}>
        <button
          type="button"
          onClick={handleOpen}
          className="duel-action-btn btn-primary"
          style={{
            minHeight: '44px',
            padding: '10px 20px',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.6)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            borderRadius: '12px',
          }}
        >
          <Trophy size={18} />
          <span>{translate('duel.finished.viewResult', language)}</span>
        </button>
      </div>
    );
  }

  return (
    <dialog
      ref={dialogRef}
      className="duel-native-dialog"
      aria-labelledby="duel-finished-title"
      onCancel={(e) => {
        e.preventDefault();
        handleClose();
      }}
    >
      <div className="duel-modal-panel" style={{ maxWidth: '600px', maxHeight: '90vh', overflowY: 'auto' }}>
        {/* Outcome Header */}
        <div style={{ textAlign: 'center', marginBottom: '20px' }}>
          <div
            style={{
              width: '64px',
              height: '64px',
              borderRadius: '20px',
              background: 'rgba(245, 158, 11, 0.2)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: outcomeColor,
              marginBottom: '12px',
            }}
          >
            <Trophy size={36} />
          </div>
          <h2 id="duel-finished-title" style={{ fontSize: '1.8rem', fontWeight: 900, color: outcomeColor, margin: '0 0 6px 0' }}>
            {outcomeTitle}
          </h2>
          <div style={{ fontSize: '0.85rem', color: '#9ca3af' }}>{reasonDesc}</div>
        </div>

        {/* Scores Comparison Card */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '12px',
            background: 'rgba(0, 0, 0, 0.4)',
            borderRadius: '16px',
            padding: '16px',
            marginBottom: '20px',
            border: '1px solid rgba(255, 255, 255, 0.1)',
          }}
        >
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '0.85rem', color: '#9ca3af', marginBottom: '4px' }}>
              {mySeat?.nickname ?? translate('duel.finished.mine', language)} ({translate('duel.finished.mine', language)})
            </div>
            <div style={{ fontSize: '1.5rem', fontWeight: 900, color: myScore >= 0 ? '#34d399' : '#f87171' }}>
              {myScore >= 0 ? '+' : ''}{formatMoney(myScore)}
            </div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '0.85rem', color: '#9ca3af', marginBottom: '4px' }}>
              {opponentSeat?.nickname ?? translate('duel.finished.opponent', language)} ({translate('duel.finished.opponent', language)})
            </div>
            <div style={{ fontSize: '1.5rem', fontWeight: 900, color: opponentScore >= 0 ? '#34d399' : '#f87171' }}>
              {opponentScore >= 0 ? '+' : ''}{formatMoney(opponentScore)}
            </div>
          </div>
        </div>

        {/* Two Rounds Breakdown */}
        <div style={{ marginBottom: '20px' }}>
          <div style={{ fontSize: '0.9rem', fontWeight: 800, color: '#fcd34d', marginBottom: '10px' }}>
              {translate('duel.finished.roundBreakdown', language)}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {[1, 2].map((rIndex) => {
              const r = result.rounds.find((rd) => rd.roundIndex === rIndex);
              if (!r) {
                return (
                  <div
                    key={rIndex}
                    style={{
                      background: 'rgba(255, 255, 255, 0.03)',
                      borderRadius: '12px',
                      padding: '12px 16px',
                      fontSize: '0.85rem',
                      color: '#6b7280',
                    }}
                  >
                    {msg('duel.finished.incompleteRound', { round: rIndex })}
                  </div>
                );
              }

              const myProfit = mySeatId === r.challengerSeatId ? r.challengerProfit : r.bankerProfit;
              const opponentProfit = mySeatId === r.challengerSeatId ? r.bankerProfit : r.challengerProfit;
              const outcomeLabel =
                r.outcomeType === 'OFFER_ACCEPTED'
                  ? msg('duel.finished.accepted', { amount: formatMoney(r.acceptedOfferAmount ?? 0) })
                  : r.outcomeType === 'FINAL_KEEP'
                  ? msg('duel.finished.kept', { box: r.originalPlayerBoxId })
                  : r.outcomeType === 'FINAL_SWAP'
                  ? msg('duel.finished.swapped', { box: r.finalPlayerBoxId })
                  : translate('duel.finished.forfeited', language);

              return (
                <div
                  key={rIndex}
                  style={{
                    background: 'rgba(255, 255, 255, 0.04)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: '12px',
                    padding: '12px 16px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px', fontSize: '0.85rem' }}>
                    <strong style={{ color: '#f3f4f6' }}>{msg('duel.finished.roundLabel', { round: rIndex, outcome: outcomeLabel })}</strong>
                    <span style={{ color: '#9ca3af' }}>
                      {translate('duel.finished.role', language)}{mySeatId === r.challengerSeatId ? translate('duel.finished.challenger', language) : translate('duel.finished.banker', language)}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                    <span>{translate('duel.finished.myProfit', language)}<strong style={{ color: myProfit >= 0 ? '#34d399' : '#f87171' }}>{myProfit >= 0 ? '+' : ''}{formatMoney(myProfit)}</strong></span>
                    <span>{translate('duel.finished.opponentProfit', language)}<strong style={{ color: opponentProfit >= 0 ? '#34d399' : '#f87171' }}>{opponentProfit >= 0 ? '+' : ''}{formatMoney(opponentProfit)}</strong></span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Server Fairness Proof Collapsible */}
        <div style={{ marginBottom: '24px' }}>
          <button
            type="button"
            onClick={() => setShowProofs(!showProofs)}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#9ca3af',
              fontSize: '0.85rem',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              cursor: 'pointer',
              padding: 0,
              marginBottom: '8px',
            }}
          >
            <FileText size={16} />
            <span>{translate('duel.finished.fairness', language)}</span>
            {showProofs ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>

          {showProofs && (
            <div
              style={{
                background: 'rgba(0, 0, 0, 0.5)',
                borderRadius: '12px',
                padding: '12px',
                fontSize: '0.75rem',
                fontFamily: 'monospace',
                color: '#d1d5db',
                maxHeight: '140px',
                overflowY: 'auto',
                border: '1px solid rgba(255, 255, 255, 0.1)',
              }}
            >
              <div>{translate('duel.finished.rule', language)}{result.ruleVersion}</div>
              <div>{translate('duel.finished.match', language)}{result.matchId}</div>
              {result.fairnessProofs.map((fp) => (
                <div key={fp.roundIndex} style={{ marginTop: '8px', borderTop: '1px dashed rgba(255, 255, 255, 0.1)', paddingTop: '6px' }}>
                  <div>{msg('duel.finished.roundCommitment', { round: fp.roundIndex })}{fp.commitment}</div>
                  <div>{msg('duel.finished.roundSeed', { round: fp.roundIndex })}{fp.seed}</div>
                  <div>{msg('duel.finished.roundSalt', { round: fp.roundIndex })}{fp.salt}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <ShareControls resultId={result.resultId} mode="duel" />

        {/* Bottom Actions */}
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={handleClose}
            className="btn-secondary"
            style={{ minHeight: '44px', padding: '10px 18px', display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem' }}
          >
            <Eye size={16} />
            <span>{translate('duel.finished.viewStage', language)}</span>
          </button>
          <button
            type="button"
            onClick={handleDownloadProof}
            className="btn-secondary"
            style={{ minHeight: '44px', padding: '10px 18px', display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem' }}
          >
            <Download size={16} />
            <span>{translate('duel.finished.downloadProof', language)}</span>
          </button>
          <button
            type="button"
            onClick={onReturnToLobby}
            className="duel-action-btn btn-primary"
            style={{ minHeight: '44px', padding: '10px 24px' }}
          >
            <Home size={16} />
            <span>{translate('duel.finished.returnLobby', language)}</span>
          </button>
        </div>
      </div>
    </dialog>
  );
};
