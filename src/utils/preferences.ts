export type QualityPreference = 'auto' | 'standard' | 'low';
export type ReducedMotionPreference = 'system' | 'on' | 'off';
import { DEFAULT_LANGUAGE, type LanguagePreference } from '../i18n';
export type { LanguagePreference } from '../i18n';

export interface Preferences {
  language: LanguagePreference;
  quality: QualityPreference;
  sound: boolean;
  fast: boolean;
  reducedMotion: ReducedMotionPreference;
  largeText: boolean;
  confirmDeal: boolean;
  haptics: boolean;
  flashing: boolean;
  depthEffects: boolean;
  screenShake: boolean;
  highContrast: boolean;
  colorSafe: boolean;
}

export const PREFERENCES_STORAGE_KEY = 'bubble_fortune_preferences_v1';

export const DEFAULT_PREFERENCES: Preferences = {
  language: DEFAULT_LANGUAGE,
  quality: 'auto',
  sound: false,
  fast: false,
  reducedMotion: 'system',
  largeText: false,
  confirmDeal: false,
  haptics: true,
  flashing: true,
  depthEffects: true,
  screenShake: true,
  highContrast: false,
  colorSafe: false,
};

export interface DeviceCapabilities {
  saveData?: boolean;
  deviceMemory?: number;
  hardwareConcurrency?: number;
}

export function parsePreferences(raw: string | null): Preferences {
  if (!raw || typeof raw !== 'string') {
    return { ...DEFAULT_PREFERENCES };
  }

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ...DEFAULT_PREFERENCES };
    }

    const language: LanguagePreference =
      parsed.language === 'en-US' || parsed.language === 'zh-CN'
        ? parsed.language
        : DEFAULT_PREFERENCES.language;

    const quality: QualityPreference =
      parsed.quality === 'standard' || parsed.quality === 'low' || parsed.quality === 'auto'
        ? parsed.quality
        : DEFAULT_PREFERENCES.quality;

    const sound = typeof parsed.sound === 'boolean' ? parsed.sound : DEFAULT_PREFERENCES.sound;
    const fast = typeof parsed.fast === 'boolean' ? parsed.fast : DEFAULT_PREFERENCES.fast;

    const reducedMotion: ReducedMotionPreference =
      parsed.reducedMotion === 'on' || parsed.reducedMotion === 'off' || parsed.reducedMotion === 'system'
        ? parsed.reducedMotion
        : DEFAULT_PREFERENCES.reducedMotion;

    const largeText =
      typeof parsed.largeText === 'boolean' ? parsed.largeText : DEFAULT_PREFERENCES.largeText;

    const confirmDeal =
      typeof parsed.confirmDeal === 'boolean' ? parsed.confirmDeal : DEFAULT_PREFERENCES.confirmDeal;

    const haptics = typeof parsed.haptics === 'boolean' ? parsed.haptics : DEFAULT_PREFERENCES.haptics;
    const flashing = typeof parsed.flashing === 'boolean' ? parsed.flashing : DEFAULT_PREFERENCES.flashing;
    const depthEffects = typeof parsed.depthEffects === 'boolean' ? parsed.depthEffects : DEFAULT_PREFERENCES.depthEffects;
    const screenShake = typeof parsed.screenShake === 'boolean' ? parsed.screenShake : DEFAULT_PREFERENCES.screenShake;
    const highContrast = typeof parsed.highContrast === 'boolean' ? parsed.highContrast : DEFAULT_PREFERENCES.highContrast;
    const colorSafe = typeof parsed.colorSafe === 'boolean' ? parsed.colorSafe : DEFAULT_PREFERENCES.colorSafe;

    return {
      language,
      quality,
      sound,
      fast,
      reducedMotion,
      largeText,
      confirmDeal,
      haptics,
      flashing,
      depthEffects,
      screenShake,
      highContrast,
      colorSafe,
    };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

export function loadPreferences(): Preferences {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return { ...DEFAULT_PREFERENCES };
    }
    const raw = window.localStorage.getItem(PREFERENCES_STORAGE_KEY);
    return parsePreferences(raw);
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

export function savePreferences(preferences: Preferences): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }
    window.localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Graceful ignore if localStorage is restricted (incognito/security error)
  }
}

export function resolveReducedMotion(
  pref: ReducedMotionPreference,
  systemPrefersReduced: boolean
): boolean {
  if (pref === 'on') return true;
  if (pref === 'off') return false;
  return systemPrefersReduced;
}

export function detectInitialQuality(caps?: DeviceCapabilities): 'standard' | 'low' {
  if (!caps) return 'standard';
  if (caps.saveData === true) return 'low';
  if (caps.deviceMemory !== undefined && caps.deviceMemory < 4) return 'low';
  if (caps.hardwareConcurrency !== undefined && caps.hardwareConcurrency < 4) return 'low';
  return 'standard';
}

export class AutoQualityEvaluator {
  private lowFpsWindowCount = 0;
  private currentQuality: 'standard' | 'low';

  constructor(initialQuality: 'standard' | 'low' = 'standard') {
    this.currentQuality = initialQuality;
  }

  public recordWindowFps(fps: number): 'standard' | 'low' {
    if (this.currentQuality === 'low') {
      return 'low';
    }

    if (fps < 30) {
      this.lowFpsWindowCount++;
      if (this.lowFpsWindowCount >= 2) {
        this.currentQuality = 'low';
      }
    } else {
      this.lowFpsWindowCount = 0;
    }

    return this.currentQuality;
  }

  public getQuality(): 'standard' | 'low' {
    return this.currentQuality;
  }

  public reset(initialQuality: 'standard' | 'low' = 'standard') {
    this.currentQuality = initialQuality;
    this.lowFpsWindowCount = 0;
  }
}

export interface ValidateDealAcceptanceParams {
  confirmingOffer: { offerId: string; amount: number } | null;
  currentOfferId?: string | null;
  currentOfferAmount?: number | null;
  currentPhase: string;
  isPending?: boolean;
  deadlineTimestamp?: number | null;
  serverNow?: number;
  requireDeadline?: boolean;
  networkBufferMs?: number;
}

export function validateDealAcceptance(params: ValidateDealAcceptanceParams): {
  valid: boolean;
  reason?: 'NO_OFFER' | 'ID_MISMATCH' | 'AMOUNT_MISMATCH' | 'PHASE_MISMATCH' | 'PENDING' | 'EXPIRED';
} {
  const {
    confirmingOffer,
    currentOfferId,
    currentOfferAmount,
    currentPhase,
    isPending,
    deadlineTimestamp,
    serverNow,
    requireDeadline = false,
    networkBufferMs = 0,
  } = params;

  if (isPending) {
    return { valid: false, reason: 'PENDING' };
  }

  if (currentPhase !== 'BANKER_OFFER') {
    return { valid: false, reason: 'PHASE_MISMATCH' };
  }

  if (!confirmingOffer || !confirmingOffer.offerId || confirmingOffer.offerId.trim() === '') {
    return { valid: false, reason: 'NO_OFFER' };
  }

  if (
    typeof confirmingOffer.amount !== 'number' ||
    !Number.isFinite(confirmingOffer.amount) ||
    confirmingOffer.amount <= 0
  ) {
    return { valid: false, reason: 'AMOUNT_MISMATCH' };
  }

  if (!currentOfferId || currentOfferId.trim() === '' || currentOfferId !== confirmingOffer.offerId) {
    return { valid: false, reason: 'ID_MISMATCH' };
  }

  if (
    typeof currentOfferAmount !== 'number' ||
    !Number.isFinite(currentOfferAmount) ||
    currentOfferAmount <= 0 ||
    currentOfferAmount !== confirmingOffer.amount
  ) {
    return { valid: false, reason: 'AMOUNT_MISMATCH' };
  }

  if (requireDeadline) {
    if (
      deadlineTimestamp === null ||
      deadlineTimestamp === undefined ||
      !Number.isFinite(deadlineTimestamp) ||
      deadlineTimestamp <= 0
    ) {
      return { valid: false, reason: 'EXPIRED' };
    }
  }

  if (deadlineTimestamp !== null && deadlineTimestamp !== undefined) {
    if (!Number.isFinite(deadlineTimestamp) || deadlineTimestamp <= 0) {
      return { valid: false, reason: 'EXPIRED' };
    }
    const now = serverNow ?? Date.now();
    const buffer = typeof networkBufferMs === 'number' ? networkBufferMs : 0;
    if (!Number.isFinite(now) || !Number.isFinite(buffer) || buffer < 0 || (now + buffer) >= deadlineTimestamp) {
      return { valid: false, reason: 'EXPIRED' };
    }
  }

  return { valid: true };
}
