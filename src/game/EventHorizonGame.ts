import {
  Application,
  Container,
  Graphics,
  Sprite,
  Text,
  TextStyle,
  type Texture,
  type Renderer
} from 'pixi.js';
import {
  BLACK_HOLE_X,
  BLACK_HOLE_Y,
  MAX_ENERGY,
  WORLD_HEIGHT,
  WORLD_WIDTH
} from './constants';
import { FixedStepLoop } from './FixedStepLoop';
import { InputHandler, type GestureEndResult, type GesturePoint, type SwipeGesture, type WorldPoint } from './InputHandler';
import { clamp, formatTime } from './math';
import { createSharePoster, type PosterFrame } from './posterizer';
import { submitScore } from './scoreClient';
import { Simulation, type SimulationOptions } from './Simulation';
import type {
  FlybyState,
  OrbState,
  ReplayPayload,
  ShadowArmState,
  SimulationSnapshot,
  SwipeEvent,
  TapEvent
} from './types';

interface OrbView {
  sprite: Sprite;
  glow: Sprite;
}

interface FlybyView {
  sprite: Sprite;
  streak: Graphics;
}

interface TrailFeedback {
  graphics: Graphics;
  label: Text;
  points: WorldPoint[];
  ageMs: number;
  durationMs: number;
  success: boolean;
  canceled: boolean;
}

interface EnergyPulse {
  startX: number;
  startY: number;
  ageMs: number;
  durationMs: number;
}

interface LastGestureDebug {
  kind: 'tap' | 'swipe' | 'canceled';
  screenDistance: number;
  worldDistance: number;
  worldStart?: WorldPoint;
  worldEnd?: WorldPoint;
  result?: SwipeEvent | TapEvent | { message: 'CANCELED'; success: false; target: 'empty' };
  activeTrailCount: number;
}

export class EventHorizonGame {
  private readonly app = new Application<Renderer>();
  private readonly world = new Container();
  private readonly background = new Graphics();
  private readonly tetherLayer = new Graphics();
  private readonly armLayer = new Graphics();
  private readonly blackHole = new Graphics();
  private readonly trailLayer = new Container();
  private readonly liveTrail = new Graphics();
  private readonly energyPulseLayer = new Graphics();
  private readonly feedbackLayer = new Container();
  private readonly collapseLayer = new Graphics();
  private readonly hud = new Container();
  private readonly energyBarBack = new Graphics();
  private readonly energyBarFill = new Graphics();
  private readonly scoreText = new Text({
    text: '0',
    style: new TextStyle({
      fill: '#f7fbff',
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSize: 52,
      fontWeight: '800'
    })
  });
  private readonly metaText = new Text({
    text: '',
    style: new TextStyle({
      fill: '#9fe7ff',
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSize: 26,
      fontWeight: '600'
    })
  });
  private readonly energyLabelText = new Text({
    text: 'DARK ENERGY',
    style: new TextStyle({
      fill: '#c7f7ff',
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSize: 24,
      fontWeight: '800'
    })
  });
  private readonly warningText = new Text({
    text: 'COLLAPSE IMMINENT',
    style: new TextStyle({
      fill: '#ff6a83',
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSize: 24,
      fontWeight: '800'
    })
  });
  private readonly tutorialText = new Text({
    text: '',
    style: new TextStyle({
      align: 'center',
      fill: '#ffffff',
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSize: 34,
      fontWeight: '900',
      stroke: { color: '#25103e', width: 5 }
    })
  });
  private readonly debugText = new Text({
    text: '',
    style: new TextStyle({
      fill: '#dff8ff',
      fontFamily: 'SFMono-Regular, Menlo, monospace',
      fontSize: 18,
      fontWeight: '600'
    })
  });
  private readonly endText = new Text({
    text: '',
    style: new TextStyle({
      align: 'center',
      fill: '#f7fbff',
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSize: 54,
      fontWeight: '800'
    })
  });
  private readonly sim: Simulation;
  private readonly loop: FixedStepLoop;
  private input?: InputHandler;
  private orbViews: OrbView[] = [];
  private flybyViews: FlybyView[] = [];
  private frameSamples: PosterFrame[] = [];
  private sampleCooldownMs = 0;
  private liveGesturePoints: readonly GesturePoint[] = [];
  private readonly trails: TrailFeedback[] = [];
  private readonly energyPulses: EnergyPulse[] = [];
  private readonly orbFlashMs = new Map<number, number>();
  private inputDebug = false;
  private lastGesture: LastGestureDebug | null = null;
  private blackHolePulseMs = 0;
  private missPulseMs = 0;
  private energyGlowMs = 0;
  private onboardingMessage = '';
  private onboardingMessageMs = 0;
  private scale = 1;
  private offsetX = 0;
  private offsetY = 0;
  private scoreSubmitted = false;
  private bestSaved = false;
  private paused = false;

  constructor(
    private readonly root: HTMLElement,
    options: SimulationOptions
  ) {
    this.sim = new Simulation(options);
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
    this.buildScene();
    this.input = new InputHandler(this.app.canvas, {
      screenToWorld: (clientX, clientY) => this.screenToWorld(clientX, clientY),
      onTap: (point) => this.handleTap(point),
      onSwipe: (gesture) => this.handleSwipe(gesture),
      onGesturePreview: (points) => {
        this.liveGesturePoints = points;
      },
      onGestureEnd: (result) => this.handleGestureEnd(result)
    });
    window.addEventListener('resize', this.resize);
    this.resize();
    this.loop.start();
  }

  restart(): void {
    this.sim.reset();
    this.scoreSubmitted = false;
    this.bestSaved = false;
    this.frameSamples = [];
    this.sampleCooldownMs = 0;
    this.liveGesturePoints = [];
    this.clearFeedback();
    this.loop.resetClock();
  }

  forceEnd(): void {
    this.sim.forceEnd();
  }

  destroy(): void {
    this.loop.stop();
    this.input?.destroy();
    window.removeEventListener('resize', this.resize);
    this.app.destroy(true, { children: true, texture: true });
  }

  getReplayPayload(): ReplayPayload {
    return this.sim.getReplayPayload();
  }

  getSnapshot(): SimulationSnapshot {
    return this.sim.getSnapshot();
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    if (!paused) {
      this.loop.resetClock();
    }
  }

  setInputDebug(enabled: boolean): void {
    this.inputDebug = enabled;
    this.input?.setDebug(enabled);
  }

  getLastGesture(): LastGestureDebug | null {
    return this.lastGesture
      ? {
          ...this.lastGesture,
          worldStart: this.lastGesture.worldStart ? { ...this.lastGesture.worldStart } : undefined,
          worldEnd: this.lastGesture.worldEnd ? { ...this.lastGesture.worldEnd } : undefined,
          activeTrailCount: this.trails.length
        }
      : null;
  }

  simulateSwipeWorld(points: readonly WorldPoint[]): SwipeEvent {
    const event = this.sim.applySwipePath(points.map((point, index) => ({ ...point, t: index * 16 })));
    this.handleSwipeFeedback(event, 0, 0, points);
    return event;
  }

  simulateTapWorld(x: number, y: number): TapEvent {
    const event = this.sim.applyTap(x, y);
    this.lastGesture = {
      kind: 'tap',
      screenDistance: 0,
      worldDistance: 0,
      worldStart: { x, y },
      worldEnd: { x, y },
      result: event,
      activeTrailCount: this.trails.length
    };
    this.addFloatingLabel(this.tapMessage(event), x, y - 42, event.target !== 'empty');
    return event;
  }

  async exportPoster(): Promise<string> {
    this.sampleFrame('current');
    const snapshot = this.sim.getSnapshot();
    const frames = this.frameSamples.length >= 3 ? this.frameSamples : this.makeFallbackFrames();
    return createSharePoster(frames, {
      score: snapshot.score,
      survivalMs: this.sim.getReplayPayload().survivalMs,
      seed: this.sim.seed,
      phase: snapshot.phase
    });
  }

  private buildScene(): void {
    this.world.sortableChildren = false;
    this.app.stage.addChild(this.world);
    this.world.addChild(this.background);
    this.world.addChild(this.armLayer);
    this.world.addChild(this.blackHole);
    this.world.addChild(this.tetherLayer);
    this.createOrbViews();
    this.createFlybyViews();
    this.world.addChild(this.trailLayer);
    this.trailLayer.addChild(this.energyPulseLayer, this.liveTrail);
    this.world.addChild(this.feedbackLayer, this.tutorialText);
    this.world.addChild(this.hud);
    this.hud.addChild(
      this.energyBarBack,
      this.energyBarFill,
      this.scoreText,
      this.metaText,
      this.energyLabelText,
      this.warningText,
      this.debugText,
      this.endText
    );
    this.world.addChild(this.collapseLayer);
    this.drawBackground();
    this.drawHudBack();
    this.endText.anchor.set(0.5);
    this.endText.position.set(WORLD_WIDTH / 2, WORLD_HEIGHT * 0.58);
    this.tutorialText.anchor.set(0.5);
    this.debugText.visible = false;
  }

  private createOrbViews(): void {
    const orbTexture = this.makeOrbTexture(0x78f2ff, 32, false);
    const glowTexture = this.makeOrbTexture(0xbaf8ff, 76, true);
    for (let index = 0; index < 24; index += 1) {
      const glow = new Sprite(glowTexture);
      glow.anchor.set(0.5);
      glow.blendMode = 'add';
      glow.visible = false;
      const sprite = new Sprite(orbTexture);
      sprite.anchor.set(0.5);
      sprite.visible = false;
      this.world.addChild(glow, sprite);
      this.orbViews.push({ sprite, glow });
    }
  }

  private createFlybyViews(): void {
    const texture = this.makeOrbTexture(0xfff0a3, 24, false);
    for (let index = 0; index < 6; index += 1) {
      const streak = new Graphics();
      const sprite = new Sprite(texture);
      sprite.anchor.set(0.5);
      streak.visible = false;
      sprite.visible = false;
      this.world.addChild(streak, sprite);
      this.flybyViews.push({ sprite, streak });
    }
  }

  private makeOrbTexture(color: number, radius: number, soft: boolean): Texture {
    const graphics = new Graphics();
    const alpha = soft ? 0.14 : 0.9;
    graphics.circle(radius, radius, radius).fill({ color, alpha });
    graphics.circle(radius, radius, radius * 0.48).fill({ color: 0xffffff, alpha: soft ? 0.12 : 0.65 });
    return this.app.renderer.generateTexture(graphics);
  }

  private drawBackground(): void {
    this.background.clear();
    this.background.rect(0, 0, WORLD_WIDTH, WORLD_HEIGHT).fill(0x03040a);

    for (let index = 0; index < 240; index += 1) {
      const x = (index * 197.63) % WORLD_WIDTH;
      const y = (index * 311.19) % WORLD_HEIGHT;
      const depth = (index % 11) / 10;
      const alpha = 0.18 + depth * 0.38;
      const size = 1.1 + depth * 2.2;
      this.background.circle(x, y, size).fill({ color: 0xbfeaff, alpha });
    }

    for (let index = 0; index < 150; index += 1) {
      const t = index / 149;
      const angle = t * Math.PI * 8.8;
      const radius = 82 + t * 690;
      const x = BLACK_HOLE_X + Math.cos(angle) * radius;
      const y = BLACK_HOLE_Y + Math.sin(angle) * radius * 0.57;
      const color = index % 2 === 0 ? 0x305da6 : 0x6e366f;
      this.background.circle(x, y, 3 + t * 7).fill({ color, alpha: 0.07 + (1 - t) * 0.08 });
      this.background.circle(WORLD_WIDTH - x, WORLD_HEIGHT * 0.88 - y * 0.34, 2 + t * 4).fill({
        color: 0x1aaf96,
        alpha: 0.035
      });
    }
  }

  private drawHudBack(): void {
    this.energyBarBack.clear();
    this.energyBarBack.roundRect(78, WORLD_HEIGHT - 132, WORLD_WIDTH - 156, 38, 7).fill({
      color: 0x061120,
      alpha: 0.86
    });
    this.energyBarBack.roundRect(78, WORLD_HEIGHT - 132, WORLD_WIDTH - 156, 38, 7).stroke({
      color: 0x78f2ff,
      alpha: 0.36,
      width: 2
    });
    this.scoreText.position.set(72, 70);
    this.metaText.position.set(76, 132);
    this.energyLabelText.position.set(86, WORLD_HEIGHT - 166);
    this.warningText.anchor.set(1, 0);
    this.warningText.position.set(WORLD_WIDTH - 86, WORLD_HEIGHT - 166);
    this.debugText.position.set(74, 180);
  }

  private step(dtMs: number): void {
    this.updateFeedbackTimers(dtMs);
    if (this.paused) {
      return;
    }
    const wasEnded = this.sim.getSnapshot().ended;
    this.sim.step(dtMs);
    const snapshot = this.sim.getSnapshot();
    this.sampleCooldownMs -= dtMs;
    if (this.sampleCooldownMs <= 0 && !snapshot.ended) {
      this.sampleFrame(`t${Math.round(snapshot.timeMs)}`);
      this.sampleCooldownMs = 1400;
    }
    if (!wasEnded && snapshot.ended && !this.scoreSubmitted) {
      this.scoreSubmitted = true;
      this.saveBestRun();
      void submitScore(this.sim.getReplayPayload());
    }
  }

  private render(): void {
    const snapshot = this.sim.getSnapshot();
    this.world.position.set(this.offsetX, this.offsetY);
    this.world.scale.set(this.scale);
    this.renderShadowArms(snapshot.shadowArms, snapshot.phase);
    this.renderBlackHole(snapshot);
    this.renderTethers(snapshot.orbs);
    this.renderOrbs(snapshot.orbs, snapshot.collapseT);
    this.renderFlybys(snapshot.flybys);
    this.renderTrails();
    this.renderEnergyPulses();
    this.renderTutorial(snapshot);
    this.renderHud(snapshot);
    this.renderDebug(snapshot);
    this.renderCollapse(snapshot);
    this.app.render();
  }

  private renderShadowArms(arms: readonly ShadowArmState[], phase: number): void {
    this.armLayer.clear();
    if (phase < 2) {
      return;
    }
    for (const arm of arms) {
      const length = 420 + phase * 90;
      const endX = BLACK_HOLE_X + Math.cos(arm.angle) * length;
      const endY = BLACK_HOLE_Y + Math.sin(arm.angle) * length;
      const alpha = arm.stunMs > 0 ? 0.12 : 0.12 + arm.intensity * 0.32;
      this.armLayer.moveTo(BLACK_HOLE_X, BLACK_HOLE_Y);
      this.armLayer.lineTo(endX, endY);
      this.armLayer.stroke({ color: arm.stunMs > 0 ? 0x8ff9ff : 0x1b102b, alpha, width: 50 + phase * 7 });
      this.armLayer.moveTo(BLACK_HOLE_X, BLACK_HOLE_Y);
      this.armLayer.lineTo(endX, endY);
      this.armLayer.stroke({ color: 0x8d62ff, alpha: alpha * 0.45, width: 8 });
    }
  }

  private renderBlackHole(snapshot: SimulationSnapshot): void {
    this.blackHole.clear();
    const phaseT = (snapshot.phase - 1) / 3;
    const pulse = Math.sin(snapshot.timeMs * 0.004) * 0.5 + 0.5;
    const harvestPulse = clamp(this.blackHolePulseMs / 320, 0, 1);
    const missPulse = clamp(this.missPulseMs / 260, 0, 1);
    const radius = 80 + phaseT * 54 + snapshot.collapseT * 260 - harvestPulse * 12 + missPulse * 10;
    this.blackHole.circle(BLACK_HOLE_X, BLACK_HOLE_Y, radius * 2.2).fill({
      color: 0x0a1424,
      alpha: 0.08 + phaseT * 0.13
    });
    this.blackHole.circle(BLACK_HOLE_X, BLACK_HOLE_Y, radius * 1.25).stroke({
      color: harvestPulse > 0 ? 0xd9fbff : missPulse > 0 ? 0xff6a83 : 0x6bcfff,
      alpha: 0.14 + phaseT * 0.26 + harvestPulse * 0.3 + missPulse * 0.18,
      width: 7 + pulse * 6 + harvestPulse * 10
    });
    this.blackHole.circle(BLACK_HOLE_X, BLACK_HOLE_Y, radius).fill({ color: 0x000000, alpha: 0.82 });
    this.blackHole.circle(BLACK_HOLE_X, BLACK_HOLE_Y, radius * 0.38).fill({ color: 0x03040a, alpha: 1 });
  }

  private renderTethers(orbs: readonly OrbState[]): void {
    this.tetherLayer.clear();
    for (const orb of orbs) {
      if (!orb.active) {
        continue;
      }
      const flash = clamp((this.orbFlashMs.get(orb.id) ?? 0) / 650, 0, 1);
      const tutorialBoost = orb.tutorial ? 0.42 : 0;
      const alpha = clamp(orb.captured ? 0.78 : orb.frozenMs > 0 ? 0.56 : 0.24 + tutorialBoost + flash * 0.42, 0, 0.95);
      this.tetherLayer.moveTo(BLACK_HOLE_X, BLACK_HOLE_Y);
      this.tetherLayer.lineTo(orb.x, orb.y);
      this.tetherLayer.stroke({
        color: orb.captured ? 0xd9fbff : 0x5bc7ff,
        alpha,
        width: orb.captured ? 8 : orb.tutorial ? 7 : orb.frozenMs > 0 ? 5 : 3
      });
      if (orb.tutorial || flash > 0) {
        const outerX = BLACK_HOLE_X + (orb.x - BLACK_HOLE_X) * 0.46;
        const outerY = BLACK_HOLE_Y + (orb.y - BLACK_HOLE_Y) * 0.46;
        this.tetherLayer.moveTo(outerX, outerY);
        this.tetherLayer.lineTo(orb.x, orb.y);
        this.tetherLayer.stroke({
          color: flash > 0 ? 0xffffff : 0xd267ff,
          alpha: 0.42 + flash * 0.38,
          width: 18 + flash * 10
        });
      }
    }
  }

  private renderOrbs(orbs: readonly OrbState[], collapseT: number): void {
    for (let index = 0; index < this.orbViews.length; index += 1) {
      const orb = orbs[index];
      const view = this.orbViews[index];
      if (!orb?.active) {
        view.sprite.visible = false;
        view.glow.visible = false;
        continue;
      }
      const bendX = BLACK_HOLE_X + (orb.x - BLACK_HOLE_X) * (1 - collapseT * 0.88);
      const bendY = BLACK_HOLE_Y + (orb.y - BLACK_HOLE_Y) * (1 - collapseT * 0.88);
      const frozen = orb.frozenMs > 0;
      view.sprite.visible = true;
      view.glow.visible = true;
      view.sprite.position.set(bendX, bendY);
      view.glow.position.set(bendX, bendY);
      const scale = orb.radius / 32;
      const flash = clamp((this.orbFlashMs.get(orb.id) ?? 0) / 650, 0, 1);
      const tutorial = orb.tutorial ? 1 : 0;
      view.sprite.scale.set(scale * (orb.captured ? 1.42 : frozen ? 1.24 : 1 + tutorial * 0.12 + flash * 0.18));
      view.glow.scale.set(scale * (orb.captured ? 2.1 : frozen ? 1.62 : 1.28 + tutorial * 0.42 + flash * 0.46));
      view.glow.alpha = clamp(orb.captured ? 1 : frozen ? 0.96 : 0.48 + tutorial * 0.32 + flash * 0.3, 0, 1);
      view.sprite.alpha = 1 - collapseT * 0.45;
    }
  }

  private renderFlybys(flybys: readonly FlybyState[]): void {
    for (let index = 0; index < this.flybyViews.length; index += 1) {
      const flyby = flybys[index];
      const view = this.flybyViews[index];
      if (!flyby?.active) {
        view.sprite.visible = false;
        view.streak.visible = false;
        continue;
      }
      view.sprite.visible = true;
      view.streak.visible = true;
      view.sprite.position.set(flyby.x, flyby.y);
      view.sprite.scale.set(flyby.radius / 24);
      view.streak.clear();
      view.streak.moveTo(flyby.x - flyby.vx * 0.08, flyby.y - flyby.vy * 0.08);
      view.streak.lineTo(flyby.x, flyby.y);
      view.streak.stroke({ color: 0xfff0a3, alpha: 0.55, width: 8 });
    }
  }

  private renderHud(snapshot: SimulationSnapshot): void {
    const width = (WORLD_WIDTH - 172) * clamp(snapshot.energy / MAX_ENERGY, 0, 1);
    const barColor = snapshot.phase >= 4 ? 0xff5d73 : snapshot.phase >= 3 ? 0xffc857 : 0x67f4ff;
    const glow = clamp(this.energyGlowMs / 700, 0, 1);
    this.energyBarFill.clear();
    if (glow > 0) {
      this.energyBarFill.roundRect(70, WORLD_HEIGHT - 140, WORLD_WIDTH - 140, 54, 12).stroke({
        color: 0xd267ff,
        alpha: glow * 0.75,
        width: 8 + glow * 8
      });
    }
    this.energyBarFill.roundRect(86, WORLD_HEIGHT - 124, width, 22, 6).fill({ color: barColor, alpha: 0.95 });
    this.energyBarFill.roundRect(86, WORLD_HEIGHT - 124, width, 22, 6).fill({ color: 0xffffff, alpha: 0.14 });
    this.scoreText.text = snapshot.score.toString();
    this.metaText.text = `${formatTime(this.sim.getReplayPayload().survivalMs)}  PHASE ${snapshot.phase}  x${snapshot.streak}`;
    this.warningText.visible = snapshot.energy < 25 && !snapshot.ended;
    this.endText.visible = snapshot.ended;
    this.endText.text = snapshot.ended
      ? `GALAXY COLLAPSED\n${snapshot.score}  •  ${formatTime(this.sim.getReplayPayload().survivalMs)}`
      : '';
  }

  private renderCollapse(snapshot: SimulationSnapshot): void {
    this.collapseLayer.clear();
    if (!snapshot.ended) {
      return;
    }
    const t = snapshot.collapseT;
    this.world.scale.set(this.scale * (1 - t * 0.06));
    this.world.position.set(this.offsetX + WORLD_WIDTH * this.scale * t * 0.03, this.offsetY + WORLD_HEIGHT * this.scale * t * 0.025);
    this.collapseLayer.rect(0, 0, WORLD_WIDTH, WORLD_HEIGHT).fill({ color: 0x000000, alpha: clamp((t - 0.42) / 0.58, 0, 1) });
  }

  private handleTap(point: GesturePoint): void {
    const event = this.sim.applyTap(point.x, point.y);
    this.lastGesture = {
      kind: 'tap',
      screenDistance: 0,
      worldDistance: 0,
      worldStart: { x: point.x, y: point.y },
      worldEnd: { x: point.x, y: point.y },
      result: event,
      activeTrailCount: this.trails.length
    };
    this.addFloatingLabel(this.tapMessage(event), point.x, point.y - 44, event.target !== 'empty');
  }

  private handleSwipe(gesture: SwipeGesture): void {
    const event = this.sim.applySwipeGesture(gesture);
    this.handleSwipeFeedback(event, gesture.screenDistance, gesture.worldDistance, gesture.points);
  }

  private handleGestureEnd(result: GestureEndResult): void {
    this.liveGesturePoints = [];
    if (result.kind !== 'canceled' || !result.gesture) {
      return;
    }
    this.lastGesture = {
      kind: 'canceled',
      screenDistance: result.gesture.screenDistance,
      worldDistance: result.gesture.worldDistance,
      worldStart: { x: result.gesture.start.x, y: result.gesture.start.y },
      worldEnd: { x: result.gesture.end.x, y: result.gesture.end.y },
      result: { message: 'CANCELED', success: false, target: 'empty' },
      activeTrailCount: this.trails.length
    };
    this.addSwipeTrail(result.gesture.points, 'CANCELED', false, true);
  }

  private handleSwipeFeedback(
    event: SwipeEvent,
    screenDistance: number,
    worldDistance: number,
    sourcePoints: readonly WorldPoint[]
  ): void {
    const message = event.success
      ? `${event.message} +${event.scoreDelta ?? 0}`
      : event.message;
    this.addSwipeTrail(event.path.length > 0 ? event.path : sourcePoints, message, event.success, false);
    const start = event.path[0] ?? sourcePoints[0] ?? { x: event.x1, y: event.y1 };
    const end = event.path[event.path.length - 1] ?? sourcePoints[sourcePoints.length - 1] ?? { x: event.x2, y: event.y2 };
    this.lastGesture = {
      kind: 'swipe',
      screenDistance,
      worldDistance,
      worldStart: start,
      worldEnd: end,
      result: event,
      activeTrailCount: this.trails.length
    };

    if (event.success) {
      if (event.orbId !== undefined) {
        this.orbFlashMs.set(event.orbId, 650);
        const orb = this.sim.getSnapshot().orbs.find((candidate) => candidate.id === event.orbId);
        this.energyPulses.push({
          startX: orb?.x ?? end.x,
          startY: orb?.y ?? end.y,
          ageMs: 0,
          durationMs: 620
        });
      }
      this.energyGlowMs = 700;
      this.blackHolePulseMs = 320;
      this.onboardingMessage = this.sim.getSnapshot().harvestCount === 1 ? 'DARK ENERGY CAPTURED' : '';
      this.onboardingMessageMs = this.onboardingMessage ? 1800 : this.onboardingMessageMs;
      if ('vibrate' in navigator) {
        navigator.vibrate?.(12);
      }
    } else {
      this.missPulseMs = 260;
    }
  }

  private addSwipeTrail(
    points: readonly WorldPoint[],
    labelText: string,
    success: boolean,
    canceled: boolean
  ): void {
    if (points.length === 0) {
      return;
    }
    const graphics = new Graphics();
    const label = new Text({
      text: labelText,
      style: new TextStyle({
        align: 'center',
        fill: success ? '#ffffff' : canceled ? '#9fb5c4' : '#ff8ba1',
        fontFamily: 'Inter, system-ui, sans-serif',
        fontSize: 30,
        fontWeight: '900',
        stroke: { color: '#15051f', width: 5 }
      })
    });
    label.anchor.set(0.5);
    const midpoint = points[Math.floor(points.length / 2)];
    label.position.set(midpoint.x, midpoint.y - 54);
    this.trailLayer.addChild(graphics);
    this.trailLayer.addChild(this.liveTrail);
    this.feedbackLayer.addChild(label);
    this.trails.push({
      graphics,
      label,
      points: points.map((point) => ({ x: point.x, y: point.y })),
      ageMs: 0,
      durationMs: success ? 820 : 680,
      success,
      canceled
    });

    while (this.trails.length > 8) {
      this.removeTrail(this.trails[0]!);
    }
  }

  private addFloatingLabel(text: string, x: number, y: number, success: boolean): void {
    const points = [
      { x: x - 4, y },
      { x: x + 4, y }
    ];
    this.addSwipeTrail(points, text, success, false);
  }

  private tapMessage(event: TapEvent): string {
    if (event.target === 'orb') {
      return 'STABILIZED +8';
    }
    if (event.target === 'flyby') {
      return 'BONUS';
    }
    if (event.target === 'arm') {
      return 'STUNNED';
    }
    return 'MISS';
  }

  private renderTrails(): void {
    this.liveTrail.clear();
    for (const trail of this.trails) {
      const alpha = clamp(1 - trail.ageMs / trail.durationMs, 0, 1);
      trail.graphics.clear();
      this.drawTrailPath(trail.graphics, trail.points, alpha, trail.success, trail.canceled);
      trail.label.alpha = alpha;
      trail.label.y -= 0.28;
    }

    if (this.liveGesturePoints.length > 0) {
      this.drawTrailPath(this.liveTrail, this.liveGesturePoints, 0.9, true, false);
    }
  }

  private drawTrailPath(
    graphics: Graphics,
    points: readonly WorldPoint[],
    alpha: number,
    success: boolean,
    canceled: boolean
  ): void {
    if (points.length === 0) {
      return;
    }
    const color = canceled ? 0x7d90a2 : success ? 0xd267ff : 0xff6a83;
    const core = success ? 0xffffff : color;
    graphics.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index += 1) {
      graphics.lineTo(points[index].x, points[index].y);
    }
    graphics.stroke({ color, alpha: alpha * 0.42, width: 22 });
    graphics.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index += 1) {
      graphics.lineTo(points[index].x, points[index].y);
    }
    graphics.stroke({ color: core, alpha: alpha * 0.95, width: 6 });
    const start = points[0];
    const end = points[points.length - 1];
    graphics.circle(start.x, start.y, 11).fill({ color: core, alpha: alpha * 0.9 });
    graphics.circle(end.x, end.y, success ? 18 : 13).stroke({ color: core, alpha: alpha, width: success ? 5 : 3 });
  }

  private renderEnergyPulses(): void {
    this.energyPulseLayer.clear();
    for (const pulse of this.energyPulses) {
      const t = clamp(pulse.ageMs / pulse.durationMs, 0, 1);
      const targetX = WORLD_WIDTH / 2;
      const targetY = WORLD_HEIGHT - 112;
      const x = pulse.startX + (targetX - pulse.startX) * t;
      const y = pulse.startY + (targetY - pulse.startY) * t;
      const alpha = 1 - t;
      this.energyPulseLayer.moveTo(pulse.startX, pulse.startY);
      this.energyPulseLayer.lineTo(x, y);
      this.energyPulseLayer.stroke({ color: 0x67f4ff, alpha: alpha * 0.34, width: 5 });
      this.energyPulseLayer.circle(x, y, 10 + (1 - t) * 10).fill({ color: 0xd267ff, alpha: alpha * 0.78 });
    }
  }

  private renderTutorial(snapshot: SimulationSnapshot): void {
    const tutorialOrb = snapshot.orbs.find((orb) => orb.active && orb.tutorial && !orb.captured);
    if (tutorialOrb && snapshot.harvestCount === 0) {
      this.tutorialText.visible = true;
      this.tutorialText.text = 'SWIPE THE TETHER';
      this.tutorialText.position.set(tutorialOrb.x, tutorialOrb.y - tutorialOrb.radius - 76);
      return;
    }

    if (this.onboardingMessageMs > 0 && this.onboardingMessage) {
      this.tutorialText.visible = true;
      this.tutorialText.text = this.onboardingMessage;
      this.tutorialText.position.set(WORLD_WIDTH / 2, WORLD_HEIGHT * 0.31);
      return;
    }

    if (snapshot.harvestCount > 0 && snapshot.timeMs < 22000) {
      this.tutorialText.visible = true;
      this.tutorialText.text = 'TAP TO STABILIZE';
      this.tutorialText.position.set(WORLD_WIDTH / 2, WORLD_HEIGHT * 0.31);
      return;
    }

    this.tutorialText.visible = false;
  }

  private renderDebug(snapshot: SimulationSnapshot): void {
    this.debugText.visible = this.inputDebug;
    if (!this.inputDebug) {
      return;
    }
    const input = this.input?.getDebugInfo();
    const last = this.lastGesture;
    const start = input?.worldStart;
    const end = input?.worldEnd;
    this.debugText.text = [
      `input: ${input?.lastPointerEventType ?? 'none'} -> ${input?.lastGestureKind ?? 'none'}`,
      `screen: ${Math.round(input?.lastScreenDistance ?? 0)}px world: ${Math.round(input?.lastWorldDistance ?? 0)}`,
      `start: ${start ? `${Math.round(start.x)},${Math.round(start.y)}` : '--'}`,
      `end: ${end ? `${Math.round(end.x)},${Math.round(end.y)}` : '--'}`,
      `result: ${last?.result ? `${'target' in last.result ? last.result.target : 'empty'} / ${'message' in last.result ? last.result.message : 'TAP'}` : 'none'}`,
      `energy: ${Math.round(snapshot.energy)} score: ${snapshot.score}`
    ].join('\n');
  }

  private updateFeedbackTimers(dtMs: number): void {
    this.blackHolePulseMs = Math.max(0, this.blackHolePulseMs - dtMs);
    this.missPulseMs = Math.max(0, this.missPulseMs - dtMs);
    this.energyGlowMs = Math.max(0, this.energyGlowMs - dtMs);
    this.onboardingMessageMs = Math.max(0, this.onboardingMessageMs - dtMs);
    for (const [orbId, ms] of this.orbFlashMs) {
      const next = ms - dtMs;
      if (next <= 0) {
        this.orbFlashMs.delete(orbId);
      } else {
        this.orbFlashMs.set(orbId, next);
      }
    }
    for (let index = this.trails.length - 1; index >= 0; index -= 1) {
      const trail = this.trails[index];
      trail.ageMs += dtMs;
      if (trail.ageMs >= trail.durationMs) {
        this.removeTrail(trail);
      }
    }
    for (let index = this.energyPulses.length - 1; index >= 0; index -= 1) {
      const pulse = this.energyPulses[index];
      pulse.ageMs += dtMs;
      if (pulse.ageMs >= pulse.durationMs) {
        this.energyPulses.splice(index, 1);
      }
    }
  }

  private removeTrail(trail: TrailFeedback): void {
    const index = this.trails.indexOf(trail);
    if (index >= 0) {
      this.trails.splice(index, 1);
    }
    trail.graphics.destroy();
    trail.label.destroy();
  }

  private clearFeedback(): void {
    for (const trail of [...this.trails]) {
      this.removeTrail(trail);
    }
    this.energyPulses.length = 0;
    this.energyPulseLayer.clear();
    this.liveTrail.clear();
    this.orbFlashMs.clear();
    this.lastGesture = null;
    this.onboardingMessage = '';
    this.onboardingMessageMs = 0;
  }

  private saveBestRun(): void {
    if (this.bestSaved) {
      return;
    }
    this.bestSaved = true;
    try {
      const replay = this.sim.getReplayPayload();
      const bestSurvival = Number(localStorage.getItem('eventHorizon.bestSurvivalMs') ?? 0);
      const bestScore = Number(localStorage.getItem('eventHorizon.bestScore') ?? 0);
      if (replay.survivalMs > bestSurvival) {
        localStorage.setItem('eventHorizon.bestSurvivalMs', String(replay.survivalMs));
      }
      if (replay.score > bestScore) {
        localStorage.setItem('eventHorizon.bestScore', String(replay.score));
      }
    } catch {
      // Private browsing or locked-down WebViews can reject localStorage.
    }
  }

  private readonly resize = (): void => {
    const rect = this.root.getBoundingClientRect();
    this.scale = Math.min(rect.width / WORLD_WIDTH, rect.height / WORLD_HEIGHT);
    const viewWidth = WORLD_WIDTH * this.scale;
    const viewHeight = WORLD_HEIGHT * this.scale;
    this.offsetX = (rect.width - viewWidth) / 2;
    this.offsetY = (rect.height - viewHeight) / 2;
    this.world.position.set(this.offsetX, this.offsetY);
    this.world.scale.set(this.scale);
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
      const dataUrl = this.app.canvas.toDataURL('image/png', 0.72);
      this.frameSamples.push({ dataUrl, label });
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
      label: `mock-${index}`
    }));
  }

  private makeMockFrame(snapshot: SimulationSnapshot, index: number): string {
    const canvas = document.createElement('canvas');
    canvas.width = 540;
    canvas.height = 960;
    const context = canvas.getContext('2d');
    if (!context) {
      return '';
    }
    context.fillStyle = '#03040a';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = index === 0 ? '#143c5c' : index === 1 ? '#3c285f' : '#501421';
    context.beginPath();
    context.arc(270, 410, 180 + snapshot.phase * 24, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#000000';
    context.beginPath();
    context.arc(270, 410, 62 + snapshot.phase * 15, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#f7fbff';
    context.font = '700 54px system-ui';
    context.fillText(String(snapshot.score), 52, 830);
    return canvas.toDataURL('image/png', 0.8);
  }
}
