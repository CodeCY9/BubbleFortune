import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { PublicBox } from '../../packages/protocol/src/types';
import type { BoxData, GamePhase } from '../types/game';
import { translate, useLanguage } from '../i18n';

const Stage3D = React.lazy(() => import('./Stage3D').then((module) => ({ default: module.Stage3D })));

export type MultiplayerStagePhase =
  | 'WAITING'
  | 'SELECTING_PERSONAL'
  | 'OPENING'
  | 'OFFERING'
  | 'FINISHED'
  | 'ROUND_COMPLETE';

interface MultiplayerStage3DProps {
  boxes: PublicBox[];
  personalBoxId: number | null;
  phase: MultiplayerStagePhase | string;
  currentChooserSeatId: number | null;
  mySeatId: number | null;
  allowedActions: readonly string[];
  onSelectBox: (boxId: number) => void;
  onOpenBox: (boxId: number) => void;
  playerBoxLabel?: string;
  lowQuality?: boolean;
  reducedMotion?: boolean;
  onAnimationChange?: (boxId: number | null) => void;
}

function toGamePhase(phase: string): GamePhase {
  if (phase === 'SELECTING_PERSONAL' || phase === 'SELECTING') return 'CHOOSE_PLAYER_BOX';
  if (phase === 'OPENING') return 'OPEN_BOXES';
  if (phase === 'FINAL_SWAP') return 'FINAL_SWAP';
  if (phase === 'OFFERING') return 'BANKER_OFFER';
  if (phase === 'SUBMITTING_OFFER') return 'BANKER_OFFER';
  if (phase === 'FINISHED') return 'GAME_OVER';
  return 'MODE_SELECT';
}

function toBoxData(boxes: PublicBox[], personalBoxId: number | null): BoxData[] {
  return boxes.map((box) => {
    const isPlayerBox = box.id === personalBoxId;
    if (box.status === 'opened') {
      return {
        id: box.id,
        isOpened: true,
        isPlayerBox,
        value: box.revealedAmount,
        revealedAmount: box.revealedAmount,
      };
    }
    return { id: box.id, isOpened: false, isPlayerBox };
  });
}

/**
 * Shared 26-box 3D presentation for multiplayer modes. It only maps the
 * public box whitelist into the existing stage; hidden amounts never enter
 * this component. Commands still go through the room's server-authoritative
 * action handlers.
 */
export const MultiplayerStage3D: React.FC<MultiplayerStage3DProps> = ({
  boxes,
  personalBoxId,
  phase,
  currentChooserSeatId,
  mySeatId,
  allowedActions,
  onSelectBox,
  onOpenBox,
  playerBoxLabel,
  lowQuality = false,
  reducedMotion = false,
  onAnimationChange,
}) => {
  const language = useLanguage();
  const resolvedPlayerBoxLabel = playerBoxLabel || translate('stage.myBox', language);
  const stageBoxes = useMemo(() => toBoxData(boxes, personalBoxId), [boxes, personalBoxId]);
  const openedIds = useMemo(() => boxes.filter((box) => box.status === 'opened').map((box) => box.id), [boxes]);
  const previousOpenedRef = useRef<number[] | null>(null);
  const previousPhaseRef = useRef<string>(phase);
  const [openingBoxId, setOpeningBoxId] = useState<number | null>(null);
  const [showOpeningCurtain, setShowOpeningCurtain] = useState(true);

  useEffect(() => {
    const previousPhase = previousPhaseRef.current;
    previousPhaseRef.current = phase;
    if (phase === 'WAITING') {
      setShowOpeningCurtain(false);
      return;
    }
    // Show the curtain on initial mount and when a new match leaves the waiting room,
    // but never restart it for ordinary phase changes or a settings toggle.
    if (previousPhase !== phase && previousPhase !== 'WAITING') return;
    setShowOpeningCurtain(!reducedMotion);
    const timer = window.setTimeout(() => setShowOpeningCurtain(false), reducedMotion ? 1 : 3200);
    return () => window.clearTimeout(timer);
  }, [phase]);

  useEffect(() => {
    if (reducedMotion) setShowOpeningCurtain(false);
  }, [reducedMotion]);

  useEffect(() => {
    if (previousOpenedRef.current === null) {
      previousOpenedRef.current = openedIds;
      return;
    }
    const previous = new Set(previousOpenedRef.current);
    const newlyOpened = openedIds.filter((id) => !previous.has(id));
    previousOpenedRef.current = openedIds;
    const nextOpening = newlyOpened.length > 0 ? newlyOpened[newlyOpened.length - 1] : null;
    if (nextOpening === null || phase === 'WAITING') return;
    setOpeningBoxId(nextOpening);
    onAnimationChange?.(nextOpening);
  }, [openedIds, phase, onAnimationChange]);

  const finishAnimation = (boxId: number) => {
    setOpeningBoxId((current) => current === boxId ? null : current);
    onAnimationChange?.(null);
  };

  const canSelect = (phase === 'SELECTING_PERSONAL' || phase === 'SELECTING') && allowedActions.includes('SELECT_BOX');
  const canOpen = phase === 'OPENING'
    && currentChooserSeatId !== null
    && currentChooserSeatId === mySeatId
    && allowedActions.includes('OPEN_BOX');
  const canInteract = openingBoxId === null && (canSelect || canOpen);

  if (phase === 'WAITING') return null;

  return (
    <div className="multiplayer-stage-shell" aria-label={translate('stage.multiplayerAria', language)}>
      {!reducedMotion && showOpeningCurtain && (
        <div className="opening-curtain multiplayer-opening-curtain" aria-hidden="true">
          <div className="opening-curtain-panel opening-curtain-left" />
          <div className="opening-curtain-panel opening-curtain-right" />
        </div>
      )}
      <Suspense fallback={<div style={{ minHeight: 240, display: 'grid', placeItems: 'center', color: '#94a3b8' }}>{translate('game.stageLoading', language)}</div>}>
        <Stage3D
          boxes={stageBoxes}
          playerBoxId={personalBoxId}
          phase={toGamePhase(phase)}
          onBoxClick={(boxId) => {
            if (!canInteract) return;
            if (canSelect) onSelectBox(boxId);
            else if (canOpen) onOpenBox(boxId);
          }}
          openingBoxId={openingBoxId}
          onBoxAnimationComplete={finishAnimation}
          fastMode={reducedMotion}
          effectiveQuality={lowQuality ? 'low' : 'standard'}
          effectiveReducedMotion={reducedMotion}
          canInteract={canInteract}
          playerBoxLabel={resolvedPlayerBoxLabel}
        />
      </Suspense>
    </div>
  );
};

export default MultiplayerStage3D;
