import { Application, type Renderer } from 'pixi.js';
import { WORLD_HEIGHT, WORLD_WIDTH } from '../constants';
import { FixedStepLoop } from '../FixedStepLoop';
import type { WorldPoint } from '../gestures';
import { clamp } from '../math';
import { createSharePoster, type PosterFrame } from '../posterizer';
import { submitScore } from '../scoreClient';
import { PulseInputController } from './PulseInputController';
import { getDailyPulseSeed } from './PulseLevelGenerator';
import { PulseRenderer } from './PulseRenderer';
import { PulseSimulation } from './PulseSimulation';
import type { PulseReplayPayload, PulseSnapshot } from './PulseTypes';

export interface PulseModeOptions {
  seed?: string;
  startedAt: number;
}

export class PulseMode {
  private readonly app = new Application<Renderer>();
  private readonly sim: PulseSimulation;
  private readonly loop: FixedStepLoop;
  private renderer?: PulseRenderer;
  private input?: PulseInputController;
  private scale = 1;
  private offsetX = 0;
  private offsetY = 0;
  private paused = false;
  private debug = false;
  private scoreSubmitted = false;
  private sampleCooldownMs = 0;
  private frameSamples: PosterFrame[] = [];

  constructor(
    private readonly root: HTMLElement,
    options: PulseModeOptions
  ) {
    const seed = options.seed ?? getDailyPulseSeed();
    this.sim = new PulseSimulation({ seed, startedAt: options.startedAt });
    this.loop = new FixedStepLoop(
      (dtMs) => this.step(dtMs),
      () => this.render()
    );
  }

  async start(): Promise<void> {
    await this.app.init({
      autoDensity: true,
      autoStart: false,
      backgroundAlpha: 0,
      clearBeforeRender: true,
      hello: false,
      preference: 'webgl',
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
      resizeTo: this.root,
      resolution: Math.min(window.devicePixelRatio || 1, 2)
    });
    this.root.appendChild(this.app.canvas);
    this.renderer = new PulseRenderer(this.app.stage);
    this.input = new PulseInputController(this.app.canvas, this.sim, (clientX, clientY) => this.screenToWorld(clientX, clientY));
    this.input.setDebug(this.debug);
    this.input.start();
    window.addEventListener('resize', this.resize);
    this.resize();
    this.loop.start();
  }

  destroy(): void {
    this.loop.stop();
    this.input?.destroy();
    this.renderer?.destroy();
    window.removeEventListener('resize', this.resize);
    this.app.destroy(true, { children: true, texture: true });
  }

  restart(): void {
    this.sim.reset();
    this.scoreSubmitted = false;
    this.frameSamples = [];
    this.sampleCooldownMs = 0;
    this.input?.clearSelection();
    this.loop.resetClock();
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    if (!paused) {
      this.loop.resetClock();
    }
  }

  setInputDebug(enabled: boolean): void {
    this.debug = enabled;
    this.input?.setDebug(enabled);
  }

  getMode(): 'pulse-chain' {
    return 'pulse-chain';
  }

  getSnapshot(): PulseSnapshot {
    return this.sim.getSnapshot();
  }

  getReplayPayload(): PulseReplayPayload {
    return this.sim.getReplayPayload();
  }

  getNodes() {
    return this.sim.getNodes();
  }

  getLinks() {
    return this.sim.getLinks();
  }

  getPulses() {
    return this.sim.getPulses();
  }

  getLastInputResult() {
    return this.sim.getLastInputResult();
  }

  addLink(fromId: number, toId: number) {
    return this.sim.addLink(fromId, toId);
  }

  clearLinks() {
    return this.sim.clearLinks();
  }

  undo() {
    return this.sim.undo();
  }

  playPulse() {
    return this.sim.playPulse();
  }

  simulateLens(points: readonly WorldPoint[]) {
    return this.sim.applyLens(points.map((point, index) => ({ ...point, t: index * 16 })));
  }

  forceBuildPhase(): void {
    this.sim.forceBuildPhase();
  }

  forcePulsePhase(): void {
    this.sim.forcePulsePhase();
  }

  forceCollapse(): void {
    this.sim.forceCollapse();
  }

  forceEnd(): void {
    this.forceCollapse();
  }

  async exportPoster(): Promise<string> {
    this.sampleFrame('current');
    const snapshot = this.sim.getSnapshot();
    const frames = this.frameSamples.length >= 3 ? this.frameSamples : this.makeFallbackFrames();
    return createSharePoster(frames, {
      score: snapshot.score,
      survivalMs: snapshot.timeMs,
      seed: snapshot.seed,
      phase: 1
    });
  }

  private step(dtMs: number): void {
    if (this.paused) {
      return;
    }
    const wasEnded = this.sim.getSnapshot().ended;
    this.sim.step(dtMs);
    const snapshot = this.sim.getSnapshot();
    this.sampleCooldownMs -= dtMs;
    if (this.sampleCooldownMs <= 0 && !snapshot.ended) {
      this.sampleFrame(`t${snapshot.timeMs}`);
      this.sampleCooldownMs = 1300;
    }
    if (!wasEnded && snapshot.ended && !this.scoreSubmitted) {
      this.scoreSubmitted = true;
      this.saveBest(snapshot);
      void submitScore(this.sim.getReplayPayload());
    }
  }

  private render(): void {
    this.renderer?.render(this.sim.getSnapshot(), this.input?.getViewState() ?? {
      liveGesture: [],
      lastResult: this.sim.getLastInputResult()
    }, {
      scale: this.scale,
      offsetX: this.offsetX,
      offsetY: this.offsetY,
      debug: this.debug
    });
    this.app.render();
  }

  private readonly resize = (): void => {
    const rect = this.root.getBoundingClientRect();
    this.scale = Math.min(rect.width / WORLD_WIDTH, rect.height / WORLD_HEIGHT);
    const viewWidth = WORLD_WIDTH * this.scale;
    const viewHeight = WORLD_HEIGHT * this.scale;
    this.offsetX = (rect.width - viewWidth) / 2;
    this.offsetY = (rect.height - viewHeight) / 2;
  };

  private screenToWorld(clientX: number, clientY: number): WorldPoint {
    const rect = this.app.canvas.getBoundingClientRect();
    return {
      x: clamp((clientX - rect.left - this.offsetX) / this.scale, 0, WORLD_WIDTH),
      y: clamp((clientY - rect.top - this.offsetY) / this.scale, 0, WORLD_HEIGHT)
    };
  }

  private sampleFrame(label: string): void {
    try {
      this.frameSamples.push({ dataUrl: this.app.canvas.toDataURL('image/png', 0.78), label });
      if (this.frameSamples.length > 3) {
        this.frameSamples.shift();
      }
    } catch {
      this.frameSamples = this.makeFallbackFrames();
    }
  }

  private makeFallbackFrames(): PosterFrame[] {
    const snapshot = this.sim.getSnapshot();
    return [0, 1, 2].map((index) => ({
      dataUrl: this.makeMockFrame(snapshot, index),
      label: `pulse-${index}`
    }));
  }

  private makeMockFrame(snapshot: PulseSnapshot, index: number): string {
    const canvas = document.createElement('canvas');
    canvas.width = 540;
    canvas.height = 960;
    const context = canvas.getContext('2d');
    if (!context) {
      return '';
    }
    context.fillStyle = '#03040a';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = index === 0 ? '#16315c' : index === 1 ? '#45246d' : '#0f5b69';
    context.beginPath();
    context.arc(270, 410, 150, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#000';
    context.beginPath();
    context.arc(270, 410, 72, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#f7fbff';
    context.font = '800 52px system-ui';
    context.fillText(String(snapshot.score), 54, 824);
    return canvas.toDataURL('image/png', 0.78);
  }

  private saveBest(snapshot: PulseSnapshot): void {
    try {
      const bestScore = Number(localStorage.getItem('eventHorizon.bestScore') ?? 0);
      const bestSurvival = Number(localStorage.getItem('eventHorizon.bestSurvivalMs') ?? 0);
      if (snapshot.score > bestScore) {
        localStorage.setItem('eventHorizon.bestScore', String(snapshot.score));
      }
      if (snapshot.timeMs > bestSurvival) {
        localStorage.setItem('eventHorizon.bestSurvivalMs', String(snapshot.timeMs));
      }
    } catch {
      // Ignore storage failures in private or embedded browsers.
    }
  }

}
