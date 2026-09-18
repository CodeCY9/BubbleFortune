import React, { useState, useEffect, useRef } from 'react';
import {
  Volume2,
  VolumeX,
  Settings,
  History,
  LogOut,
  Copy,
  Check,
  Eye,
  Clock,
  Sparkles,
  Users,
} from 'lucide-react';
import type { AuctionPhase } from '../../packages/protocol/src/auction';
import { soundManager } from '../utils/audio';
import { translate, translateLobby, useLanguage } from '../i18n';

interface AuctionHeaderProps {
  roomId: string;
  roundIndex: number;
  totalRounds: number;
  challengerNickname?: string;
  phase: AuctionPhase;
  deadlineTimestamp: number | null;
  serverNow: number;
  serverTimeOffset: number;
  latencyMs: number | null;
  spectatorCount: number;
  soundEnabled: boolean;
  onToggleSound: () => void;
  onOpenSettings: () => void;
  onOpenHistory: () => void;
  onLeave: () => void;
  isSpectator: boolean;
}

export function formatPhaseText(phase: AuctionPhase, language: ReturnType<typeof useLanguage> = 'zh-CN'): string {
  const keyByPhase: Record<AuctionPhase, Parameters<typeof translate>[0]> = {
    WAITING: 'auction.phase.waiting',
    SELECTING: 'auction.phase.selecting',
    OPENING: 'auction.phase.opening',
    BIDDING: 'auction.phase.bidding',
    OFFERING: 'auction.phase.offering',
    FINAL_SWAP: 'auction.phase.finalSwap',
    ROUND_COMPLETE: 'auction.phase.roundComplete',
    FINISHED: 'auction.phase.finished',
  };
  return translate(keyByPhase[phase], language);
}

export const AuctionHeader: React.FC<AuctionHeaderProps> = ({
  roomId,
  roundIndex,
  totalRounds,
  challengerNickname,
  phase,
  deadlineTimestamp,
  serverTimeOffset,
  latencyMs,
  spectatorCount,
  soundEnabled,
  onToggleSound,
  onOpenSettings,
  onOpenHistory,
  onLeave,
  isSpectator,
}) => {
  const [copied, setCopied] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const lastCountdownCue = useRef<number | null>(null);
  const language = useLanguage();

  // Synchronized countdown timer
  useEffect(() => {
    if (!deadlineTimestamp) {
      setRemainingSeconds(null);
      return;
    }

    const updateTimer = () => {
      const currentServerTime = Date.now() + serverTimeOffset;
      const diff = Math.max(0, Math.ceil((deadlineTimestamp - currentServerTime) / 1000));
      setRemainingSeconds(diff);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 500);
    return () => clearInterval(interval);
  }, [deadlineTimestamp, serverTimeOffset]);

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

  const handleCopyLink = () => {
    const url = `${window.location.origin}/auction?room=${encodeURIComponent(roomId)}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <header
      className="auction-header glass-panel"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 16px',
        borderBottom: '1.5px solid rgba(245, 158, 11, 0.25)',
        background: 'rgba(17, 13, 36, 0.95)',
        gap: '12px',
        flexWrap: 'wrap',
        minHeight: '56px',
        boxSizing: 'border-box',
        zIndex: 20,
      }}
    >
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
        {formatPhaseText(phase, language)}
        {remainingSeconds !== null ? ` ${remainingSeconds}s` : ''}
      </div>
      {/* Left: Brand & Room ID */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Sparkles size={18} color="#f59e0b" />
          <span style={{ fontWeight: 900, color: '#fcd34d', fontSize: '1.1rem', letterSpacing: '0.5px' }}>
            {translate('auction.brand', language)}
          </span>
        </div>

        <button
          type="button"
          onClick={handleCopyLink}
          title={translate('auction.copyInvite', language)}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            padding: '4px 10px',
            borderRadius: '8px',
            background: 'rgba(0, 0, 0, 0.4)',
            border: '1px solid rgba(245, 158, 11, 0.3)',
            color: '#fcd34d',
            fontFamily: 'monospace',
            fontSize: '0.85rem',
            cursor: 'pointer',
          }}
        >
          <span>{roomId}</span>
          {copied ? <Check size={14} color="#10b981" /> : <Copy size={14} />}
        </button>

        {spectatorCount > 0 && (
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '0.75rem',
              color: '#67e8f9',
              background: 'rgba(6, 182, 212, 0.15)',
              padding: '3px 8px',
              borderRadius: '6px',
            }}
          >
            <Eye size={12} />
            <span>{translate('auction.spectators', language).replace('{count}', String(spectatorCount))}</span>
          </div>
        )}
      </div>

      {/* Center: Match Round & Phase Status */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          background: 'rgba(0, 0, 0, 0.35)',
          padding: '6px 14px',
          borderRadius: '10px',
          border: '1px solid rgba(255, 255, 255, 0.08)',
        }}
      >
        <div style={{ fontSize: '0.85rem', color: '#9ca3af' }}>
          {translate('auction.round', language).replace('{current}', String(roundIndex + 1)).replace('{total}', String(totalRounds))}
        </div>

        {challengerNickname && (
          <div style={{ fontSize: '0.85rem', color: '#e5e7eb' }}>
            {translate('auction.challenger', language).replace('{name}', '')}<strong style={{ color: '#67e8f9' }}>{challengerNickname}</strong>
          </div>
        )}

        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '0.85rem',
            color: '#ffffff',
            fontWeight: 700,
            padding: '2px 8px',
            borderRadius: '6px',
            background: 'rgba(245, 158, 11, 0.2)',
          }}
        >
          <span>{formatPhaseText(phase, language)}</span>
          {remainingSeconds !== null && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '2px',
                color: remainingSeconds <= 5 ? '#f87171' : '#fcd34d',
                fontWeight: 800,
                fontFamily: 'monospace',
              }}
            >
              <Clock size={13} />
              {remainingSeconds}s
            </span>
          )}
        </div>
      </div>

      {/* Right: Controls & Actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span
          role="status"
          aria-label={latencyMs === null ? translate('duel.latencyUnknown', language) : translate('auction.latencyAria', language).replace('{value}', `${latencyMs} ms`)}
          style={{ color: latencyMs !== null && latencyMs > 180 ? '#fca5a5' : '#9ca3af', fontSize: '0.72rem' }}
        >
          {translate('auction.latency', language).replace('{value}', latencyMs === null ? '—' : `${latencyMs} ms`)}
        </span>
        <button
          type="button"
          onClick={onToggleSound}
          aria-label={soundEnabled ? translate('auction.soundOn', language) : translate('auction.soundOff', language)}
          className="btn-secondary"
          style={{ minHeight: '36px', minWidth: '36px', padding: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          {soundEnabled ? <Volume2 size={18} /> : <VolumeX size={18} color="#9ca3af" />}
        </button>

        <button
          type="button"
          onClick={onOpenHistory}
          aria-label={translate('auction.history', language)}
          className="btn-secondary"
          style={{ minHeight: '36px', minWidth: '36px', padding: '6px 10px', display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.8rem' }}
        >
          <History size={16} />
          <span>{translateLobby('history', language)}</span>
        </button>

        <button
          type="button"
          onClick={onOpenSettings}
          aria-label={translate('auction.settings', language)}
          className="btn-secondary"
          style={{ minHeight: '36px', minWidth: '36px', padding: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <Settings size={18} />
        </button>

        <button
          type="button"
          onClick={onLeave}
          aria-label={translate('auction.leave', language)}
          className="btn-secondary"
          style={{ minHeight: '36px', padding: '6px 12px', fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#fca5a5' }}
        >
          <LogOut size={16} />
          <span>{translate('duel.leave', language)}</span>
        </button>
      </div>
    </header>
  );
};
