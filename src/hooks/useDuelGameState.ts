import { useState, useCallback, useEffect, useRef } from 'react';
import { Client, Room } from 'colyseus.js';
import type {
  DuelClientSnapshot,
  DuelPublicSnapshot,
  DuelPrivateView,
  DuelCommandResult,
  DuelActionType,
  DuelSeatId,
  DuelRole,
} from '../../packages/protocol/src/duel';
import type { RoomThemeId } from '../../packages/protocol/src/theme';
import {
  DuelPresentationState,
  createInitialDuelPresentationState,
  applySnapshotToDuelPresentation,
  commitDuelBoxOpenAnimation,
} from '../utils/duelPresentation';
import { ensureDuelGuestSession } from '../api/duel';
import { soundManager } from '../utils/audio';
import { translateServerError } from '../utils/serverErrorMessage';

const DUEL_SESSION_STORAGE_KEY = 'bf_duel_session';

export interface StoredDuelSession {
  roomId: string;
  matchId: string;
  token: string;
}

export type DuelConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'failed';

interface PendingDuelCommand {
  matchId: string | null;
  roundIndex: number;
  cmd: {
    type: DuelActionType;
    stateVersion: number;
    commandSequence: number;
    idempotencyKey: string;
    [key: string]: unknown;
  };
  sentAt: number;
  retransmitted: boolean;
}

function getWsEndpoint(): string {
  if (typeof window === 'undefined') return 'ws://127.0.0.1:2567/game';
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/game`;
}

export function mapDuelErrorCodeToMessage(code?: string): string {
  return translateServerError(code);
}

export interface UseDuelGameStateOptions {
  soundEnabled?: boolean;
  fastMode?: boolean;
}

export function useDuelGameState(options?: UseDuelGameStateOptions) {
  const soundEnabled = options?.soundEnabled ?? false;
  const fastMode = options?.fastMode ?? false;

  useEffect(() => {
    soundManager.setSoundEnabled(soundEnabled);
  }, [soundEnabled]);

  const [presentation, setPresentation] = useState<DuelPresentationState>(() =>
    createInitialDuelPresentationState(0)
  );
  const [authoritySnapshot, setAuthoritySnapshot] = useState<DuelClientSnapshot | null>(null);
  const [connectionStatus, setConnectionStatus] =
    useState<DuelConnectionStatus>('disconnected');
  const [isPending, setIsPending] = useState<boolean>(false);
  const [isPendingUnconfirmed, setIsPendingUnconfirmed] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const [deadlineTimestamp, setDeadlineTimestamp] = useState<number | null>(null);
  const [serverNow, setServerNow] = useState<number>(Date.now());
  const [serverTimeOffset, setServerTimeOffset] = useState<number>(0);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);

  // Stored session detected in sessionStorage
  const [storedSession, setStoredSession] = useState<StoredDuelSession | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const raw = sessionStorage.getItem(DUEL_SESSION_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.roomId === 'string' && typeof parsed.token === 'string') {
        return parsed as StoredDuelSession;
      }
    } catch {
      // ignore
    }
    return null;
  });

  const storedSessionRef = useRef<StoredDuelSession | null>(storedSession);
  storedSessionRef.current = storedSession;

  // Lifecycle & Connection refs
  const clientRef = useRef<Client>(new Client(getWsEndpoint()));
  const roomRef = useRef<Room | null>(null);
  const epochRef = useRef<number>(0);
  const isConnectingRef = useRef<boolean>(false);

  const presentationRef = useRef<DuelPresentationState>(presentation);
  presentationRef.current = presentation;

  const authorityRef = useRef<DuelClientSnapshot | null>(authoritySnapshot);
  authorityRef.current = authoritySnapshot;

  const pendingCommandRef = useRef<PendingDuelCommand | null>(null);
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
    setIsPendingUnconfirmed(false);
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

  const saveStoredSession = (session: StoredDuelSession) => {
    try {
      sessionStorage.setItem(DUEL_SESSION_STORAGE_KEY, JSON.stringify(session));
      setStoredSession(session);
      storedSessionRef.current = session;
    } catch {
      // ignore
    }
  };

  const clearStoredSession = () => {
    try {
      sessionStorage.removeItem(DUEL_SESSION_STORAGE_KEY);
      setStoredSession(null);
      storedSessionRef.current = null;
    } catch {
      // ignore
    }
  };

  // Apply snapshot updates strictly
  const handleIncomingSnapshot = useCallback(
    (snapshot: DuelClientSnapshot, isInitial: boolean) => {
      const currentAuth = authorityRef.current;

      // Drop stale snapshots:
      // 1) If in the same match: drop older round, or older stateVersion in same round
      // 2) If in WAITING: drop older stateVersion
      // 3) Drop late-arriving pre-match snapshot when match is active
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
          // A late packet from another room/match must never replace the
          // active authority or presentation state.
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

      // Update clock offset
      if (typeof snapshot.public.serverNow === 'number') {
        const offset = snapshot.public.serverNow - Date.now();
        setServerTimeOffset(offset);
        setServerNow(snapshot.public.serverNow);
      }
      setDeadlineTimestamp(snapshot.public.deadlineTimestamp ?? null);

      // Check if pending command has been acknowledged by server's private view
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

      if (isInitial && pendingCommandRef.current && roomRef.current) {
        // Initial snapshot after reconnect did not consume pending command: retransmit original payload once
        const stillPending = pendingCommandRef.current;
        try {
          roomRef.current.send('command', stillPending.cmd);
        } catch {
          // ignore
        }
      }

      // Preserve credentials until server confirms leave or match is FINISHED
      if (snapshot.public.phase === 'FINISHED') {
        clearStoredSession();
      } else if (roomRef.current && roomRef.current.reconnectionToken) {
        saveStoredSession({
          roomId: roomRef.current.roomId,
          matchId: snapshot.public.matchId,
          token: roomRef.current.reconnectionToken,
        });
      }

      // Update presentation state
      const { state: nextPres } = applySnapshotToDuelPresentation(
        presentationRef.current,
        snapshot.public,
        isInitial
      );

      presentationRef.current = nextPres;
      setPresentation(nextPres);
    },
    []
  );

  // Setup room listeners
  const attachRoomListeners = useCallback(
    (room: Room, currentEpoch: number) => {
      let hasReceivedInitialSnapshot = false;

      room.onMessage('snapshot', (snapshot: DuelClientSnapshot) => {
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
          (!pendingAtReceive.matchId || snapshot.public.matchId === pendingAtReceive.matchId) &&
          snapshot.public.roundIndex >= pendingAtReceive.roundIndex &&
          snapshot.private.lastCommandSequence >= pendingAtReceive.cmd.commandSequence
        ) {
          leaveResolverRef.current(true);
        }
      });

      room.onMessage('command_result', (result: DuelCommandResult) => {
        if (currentEpoch !== epochRef.current) return;
        const pending = pendingCommandRef.current;

        // A response for an older command must not apply its snapshot to the
        // current presentation or release a newer request's pending lock.
        if (pending && result.idempotencyKey !== pending.cmd.idempotencyKey) {
          return;
        }

        // If this result matches a pending leave command
        if (
          leaveResolverRef.current &&
          leaveIdempotencyKeyRef.current &&
          result.idempotencyKey === leaveIdempotencyKeyRef.current
        ) {
          if (
            result.success &&
            (!pending ||
              !result.snapshot ||
              (pending &&
                pending.matchId &&
                result.snapshot.public.matchId !== pending.matchId) ||
              (pending &&
                result.snapshot.public.roundIndex < pending.roundIndex) ||
              (pending &&
                result.snapshot.private.lastCommandSequence < pending.cmd.commandSequence))
          ) {
            return;
          }
          if (!result.success) {
            clearPendingLock();
          }
          leaveResolverRef.current(result.success);
          return;
        }

        // Only apply a response snapshot from the same match and current-or-newer
        // round as the command that produced it.
        if (result.snapshot) {
          if (pending) {
            if (pending.matchId && result.snapshot.public.matchId !== pending.matchId) {
              return;
            }
            if (result.snapshot.public.roundIndex < pending.roundIndex) {
              return;
            }
          }
          handleIncomingSnapshot(result.snapshot, false);
        }

        if (!pending) return;

        // Strictly verify idempotencyKey match
        if (result.idempotencyKey !== pending.cmd.idempotencyKey) {
          return;
        }

        if (result.success) {
          if (
            !result.snapshot ||
            (pending.matchId && result.snapshot.public.matchId !== pending.matchId) ||
            result.snapshot.public.roundIndex < pending.roundIndex ||
            result.snapshot.private.lastCommandSequence < pending.cmd.commandSequence
          ) {
            return;
          }
          clearPendingLock();
        } else {
          clearPendingLock();
          const msg =
            mapDuelErrorCodeToMessage(result.error?.code) ||
            result.error?.message ||
            '操作未成功';
          setError(msg);
        }
      });

      room.onMessage('error', (err: { code?: string; message?: string }) => {
        if (currentEpoch !== epochRef.current) return;
        const msg = mapDuelErrorCodeToMessage(err?.code) || err?.message || '房间异常';
        setError(msg);
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
        // Clean up listeners and clear roomRef so reconnect is not blocked!
        room.removeAllListeners();
        if (roomRef.current === room) {
          roomRef.current = null;
        }
        isConnectingRef.current = false;
        clearPendingTimeout();

        if (leaveResolverRef.current) {
          // A transport close alone is not proof that the server accepted LEAVE.
          // Keep the session/pending command until command_result confirms it;
          // the caller's timeout can then offer retransmission or retry.
          setConnectionStatus('reconnecting');
          leaveResolverRef.current(false);
          return;
        }

        if (code === 1000) {
          setConnectionStatus('disconnected');
        } else {
          // Abnormal disconnect: allow reconnection
          setConnectionStatus('reconnecting');
        }
      });

      room.onError((code, message) => {
        if (currentEpoch !== epochRef.current) return;
        console.warn('Duel room error:', code, message);
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

  // Send a duel command with sequence, stateVersion, idempotencyKey, and timeout handling
  const sendCommand = useCallback(
    (type: DuelActionType, extraPayload: Record<string, unknown> = {}): boolean => {
      const authority = authorityRef.current;
      const room = roomRef.current;

      if (!room || connectionStatus !== 'connected' || !authority) {
        setError('未连接到对决房间');
        return false;
      }

      if (isPending || pendingCommandRef.current) {
        setError('上一指令正在处理中，请稍候');
        return false;
      }

      // Check allowed actions according to server private view
      if (!authority.private.allowedActions.includes(type)) {
        setError('当前阶段不允许执行该操作');
        return false;
      }

      const matchId = authority.public.matchId || null;
      const roundIndex = authority.public.roundIndex;
      const stateVersion = authority.public.stateVersion;
      const commandSequence = (authority.private.lastCommandSequence ?? 0) + 1;
      const idempotencyKey = `${type.toLowerCase()}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

      const cmd = {
        type,
        stateVersion,
        commandSequence,
        idempotencyKey,
        ...extraPayload,
      };

      setIsPending(true);
      setIsPendingUnconfirmed(false);
      pendingCommandRef.current = {
        matchId,
        roundIndex,
        cmd,
        sentAt: Date.now(),
        retransmitted: false,
      };

      // Set timeout timer: only allows retransmitting the EXACT same payload with same idempotencyKey
      pendingTimeoutRef.current = setTimeout(() => {
        const pending = pendingCommandRef.current;
        if (pending && !pending.retransmitted && roomRef.current && connectionStatus === 'connected') {
          pending.retransmitted = true;
          try {
            roomRef.current.send('command', pending.cmd);
          } catch {
            // ignore
          }
          pendingTimeoutRef.current = setTimeout(() => {
            setIsPendingUnconfirmed(true);
            setError('操作请求未收到确认，可点击重试原请求或检查连接');
          }, 4000);
        } else if (pending) {
          setIsPendingUnconfirmed(true);
          setError('操作请求未收到确认，可点击重试原请求或检查连接');
        }
      }, 5000);

      try {
        room.send('command', cmd);
        return true;
      } catch (err: any) {
        setIsPendingUnconfirmed(true);
        setError(err?.message || '发送指令网络异常，状态待确认');
        return false;
      }
    },
    [connectionStatus, isPending]
  );

  // Explicit retransmit of pending command
  const retransmitPendingCommand = useCallback(() => {
    const pending = pendingCommandRef.current;
    const room = roomRef.current;
    if (pending && room && connectionStatus === 'connected') {
      setError(null);
      setIsPendingUnconfirmed(false);
      try {
        room.send('command', pending.cmd);
      } catch (err: any) {
        setError('重传请求失败: ' + (err?.message || '网络异常'));
      }
    }
  }, [connectionStatus]);

  // Animation commit callback from 3D stage
  const handleBoxAnimationComplete = useCallback(
    (
      boxId: number,
      boundEpoch: number,
      boundRoundIndex: number,
      boundMatchId: string | null
    ) => {
      const currentPres = presentationRef.current;
      const authoritative = authorityRef.current?.public ?? null;

      const nextPres = commitDuelBoxOpenAnimation(
        currentPres,
        boxId,
        boundEpoch,
        boundRoundIndex,
        boundMatchId,
        authoritative
      );

      presentationRef.current = nextPres;
      setPresentation(nextPres);

      if (nextPres.lastRevealedBox && nextPres.lastRevealedBox.id === boxId) {
        soundManager.playBoxOpen(nextPres.lastRevealedBox.value >= 5000, fastMode);
      }
    },
    [fastMode]
  );

  // Box click handler
  const handleBoxClick = useCallback(
    (boxId: number) => {
      const pres = presentationRef.current;
      const auth = authorityRef.current;
      if (!auth || connectionStatus !== 'connected' || isPending || pres.openingBoxId !== null) {
        return;
      }

      // Banker cannot select or open boxes
      const seatId = auth.private.seatId;
      const mySeat = auth.public.seats ? auth.public.seats[seatId] : null;
      if (mySeat?.role !== 'CHALLENGER') {
        return;
      }

      // Check if presented matches authority phase and round
      if (pres.phase !== auth.public.phase || pres.roundIndex !== auth.public.roundIndex) {
        return;
      }

      if (pres.phase === 'SELECTING') {
        sendCommand('SELECT_BOX', { boxId });
      } else if (pres.phase === 'OPENING') {
        sendCommand('OPEN_BOX', { boxId });
      }
    },
    [connectionStatus, isPending, sendCommand]
  );

  // Create room
  const createRoom = useCallback(
    async (nickname: string, password?: string, ranked = true, publicListing = true, themeId: RoomThemeId = 'classic', showOfferHistory = true) => {
      if (isConnectingRef.current) return;
      cleanUpOldRoom();
      isConnectingRef.current = true;
      setConnectionStatus('connecting');
      setError(null);

      const currentEpoch = ++epochRef.current;

      try {
        await ensureDuelGuestSession();
        if (currentEpoch !== epochRef.current) {
          isConnectingRef.current = false;
          return;
        }

        const trimmedNickname = Array.from(nickname.trim()).slice(0, 16).join('');
        const client = clientRef.current;
        const room = await client.create<unknown>('duel_26', {
          nickname: trimmedNickname,
          password,
          ranked: password ? false : ranked,
          publicListing: password ? false : publicListing,
          themeId,
          showOfferHistory,
        });

        if (currentEpoch !== epochRef.current) {
          isConnectingRef.current = false;
          room.leave(false);
          return;
        }

        roomRef.current = room;
        setConnectionStatus('connected');
        isConnectingRef.current = false;

        saveStoredSession({
          roomId: room.roomId,
          matchId: '',
          token: room.reconnectionToken,
        });

        attachRoomListeners(room, currentEpoch);

        // Proactively request snapshot to avoid initial packet race
        room.send('request_snapshot');
      } catch (err: any) {
        isConnectingRef.current = false;
        if (currentEpoch !== epochRef.current) return;
        setConnectionStatus('failed');
        const message = err?.message?.includes('Invalid room password')
          ? '房间密码不正确'
          : err?.message?.includes('Duel room passwords require') || err?.message?.includes('Private duel rooms require')
            ? '私密房密码至少需要 4 个字符'
            : err?.message || '创建房间失败，请稍后重试';
        setError(message);
      }
    },
    [attachRoomListeners, cleanUpOldRoom]
  );

  // Join room by ID (Case sensitive room ID preserved, no toUpperCase!)
  const joinRoom = useCallback(
    async (roomId: string, nickname: string, password?: string) => {
      if (!roomId || isConnectingRef.current) return;
      cleanUpOldRoom();
      isConnectingRef.current = true;
      setConnectionStatus('connecting');
      setError(null);

      const currentEpoch = ++epochRef.current;

      try {
        await ensureDuelGuestSession();
        if (currentEpoch !== epochRef.current) {
          isConnectingRef.current = false;
          return;
        }

        const cleanRoomId = roomId.trim();
        const trimmedNickname = Array.from(nickname.trim()).slice(0, 16).join('');
        const client = clientRef.current;
        const room = await client.joinById<unknown>(cleanRoomId, {
          nickname: trimmedNickname,
          password,
        });

        if (currentEpoch !== epochRef.current) {
          isConnectingRef.current = false;
          room.leave(false);
          return;
        }

        roomRef.current = room;
        setConnectionStatus('connected');
        isConnectingRef.current = false;

        saveStoredSession({
          roomId: room.roomId,
          matchId: '',
          token: room.reconnectionToken,
        });

        attachRoomListeners(room, currentEpoch);

        // Proactively request snapshot
        room.send('request_snapshot');
      } catch (err: any) {
        isConnectingRef.current = false;
        if (currentEpoch !== epochRef.current) return;
        setConnectionStatus('failed');
        const message = err?.message?.includes('Invalid room password')
          ? '房间密码不正确'
          : err?.message || '加入房间失败，请核对房间号或网络';
        setError(message);
      }
    },
    [attachRoomListeners, cleanUpOldRoom]
  );

  // Reconnect with stored session token (Direct client.reconnect, NO ensureDuelGuestSession!)
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

      // Update rotated token
      saveStoredSession({
        roomId: room.roomId,
        matchId: session.matchId,
        token: room.reconnectionToken,
      });

      attachRoomListeners(room, currentEpoch);

      // Request snapshot immediately upon reconnection
      room.send('request_snapshot');
      return true;
    } catch {
      isConnectingRef.current = false;
      if (currentEpoch !== epochRef.current) return false;
      setConnectionStatus('failed');
      setError('对局恢复失败（对局可能已过期或服务重启，可尝试再次重试或清理记录）');
      return false;
    }
  }, [attachRoomListeners, cleanUpOldRoom]);

  // Leave room: handles WAITING vs ACTIVE MATCH
  const leaveRoom = useCallback(
    async (confirmed = false): Promise<boolean> => {
      const room = roomRef.current;
      const authority = authorityRef.current;

      if (!room) {
        clearStoredSession();
        setConnectionStatus('disconnected');
        return true;
      }

      const phase = authority?.public.phase ?? presentationRef.current.phase;
      const isActiveMatch = phase !== 'WAITING' && phase !== 'FINISHED';

      // If active match, requires explicit confirmed leave (forfeit!)
      if (isActiveMatch) {
        if (!confirmed) {
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
              setPresentation(createInitialDuelPresentationState(epochRef.current));
            }
            resolve(success);
          };

          const timeoutTimer = setTimeout(() => {
            if (!resolved) {
              setError('离开对决请求未收到服务器响应，请检查网络连接');
              finishLeave(false);
            }
          }, 8000);

          leaveResolverRef.current = finishLeave;

          const sent = sendCommand('LEAVE');
          if (!sent) {
            finishLeave(false);
            return;
          }

          leaveIdempotencyKeyRef.current = pendingCommandRef.current?.cmd.idempotencyKey ?? null;
        });
      }

      // In WAITING or FINISHED: safe exit
      try {
        room.removeAllListeners();
        await room.leave(true);
      } catch {
        // ignore
      }

      clearStoredSession();
      clearPendingLock();
      roomRef.current = null;
      setConnectionStatus('disconnected');
      setAuthoritySnapshot(null);
      setPresentation(createInitialDuelPresentationState(epochRef.current));
      return true;
    },
    [sendCommand]
  );

  // Discard stored session explicitly
  const discardStoredSession = useCallback(() => {
    clearStoredSession();
    clearPendingLock();
    setError(null);
    setConnectionStatus('disconnected');
  }, []);

  // Cleanup on unmount: DO NOT call consented leave!
  useEffect(() => {
    return () => {
      epochRef.current++;
      clearPendingTimeout();
      cleanUpOldRoom();
    };
  }, [cleanUpOldRoom]);

  // Derived state helpers
  const mySeatId: DuelSeatId | null = authoritySnapshot?.private.seatId ?? null;
  const mySeatInfo =
    mySeatId !== null && authoritySnapshot?.public.seats
      ? authoritySnapshot.public.seats[mySeatId]
      : null;
  const myRole: DuelRole | null = mySeatInfo?.role ?? null;

  return {
    presentation,
    authority: authoritySnapshot,
    publicState: authoritySnapshot?.public ?? null,
    privateState: authoritySnapshot?.private ?? null,
    connectionStatus,
    isPending,
    isPendingUnconfirmed,
    error,
    serverTimeOffset,
    latencyMs,
    deadlineTimestamp,
    serverNow,
    mySeatId,
    myRole,
    storedSession,
    hasStoredSession: Boolean(storedSession),
    createRoom,
    joinRoom,
    reconnectStoredSession,
    discardStoredSession,
    sendCommand,
    retransmitPendingCommand,
    handleBoxClick,
    handleBoxAnimationComplete,
    leaveRoom,
    clearError: () => setError(null),
  };
}
