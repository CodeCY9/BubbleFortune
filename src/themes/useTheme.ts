import { useState, useEffect, useCallback } from 'react';
import {
  ThemeId,
  ThemeDefinition,
  THEMES,
  DEFAULT_THEME_ID,
  THEME_STORAGE_KEY,
  getTheme,
  applyThemeTokens,
  getThemeDisplayName,
} from './registry';

function loadStoredTheme(): ThemeId {
  if (typeof window === 'undefined' || !window.localStorage) {
    return DEFAULT_THEME_ID;
  }
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (raw === 'starry-neon' || raw === 'classic') {
      return raw;
    }
  } catch {
    // Graceful fallback
  }
  return DEFAULT_THEME_ID;
}

function saveStoredTheme(themeId: ThemeId): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, themeId);
  } catch {
    // Graceful ignore
  }
}

export function useTheme(effectiveQuality?: 'standard' | 'low') {
  const [theme, setThemeState] = useState<ThemeId>(() => loadStoredTheme());
  const [enabledThemeIds, setEnabledThemeIds] = useState<ThemeId[]>(() => THEMES.map((item) => item.id));
  const isLowQuality = effectiveQuality === 'low';

  // Runtime theme flags are public, cache-free operational configuration.
  // Local preference remains authoritative while the selected theme is enabled.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const controller = new AbortController();
    fetch('/api/themes', { cache: 'no-store', signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: unknown) => {
        const value = payload as { activeTheme?: unknown; availableThemes?: unknown } | null;
        const ids = Array.isArray(value?.availableThemes)
          ? value!.availableThemes.filter((id): id is ThemeId => id === 'classic' || id === 'starry-neon')
          : [];
        if (ids.length === 0) return;
        setEnabledThemeIds(ids);
        setThemeState((current) => ids.includes(current) ? current : (ids.includes(value?.activeTheme as ThemeId) ? value!.activeTheme as ThemeId : 'classic'));
      })
      .catch(() => { /* Keep the local theme if the optional manifest is unavailable. */ });
    return () => controller.abort();
  }, []);

  // Apply theme tokens whenever theme or quality profile updates
  useEffect(() => {
    applyThemeTokens(theme, isLowQuality);
  }, [theme, isLowQuality]);

  const setTheme = useCallback((newTheme: ThemeId) => {
    if (!enabledThemeIds.includes(newTheme)) return;
    setThemeState(newTheme);
    saveStoredTheme(newTheme);
    // Custom event to synchronize sibling instances/components if needed
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('bf-theme-changed', { detail: newTheme }));
    }
  }, [enabledThemeIds]);

  // Listen to cross-window or sibling theme updates
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleCustomChange = (e: Event) => {
      const customEvent = e as CustomEvent<ThemeId>;
      if (customEvent.detail && customEvent.detail !== theme) {
        setThemeState(customEvent.detail);
      }
    };

    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === THEME_STORAGE_KEY && e.newValue) {
        if (e.newValue === 'starry-neon' || e.newValue === 'classic') {
          setThemeState(e.newValue);
        }
      }
    };

    window.addEventListener('bf-theme-changed', handleCustomChange);
    window.addEventListener('storage', handleStorageChange);
    return () => {
      window.removeEventListener('bf-theme-changed', handleCustomChange);
      window.removeEventListener('storage', handleStorageChange);
    };
  }, [theme]);

  const themeDefinition: ThemeDefinition = getTheme(theme);

  return {
    theme,
    setTheme,
    themeDefinition,
    availableThemes: THEMES.filter((item) => enabledThemeIds.includes(item.id)).map((item) => ({
      ...item,
      name: getThemeDisplayName(item.id),
    })),
    isLowQuality,
  };
}
