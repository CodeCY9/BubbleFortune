import React, { useEffect, useRef, useState } from 'react';
import { Volume2, VolumeX, Clock, User, Zap, RefreshCw, Wifi, WifiOff, Settings, History, ShieldCheck, Home, LogOut } from 'lucide-react';
import type { ConnectionStatus } from '../hooks/useGameState';
import { soundManager } from '../utils/audio';
import { translate, useLanguage } from '../i18n';

interface HeaderProps {
  soundEnabled: boolean;
  fastMode: boolean;
  onToggleSound: () => void;
  onToggleFastMode: () => void;
  onRestartGame: () => void;
  onOpenSettings?: () => void;
  onOpenHistory?: () => void;
  onOpenFairness?: () => void;
  onReturnToLobby?: () => void;
  onForfeitGame?: () => void;
  playerBoxId: number | null;
  playerBoxValue?: number;
  isGameOver: boolean;
  currentRound?: number;
  deadlineTimestamp?: number | null;
  serverNow?: number;
  serverTimeOffset?: number;
  latencyMs?: number | null;
  connectionStatus?: ConnectionStatus;
  onRetryConnection?: () => void;
  isPending?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  soundEnabled,
  fastMode,
  onToggleSound,
  onToggleFastMode,
  onRestartGame,
  onOpenSettings,
  onOpenHistory,
  onOpenFairness,
  onReturnToLobby,
  onForfeitGame,
  isGameOver,
  currentRound = 1,
  deadlineTimestamp = null,
  serverTimeOffset = 0,
  latencyMs = null,
  connectionStatus = 'connected',
  onRetryConnection,
  isPending = false,
}) => {
  const language = useLanguage();
  const msg = (key: Parameters<typeof translate>[0], replacements: Record<string, string | number> = {}) =>
    Object.entries(replacements).reduce(
      (text, [name, value]) => text.replace(new RegExp(`\\{${name}\\}`, 'g'), String(value)),
      translate(key, language),
    );
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const lastCountdownCue = useRef<number | null>(null);

  useEffect(() => {
    if (deadlineTimestamp === null || isGameOver) {
      setRemainingSeconds(null);
      return;
    }

    const updateTimer = () => {
      const now = Date.now() + serverTimeOffset;
      const diffMs = deadlineTimestamp - now;
      if (diffMs <= 0) {
        setRemainingSeconds(0);
      } else {
        setRemainingSeconds(Math.ceil(diffMs / 1000));
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 200);
    return () => clearInterval(interval);
  }, [deadlineTimestamp, serverTimeOffset, isGameOver]);

  useEffect(() => {
    if (remainingSeconds === null || remainingSeconds > 5) {
      lastCountdownCue.current = null;
      return;
    }
    if (soundEnabled && remainingSeconds >= 1 && lastCountdownCue.current !== remainingSeconds) {
      soundManager.playCountdownWarning(remainingSeconds);
      lastCountdownCue.current = remainingSeconds;
    }
  }, [remainingSeconds, soundEnabled]);

  return (
    <header className="game-header">
      <div
        aria-live="polite"
        aria-atomic="true"
        style={{
          position: 'absolute',
          width: '1px',
          height: '1px',
          padding: 0,
          margin: '-1px',
          overflow: 'hidden',
          clip: 'rect(0, 0, 0, 0)',
          whiteSpace: 'nowrap',
          border: 0,
        }}
      >
        {connectionStatus === 'connected' && msg('header.connected')}
        {(connectionStatus === 'connecting' || connectionStatus === 'reconnecting') && msg('header.reconnecting')}
        {(connectionStatus === 'disconnected' || connectionStatus === 'failed') && msg('header.disconnected')}
        {remainingSeconds !== null && (remainingSeconds === 0 ? msg('header.waitingServer') : msg('header.countdown') + ` ${remainingSeconds}`)}
      </div>
      {/* Desktop Layout (preserved verbatim, visible on >=1024px) */}
      <div className="header-desktop hide-mobile">
        {/* Left: Brand & Mode/Round */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline' }}>
            <h1
              style={{
                fontSize: '1.25rem',
                fontWeight: 900,
                background: 'linear-gradient(90deg, #06B6D4, #8B5CF6)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                letterSpacing: '0.5px',
                margin: 0,
              }}
            >
              BubbleFortune
            </h1>
            <span style={{ fontSize: '0.9rem', color: '#9CA3AF', fontWeight: 600, marginLeft: '8px' }}>
              - {msg('header.brandTag')} -
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ color: '#9CA3AF', fontSize: '0.9rem' }}>
              {msg('header.round', { round: currentRound })}
            </div>
          </div>

          {/* Network status pill */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {connectionStatus === 'connected' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#10b981', fontSize: '0.75rem' }}>
                <Wifi size={13} />
                <span>{msg('header.connected')}</span>
                <span style={{ color: latencyMs !== null && latencyMs > 180 ? '#fca5a5' : '#9ca3af' }}>
                  · {msg('header.latency', { value: latencyMs === null ? '—' : `${latencyMs} ms` })}
                </span>
              </div>
            )}
            {(connectionStatus === 'connecting' || connectionStatus === 'reconnecting') && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#f59e0b', fontSize: '0.75rem' }}>
                <RefreshCw size={13} className="spin" />
                <span>{connectionStatus === 'reconnecting' ? `${msg('header.reconnecting')}...` : `${msg('header.connecting')}...`}</span>
              </div>
            )}
            {(connectionStatus === 'disconnected' || connectionStatus === 'failed') && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ color: '#ef4444', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <WifiOff size={13} />
                  <span>{connectionStatus === 'failed' ? msg('header.failed') : msg('header.disconnected')}</span>
                </span>
                {onRetryConnection && (
                  <button
                    onClick={onRetryConnection}
                    style={{
                      padding: '2px 8px',
                      borderRadius: '10px',
                      background: 'rgba(239, 68, 68, 0.2)',
                      border: '1px solid rgba(239, 68, 68, 0.4)',
                      color: '#f87171',
                      fontSize: '0.7rem',
                      cursor: 'pointer',
                    }}
                  >
                    {msg('header.retry')}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Center: Authoritative Server Deadline Timer */}
        <div
          style={{
            position: 'absolute',
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            background: 'rgba(0, 0, 0, 0.4)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            padding: '6px 16px',
            borderRadius: '20px',
          }}
        >
          <Clock size={16} color="#9CA3AF" />
          <span style={{ fontSize: '0.85rem', color: '#9CA3AF' }}>{msg('header.countdown')}</span>
          {remainingSeconds === null ? (
            <span style={{ fontSize: '0.9rem', color: '#9CA3AF', fontFamily: 'var(--font-mono)' }}>--:--</span>
          ) : remainingSeconds === 0 ? (
            <span style={{ fontSize: '0.85rem', color: '#ef4444', fontWeight: 700 }}>{msg('header.waitingServer')}</span>
          ) : (
            <span style={{ fontSize: '1rem', color: '#FACC15', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
              {`00:${String(remainingSeconds).padStart(2, '0')}`}
            </span>
          )}
        </div>

        {/* Right: Controls & Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button
            aria-label={fastMode ? msg('header.fast.disable') : msg('header.fast.enable')}
            onClick={onToggleFastMode}
            title={fastMode ? msg('header.fast.title') : msg('header.normal.title')}
            style={{
              background: fastMode ? 'rgba(250, 204, 21, 0.15)' : 'rgba(255, 255, 255, 0.05)',
              border: fastMode ? '1px solid rgba(250, 204, 21, 0.4)' : '1px solid rgba(255, 255, 255, 0.1)',
              color: fastMode ? '#FACC15' : '#9CA3AF',
              padding: '4px 10px',
              borderRadius: '12px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '0.8rem',
              fontWeight: 700,
            }}
          >
            <Zap size={14} />
            <span>{fastMode ? msg('header.fast.label') : msg('header.normal.label')}</span>
          </button>

          <button
            aria-label={soundEnabled ? msg('header.sound.disable') : msg('header.sound.enable')}
            onClick={onToggleSound}
            style={{ background: 'transparent', border: 'none', color: '#9CA3AF', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
          >
            {soundEnabled ? <Volume2 size={20} /> : <VolumeX size={20} />}
          </button>

          <button
            onClick={onRestartGame}
            disabled={connectionStatus === 'connecting' || connectionStatus === 'reconnecting'}
            aria-label={msg('header.restart')}
            title={msg('header.restart')}
            style={{
              background: 'transparent',
              border: 'none',
              color:
                connectionStatus === 'connecting' || connectionStatus === 'reconnecting'
                  ? '#4b5563'
                  : '#9CA3AF',
              cursor:
                connectionStatus === 'connecting' || connectionStatus === 'reconnecting'
                  ? 'not-allowed'
                  : 'pointer',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <RefreshCw size={18} />
          </button>

          {onOpenHistory && (
            <button
              onClick={onOpenHistory}
              aria-label={msg('header.history')}
              title={msg('header.history')}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#9CA3AF',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <History size={18} />
            </button>
          )}

          {onOpenFairness && (
            <button
              onClick={onOpenFairness}
              aria-label={msg('header.fairness')}
              title={msg('header.fairness')}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#9CA3AF',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <ShieldCheck size={18} />
            </button>
          )}

          {onOpenSettings && (
            <button
              onClick={onOpenSettings}
              aria-label={msg('header.settings')}
              title={msg('header.settings')}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#9CA3AF',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <Settings size={18} />
            </button>
          )}

          {onReturnToLobby && (
            <button
              type="button"
              onClick={isGameOver ? onReturnToLobby : (onForfeitGame ?? onReturnToLobby)}
              aria-label={isGameOver ? msg('header.returnLobby') : msg('header.forfeit')}
              title={isGameOver ? msg('header.returnLobby') : msg('header.forfeit')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '5px 12px',
                borderRadius: '12px',
                cursor: 'pointer',
                fontSize: '0.8rem',
                fontWeight: 700,
                transition: 'all 0.2s ease',
                background: isGameOver ? 'rgba(250, 204, 21, 0.14)' : 'rgba(239, 68, 68, 0.14)',
                border: isGameOver ? '1px solid rgba(250, 204, 21, 0.4)' : '1px solid rgba(239, 68, 68, 0.4)',
                color: isGameOver ? '#fde047' : '#fca5a5',
              }}
            >
              {isGameOver ? <Home size={15} /> : <LogOut size={15} />}
              <span>{isGameOver ? msg('header.returnLobby') : msg('header.forfeit')}</span>
            </button>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(255,255,255,0.05)', padding: '4px 12px', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.1)' }}>
            <User size={14} color="#9CA3AF" />
            <span style={{ fontSize: '0.85rem', color: '#E5E7EB' }}>{msg('header.mode')}</span>
          </div>
        </div>
      </div>

      {/* Mobile Layout (2 compact rows, >=44px touch targets) */}
      <div className="header-mobile show-mobile">
        {/* Row 1: Brand + Controls (Zap, Sound, Restart) */}
        <div className="header-mobile-row1">
          <h1
            style={{
              fontSize: '1.2rem',
              fontWeight: 900,
              background: 'linear-gradient(90deg, #06B6D4, #8B5CF6)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              letterSpacing: '0.5px',
              margin: 0,
            }}
          >
            BubbleFortune
          </h1>

          <div className="header-mobile-controls">
            <button
              aria-label={fastMode ? msg('header.fast.disable') : msg('header.fast.enable')}
              onClick={onToggleFastMode}
              className={`mobile-header-btn${fastMode ? ' active' : ''}`}
            >
              <Zap size={16} />
              <span>{fastMode ? msg('header.fast.short') : msg('header.normal.short')}</span>
            </button>

            <button
              aria-label={soundEnabled ? msg('header.sound.disable') : msg('header.sound.enable')}
              onClick={onToggleSound}
              className="mobile-header-btn"
            >
              {soundEnabled ? <Volume2 size={20} /> : <VolumeX size={20} />}
            </button>

            <button
              onClick={onRestartGame}
              disabled={connectionStatus === 'connecting' || connectionStatus === 'reconnecting'}
              aria-label={msg('header.restart')}
              className="mobile-header-btn"
            >
              <RefreshCw size={18} />
            </button>

            {onOpenHistory && (
              <button
                onClick={onOpenHistory}
                aria-label={msg('header.history')}
                title={msg('header.history')}
                className="mobile-header-btn"
              >
                <History size={18} />
              </button>
            )}

            {onOpenFairness && (
              <button
                onClick={onOpenFairness}
                aria-label={msg('header.fairness')}
                title={msg('header.fairness')}
                className="mobile-header-btn"
              >
                <ShieldCheck size={18} />
              </button>
            )}

            {onOpenSettings && (
              <button
                onClick={onOpenSettings}
                aria-label={msg('header.settings')}
                className="mobile-header-btn"
              >
                <Settings size={18} />
              </button>
            )}

            {onReturnToLobby && (
              <button
                type="button"
                onClick={isGameOver ? onReturnToLobby : (onForfeitGame ?? onReturnToLobby)}
                aria-label={isGameOver ? msg('header.returnLobby') : msg('header.forfeit')}
                title={isGameOver ? msg('header.returnLobby') : msg('header.forfeit')}
                className="mobile-header-btn"
                style={{
                  color: isGameOver ? '#fde047' : '#fca5a5',
                  borderColor: isGameOver ? 'rgba(250, 204, 21, 0.35)' : 'rgba(239, 68, 68, 0.35)',
                  background: isGameOver ? 'rgba(250, 204, 21, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                }}
              >
                {isGameOver ? <Home size={18} /> : <LogOut size={18} />}
              </button>
            )}
          </div>
        </div>

        {/* Row 2: Round, Countdown Timer, Network & Retry */}
        <div className="header-mobile-row2">
          <div className="header-mobile-round">
            {msg('header.round', { round: currentRound })}
          </div>

          <div className="header-mobile-timer">
            <Clock size={13} color="#9CA3AF" />
            {remainingSeconds === null ? (
              <span>--:--</span>
            ) : remainingSeconds === 0 ? (
              <span style={{ color: '#ef4444', fontWeight: 800 }}>{msg('header.waitingServer')}</span>
            ) : (
              <span style={{ color: '#FACC15', fontWeight: 800, fontFamily: 'var(--font-mono)' }}>
                {`00:${String(remainingSeconds).padStart(2, '0')}`}
              </span>
            )}
          </div>

          <div className="header-mobile-status">
            {connectionStatus === 'connected' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#10b981', fontSize: '0.75rem' }}>
                <Wifi size={13} />
                <span>{msg('header.connected')}</span>
                <span style={{ color: latencyMs !== null && latencyMs > 180 ? '#fca5a5' : '#9ca3af' }}>
                  · {msg('header.latency', { value: latencyMs === null ? '—' : `${latencyMs} ms` })}
                </span>
              </div>
            )}
            {(connectionStatus === 'connecting' || connectionStatus === 'reconnecting') && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#f59e0b', fontSize: '0.75rem' }}>
                <RefreshCw size={13} className="spin" />
                <span>{connectionStatus === 'reconnecting' ? msg('header.reconnecting') : msg('header.connecting')}</span>
              </div>
            )}
            {(connectionStatus === 'disconnected' || connectionStatus === 'failed') && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ color: '#ef4444', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '2px' }}>
                  <WifiOff size={13} />
                  <span>{connectionStatus === 'failed' ? msg('header.failed') : msg('header.disconnected')}</span>
                </span>
                {onRetryConnection && (
                  <button onClick={onRetryConnection} className="mobile-header-retry-btn">
                    {msg('header.retry')}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
