import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { useGameState } from './hooks/useGameState';
import { usePreferences } from './hooks/usePreferences';
import { useDialog } from './hooks/useDialog';
import { Header } from './components/Header';
import { LowMoneyLadder, HighMoneyLadder } from './components/MoneyLadder';
import { BankerModal } from './components/BankerModal';
import { FinalSwapModal } from './components/FinalSwapModal';
import { VictoryModal } from './components/VictoryModal';
import { RoomLobby } from './components/RoomLobby';
import { SettingsDialog } from './components/SettingsDialog';
import { PwaNotice } from './components/PwaControls';
import { HistoryModal } from './components/HistoryModal';
import { FairnessModal } from './components/FairnessModal';
import { RankingModal } from './components/RankingModal';
import { ProfileSummaryModal } from './components/ProfileSummaryModal';
import { ReportDialog } from './components/ReportDialog';
import { ForfeitModal } from './components/ForfeitModal';
import { RoundOpeningIndicator } from './components/RoundOpeningIndicator';
import { useTheme } from './themes';
import { Ticker } from './components/Ticker';
import { BoxData, OpenedBoxData, MONEY_VALUES } from './types/game';
import { Sparkles, AlertCircle, RefreshCw, X, Trophy, Home } from 'lucide-react';
import { translate, useLanguage } from './i18n';

// Stage3D lazy loading via React.lazy/Suspense so lobby does not bundle/fetch 3D models upfront
const Stage3D = React.lazy(() => import('./components/Stage3D'));

export function App({ mode = 'classic' }: { mode?: 'classic' | 'challenge' }) {
  const challengeMode = mode === 'challenge';
  const language = useLanguage();
  const msg = (key: Parameters<typeof translate>[0], replacements: Record<string, string | number> = {}) =>
    Object.entries(replacements).reduce(
      (text, [name, value]) => text.replace(new RegExp(`\\{${name}\\}`, 'g'), String(value)),
      translate(key, language),
    );
  const {
    preferences,
    effectiveQuality,
    effectiveReducedMotion,
    updatePreference,
    resetPreferences,
    handleFpsWindow,
  } = usePreferences();

  const { dialogRef, isOpen, openDialog, closeDialog, handleCancel } = useDialog();

  const handleToggleSound = useCallback(() => {
    updatePreference('sound', !preferences.sound);
  }, [preferences.sound, updatePreference]);

  const handleToggleFastMode = useCallback(() => {
    updatePreference('fast', !preferences.fast);
  }, [preferences.fast, updatePreference]);

  const {
    phase,
    boxes,
    playerBoxId,
    currentRound,
    boxesLeftToOpenThisRound,
    bankerOffer,
    currentOfferId,
    settlement,
    lastRevealedBox,
    soundEnabled,
    fastMode,
    deadlineTimestamp,
    serverNow,
    serverTimeOffset,
    latencyMs,
    connectionStatus,
    isPending,
    error,
    gameId,
    epoch,
    aiType,
    offerHistory,
    toggleSound,
    toggleFastMode,
    startGame,
    startNewGame,
    returnToLobby,
    isLobbyVisible,
    ruleVersion,
    challenge,
    selectPlayerBox,
    openBox,
    completeOpenBox,
    openingBoxId,
    acceptDeal,
    rejectDeal,
    resolveFinalSwap,
    useInquiry,
    buyInsurance,
    declineRaise,
    retryConnection,
    retryPendingCommand,
    clearError,
  } = useGameState({
    roomName: challengeMode ? 'challenge_26' : 'classic_26',
    soundEnabled: preferences.sound,
    fastMode: preferences.fast,
    onToggleSound: handleToggleSound,
    onToggleFastMode: handleToggleFastMode,
  });

  const { theme, setTheme } = useTheme(effectiveQuality);
  const [mobileTab, setMobileTab] = useState<'LOW' | 'HIGH'>('HIGH');
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isRankingOpen, setIsRankingOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [reportTarget, setReportTarget] = useState<{
    targetType: string;
    targetId: string;
    targetDescription?: string;
  } | null>(null);
  const [isFairnessOpen, setIsFairnessOpen] = useState(false);
  const [victoryDismissed, setVictoryDismissed] = useState(false);
  const [screenShakeActive, setScreenShakeActive] = useState(false);
  const [isForfeitModalOpen, setIsForfeitModalOpen] = useState(false);

  const handleForfeitRequest = useCallback(() => {
    if (phase === 'GAME_OVER') {
      returnToLobby(true);
    } else {
      setIsForfeitModalOpen(true);
    }
  }, [phase, returnToLobby]);

  const handleConfirmForfeit = useCallback(() => {
    setIsForfeitModalOpen(false);
    returnToLobby(true);
  }, [returnToLobby]);

  // Idle preloader: preload Stage3D chunk and 3D models into browser cache during lobby idle time
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const scheduleIdle = (window as any).requestIdleCallback || ((fn: () => void) => setTimeout(fn, 600));
    const cancelIdle = (window as any).cancelIdleCallback || clearTimeout;
    const handle = scheduleIdle(() => {
      // 1. Dynamic import Stage3D bundle so Three.js & Stage3D chunk are warm in memory
      import('./components/Stage3D').then((mod) => {
        if (typeof (mod as any).preloadStageAssets === 'function') {
          (mod as any).preloadStageAssets();
        }
      }).catch(() => {});

      // 2. Pre-fetch GLB model files into browser HTTP cache
      const glbUrls = [
        '/assets/models/runtime/BF_Briefcase_v009.glb',
        '/assets/models/runtime/BF_Briefcase_v009_low.glb',
        '/assets/models/runtime/BF_DisplayStage_26_v007.glb',
      ];
      glbUrls.forEach((url) => {
        fetch(url, { priority: 'low' } as any).catch(() => {});
      });
    });

    return () => {
      cancelIdle(handle);
    };
  }, []);

  // Global ESC key listener during active gameplay
  useEffect(() => {
    if (phase === 'MODE_SELECT' || isLobbyVisible) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isForfeitModalOpen) {
          setIsForfeitModalOpen(false);
        } else if (phase === 'GAME_OVER') {
          returnToLobby(true);
        } else {
          setIsForfeitModalOpen(true);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [phase, isLobbyVisible, isForfeitModalOpen, returnToLobby]);

  useEffect(() => {
    if (!preferences.screenShake || openingBoxId === null) {
      setScreenShakeActive(false);
      return;
    }
    setScreenShakeActive(true);
    const timer = window.setTimeout(() => setScreenShakeActive(false), 320);
    return () => window.clearTimeout(timer);
  }, [openingBoxId, preferences.screenShake]);

  const currentRecord = useMemo(() => settlement && gameId && ruleVersion
    ? { gameId, ruleVersion, settlement, auditTrail: settlement.auditTrail }
    : null, [settlement, gameId, ruleVersion]);

  const handleBoxAnimationComplete = useCallback((boxId: number) => {
    completeOpenBox(boxId);
    if (preferences.haptics && typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try { navigator.vibrate(18); } catch { /* haptics are optional */ }
    }
  }, [completeOpenBox, preferences.haptics]);

  const [finalRevealStage, setFinalRevealStage] = useState<'IDLE' | 'PROMPT_CLICK' | 'OPENING' | 'REVEALED' | 'DONE'>('IDLE');
  const [finalTargetBoxId, setFinalTargetBoxId] = useState<number | null>(null);
  const [finalOpeningBoxId, setFinalOpeningBoxId] = useState<number | null>(null);

  // Automatically show victory modal when GAME_OVER is entered (unless waiting for manual final reveal)
  useEffect(() => {
    if (phase === 'GAME_OVER') {
      if (finalRevealStage === 'IDLE' || finalRevealStage === 'DONE') {
        setVictoryDismissed(false);
      }
    } else {
      setFinalRevealStage('IDLE');
      setFinalTargetBoxId(null);
      setFinalOpeningBoxId(null);
    }
  }, [phase, finalRevealStage]);

  const playerBox = boxes.find((b) => b.id === playerBoxId) || null;
  const remainingBox = boxes.find((b) => !b.isOpened && !b.isPlayerBox) || null;
  const openedBoxes = boxes.filter((b): b is OpenedBoxData => b.isOpened);
  const showMobileDrawer = !challengeMode && (phase === 'CHOOSE_PLAYER_BOX' || phase === 'OPEN_BOXES');

  const [showFinalSwapModal, setShowFinalSwapModal] = useState(false);

  useEffect(() => {
    if (phase === 'FINAL_SWAP') {
      const delay = effectiveReducedMotion || preferences.fast ? 250 : 1200;
      const timer = window.setTimeout(() => {
        setShowFinalSwapModal(true);
      }, delay);
      return () => window.clearTimeout(timer);
    } else {
      setShowFinalSwapModal(false);
    }
  }, [phase, effectiveReducedMotion, preferences.fast]);

  const remainingAmounts = useMemo(() => {
    if (phase !== 'FINAL_SWAP') return [];
    const openedSet = new Set(boxes.filter((b): b is OpenedBoxData => b.isOpened).map((b) => b.value));
    return MONEY_VALUES.filter((v) => !openedSet.has(v));
  }, [boxes, phase]);

  const handleResolveFinalSwap = useCallback((swap: boolean) => {
    const targetId = swap ? (remainingBox?.id ?? null) : (playerBox?.id ?? null);
    setFinalTargetBoxId(targetId);
    setFinalRevealStage('PROMPT_CLICK');
    setShowFinalSwapModal(false);
    setVictoryDismissed(true);
    resolveFinalSwap(swap);
  }, [remainingBox, playerBox, resolveFinalSwap]);

  const handleStartFinalBoxOpen = useCallback(() => {
    if (finalRevealStage !== 'PROMPT_CLICK' || !finalTargetBoxId) return;
    setFinalRevealStage('OPENING');
    setFinalOpeningBoxId(finalTargetBoxId);
  }, [finalRevealStage, finalTargetBoxId]);

  const handleStageBoxAnimationComplete = useCallback((boxId: number) => {
    if (finalRevealStage === 'OPENING' && boxId === finalTargetBoxId) {
      setFinalRevealStage('REVEALED');
      setFinalOpeningBoxId(null);
      const delay = preferences.fast || effectiveReducedMotion ? 350 : 1300;
      window.setTimeout(() => {
        setFinalRevealStage('DONE');
        setVictoryDismissed(false);
      }, delay);
    } else {
      handleBoxAnimationComplete(boxId);
    }
  }, [finalRevealStage, finalTargetBoxId, handleBoxAnimationComplete, preferences.fast, effectiveReducedMotion]);

  const displayBoxes: BoxData[] = useMemo(() => {
    if (!settlement || !finalTargetBoxId || finalRevealStage === 'IDLE') return boxes;

    return boxes.map((b) => {
      if (b.id === finalTargetBoxId) {
        if (finalRevealStage === 'REVEALED' || finalRevealStage === 'DONE') {
          return {
            ...b,
            isOpened: true as const,
            value: settlement.wonAmount,
            revealedAmount: settlement.wonAmount,
          };
        }
        return b;
      }
      if (!b.isOpened && b.id !== finalTargetBoxId) {
        const boxAmount = settlement.allBoxes?.find((ab) => ab.id === b.id)?.amount;
        if (boxAmount !== undefined && (finalRevealStage === 'REVEALED' || finalRevealStage === 'DONE')) {
          return {
            ...b,
            isOpened: true as const,
            value: boxAmount,
            revealedAmount: boxAmount,
          };
        }
      }
      return b;
    });
  }, [boxes, settlement, finalTargetBoxId, finalRevealStage]);

  const finalRevealPrompt = useMemo(() => {
    if (finalRevealStage === 'PROMPT_CLICK' && finalTargetBoxId) {
      return msg('final.promptClick', { box: finalTargetBoxId });
    }
    if (finalRevealStage === 'OPENING' || finalRevealStage === 'REVEALED') {
      return msg('final.revealing');
    }
    return null;
  }, [finalRevealStage, finalTargetBoxId, msg]);

  const settingsDialogElement = (
    <SettingsDialog
      dialogRef={dialogRef}
      isOpen={isOpen}
      onClose={closeDialog}
      onCancel={handleCancel}
      preferences={preferences}
      effectiveQuality={effectiveQuality}
      effectiveReducedMotion={effectiveReducedMotion}
      onUpdatePreference={updatePreference}
      onResetPreferences={resetPreferences}
      deadlineTimestamp={deadlineTimestamp}
      serverTimeOffset={serverTimeOffset}
      isGameOver={phase === 'GAME_OVER'}
      phase={phase}
      theme={theme}
      onSelectTheme={setTheme}
    />
  );

  if (phase === 'MODE_SELECT' || isLobbyVisible) {
    return (
      <>
        <RoomLobby
          mode={mode}
          onStartGame={startGame}
          onStartSinglePlayer={() => startGame('conservative')}
          onOpenSettings={openDialog}
          onOpenHistory={() => setIsHistoryOpen(true)}
          onOpenRanking={() => setIsRankingOpen(true)}
          onOpenProfile={() => setIsProfileOpen(true)}
          connectionStatus={connectionStatus}
          onRetryConnection={retryConnection}
          isPending={isPending}
          errorMessage={error}
        />
        {settingsDialogElement}
        <PwaNotice onOpenSettings={openDialog} />
        <HistoryModal
          isOpen={isHistoryOpen}
          onClose={() => setIsHistoryOpen(false)}
        />
        <RankingModal
          isOpen={isRankingOpen}
          onClose={() => setIsRankingOpen(false)}
        />
        <ProfileSummaryModal
          isOpen={isProfileOpen}
          onClose={() => setIsProfileOpen(false)}
        />
        {reportTarget && (
          <ReportDialog
            isOpen={Boolean(reportTarget)}
            onClose={() => setReportTarget(null)}
            targetType={reportTarget.targetType}
            targetId={reportTarget.targetId}
            targetDescription={reportTarget.targetDescription}
          />
        )}
      </>
    );
  }

  return (
    <div
      className={`game-shell${screenShakeActive ? ' screen-shake-active' : ''}`}
      style={{
        width: '100vw',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        overflow: 'hidden',
        background: 'var(--bg-stage)',
      }}
    >
      <Header
        soundEnabled={soundEnabled}
        fastMode={fastMode}
        onToggleSound={toggleSound}
        onToggleFastMode={toggleFastMode}
        onRestartGame={() => startGame(aiType)}
        onOpenSettings={openDialog}
        onOpenHistory={() => setIsHistoryOpen(true)}
        onOpenFairness={phase === 'GAME_OVER' && currentRecord ? () => setIsFairnessOpen(true) : undefined}
        onReturnToLobby={() => returnToLobby(true)}
        onForfeitGame={handleForfeitRequest}
        playerBoxId={playerBoxId}
        playerBoxValue={playerBox && playerBox.isOpened ? playerBox.value : undefined}
        isGameOver={phase === 'GAME_OVER'}
        currentRound={currentRound}
        deadlineTimestamp={deadlineTimestamp}
        serverNow={serverNow}
        serverTimeOffset={serverTimeOffset}
        latencyMs={latencyMs}
        connectionStatus={connectionStatus}
        onRetryConnection={retryConnection}
        isPending={isPending}
      />

      {/* In-game Error Banner with Dismiss & Retry */}
      {error && (
        <div
          role="alert"
          style={{
            position: 'absolute',
            top: 'calc(var(--header-height, 60px) + 8px)',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 100,
            background: 'rgba(239, 68, 68, 0.95)',
            border: '1px solid rgba(254, 202, 202, 0.5)',
            color: '#ffffff',
            padding: '8px 18px',
            borderRadius: '16px',
            boxShadow: '0 8px 30px rgba(0, 0, 0, 0.6)',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            maxWidth: '92%',
            fontSize: '0.85rem',
            backdropFilter: 'blur(12px)',
          }}
        >
          <AlertCircle size={18} style={{ flexShrink: 0, color: '#fef08a' }} />
          <span style={{ fontWeight: 600 }}>{error}</span>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginLeft: 'auto' }}>
            <button
              onClick={() => {
                if (connectionStatus === 'connected') {
                  retryPendingCommand();
                } else {
                  retryConnection();
                }
              }}
              disabled={connectionStatus === 'connecting' || connectionStatus === 'reconnecting'}
              style={{
                padding: '3px 10px',
                borderRadius: '8px',
                background: '#ffffff',
                color: '#ef4444',
                border: 'none',
                fontWeight: 700,
                fontSize: '0.75rem',
                cursor:
                  connectionStatus === 'connecting' || connectionStatus === 'reconnecting'
                    ? 'not-allowed'
                    : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
              }}
            >
              <RefreshCw size={12} />
              <span>{msg('game.retry')}</span>
            </button>
            <button
              onClick={clearError}
              aria-label={msg('game.dismissError')}
              style={{
                padding: '3px 6px',
                borderRadius: '8px',
                background: 'rgba(0, 0, 0, 0.25)',
                color: '#ffffff',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Opening curtain is skipped when reducedMotion is active */}
      {!effectiveReducedMotion && (
        <div className="opening-curtain" key={`curtain_${epoch}`} aria-hidden="true">
          <div className="opening-curtain-panel opening-curtain-left" />
          <div className="opening-curtain-panel opening-curtain-right" />
        </div>
      )}

      <div
        style={{
          flex: 1,
          display: 'flex',
          width: '100%',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', width: '100%', height: '100%' }}>
          {/* Left Column */}
          {!challengeMode && <div className="desktop-sidebars" style={{ width: '220px', height: '100%', padding: '16px 0 16px 16px', flexShrink: 0, zIndex: 60 }}>
            <LowMoneyLadder boxes={boxes} playerBoxId={playerBoxId} />
          </div>}

          {/* Center Column */}
          <div
            className={`stage-column${showMobileDrawer ? ' has-mobile-drawer' : ''}`}
            style={{
              flex: 1,
              minWidth: 0,
              minHeight: 0,
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              position: 'relative',
            }}
          >
            {/* Interactive Round Guidance Indicator */}
            <div
              style={{
                position: 'absolute',
                top: '16px',
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: 20,
              }}
            >
              <RoundOpeningIndicator
                phase={phase}
                currentRound={currentRound}
                boxesLeftToOpenThisRound={boxesLeftToOpenThisRound}
                challengeMode={challengeMode}
                challenge={challenge}
                onUseInquiry={useInquiry}
                onBuyInsurance={buyInsurance}
                isPending={isPending}
                connectionStatus={connectionStatus}
                finalRevealPrompt={finalRevealPrompt}
              />
            </div>

            {/* 3D R3F Stage Canvas wrapped in Suspense with rich hologram stage skeleton */}
            <React.Suspense
              fallback={
                <div
                  className="stage-fallback-skeleton"
                  style={{
                    flex: 1,
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    position: 'relative',
                    overflow: 'hidden',
                    background: 'radial-gradient(ellipse at 50% 50%, rgba(41, 33, 79, 0.6) 0%, rgba(21, 18, 47, 0.8) 50%, rgba(8, 9, 23, 0.95) 100%)',
                  }}
                >
                  {/* Glowing Stage Hologram Ring */}
                  <div
                    style={{
                      position: 'absolute',
                      width: 'min(420px, 80%)',
                      height: 'min(180px, 40%)',
                      borderRadius: '50%',
                      border: '2px solid rgba(245, 158, 11, 0.25)',
                      boxShadow: '0 0 35px rgba(245, 158, 11, 0.18), inset 0 0 25px rgba(168, 85, 247, 0.2)',
                      transform: 'perspective(500px) rotateX(60deg)',
                      animation: 'pulse-slow 2.5s infinite ease-in-out',
                      pointerEvents: 'none',
                    }}
                  />
                  {/* Holographic Briefcase Icon & Spinner */}
                  <div
                    style={{
                      position: 'relative',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginBottom: '18px',
                      zIndex: 2,
                    }}
                  >
                    <div
                      className="spin"
                      style={{
                        width: '56px',
                        height: '56px',
                        borderRadius: '50%',
                        border: '3px solid rgba(245, 158, 11, 0.15)',
                        borderTopColor: '#f59e0b',
                        boxShadow: '0 0 20px rgba(245, 158, 11, 0.3)',
                      }}
                    />
                    <Sparkles
                      size={20}
                      style={{
                        position: 'absolute',
                        color: '#fcd34d',
                        animation: 'pulse 1.8s infinite ease-in-out',
                      }}
                    />
                  </div>
                  {/* Loading Status Text */}
                  <div
                    style={{
                      fontSize: '1rem',
                      fontWeight: 800,
                      color: '#fcd34d',
                      letterSpacing: '0.6px',
                      textShadow: '0 2px 10px rgba(0, 0, 0, 0.9)',
                      zIndex: 2,
                      marginBottom: '6px',
                    }}
                  >
                    {msg('game.stageLoading')}
                  </div>
                  <div
                    style={{
                      fontSize: '0.78rem',
                      color: 'rgba(255, 255, 255, 0.55)',
                      fontWeight: 500,
                      zIndex: 2,
                    }}
                  >
                    26 只幸运手提箱与演播厅灯光就绪中...
                  </div>
                </div>
              }
            >
              <Stage3D
                key={`stage_${epoch}`}
                boxes={displayBoxes}
                playerBoxId={playerBoxId}
                phase={phase}
                onBoxClick={(boxId) => {
                  if (phase === 'CHOOSE_PLAYER_BOX') {
                    selectPlayerBox(boxId);
                  } else if (phase === 'OPEN_BOXES') {
                    openBox(boxId);
                  } else if (finalRevealStage === 'PROMPT_CLICK' && boxId === finalTargetBoxId) {
                    handleStartFinalBoxOpen();
                  }
                }}
                onBoxAnimationComplete={handleStageBoxAnimationComplete}
                openingBoxId={openingBoxId || finalOpeningBoxId}
                interactableBoxIds={finalRevealStage === 'PROMPT_CLICK' && finalTargetBoxId ? [finalTargetBoxId] : undefined}
                fastMode={fastMode}
                isPending={isPending}
                connectionStatus={connectionStatus}
                effectiveQuality={effectiveQuality}
                effectiveReducedMotion={effectiveReducedMotion}
                onFpsWindow={handleFpsWindow}
              />
            </React.Suspense>
          </div>

          {/* Right Column */}
          {!challengeMode && <div className="desktop-sidebars" style={{ width: '220px', height: '100%', padding: '16px 16px 16px 0', flexShrink: 0, zIndex: 60 }}>
            <HighMoneyLadder boxes={boxes} playerBoxId={playerBoxId} />
          </div>}
        </div>

        {/* MOBILE / TABLET OVERLAY: only shown during box selection & opening phases */}
        {showMobileDrawer && (
          <div className="mobile-overlay" style={{ position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 30, padding: '12px' }}>
            <div className="glass-panel" style={{ padding: '8px 12px', borderRadius: '12px', maxHeight: '220px', overflowY: 'auto' }}>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                <button
                  onClick={() => setMobileTab('LOW')}
                  style={{
                    flex: 1,
                    padding: '6px',
                    borderRadius: '6px',
                    border: 'none',
                    background: mobileTab === 'LOW' ? '#3b82f6' : 'rgba(255,255,255,0.05)',
                    color: '#ffffff',
                    fontWeight: 700,
                    fontSize: '0.75rem',
                  }}
                >
                  {msg('game.lowPool')}
                </button>
                <button
                  onClick={() => setMobileTab('HIGH')}
                  style={{
                    flex: 1,
                    padding: '6px',
                    borderRadius: '6px',
                    border: 'none',
                    background: mobileTab === 'HIGH' ? '#ef4444' : 'rgba(255,255,255,0.05)',
                    color: '#ffffff',
                    fontWeight: 700,
                    fontSize: '0.75rem',
                  }}
                >
                  {msg('game.highPool')}
                </button>
              </div>
              {mobileTab === 'LOW' ? (
                <LowMoneyLadder boxes={boxes} playerBoxId={playerBoxId} />
              ) : (
                <HighMoneyLadder boxes={boxes} playerBoxId={playerBoxId} />
              )}
            </div>
          </div>
        )}

        {/* BOTTOM ANCHORED PANELS */}
                {phase === 'BANKER_OFFER' && (
          <BankerModal
            bankerOffer={bankerOffer}
            offerId={currentOfferId}
            currentRound={currentRound}
            aiType={aiType}
            offerHistory={offerHistory}
            onAcceptDeal={acceptDeal}
            onRejectDeal={rejectDeal}
            isPending={isPending || connectionStatus !== 'connected'}
            confirmDeal={preferences.confirmDeal}
            deadlineTimestamp={deadlineTimestamp}
            serverTimeOffset={serverTimeOffset}
            reducedMotion={effectiveReducedMotion}
            acceptDisabled={challengeMode && currentRound <= (challenge?.noDealRounds ?? 3)}
            onDeclineRaise={challengeMode ? declineRaise : undefined}
            raiseDeclineAvailable={challengeMode && Boolean(challenge?.raiseDeclineAvailable)}
            remainingMoneyNode={challengeMode ? undefined : (
              <div>
                <div style={{ display: 'flex', gap: '6px', marginBottom: '6px' }}>
                  <button
                    type="button"
                    onClick={() => setMobileTab('LOW')}
                    style={{
                      flex: 1,
                      padding: '4px',
                      borderRadius: '6px',
                      border: 'none',
                      background: mobileTab === 'LOW' ? '#3b82f6' : 'rgba(255,255,255,0.08)',
                      color: '#ffffff',
                      fontWeight: 700,
                      fontSize: '0.72rem',
                    }}
                  >
                    {msg('game.lowArea')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setMobileTab('HIGH')}
                    style={{
                      flex: 1,
                      padding: '4px',
                      borderRadius: '6px',
                      border: 'none',
                      background: mobileTab === 'HIGH' ? '#ef4444' : 'rgba(255,255,255,0.08)',
                      color: '#ffffff',
                      fontWeight: 700,
                      fontSize: '0.72rem',
                    }}
                  >
                    {msg('game.highArea')}
                  </button>
                </div>
                {mobileTab === 'LOW' ? (
                  <LowMoneyLadder boxes={boxes} playerBoxId={playerBoxId} />
                ) : (
                  <HighMoneyLadder boxes={boxes} playerBoxId={playerBoxId} />
                )}
              </div>
            )}
          />
        )}

        {/* When Game is Over and Victory modal is dismissed, show action float bar */}
        {phase === 'GAME_OVER' && victoryDismissed && (
          <div
            style={{
              position: 'absolute',
              bottom: '56px',
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 50,
              display: 'flex',
              gap: '12px',
              alignItems: 'center',
              padding: '8px 16px',
              borderRadius: '30px',
              background: 'rgba(11, 12, 30, 0.92)',
              border: '1px solid rgba(250, 204, 21, 0.4)',
              boxShadow: '0 12px 36px rgba(0, 0, 0, 0.8), 0 0 20px rgba(245, 158, 11, 0.25)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              pointerEvents: 'auto',
            }}
          >
            <button
              type="button"
              onClick={() => setVictoryDismissed(false)}
              className="btn-primary"
              style={{
                padding: '10px 20px',
                borderRadius: '20px',
                boxShadow: '0 6px 20px rgba(245, 158, 11, 0.35)',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontSize: '0.92rem',
                cursor: 'pointer',
              }}
            >
              <Trophy size={18} />
              <span>{msg('game.viewSettlement')}</span>
            </button>
            <button
              type="button"
              onClick={() => returnToLobby(true)}
              className="btn-secondary"
              style={{
                padding: '10px 20px',
                borderRadius: '20px',
                boxShadow: '0 6px 20px rgba(0,0,0,0.4)',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontSize: '0.92rem',
                cursor: 'pointer',
              }}
            >
              <Home size={18} />
              <span>{msg('game.returnLobby')}</span>
            </button>
          </div>
        )}
      </div>

      <Ticker openedBoxes={openedBoxes} />

      {/* MODALS */}
      {phase === 'FINAL_SWAP' && showFinalSwapModal && (
        <FinalSwapModal
          playerBox={playerBox}
          remainingBox={remainingBox}
          onResolveSwap={handleResolveFinalSwap}
          isPending={isPending || connectionStatus !== 'connected'}
          lastRevealedBox={lastRevealedBox}
          remainingAmounts={remainingAmounts}
        />
      )}

      {/* Interactive Final Reveal Prompt Float Bar */}
      {finalRevealStage === 'PROMPT_CLICK' && finalTargetBoxId && (
        <div
          className="final-swap-prompt-bar"
          onClick={handleStartFinalBoxOpen}
          role="button"
          tabIndex={0}
        >
          <Sparkles size={20} color="#facc15" />
          <span style={{ fontWeight: 800, fontSize: '0.92rem' }}>
            {msg('final.promptClick', { box: finalTargetBoxId })}
          </span>
          <button
            type="button"
            className="btn-primary"
            style={{ padding: '6px 16px', borderRadius: '18px', fontSize: '0.82rem', cursor: 'pointer' }}
            onClick={(e) => {
              e.stopPropagation();
              handleStartFinalBoxOpen();
            }}
          >
            {msg('final.openNow')}
          </button>
        </div>
      )}

      {phase === 'GAME_OVER' && !victoryDismissed && (finalRevealStage === 'IDLE' || finalRevealStage === 'DONE') && (
        <VictoryModal
          settlement={settlement}
          onRestart={startGame}
          onReturnToLobby={returnToLobby}
          onOpenHistory={() => setIsHistoryOpen(true)}
          onOpenFairness={() => setIsFairnessOpen(true)}
          onOpenReport={
            settlement
              ? () =>
                  setReportTarget({
                    targetType: 'match',
                    targetId: settlement.resultId,
                    targetDescription: msg('game.matchDescription', { id: settlement.resultId.slice(0, 8) }),
                  })
              : undefined
          }
          onClose={() => setVictoryDismissed(true)}
          isPending={isPending || connectionStatus !== 'connected'}
          reducedMotion={effectiveReducedMotion}
          currentAiType={aiType}
          offerHistory={offerHistory}
        />
      )}

      <ForfeitModal
        isOpen={isForfeitModalOpen}
        onClose={() => setIsForfeitModalOpen(false)}
        onConfirmForfeit={handleConfirmForfeit}
        isPending={isPending}
      />

      {settingsDialogElement}
      <PwaNotice onOpenSettings={openDialog} />

      <HistoryModal
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
      />

      <FairnessModal
        isOpen={isFairnessOpen}
        onClose={() => setIsFairnessOpen(false)}
        record={currentRecord}
      />

      <RankingModal
        isOpen={isRankingOpen}
        onClose={() => setIsRankingOpen(false)}
      />

      <ProfileSummaryModal
        isOpen={isProfileOpen}
        onClose={() => setIsProfileOpen(false)}
      />

      {reportTarget && (
        <ReportDialog
          isOpen={Boolean(reportTarget)}
          onClose={() => setReportTarget(null)}
          targetType={reportTarget.targetType}
          targetId={reportTarget.targetId}
          targetDescription={reportTarget.targetDescription}
        />
      )}
    </div>
  );
}
