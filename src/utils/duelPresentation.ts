import type {
  DuelPhase,
  DuelPublicSnapshot,
  DuelOfferHistoryEntry,
  DuelRoundResult,
  DuelResult,
  DuelSeatInfo,
} from '../../packages/protocol/src/duel';
import type { PublicOffer, PublicBox } from '../../packages/protocol/src/types';
import type { BoxData, GamePhase } from '../types/game';

export interface DuelPresentationState {
  matchId: string | null;
  roundIndex: number;
  epoch: number;
  phase: DuelPhase;
  boxes: BoxData[];
  playerBoxId: number | null;
  boxRound: number;
  boxesLeftToOpenThisRound: number;
  currentOffer: PublicOffer | null;
  offerHistory: DuelOfferHistoryEntry[];
  roundResults: DuelRoundResult[];
  result: DuelResult | null;
  seats: [DuelSeatInfo, DuelSeatInfo] | null;
  openingBoxId: number | null;
  pendingRevealAmount: number | null;
  lastRevealedBox: { id: number; value: number } | null;
  eliminatedAmounts: Set<number>;
  presentedOpenedBoxIds: number[];
}

export function mapDuelPhaseToUIPhase(phase: DuelPhase): GamePhase {
  switch (phase) {
    case 'SELECTING':
      return 'CHOOSE_PLAYER_BOX';
    case 'OPENING':
      return 'OPEN_BOXES';
    case 'SUBMITTING_OFFER':
    case 'OFFERING':
      return 'BANKER_OFFER';
    case 'FINAL_SWAP':
      return 'FINAL_SWAP';
    case 'ROUND_COMPLETE':
    case 'FINISHED':
      return 'GAME_OVER';
    case 'WAITING':
    default:
      return 'MODE_SELECT';
  }
}

export function createInitialDuelPresentationState(epoch = 0): DuelPresentationState {
  const boxes: BoxData[] = Array.from({ length: 26 }, (_, i) => ({
    id: i + 1,
    isOpened: false,
    isPlayerBox: false,
  }));

  return {
    matchId: null,
    roundIndex: 0,
    epoch,
    phase: 'WAITING',
    boxes,
    playerBoxId: null,
    boxRound: 1,
    boxesLeftToOpenThisRound: 6,
    currentOffer: null,
    offerHistory: [],
    roundResults: [],
    result: null,
    seats: null,
    openingBoxId: null,
    pendingRevealAmount: null,
    lastRevealedBox: null,
    eliminatedAmounts: new Set<number>(),
    presentedOpenedBoxIds: [],
  };
}

export interface DuelSnapshotApplyResult {
  state: DuelPresentationState;
  shouldAnimateBoxId: number | null;
}

export function applySnapshotToDuelPresentation(
  state: DuelPresentationState,
  snapshot: DuelPublicSnapshot,
  isInitialOrReconnect: boolean
): DuelSnapshotApplyResult {
  const isDifferentMatchOrRound =
    state.matchId !== snapshot.matchId || state.roundIndex !== snapshot.roundIndex;

  // Initial connect, reconnect, or new round: restore authoritative state immediately without replaying old opened boxes
  if (isInitialOrReconnect || isDifferentMatchOrRound) {
    const eliminated = new Set<number>();
    const presentedOpened: number[] = [];

    const boxes: BoxData[] = Array.from({ length: 26 }, (_, i) => {
      const boxId = i + 1;
      const isPlayerBox = boxId === snapshot.playerBoxId;
      const serverBox = snapshot.boxes.find((b) => b.id === boxId);
      if (serverBox && serverBox.status === 'opened') {
        eliminated.add(serverBox.revealedAmount);
        presentedOpened.push(boxId);
        return {
          id: boxId,
          isOpened: true,
          isPlayerBox,
          value: serverBox.revealedAmount,
          revealedAmount: serverBox.revealedAmount,
        };
      }
      return {
        id: boxId,
        isOpened: false,
        isPlayerBox,
      };
    });

    const copiedSeats: [DuelSeatInfo, DuelSeatInfo] = [
      { ...snapshot.seats[0] },
      { ...snapshot.seats[1] },
    ];

    return {
      state: {
        ...state,
        matchId: snapshot.matchId,
        roundIndex: snapshot.roundIndex,
        epoch: isDifferentMatchOrRound ? state.epoch + 1 : state.epoch,
        phase: snapshot.phase,
        boxes,
        playerBoxId: snapshot.playerBoxId,
        boxRound: snapshot.boxRound,
        boxesLeftToOpenThisRound: snapshot.boxesLeftToOpenThisRound,
        currentOffer: snapshot.currentOffer ? { ...snapshot.currentOffer } : null,
        offerHistory: [...snapshot.offerHistory],
        roundResults: [...snapshot.roundResults],
        result: snapshot.result ? { ...snapshot.result } : null,
        seats: copiedSeats,
        openingBoxId: null,
        pendingRevealAmount: null,
        lastRevealedBox: null,
        eliminatedAmounts: eliminated,
        presentedOpenedBoxIds: snapshot.openedBoxIds ? [...snapshot.openedBoxIds] : presentedOpened,
      },
      shouldAnimateBoxId: null,
    };
  }

  // Same match and round: identify newly opened boxes by snapshot.openedBoxIds sequence
  const unpresentedBoxIds = (snapshot.openedBoxIds || []).filter(
    (id) => !state.presentedOpenedBoxIds.includes(id) && id !== state.openingBoxId
  );

  // If a box animation is currently running, hold back new phase / offer / results / seats until animation finishes
  if (state.openingBoxId !== null) {
    return {
      state: {
        ...state,
        matchId: snapshot.matchId,
        playerBoxId: snapshot.playerBoxId,
      },
      shouldAnimateBoxId: null,
    };
  }

  // If there is an unpresented opened box and none currently animating: queue the first one in real order!
  if (unpresentedBoxIds.length > 0) {
    const nextBoxId = unpresentedBoxIds[0];
    const serverBox = snapshot.boxes.find((b) => b.id === nextBoxId);
    const revealedAmount =
      serverBox && serverBox.status === 'opened' ? serverBox.revealedAmount : null;

    return {
      state: {
        ...state,
        matchId: snapshot.matchId,
        playerBoxId: snapshot.playerBoxId,
        openingBoxId: nextBoxId,
        pendingRevealAmount: revealedAmount,
      },
      shouldAnimateBoxId: nextBoxId,
    };
  }

  // Animation queue is empty: sync all phase, offer, results, seats, boxes left, round target!
  const updatedBoxes: BoxData[] = state.boxes.map((b) => ({
    ...b,
    isPlayerBox: b.id === snapshot.playerBoxId,
  }));

  const copiedSeats: [DuelSeatInfo, DuelSeatInfo] = [
    { ...snapshot.seats[0] },
    { ...snapshot.seats[1] },
  ];

  return {
    state: {
      ...state,
      matchId: snapshot.matchId,
      roundIndex: snapshot.roundIndex,
      boxes: updatedBoxes,
      playerBoxId: snapshot.playerBoxId,
      phase: snapshot.phase,
      boxRound: snapshot.boxRound,
      boxesLeftToOpenThisRound: snapshot.boxesLeftToOpenThisRound,
      currentOffer: snapshot.currentOffer ? { ...snapshot.currentOffer } : null,
      offerHistory: [...snapshot.offerHistory],
      roundResults: [...snapshot.roundResults],
      result: snapshot.result ? { ...snapshot.result } : null,
      seats: copiedSeats,
      openingBoxId: null,
      pendingRevealAmount: null,
    },
    shouldAnimateBoxId: null,
  };
}

export function commitDuelBoxOpenAnimation(
  state: DuelPresentationState,
  boxId: number,
  callbackEpoch: number,
  callbackRoundIndex: number,
  callbackMatchId: string | null,
  authoritativeSnapshot: DuelPublicSnapshot | null
): DuelPresentationState {
  // Epoch / match / round check: drop callbacks from previous or expired rounds
  if (
    callbackEpoch !== state.epoch ||
    (callbackMatchId && state.matchId && callbackMatchId !== state.matchId) ||
    callbackRoundIndex !== state.roundIndex
  ) {
    return state;
  }

  // Authoritative snapshot must match state's matchId and roundIndex
  if (
    authoritativeSnapshot &&
    (authoritativeSnapshot.matchId !== state.matchId ||
      authoritativeSnapshot.roundIndex !== state.roundIndex)
  ) {
    return state;
  }

  // If not currently opening this boxId, ignore stale callback
  if (state.openingBoxId !== boxId) {
    return state;
  }

  const serverBox = authoritativeSnapshot?.boxes.find(
    (b): b is Extract<PublicBox, { status: 'opened' }> => b.id === boxId && b.status === 'opened'
  );
  const revealedAmount = state.pendingRevealAmount ?? serverBox?.revealedAmount;

  if (revealedAmount === undefined || revealedAmount === null) {
    return state;
  }

  const updatedBoxes: BoxData[] = state.boxes.map((b) => {
    if (b.id === boxId) {
      return {
        id: boxId,
        isOpened: true,
        isPlayerBox: b.id === state.playerBoxId,
        value: revealedAmount,
        revealedAmount,
      };
    }
    return b;
  });

  const nextEliminated = new Set(state.eliminatedAmounts);
  nextEliminated.add(revealedAmount);

  const nextPresentedOpened = [...state.presentedOpenedBoxIds];
  if (!nextPresentedOpened.includes(boxId)) {
    nextPresentedOpened.push(boxId);
  }

  // Check authoritative snapshot for remaining unpresented opened boxes
  const remainingUnpresented = (authoritativeSnapshot?.openedBoxIds || []).filter(
    (id) => !nextPresentedOpened.includes(id)
  );

  // If there are still more unpresented opened boxes, queue the next one!
  // Hold back phase, offer, roundResults, seats until all animations complete.
  if (remainingUnpresented.length > 0) {
    const nextBoxId = remainingUnpresented[0];
    const nextServerBox = authoritativeSnapshot?.boxes.find((b) => b.id === nextBoxId);
    const nextAmount =
      nextServerBox && nextServerBox.status === 'opened' ? nextServerBox.revealedAmount : null;

    return {
      ...state,
      boxes: updatedBoxes,
      eliminatedAmounts: nextEliminated,
      presentedOpenedBoxIds: nextPresentedOpened,
      openingBoxId: nextBoxId,
      pendingRevealAmount: nextAmount,
      lastRevealedBox: { id: boxId, value: revealedAmount },
    };
  }

  // Queue is now completely empty: catch up presentation to authoritative snapshot!
  const nextPhase = authoritativeSnapshot ? authoritativeSnapshot.phase : state.phase;
  const nextOffer = authoritativeSnapshot?.currentOffer
    ? { ...authoritativeSnapshot.currentOffer }
    : state.currentOffer;
  const nextOfferHistory = authoritativeSnapshot
    ? [...authoritativeSnapshot.offerHistory]
    : state.offerHistory;
  const nextRoundResults = authoritativeSnapshot
    ? [...authoritativeSnapshot.roundResults]
    : state.roundResults;
  const nextResult = authoritativeSnapshot?.result
    ? { ...authoritativeSnapshot.result }
    : state.result;
  const nextSeats: [DuelSeatInfo, DuelSeatInfo] | null = authoritativeSnapshot
    ? [{ ...authoritativeSnapshot.seats[0] }, { ...authoritativeSnapshot.seats[1] }]
    : state.seats;
  const nextBoxesLeft = authoritativeSnapshot
    ? authoritativeSnapshot.boxesLeftToOpenThisRound
    : state.boxesLeftToOpenThisRound;
  const nextBoxRound = authoritativeSnapshot
    ? authoritativeSnapshot.boxRound
    : state.boxRound;

  return {
    ...state,
    boxes: updatedBoxes,
    eliminatedAmounts: nextEliminated,
    presentedOpenedBoxIds: nextPresentedOpened,
    openingBoxId: null,
    pendingRevealAmount: null,
    lastRevealedBox: { id: boxId, value: revealedAmount },
    phase: nextPhase,
    currentOffer: nextOffer,
    offerHistory: nextOfferHistory,
    roundResults: nextRoundResults,
    result: nextResult,
    seats: nextSeats,
    boxesLeftToOpenThisRound: nextBoxesLeft,
    boxRound: nextBoxRound,
  };
}
