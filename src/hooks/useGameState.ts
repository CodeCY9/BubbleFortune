import { useState, useCallback, useEffect, useRef } from 'react';
import { Client, Room } from 'colyseus.js';
import type {
  PublicSnapshot,
  PublicGameEvent,
  ClientCommand,
  CommandResult,
  AiType,
} from '../../packages/protocol/src/types';
import { soundManager } from '../utils/audio';
import {
  PresentationState,
  createInitialPresentationState,
  applySnapshotToPresentation,
  commitBoxOpenAnimation,
} from '../utils/presentationManager';
import {
  createClientCommand,
  shouldDropStaleSnapshot,
  isPendingCommandAckedBySnapshot,
  correlateCommandResult,
  shouldRetransmitPendingOnReconnect,
  type PendingCommand,
} from '../utils/clientSync';
import { requireGuestSession } from '../api/history';
import { pinInitialCommitment } from '../utils/fairnessStorage';
import { translateServerError } from '../utils/serverErrorMessage';

function getWsEndpoint(): string {
  if (typeof window === 'undefined') return 'ws://127.0.0.1:2567/game';
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/game`;
}

function mapErrorCodeToFriendlyMessage(code?: string): string {
  return translateServerError(code);
}

export type ConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'failed';

export interface UseGameStateOptions {
  roomName?: 'classic_26' | 'challenge_26';
  soundEnabled?: boolean;
  fastMode?: boolean;
  onToggleSound?: () => void;
  onToggleFastMode?: () => void;
}

export function useGameState(options?: UseGameStateOptions) {
  const roomName = options?.roomName ?? 'classic_26';
  const storagePrefix = roomName === 'challenge_26' ? 'bubble_fortune_challenge' : 'bubble_fortune';
  const sessionTokenKey = `${storagePrefix}_reconnect_token`;
  const sessionGameIdKey = `${storagePrefix}_game_id`;
  const [presentation, setPresentation] = useState<PresentationState>(() =>
    createInitialPresentationState(0)
  );
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>('disconnected');
  const [isPending, setIsPending] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [isLobbyVisible, setIsLobbyVisible] = useState(false);

  const [deadlineTimestamp, setDeadlineTimestamp] = useState<number | null>(null);
  const [serverNow, setServerNow] = useState<number>(Date.now());
  const [serverTimeOffset, setServerTimeOffset] = useState<number>(0);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);

  // Fallback internal settings if options not provided
  const [internalSoundEnabled, setInternalSoundEnabled] = useState<boolean>(false);
  const [internalFastMode, setInternalFastMode] = useState<boolean>(false);

  const soundEnabled = options?.soundEnabled ?? internalSoundEnabled;
  const fastMode = options?.fastMode ?? internalFastMode;

  const soundEnabledRef = useRef(soundEnabled);
  soundEnabledRef.current = soundEnabled;

  const fastModeRef = useRef(fastMode);
  fastModeRef.current = fastMode;

  // Connection & sync refs
  const clientRef = useRef<Client>(new Client(getWsEndpoint()));
  const roomRef = useRef<Room | null>(null);
  const epochRef = useRef<number>(0);
  const isConnectingOrReconnectingRef = useRef<boolean>(false);
  const hasReceivedInitialSnapshotRef = useRef<boolean>(false);

  const authoritativeSnapshotRef = useRef<PublicSnapshot | null>(null);
  const lastStateVersionRef = useRef<number>(0);
  const lastCommandSeqRef = useRef<number>(0);

  const presentationRef = useRef<PresentationState>(presentation);
  presentationRef.current = presentation;

  const connectionStatusRef = useRef<ConnectionStatus>('disconnected');
  connectionStatusRef.current = connectionStatus;

  const dispatchLockRef = useRef<boolean>(false);
  const pendingCommandRef = useRef<PendingCommand | null>(null);
  const pendingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Single authoritative presentation updater: updates presentationRef synchronously before setState
  const applyPresentation = useCallback(
    (nextOrUpdater: PresentationState | ((prev: PresentationState) => PresentationState)) => {
      const next =
        typeof nextOrUpdater === 'function'
          ? nextOrUpdater(presentationRef.current)
          : nextOrUpdater;
      presentationRef.current = next;
      setPresentation(next);
      return next;
    },
    []
  );

  // Single connectionStatus updater: updates connectionStatusRef synchronously before setState
  const updateConnectionStatus = useCallback((status: ConnectionStatus) => {
    connectionStatusRef.current = status;
    setConnectionStatus(status);
  }, []);

  const clearPendingTimeout = useCallback(() => {
    if (pendingTimeoutRef.current) {
      clearTimeout(pendingTimeoutRef.current);
      pendingTimeoutRef.current = null;
    }
  }, []);

  const startPendingTimeout = useCallback(() => {
    clearPendingTimeout();
    pendingTimeoutRef.current = setTimeout(() => {
      if (pendingCommandRef.current) {
        setError('服务器响应较慢，如无反应请点击重试');
      }
    }, 4000);
  }, [clearPendingTimeout, sessionTokenKey]);

  const toggleSound = useCallback(() => {
    if (options?.onToggleSound) {
      options.onToggleSound();
    } else {
      setInternalSoundEnabled((prev) => {
        const next = !prev;
        soundManager.setSoundEnabled(next);
        return next;
      });
    }
  }, [options]);

  const toggleFastMode = useCallback(() => {
    if (options?.onToggleFastMode) {
      options.onToggleFastMode();
    } else {
      setInternalFastMode((prev) => !prev);
    }
  }, [options]);

  const handleServerSnapshot = useCallback(
    (snapshot: PublicSnapshot, forceInitial = false) => {
      // Monotonicity check: drop older state versions
      if (shouldDropStaleSnapshot(snapshot.stateVersion, lastStateVersionRef.current)) {
        return;
      }
      lastStateVersionRef.current = snapshot.stateVersion;

      if (snapshot.lastCommandSequence > lastCommandSeqRef.current) {
        lastCommandSeqRef.current = snapshot.lastCommandSequence;
      }

      authoritativeSnapshotRef.current = snapshot;
      pinInitialCommitment(snapshot);
      setDeadlineTimestamp(snapshot.deadlineTimestamp);
      setServerNow(snapshot.serverNow);
      setServerTimeOffset(snapshot.serverNow - Date.now());

      // If pending command has completed on server, release pending lock and timer
      if (isPendingCommandAckedBySnapshot(pendingCommandRef.current, snapshot.lastCommandSequence)) {
        clearPendingTimeout();
        pendingCommandRef.current = null;
        setIsPending(false);
      }

      // First snapshot received in this epoch must always be restored without animation
      const isInitialOrReconnect = forceInitial || !hasReceivedInitialSnapshotRef.current;
      if (!hasReceivedInitialSnapshotRef.current) {
        hasReceivedInitialSnapshotRef.current = true;
        // On reconnection, if server snapshot has not consumed pending command, retransmit once!
        if (
          isInitialOrReconnect &&
          shouldRetransmitPendingOnReconnect(pendingCommandRef.current, snapshot.lastCommandSequence) &&
          roomRef.current
        ) {
          try {
            roomRef.current.send('command', pendingCommandRef.current!.command);
            startPendingTimeout();
          } catch {}
        }
      }

      // Feed snapshot to presentation state machine synchronously
      applyPresentation((prev) => {
        const res = applySnapshotToPresentation(prev, snapshot, isInitialOrReconnect);
        return res.state;
      });
    },
    [applyPresentation, clearPendingTimeout, startPendingTimeout]
  );

  const handleCommandResult = useCallback(
    (result: CommandResult) => {
      // Correlate result.idempotencyKey with pendingCommand. Missing/mismatched key NEVER clears pending!
      const correlation = correlateCommandResult(pendingCommandRef.current, result);
      if (!correlation.matches) {
        return;
      }

      if (correlation.shouldClearPending) {
        clearPendingTimeout();
        pendingCommandRef.current = null;
        setIsPending(false);
      }

      if (!result.success) {
        if (result.snapshot) {
          handleServerSnapshot(result.snapshot, false);
        }
        setError(mapErrorCodeToFriendlyMessage(result.error?.code));
        return;
      }

      if (result.snapshot) {
        handleServerSnapshot(result.snapshot, false);
      }
    },
    [handleServerSnapshot, clearPendingTimeout]
  );

  const attachRoomListeners = useCallback(
    (room: Room, epoch: number) => {
      room.onMessage('ready', () => {
        if (epoch !== epochRef.current) return;
        room.send('request_snapshot');
      });

      room.onMessage('snapshot', (snapshot: PublicSnapshot) => {
        if (epoch !== epochRef.current) return;
        handleServerSnapshot(snapshot, false);
      });

      room.onMessage(
        'game_event',
        (payload: { event: PublicGameEvent; snapshot: PublicSnapshot }) => {
          if (epoch !== epochRef.current) return;
          if (payload && payload.snapshot) {
            handleServerSnapshot(payload.snapshot, false);
          }
        }
      );

      room.onMessage('command_result', (result: CommandResult) => {
        if (epoch !== epochRef.current) return;
        handleCommandResult(result);
      });

      room.onMessage('error', (err: { code: string; message: string }) => {
        if (epoch !== epochRef.current) return;
        setError(mapErrorCodeToFriendlyMessage(err.code));
      });

      room.onMessage('pong', (payload: { sentAt?: number; serverAt?: number }) => {
        if (epoch !== epochRef.current || typeof payload?.sentAt !== 'number') return;
        setLatencyMs(Math.max(0, Date.now() - payload.sentAt));
        if (typeof payload.serverAt === 'number') {
          setServerTimeOffset(payload.serverAt - Date.now());
        }
      });

      room.onLeave((code) => {
        if (epoch !== epochRef.current) return;
        setLatencyMs(null);
        if (code === 1000) {
          updateConnectionStatus('disconnected');
        } else {
          updateConnectionStatus('disconnected');
          setError('与游戏服务器断开连接');
        }
      });

      room.onError(() => {
        if (epoch !== epochRef.current) return;
        setError('网络连接异常');
      });
    },
    [handleServerSnapshot, handleCommandResult, updateConnectionStatus]
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

  // Send state-mutating command with synchronous ref checks and try/catch
  const sendCommand = useCallback(
    (
      type: 'SELECT_BOX' | 'OPEN_BOX' | 'ACCEPT_OFFER' | 'REJECT_OFFER' | 'KEEP_BOX' | 'SWAP_BOX' | 'USE_INQUIRY' | 'BUY_INSURANCE' | 'DECLINE_RAISE',
      params: Record<string, any> = {}
    ) => {
      if (dispatchLockRef.current) return;
      if (connectionStatusRef.current !== 'connected') return;
      if (pendingCommandRef.current !== null) return;
      if (presentationRef.current.openingBoxId !== null) return;
      if (!roomRef.current) return;

      const authSnap = authoritativeSnapshotRef.current;
      if (!authSnap) return;

      dispatchLockRef.current = true;
      try {
        const cmd = createClientCommand(
          type,
          authSnap.gameId,
          authSnap.stateVersion,
          lastCommandSeqRef.current,
          params
        );

        pendingCommandRef.current = { command: cmd, timestamp: Date.now() };
        setIsPending(true);
        setError(null);
        startPendingTimeout();

        try {
          roomRef.current.send('command', cmd);
        } catch (sendErr) {
          setError('指令发送失败，网络连接异常，请重试');
        }
      } finally {
        dispatchLockRef.current = false;
      }
    },
    [startPendingTimeout]
  );

  // Retry pending command: only send original payload when connected
  const retryPendingCommand = useCallback(() => {
    if (connectionStatusRef.current !== 'connected') return;
    if (!pendingCommandRef.current || !roomRef.current) return;
    try {
      roomRef.current.send('command', pendingCommandRef.current.command);
      startPendingTimeout();
    } catch {
      setError('重试指令失败，网络连接异常');
    }
  }, [startPendingTimeout]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // Start a new game room with selected AI (explicit user initiation only)
  const startGame = useCallback(
    async (aiType: AiType = 'conservative') => {
      if (isConnectingOrReconnectingRef.current) return;
      isConnectingOrReconnectingRef.current = true;

      let epoch = epochRef.current;
      setIsPending(true);
      setError(null);
      try {
        await requireGuestSession();
        if (epoch !== epochRef.current) return;
      } catch (error) {
        if (epoch === epochRef.current) {
          setError(error instanceof Error ? error.message : '游客身份确认失败，请重试');
        }
        return;
      } finally {
        if (epoch === epochRef.current) {
          setIsPending(false);
          isConnectingOrReconnectingRef.current = false;
        }
      }
      isConnectingOrReconnectingRef.current = true;
      epoch = ++epochRef.current;
      hasReceivedInitialSnapshotRef.current = false;
      setIsLobbyVisible(false);

      if (roomRef.current) {
        try {
          roomRef.current.leave(true);
        } catch {}
        roomRef.current = null;
      }

      sessionStorage.removeItem(sessionTokenKey);
      sessionStorage.removeItem(sessionGameIdKey);

      applyPresentation(createInitialPresentationState(epoch));
      updateConnectionStatus('connecting');
      setIsPending(false);
      setError(null);
      clearPendingTimeout();
      authoritativeSnapshotRef.current = null;
      lastStateVersionRef.current = 0;
      lastCommandSeqRef.current = 0;
      pendingCommandRef.current = null;
      dispatchLockRef.current = false;

      try {
        const client = clientRef.current;
        const room = await client.create(roomName, { aiType });
        if (epoch !== epochRef.current) {
          // Abandoned new game creation: dispose self-created room
          try {
            room.leave(true);
          } catch {}
          return;
        }
        roomRef.current = room;
        if (room.reconnectionToken) {
          sessionStorage.setItem(sessionTokenKey, room.reconnectionToken);
          sessionStorage.setItem(sessionGameIdKey, room.roomId);
        }
        updateConnectionStatus('connected');
        attachRoomListeners(room, epoch);
        room.send('request_snapshot');
      } catch (err) {
        if (epoch !== epochRef.current) return;
        updateConnectionStatus('failed');
        setError('创建游戏房间失败，请检查网络或稍后重试');
        pendingCommandRef.current = null;
        setIsPending(false);
        dispatchLockRef.current = false;
      } finally {
        if (epoch === epochRef.current) {
          isConnectingOrReconnectingRef.current = false;
        }
      }
    },
    [attachRoomListeners, applyPresentation, updateConnectionStatus, clearPendingTimeout, roomName, sessionTokenKey, sessionGameIdKey]
  );

  const startNewGame = startGame;

  const returnToLobby = useCallback((force: boolean = false) => {
    if (presentationRef.current.phase === 'GAME_OVER' || force) {
      if (roomRef.current) {
        try {
          roomRef.current.leave(true);
        } catch {}
        roomRef.current = null;
      }
      sessionStorage.removeItem(sessionTokenKey);
      sessionStorage.removeItem(sessionGameIdKey);
      epochRef.current++;
      setIsLobbyVisible(true);
      applyPresentation(createInitialPresentationState(epochRef.current));
      updateConnectionStatus('disconnected');
      setError(null);
    }
  }, [sessionTokenKey, sessionGameIdKey, applyPresentation, updateConnectionStatus]);

  // Reconnect with session token: mutex protected, synchronized presentation epoch, non-destructive stale cleanup
  const reconnectSession = useCallback(
    async (token: string) => {
      if (isConnectingOrReconnectingRef.current) return;
      isConnectingOrReconnectingRef.current = true;

      const epoch = ++epochRef.current;
      hasReceivedInitialSnapshotRef.current = false;

      // Synchronously update presentationRef epoch and clear local opening state
      applyPresentation((prev) => ({
        ...prev,
        epoch,
        openingBoxId: null,
        pendingRevealAmount: null,
      }));

      updateConnectionStatus('reconnecting');
      setError(null);

      try {
        const client = clientRef.current;
        const room = await client.reconnect(token);
        if (epoch !== epochRef.current) {
          // CRITICAL: Stale async reconnect MUST NOT leave(true) destroy seat!
          try {
            room.leave(false);
          } catch {}
          return;
        }
        roomRef.current = room;
        if (room.reconnectionToken) {
          sessionStorage.setItem(sessionTokenKey, room.reconnectionToken);
          sessionStorage.setItem(sessionGameIdKey, room.roomId);
        }
        updateConnectionStatus('connected');
        attachRoomListeners(room, epoch);
        room.send('request_snapshot');
      } catch (err) {
        if (epoch !== epochRef.current) return;
        // A transient network failure must not discard a still-valid reservation.
        // Starting a new game explicitly clears the previous session token.
        updateConnectionStatus('failed');
        setError('暂时无法恢复连接，请重试；若服务已重启或对局已过期，请点击“开始游戏”开启新局。');
        applyPresentation(createInitialPresentationState(epoch));
        pendingCommandRef.current = null;
        setIsPending(false);
        dispatchLockRef.current = false;
        clearPendingTimeout();
      } finally {
        if (epoch === epochRef.current) {
          isConnectingOrReconnectingRef.current = false;
        }
      }
    },
    [attachRoomListeners, applyPresentation, updateConnectionStatus, clearPendingTimeout, sessionTokenKey, sessionGameIdKey]
  );

  const reconnectSessionRef = useRef(reconnectSession);
  reconnectSessionRef.current = reconnectSession;

  // Mount effect: 0ms cancelable timer prevents React StrictMode double invocation; unmount leaves non-consented
  useEffect(() => {
    const token = sessionStorage.getItem(sessionTokenKey);
    let timer: NodeJS.Timeout | null = null;
    if (token) {
      timer = setTimeout(() => {
        reconnectSessionRef.current(token);
      }, 0);
    }
    return () => {
      if (timer) {
        clearTimeout(timer);
      }
      epochRef.current++;
      isConnectingOrReconnectingRef.current = false;
      clearPendingTimeout();
      if (roomRef.current) {
        try {
          roomRef.current.leave(false);
        } catch {}
        roomRef.current = null;
      }
    };
  }, [clearPendingTimeout, sessionTokenKey]);

  const selectPlayerBox = useCallback(
    (boxId: number) => {
      sendCommand('SELECT_BOX', { boxId });
    },
    [sendCommand]
  );

  const openBox = useCallback(
    (boxId: number) => {
      if (presentationRef.current.openingBoxId !== null) return;
      sendCommand('OPEN_BOX', { boxId });
    },
    [sendCommand]
  );

  // Complete box animation: closures capture presentation.epoch and gameId at render; compare with epochRef
  const completeOpenBox = useCallback(
    (boxId: number) => {
      // Drop stale callback if epoch or gameId has changed
      if (presentation.epoch !== epochRef.current) return;
      if (
        presentation.gameId &&
        authoritativeSnapshotRef.current?.gameId &&
        presentation.gameId !== authoritativeSnapshotRef.current.gameId
      ) {
        return;
      }

      const prev = presentationRef.current;
      const next = commitBoxOpenAnimation(
        prev,
        boxId,
        presentation.epoch,
        authoritativeSnapshotRef.current,
        presentation.gameId
      );

      if (next !== prev) {
        applyPresentation(next);
        // Play sound OUTSIDE state setter to avoid React StrictMode double playback!
        if (next.lastRevealedBox && soundEnabledRef.current) {
          const isHigh = next.lastRevealedBox.value >= 5000;
          soundManager.playBoxOpen(isHigh, fastModeRef.current);
          if (next.phase === 'BANKER_OFFER') {
            soundManager.playBankerRing();
          } else if (next.phase === 'GAME_OVER') {
            soundManager.playVictory();
          }
        }
      }
    },
    [presentation.epoch, presentation.gameId, applyPresentation]
  );

  const acceptDeal = useCallback(() => {
    const offerId = authoritativeSnapshotRef.current?.currentOffer?.offerId;
    if (offerId) {
      sendCommand('ACCEPT_OFFER', { offerId });
    }
  }, [sendCommand]);

  const rejectDeal = useCallback(() => {
    const offerId = authoritativeSnapshotRef.current?.currentOffer?.offerId;
    if (offerId) {
      sendCommand('REJECT_OFFER', { offerId });
    }
  }, [sendCommand]);

  const resolveFinalSwap = useCallback(
    (swap: boolean) => {
      if (swap) {
        const playerBoxId = presentationRef.current.playerBoxId;
        const targetBox = presentationRef.current.boxes.find(
          (b) => !b.isOpened && b.id !== playerBoxId
        );
        if (targetBox) {
          sendCommand('SWAP_BOX', { targetBoxId: targetBox.id });
        }
      } else {
        sendCommand('KEEP_BOX');
      }
    },
    [sendCommand]
  );

  const useInquiry = useCallback(() => {
    sendCommand('USE_INQUIRY');
  }, [sendCommand]);

  const buyInsurance = useCallback(() => {
    sendCommand('BUY_INSURANCE');
  }, [sendCommand]);

  const declineRaise = useCallback(() => {
    sendCommand('DECLINE_RAISE');
  }, [sendCommand]);

  // Retry connection: without token, NEVER starts new game implicitly; requires explicit user start
  const retryConnection = useCallback(() => {
    const token = sessionStorage.getItem(sessionTokenKey);
    if (token) {
      reconnectSession(token);
    } else {
      setError('旧局已结束或不可恢复，请点击“开始游戏”开启新局');
    }
  }, [reconnectSession, sessionTokenKey]);

  return {
    phase: presentation.phase,
    boxes: presentation.boxes,
    playerBoxId: presentation.playerBoxId,
    currentRound: presentation.currentRound,
    boxesLeftToOpenThisRound: presentation.boxesLeftToOpenThisRound,
    bankerOffer: presentation.bankerOffer,
    currentOfferId: authoritativeSnapshotRef.current?.currentOffer?.offerId ?? null,
    settlement: presentation.settlement,
    lastRevealedBox: presentation.lastRevealedBox,
    openingBoxId: presentation.openingBoxId,
    gameId: presentation.gameId,
    epoch: presentation.epoch,
    soundEnabled,
    fastMode,
    deadlineTimestamp,
    serverNow,
    serverTimeOffset,
    latencyMs,
    connectionStatus,
    isPending,
    error,
    aiType: authoritativeSnapshotRef.current?.aiType ?? 'conservative',
    offerHistory: presentation.offerHistory,
    toggleSound,
    toggleFastMode,
    startGame,
    startNewGame,
    returnToLobby,
    isLobbyVisible,
    ruleVersion: authoritativeSnapshotRef.current?.ruleVersion,
    challenge: authoritativeSnapshotRef.current?.challenge ?? null,
    selectPlayerBox,
    openBox,
    completeOpenBox,
    acceptDeal,
    rejectDeal,
    resolveFinalSwap,
    useInquiry,
    buyInsurance,
    declineRaise,
    retryConnection,
    retryPendingCommand,
    clearError,
  };
}
