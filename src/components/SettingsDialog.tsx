import React, { useEffect, useState } from 'react';
import { Preferences } from '../utils/preferences';
import { useTheme, ThemeId } from '../themes';
import { PerformancePanel } from './PerformancePanel';
import { PwaControls } from './PwaControls';
import { Settings, X, Clock, Sliders, Volume2, Zap, Eye, Type, ShieldCheck, ShieldAlert, ChevronDown, Sparkles, Languages, Maximize2, Monitor, Flame, HeartHandshake, Cpu } from 'lucide-react';
import { LANGUAGE_OPTIONS, translate } from '../i18n';
import './ModalsRevamp.css';

interface SettingsDialogProps {
  dialogRef: React.RefObject<HTMLDialogElement>;
  isOpen: boolean;
  onClose: () => void;
  onCancel: (e: React.SyntheticEvent<HTMLDialogElement, Event>) => void;
  preferences: Preferences;
  effectiveQuality: 'standard' | 'low';
  effectiveReducedMotion: boolean;
  onUpdatePreference: <K extends keyof Preferences>(key: K, value: Preferences[K]) => void;
  onResetPreferences: () => void;
  deadlineTimestamp?: number | null;
  serverTimeOffset?: number;
  isGameOver?: boolean;
  phase?: string;
  theme?: ThemeId;
  onSelectTheme?: (theme: ThemeId) => void;
}

export const SettingsDialog: React.FC<SettingsDialogProps> = ({
  dialogRef,
  isOpen,
  onClose,
  onCancel,
  preferences,
  effectiveQuality,
  effectiveReducedMotion,
  onUpdatePreference,
  onResetPreferences,
  deadlineTimestamp = null,
  serverTimeOffset = 0,
  isGameOver = false,
  phase = 'MODE_SELECT',
  theme: propTheme,
  onSelectTheme: propOnSelectTheme,
}) => {
  const { theme: hookTheme, setTheme: hookSetTheme, availableThemes } = useTheme(effectiveQuality);
  const activeTheme = propTheme ?? hookTheme;
  const handleSelectTheme = propOnSelectTheme ?? hookSetTheme;
  const text = (key: Parameters<typeof translate>[0]) => translate(key, preferences.language);

  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const syncFullscreen = () => setIsFullscreen(Boolean(document.fullscreenElement));
    syncFullscreen();
    document.addEventListener('fullscreenchange', syncFullscreen);
    return () => document.removeEventListener('fullscreenchange', syncFullscreen);
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      // Fullscreen is optional and may be denied by the browser or embedding page.
    }
  };

  useEffect(() => {
    const dialog = dialogRef.current;
    if (isOpen && dialog && !dialog.open) dialog.showModal();
  }, [isOpen, dialogRef]);

  // Authoritative server countdown display inside settings
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

  const effectiveQualityLabel = effectiveQuality === 'standard'
    ? text('settings.quality.standard')
    : text('settings.quality.low');

  return (
    <dialog
      ref={dialogRef}
      onCancel={onCancel}
      className="settings-native-dialog"
      aria-labelledby="settings-dialog-title"
    >
      <div className="settings-dialog-content">
        {/* Header */}
        <div className="settings-dialog-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Settings size={20} color="#fcd34d" />
            <h2 id="settings-dialog-title" style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800 }}>
              {text('settings.title')}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={text('settings.close')}
            className="btn-settings-close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Server countdown alert if in an active round */}
        {remainingSeconds !== null && (
          <div className="settings-timer-banner" role="status">
            <Clock size={16} style={{ flexShrink: 0, color: '#f59e0b' }} />
            <div>
              <span style={{ fontWeight: 700 }}>
                {text('settings.timer.action')}
                {remainingSeconds === 0 ? (
                  <span style={{ color: '#ef4444' }}>{text('settings.timer.waiting')}</span>
                ) : (
                  <span style={{ color: '#fcd34d', fontFamily: 'var(--font-mono)' }}>
                    00:{String(remainingSeconds).padStart(2, '0')}
                  </span>
                )}
              </span>
              <span style={{ display: 'block', fontSize: '0.75rem', opacity: 0.85, marginTop: '2px' }}>
                {text('settings.timer.notice')}
              </span>
            </div>
          </div>
        )}

        {/* Main Settings Form */}
        <div className="settings-section-list">
          {/* Category 1: Display & Audio */}
          <section className="settings-group" aria-labelledby="settings-cat-display">
            <div id="settings-cat-display" className="settings-group-header">
              <Monitor size={16} />
              <span>{text('settings.category.display')}</span>
            </div>
            <div className="settings-group-grid">
              {/* Language Selection */}
              <div className="settings-field-card">
                <div className="settings-field-info">
                  <div className="settings-field-label">
                    <Languages size={16} color="#67e8f9" />
                    <span>{text('settings.language.label')}</span>
                  </div>
                  <div className="settings-field-desc">{text('settings.language.description')}</div>
                </div>
                <fieldset className="settings-fieldset" aria-label={text('settings.language.aria')}>
                  {LANGUAGE_OPTIONS.map(({ id, label }) => (
                    <label key={id} className={`settings-radio-label ${preferences.language === id ? 'selected' : ''}`}>
                      <input
                        type="radio"
                        name="game-language-preference"
                        value={id}
                        checked={preferences.language === id}
                        onChange={() => onUpdatePreference('language', id)}
                        className="settings-native-radio"
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </fieldset>
              </div>

              {/* Theme Selection */}
              <div className="settings-field-card">
                <div className="settings-field-info">
                  <div className="settings-field-label">
                    <Sparkles size={16} color="var(--gold-primary)" />
                    <span>{text('settings.theme.label')}</span>
                  </div>
                  <div className="settings-field-desc">{text('settings.theme.description')}</div>
                  <div className="settings-field-sub">
                    {text('settings.theme.current').replace('{name}', activeTheme === 'starry-neon' ? text('settings.theme.starry') : text('settings.theme.classic'))}
                    {effectiveQuality === 'low' && text('settings.theme.lowFallback')}
                  </div>
                </div>
                <fieldset className="settings-fieldset" aria-label={text('settings.theme.aria')}>
                  {availableThemes.map(({ id: key, name }) => (
                    <label
                      key={key}
                      className={`settings-radio-label ${activeTheme === key ? 'selected' : ''}`}
                    >
                      <input
                        type="radio"
                        name="game-theme-preference"
                        value={key}
                        checked={activeTheme === key}
                        onChange={() => handleSelectTheme(key)}
                        className="settings-native-radio"
                      />
                      <span>{key === 'starry-neon' ? text('settings.theme.starry') : key === 'classic' ? text('settings.theme.classic') : name}</span>
                    </label>
                  ))}
                </fieldset>
              </div>

              {/* Quality Mode */}
              <div className="settings-field-card">
                <div className="settings-field-info">
                  <div className="settings-field-label">
                    <Sliders size={16} color="#38bdf8" />
                    <span>{text('settings.quality.label')}</span>
                  </div>
                  <div className="settings-field-desc">{text('settings.quality.description')}</div>
                  <div className="settings-field-sub">{text('settings.quality.effective').replace('{quality}', effectiveQualityLabel)}</div>
                </div>
                <fieldset className="settings-fieldset" aria-label={text('settings.quality.aria')}>
                  {(
                    [
                      { key: 'auto', label: text('settings.quality.auto') },
                      { key: 'standard', label: text('settings.quality.standard') },
                      { key: 'low', label: text('settings.quality.low') },
                    ] as const
                  ).map(({ key, label }) => (
                    <label
                      key={key}
                      className={`settings-radio-label ${preferences.quality === key ? 'selected' : ''}`}
                    >
                      <input
                        type="radio"
                        name="game-quality-preference"
                        value={key}
                        checked={preferences.quality === key}
                        onChange={() => onUpdatePreference('quality', key)}
                        className="settings-native-radio"
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </fieldset>
              </div>

              {/* Sound Toggle */}
              <div className="settings-field-card">
                <div className="settings-field-info">
                  <div className="settings-field-label">
                    <Volume2 size={16} color="#34d399" />
                    <span>{text('settings.sound.label')}</span>
                  </div>
                  <div className="settings-field-desc">{text('settings.sound.description')}</div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={preferences.sound}
                  aria-label={text('settings.sound.label')}
                  onClick={() => onUpdatePreference('sound', !preferences.sound)}
                  className={`settings-toggle-btn ${preferences.sound ? 'checked' : ''}`}
                >
                  <span>{preferences.sound ? text('settings.sound.on') : text('settings.sound.off')}</span>
                </button>
              </div>

              {/* Optional browser fullscreen mode */}
              <div className="settings-field-card">
                <div className="settings-field-info">
                  <div className="settings-field-label">
                    <Maximize2 size={16} color="#a78bfa" />
                    <span>{text('settings.fullscreen.label')}</span>
                  </div>
                  <div className="settings-field-desc">{text('settings.fullscreen.description')}</div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={isFullscreen}
                  aria-label={text('settings.fullscreen.aria')}
                  onClick={() => void toggleFullscreen()}
                  className={`settings-toggle-btn ${isFullscreen ? 'checked' : ''}`}
                >
                  <span>{isFullscreen ? text('settings.fullscreen.exit') : text('settings.fullscreen.enter')}</span>
                </button>
              </div>
            </div>
          </section>

          {/* Category 2: Gameplay & Controls */}
          <section className="settings-group" aria-labelledby="settings-cat-controls">
            <div id="settings-cat-controls" className="settings-group-header">
              <Flame size={16} />
              <span>{text('settings.category.controls')}</span>
            </div>
            <div className="settings-group-grid">
              {/* Fast Mode Toggle */}
              <div className="settings-field-card">
                <div className="settings-field-info">
                  <div className="settings-field-label">
                    <Zap size={16} color="#facc15" />
                    <span>{text('settings.fast.label')}</span>
                  </div>
                  <div className="settings-field-desc">{text('settings.fast.description')}</div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={preferences.fast}
                  aria-label={text('settings.fast.aria')}
                  onClick={() => onUpdatePreference('fast', !preferences.fast)}
                  className={`settings-toggle-btn ${preferences.fast ? 'checked' : ''}`}
                >
                  <span>{preferences.fast ? text('settings.state.on') : text('settings.state.off')}</span>
                </button>
              </div>

              {/* Deal Confirmation */}
              <div className="settings-field-card">
                <div className="settings-field-info">
                  <div className="settings-field-label">
                    <ShieldCheck size={16} color="#60a5fa" />
                    <span>{text('settings.deal.label')}</span>
                  </div>
                  <div className="settings-field-desc">{text('settings.deal.description')}</div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={preferences.confirmDeal}
                  aria-label={text('settings.deal.aria')}
                  onClick={() => onUpdatePreference('confirmDeal', !preferences.confirmDeal)}
                  className={`settings-toggle-btn ${preferences.confirmDeal ? 'checked' : ''}`}
                >
                  <span>{preferences.confirmDeal ? text('settings.state.on') : text('settings.state.off')}</span>
                </button>
              </div>

              {/* Reduced Motion Selection */}
              <div className="settings-field-card">
                <div className="settings-field-info">
                  <div className="settings-field-label">
                    <Eye size={16} color="#c084fc" />
                    <span>{text('settings.motion.label')}</span>
                  </div>
                  <div className="settings-field-desc">{text('settings.motion.description')}</div>
                  <div className="settings-field-sub">
                    {effectiveReducedMotion ? text('settings.motion.on') : text('settings.motion.off')}
                  </div>
                </div>
                <fieldset className="settings-fieldset" aria-label={text('settings.motion.aria')}>
                  {(
                    [
                      { key: 'system', label: text('settings.motion.system') },
                      { key: 'on', label: text('settings.motion.on') },
                      { key: 'off', label: text('settings.motion.off') },
                    ] as const
                  ).map(({ key, label }) => (
                    <label
                      key={key}
                      className={`settings-radio-label ${preferences.reducedMotion === key ? 'selected' : ''}`}
                    >
                      <input
                        type="radio"
                        name="reduced-motion-preference"
                        value={key}
                        checked={preferences.reducedMotion === key}
                        onChange={() => onUpdatePreference('reducedMotion', key)}
                        className="settings-native-radio"
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </fieldset>
              </div>
            </div>
          </section>

          {/* Category 3: Accessibility & Sensory */}
          <section className="settings-group" aria-labelledby="settings-cat-access">
            <div id="settings-cat-access" className="settings-group-header">
              <HeartHandshake size={16} />
              <span>{text('settings.category.accessibility')}</span>
            </div>
            <div className="settings-group-grid single-col">
              {/* Large Text Mode */}
              <div className="settings-field-card">
                <div className="settings-field-info">
                  <div className="settings-field-label">
                    <Type size={16} color="#f472b6" />
                    <span>{text('settings.largeText.label')}</span>
                  </div>
                  <div className="settings-field-desc">{text('settings.largeText.description')}</div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={preferences.largeText}
                  aria-label={text('settings.largeText.aria')}
                  onClick={() => onUpdatePreference('largeText', !preferences.largeText)}
                  className={`settings-toggle-btn ${preferences.largeText ? 'checked' : ''}`}
                >
                  <span>{preferences.largeText ? text('settings.state.on') : text('settings.state.off')}</span>
                </button>
              </div>

              {/* Accessibility Effects */}
              <div className="settings-field-card">
                <div className="settings-field-info">
                  <div className="settings-field-label">
                    <ShieldAlert size={16} color="#fb7185" />
                    <span>{text('settings.sensory.label')}</span>
                  </div>
                  <div className="settings-field-desc">{text('settings.sensory.description')}</div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '8px', minWidth: '220px', width: '100%', marginTop: '8px' }}>
                  {([
                    ['haptics', text('settings.accessibility.haptics')],
                    ['flashing', text('settings.accessibility.flashing')],
                    ['depthEffects', text('settings.accessibility.depthEffects')],
                    ['screenShake', text('settings.accessibility.screenShake')],
                    ['highContrast', text('settings.accessibility.highContrast')],
                    ['colorSafe', text('settings.accessibility.colorSafe')],
                  ] as const).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      role="switch"
                      aria-checked={preferences[key]}
                      onClick={() => onUpdatePreference(key, !preferences[key])}
                      className={`settings-toggle-btn ${preferences[key] ? 'checked' : ''}`}
                      style={{ minHeight: '40px', fontSize: '0.8rem', padding: '6px 10px' }}
                    >
                      {label}: {preferences[key] ? text('settings.toggle.open') : text('settings.toggle.closed')}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* Category 4: System & Diagnostics */}
          <section className="settings-group" aria-labelledby="settings-cat-sys">
            <div id="settings-cat-sys" className="settings-group-header">
              <Cpu size={16} />
              <span>{text('settings.category.system')}</span>
            </div>
            {/* Collapsible Diagnostics & Performance Panel */}
            <details className="settings-diagnostics-details">
              <summary className="settings-diagnostics-summary">
                <span>{text('settings.diagnostics')}</span>
                <ChevronDown size={16} className="summary-chevron" />
              </summary>
              <div style={{ marginTop: '12px' }}>
                <PerformancePanel
                  qualityPref={preferences.quality}
                  effectiveQuality={effectiveQuality}
                  phase={phase}
                  isOpen={isOpen}
                />
              </div>
            </details>
            <div style={{ marginTop: '10px' }}>
              <PwaControls activeGame={phase !== 'MODE_SELECT' && !isGameOver} />
            </div>
          </section>
        </div>

        {/* Footer Actions */}
        <div className="settings-dialog-footer">
          <button
            type="button"
            onClick={() => {
              onResetPreferences();
              handleSelectTheme('classic');
            }}
            className="btn-settings-reset"
          >
            {text('settings.reset')}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="btn-settings-done"
          >
            {text('settings.done')}
          </button>
        </div>
      </div>
    </dialog>
  );
};
