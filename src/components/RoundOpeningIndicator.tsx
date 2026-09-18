import React from 'react';
import { Sparkles, Briefcase, CheckCircle2, PhoneCall, RefreshCw, ArrowRightLeft } from 'lucide-react';
import { ROUND_TARGETS } from '../../packages/protocol/src/config';
import { translate, useLanguage } from '../i18n';

interface RoundOpeningIndicatorProps {
  phase: string;
  currentRound: number;
  boxesLeftToOpenThisRound: number;
  challengeMode?: boolean;
  challenge?: {
    inquiryAvailable?: boolean;
    insuranceAvailable?: boolean;
    insuranceFloor?: number;
    insurancePremium?: number;
    insurancePurchased?: boolean;
    timedOpeningSeconds?: number;
    noDealRounds?: number;
  } | null;
  onUseInquiry?: () => void;
  onBuyInsurance?: () => void;
  isPending?: boolean;
  connectionStatus?: string;
  finalRevealPrompt?: string | null;
}

export const RoundOpeningIndicator: React.FC<RoundOpeningIndicatorProps> = ({
  phase,
  currentRound,
  boxesLeftToOpenThisRound,
  challengeMode = false,
  challenge = null,
  onUseInquiry,
  onBuyInsurance,
  isPending = false,
  connectionStatus = 'connected',
  finalRevealPrompt = null,
}) => {
  const language = useLanguage();
  const targetCount = ROUND_TARGETS[currentRound - 1] ?? 1;
  const boxesLeft = Math.max(0, boxesLeftToOpenThisRound);
  const openedThisRound = Math.min(targetCount, Math.max(0, targetCount - boxesLeft));

  return (
    <div
      className="round-opening-hud"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '8px',
        maxWidth: '92vw',
        animation: 'fadeIn 0.3s ease-out',
      }}
    >
      <div
        className="glass-card-gold"
        style={{
          padding: '10px 22px',
          borderRadius: '24px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '8px',
          background: 'linear-gradient(135deg, rgba(28, 22, 14, 0.9) 0%, rgba(18, 24, 38, 0.92) 100%)',
          border: '1px solid rgba(250, 204, 21, 0.35)',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6), 0 0 20px rgba(245, 158, 11, 0.15)',
          pointerEvents: 'auto',
        }}
      >
        {/* Phase: Choose Player Box */}
        {phase === 'CHOOSE_PLAYER_BOX' && (
          <div
            style={{
              color: '#fcd34d',
              fontWeight: 800,
              fontSize: '0.96rem',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '2px 8px',
            }}
          >
            <div
              style={{
                width: '28px',
                height: '28px',
                borderRadius: '50%',
                background: 'rgba(250, 204, 21, 0.2)',
                border: '1px solid #facc15',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fef08a',
              }}
            >
              <Sparkles size={16} />
            </div>
            <span>{translate('game.selectBoxPrompt', language)}</span>
          </div>
        )}

        {/* Phase: Opening Boxes (Vivid Matrix & Step Gauges) */}
        {phase === 'OPEN_BOXES' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', width: '100%' }}>
            {/* Header row: Round pill + Remaining counter */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', justifyContent: 'center' }}>
              <span
                style={{
                  background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.25), rgba(180, 83, 9, 0.35))',
                  border: '1px solid rgba(250, 204, 21, 0.5)',
                  color: '#fef08a',
                  fontSize: '0.78rem',
                  fontWeight: 900,
                  padding: '3px 10px',
                  borderRadius: '12px',
                  letterSpacing: '0.5px',
                  textTransform: 'uppercase',
                }}
              >
                {translate('header.round', language).replace('{round}', String(currentRound))}
              </span>

              <div style={{ color: '#ffffff', fontWeight: 800, fontSize: '0.94rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span>{translate('game.roundNeedOpen', language).replace('{count}', '')}</span>
                <span
                  style={{
                    color: '#facc15',
                    fontSize: '1.25rem',
                    fontWeight: 900,
                    fontFamily: 'var(--font-mono, monospace)',
                    textShadow: '0 0 12px rgba(250, 204, 21, 0.6)',
                  }}
                >
                  {boxesLeft}
                </span>
                <span>/ {targetCount}</span>
              </div>
            </div>

            {/* Matrix dots / Briefcase icons row */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '4px 8px',
                background: 'rgba(0, 0, 0, 0.3)',
                borderRadius: '14px',
                border: '1px solid rgba(255, 255, 255, 0.08)',
              }}
            >
              {Array.from({ length: targetCount }).map((_, index) => {
                const isOpened = index < openedThisRound;
                const isNextTarget = index === openedThisRound;

                return (
                  <div
                    key={index}
                    title={
                      isOpened
                        ? `${index + 1}: ${translate('game.caseState.opened', language)}`
                        : `${index + 1}: ${translate('game.caseState.waiting', language)}`
                    }
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '32px',
                      height: '32px',
                      borderRadius: '8px',
                      transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                      background: isOpened
                        ? 'rgba(34, 197, 94, 0.15)'
                        : isNextTarget
                          ? 'rgba(245, 158, 11, 0.3)'
                          : 'rgba(255, 255, 255, 0.05)',
                      border: isOpened
                        ? '1px solid rgba(34, 197, 94, 0.5)'
                        : isNextTarget
                          ? '1px solid #facc15'
                          : '1px solid rgba(255, 255, 255, 0.12)',
                      boxShadow: isNextTarget
                        ? '0 0 12px rgba(250, 204, 21, 0.5)'
                        : 'none',
                      transform: isNextTarget ? 'scale(1.08)' : 'scale(1)',
                    }}
                  >
                    {isOpened ? (
                      <CheckCircle2 size={16} color="#4ade80" />
                    ) : (
                      <Briefcase
                        size={15}
                        color={isNextTarget ? '#fde047' : '#94a3b8'}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Phase: Banker Thinking / Offer */}
        {phase === 'BANKER_OFFER' && (
          <div
            style={{
              color: '#67e8f9',
              fontWeight: 800,
              fontSize: '0.95rem',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '2px 8px',
            }}
          >
            <div
              style={{
                width: '28px',
                height: '28px',
                borderRadius: '50%',
                background: 'rgba(6, 182, 212, 0.2)',
                border: '1px solid #22d3ee',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#67e8f9',
                animation: 'pulse 1.5s infinite',
              }}
            >
              <PhoneCall size={15} />
            </div>
            <span>{translate('game.bankerThinking', language)}</span>
          </div>
        )}

        {/* Final Reveal Prompt */}
        {finalRevealPrompt && (
          <div
            style={{
              color: '#facc15',
              fontWeight: 800,
              fontSize: '0.95rem',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '2px 8px',
              animation: 'pulse 2s infinite ease-in-out',
            }}
          >
            <div
              style={{
                width: '28px',
                height: '28px',
                borderRadius: '50%',
                background: 'rgba(250, 204, 21, 0.25)',
                border: '1px solid #facc15',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fef08a',
              }}
            >
              <Sparkles size={16} />
            </div>
            <span>{finalRevealPrompt}</span>
          </div>
        )}

        {/* Phase: Final Swap */}
        {!finalRevealPrompt && phase === 'FINAL_SWAP' && (
          <div
            style={{
              color: '#facc15',
              fontWeight: 800,
              fontSize: '0.95rem',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '2px 8px',
            }}
          >
            <div
              style={{
                width: '28px',
                height: '28px',
                borderRadius: '50%',
                background: 'rgba(250, 204, 21, 0.2)',
                border: '1px solid #facc15',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fef08a',
              }}
            >
              <ArrowRightLeft size={16} />
            </div>
            <span>{translate('final.question', language)}</span>
          </div>
        )}

        {/* Challenge Mode Extras */}
        {challengeMode && challenge && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', width: '100%', marginTop: '4px' }}>
            {challenge.inquiryAvailable && phase !== 'GAME_OVER' && (
              <button
                type="button"
                onClick={onUseInquiry}
                disabled={isPending || connectionStatus !== 'connected'}
                style={{
                  minHeight: '34px',
                  padding: '4px 14px',
                  borderRadius: '10px',
                  border: '1px solid rgba(103,232,249,0.5)',
                  background: 'rgba(8,47,73,0.85)',
                  color: '#a5f3fc',
                  fontWeight: 800,
                  fontSize: '0.8rem',
                  cursor: isPending ? 'not-allowed' : 'pointer',
                }}
              >
                {translate('challenge.useInquiry', language)}
              </button>
            )}

            {challenge.insuranceAvailable && phase === 'OPEN_BOXES' && (
              <button
                type="button"
                onClick={onBuyInsurance}
                disabled={isPending || connectionStatus !== 'connected'}
                style={{
                  minHeight: '34px',
                  padding: '4px 14px',
                  borderRadius: '10px',
                  border: '1px solid rgba(251,191,36,0.55)',
                  background: 'rgba(120,53,15,0.85)',
                  color: '#fde68a',
                  fontWeight: 800,
                  fontSize: '0.8rem',
                  cursor: isPending ? 'not-allowed' : 'pointer',
                }}
              >
                {translate('challenge.buyInsurance', language)
                  .replace('{floor}', challenge.insuranceFloor?.toLocaleString() ?? '—')
                  .replace('{premium}', challenge.insurancePremium?.toLocaleString() ?? '—')}
              </button>
            )}

            {phase !== 'GAME_OVER' && (
              <div style={{ color: '#c4b5fd', fontSize: '0.72rem', textAlign: 'center' }}>
                {translate('challenge.rules', language)
                  .replace('{seconds}', String(challenge.timedOpeningSeconds ?? 20))
                  .replace('{rounds}', String(challenge.noDealRounds ?? 1))}
                {challenge.insurancePurchased ? translate('challenge.insuranceActive', language) : ''}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
