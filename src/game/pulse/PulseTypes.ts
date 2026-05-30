import type { WorldPoint } from '../gestures';

export type PulseGamePhase = 'build' | 'pulse' | 'ended';
export type PulseEndReason = 'collapsed' | 'stabilized' | 'pulse-died' | 'manual';
export type PulseNodeType = 'source' | 'conduit' | 'energy' | 'delay' | 'splitter';
export type TutorialStep = 'swipe-chain' | 'tap-splitter' | 'press-play' | 'stabilize' | 'lens' | 'loops' | 'complete' | 'skipped';
export type NodeTapAction = 'select' | 'prime' | 'delay' | 'splitter' | 'stabilize' | 'none';

export interface PulseNode extends WorldPoint {
  id: number;
  type: PulseNodeType;
  radius: number;
  ring: number;
  label: string;
  activationMs: number;
  scoreCooldownMs: number;
  primed: boolean;
  delayLevel: 0 | 1 | 2;
  splitterPriority: number;
  stabilizedMs: number;
}

export interface PulseLink {
  id: number;
  fromId: number;
  toId: number;
  temporary: boolean;
  ageMs: number;
  expiresMs: number;
  flashMs: number;
}

export interface PulseState {
  id: number;
  currentNodeId: number;
  previousNodeId?: number;
  nextNodeId?: number;
  progress: number;
  speed: number;
  ageMs: number;
  energy: number;
  comboChainLength: number;
  delayMs: number;
  alive: boolean;
  visitedNodeIds: number[];
}

export interface HorizonLens {
  id: number;
  path: WorldPoint[];
  fromId?: number;
  toId?: number;
  ageMs: number;
  durationMs: number;
  success: boolean;
  message: 'HORIZON LENS' | 'BRIDGE CREATED' | 'NO ANCHOR';
}

export interface ChainAnalysis {
  reachableEnergyNodes: number;
  totalEnergyNodes: number;
  deadEndNodeIds: number[];
  hasLoop: boolean;
  linksUsed: number;
  quality: 'Draw a chain' | 'Good start' | 'Hit more Energy nodes' | 'Dead end detected' | 'Loop possible' | 'Great loop';
}

export interface SuggestedFix {
  fromId: number;
  toId: number;
  message: string;
}

export interface PulseLevel {
  seed: string;
  nodes: PulseNode[];
  sourceId: number;
  linkBudget: number;
  targetScore: number;
  targetSurvivalMs: number;
}

export type BuildInput =
  | { t: number; kind: 'link'; fromId: number; toId: number }
  | { t: number; kind: 'chainSwipe'; nodeIds: number[]; path: { x: number; y: number; t: number }[] }
  | { t: number; kind: 'nodeTap'; nodeId: number; action: NodeTapAction }
  | { t: number; kind: 'undo' }
  | { t: number; kind: 'clear' }
  | { t: number; kind: 'play' };

export type LiveInput =
  | {
      t: number;
      kind: 'lens';
      path: { x: number; y: number; t: number }[];
      fromId?: number;
      toId?: number;
      success: boolean;
    }
  | {
      t: number;
      kind: 'stabilize';
      nodeId: number;
      rating: 'perfect' | 'stabilized' | 'early' | 'late';
      success: boolean;
    };

export interface PulseResult {
  score: number;
  survivalMs: number;
  maxMultiplier: number;
  loopsCompleted: number;
  linksUsed: number;
  bestChainLength: number;
  energyNodesHit: number;
  stabilized: boolean;
  collapsed: boolean;
}

export interface PulseReplayPayload {
  version: 1;
  mode: 'pulse-chain';
  seed: string;
  startedAt: number;
  buildInputs: BuildInput[];
  liveInputs: LiveInput[];
  result: PulseResult;
  stepHash: string;
}

export interface PulseInputResult {
  ok: boolean;
  kind: 'select' | 'link' | 'chainSwipe' | 'nodeTap' | 'stabilize' | 'undo' | 'clear' | 'play' | 'lens' | 'fix' | 'invalid' | 'none';
  message: string;
  fromId?: number;
  toId?: number;
  nodeId?: number;
  nodeIds?: number[];
  scoreDelta?: number;
  energyDelta?: number;
}

export interface PulseSnapshot {
  mode: 'pulse-chain';
  seed: string;
  phase: PulseGamePhase;
  timeMs: number;
  score: number;
  darkEnergy: number;
  collapseMeter: number;
  multiplier: number;
  maxMultiplier: number;
  chainLength: number;
  loopsCompleted: number;
  linkBudget: number;
  linksUsed: number;
  lensCharges: number;
  targetScore: number;
  targetSurvivalMs: number;
  ended: boolean;
  endReason?: PulseEndReason;
  collapsed: boolean;
  stabilized: boolean;
  nodes: readonly PulseNode[];
  links: readonly PulseLink[];
  pulses: readonly PulseState[];
  lenses: readonly HorizonLens[];
  selectedNodeId?: number;
  tutorialHint: string;
  tutorialActive: boolean;
  tutorialStep: TutorialStep;
  tutorialHighlightNodeIds: readonly number[];
  tutorialGhostPath: readonly WorldPoint[];
  chainAnalysis: ChainAnalysis;
  suggestedFixes: readonly SuggestedFix[];
  lastChainNodeIds: readonly number[];
  lastTapAction: NodeTapAction;
  deadEndNodeId?: number;
  lastInputResult: PulseInputResult;
  stepHash: string;
}
