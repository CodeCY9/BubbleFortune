import React, { useState, useEffect } from 'react';
import type { AuctionReactionEvent } from '../../packages/protocol/src/auction';
import { translate, useLanguage, type TranslationKey } from '../i18n';

const EMOJIS = ['👍', '👎', '👏', '🎉', '🔥', '💰', '😮', '🤔', '😱', '💪', '🤝', '😎'] as const;

interface AuctionEmoteBarProps {
  onSendEmote: (emoji: string) => void;
  lastReaction?: AuctionReactionEvent | null;
  disabled?: boolean;
}

export const AuctionEmoteBar: React.FC<AuctionEmoteBarProps> = ({
  onSendEmote,
  lastReaction,
  disabled = false,
}) => {
  const language = useLanguage();
  const msg = (key: TranslationKey, replacements: Record<string, string> = {}) =>
    Object.entries(replacements).reduce(
      (text, [name, value]) => text.replace(new RegExp(`\\{${name}\\}`, 'g'), value),
      translate(key, language),
    );
  const [displayedReaction, setDisplayedReaction] = useState<AuctionReactionEvent | null>(null);
  const [cooldown, setCooldown] = useState(false);

  // Reaction bubble animation
  useEffect(() => {
    if (lastReaction && lastReaction.timestamp) {
      setDisplayedReaction(lastReaction);
      const timer = setTimeout(() => {
        setDisplayedReaction(null);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [lastReaction?.timestamp, lastReaction?.emoji]);

  const handleEmoteClick = (emoji: string) => {
    if (disabled || cooldown) return;
    onSendEmote(emoji);
    setCooldown(true);
    setTimeout(() => setCooldown(false), 1000);
  };

  return (
    <div
      className="auction-emote-container"
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '6px',
        padding: '6px 12px',
        zIndex: 25,
      }}
    >
      {/* Floating Reaction Bubble */}
      {displayedReaction && (
        <div
          className="reaction-floating-bubble"
          style={{
            position: 'absolute',
            bottom: '100%',
            marginBottom: '8px',
            background: 'rgba(20, 15, 40, 0.95)',
            border: '1.5px solid rgba(245, 158, 11, 0.5)',
            borderRadius: '20px',
            padding: '6px 14px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.6), 0 0 12px rgba(245, 158, 11, 0.3)',
            animation: 'fadeInUp 0.3s ease',
            pointerEvents: 'none',
          }}
        >
          <span style={{ fontSize: '1.4rem' }}>{displayedReaction.emoji}</span>
          <span style={{ fontSize: '0.85rem', fontWeight: 800, color: '#fcd34d' }}>
            {displayedReaction.senderNickname}
          </span>
          {displayedReaction.isSpectator && (
            <span style={{ fontSize: '0.7rem', color: '#67e8f9', background: 'rgba(6, 182, 212, 0.2)', padding: '1px 5px', borderRadius: '4px' }}>
              {msg('auction.emote.spectator')}
            </span>
          )}
        </div>
      )}

      {/* Quick Emote Buttons Bar */}
      <div
        className="glass-panel"
        style={{
          display: 'flex',
          gap: '4px',
          padding: '4px 8px',
          borderRadius: '24px',
          background: 'rgba(10, 8, 22, 0.85)',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          overflowX: 'auto',
          maxWidth: '100%',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {EMOJIS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            disabled={disabled || cooldown}
            onClick={() => handleEmoteClick(emoji)}
            aria-label={msg('auction.emote.send', { emoji })}
            style={{
              background: 'transparent',
              border: 'none',
              fontSize: '1.2rem',
              padding: '4px 6px',
              borderRadius: '8px',
              cursor: disabled || cooldown ? 'not-allowed' : 'pointer',
              opacity: disabled || cooldown ? 0.5 : 1,
              transition: 'transform 0.15s, background-color 0.15s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'scale(1.25)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
            }}
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  );
};
