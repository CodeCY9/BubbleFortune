import React from 'react';
import { BoxData, OpenedBoxData, formatMoney, MONEY_VALUES } from '../types/game';
import { Layers, Diamond, Crown, Sparkles } from 'lucide-react';
import { translate, useLanguage } from '../i18n';

interface MoneyLadderProps {
  boxes: BoxData[];
  playerBoxId: number | null;
}

export const LowMoneyLadder: React.FC<MoneyLadderProps> = ({ boxes, playerBoxId }) => {
  const language = useLanguage();
  const openedValues = new Set(
    boxes.filter((b): b is OpenedBoxData => b.isOpened).map((b) => b.value)
  );
  const playerBox = boxes.find((b) => b.id === playerBoxId);
  const isPlayerVal = (val: number) =>
    playerBox && playerBox.isOpened ? playerBox.value === val : false;
  const lowValues = MONEY_VALUES.slice(0, 13);
  const remainingCount = lowValues.filter((v) => !openedValues.has(v)).length;

  return (
    <div className="studio-ladder-panel safe-tier">
      {/* Header with tactical live counter */}
      <div className="studio-ladder-header">
        <div className="studio-ladder-title-group">
          <div className="studio-ladder-icon-wrap">
            <Layers size={15} />
          </div>
          <span className="studio-ladder-title">{translate('game.lowArea', language)}</span>
        </div>
        <span className="studio-ladder-count-badge">
          {translate('game.lowRemaining', language)
            .replace('{count}', String(remainingCount))
            .replace('{total}', String(lowValues.length))}
        </span>
      </div>

      {/* Plaques List */}
      <div className="studio-ladder-list">
        {lowValues.map((val) => {
          const isEliminated = openedValues.has(val);
          const isPlayerBoxVal = isPlayerVal(val);

          return (
            <div
              key={val}
              className={`studio-money-plaque safe-tier-item money-item low-tier ${
                isEliminated ? 'eliminated' : ''
              } ${isPlayerBoxVal ? 'player-box' : ''}`}
            >
              <span className="studio-plaque-val">{formatMoney(val)}</span>
              {isPlayerBoxVal && (
                <span className="studio-plaque-badge player-badge">
                  ★ {translate('stage.myBox', language)}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export const HighMoneyLadder: React.FC<MoneyLadderProps> = ({ boxes, playerBoxId }) => {
  const language = useLanguage();
  const openedValues = new Set(
    boxes.filter((b): b is OpenedBoxData => b.isOpened).map((b) => b.value)
  );
  const playerBox = boxes.find((b) => b.id === playerBoxId);
  const isPlayerVal = (val: number) =>
    playerBox && playerBox.isOpened ? playerBox.value === val : false;
  const highValues = MONEY_VALUES.slice(13);
  const remainingCount = highValues.filter((v) => !openedValues.has(v)).length;

  return (
    <div className="studio-ladder-panel high-tier">
      {/* Header with tactical live counter */}
      <div className="studio-ladder-header">
        <div className="studio-ladder-title-group">
          <div className="studio-ladder-icon-wrap">
            <Diamond size={15} />
          </div>
          <span className="studio-ladder-title">{translate('game.highArea', language)}</span>
        </div>
        <span className="studio-ladder-count-badge">
          {translate('game.highRemaining', language)
            .replace('{count}', String(remainingCount))
            .replace('{total}', String(highValues.length))}
        </span>
      </div>

      {/* Plaques List */}
      <div className="studio-ladder-list">
        {highValues.map((val) => {
          const isEliminated = openedValues.has(val);
          const isPlayerBoxVal = isPlayerVal(val);
          const isMillion = val === 1000000;
          const isJackpot = val >= 500000;

          return (
            <div
              key={val}
              className={`studio-money-plaque high-tier-item money-item high-tier ${
                isMillion ? 'million-jackpot' : isJackpot ? 'jackpot-tier' : ''
              } ${isEliminated ? 'eliminated' : ''} ${isPlayerBoxVal ? 'player-box' : ''}`}
            >
              <span className="studio-plaque-val">{formatMoney(val)}</span>

              {isPlayerBoxVal ? (
                <span className="studio-plaque-badge player-badge">
                  ★ {translate('stage.myBox', language)}
                </span>
              ) : isMillion ? (
                <span className="studio-plaque-badge top-badge" title={translate('game.topPrize', language)}>
                  <Crown size={11} />
                </span>
              ) : isJackpot ? (
                <span className="studio-plaque-badge top-badge">
                  <Sparkles size={11} />
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
};
