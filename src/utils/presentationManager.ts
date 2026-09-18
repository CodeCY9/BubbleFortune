import type {
  PublicSnapshot,
  PublicBox,
  PublicSettlement,
  PublicOfferHistoryEntry,
  GamePhase as ServerPhase,
} from '../../packages/protocol/src/types';
import type { BoxData, UIPhase } from '../types/game';

export interface PresentationState {
  gameId: string | null;
  epoch: number;
  phase: UIPhase;
  boxes: BoxData[];
  playerBoxId: number | null;
  currentRound: number;
  boxesLeftToOpenThisRound: number;
  bankerOffer: number;
  offerHistory: PublicOfferHistoryEntry[];
  settlement: PublicSettlement | null;
  openingBoxId: number | null;
  pendingRevealAmount: number | null;
  lastRevealedBox: { id: number; value: number } | null;
  eliminatedAmounts: Set<number>;
}

export function mapServerPhaseToUIPhase(serverPhase: ServerPhase): UIPhase {
  switch (serverPhase) {
    case 'SELECTING':
      return 'CHOOSE_PLAYER_BOX';
    case 'OPENING':
      return 'OPEN_BOXES';
    case 'OFFERING':
      return 'BANKER_OFFER';
    case 'FINAL_SWAP':
      return 'FINAL_SWAP';
    case 'FINISHED':
      return 'GAME_OVER';
    default:
      return 'MODE_SELECT';
  }
}

export function createInitialPresentationState(epoch = 0): PresentationState {
  const boxes: BoxData[] = Array.from({ length: 26 }, (_, i) => ({
    id: i + 1,
    isOpened: false as const,
    isPlayerBox: false,
  }));

  return {
    gameId: null,
    epoch,
    phase: 'MODE_SELECT',
    boxes,
    playerBoxId: null,
    currentRound: 1,
    boxesLeftToOpenThisRound: 6,
    bankerOffer: 0,
    offerHistory: [],
    settlement: null,
    openingBoxId: null,
    pendingRevealAmount: null,
    lastRevealedBox: null,
    eliminatedAmounts: new Set<number>(),
  };
}

export interface SnapshotApplyResult {
  state: PresentationState;
  shouldAnimateBoxId: number | null;
}

export function applySnapshotToPresentation(
  state: PresentationState,
  snapshot: PublicSnapshot,
  isInitialOrReconnect: boolean
): SnapshotApplyResult {
  const playerBoxId = snapshot.currentPlayerBoxId;

  // Initial join or reconnect: restore authoritative state immediately without animation
  if (isInitialOrReconnect) {
    const eliminated = new Set<number>();
    const boxes: BoxData[] = snapshot.boxes.map((b: PublicBox) => {
      const isPlayerBox = b.id === playerBoxId;
      if (b.status === 'opened') {
        eliminated.add(b.revealedAmount);
        return {
          id: b.id,
          isOpened: true as const,
          isPlayerBox,
          value: b.revealedAmount,
          revealedAmount: b.revealedAmount,
        };
      }
      return {
        id: b.id,
        isOpened: false as const,
        isPlayerBox,
      };
    });

    return {
      state: {
        ...state,
        gameId: snapshot.gameId,
        boxes,
        eliminatedAmounts: eliminated,
        playerBoxId,
        phase: mapServerPhaseToUIPhase(snapshot.phase),
        currentRound: snapshot.currentRound,
        boxesLeftToOpenThisRound: snapshot.boxesToOpenThisRound,
        bankerOffer: snapshot.currentOffer?.amount ?? 0,
        offerHistory: snapshot.offerHistory ? [...snapshot.offerHistory] : [],
        settlement: snapshot.settlement,
        openingBoxId: null,
        pendingRevealAmount: null,
      },
      shouldAnimateBoxId: null,
    };
  }

  // Find all boxes that are opened on the server but still unopened in presentation state
  const unpresentedBoxes = snapshot.boxes.filter(
    (b): b is Extract<PublicBox, { status: 'opened' }> => {
      if (b.status !== 'opened') return false;
      const currentBox = state.boxes.find((cb) => cb.id === b.id);
      return Boolean(currentBox && !currentBox.isOpened);
    }
  );

  // If a box is ALREADY opening, hold back phase / offer / offerHistory and do not interrupt current animation
  if (state.openingBoxId !== null) {
    return {
      state: {
        ...state,
        gameId: snapshot.gameId,
        playerBoxId,
      },
      shouldAnimateBoxId: null,
    };
  }

  // If there are unpresented server-opened boxes and no box is currently opening:
  // Queue the first one for presentation animation!
  if (unpresentedBoxes.length > 0) {
    const nextBox = unpresentedBoxes[0];
    return {
      state: {
        ...state,
        gameId: snapshot.gameId,
        playerBoxId,
        openingBoxId: nextBox.id,
        pendingRevealAmount: nextBox.revealedAmount,
      },
      shouldAnimateBoxId: nextBox.id,
    };
  }

  // No newly opened box animating, update non-opening properties normally
  const boxes: BoxData[] = state.boxes.map((b) => ({
    ...b,
    isPlayerBox: b.id === playerBoxId,
  }));

  return {
    state: {
      ...state,
      gameId: snapshot.gameId,
      boxes,
      playerBoxId,
      phase: mapServerPhaseToUIPhase(snapshot.phase),
      currentRound: snapshot.currentRound,
      boxesLeftToOpenThisRound: snapshot.boxesToOpenThisRound,
      bankerOffer: snapshot.currentOffer?.amount ?? 0,
      offerHistory: snapshot.offerHistory ? [...snapshot.offerHistory] : state.offerHistory,
      settlement: snapshot.settlement,
    },
    shouldAnimateBoxId: null,
  };
}

export function commitBoxOpenAnimation(
  state: PresentationState,
  boxId: number,
  callbackEpoch: number,
  authoritativeSnapshot: PublicSnapshot | null,
  callbackGameId?: string | null
): PresentationState {
  // Epoch check: if game was restarted / reset, drop callback from older epoch
  if (callbackEpoch !== state.epoch) {
    return state;
  }

  // Game ID check: if callback belongs to a different gameId, ignore stale callback
  if (callbackGameId && state.gameId && callbackGameId !== state.gameId) {
    return state;
  }

  // If openingBoxId does not match, ignore stale callback
  if (state.openingBoxId !== boxId) {
    return state;
  }

  const serverBox = authoritativeSnapshot?.boxes.find(
    (b): b is Extract<PublicBox, { status: 'opened' }> => b.id === boxId && b.status === 'opened'
  );
  const revealedAmount = state.pendingRevealAmount ?? serverBox?.revealedAmount;

  // Never substitute 0 for missing amounts
  if (revealedAmount === undefined) {
    return state;
  }

  const updatedBoxes: BoxData[] = state.boxes.map((b) => {
    if (b.id === boxId) {
      return {
        id: boxId,
        isOpened: true as const,
        isPlayerBox: b.id === state.playerBoxId,
        value: revealedAmount,
        revealedAmount,
      };
    }
    return b;
  });

  const nextEliminated = new Set(state.eliminatedAmounts);
  nextEliminated.add(revealedAmount);

  // Inspect authoritativeSnapshot for remaining unpresented opened boxes
  const remainingUnpresented =
    authoritativeSnapshot?.boxes.filter(
      (b): b is Extract<PublicBox, { status: 'opened' }> => {
        if (b.status !== 'opened') return false;
        const currentBox = updatedBoxes.find((cb) => cb.id === b.id);
        return Boolean(currentBox && !currentBox.isOpened);
      }
    ) ?? [];

  // If there are still more unpresented opened boxes, queue the next one!
  // Keep phase, bankerOffer, and boxesLeftToOpenThisRound held back.
  if (remainingUnpresented.length > 0) {
    const nextBox = remainingUnpresented[0];
    return {
      ...state,
      boxes: updatedBoxes,
      eliminatedAmounts: nextEliminated,
      openingBoxId: nextBox.id,
      pendingRevealAmount: nextBox.revealedAmount,
      lastRevealedBox: { id: boxId, value: revealedAmount },
    };
  }

  // All unpresented boxes are committed: now catch up presentation phase, offer, offerHistory, and round targets!
  const nextPhase = authoritativeSnapshot
    ? mapServerPhaseToUIPhase(authoritativeSnapshot.phase)
    : state.phase;
  const nextOffer = authoritativeSnapshot?.currentOffer?.amount ?? state.bankerOffer;
  const nextOfferHistory = authoritativeSnapshot?.offerHistory
    ? [...authoritativeSnapshot.offerHistory]
    : state.offerHistory;
  const nextRound = authoritativeSnapshot?.currentRound ?? state.currentRound;
  const nextBoxesLeft =
    authoritativeSnapshot?.boxesToOpenThisRound ??
    Math.max(0, state.boxesLeftToOpenThisRound - 1);
  const nextSettlement = authoritativeSnapshot?.settlement ?? state.settlement;

  return {
    ...state,
    boxes: updatedBoxes,
    eliminatedAmounts: nextEliminated,
    openingBoxId: null,
    pendingRevealAmount: null,
    lastRevealedBox: { id: boxId, value: revealedAmount },
    phase: nextPhase,
    bankerOffer: nextOffer,
    offerHistory: nextOfferHistory,
    currentRound: nextRound,
    boxesLeftToOpenThisRound: nextBoxesLeft,
    settlement: nextSettlement,
  };
}
