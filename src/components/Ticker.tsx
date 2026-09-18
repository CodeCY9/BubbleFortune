import React from 'react';
import { OpenedBoxData, formatMoney } from '../types/game';
import { List } from 'lucide-react';
import { translate, useLanguage } from '../i18n';

interface TickerProps {
  openedBoxes: OpenedBoxData[];
}

export const Ticker: React.FC<TickerProps> = ({ openedBoxes }) => {
  const language = useLanguage();
  // Sort boxes by open order if possible. Since we don't track open time, we'll just reverse it to show latest if we assume they are appended.
  // Actually, let's just show them in the order they were opened.
  // We don't have open order in BoxData natively without a timestamp, but let's assume they are filtered and we just show the last few.
  const recentBoxes = [...openedBoxes].reverse().slice(0, 5); // Show last 5

  return (
    <div className="activity-ticker">
      {/* Label */}
      <div
        style={{
          background: 'rgba(59, 130, 246, 0.2)',
          color: '#60A5FA',
          padding: '4px 12px',
          borderRadius: '12px',
          fontSize: '0.8rem',
          fontWeight: 700,
          border: '1px solid rgba(59, 130, 246, 0.4)',
          marginRight: '16px',
        }}
      >
        {translate('game.ticker.openedThisRound', language)}
      </div>

      {/* Scrolling List / Fading List */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          gap: '24px',
          overflow: 'hidden',
          whiteSpace: 'nowrap',
        }}
      >
        {recentBoxes.map((box) => {
          const isHigh = box.value >= 1000;
          return (
            <div
              key={box.id}
              style={{
                fontSize: '0.85rem',
                color: isHigh ? '#F472B6' : '#06B6D4',
                fontWeight: 600,
              }}
            >
              {translate('game.ticker.opened', language).replace('{box}', String(box.id))} <span style={{ opacity: 0.5 }}>-&gt;</span> {formatMoney(box.value)}
            </div>
          );
        })}
      </div>

      {/* Right Action */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          color: '#9CA3AF',
          fontSize: '0.8rem',
          cursor: 'pointer',
          paddingLeft: '16px',
          borderLeft: '1px solid rgba(255, 255, 255, 0.1)',
        }}
      >
        <span>{translate('game.ticker.viewAll', language)}</span>
        <List size={14} />
      </div>
    </div>
  );
};
