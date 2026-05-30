export type GamePhase = 1 | 2 | 3 | 4;

export interface TapEvent {
  t: number;
  x: number;
  y: number;
  target: 'orb' | 'flyby' | 'arm' | 'empty';
}

export interface SwipeEvent {
  t: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  target: 'orb' | 'empty';
}

export interface PhaseTransition {
  t: number;
  phase: GamePhase;
  energy: number;
}

export interface ReplayPayload {
  version: 1;
  seed: string;
  startedAt: number;
  survivalMs: number;
  score: number;
  energyCaptured: number;
  maxStreak: number;
  tapEvents: TapEvent[];
  swipeEvents: SwipeEvent[];
  phaseTransitions: PhaseTransition[];
}

export interface OrbState {
  active: boolean;
  captured: boolean;
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  ageMs: number;
  frozenMs: number;
  energy: number;
  tetherPhase: number;
}

export interface FlybyState {
  active: boolean;
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  ageMs: number;
}

export interface ShadowArmState {
  angle: number;
  stunMs: number;
  intensity: number;
}

export interface SimulationSnapshot {
  timeMs: number;
  score: number;
  energy: number;
  energyCaptured: number;
  streak: number;
  maxStreak: number;
  phase: GamePhase;
  ended: boolean;
  collapseT: number;
  orbs: readonly OrbState[];
  flybys: readonly FlybyState[];
  shadowArms: readonly ShadowArmState[];
}

export interface PosterStats {
  score: number;
  survivalMs: number;
  seed: string;
  phase: GamePhase;
}
