import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Preferences,
  QualityPreference,
  DEFAULT_PREFERENCES,
  loadPreferences,
  savePreferences,
  resolveReducedMotion,
  detectInitialQuality,
  AutoQualityEvaluator,
} from '../utils/preferences';
import { soundManager } from '../utils/audio';
import { setLanguage } from '../i18n';

function getSystemReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function getInitialDeviceCaps() {
  if (typeof navigator === 'undefined') return undefined;
  const nav = navigator as any;
  return {
    saveData: nav.connection?.saveData,
    deviceMemory: nav.deviceMemory,
    hardwareConcurrency: nav.hardwareConcurrency,
  };
}

export function usePreferences() {
  const [preferences, setPreferences] = useState<Preferences>(() => loadPreferences());
  const [systemReducedMotion, setSystemReducedMotion] = useState<boolean>(() =>
    getSystemReducedMotion()
  );

  const initialCaps = getInitialDeviceCaps();
  const [autoQuality, setAutoQuality] = useState<'standard' | 'low'>(() =>
    detectInitialQuality(initialCaps)
  );

  const autoEvaluatorRef = useRef<AutoQualityEvaluator>(
    new AutoQualityEvaluator(detectInitialQuality(initialCaps))
  );

  // Effective reduced motion
  const effectiveReducedMotion = resolveReducedMotion(
    preferences.reducedMotion,
    systemReducedMotion
  );

  // Effective quality
  const effectiveQuality: 'standard' | 'low' =
    preferences.quality === 'auto' ? autoQuality : preferences.quality;

  // Media query listener for system reduced motion
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handler = (e: MediaQueryListEvent) => {
      setSystemReducedMotion(e.matches);
    };
    media.addEventListener('change', handler);
    return () => media.removeEventListener('change', handler);
  }, []);

  // Update document dataset attributes for CSS selectors
  useEffect(() => {
    if (typeof document === 'undefined') return;
    setLanguage(preferences.language);
    document.documentElement.lang = preferences.language;
  }, [preferences.language]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.setAttribute(
      'data-reduced-motion',
      effectiveReducedMotion ? 'true' : 'false'
    );
  }, [effectiveReducedMotion]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.setAttribute(
      'data-large-text',
      preferences.largeText ? 'true' : 'false'
    );
  }, [preferences.largeText]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.setAttribute('data-flashing', preferences.flashing ? 'true' : 'false');
    document.documentElement.setAttribute('data-depth-effects', preferences.depthEffects ? 'true' : 'false');
    document.documentElement.setAttribute('data-screen-shake', preferences.screenShake ? 'true' : 'false');
    document.documentElement.setAttribute('data-high-contrast', preferences.highContrast ? 'true' : 'false');
    document.documentElement.setAttribute('data-color-safe', preferences.colorSafe ? 'true' : 'false');
  }, [preferences.flashing, preferences.depthEffects, preferences.screenShake, preferences.highContrast, preferences.colorSafe]);

  // Sync sound manager enabled state
  useEffect(() => {
    soundManager.setSoundEnabled(preferences.sound);
  }, [preferences.sound]);

  // Visibility change listener: pause sound on background, resume on foreground
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const handleVisibilityChange = () => {
      if (document.hidden) {
        soundManager.suspend();
      } else {
        if (preferences.sound) {
          soundManager.resume();
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [preferences.sound]);

  // Update a single preference field
  const updatePreference = useCallback(
    <K extends keyof Preferences>(key: K, value: Preferences[K]) => {
      setPreferences((prev) => {
        const next = { ...prev, [key]: value };
        savePreferences(next);
        return next;
      });
    },
    []
  );

  // Reset all preferences to defaults
  const resetPreferences = useCallback(() => {
    setPreferences(DEFAULT_PREFERENCES);
    savePreferences(DEFAULT_PREFERENCES);
    const initialCaps = getInitialDeviceCaps();
    const initialQ = detectInitialQuality(initialCaps);
    autoEvaluatorRef.current.reset(initialQ);
    setAutoQuality(initialQ);
  }, []);

  // Auto quality 5s window callback
  const handleFpsWindow = useCallback(
    (fps: number) => {
      if (preferences.quality !== 'auto') return;
      const nextQuality = autoEvaluatorRef.current.recordWindowFps(fps);
      setAutoQuality(nextQuality);
    },
    [preferences.quality]
  );

  return {
    preferences,
    effectiveQuality,
    effectiveReducedMotion,
    updatePreference,
    resetPreferences,
    handleFpsWindow,
  };
}
