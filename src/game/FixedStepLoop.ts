import { FIXED_STEP_MS } from './constants';

export class FixedStepLoop {
  private accumulatorMs = 0;
  private frameId = 0;
  private lastNow = 0;
  private readonly maxFrameMs = 250;
  private running = false;

  constructor(
    private readonly step: (dtMs: number) => void,
    private readonly render: (alpha: number) => void
  ) {}

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.lastNow = performance.now();
    this.frameId = requestAnimationFrame(this.tick);
  }

  stop(): void {
    if (!this.running) {
      return;
    }
    this.running = false;
    cancelAnimationFrame(this.frameId);
  }

  resetClock(): void {
    this.accumulatorMs = 0;
    this.lastNow = performance.now();
  }

  private readonly tick = (now: number): void => {
    if (!this.running) {
      return;
    }

    const elapsed = Math.min(now - this.lastNow, this.maxFrameMs);
    this.lastNow = now;
    this.accumulatorMs += elapsed;

    while (this.accumulatorMs >= FIXED_STEP_MS) {
      this.step(FIXED_STEP_MS);
      this.accumulatorMs -= FIXED_STEP_MS;
    }

    this.render(this.accumulatorMs / FIXED_STEP_MS);
    this.frameId = requestAnimationFrame(this.tick);
  };
}
