// Web Audio API Synthesizer for BubbleFortune

class SoundSynthesizer {
  private ctx: AudioContext | null = null;
  private soundEnabled: boolean = false; // Default muted per user prompt requirement

  constructor() {
    // AudioContext will be initialized on first user interaction if enabled
  }

  public setSoundEnabled(enabled: boolean) {
    this.soundEnabled = enabled;
    if (enabled) {
      this.initCtx();
      if (this.ctx && this.ctx.state === 'suspended') {
        try {
          this.ctx.resume();
        } catch {}
      }
    } else {
      if (this.ctx && this.ctx.state === 'running') {
        try {
          this.ctx.suspend();
        } catch {}
      }
    }
  }

  public isSoundEnabled(): boolean {
    return this.soundEnabled;
  }

  public suspend() {
    if (this.ctx && this.ctx.state === 'running') {
      try {
        this.ctx.suspend();
      } catch {}
    }
  }

  public resume() {
    if (this.ctx && this.ctx.state === 'suspended' && this.soundEnabled) {
      try {
        this.ctx.resume();
      } catch {}
    }
  }

  private initCtx() {
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended' && this.soundEnabled) {
      try {
        this.ctx.resume();
      } catch {}
    }
  }

  // Play subtle box hover tick
  public playHover() {
    if (!this.soundEnabled) return;
    this.initCtx();
    if (!this.ctx) return;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(440, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, this.ctx.currentTime + 0.05);

    gain.gain.setValueAtTime(0.05, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.05);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.05);
  }

  // Play Box Lid Open animation sound
  public playBoxOpen(isHighValue: boolean, fastMode: boolean = false) {
    if (!this.soundEnabled) return;
    this.initCtx();
    if (!this.ctx) return;

    const duration = fastMode ? 0.3 : 0.8;
    const now = this.ctx.currentTime;

    // Whoosh noise
    const bufferSize = this.ctx.sampleRate * duration;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }

    const whiteNoise = this.ctx.createBufferSource();
    whiteNoise.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(isHighValue ? 200 : 800, now);
    filter.frequency.exponentialRampToValueAtTime(isHighValue ? 80 : 3000, now + duration);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    whiteNoise.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);
    whiteNoise.start(now);

    // Chime or tension bass
    const osc = this.ctx.createOscillator();
    const oscGain = this.ctx.createGain();

    if (isHighValue) {
      // Dramatic bass impact for high value elimination
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(150, now);
      osc.frequency.exponentialRampToValueAtTime(45, now + duration);
      oscGain.gain.setValueAtTime(0.3, now);
      oscGain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    } else {
      // Pleasant light chime for low value elimination (good for player)
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(523.25, now); // C5
      osc.frequency.exponentialRampToValueAtTime(1046.50, now + duration); // C6
      oscGain.gain.setValueAtTime(0.2, now);
      oscGain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    }

    osc.connect(oscGain);
    oscGain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + duration);
  }

  // Banker Phone Ringing Tone
  public playBankerRing() {
    if (!this.soundEnabled) return;
    this.initCtx();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc1.type = 'sine';
    osc2.type = 'sine';
    osc1.frequency.setValueAtTime(440, now); // A4
    osc2.frequency.setValueAtTime(480, now);

    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 1.2);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(this.ctx.destination);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + 1.2);
    osc2.stop(now + 1.2);
  }

  // Short, low-volume deadline cue. Callers should invoke this once per
  // displayed second so countdowns stay informative without becoming noisy.
  public playCountdownWarning(secondsRemaining: number) {
    if (!this.soundEnabled || secondsRemaining < 1 || secondsRemaining > 5) return;
    this.initCtx();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = secondsRemaining === 1 ? 'square' : 'triangle';
    osc.frequency.setValueAtTime(secondsRemaining === 1 ? 880 : 660, now);
    gain.gain.setValueAtTime(secondsRemaining === 1 ? 0.08 : 0.045, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + (secondsRemaining === 1 ? 0.14 : 0.09));
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + (secondsRemaining === 1 ? 0.14 : 0.09));
  }

  // Victory / Deal Accepted Sound
  public playVictory() {
    if (!this.soundEnabled) return;
    this.initCtx();
    if (!this.ctx) return;

    const notes = [523.25, 659.25, 783.99, 1046.50]; // C, E, G, C
    notes.forEach((freq, index) => {
      if (!this.ctx) return;
      const now = this.ctx.currentTime + index * 0.12;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now);

      gain.gain.setValueAtTime(0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now);
      osc.stop(now + 0.4);
    });
  }
}

export const soundManager = new SoundSynthesizer();
