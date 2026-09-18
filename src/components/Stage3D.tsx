import React, { Suspense, useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html, useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { RoomEnvironment } from 'three-stdlib';
import { BoxData, GamePhase, formatMoney } from '../types/game';
import { Box3D, ASSETS } from './Box3D';
import { StageEnvironment } from './StageEnvironment';
import layouts from '../stage-layout.json';
import { globalPerformanceSampler, WebGLStats } from '../utils/performance';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useTheme } from '../themes';
import { getLanguage, translate, useLanguage, type TranslationKey } from '../i18n';

// Preload 3D models into memory cache so stage mounts instantly
export function preloadStageAssets() {
  try {
    useGLTF.preload(ASSETS.standard);
    useGLTF.preload(ASSETS.low);
    useGLTF.preload(layouts['26'].stage);
  } catch {
    // Ignore in headless / testing environments
  }
}
preloadStageAssets();

function stageMessage(key: TranslationKey, language: ReturnType<typeof getLanguage>, vars?: Record<string, string | number>) {
  let value = translate(key, language);
  for (const [name, replacement] of Object.entries(vars ?? {})) {
    value = value.replace(new RegExp(`\\{${name}\\}`, 'g'), String(replacement));
  }
  return value;
}

interface Stage3DProps {
  boxes: BoxData[];
  playerBoxId: number | null;
  phase: GamePhase;
  onBoxClick: (boxId: number) => void;
  onBoxAnimationComplete?: (boxId: number) => void;
  openingBoxId?: number | null;
  fastMode: boolean;
  isPending?: boolean;
  connectionStatus?: string;
  effectiveQuality?: 'standard' | 'low';
  effectiveReducedMotion?: boolean;
  onPerformance?: (sample: { fps: number; calls: number; triangles: number }) => void;
  onFpsWindow?: (fps: number) => void;
  canInteract?: boolean;
  playerBoxLabel?: string;
  interactableBoxIds?: number[];
}

function SceneReadyMarker({ onReady }: { onReady: () => void }) {
  useEffect(() => {
    onReady();
  }, [onReady]);
  return null;
}

function SuspenseLoadingTracker({ onLoading }: { onLoading: () => void }) {
  const language = useLanguage();
  useEffect(() => {
    onLoading();
  }, [onLoading]);
  return (
    <Html center>
      <div
        className="stage-3d-hologram-loader"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '12px',
          color: '#f59e0b',
          pointerEvents: 'none',
          userSelect: 'none',
        }}
      >
        <div
          className="spin"
          style={{
            width: '38px',
            height: '38px',
            borderRadius: '50%',
            border: '3px solid rgba(245, 158, 11, 0.2)',
            borderTopColor: '#f59e0b',
            boxShadow: '0 0 16px rgba(245, 158, 11, 0.4)',
          }}
        />
        <span
          className="stage-loading"
          style={{
            fontSize: '0.88rem',
            fontWeight: 700,
            color: '#fcd34d',
            letterSpacing: '0.5px',
            textShadow: '0 2px 8px rgba(0, 0, 0, 0.8)',
          }}
        >
          {stageMessage('game.stageLoading', language)}
        </span>
      </div>
    </Html>
  );
}

function PerformanceSample({
  isSceneReady,
  isTabHidden,
  skipNextFrameRef,
  onPerformance,
  onFpsWindow,
}: {
  isSceneReady: boolean;
  isTabHidden: boolean;
  skipNextFrameRef: React.MutableRefObject<boolean>;
  onPerformance?: Stage3DProps['onPerformance'];
  onFpsWindow?: Stage3DProps['onFpsWindow'];
}) {
  const sample = useRef({ seconds: 0, frames: 0 });

  useFrame(({ gl }, delta) => {
    // Only sample in real scenes where Suspense assets have resolved
    if (!isSceneReady || isTabHidden) {
      return;
    }

    // Skip the first frame upon tab recovery or large frame lag spikes
    if (skipNextFrameRef.current) {
      skipNextFrameRef.current = false;
      return;
    }

    // Record genuine WebGL metrics
    const webglStats: WebGLStats = {
      calls: gl.info.render.calls,
      triangles: gl.info.render.triangles,
      textures: gl.info.memory.textures ?? 0,
    };
    globalPerformanceSampler.setWebGLStats(webglStats);
    globalPerformanceSampler.recordFrame(delta, false, false);

    sample.current.seconds += delta;
    sample.current.frames++;
    if (sample.current.seconds >= 5) {
      const fps = Math.round(sample.current.frames / sample.current.seconds);
      globalPerformanceSampler.recordWindowFps(fps);
      if (onFpsWindow) {
        onFpsWindow(fps);
      }
      if (onPerformance) {
        onPerformance({
          fps,
          calls: gl.info.render.calls,
          triangles: gl.info.render.triangles,
        });
      }
      sample.current = { seconds: 0, frames: 0 };
    }
  });

  return null;
}

function usePreference(query: string) {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false
  );
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const media = window.matchMedia(query);
    const change = () => setMatches(media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, [query]);
  return matches;
}

function CenterCamera() {
  const { camera, size } = useThree();
  useEffect(() => {
    const perspective = camera as THREE.PerspectiveCamera;
    const aspect = size.width / size.height;
    const stageHeight = 6.85;
    const stageWidth = 14.3;

    const vertDist = stageHeight / (2 * Math.tan(THREE.MathUtils.degToRad(24)) * aspect) - 4.5;
    const horizDist = stageWidth / (2 * Math.tan(THREE.MathUtils.degToRad(24)) * aspect) - 8.0;

    const distance = Math.max(4.5, vertDist, horizDist);

    perspective.position.set(0, 3.15, -distance);
    perspective.lookAt(0, 3.35, 8);
    perspective.updateProjectionMatrix();
  }, [camera, size.width, size.height]);
  return null;
}

/**
 * Procedural Studio Environment:
 * Generates an instantaneous in-memory PBR environment map via RoomEnvironment.
 * 0 network requests, 0 delay, gives metallic trims and case lacquer full IBL reflections.
 */
function StudioEnvironment({ intensity = 1.35 }: { intensity?: number }) {
  const { gl, scene } = useThree();

  useEffect(() => {
    const pmremGenerator = new THREE.PMREMGenerator(gl);
    pmremGenerator.compileEquirectangularShader();
    const room = new RoomEnvironment();
    const renderTarget = pmremGenerator.fromScene(room, 0.04);

    scene.environment = renderTarget.texture;
    if ('environmentIntensity' in scene) {
      (scene as any).environmentIntensity = intensity;
    }

    return () => {
      scene.environment = null;
      renderTarget.dispose();
      pmremGenerator.dispose();
      room.traverse((child) => {
        if ((child as any).geometry) (child as any).geometry.dispose();
        if ((child as any).material) (child as any).material.dispose();
      });
    };
  }, [gl, scene, intensity]);

  return null;
}

/**
 * Broadcast Studio Multi-Point Lighting Rig:
 * Guarantees all 26 briefcases (z = 4 ~ 14, y = 1 ~ 5.6) and the curved stage
 * are brilliantly and evenly illuminated with broadcast key, fill, overhead, and rim lights.
 */
function StageLighting({
  themeDefinition,
  isLowQuality,
  isMobileLayout,
}: {
  themeDefinition: { tokens: Record<string, string> };
  isLowQuality: boolean;
  isMobileLayout: boolean;
}) {
  const mainTargetRef = useRef<THREE.Object3D>(null);
  const mainLightRef = useRef<THREE.DirectionalLight>(null);

  useEffect(() => {
    if (mainLightRef.current && mainTargetRef.current) {
      mainLightRef.current.target = mainTargetRef.current;
      mainLightRef.current.target.updateMatrixWorld();
    }
  }, []);

  return (
    <>
      {/* Offline instantaneous studio IBL reflections for PBR metal & lacquer */}
      <StudioEnvironment intensity={isLowQuality ? 1.0 : 1.35} />

      {/* Target anchored right in the center of the 26 briefcases */}
      <object3D ref={mainTargetRef} position={[0, 3.5, 9]} />

      {/* Generous ambient illumination to eliminate harsh black shadows */}
      <ambientLight intensity={0.7} color={themeDefinition.tokens.stageAmbientLight} />

      {/* Hemisphere fill: illuminates upper surfaces with key light, ground with base color */}
      <hemisphereLight
        intensity={0.85}
        color={themeDefinition.tokens.stageKeyLight}
        groundColor={themeDefinition.tokens.bgBase}
      />

      {/* Primary Key Light: bright front-top angled studio spotlight aimed directly at cases */}
      <directionalLight
        ref={mainLightRef}
        position={[0, 14, -4]}
        intensity={3.2}
        color={themeDefinition.tokens.stageKeyLight}
        castShadow={!isLowQuality && !isMobileLayout}
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-16}
        shadow-camera-right={16}
        shadow-camera-top={20}
        shadow-camera-bottom={-12}
        shadow-camera-far={50}
        shadow-normalBias={0.025}
      />

      {/* Left Front Fill Light: softens shadows and illuminates left tier cases */}
      <directionalLight
        position={[-8, 9, -2]}
        intensity={1.5}
        color={themeDefinition.tokens.stageKeyLight}
      />

      {/* Right Front Fill Light: illuminates right tier cases */}
      <directionalLight
        position={[8, 9, -2]}
        intensity={1.5}
        color={themeDefinition.tokens.stageKeyLight}
      />

      {/* Top Overhead Stage Wash Light: brings out the golden trim on top lids */}
      <directionalLight
        position={[0, 16, 9]}
        intensity={1.8}
        color="#ffffff"
      />

      {/* Back Rim Light: separates cases from dark stage background */}
      <directionalLight
        position={[0, 12, 18]}
        intensity={1.5}
        color={themeDefinition.tokens.stageRimLight}
      />
    </>
  );
}

interface StageErrorProps {
  boxes: BoxData[];
  playerBoxId: number | null;
  phase: GamePhase;
  onBoxClick: (boxId: number) => void;
  openingBoxId: number | null;
  onFallbackReveal: (boxId: number) => void;
  isLocked: boolean;
  onRetry: () => void;
  playerBoxLabel?: string;
  canInteract?: boolean;
  interactableBoxIds?: number[];
}

interface StageErrorState {
  failed: boolean;
  chosenId: string;
}

class StageError extends React.Component<React.PropsWithChildren<StageErrorProps>, StageErrorState> {
  state: StageErrorState = { failed: false, chosenId: '' };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: any) {
    console.error('Stage3D WebGL render error caught by StageError:', error);
  }

  handleRetry = () => {
    try {
      // Clear useGLTF cache for failed models so retry fetches anew
      useGLTF.clear(ASSETS.standard);
      useGLTF.clear(ASSETS.low);
      useGLTF.clear(layouts['26'].stage);
    } catch (e) {
      console.warn('Failed to clear GLTF cache:', e);
    }
    this.setState({ failed: false });
    this.props.onRetry();
  };

  render() {
    if (this.state.failed) {
      const language = getLanguage();
      const msg = (key: TranslationKey, vars?: Record<string, string | number>) => stageMessage(key, language, vars);
      const { boxes, phase, onBoxClick, openingBoxId, onFallbackReveal, isLocked, canInteract = true, interactableBoxIds } =
        this.props;
      const selecting = phase === 'CHOOSE_PLAYER_BOX';
      const chosen = boxes.find((b) => String(b.id) === this.state.chosenId);
      const canChoose =
        canInteract &&
        !isLocked &&
        !!chosen &&
        !chosen.isOpened &&
        (interactableBoxIds ? interactableBoxIds.includes(chosen.id) : (selecting || (phase === 'OPEN_BOXES' && !chosen.isPlayerBox)));

      return (
        <div
          className="stage-fallback-container"
          style={{
            width: '100%',
            height: '100%',
            overflowY: 'auto',
            padding: '20px 16px 80px 16px',
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            background: 'radial-gradient(ellipse at 50% 42%, #231a42 0%, #110d24 100%)',
          }}
        >
          {/* Status Alert Banner */}
          <div
            style={{
              background: 'rgba(239, 68, 68, 0.15)',
              border: '1px solid rgba(239, 68, 68, 0.4)',
              borderRadius: '16px',
              padding: '12px 18px',
              maxWidth: '680px',
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              flexWrap: 'wrap',
              marginBottom: '16px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#fca5a5' }}>
              <AlertTriangle size={18} style={{ flexShrink: 0 }} />
              <span style={{ fontSize: '0.85rem', fontWeight: 700 }}>
                {msg('stage.error')}
              </span>
            </div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {openingBoxId !== null && (
                <button
                  type="button"
                  onClick={() => onFallbackReveal(openingBoxId)}
                  style={{
                    minHeight: '44px',
                    padding: '8px 14px',
                    borderRadius: '10px',
                    border: 'none',
                    background: '#f59e0b',
                    color: '#000000',
                    fontWeight: 700,
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                  }}
                >
                  {msg('stage.reveal', { box: openingBoxId })}
                </button>
              )}
              <button
                type="button"
                onClick={this.handleRetry}
                style={{
                  minHeight: '44px',
                  padding: '8px 14px',
                  borderRadius: '10px',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  background: 'rgba(255, 255, 255, 0.1)',
                  color: '#ffffff',
                  fontWeight: 700,
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <RefreshCw size={14} />
                <span>{msg('stage.retry3d')}</span>
              </button>
            </div>
          </div>

          {/* Quick Select Dropdown */}
          {(phase === 'CHOOSE_PLAYER_BOX' || phase === 'OPEN_BOXES' || Boolean(interactableBoxIds?.length)) && (
            <div
              style={{
                display: 'flex',
                gap: '8px',
                width: '100%',
                maxWidth: '680px',
                marginBottom: '16px',
              }}
            >
              <select
                disabled={isLocked || !canInteract}
                aria-label={msg('stage.selectBox')}
                value={this.state.chosenId}
                onChange={(e) => this.setState({ chosenId: e.target.value })}
                style={{
                  flex: 1,
                  minHeight: '44px',
                  padding: '8px 12px',
                  borderRadius: '10px',
                  background: '#19152e',
                  border: '1px solid #bca06c',
                  color: '#f8dfad',
                  fontSize: '0.9rem',
                }}
              >
                <option value="">{msg('stage.quickSelect')}</option>
                {boxes.map((box) => (
                  <option key={box.id} value={box.id}>
                    {msg('stage.boxNumber', { box: box.id })}
                    {box.isOpened
                      ? ` · ${formatMoney(box.value)}`
                      : box.isPlayerBox
                      ? ` · ${this.props.playerBoxLabel ?? msg('stage.myBox')}`
                      : ''}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!canChoose}
                onClick={() => {
                  if (canChoose && chosen) {
                    onBoxClick(chosen.id);
                    this.setState({ chosenId: '' });
                  }
                }}
                className="btn-primary"
                style={{ minHeight: '44px', padding: '8px 20px', whiteSpace: 'nowrap' }}
              >
                {selecting
                  ? msg('stage.chooseBox', { label: this.props.playerBoxLabel ?? msg('stage.myBox') })
                  : msg('stage.openBox')}
              </button>
            </div>
          )}

          {/* Full HTML 26-box Grid */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))',
              gap: '10px',
              width: '100%',
              maxWidth: '680px',
            }}
          >
            {boxes.map((box) => {
              const isInteractable =
                canInteract &&
                !isLocked &&
                !box.isOpened &&
                (interactableBoxIds
                  ? interactableBoxIds.includes(box.id)
                  : (selecting || (phase === 'OPEN_BOXES' && !box.isPlayerBox)));

              let bg = 'rgba(255, 255, 255, 0.05)';
              let border = '1px solid rgba(255, 255, 255, 0.12)';
              let textColor = '#ffffff';

              if (box.isOpened) {
                bg = 'rgba(0, 0, 0, 0.4)';
                border = '1px solid rgba(255, 255, 255, 0.05)';
                textColor = '#9ca3af';
              } else if (box.isPlayerBox) {
                bg = 'rgba(245, 158, 11, 0.2)';
                border = '2px solid #f59e0b';
                textColor = '#fcd34d';
              }

              return (
                <button
                  key={box.id}
                  type="button"
                  disabled={!isInteractable}
                  onClick={() => onBoxClick(box.id)}
                  style={{
                    minHeight: '64px',
                    padding: '8px',
                    borderRadius: '12px',
                    background: bg,
                    border,
                    color: textColor,
                    cursor: isInteractable ? 'pointer' : 'default',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '4px',
                    opacity: box.isOpened ? 0.6 : 1,
                  }}
                >
                  <span style={{ fontSize: '1.2rem', fontWeight: 800 }}>#{box.id}</span>
                  {box.isOpened ? (
                    <span
                      style={{
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        color: box.value >= 5000 ? '#f472b6' : '#38bdf8',
                      }}
                    >
                      {formatMoney(box.value)}
                    </span>
                  ) : box.isPlayerBox ? (
                    <span style={{ fontSize: '0.7rem', color: '#fcd34d', fontWeight: 700 }}>
                      {this.props.playerBoxLabel ?? msg('stage.myBox')}
                    </span>
                  ) : (
                    <span style={{ fontSize: '0.7rem', color: '#9ca3af' }}>
                      {selecting ? msg('stage.available') : msg('stage.unopened')}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export const Stage3D: React.FC<Stage3DProps> = ({
  boxes,
  playerBoxId,
  phase,
  onBoxClick,
  onBoxAnimationComplete = () => {},
  openingBoxId = null,
  fastMode,
  isPending = false,
  connectionStatus = 'connected',
  effectiveQuality = 'standard',
  effectiveReducedMotion = false,
  onPerformance,
  onFpsWindow,
  canInteract = true,
  playerBoxLabel,
  interactableBoxIds,
}) => {
  const language = useLanguage();
  const msg = (key: TranslationKey, vars?: Record<string, string | number>) => stageMessage(key, language, vars);
  const resolvedPlayerBoxLabel = playerBoxLabel ?? msg('stage.myBox');
  // Keep the 3D lighting tied to the same runtime theme registry as the HTML
  // UI. The theme only changes presentation tokens; server rules and box data
  // remain untouched.
  const { themeDefinition } = useTheme(effectiveQuality);
  const isMobileLayout = usePreference('(max-width: 1023px)');
  const isLowQuality = effectiveQuality === 'low';
  const showHtmlCaseSelector = isMobileLayout || isLowQuality;

  const [chosenId, setChosenId] = useState('');
  const [retryKey, setRetryKey] = useState(0);

  // Asset load duration tracking
  const mountTimeRef = useRef<number>(performance.now());
  const cycle = useMemo(() => ({ startedAt: performance.now() }), [effectiveQuality, retryKey]);
  const [readyCycle, setReadyCycle] = useState<typeof cycle | null>(null);
  const isSceneReady = readyCycle === cycle;

  // Tab visibility and frame recovery tracking
  const [isTabHidden, setIsTabHidden] = useState(() =>
    typeof document !== 'undefined' ? document.hidden : false
  );
  const skipNextFrameRef = useRef(false);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const handleVisibilityChange = () => {
      const hidden = document.hidden;
      setIsTabHidden(hidden);
      if (!hidden) {
        skipNextFrameRef.current = true;
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  const handleLoadingStart = useCallback(() => {
    setReadyCycle(null);
    mountTimeRef.current = performance.now();
    globalPerformanceSampler.setLoadDuration(null);
    globalPerformanceSampler.setWebGLStats(null);
  }, []);

  const handleSceneReady = useCallback(() => {
    const duration = Math.round(performance.now() - Math.max(cycle.startedAt, mountTimeRef.current));
    globalPerformanceSampler.setLoadDuration(duration);
    setReadyCycle(cycle);
  }, [cycle]);

  const handleRetryCanvas = useCallback(() => {
    mountTimeRef.current = performance.now();
    setReadyCycle(null);
    globalPerformanceSampler.setLoadDuration(null);
    globalPerformanceSampler.setWebGLStats(null);
    setRetryKey((k) => k + 1);
  }, []);

  // Fixed 26-box layout only
  const layout = layouts['26'];
  const selecting = phase === 'CHOOSE_PLAYER_BOX';
  const chosen = boxes.find((box) => String(box.id) === chosenId);

  // Global input lock: when pending response, not connected, during box opening animation, or cannot interact
  const isLocked =
    !canInteract ||
    isPending ||
    (connectionStatus !== undefined && connectionStatus !== 'connected') ||
    openingBoxId !== null;

  const canChoose =
    !isLocked &&
    !!chosen &&
    !chosen.isOpened &&
    (interactableBoxIds
      ? interactableBoxIds.includes(chosen.id)
      : (selecting || (phase === 'OPEN_BOXES' && !chosen.isPlayerBox)));

  return (
    <div className="display-stage">
      {/* HTML Fallback reveal button to guarantee game never permanently locks */}
      {openingBoxId !== null && (
        <div style={{ position: 'absolute', top: '16px', right: '16px', zIndex: 30 }}>
          <button
            type="button"
            onClick={() => onBoxAnimationComplete(openingBoxId)}
            style={{
              minHeight: '44px',
              padding: '8px 16px',
              borderRadius: '12px',
              background: 'rgba(0, 0, 0, 0.75)',
              border: '1px solid rgba(245, 158, 11, 0.5)',
              color: '#fcd34d',
              fontSize: '0.85rem',
              fontWeight: 700,
              cursor: 'pointer',
            }}
            title={msg('stage.skipTitle')}
          >
            {msg('stage.skip')}
          </button>
        </div>
      )}

      <StageError
        key={`stage_error_${retryKey}`}
        boxes={boxes}
        playerBoxId={playerBoxId}
        phase={phase}
        onBoxClick={onBoxClick}
        openingBoxId={openingBoxId}
        onFallbackReveal={onBoxAnimationComplete}
        isLocked={isLocked}
        canInteract={canInteract}
        playerBoxLabel={resolvedPlayerBoxLabel}
        interactableBoxIds={interactableBoxIds}
        onRetry={handleRetryCanvas}
      >
        <Canvas
          key={`stage_canvas_${retryKey}`}
          frameloop={isTabHidden ? 'never' : 'always'}
          camera={{ position: [0, 2.8, -4.5], fov: 48, near: 0.1, far: 80 }}
          shadows={!isLowQuality && !isMobileLayout}
          dpr={isLowQuality ? 1 : [1, 1.25]}
          gl={{ antialias: !isLowQuality }}
        >
          <CenterCamera />
          <PerformanceSample
            isSceneReady={isSceneReady}
            isTabHidden={isTabHidden}
            skipNextFrameRef={skipNextFrameRef}
            onPerformance={onPerformance}
            onFpsWindow={onFpsWindow}
          />
          <StageLighting
            themeDefinition={themeDefinition}
            isLowQuality={isLowQuality}
            isMobileLayout={isMobileLayout}
          />
          <Suspense fallback={<SuspenseLoadingTracker onLoading={handleLoadingStart} />}>
            <SceneReadyMarker onReady={handleSceneReady} />
            <StageEnvironment asset={layout.stage} lowQuality={isLowQuality || isMobileLayout} />
            {boxes.map((box, index) => {
              const slot = layout.slots[index];
              if (!slot) return null;
              const isInteractable =
                !isLocked &&
                !box.isOpened &&
                (interactableBoxIds
                  ? interactableBoxIds.includes(box.id)
                  : (selecting || (phase === 'OPEN_BOXES' && !box.isPlayerBox)));

              return (
                <Box3D
                  key={box.id}
                  box={box}
                  position={slot.position as [number, number, number]}
                  rotation={slot.rotation as [number, number, number]}
                  onClick={() => onBoxClick(box.id)}
                  onAnimationComplete={() => onBoxAnimationComplete(box.id)}
                  isOpening={box.id === openingBoxId}
                  isInteractable={isInteractable}
                  fastMode={fastMode}
                  lowQuality={isLowQuality}
                  reducedMotion={effectiveReducedMotion}
                  playerBoxLabel={resolvedPlayerBoxLabel}
                />
              );
            })}
          </Suspense>
        </Canvas>
      </StageError>

      {/* Keyboard and screen-reader path for the same box actions exposed by 3D. */}
      <div className="stage-keyboard-selector" role="listbox" aria-label={msg('stage.selectorAria')}>
        {boxes.map((box) => {
          const keyboardOperable =
            !isLocked &&
            !box.isOpened &&
            (interactableBoxIds
              ? interactableBoxIds.includes(box.id)
              : (selecting || (phase === 'OPEN_BOXES' && !box.isPlayerBox)));
          const label = `${msg('stage.boxAria', { box: box.id })}${box.isPlayerBox ? msg('stage.playerSuffix', { label: resolvedPlayerBoxLabel }) : ''}`;
          return (
            <button
              key={`keyboard-box-${box.id}`}
              type="button"
              role="option"
              aria-label={label}
              aria-selected={box.id === playerBoxId}
              disabled={!keyboardOperable}
              onClick={() => onBoxClick(box.id)}
            >
              {box.id}
            </button>
          );
        })}
      </div>

      {/* Accessible HTML 26-box fallback selector */}
      {showHtmlCaseSelector && canInteract && (selecting || phase === 'OPEN_BOXES' || Boolean(interactableBoxIds?.length)) && (
        <div className="mobile-case-control" aria-label={msg('stage.selectorAria')}>
          <label htmlFor="stage-box-select" className="sr-only">
            {msg('stage.selectorLabel')}
          </label>
          <select
            id="stage-box-select"
            value={chosenId}
            disabled={isLocked}
            onChange={(e) => setChosenId(e.target.value)}
            aria-label={msg('stage.selectorViewAria')}
          >
            <option value="">{msg('stage.selectorPlaceholder')}</option>
            {boxes.map((box) => (
              <option key={box.id} value={String(box.id)}>
                #{box.id}{' '}
                {box.isOpened
                  ? msg('stage.openedOption', { amount: formatMoney(box.value) })
                  : box.isPlayerBox
                  ? msg('stage.myBoxOption', { label: resolvedPlayerBoxLabel })
                  : ''}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!canChoose}
            onClick={() => {
              if (canChoose && chosen) {
                onBoxClick(chosen.id);
                setChosenId('');
              }
            }}
          >
            {selecting ? msg('stage.chooseBox', { label: resolvedPlayerBoxLabel }) : msg('stage.mobileOpen')}
          </button>
        </div>
      )}
    </div>
  );
};

export default Stage3D;
