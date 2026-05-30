import type { WorldPoint } from '../gestures';

export type PulseGamePhase = 'build' | 'pulse' | 'ended';
export type PulseEndReason = 'collapsed' | 'stabilized' | 'pulse-died' | 'manual';
export type PulseNodeType = 'source' | 'conduit' | 'energy' | 'delay' | 'splitter';
export type TutorialStep =
  | 'battery-goal'
  | 'swipe-batteries'
  | 'add-battery'
  | 'close-loop'
  | 'press-play'
  | 'loop-alive'
  | 'advanced'
  | 'complete'
  | 'skipped';
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
  lit: boolean;
  required: boolean;
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
  reachableBatteryNodes: number;
  totalRequiredBatteries: number;
  reachableBatteryIds: number[];
  missingBatteryIds: number[];
  deadEndNodeIds: number[];
  hasLoop: boolean;
  sourceLoopClosed: boolean;
  allRequiredBatteriesReachable: boolean;
  allRequiredBatteriesInLoop: boolean;
  linksUsed: number;
  quality:
    | 'Start at SOURCE'
    | 'Reach the Batteries'
    | 'This chain misses a Battery'
    | 'This chain has a dead end'
    | 'Close the loop'
    | 'Good chain'
    | 'Great loop';
  hint: string;
}

export interface SuggestedFix {
  fromId: number;
  toId: number;
  message: string;
}

export interface NodeInfoCard {
  nodeId: number;
  title: string;
  body: string;
  action: string;
}

export interface PulseLevel {
  seed: string;
  nodes: PulseNode[];
  sourceId: number;
  linkBudget: number;
  targetScore: number;
  targetSurvivalMs: number;
  requiredBatteryIds: number[];
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
  batteriesLit: number;
  batteriesRequired: number;
  loopClosed: boolean;
  loopHoldMs: number;
  primaryGoalComplete: boolean;
  stabilized: boolean;
  collapsed: boolean;
  failureReason: string;
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
  batteriesLit: number;
  batteriesRequired: number;
  requiredBatteryIds: readonly number[];
  loopClosed: boolean;
  loopHoldMs: number;
  primaryGoalComplete: boolean;
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
  nodeInfoCard?: NodeInfoCard;
  lastChainNodeIds: readonly number[];
  lastTapAction: NodeTapAction;
  deadEndNodeId?: number;
  failureReason: string;
  lastInputResult: PulseInputResult;
  stepHash: string;
}
