import React, { useState, useEffect, useCallback } from 'react';
import {
  globalPerformanceSampler,
  PerformanceStats,
  DiagnosticSnapshot,
  WebGLStats,
} from '../utils/performance';
import { Play, Square, Trash2, Download, Check, Activity, Box, Layers } from 'lucide-react';
import { getLanguage, translate, type TranslationKey } from '../i18n';

interface PerformancePanelProps {
  qualityPref: string;
  effectiveQuality: string;
  phase: string;
  isOpen: boolean;
}

export const PerformancePanel: React.FC<PerformancePanelProps> = ({
  qualityPref,
  effectiveQuality,
  phase,
  isOpen,
}) => {
  const text = (key: TranslationKey, replacements: Record<string, string | number> = {}) =>
    Object.entries(replacements).reduce(
      (value, [name, replacement]) => value.replace(new RegExp(`\\{${name}\\}`, 'g'), String(replacement)),
      translate(key, getLanguage()),
    );
  const [isSampling, setIsSampling] = useState<boolean>(() =>
    globalPerformanceSampler.getIsSampling()
  );
  const [stats, setStats] = useState<PerformanceStats>(() =>
    globalPerformanceSampler.getStats()
  );
  const [webgl, setWebgl] = useState<WebGLStats | null>(() =>
    globalPerformanceSampler.getWebGLStats()
  );
  const [exported, setExported] = useState(false);

  // Sync sampler context on phase or quality change
  useEffect(() => {
    globalPerformanceSampler.updateContext(phase, effectiveQuality, qualityPref);
  }, [phase, effectiveQuality, qualityPref]);

  // Poll stats ONLY when dialog is open
  useEffect(() => {
    if (!isOpen) return;

    // Synchronize immediately upon opening
    setIsSampling(globalPerformanceSampler.getIsSampling());
    setStats(globalPerformanceSampler.getStats());
    setWebgl(globalPerformanceSampler.getWebGLStats());

    const timer = setInterval(() => {
      setIsSampling(globalPerformanceSampler.getIsSampling());
      setStats(globalPerformanceSampler.getStats());
      setWebgl(globalPerformanceSampler.getWebGLStats());
    }, 500);

    return () => clearInterval(timer);
  }, [isOpen]);

  const handleToggleSampling = useCallback(() => {
    if (isSampling) {
      globalPerformanceSampler.stop();
      setIsSampling(false);
    } else {
      globalPerformanceSampler.updateContext(phase, effectiveQuality, qualityPref);
      globalPerformanceSampler.start();
      setIsSampling(true);
    }
    setStats(globalPerformanceSampler.getStats());
  }, [isSampling, phase, effectiveQuality, qualityPref]);

  const handleClear = useCallback(() => {
    globalPerformanceSampler.clear();
    setStats(globalPerformanceSampler.getStats());
  }, []);

  const handleExportJson = useCallback(() => {
    const snapshot: DiagnosticSnapshot = globalPerformanceSampler.createSnapshot({
      qualityPref,
      effectiveQuality,
      phase,
    });

    const jsonStr = JSON.stringify(snapshot, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bubble-fortune-perf-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    setExported(true);
    setTimeout(() => setExported(false), 2000);
  }, [qualityPref, effectiveQuality, phase]);

  const nav = typeof navigator !== 'undefined' ? (navigator as any) : {};
  const loadDuration = globalPerformanceSampler.getLoadDuration();
  const viewportOrientation = typeof window === 'undefined'
    ? text('settings.performance.unknown')
    : window.innerWidth === window.innerHeight
      ? text('settings.performance.orientation.square')
      : window.innerWidth > window.innerHeight ? text('settings.performance.orientation.landscape') : text('settings.performance.orientation.portrait');

  return (
    <div className="perf-panel" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {/* Sampling Control Bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={handleToggleSampling}
          aria-label={isSampling ? text('settings.performance.stop') : text('settings.performance.start')}
          className={`btn-perf-action ${isSampling ? 'active-stop' : 'active-start'}`}
          style={{
            minHeight: '44px',
            minWidth: '44px',
            padding: '8px 16px',
            borderRadius: '10px',
            border: 'none',
            background: isSampling ? '#ef4444' : '#10b981',
            color: '#ffffff',
            fontWeight: 700,
            fontSize: '0.85rem',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          {isSampling ? <Square size={16} /> : <Play size={16} />}
          <span>{isSampling ? text('settings.performance.stop') : text('settings.performance.start')}</span>
        </button>

        <button
          type="button"
          onClick={handleClear}
          aria-label={text('settings.performance.clear')}
          style={{
            minHeight: '44px',
            minWidth: '44px',
            padding: '8px 14px',
            borderRadius: '10px',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            background: 'rgba(255, 255, 255, 0.05)',
            color: '#9ca3af',
            fontWeight: 600,
            fontSize: '0.85rem',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <Trash2 size={16} />
          <span>{text('settings.performance.clear')}</span>
        </button>

        <button
          type="button"
          onClick={handleExportJson}
          aria-label={text('settings.performance.exportAria')}
          style={{
            minHeight: '44px',
            minWidth: '44px',
            padding: '8px 16px',
            borderRadius: '10px',
            border: '1px solid rgba(245, 158, 11, 0.4)',
            background: 'rgba(245, 158, 11, 0.15)',
            color: '#fcd34d',
            fontWeight: 700,
            fontSize: '0.85rem',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            marginLeft: 'auto',
          }}
        >
          {exported ? <Check size={16} /> : <Download size={16} />}
          <span>{exported ? text('settings.performance.exported') : text('settings.performance.export')}</span>
        </button>
      </div>

      {/* Status indicator */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8rem', color: '#9ca3af' }}>
        <span
          style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: isSampling ? '#10b981' : '#6b7280',
            boxShadow: isSampling ? '0 0 8px #10b981' : 'none',
          }}
        />
        <span>
          {isSampling
            ? text('settings.performance.sampling', { current: stats.sampleCount, max: stats.maxSamples })
            : text('settings.performance.paused', { count: stats.sampleCount })}
        </span>
      </div>

      {/* Metrics Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
          gap: '10px',
        }}
      >
        <div className="perf-metric-card">
          <div className="perf-metric-label">
            <Activity size={13} /> {text('settings.performance.fps')}
          </div>
          <div className="perf-metric-value" style={{ color: stats.fps >= 30 ? '#10b981' : '#f59e0b' }}>
            {stats.sampleCount > 0 ? stats.fps : text('settings.performance.unmeasured')}
          </div>
        </div>

        <div className="perf-metric-card">
          <div className="perf-metric-label">{text('settings.performance.frameP50')}</div>
          <div className="perf-metric-value">
            {stats.p50FrameTimeMs > 0 ? `${stats.p50FrameTimeMs.toFixed(1)} ms` : text('settings.performance.unmeasured')}
          </div>
        </div>

        <div className="perf-metric-card">
          <div className="perf-metric-label">{text('settings.performance.frameP95')}</div>
          <div className="perf-metric-value" style={{ color: stats.p95FrameTimeMs > 33.3 ? '#ef4444' : '#ffffff' }}>
            {stats.p95FrameTimeMs > 0 ? `${stats.p95FrameTimeMs.toFixed(1)} ms` : text('settings.performance.unmeasured')}
          </div>
        </div>

        <div className="perf-metric-card">
          <div className="perf-metric-label">
            <Box size={13} /> {text('settings.performance.assetLoad')}
          </div>
          <div className="perf-metric-value">
            {loadDuration !== null ? `${loadDuration} ms` : text('settings.performance.unmeasured')}
          </div>
        </div>

        <div className="perf-metric-card">
          <div className="perf-metric-label">
            <Layers size={13} /> {text('settings.performance.renderStats')}
          </div>
          <div className="perf-metric-value" style={{ fontSize: '0.9rem' }}>
            {webgl ? `${webgl.calls} / ${webgl.triangles}` : text('settings.performance.unmeasured')}
          </div>
        </div>

        <div className="perf-metric-card">
          <div className="perf-metric-label">{text('settings.performance.textureCount')}</div>
          <div className="perf-metric-value">
            {webgl ? `${webgl.textures}` : text('settings.performance.unmeasured')}
          </div>
        </div>
      </div>

      {/* Context & Device Breakdown */}
      <div
        style={{
          background: 'rgba(0, 0, 0, 0.3)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: '10px',
          padding: '10px 14px',
          fontSize: '0.78rem',
          color: '#9ca3af',
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>{text('settings.performance.qualityMode')}</span>
          <span style={{ color: '#fcd34d', fontWeight: 600 }}>
            {qualityPref === 'auto' ? text('settings.quality.auto') : qualityPref === 'standard' ? text('settings.quality.standard') : text('settings.quality.low')} ({text('settings.performance.current').replace('{quality}', effectiveQuality === 'standard' ? text('settings.quality.standard') : text('settings.quality.low'))})
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>{text('settings.performance.phase')}</span>
          <span style={{ color: '#ffffff', fontWeight: 600 }}>{phase}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>{text('settings.performance.viewport')}</span>
          <span style={{ color: '#ffffff' }}>
            {typeof window !== 'undefined' ? `${window.innerWidth}×${window.innerHeight}` : '0×0'} @{' '}
            {typeof window !== 'undefined' ? window.devicePixelRatio : 1}x · {viewportOrientation}
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>{text('settings.performance.cpuMemory')}</span>
          <span style={{ color: '#ffffff' }}>
            {nav.hardwareConcurrency ? text('settings.performance.threads', { count: nav.hardwareConcurrency }) : text('settings.performance.unknown')} ·{' '}
            {nav.deviceMemory ? text('settings.performance.memory', { count: nav.deviceMemory }) : text('settings.performance.unknown')}
            {nav.connection?.saveData ? text('settings.performance.saveData') : ''}
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>{text('settings.performance.network')}</span>
          <span style={{ color: '#ffffff' }}>
            {nav.connection?.effectiveType || text('settings.performance.unknown')} · {typeof nav.connection?.rtt === 'number' ? text('settings.performance.rtt', { value: `${nav.connection.rtt} ms` }) : text('settings.performance.rtt', { value: text('settings.performance.unknown') })} ·{' '}
            {typeof nav.connection?.downlink === 'number' ? `${nav.connection.downlink} Mbps` : text('settings.performance.unknown')}
          </span>
        </div>
        {stats.fluctuation && (
          <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '4px' }}>
            <span>{text('settings.performance.fluctuation')}</span>
            <span style={{ color: '#38bdf8' }}>
              min {stats.fluctuation.minFrameTimeMs}ms / max {stats.fluctuation.maxFrameTimeMs}ms / avg {stats.fluctuation.avgFrameTimeMs}ms
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
