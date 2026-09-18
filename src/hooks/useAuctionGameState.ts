import { useState, useCallback, useEffect, useRef } from 'react';
import { Client, Room } from 'colyseus.js';
import type {
  AuctionClientSnapshot,
  AuctionPublicSnapshot,
  AuctionPrivateView,
  AuctionCommandResult,
  AuctionActionType,
  AuctionRole,
  AuctionPhase,
  AuctionSeatInfo,
  AuctionCurrentOffer,
  AuctionRoundResult,
  AuctionResult,
  AuctionCommand,
  AuctionRoomConfig,
} from '../../packages/protocol/src/auction';
import type { BoxData, GamePhase } from '../types/game';
import { ensureAuctionGuestSession } from '../api/auction';
import { soundManager } from '../utils/audio';
import { translateServerError } from '../utils/serverErrorMessage';

const AUCTION_SESSION_STORAGE_KEY = 'bf_auction_session';

export interface StoredAuctionSession {
  roomId: string;
  matchId: string;
  token: string;
  isSpectator: boolean;
}

export type AuctionConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'failed';

export interface PendingAuctionCommand {
  matchId: string | null;
  roundIndex: number;
  cmd: {
    type: AuctionActionType;
    stateVersion: number;
    commandSequence: number;
    idempotencyKey: string;
    [key: string]: unknown;
  };
  sentAt: number;
  retransmitted: boolean;
}

export interface AuctionPresentationState {
  matchId: string | null;
  roundIndex: number;
  epoch: number;
  phase: AuctionPhase;
  boxes: BoxData[];
  playerBoxId: number | null;
  boxRound: number;
  boxesLeftToOpenThisRound: number;
  currentOffer: AuctionCurrentOffer | null;
  roundResults: AuctionRoundResult[];
  result: AuctionResult | null;
  seats: AuctionSeatInfo[];
  openingBoxId: number | null;
  pendingRevealAmount: number | null;
  eliminatedAmounts: Set<number>;
  presentedOpenedBoxIds: number[];
  bidsSubmittedSeats: number[];
}

export function mapAuctionPhaseToUIPhase(phase: AuctionPhase): GamePhase {
  switch (phase) {
    case 'SELECTING':
      return 'CHOOSE_PLAYER_BOX';
    case 'OPENING':
      return 'OPEN_BOXES';
    case 'BIDDING':
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

export function createInitialAuctionPresentationState(epoch = 0): AuctionPresentationState {
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
    roundResults: [],
    result: null,
    seats: [],
    openingBoxId: null,
    pendingRevealAmount: null,
    eliminatedAmounts: new Set<number>(),
    presentedOpenedBoxIds: [],
    bidsSubmittedSeats: [],
  };
}

export function mapAuctionErrorCodeToMessage(code?: string): string {
  if (code === 'AUTHENTICATION_REQUIRED') return translateServerError('UNAUTHORIZED');
  if (code === 'BID_OUT_OF_RANGE') return translateServerError('OFFER_OUT_OF_RANGE');
  if (code === 'ALREADY_BID') return translateServerError('INVALID_PHASE');
  if (code === 'SPECTATORS_NOT_ALLOWED') return translateServerError('UNAUTHORIZED');
  return translateServerError(code);
}

function getWsEndpoint(): string {
  if (typeof window === 'undefined') return 'ws://127.0.0.1:2567/game';
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/game`;
}

export interface UseAuctionGameStateOptions {
  soundEnabled?: boolean;
  fastMode?: boolean;
}

export function useAuctionGameState(options?: UseAuctionGameStateOptions) {
  const soundEnabled = options?.soundEnabled ?? false;
  const fastMode = options?.fastMode ?? false;

  useEffect(() => {
    soundManager.setSoundEnabled(soundEnabled);
  }, [soundEnabled]);

  const [presentation, setPresentation] = useState<AuctionPresentationState>(() =>
    createInitialAuctionPresentationState(0)
  );
  const [authoritySnapshot, setAuthoritySnapshot] = useState<AuctionClientSnapshot | null>(null);
  const [connectionStatus, setConnectionStatus] =
    useState<AuctionConnectionStatus>('disconnected');
  const [isPending, setIsPending] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const [deadlineTimestamp, setDeadlineTimestamp] = useState<number | null>(null);
  const [serverNow, setServerNow] = useState<number>(Date.now());
  const [serverTimeOffset, setServerTimeOffset] = useState<number>(0);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);

  // Stored session detection in sessionStorage
  const [storedSession, setStoredSession] = useState<StoredAuctionSession | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const raw = sessionStorage.getItem(AUCTION_SESSION_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.roomId === 'string' && typeof parsed.token === 'string') {
        return parsed as StoredAuctionSession;
      }
    } catch {
      // ignore
    }
    return null;
  });

  const storedSessionRef = useRef<StoredAuctionSession | null>(storedSession);
  storedSessionRef.current = storedSession;

  // Lifecycle & Connection refs
  const clientRef = useRef<Client>(new Client(getWsEndpoint()));
  const roomRef = useRef<Room | null>(null);
  const epochRef = useRef<number>(0);
  const isConnectingRef = useRef<boolean>(false);

  const presentationRef = useRef<AuctionPresentationState>(presentation);
  presentationRef.current = presentation;

  const authorityRef = useRef<AuctionClientSnapshot | null>(authoritySnapshot);
  authorityRef.current = authoritySnapshot;

  const pendingCommandRef = useRef<PendingAuctionCommand | null>(null);
  const pendingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const leaveResolverRef = useRef<((value: boolean) => void) | null>(null);
  const leaveIdempotencyKeyRef = useRef<string | null>(null);

  const clearPendingTimeout = () => {
    if (pendingTimeoutRef.current) {
      clearTimeout(pendingTimeoutRef.current);
      pendingTimeoutRef.current = null;
    }
  };

  const clearPendingLock = () => {
    clearPendingTimeout();
    pendingCommandRef.current = null;
    setIsPending(false);
  };

  const cleanUpOldRoom = useCallback(() => {
    if (roomRef.current) {
      try {
        roomRef.current.removeAllListeners();
        roomRef.current.leave(false);
      } catch {
        // ignore
      }
      roomRef.current = null;
    }
  }, []);

  const saveStoredSession = (session: StoredAuctionSession) => {
    try {
      sessionStorage.setItem(AUCTION_SESSION_STORAGE_KEY, JSON.stringify(session));
      setStoredSession(session);
      storedSessionRef.current = session;
    } catch {
      // ignore
    }
  };

  const clearStoredSession = () => {
    try {
      sessionStorage.removeItem(AUCTION_SESSION_STORAGE_KEY);
      setStoredSession(null);
      storedSessionRef.current = null;
    } catch {
      // ignore
    }
  };

  // Synchronize presentation state with authoritative snapshot
  const applySnapshotToPresentation = (
    state: AuctionPresentationState,
    snapshot: AuctionPublicSnapshot,
    isInitialOrReconnect: boolean
  ): { state: AuctionPresentationState; shouldAnimateBoxId: number | null } => {
    const isDifferentMatchOrRound =
      state.matchId !== snapshot.matchId || state.roundIndex !== snapshot.roundIndex;

    // Initial connect, reconnect, or round transition: restore authoritative state immediately without replaying old boxes
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
          roundResults: [...snapshot.roundResults],
          result: snapshot.result ? { ...snapshot.result } : null,
          seats: [...snapshot.seats],
          openingBoxId: null,
          pendingRevealAmount: null,
          eliminatedAmounts: eliminated,
          presentedOpenedBoxIds: snapshot.openedBoxIds ? [...snapshot.openedBoxIds] : presentedOpened,
          bidsSubmittedSeats: [...snapshot.bidsSubmittedSeats],
        },
        shouldAnimateBoxId: null,
      };
    }

    // Identify newly opened boxes
    const unpresentedBoxIds = (snapshot.openedBoxIds || []).filter(
      (id) => !state.presentedOpenedBoxIds.includes(id) && id !== state.openingBoxId
    );

    // If an animation is currently active, hold back phase / offer / score updates!
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

    // If there is an unpresented box and none animating, start animating the next one
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

    // No animation pending: catch up presentation to latest snapshot values
    const updatedBoxes: BoxData[] = state.boxes.map((b) => ({
      ...b,
      isPlayerBox: b.id === snapshot.playerBoxId,
    }));

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
        roundResults: [...snapshot.roundResults],
        result: snapshot.result ? { ...snapshot.result } : null,
        seats: [...snapshot.seats],
        bidsSubmittedSeats: [...snapshot.bidsSubmittedSeats],
        openingBoxId: null,
        pendingRevealAmount: null,
      },
      shouldAnimateBoxId: null,
    };
  };

  // Commit box open animation callback
  const handleBoxAnimationComplete = useCallback(
    (boxId: number) => {
      const state = presentationRef.current;
      const authoritative = authorityRef.current;

      // Ensure this animation matches current opening box
      if (state.openingBoxId !== boxId) return;

      const serverBox = authoritative?.public.boxes.find((b) => b.id === boxId);
      const revealedAmount =
        serverBox && serverBox.status === 'opened'
          ? serverBox.revealedAmount
          : state.pendingRevealAmount ?? 0;

      const nextEliminated = new Set(state.eliminatedAmounts);
      if (revealedAmount > 0) {
        nextEliminated.add(revealedAmount);
      }

      const nextPresented = [...state.presentedOpenedBoxIds, boxId];

      const nextBoxes = state.boxes.map((b) => {
        if (b.id === boxId) {
          return {
            ...b,
            isOpened: true as const,
            value: revealedAmount,
            revealedAmount,
          };
        }
        return b;
      });

      // Check if there are further unopened boxes in authoritative snapshot
      const remainingUnpresented = (authoritative?.public.openedBoxIds || []).filter(
        (id) => !nextPresented.includes(id)
      );

      if (remainingUnpresented.length > 0) {
        const nextId = remainingUnpresented[0];
        const nextServerBox = authoritative?.public.boxes.find((b) => b.id === nextId);
        const nextAmt =
          nextServerBox && nextServerBox.status === 'opened'
            ? nextServerBox.revealedAmount
            : null;

        const nextPres: AuctionPresentationState = {
          ...state,
          boxes: nextBoxes,
          eliminatedAmounts: nextEliminated,
          presentedOpenedBoxIds: nextPresented,
          openingBoxId: nextId,
          pendingRevealAmount: nextAmt,
        };
        presentationRef.current = nextPres;
        setPresentation(nextPres);
      } else {
        // Queue is finished: update all held back fields (phase, offer, scores, etc.)
        const nextPres: AuctionPresentationState = {
          ...state,
          boxes: nextBoxes,
          eliminatedAmounts: nextEliminated,
          presentedOpenedBoxIds: nextPresented,
          openingBoxId: null,
          pendingRevealAmount: null,
          phase: authoritative ? authoritative.public.phase : state.phase,
          boxRound: authoritative ? authoritative.public.boxRound : state.boxRound,
          boxesLeftToOpenThisRound: authoritative
            ? authoritative.public.boxesLeftToOpenThisRound
            : state.boxesLeftToOpenThisRound,
          currentOffer: authoritative?.public.currentOffer
            ? { ...authoritative.public.currentOffer }
            : null,
          roundResults: authoritative ? [...authoritative.public.roundResults] : state.roundResults,
          result: authoritative?.public.result ? { ...authoritative.public.result } : state.result,
          seats: authoritative ? [...authoritative.public.seats] : state.seats,
          bidsSubmittedSeats: authoritative
            ? [...authoritative.public.bidsSubmittedSeats]
            : state.bidsSubmittedSeats,
        };
        presentationRef.current = nextPres;
        setPresentation(nextPres);
      }
    },
    []
  );

  // Apply snapshot updates strictly
  const handleIncomingSnapshot = useCallback(
    (snapshot: AuctionClientSnapshot, isInitial: boolean) => {
      const currentAuth = authorityRef.current;

      // Drop stale snapshots:
      // 1) Same match: drop if roundIndex is smaller, or stateVersion is smaller in same round
      // 2) Drop late-arriving packet from another match
      // 3) WAITING: drop if stateVersion is smaller
      if (!isInitial && currentAuth) {
        if (currentAuth.public.matchId && snapshot.public.matchId === currentAuth.public.matchId) {
          if (snapshot.public.roundIndex < currentAuth.public.roundIndex) {
            return;
          }
          if (
            snapshot.public.roundIndex === currentAuth.public.roundIndex &&
            snapshot.public.stateVersion < currentAuth.public.stateVersion
          ) {
            return;
          }
        } else if (currentAuth.public.matchId && snapshot.public.matchId !== currentAuth.public.matchId) {
          return;
        } else if (!currentAuth.public.matchId && !snapshot.public.matchId) {
          if (snapshot.public.stateVersion < currentAuth.public.stateVersion) {
            return;
          }
        } else if (currentAuth.public.matchId && !snapshot.public.matchId) {
          return;
        }
      }

      setAuthoritySnapshot(snapshot);
      authorityRef.current = snapshot;

      // Update server time offset
      if (typeof snapshot.public.serverNow === 'number') {
        const offset = snapshot.public.serverNow - Date.now();
        setServerTimeOffset(offset);
        setServerNow(snapshot.public.serverNow);
      }
      setDeadlineTimestamp(snapshot.public.deadlineTimestamp ?? null);

      // Check if pending command has been acknowledged
      const pending = pendingCommandRef.current;
      if (pending) {
        const matchesMatch = !pending.matchId || snapshot.public.matchId === pending.matchId;
        const matchesRound = snapshot.public.roundIndex === pending.roundIndex;
        const isAdvancedRound =
          Boolean(pending.matchId) &&
          snapshot.public.matchId === pending.matchId &&
          snapshot.public.roundIndex > pending.roundIndex;

        if (matchesMatch) {
          if (isAdvancedRound) {
            clearPendingLock();
          } else if (
            matchesRound &&
            snapshot.private.lastCommandSequence >= pending.cmd.commandSequence
          ) {
            clearPendingLock();
          }
        }
      }

      // Initial snapshot after reconnect did not consume pending command: retransmit original command once
      if (isInitial && pendingCommandRef.current && roomRef.current) {
        const stillPending = pendingCommandRef.current;
        if (!stillPending.retransmitted) {
          stillPending.retransmitted = true;
          try {
            roomRef.current.send('command', stillPending.cmd);
          } catch {
            // ignore
          }
        }
      }

      // Session storage lifecycle
      if (snapshot.public.phase === 'FINISHED') {
        clearStoredSession();
      } else if (roomRef.current && roomRef.current.reconnectionToken) {
        saveStoredSession({
          roomId: roomRef.current.roomId,
          matchId: snapshot.public.matchId,
          token: roomRef.current.reconnectionToken,
          isSpectator: snapshot.private.isSpectator,
        });
      }

      // Update presentation
      const { state: nextPres } = applySnapshotToPresentation(
        presentationRef.current,
        snapshot.public,
        isInitial
      );
      presentationRef.current = nextPres;
      setPresentation(nextPres);
    },
    []
  );

  // Setup room message listeners
  const attachRoomListeners = useCallback(
    (room: Room, currentEpoch: number) => {
      let hasReceivedInitialSnapshot = false;

      room.onMessage('snapshot', (snapshot: AuctionClientSnapshot) => {
        if (currentEpoch !== epochRef.current) return;
        const isFirst = !hasReceivedInitialSnapshot;
        hasReceivedInitialSnapshot = true;
        const pendingAtReceive = pendingCommandRef.current;
        handleIncomingSnapshot(snapshot, isFirst);

        if (
          leaveResolverRef.current &&
          leaveIdempotencyKeyRef.current &&
          pendingAtReceive?.cmd.type === 'LEAVE' &&
          snapshot.public.phase === 'FINISHED' &&
          snapshot.private.lastCommandSequence >= pendingAtReceive.cmd.commandSequence
        ) {
          leaveResolverRef.current(true);
        }
      });

      room.onMessage('command_result', (result: AuctionCommandResult) => {
        if (currentEpoch !== epochRef.current) return;

        const pending = pendingCommandRef.current;
        if (pending && result.idempotencyKey === pending.cmd.idempotencyKey) {
          clearPendingLock();
        }

        if (leaveResolverRef.current && leaveIdempotencyKeyRef.current) {
          if (result.idempotencyKey === leaveIdempotencyKeyRef.current) {
            leaveResolverRef.current(result.success);
          }
        }

        if (!result.success && result.error) {
          setError(mapAuctionErrorCodeToMessage(result.error.code) || result.error.message);
        }

        if (result.snapshot) {
          handleIncomingSnapshot(result.snapshot, false);
        }
      });

      room.onMessage('error', (err: { code?: string; message?: string }) => {
        if (currentEpoch !== epochRef.current) return;
        setError(mapAuctionErrorCodeToMessage(err.code) || err.message || '房间异常');
      });

      room.onMessage('pong', (payload: { sentAt?: number; serverAt?: number }) => {
        if (currentEpoch !== epochRef.current || typeof payload?.sentAt !== 'number') return;
        setLatencyMs(Math.max(0, Date.now() - payload.sentAt));
        if (typeof payload.serverAt === 'number') {
          setServerTimeOffset(payload.serverAt - Date.now());
        }
      });

      room.onLeave((code) => {
        if (currentEpoch !== epochRef.current) return;
        setLatencyMs(null);
        setConnectionStatus('disconnected');
        if (leaveResolverRef.current) {
          leaveResolverRef.current(true);
          leaveResolverRef.current = null;
        }
      });

      room.onError((code, message) => {
        if (currentEpoch !== epochRef.current) return;
        setError(`网络连接错误: ${message || code}`);
      });
    },
    [handleIncomingSnapshot]
  );

  useEffect(() => {
    if (connectionStatus !== 'connected' || !roomRef.current) return;
    const room = roomRef.current;
    const sendPing = () => {
      try {
        room.send('ping', { sentAt: Date.now() });
      } catch {
        // The connection may close between interval ticks.
      }
    };
    sendPing();
    const timer = window.setInterval(sendPing, 5000);
    return () => window.clearInterval(timer);
  }, [connectionStatus]);

  // Request authoritative snapshot
  const requestSnapshot = useCallback(() => {
    if (roomRef.current) {
      try {
        roomRef.current.send('request_snapshot', {});
      } catch {
        // ignore
      }
    }
  }, []);

  // Send raw command
  const sendCommand = useCallback(
    async (
      payload: Partial<AuctionCommand> & { type: AuctionActionType }
    ): Promise<AuctionCommandResult | null> => {
      const room = roomRef.current;
      const authority = authorityRef.current;
      if (!room || connectionStatus !== 'connected') {
        setError('未连接至游戏服务器');
        return null;
      }

      if (isPending) {
        return null;
      }

      clearPendingTimeout();

      const lastSeq = authority?.private.lastCommandSequence ?? 0;
      const nextSeq = lastSeq + 1;
      const idempotencyKey = `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

      const stateVersion = authority?.public.stateVersion ?? 1;
      const matchId = authority?.public.matchId || undefined;
      const roomId = room.roomId;

      const fullCommand = {
        ...payload,
        stateVersion,
        commandSequence: nextSeq,
        idempotencyKey,
        matchId,
        roomId,
      };

      pendingCommandRef.current = {
        cmd: fullCommand as any,
        sentAt: Date.now(),
        retransmitted: false,
        roundIndex: authority?.public.roundIndex ?? 0,
        matchId: authority?.public.matchId ?? null,
      };

      if (payload.type === 'LEAVE') {
        leaveIdempotencyKeyRef.current = idempotencyKey;
      }

      setIsPending(true);

      // Pending timeout safety fallback (8 seconds)
      pendingTimeoutRef.current = setTimeout(() => {
        clearPendingLock();
      }, 8000);

      try {
        room.send('command', fullCommand);
      } catch (err: any) {
        clearPendingLock();
        setError('发送指令失败，请检查网络');
        return null;
      }

      return null;
    },
    [connectionStatus, isPending]
  );

  // Create room
  const createRoom = useCallback(
    async (
      nickname: string,
      isSpectator = false,
      roomConfig?: AuctionRoomConfig
    ): Promise<boolean> => {
      if (isConnectingRef.current) return false;
      cleanUpOldRoom();
      isConnectingRef.current = true;
      setConnectionStatus('connecting');
      setError(null);

      const currentEpoch = ++epochRef.current;

      try {
        if (!isSpectator) {
          await ensureAuctionGuestSession();
        }
        if (currentEpoch !== epochRef.current) {
          isConnectingRef.current = false;
          return false;
        }

        const trimmedNickname = Array.from(nickname.trim()).slice(0, 16).join('');
        const client = clientRef.current;
        const room = await client.create<unknown>('auction_26', {
          nickname: trimmedNickname,
          isSpectator,
          isPrivate: roomConfig?.isPrivate ?? false,
          ranked: roomConfig?.ranked ?? true,
          allowSpectators: roomConfig?.allowSpectators ?? true,
          allowEmotes: roomConfig?.allowEmotes ?? true,
          showBidHistory: roomConfig?.showBidHistory ?? true,
          themeId: roomConfig?.themeId,
          password: roomConfig?.password,
        });

        if (currentEpoch !== epochRef.current) {
          isConnectingRef.current = false;
          room.leave(false);
          return false;
        }

        roomRef.current = room;
        setConnectionStatus('connected');
        isConnectingRef.current = false;

        saveStoredSession({
          roomId: room.roomId,
          matchId: '',
          token: room.reconnectionToken,
          isSpectator,
        });

        attachRoomListeners(room, currentEpoch);
        room.send('request_snapshot', {});
        return true;
      } catch (err: any) {
        isConnectingRef.current = false;
        if (currentEpoch !== epochRef.current) return false;
        setConnectionStatus('failed');
        const errMsg = err?.message?.includes('Spectators are not allowed')
          ? '该房间不允许观战'
          : err?.message?.includes('Private auction rooms require')
            ? '私密房密码至少需要 4 个字符'
            : err?.message || '创建竞拍房间失败，请稍后重试';
        setError(errMsg);
        return false;
      }
    },
    [attachRoomListeners, cleanUpOldRoom]
  );

  // Join room by ID
  const joinRoom = useCallback(
    async (roomId: string, nickname: string, isSpectator = false, password?: string): Promise<boolean> => {
      if (!roomId || isConnectingRef.current) return false;
      cleanUpOldRoom();
      isConnectingRef.current = true;
      setConnectionStatus('connecting');
      setError(null);

      const currentEpoch = ++epochRef.current;

      try {
        if (!isSpectator) {
          await ensureAuctionGuestSession();
        }
        if (currentEpoch !== epochRef.current) {
          isConnectingRef.current = false;
          return false;
        }

        const cleanRoomId = roomId.trim();
        const trimmedNickname = Array.from(nickname.trim()).slice(0, 16).join('');
        const client = clientRef.current;
        const room = await client.joinById<unknown>(cleanRoomId, {
          nickname: trimmedNickname,
          isSpectator,
          password,
        });

        if (currentEpoch !== epochRef.current) {
          isConnectingRef.current = false;
          room.leave(false);
          return false;
        }

        roomRef.current = room;
        setConnectionStatus('connected');
        isConnectingRef.current = false;

        saveStoredSession({
          roomId: room.roomId,
          matchId: '',
          token: room.reconnectionToken,
          isSpectator,
        });

        attachRoomListeners(room, currentEpoch);
        room.send('request_snapshot', {});
        return true;
      } catch (err: any) {
        isConnectingRef.current = false;
        if (currentEpoch !== epochRef.current) return false;
        setConnectionStatus('failed');
        const errMsg = err?.message?.includes('Spectators are not allowed')
          ? '该房间不允许观战'
          : err?.message?.includes('Invalid room password')
            ? '房间密码不正确'
          : err?.message || '加入竞拍房间失败，请核对房间码或网络';
        setError(errMsg);
        return false;
      }
    },
    [attachRoomListeners, cleanUpOldRoom]
  );

  // Reconnect with stored session token
  const reconnectStoredSession = useCallback(async (): Promise<boolean> => {
    const session = storedSessionRef.current;
    if (!session || isConnectingRef.current) return false;
    cleanUpOldRoom();
    isConnectingRef.current = true;
    setConnectionStatus('reconnecting');
    setError(null);

    const currentEpoch = ++epochRef.current;

    try {
      const client = clientRef.current;
      const room = await client.reconnect<unknown>(session.token);

      if (currentEpoch !== epochRef.current) {
        isConnectingRef.current = false;
        room.leave(false);
        return false;
      }

      roomRef.current = room;
      setConnectionStatus('connected');
      isConnectingRef.current = false;

      saveStoredSession({
        roomId: room.roomId,
        matchId: session.matchId,
        token: room.reconnectionToken,
        isSpectator: session.isSpectator,
      });

      attachRoomListeners(room, currentEpoch);
      room.send('request_snapshot', {});
      return true;
    } catch {
      isConnectingRef.current = false;
      if (currentEpoch !== epochRef.current) return false;
      setConnectionStatus('failed');
      setError('对局恢复失败（可能已过期或超时，请重新加入）');
      return false;
    }
  }, [attachRoomListeners, cleanUpOldRoom]);

  const discardStoredSession = useCallback(() => {
    clearStoredSession();
    cleanUpOldRoom();
    setConnectionStatus('disconnected');
    setError(null);
  }, [cleanUpOldRoom]);

  // Leave room: handles WAITING vs ACTIVE MATCH
  const leaveRoom = useCallback(
    async (forfeit = false): Promise<boolean> => {
      const room = roomRef.current;
      const authority = authorityRef.current;
      if (!room) {
        clearStoredSession();
        setConnectionStatus('disconnected');
        return true;
      }

      const isSpec = authority?.private.isSpectator ?? false;
      const phase = authority?.public.phase ?? presentationRef.current.phase;
      const isActiveMatch = !isSpec && phase !== 'WAITING' && phase !== 'FINISHED';

      // Active match requires explicit forfeit and must await server confirmation
      if (isActiveMatch) {
        if (!forfeit) {
          return false;
        }

        return new Promise<boolean>((resolve) => {
          let resolved = false;

          const finishLeave = (success: boolean) => {
            if (resolved) return;
            resolved = true;
            if (timeoutTimer) clearTimeout(timeoutTimer);
            leaveResolverRef.current = null;
            leaveIdempotencyKeyRef.current = null;

            if (success) {
              clearStoredSession();
              clearPendingLock();
              try {
                room.removeAllListeners();
                room.leave(true);
              } catch {
                // ignore
              }
              roomRef.current = null;
              setConnectionStatus('disconnected');
              setAuthoritySnapshot(null);
              setPresentation(createInitialAuctionPresentationState(epochRef.current));
            } else {
              // On timeout / failure: preserve stored session credentials so player can reconnect!
              clearPendingLock();
              setError('离开对局未收到服务器有效确认，已保留对局恢复凭据');
            }
            resolve(success);
          };

          const timeoutTimer = setTimeout(() => {
            if (!resolved) {
              finishLeave(false);
            }
          }, 8000);

          leaveResolverRef.current = finishLeave;

          sendCommand({ type: 'LEAVE' } as any).catch(() => {
            finishLeave(false);
          });
        });
      }

      // Waiting room seated player leave: must await authoritative command_result before room/session cleanup
      if (!isSpec && phase === 'WAITING') {
        return new Promise<boolean>((resolve) => {
          let resolved = false;

          const finishLeave = (success: boolean) => {
            if (resolved) return;
            resolved = true;
            if (timeoutTimer) clearTimeout(timeoutTimer);
            leaveResolverRef.current = null;
            leaveIdempotencyKeyRef.current = null;

            if (success) {
              clearStoredSession();
              clearPendingLock();
              try {
                room.removeAllListeners();
                room.leave(true);
              } catch {
                // ignore
              }
              roomRef.current = null;
              setConnectionStatus('disconnected');
              setAuthoritySnapshot(null);
              setPresentation(createInitialAuctionPresentationState(epochRef.current));
            } else {
              // On timeout / failure: preserve stored session credentials, keep room connected or return clear failure
              clearPendingLock();
              setError('离开房间未收到服务器有效确认，已保留房间凭据');
            }
            resolve(success);
          };

          const timeoutTimer = setTimeout(() => {
            if (!resolved) {
              finishLeave(false);
            }
          }, 5000);

          leaveResolverRef.current = finishLeave;

          sendCommand({ type: 'LEAVE' } as any).catch(() => {
            finishLeave(false);
          });
        });
      }

      // In FINISHED or Spectator: safe exit without LEAVE command
      try {
        room.removeAllListeners();
        await room.leave(true);
      } catch {
        // ignore
      }

      cleanUpOldRoom();
      clearStoredSession();
      setConnectionStatus('disconnected');
      setPresentation(createInitialAuctionPresentationState(epochRef.current));
      setAuthoritySnapshot(null);
      return true;
    },
    [cleanUpOldRoom, sendCommand]
  );

  // Quick Action Helpers
  const sendReady = useCallback(
    async (ready: boolean) => {
      await sendCommand({ type: 'READY', ready } as any);
    },
    [sendCommand]
  );

  const sendStart = useCallback(async () => {
    await sendCommand({ type: 'START' } as any);
  }, [sendCommand]);

  const selectBox = useCallback(
    async (boxId: number) => {
      await sendCommand({ type: 'SELECT_BOX', boxId } as any);
    },
    [sendCommand]
  );

  const openBox = useCallback(
    async (boxId: number) => {
      await sendCommand({ type: 'OPEN_BOX', boxId } as any);
    },
    [sendCommand]
  );

  const submitBid = useCallback(
    async (amount: number) => {
      await sendCommand({ type: 'SUBMIT_BID', amount } as any);
    },
    [sendCommand]
  );

  const acceptOffer = useCallback(
    async (offerId: string) => {
      await sendCommand({ type: 'ACCEPT_AUCTION', offerId } as any);
    },
    [sendCommand]
  );

  const rejectOffer = useCallback(
    async (offerId: string) => {
      await sendCommand({ type: 'REJECT_AUCTION', offerId } as any);
    },
    [sendCommand]
  );

  const keepBox = useCallback(async () => {
    await sendCommand({ type: 'KEEP_BOX' } as any);
  }, [sendCommand]);

  const swapBox = useCallback(
    async (targetBoxId: number) => {
      await sendCommand({ type: 'SWAP_BOX', targetBoxId } as any);
    },
    [sendCommand]
  );

  const continueRound = useCallback(async () => {
    await sendCommand({ type: 'CONTINUE_ROUND' } as any);
  }, [sendCommand]);

  const sendEmote = useCallback(
    async (emoji: string) => {
      const room = roomRef.current;
      const authority = authorityRef.current;
      if (!room) return;

      const isSpec = authority?.private.isSpectator ?? false;
      if (isSpec) {
        // Spectator: lightweight reaction message
        try {
          room.send('reaction', { emoji });
        } catch {
          await sendCommand({ type: 'SEND_EMOTE', emoji } as any);
        }
      } else {
        // Official player: route through sendCommand so sequence & idempotency rules apply!
        await sendCommand({ type: 'SEND_EMOTE', emoji } as any);
      }
    },
    [sendCommand]
  );

  // Box click dispatcher
  const handleBoxClick = useCallback(
    (boxId: number) => {
      const pres = presentationRef.current;
      const auth = authorityRef.current;
      if (!auth) return;

      const mySeatId = auth.private.seatId;
      const isChallenger =
        mySeatId !== null && auth.public.challengerSeatId === mySeatId;

      if (!isChallenger) return;
      if (isPending || pres.openingBoxId !== null) return;

      if (pres.phase === 'SELECTING' && pres.playerBoxId === null) {
        selectBox(boxId);
      } else if (pres.phase === 'OPENING') {
        const box = pres.boxes.find((b) => b.id === boxId);
        if (box && !box.isOpened && !box.isPlayerBox) {
          openBox(boxId);
        }
      } else if (pres.phase === 'FINAL_SWAP') {
        if (boxId !== pres.playerBoxId) {
          swapBox(boxId);
        }
      }
    },
    [isPending, openBox, selectBox, swapBox]
  );

  const clearError = useCallback(() => setError(null), []);

  const mySeatId = authoritySnapshot?.private.seatId ?? null;
  const isSpectator = authoritySnapshot?.private.isSpectator ?? false;
  const challengerSeatId = authoritySnapshot?.public.challengerSeatId ?? null;
  const myRole: AuctionRole | null =
    mySeatId !== null
      ? mySeatId === challengerSeatId
        ? 'CHALLENGER'
        : 'CAPITALIST'
      : null;
  const isHost =
    mySeatId !== null && authoritySnapshot?.public.hostSeatId === mySeatId;

  return {
    presentation,
    authority: authoritySnapshot,
    publicState: authoritySnapshot?.public ?? null,
    privateState: authoritySnapshot?.private ?? null,
    connectionStatus,
    isPending,
    error,
    serverNow,
    serverTimeOffset,
    latencyMs,
    deadlineTimestamp,
    mySeatId,
    myRole,
    isSpectator,
    isHost,
    storedSession,
    hasStoredSession: Boolean(storedSession),
    createRoom,
    joinRoom,
    reconnectStoredSession,
    discardStoredSession,
    sendCommand,
    sendReady,
    sendStart,
    selectBox,
    openBox,
    submitBid,
    acceptOffer,
    rejectOffer,
    keepBox,
    swapBox,
    continueRound,
    sendEmote,
    leaveRoom,
    requestSnapshot,
    handleBoxClick,
    handleBoxAnimationComplete,
    clearError,
  };
}
