import { getLanguage, translate, type LanguagePreference } from '../i18n';

export type ThemeId = 'classic' | 'starry-neon';

export interface ThemeTokens {
  // Backgrounds
  bgDark: string;
  bgBase: string;
  bgStage: string;
  bgPanel: string;

  // Primary Accent (Gold in classic, Neon Cyan in starry-neon)
  goldPrimary: string;
  goldLight: string;
  goldDark: string;
  goldGlow: string;

  // Low Tier
  lowTierBlue: string;
  lowTierCyan: string;
  lowTierBg: string;
  borderGlowBlue: string;

  // High Tier
  highTierRed: string;
  highTierPink: string;
  highTierBg: string;
  borderGlowPink: string;

  // Glow & Glass Borders
  borderGlowPurple: string;
  borderGlass: string;
  borderGold: string;
  shadowNeon: string;
  glassBlur: string;

  // Text
  textPrimary: string;
  textSecondary: string;
  textGold: string;

  // 3D Lighting Tokens
  stageAmbientLight: string;
  stageKeyLight: string;
  stageRimLight: string;
}

export interface ThemeAssetManifest {
  avatarConservative: string;
  avatarAggressive: string;
  avatarCold: string;
}

export interface ThemeDefinition {
  id: ThemeId;
  name: string;
  tagline: string;
  description: string;
  previewColors: {
    primary: string;
    secondary: string;
    background: string;
    accent: string;
  };
  tokens: ThemeTokens;
  lowQualityFallbackTokens: Partial<ThemeTokens>;
  assets: ThemeAssetManifest;
}

export const CLASSIC_THEME: ThemeDefinition = {
  id: 'classic',
  name: '经典紫金演播厅',
  tagline: '传统经典 · 奢华紫金',
  description: '经典大奖演播厅风格，黑曜石底衬配合紫檀与金属流金，沉稳大气。',
  previewColors: {
    primary: '#f59e0b',
    secondary: '#3b82f6',
    background: '#0B0C1E',
    accent: '#e11d48',
  },
  tokens: {
    bgDark: '#07090e',
    bgBase: '#0B0C1E',
    bgStage: 'radial-gradient(circle at center, #1A1B41 0%, #0B0C1E 100%)',
    bgPanel: 'rgba(26, 27, 65, 0.6)',
    goldPrimary: '#f59e0b',
    goldLight: '#fcd34d',
    goldDark: '#b45309',
    goldGlow: 'rgba(250, 204, 21, 0.5)',
    lowTierBlue: '#3b82f6',
    lowTierCyan: '#06b6d4',
    lowTierBg: 'rgba(59, 130, 246, 0.12)',
    borderGlowBlue: 'rgba(59, 130, 246, 0.4)',
    highTierRed: '#e11d48',
    highTierPink: '#f472b6',
    highTierBg: 'rgba(225, 29, 72, 0.15)',
    borderGlowPink: 'rgba(236, 72, 153, 0.4)',
    borderGlowPurple: 'rgba(139, 92, 246, 0.4)',
    borderGlass: 'rgba(255, 255, 255, 0.1)',
    borderGold: 'rgba(245, 158, 11, 0.4)',
    shadowNeon: '0 0 25px rgba(245, 158, 11, 0.2)',
    glassBlur: 'blur(16px)',
    textPrimary: '#FFFFFF',
    textSecondary: '#9CA3AF',
    textGold: '#FACC15',
    stageAmbientLight: '#ffffff',
    stageKeyLight: '#fef08a',
    stageRimLight: '#c084fc',
  },
  lowQualityFallbackTokens: {
    bgStage: '#0B0C1E',
    bgPanel: 'rgba(26, 27, 65, 0.9)',
    shadowNeon: 'none',
    glassBlur: 'none',
  },
  assets: {
    avatarConservative: '/assets/character_banker_thinking.png',
    avatarAggressive: '/assets/character_banker_confident.png',
    avatarCold: '/assets/character_banker_sinister.png',
  },
};

export const STARRY_NEON_THEME: ThemeDefinition = {
  id: 'starry-neon',
  name: '星夜霓虹',
  tagline: '未来赛博 · 星河幻彩',
  description: '原创星夜霓虹电竞风格，以深空群星为幕，青蓝荧光与洋红脉冲交织，极具未来科幻张力。',
  previewColors: {
    primary: '#00f0ff',
    secondary: '#38bdf8',
    background: '#060919',
    accent: '#ff007f',
  },
  tokens: {
    bgDark: '#02040b',
    bgBase: '#060919',
    bgStage: 'radial-gradient(circle at 50% 30%, #15103a 0%, #060919 60%, #02040b 100%)',
    bgPanel: 'rgba(14, 18, 44, 0.72)',
    goldPrimary: '#00f0ff',
    goldLight: '#67e8f9',
    goldDark: '#0891b2',
    goldGlow: 'rgba(0, 240, 255, 0.5)',
    lowTierBlue: '#2563eb',
    lowTierCyan: '#00f0ff',
    lowTierBg: 'rgba(0, 240, 255, 0.12)',
    borderGlowBlue: 'rgba(0, 240, 255, 0.4)',
    highTierRed: '#f43f5e',
    highTierPink: '#ff007f',
    highTierBg: 'rgba(255, 0, 127, 0.15)',
    borderGlowPink: 'rgba(255, 0, 127, 0.4)',
    borderGlowPurple: 'rgba(168, 85, 247, 0.4)',
    borderGlass: 'rgba(0, 240, 255, 0.18)',
    borderGold: 'rgba(0, 240, 255, 0.45)',
    shadowNeon: '0 0 28px rgba(0, 240, 255, 0.35)',
    glassBlur: 'blur(16px)',
    textPrimary: '#F8FAFC',
    textSecondary: '#94A3B8',
    textGold: '#00f0ff',
    stageAmbientLight: '#818cf8',
    stageKeyLight: '#00f0ff',
    stageRimLight: '#f43f5e',
  },
  lowQualityFallbackTokens: {
    bgStage: '#060919',
    bgPanel: 'rgba(14, 18, 44, 0.92)',
    shadowNeon: 'none',
    glassBlur: 'none',
  },
  assets: {
    avatarConservative: '/assets/character_banker_thinking.png',
    avatarAggressive: '/assets/character_banker_confident.png',
    avatarCold: '/assets/character_banker_sinister.png',
  },
};

export const THEMES: readonly ThemeDefinition[] = [CLASSIC_THEME, STARRY_NEON_THEME] as const;
export const DEFAULT_THEME_ID: ThemeId = 'classic';
export const THEME_STORAGE_KEY = 'bubble_fortune_theme_v1';

export function getThemeDisplayName(id: ThemeId, language: LanguagePreference = getLanguage()): string {
  return translate(id === 'starry-neon' ? 'settings.theme.starry' : 'settings.theme.classic', language);
}

const TOKEN_TO_CSS_VAR: Record<keyof ThemeTokens, string> = {
  bgDark: '--bg-dark',
  bgBase: '--bg-base',
  bgStage: '--bg-stage',
  bgPanel: '--bg-panel',
  goldPrimary: '--gold-primary',
  goldLight: '--gold-light',
  goldDark: '--gold-dark',
  goldGlow: '--gold-glow',
  lowTierBlue: '--low-tier-blue',
  lowTierCyan: '--low-tier-cyan',
  lowTierBg: '--low-tier-bg',
  borderGlowBlue: '--border-glow-blue',
  highTierRed: '--high-tier-red',
  highTierPink: '--high-tier-pink',
  highTierBg: '--high-tier-bg',
  borderGlowPink: '--border-glow-pink',
  borderGlowPurple: '--border-glow-purple',
  borderGlass: '--border-glass',
  borderGold: '--border-gold',
  shadowNeon: '--shadow-neon',
  glassBlur: '--glass-blur',
  textPrimary: '--text-primary',
  textSecondary: '--text-secondary',
  textGold: '--text-gold',
  stageAmbientLight: '--stage-ambient-light',
  stageKeyLight: '--stage-key-light',
  stageRimLight: '--stage-rim-light',
};

/**
 * Get ThemeDefinition by ID with safe fallback to classic.
 */
export function getTheme(id: string | null | undefined): ThemeDefinition {
  if (id === 'starry-neon') return STARRY_NEON_THEME;
  return CLASSIC_THEME;
}

/**
 * Apply theme tokens to DOM root element (:root / document.documentElement).
 * Gracefully merges low-quality fallbacks when isLowQuality is active.
 * Theme change ONLY modifies colors, lighting, and UI tokens; game rules are never touched.
 */
export function applyThemeTokens(id: ThemeId, isLowQuality = false): void {
  if (typeof document === 'undefined') return;

  const themeDef = getTheme(id);
  const root = document.documentElement;

  // Set data-theme attribute for CSS conditional selector matching
  root.setAttribute('data-theme', themeDef.id);

  // Compute merged tokens (base tokens overridden by lowQualityFallback if enabled)
  const activeTokens: ThemeTokens = {
    ...themeDef.tokens,
    ...(isLowQuality ? themeDef.lowQualityFallbackTokens : {}),
  };

  // Set CSS custom properties on root
  for (const [key, cssVar] of Object.entries(TOKEN_TO_CSS_VAR)) {
    const value = activeTokens[key as keyof ThemeTokens];
    if (value !== undefined) {
      root.style.setProperty(cssVar, value);
    }
  }
}
