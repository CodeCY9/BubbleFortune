import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Html, useAnimations, useGLTF } from '@react-three/drei';
import { createPortal } from '@react-three/fiber';
import * as THREE from 'three';
import { BoxData, formatMoney } from '../types/game';
import { translate, useLanguage, type TranslationKey } from '../i18n';

export const ASSETS = {
  standard: '/assets/models/runtime/BF_Briefcase_v009.glb',
  low: '/assets/models/runtime/BF_Briefcase_v009_low.glb',
};
interface Box3DProps {
  box: BoxData;
  position: [number, number, number];
  rotation?: [number, number, number];
  onClick: () => void;
  onAnimationComplete: () => void;
  isOpening: boolean;
  isInteractable: boolean;
  fastMode: boolean;
  lowQuality?: boolean;
  reducedMotion?: boolean;
  playerBoxLabel?: string;
}

export const Box3D: React.FC<Box3DProps> = ({
  box,
  position,
  rotation,
  onClick,
  onAnimationComplete,
  isOpening,
  isInteractable,
  fastMode,
  lowQuality = false,
  reducedMotion = false,
  playerBoxLabel,
}) => {
  const language = useLanguage();
  const msg = (key: TranslationKey, vars?: Record<string, string | number>) => {
    let value = translate(key, language);
    for (const [name, replacement] of Object.entries(vars ?? {})) {
      value = value.replace(new RegExp(`\\{${name}\\}`, 'g'), String(replacement));
    }
    return value;
  };
  const resolvedPlayerBoxLabel = playerBoxLabel ?? msg('stage.myBox');
  const { scene, animations } = useGLTF(lowQuality ? ASSETS.low : ASSETS.standard);
  // Share geometry/materials; only mechanical transforms and the mixer are per case.
  const model = useMemo(() => {
    const clone = scene.clone(true);
    clone.traverse((object) => { if (object instanceof THREE.Mesh) object.receiveShadow = !lowQuality; });
    return clone;
  }, [scene, lowQuality]);

  useEffect(() => {
    model.traverse((object) => {
      if (object instanceof THREE.Mesh) object.castShadow = !lowQuality && (box.isPlayerBox || isOpening);
    });
  }, [model, lowQuality, box.isPlayerBox, isOpening]);

  const { actions, mixer } = useAnimations(animations, model);
  const onAnimationCompleteRef = useRef(onAnimationComplete);
  onAnimationCompleteRef.current = onAnimationComplete;

  const [revealed, setRevealed] = useState(box.isOpened);
  const [focused, setFocused] = useState(false);

  const animatingRef = useRef(false);
  const completedRef = useRef(box.isOpened);

  const numberAnchor = model.getObjectByName('BF_UI_NumberAnchor');
  const amountAnchor = model.getObjectByName('BF_UI_AmountAnchor');
  const amountText = box.isOpened ? formatMoney(box.value) : '';

  // Main animation effect: triggered when isOpening or box.isOpened changes
  useEffect(() => {
    const openAction = actions.Chest_Open;
    if (!openAction) {
      if (isOpening) {
        onAnimationComplete();
      }
      return;
    }

    // Already opened (restore snapshot or after commit)
    if (box.isOpened) {
      completedRef.current = true;
      animatingRef.current = false;
      openAction.reset().setLoop(THREE.LoopOnce, 1);
      openAction.clampWhenFinished = true;
      openAction.time = openAction.getClip().duration;
      openAction.play();
      mixer.update(0);
      openAction.paused = true;
      setRevealed(true);
      return;
    }

    // Closed and not opening
    if (!isOpening) {
      animatingRef.current = false;
      completedRef.current = false;
      setRevealed(false);
      return;
    }

    // Box is opening now!
    if (isOpening && !completedRef.current) {
      animatingRef.current = true;
      // Capture callback constant at animation initiation time so it cannot be washed out by re-renders
      const onCompleteAtStart = onAnimationComplete;

      // Reduced motion: jump directly to end and notify
      if (reducedMotion) {
        completedRef.current = true;
        animatingRef.current = false;
        openAction.reset().setLoop(THREE.LoopOnce, 1);
        openAction.clampWhenFinished = true;
        openAction.time = openAction.getClip().duration;
        openAction.play();
        mixer.update(0);
        openAction.paused = true;
        setRevealed(true);
        onCompleteAtStart();
        return;
      }

      openAction.reset().setLoop(THREE.LoopOnce, 1);
      openAction.clampWhenFinished = true;
      openAction.timeScale = fastMode ? 2.5 : 1;
      openAction.play();

      let finishedFired = false;
      const onFinished = (event?: { action: THREE.AnimationAction }) => {
        if (finishedFired) return;
        if (!event || event.action === openAction) {
          finishedFired = true;
          mixer.removeEventListener('finished', onFinished);
          completedRef.current = true;
          animatingRef.current = false;
          setRevealed(true);
          onCompleteAtStart();
        }
      };

      mixer.addEventListener('finished', onFinished);

      // Fallback timer: ALWAYS calculated based on normal (1x) duration + generous safety margin.
      // Toggling fast->slow mode mid-animation will NEVER cause premature fallback reveal.
      const normalDurationMs = (openAction.getClip().duration || 1.5) * 1000;
      const fallbackTimeoutMs = Math.max(3500, normalDurationMs + 2000);
      const fallbackTimer = setTimeout(() => {
        onFinished();
      }, fallbackTimeoutMs);

      return () => {
        clearTimeout(fallbackTimer);
        mixer.removeEventListener('finished', onFinished);
        animatingRef.current = false;
      };
    }
  }, [actions, mixer, box.isOpened, isOpening, reducedMotion]);

  // Adjust timeScale dynamically if fastMode changes mid-animation
  useEffect(() => {
    const openAction = actions.Chest_Open;
    if (openAction && animatingRef.current) {
      openAction.timeScale = fastMode ? 2.5 : 1;
    }
  }, [actions, fastMode]);

  const interact = () => {
    if (isInteractable && !box.isOpened && !isOpening) {
      onClick();
    }
  };

  return (
    <group position={position} rotation={rotation}>
      <primitive object={model} dispose={null} />
      {(focused || box.isPlayerBox) && !box.isOpened && (
        <pointLight position={[0, 0.8, 1]} intensity={1.2} distance={2.3} color="#ffdfab" />
      )}
      {/* Stable, inexpensive picking envelope includes the standing shell and carry handle. */}
      {!box.isOpened && (
        <mesh
          position={[0, 0.49, 0]}
          onClick={(e) => {
            e.stopPropagation();
            interact();
          }}
          onPointerOver={() => setFocused(true)}
          onPointerOut={() => setFocused(false)}
        >
          <boxGeometry args={[1.48, 1.02, 0.3]} />
          <meshBasicMaterial visible={false} />
        </mesh>
      )}
      {numberAnchor && !box.isOpened && createPortal(
        <Html transform rotation={[Math.PI / 2, 0, 0]} distanceFactor={1} center zIndexRange={[8, 0]}>
          <button
            className={`case-number${box.isPlayerBox ? ' is-player' : ''}${focused ? ' is-focused' : ''}`}
            disabled={!isInteractable}
            aria-label={`${msg('stage.boxAria', { box: box.id })}${box.isPlayerBox ? msg('stage.playerSuffix', { label: resolvedPlayerBoxLabel }) : ''}`}
            onClick={interact}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
          >
            <span>{box.id}</span>
            {box.isPlayerBox && <small>{resolvedPlayerBoxLabel}</small>}
          </button>
        </Html>,
        numberAnchor
      )}
      {amountAnchor && box.isOpened && revealed && createPortal(
        <Html
          transform
          rotation={[Math.PI / 2, 0, 0]}
          distanceFactor={1}
          center
          zIndexRange={[8, 0]}
          style={{ pointerEvents: 'none' }}
        >
          <div
            className="case-amount"
            style={{ fontSize: `${Math.min(108, 640 / Math.max(1, amountText.length))}px` }}
            aria-label={msg('stage.amountAria', { box: box.id, amount: amountText })}
          >
            {amountText}
          </div>
        </Html>,
        amountAnchor
      )}
    </group>
  );
};
