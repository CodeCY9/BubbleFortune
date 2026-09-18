import React, { useState } from 'react';
import {
  Trophy,
  Crown,
  ShieldCheck,
  Share2,
  Copy,
  Check,
  LogOut,
  ChevronDown,
  ChevronUp,
  History,
  Sparkles,
} from 'lucide-react';
import type { AuctionResult } from '../../packages/protocol/src/auction';
import { formatMoney } from '../types/game';
import { createAuctionShare } from '../api/auction';
import { translate, useLanguage, type LanguagePreference, type TranslationKey } from '../i18n';

interface AuctionFinishedModalProps {
  result: AuctionResult;
  mySeatId: number | null;
  onOpenHistory: () => void;
  onLeave: () => void;
}

export function formatOutcomeText(outcome: string, language: LanguagePreference = 'zh-CN'): string {
  switch (outcome) {
    case 'OFFER_ACCEPTED':
      return translate('auction.finished.outcome.accepted', language);
    case 'FINAL_KEEP':
      return translate('auction.finished.outcome.keep', language);
    case 'FINAL_SWAP':
      return translate('auction.finished.outcome.swap', language);
    case 'FORFEIT':
      return translate('auction.finished.outcome.forfeit', language);
    default:
      return outcome;
  }
}

export function formatReasonText(reason: string, language: LanguagePreference = 'zh-CN'): string {
  switch (reason) {
    case 'NORMAL':
      return translate('auction.finished.reason.normal', language);
    case 'FORFEIT_ALL':
      return translate('auction.finished.reason.allForfeit', language);
    case 'SURVIVOR_WIN':
      return translate('auction.finished.reason.survivorWin', language);
    case 'TIMEOUT_DISCONNECT':
      return translate('auction.finished.reason.timeout', language);
    default:
      return reason;
  }
}

export const AuctionFinishedModal: React.FC<AuctionFinishedModalProps> = ({
  result,
  mySeatId,
  onOpenHistory,
  onLeave,
}) => {
  const language = useLanguage();
  const msg = (key: TranslationKey, replacements: Record<string, string | number> = {}) =>
    Object.entries(replacements).reduce(
      (text, [name, value]) => text.replace(new RegExp(`\\{${name}\\}`, 'g'), String(value)),
      translate(key, language),
    );
  const [activeTab, setActiveTab] = useState<'RANKINGS' | 'ROUNDS' | 'FAIRNESS'>('RANKINGS');
  const [isSharing, setIsSharing] = useState(false);
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);

  const winner = result.rankings.find((r) => r.rank === 1);

  const handleShare = async () => {
    setIsSharing(true);
    setShareError(null);
    try {
      const res = await createAuctionShare(result.matchId);
      if (res.ok && res.data) {
        const fullUrl = `${window.location.origin}${res.data.path}`;
        setShareLink(fullUrl);
        await navigator.clipboard.writeText(fullUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      } else {
        setShareError(res.error?.message || translate('auction.finished.shareError', language));
      }
    } catch {
      setShareError(translate('auction.finished.networkShareError', language));
    } finally {
      setIsSharing(false);
    }
  };

  const handleSystemShare = async () => {
    if (!shareLink || typeof navigator.share !== 'function') return;
    try {
      await navigator.share({ title: translate('auction.finished.title', language), url: shareLink });
    } catch (error) {
      if (!(error instanceof Error && error.name === 'AbortError')) setShareError(translate('auction.finished.systemShareError', language));
    }
  };

  return (
    <div className="duel-entrance-overlay" style={{ zIndex: 70 }}>
      <div
        className="duel-card"
        style={{
          maxWidth: '760px',
          width: '100%',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          padding: '24px 28px',
        }}
      >
        {/* Modal Header */}
        <div style={{ textAlign: 'center', marginBottom: '16px', position: 'relative' }}>
          <div
            style={{
              width: '56px',
              height: '56px',
              borderRadius: '50%',
              background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.3) 0%, rgba(217, 119, 6, 0.1) 100%)',
              border: '2px solid #f59e0b',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 10px',
              boxShadow: '0 0 20px rgba(245, 158, 11, 0.4)',
            }}
          >
            <Trophy size={30} color="#fcd34d" />
          </div>

          <h2 style={{ fontSize: '1.8rem', fontWeight: 900, color: '#fcd34d', margin: '0 0 4px' }}>
            {translate('auction.finished.title', language)}
          </h2>
          <div style={{ fontSize: '0.85rem', color: '#9ca3af' }}>
            {formatReasonText(result.reason, language)} · {translate('auction.finished.champion', language)}<strong style={{ color: '#ffffff' }}>{winner?.nickname || translate('auction.finished.none', language)}</strong>
          </div>
        </div>

        {/* Tab Buttons */}
        <div className="duel-tabs" style={{ marginBottom: '16px' }}>
          <button
            type="button"
            className={`duel-tab-btn ${activeTab === 'RANKINGS' ? 'active' : ''}`}
            onClick={() => setActiveTab('RANKINGS')}
          >
            {translate('auction.finished.rankings', language)}
          </button>
          <button
            type="button"
            className={`duel-tab-btn ${activeTab === 'ROUNDS' ? 'active' : ''}`}
            onClick={() => setActiveTab('ROUNDS')}
          >
            {translate('auction.finished.rounds', language)}
          </button>
          <button
            type="button"
            className={`duel-tab-btn ${activeTab === 'FAIRNESS' ? 'active' : ''}`}
            onClick={() => setActiveTab('FAIRNESS')}
          >
            {translate('auction.finished.fairness', language)}
          </button>
        </div>

        {/* Tab 1: Rankings Table */}
        <div style={{ flex: 1, overflowY: 'auto', marginBottom: '16px', paddingRight: '4px' }}>
          {activeTab === 'RANKINGS' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '50px 1fr 120px 120px 70px',
                  padding: '8px 12px',
                  fontSize: '0.75rem',
                  fontWeight: 800,
                  color: '#9ca3af',
                  borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
                }}
              >
                <span>{translate('auction.finished.rank', language)}</span>
                <span>{translate('auction.finished.player', language)}</span>
                <span style={{ textAlign: 'right' }}>{translate('auction.finished.score', language)}</span>
                <span style={{ textAlign: 'right' }}>{translate('auction.finished.capital', language)}</span>
                <span style={{ textAlign: 'center' }}>{translate('auction.finished.status', language)}</span>
              </div>

              {result.rankings.map((rank) => {
                const isMe = rank.seatId === mySeatId;
                const isTop1 = rank.rank === 1;

                return (
                  <div
                    key={rank.seatId}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '50px 1fr 120px 120px 70px',
                      alignItems: 'center',
                      padding: '10px 12px',
                      borderRadius: '10px',
                      background: isMe
                        ? 'rgba(245, 158, 11, 0.15)'
                        : isTop1
                        ? 'rgba(245, 158, 11, 0.08)'
                        : 'rgba(255, 255, 255, 0.03)',
                      border: isMe
                        ? '1.5px solid #f59e0b'
                        : isTop1
                        ? '1px solid rgba(245, 158, 11, 0.3)'
                        : '1px solid rgba(255, 255, 255, 0.06)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      {isTop1 ? <Crown size={16} color="#f59e0b" /> : null}
                      <strong style={{ color: isTop1 ? '#fcd34d' : '#ffffff', fontSize: '0.95rem' }}>
                        #{rank.rank}
                      </strong>
                    </div>

                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <strong style={{ color: isMe ? '#fcd34d' : '#ffffff', fontSize: '0.9rem' }}>
                        {rank.nickname}
                      </strong>
                      {isMe && <span style={{ fontSize: '0.75rem', color: '#fcd34d', marginLeft: '4px' }}>({translate('auction.finished.you', language)})</span>}
                    </div>

                    <div style={{ textAlign: 'right', fontWeight: 800, color: rank.score >= 0 ? '#10b981' : '#ef4444' }}>
                      {formatMoney(rank.score)}
                    </div>

                    <div style={{ textAlign: 'right', color: '#e5e7eb', fontSize: '0.85rem' }}>
                      {formatMoney(rank.remainingCapital)}
                    </div>

                    <div style={{ textAlign: 'center' }}>
                      {rank.forfeited ? (
                        <span style={{ fontSize: '0.7rem', padding: '2px 6px', borderRadius: '4px', background: 'rgba(239, 68, 68, 0.2)', color: '#f87171' }}>
                          {translate('auction.finished.forfeited', language)}
                        </span>
                      ) : (
                        <span style={{ fontSize: '0.7rem', padding: '2px 6px', borderRadius: '4px', background: 'rgba(16, 185, 129, 0.2)', color: '#6ee7b7' }}>
                          {translate('auction.finished.normal', language)}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Tab 2: Rounds Breakdown */}
          {activeTab === 'ROUNDS' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {result.rounds.map((round) => {
                const challenger = result.rankings.find((r) => r.seatId === round.challengerSeatId);
                const winnerCap =
                  round.winningCapitalistSeatId !== null && round.winningCapitalistSeatId !== undefined
                    ? result.rankings.find((r) => r.seatId === round.winningCapitalistSeatId)
                    : null;

                return (
                  <div
                    key={round.roundIndex}
                    style={{
                      background: 'rgba(0, 0, 0, 0.35)',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      borderRadius: '12px',
                      padding: '12px 16px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '6px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ fontWeight: 800, color: '#fcd34d', fontSize: '0.95rem' }}>
                        {msg('auction.finished.round', { round: round.roundIndex + 1, name: challenger?.nickname ?? `${translate('auction.seat', language).replace('{number}', String(round.challengerSeatId + 1))}` })}
                      </div>
                      <span style={{ fontSize: '0.75rem', padding: '2px 8px', borderRadius: '6px', background: 'rgba(245, 158, 11, 0.2)', color: '#fcd34d' }}>
                        {formatOutcomeText(round.outcomeType, language)}
                      </span>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '8px', fontSize: '0.85rem', color: '#d1d5db', marginTop: '4px' }}>
                      <div>
                        {msg('auction.finished.originalBox', { box: round.originalPlayerBoxId })}<strong>{formatMoney(round.originalPlayerBoxAmount)}</strong>
                      </div>
                      {round.acceptedOfferAmount && (
                        <div>
                          {translate('auction.finished.acceptedOffer', language)}<strong style={{ color: '#fcd34d' }}>{formatMoney(round.acceptedOfferAmount)}</strong>
                        </div>
                      )}
                      <div>
                        {translate('auction.finished.challengerProfit', language)}<strong style={{ color: '#10b981' }}>+{formatMoney(round.challengerProfit)}</strong>
                      </div>
                      {winnerCap && (
                        <div>
                          {translate('auction.finished.buyoutCapitalist', language)}<strong>{winnerCap.nickname}</strong>
                          {' '}({translate('auction.finished.netProfit', language)}<span style={{ color: (round.capitalistProfits[round.winningCapitalistSeatId!] ?? 0) >= 0 ? '#10b981' : '#ef4444' }}>
                            {formatMoney(round.capitalistProfits[round.winningCapitalistSeatId!] ?? 0)}
                          </span>)
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Tab 3: Fairness Proofs */}
          {activeTab === 'FAIRNESS' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ fontSize: '0.85rem', color: '#9ca3af', marginBottom: '4px' }}>
                {translate('auction.finished.fairnessIntro', language)}
              </div>

              {result.fairnessProofs.map((proof) => (
                <div
                  key={proof.roundIndex}
                  style={{
                    background: 'rgba(0, 0, 0, 0.4)',
                    border: '1px solid rgba(16, 185, 129, 0.3)',
                    borderRadius: '12px',
                    padding: '12px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                    fontFamily: 'monospace',
                    fontSize: '0.8rem',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#10b981', fontWeight: 800 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <ShieldCheck size={16} /> {msg('auction.finished.credential', { round: proof.roundIndex + 1 })}
                    </span>
                    <span>{proof.algorithm}</span>
                  </div>

                  <div style={{ color: '#9ca3af', wordBreak: 'break-all' }}>
                    <strong>{translate('auction.finished.commitment', language)}</strong><br />
                    <span style={{ color: '#fcd34d' }}>{proof.commitment}</span>
                  </div>

                  <div style={{ color: '#9ca3af', wordBreak: 'break-all' }}>
                    <strong>{translate('auction.finished.seed', language)}</strong> {proof.seed}
                  </div>

                  <div style={{ color: '#9ca3af', wordBreak: 'break-all' }}>
                    <strong>{translate('auction.finished.salt', language)}</strong> {proof.salt}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Share Status Notice */}
        {shareLink && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: 'rgba(16, 185, 129, 0.15)',
              border: '1px solid rgba(16, 185, 129, 0.4)',
              borderRadius: '10px',
              padding: '8px 12px',
              marginBottom: '12px',
              fontSize: '0.85rem',
            }}
          >
            <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#6ee7b7' }}>
              {translate('auction.finished.shared', language)}{shareLink}
            </div>
            <span style={{ color: '#10b981', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Check size={16} /> {translate('auction.finished.copied', language)}
            </span>
          </div>
        )}

        {shareError && (
          <div style={{ color: '#f87171', fontSize: '0.85rem', marginBottom: '10px', textAlign: 'center' }}>
            {shareError}
          </div>
        )}

        {/* Footer Actions */}
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={onOpenHistory}
            className="btn-secondary"
            style={{ minHeight: '44px', padding: '8px 16px', display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <History size={16} />
            <span>{translate('auction.finished.history', language)}</span>
          </button>

          <button
            type="button"
            disabled={isSharing}
            onClick={handleShare}
            className="btn-primary"
            style={{ minHeight: '44px', padding: '8px 20px', display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 800 }}
          >
            <Share2 size={16} />
            <span>{isSharing ? translate('auction.finished.generating', language) : translate('auction.finished.share', language)}</span>
          </button>

          {shareLink && typeof navigator.share === 'function' && (
            <button
              type="button"
              onClick={() => void handleSystemShare()}
              className="btn-secondary"
              style={{ minHeight: '44px', padding: '8px 16px', display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 800 }}
            >
              <Share2 size={16} />
                <span>{translate('auction.finished.systemShare', language)}</span>
            </button>
          )}

          <button
            type="button"
            onClick={onLeave}
            className="duel-action-btn reject"
            style={{ minHeight: '44px', padding: '8px 20px', display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 800 }}
          >
            <LogOut size={16} />
            <span>{translate('auction.finished.returnLobby', language)}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
