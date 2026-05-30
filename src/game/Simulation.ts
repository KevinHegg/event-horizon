import {
  BLACK_HOLE_X,
  BLACK_HOLE_Y,
  FLYBY_POOL_SIZE,
  INITIAL_ENERGY,
  MAX_ENERGY,
  ORB_POOL_SIZE,
  WORLD_HEIGHT,
  WORLD_WIDTH
} from './constants';
import { clamp, distanceSquared, distanceToSegmentSquared } from './math';
import { createSeededRandom, type RandomSource } from './rng';
import type {
  FlybyState,
  GamePhase,
  OrbState,
  PhaseTransition,
  ReplayPayload,
  ShadowArmState,
  SimulationSnapshot,
  SwipeEvent,
  TapEvent
} from './types';

const ORB_CAPTURE_RADIUS = 82;
const FLYBY_CAPTURE_RADIUS = 58;
const EVENT_HORIZON_RADIUS = 98;
const ARM_LENGTH = 760;
const ARM_HIT_WIDTH = 46;

export interface SimulationOptions {
  seed: string;
  startedAt: number;
}

export interface TimedInput {
  kind: 'tap' | 'swipe';
  t: number;
  x: number;
  y: number;
  x2?: number;
  y2?: number;
}

export class Simulation {
  readonly seed: string;
  readonly startedAt: number;
  private rng: RandomSource;
  private nextOrbId = 1;
  private nextFlybyId = 1;
  private orbSpawnMs = 900;
  private flybySpawnMs = 2600;
  private readonly tapEvents: TapEvent[] = [];
  private readonly swipeEvents: SwipeEvent[] = [];
  private readonly phaseTransitions: PhaseTransition[] = [];
  private readonly orbs: OrbState[] = [];
  private readonly flybys: FlybyState[] = [];
  private readonly shadowArms: ShadowArmState[] = [];
  private timeMs = 0;
  private score = 0;
  private energy = INITIAL_ENERGY;
  private energyCaptured = 0;
  private streak = 0;
  private maxStreak = 0;
  private phase: GamePhase = 1;
  private ended = false;
  private collapseMs = 0;

  constructor(options: SimulationOptions) {
    this.seed = options.seed;
    this.startedAt = options.startedAt;
    this.rng = createSeededRandom(options.seed);
    this.initPools();
    this.phaseTransitions.push({ t: 0, phase: 1, energy: this.energy });
  }

  reset(): void {
    this.rng = createSeededRandom(this.seed);
    this.nextOrbId = 1;
    this.nextFlybyId = 1;
    this.orbSpawnMs = 900;
    this.flybySpawnMs = 2600;
    this.tapEvents.length = 0;
    this.swipeEvents.length = 0;
    this.phaseTransitions.length = 0;
    this.timeMs = 0;
    this.score = 0;
    this.energy = INITIAL_ENERGY;
    this.energyCaptured = 0;
    this.streak = 0;
    this.maxStreak = 0;
    this.phase = 1;
    this.ended = false;
    this.collapseMs = 0;
    this.initPools();
    this.phaseTransitions.push({ t: 0, phase: 1, energy: this.energy });
  }

  step(dtMs: number): void {
    const dt = dtMs / 1000;
    if (this.ended) {
      this.timeMs += dtMs;
      this.collapseMs = Math.min(this.collapseMs + dtMs, 2200);
      return;
    }

    this.timeMs += dtMs;
    this.energy = clamp(this.energy - dt * (0.28 + this.phase * 0.05), 0, MAX_ENERGY);
    this.spawnOrbs(dtMs);
    this.spawnFlybys(dtMs);
    this.updateShadowArms(dtMs);
    this.updateOrbs(dtMs, dt);
    this.updateFlybys(dtMs, dt);
    this.updatePhase();

    if (this.energy <= 0) {
      this.endRun();
    }
  }

  applyTap(x: number, y: number): TapEvent {
    let target: TapEvent['target'] = 'empty';
    const flyby = this.findFlyby(x, y);
    if (flyby) {
      this.collectFlyby(flyby);
      target = 'flyby';
    } else {
      const orb = this.findOrb(x, y, ORB_CAPTURE_RADIUS);
      if (orb) {
        orb.frozenMs = Math.max(orb.frozenMs, 520);
        this.score += 8 + this.phase;
        target = 'orb';
      } else if (this.stunArm(x, y)) {
        target = 'arm';
      }
    }

    const event: TapEvent = { t: Math.round(this.timeMs), x: Math.round(x), y: Math.round(y), target };
    this.tapEvents.push(event);
    return event;
  }

  applySwipe(x1: number, y1: number, x2: number, y2: number): SwipeEvent {
    const orb = this.findOrbOnSegment(x1, y1, x2, y2);
    const target: SwipeEvent['target'] = orb ? 'orb' : 'empty';
    if (orb) {
      this.captureOrb(orb);
    }
    const event: SwipeEvent = {
      t: Math.round(this.timeMs),
      x1: Math.round(x1),
      y1: Math.round(y1),
      x2: Math.round(x2),
      y2: Math.round(y2),
      target
    };
    this.swipeEvents.push(event);
    return event;
  }

  forceEnd(): void {
    this.energy = 0;
    this.endRun();
  }

  getSnapshot(): SimulationSnapshot {
    return {
      timeMs: Math.round(this.timeMs),
      score: this.score,
      energy: this.energy,
      energyCaptured: this.energyCaptured,
      streak: this.streak,
      maxStreak: this.maxStreak,
      phase: this.phase,
      ended: this.ended,
      collapseT: clamp(this.collapseMs / 2200, 0, 1),
      orbs: this.orbs,
      flybys: this.flybys,
      shadowArms: this.shadowArms
    };
  }

  getReplayPayload(): ReplayPayload {
    return {
      version: 1,
      seed: this.seed,
      startedAt: this.startedAt,
      survivalMs: Math.round(this.ended ? this.timeMs - this.collapseMs : this.timeMs),
      score: this.score,
      energyCaptured: this.energyCaptured,
      maxStreak: this.maxStreak,
      tapEvents: this.tapEvents.map((event) => ({ ...event })),
      swipeEvents: this.swipeEvents.map((event) => ({ ...event })),
      phaseTransitions: this.phaseTransitions.map((event) => ({ ...event }))
    };
  }

  runInputs(inputs: TimedInput[], untilMs: number): ReplayPayload {
    let inputIndex = 0;
    const ordered = [...inputs].sort((a, b) => a.t - b.t);
    while (this.timeMs < untilMs && !this.ended) {
      while (inputIndex < ordered.length && ordered[inputIndex].t <= this.timeMs) {
        const input = ordered[inputIndex];
        if (input.kind === 'tap') {
          this.applyTap(input.x, input.y);
        } else {
          this.applySwipe(input.x, input.y, input.x2 ?? input.x, input.y2 ?? input.y);
        }
        inputIndex += 1;
      }
      this.step(1000 / 60);
    }
    return this.getReplayPayload();
  }

  private initPools(): void {
    this.orbs.length = 0;
    this.flybys.length = 0;
    this.shadowArms.length = 0;
    for (let index = 0; index < ORB_POOL_SIZE; index += 1) {
      this.orbs.push(this.makeInactiveOrb(index));
    }
    for (let index = 0; index < FLYBY_POOL_SIZE; index += 1) {
      this.flybys.push(this.makeInactiveFlyby(index));
    }
    for (let index = 0; index < 3; index += 1) {
      this.shadowArms.push({
        angle: index * ((Math.PI * 2) / 3),
        stunMs: 0,
        intensity: 0
      });
    }
  }

  private makeInactiveOrb(index: number): OrbState {
    return {
      active: false,
      captured: false,
      id: -index,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      radius: 26,
      ageMs: 0,
      frozenMs: 0,
      energy: 1,
      tetherPhase: 0
    };
  }

  private makeInactiveFlyby(index: number): FlybyState {
    return {
      active: false,
      id: -index,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      radius: 24,
      ageMs: 0
    };
  }

  private spawnOrbs(dtMs: number): void {
    this.orbSpawnMs -= dtMs;
    if (this.orbSpawnMs > 0) {
      return;
    }
    this.orbSpawnMs = clamp(1020 - this.phase * 120 - this.timeMs * 0.006, 430, 1100);
    const orb = this.orbs.find((candidate) => !candidate.active);
    if (!orb) {
      return;
    }

    const edge = Math.floor(this.rng() * 4);
    const margin = 96;
    let x = margin + this.rng() * (WORLD_WIDTH - margin * 2);
    let y = margin + this.rng() * (WORLD_HEIGHT - margin * 2);
    if (edge === 0) {
      y = margin;
    } else if (edge === 1) {
      x = WORLD_WIDTH - margin;
    } else if (edge === 2) {
      y = WORLD_HEIGHT - margin * 1.9;
    } else {
      x = margin;
    }
    const angle = Math.atan2(y - BLACK_HOLE_Y, x - BLACK_HOLE_X);
    const tangentSign = this.rng() > 0.5 ? 1 : -1;
    const tangent = angle + (Math.PI / 2) * tangentSign + (this.rng() - 0.5) * 0.45;
    const speed = 76 + this.rng() * 48 + this.phase * 12;
    const inwardX = BLACK_HOLE_X - x;
    const inwardY = BLACK_HOLE_Y - y;
    const inwardLength = Math.max(1, Math.hypot(inwardX, inwardY));

    orb.active = true;
    orb.captured = false;
    orb.id = this.nextOrbId;
    this.nextOrbId += 1;
    orb.x = x;
    orb.y = y;
    orb.vx = Math.cos(tangent) * speed + (inwardX / inwardLength) * 42;
    orb.vy = Math.sin(tangent) * speed + (inwardY / inwardLength) * 42;
    orb.radius = 24 + this.rng() * 13;
    orb.ageMs = 0;
    orb.frozenMs = 0;
    orb.energy = 2 + this.rng() * 2.8;
    orb.tetherPhase = this.rng() * Math.PI * 2;
  }

  private spawnFlybys(dtMs: number): void {
    this.flybySpawnMs -= dtMs;
    if (this.flybySpawnMs > 0) {
      return;
    }
    this.flybySpawnMs = 4700 + this.rng() * 1900 - this.phase * 320;
    const flyby = this.flybys.find((candidate) => !candidate.active);
    if (!flyby) {
      return;
    }
    const fromLeft = this.rng() > 0.5;
    const y = 240 + this.rng() * (WORLD_HEIGHT - 620);
    const speed = 760 + this.rng() * 240;
    flyby.active = true;
    flyby.id = this.nextFlybyId;
    this.nextFlybyId += 1;
    flyby.x = fromLeft ? -80 : WORLD_WIDTH + 80;
    flyby.y = y;
    flyby.vx = fromLeft ? speed : -speed;
    flyby.vy = (this.rng() - 0.5) * 110;
    flyby.radius = 22 + this.rng() * 9;
    flyby.ageMs = 0;
  }

  private updateShadowArms(dtMs: number): void {
    const dt = dtMs / 1000;
    for (let index = 0; index < this.shadowArms.length; index += 1) {
      const arm = this.shadowArms[index];
      arm.angle += dt * (0.12 + this.phase * 0.045) * (index % 2 === 0 ? 1 : -1);
      arm.stunMs = Math.max(0, arm.stunMs - dtMs);
      arm.intensity = arm.stunMs > 0 ? 0.25 : clamp((this.phase - 1) / 3, 0, 1);
    }
  }

  private updateOrbs(dtMs: number, dt: number): void {
    for (const orb of this.orbs) {
      if (!orb.active) {
        continue;
      }

      orb.ageMs += dtMs;
      if (orb.captured) {
        const captureT = clamp(dt * 8, 0, 1);
        orb.x += (BLACK_HOLE_X - orb.x) * captureT;
        orb.y += (WORLD_HEIGHT - 112 - orb.y) * captureT;
        orb.radius *= 1 + dt * 0.8;
        if (orb.ageMs > 460) {
          orb.active = false;
        }
        continue;
      }

      if (orb.frozenMs > 0) {
        orb.frozenMs = Math.max(0, orb.frozenMs - dtMs);
      } else {
        const dx = BLACK_HOLE_X - orb.x;
        const dy = BLACK_HOLE_Y - orb.y;
        const radiusSq = dx * dx + dy * dy;
        const radius = Math.max(48, Math.sqrt(radiusSq));
        const gravity = (this.phase >= 3 ? 420000 : 190000) / radiusSq;
        orb.vx += (dx / radius) * gravity * dt;
        orb.vy += (dy / radius) * gravity * dt;
        this.applyArmInfluence(orb, dt);
        orb.x += orb.vx * dt;
        orb.y += orb.vy * dt;
      }

      const distanceToHole = distanceSquared(orb.x, orb.y, BLACK_HOLE_X, BLACK_HOLE_Y);
      if (distanceToHole < EVENT_HORIZON_RADIUS * EVENT_HORIZON_RADIUS) {
        this.missOrb(orb);
      } else if (
        orb.x < -240 ||
        orb.x > WORLD_WIDTH + 240 ||
        orb.y < -260 ||
        orb.y > WORLD_HEIGHT + 260 ||
        orb.ageMs > 17500
      ) {
        this.missOrb(orb);
      }
    }
  }

  private updateFlybys(dtMs: number, dt: number): void {
    for (const flyby of this.flybys) {
      if (!flyby.active) {
        continue;
      }
      flyby.ageMs += dtMs;
      flyby.x += flyby.vx * dt;
      flyby.y += flyby.vy * dt;
      if (
        flyby.x < -180 ||
        flyby.x > WORLD_WIDTH + 180 ||
        flyby.y < -160 ||
        flyby.y > WORLD_HEIGHT + 160 ||
        flyby.ageMs > 4500
      ) {
        flyby.active = false;
      }
    }
  }

  private applyArmInfluence(orb: OrbState, dt: number): void {
    if (this.phase < 2) {
      return;
    }
    for (const arm of this.shadowArms) {
      if (arm.stunMs > 0) {
        continue;
      }
      const endX = BLACK_HOLE_X + Math.cos(arm.angle) * ARM_LENGTH;
      const endY = BLACK_HOLE_Y + Math.sin(arm.angle) * ARM_LENGTH;
      const distance = distanceToSegmentSquared(orb.x, orb.y, BLACK_HOLE_X, BLACK_HOLE_Y, endX, endY);
      if (distance > (ARM_HIT_WIDTH + orb.radius) * (ARM_HIT_WIDTH + orb.radius)) {
        continue;
      }
      const normalX = Math.cos(arm.angle + Math.PI / 2);
      const normalY = Math.sin(arm.angle + Math.PI / 2);
      const push = this.phase >= 4 ? -130 : 92;
      orb.vx += normalX * push * dt;
      orb.vy += normalY * push * dt;
      if (this.phase >= 4) {
        orb.vx += (BLACK_HOLE_X - orb.x) * 0.17 * dt;
        orb.vy += (BLACK_HOLE_Y - orb.y) * 0.17 * dt;
      }
    }
  }

  private updatePhase(): void {
    const nextPhase: GamePhase =
      this.energy > 64 ? 1 : this.energy > 39 ? 2 : this.energy > 18 ? 3 : 4;
    if (nextPhase !== this.phase) {
      this.phase = nextPhase;
      this.phaseTransitions.push({
        t: Math.round(this.timeMs),
        phase: this.phase,
        energy: Math.round(this.energy * 10) / 10
      });
    }
  }

  private findOrb(x: number, y: number, radius: number): OrbState | undefined {
    let best: OrbState | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const orb of this.orbs) {
      if (!orb.active || orb.captured) {
        continue;
      }
      const hitRadius = radius + orb.radius;
      const dist = distanceSquared(x, y, orb.x, orb.y);
      if (dist < hitRadius * hitRadius && dist < bestDistance) {
        best = orb;
        bestDistance = dist;
      }
    }
    return best;
  }

  private findOrbOnSegment(x1: number, y1: number, x2: number, y2: number): OrbState | undefined {
    let best: OrbState | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const orb of this.orbs) {
      if (!orb.active || orb.captured) {
        continue;
      }
      const dist = distanceToSegmentSquared(orb.x, orb.y, x1, y1, x2, y2);
      const hitRadius = orb.radius + 62;
      if (dist < hitRadius * hitRadius && dist < bestDistance) {
        best = orb;
        bestDistance = dist;
      }
    }
    return best;
  }

  private findFlyby(x: number, y: number): FlybyState | undefined {
    for (const flyby of this.flybys) {
      if (!flyby.active) {
        continue;
      }
      const hitRadius = flyby.radius + FLYBY_CAPTURE_RADIUS;
      if (distanceSquared(x, y, flyby.x, flyby.y) <= hitRadius * hitRadius) {
        return flyby;
      }
    }
    return undefined;
  }

  private stunArm(x: number, y: number): boolean {
    if (this.phase < 2) {
      return false;
    }
    for (const arm of this.shadowArms) {
      const endX = BLACK_HOLE_X + Math.cos(arm.angle) * ARM_LENGTH;
      const endY = BLACK_HOLE_Y + Math.sin(arm.angle) * ARM_LENGTH;
      if (distanceToSegmentSquared(x, y, BLACK_HOLE_X, BLACK_HOLE_Y, endX, endY) < 76 * 76) {
        arm.stunMs = 1050;
        this.score += 16;
        return true;
      }
    }
    return false;
  }

  private captureOrb(orb: OrbState): void {
    orb.captured = true;
    orb.ageMs = 0;
    orb.frozenMs = 0;
    orb.vx = 0;
    orb.vy = 0;
    const energyGain = orb.energy + 2.1;
    this.energy = clamp(this.energy + energyGain, 0, MAX_ENERGY);
    this.energyCaptured += Math.round(energyGain);
    this.streak += 1;
    this.maxStreak = Math.max(this.maxStreak, this.streak);
    this.score += Math.round(72 + energyGain * 24 + this.streak * 7 + this.phase * 13);
  }

  private collectFlyby(flyby: FlybyState): void {
    flyby.active = false;
    this.energy = clamp(this.energy + 1.4, 0, MAX_ENERGY);
    this.energyCaptured += 1;
    this.streak += 1;
    this.maxStreak = Math.max(this.maxStreak, this.streak);
    this.score += 115 + this.phase * 18 + this.streak * 3;
  }

  private missOrb(orb: OrbState): void {
    orb.active = false;
    this.streak = 0;
    this.energy = clamp(this.energy - (6.5 + this.phase * 1.2), 0, MAX_ENERGY);
  }

  private endRun(): void {
    if (this.ended) {
      return;
    }
    this.ended = true;
    this.collapseMs = 0;
    this.energy = 0;
  }
}
