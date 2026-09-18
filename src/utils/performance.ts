export interface WebGLStats {
  calls: number;
  triangles: number;
  textures: number;
}

export interface SampleItem {
  frameTimeMs: number;
  timestamp: number;
  phase: string;
  quality: string;
}

export interface FluctuationSummary {
  minFrameTimeMs: number;
  maxFrameTimeMs: number;
  avgFrameTimeMs: number;
  p50FrameTimeMs: number;
  p95FrameTimeMs: number;
}

export interface PerformanceStats {
  fps: number;
  p50FrameTimeMs: number;
  p95FrameTimeMs: number;
  sampleCount: number;
  maxSamples: number;
  fluctuation: FluctuationSummary | null;
  phase: string;
  quality: string;
}

export interface DiagnosticSnapshot {
  exportedAt: string;
  samplingStats: PerformanceStats;
  fluctuation: FluctuationSummary | null;
  webgl: WebGLStats | null;
  device: {
    userAgent: string;
    platform?: string;
    language?: string;
    deviceMemory?: number;
    hardwareConcurrency?: number;
    saveData?: boolean;
  };
  viewport: {
    width: number;
    height: number;
    dpr: number;
    orientation: 'portrait' | 'landscape' | 'unknown';
  };
  network: {
    effectiveType?: string;
    rttMs?: number;
    downlinkMbps?: number;
    saveData?: boolean;
  };
  quality: {
    preference: string;
    effective: string;
  };
  phase: string;
  loadDurationMs: number | null;
  samples: SampleItem[];
}

export function calculatePercentile(sortedValues: number[], percentile: number): number {
  if (sortedValues.length === 0) return 0;
  if (sortedValues.length === 1) return sortedValues[0];
  const rank = (percentile / 100) * (sortedValues.length - 1);
  const lowerIndex = Math.floor(rank);
  const upperIndex = Math.ceil(rank);
  const weight = rank - lowerIndex;
  const result = sortedValues[lowerIndex] * (1 - weight) + sortedValues[upperIndex] * weight;
  return Math.round(result * 100) / 100;
}

export class PerformanceSampler {
  private samples: SampleItem[] = [];
  private maxSamples: number;
  private isSampling = false;
  private loadDurationMs: number | null = null;
  private lastFps = 0;
  private currentWebGL: WebGLStats | null = null;
  private currentPhase = '';
  private currentQuality = '';
  private livePhase = '';
  private liveQuality = '';
  private livePreference = '';
  private segmentMeta: { viewport: DiagnosticSnapshot['viewport']; preference: string } | null = null;
  private stopped = false;
  private stoppedWebGL: WebGLStats | null = null;
  private stoppedLoad: number | null = null;

  private viewport(): DiagnosticSnapshot['viewport'] {
    if (typeof window === 'undefined') {
      return { width: 0, height: 0, dpr: 1, orientation: 'unknown' };
    }
    const orientation = window.innerWidth === window.innerHeight
      ? 'unknown'
      : window.innerWidth > window.innerHeight ? 'landscape' : 'portrait';
    return { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio, orientation };
  }

  private captureContext(): void {
    this.currentPhase = this.livePhase;
    this.currentQuality = this.liveQuality;
    this.segmentMeta = { viewport: this.viewport(), preference: this.livePreference };
  }

  constructor(maxSamples = 300) {
    this.maxSamples = maxSamples;
  }

  public start(): void {
    this.clear();
    this.captureContext();
    this.isSampling = true;
  }

  public stop(): void {
    this.stoppedWebGL = this.currentWebGL ? { ...this.currentWebGL } : null;
    this.stoppedLoad = this.loadDurationMs;
    this.stopped = true;
    this.isSampling = false;
  }

  public clear(): void {
    this.samples = [];
    this.lastFps = 0;
    this.stopped = false;
  }

  public getIsSampling(): boolean {
    return this.isSampling;
  }

  public setLoadDuration(durationMs: number | null): void {
    this.loadDurationMs = durationMs;
  }

  public getLoadDuration(): number | null {
    return this.stopped ? this.stoppedLoad : this.loadDurationMs;
  }

  public setWebGLStats(stats: WebGLStats | null): void {
    this.currentWebGL = stats;
  }

  public getWebGLStats(): WebGLStats | null {
    return this.stopped ? this.stoppedWebGL : this.currentWebGL;
  }

  public updateContext(phase: string, quality: string, preference = quality): void {
    this.livePhase = phase;
    this.liveQuality = quality;
    this.livePreference = preference;
    if (!this.isSampling) {
      return;
    }
    const viewport = this.viewport();
    if (this.currentPhase !== phase || this.currentQuality !== quality ||
        this.segmentMeta?.preference !== preference ||
        this.segmentMeta?.viewport.width !== viewport.width ||
        this.segmentMeta?.viewport.height !== viewport.height ||
        this.segmentMeta?.viewport.dpr !== viewport.dpr) {
      this.captureContext();
      // Segment samples: reset buffer upon scenario/quality transition so phases do not blend
      this.samples = [];
      this.lastFps = 0;
    }
  }

  public recordFrame(deltaSeconds: number, isHidden = false, isLoading = false): void {
    if (!this.isSampling || isHidden || isLoading) {
      return;
    }
    this.updateContext(this.livePhase, this.liveQuality, this.livePreference);
    // Foreground stalls are part of the measured cost; visibility recovery is filtered by the caller.
    if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) {
      return;
    }

    const frameTimeMs = Math.round(deltaSeconds * 10000) / 10;
    if (this.samples.length >= this.maxSamples) {
      this.samples.shift();
    }
    this.samples.push({
      frameTimeMs,
      timestamp: Date.now(),
      phase: this.currentPhase,
      quality: this.currentQuality,
    });

    this.lastFps = Math.round(1 / deltaSeconds);
  }

  public recordWindowFps(fps: number): void {
    if (this.isSampling) {
      this.lastFps = fps;
    }
  }

  public getStats(): PerformanceStats {
    if (this.samples.length === 0) {
      return {
        fps: this.lastFps || 0,
        p50FrameTimeMs: 0,
        p95FrameTimeMs: 0,
        sampleCount: 0,
        maxSamples: this.maxSamples,
        fluctuation: null,
        phase: this.currentPhase,
        quality: this.currentQuality,
      };
    }

    const frameTimes = this.samples.map((s) => s.frameTimeMs);
    const sorted = [...frameTimes].sort((a, b) => a - b);
    const p50 = calculatePercentile(sorted, 50);
    const p95 = calculatePercentile(sorted, 95);
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const avg =
      Math.round((frameTimes.reduce((acc, curr) => acc + curr, 0) / frameTimes.length) * 100) / 100;

    const computedFps = avg > 0 ? Math.round(1000 / avg) : 0;

    return {
      fps: computedFps,
      p50FrameTimeMs: p50,
      p95FrameTimeMs: p95,
      sampleCount: this.samples.length,
      maxSamples: this.maxSamples,
      fluctuation: {
        minFrameTimeMs: min,
        maxFrameTimeMs: max,
        avgFrameTimeMs: avg,
        p50FrameTimeMs: p50,
        p95FrameTimeMs: p95,
      },
      phase: this.currentPhase,
      quality: this.currentQuality,
    };
  }

  public createSnapshot(extra: {
    webgl?: Partial<WebGLStats> | null;
    qualityPref: string;
    effectiveQuality: string;
    phase: string;
  }): DiagnosticSnapshot {
    const nav = typeof navigator !== 'undefined' ? (navigator as any) : {};
    const stats = this.getStats();

    const mergedWebGL: WebGLStats | null =
      this.getWebGLStats() ||
      (extra.webgl && extra.webgl.calls !== undefined
        ? {
            calls: extra.webgl.calls ?? 0,
            triangles: extra.webgl.triangles ?? 0,
            textures: extra.webgl.textures ?? 0,
          }
        : null);

    const segmentPhase = this.currentPhase || extra.phase;
    const segmentQuality = this.currentQuality || extra.effectiveQuality;

    return {
      exportedAt: new Date().toISOString(),
      samplingStats: stats,
      fluctuation: stats.fluctuation,
      webgl: mergedWebGL,
      device: {
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'Node.js',
        platform: typeof navigator !== 'undefined' ? navigator.platform : undefined,
        language: typeof navigator !== 'undefined' ? navigator.language : undefined,
        deviceMemory: nav.deviceMemory,
        hardwareConcurrency: nav.hardwareConcurrency,
        saveData: nav.connection?.saveData,
      },
      viewport: this.segmentMeta?.viewport || this.viewport(),
      quality: {
        preference: this.segmentMeta?.preference || extra.qualityPref,
        effective: segmentQuality,
      },
      network: {
        effectiveType: nav.connection?.effectiveType,
        rttMs: typeof nav.connection?.rtt === 'number' ? nav.connection.rtt : undefined,
        downlinkMbps: typeof nav.connection?.downlink === 'number' ? nav.connection.downlink : undefined,
        saveData: nav.connection?.saveData,
      },
      phase: segmentPhase,
      loadDurationMs: this.getLoadDuration(),
      samples: [...this.samples],
    };
  }
}

export const globalPerformanceSampler = new PerformanceSampler(300);
