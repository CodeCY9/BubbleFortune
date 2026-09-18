export interface ClockTimer {
  cancel(): void;
}

export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): ClockTimer;
}

export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }

  setTimeout(fn: () => void, ms: number): ClockTimer {
    const handle = setTimeout(fn, ms);
    if (typeof handle.unref === 'function') {
      handle.unref();
    }
    return {
      cancel: () => clearTimeout(handle)
    };
  }
}

export class FakeClock implements Clock {
  private currentTime: number;
  private timers: Array<{ id: number; dueTime: number; fn: () => void; cancelled: boolean }> = [];
  private nextTimerId = 1;

  constructor(initialTime = 1000000) {
    this.currentTime = initialTime;
  }

  now(): number {
    return this.currentTime;
  }

  setTimeout(fn: () => void, ms: number): ClockTimer {
    const timer = {
      id: this.nextTimerId++,
      dueTime: this.currentTime + ms,
      fn,
      cancelled: false
    };
    this.timers.push(timer);
    return {
      cancel: () => {
        timer.cancelled = true;
      }
    };
  }

  tick(ms: number): void {
    this.currentTime += ms;
    while (true) {
      const activeDue = this.timers
        .filter(t => !t.cancelled && t.dueTime <= this.currentTime)
        .sort((a, b) => a.dueTime - b.dueTime);
      if (activeDue.length === 0) break;
      const next = activeDue[0];
      next.cancelled = true;
      next.fn();
    }
  }

  advanceToNext(): boolean {
    const active = this.timers
      .filter(t => !t.cancelled)
      .sort((a, b) => a.dueTime - b.dueTime);
    if (active.length === 0) return false;
    const next = active[0];
    this.tick(Math.max(0, next.dueTime - this.currentTime));
    return true;
  }

  hasPendingTimers(): boolean {
    return this.timers.some(t => !t.cancelled);
  }
}
