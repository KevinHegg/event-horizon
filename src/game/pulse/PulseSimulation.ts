import { INITIAL_ENERGY, MAX_ENERGY } from '../constants';
import { clamp } from '../math';
import { quantizeGesturePath, type GesturePathPoint, type WorldPoint } from '../gestures';
import { distancePointToSegment, nearestTwoNodesToPath, nodesCrossedByPath } from './PulseGeometry';
import { generatePulseLevel } from './PulseLevelGenerator';
import type {
  BuildInput,
  ChainAnalysis,
  HorizonLens,
  LiveInput,
  NodeTapAction,
  PulseGamePhase,
  PulseInputResult,
  PulseLevel,
  PulseLink,
  PulseNode,
  PulseReplayPayload,
  PulseResult,
  PulseSnapshot,
  PulseState,
  SuggestedFix,
  TutorialStep
} from './PulseTypes';

const NORMAL_PULSE_SPEED = 310;
const TUTORIAL_PULSE_SPEED = 220;
const LINK_TRAVERSAL_SCORE = 10;
const ENERGY_NODE_SCORE = 100;
const DELAY_NODE_SCORE = 25;
const SPLITTER_NODE_SCORE = 75;
const LENS_DURATION_MS = 1500;
const TUTORIAL_LENS_DURATION_MS = 2100;
const LENS_MAX_CHARGES = 2;
const ENERGY_DRAIN_PER_SECOND = 0.38;
const STABILIZE_SCORE = 50;
const DELAY_MS = [360, 700, 1080] as const;

export interface PulseSimulationOptions {
  seed: string;
  startedAt: number;
}

export class PulseSimulation {
  readonly startedAt: number;
  private seedValue: string;
  private level: PulseLevel;
  private phase: PulseGamePhase = 'build';
  private timeMs = 0;
  private score = 0;
  private darkEnergy = INITIAL_ENERGY;
  private multiplier = 1;
  private maxMultiplier = 1;
  private chainLength = 0;
  private loopsCompleted = 0;
  private nextLinkId = 1;
  private nextPulseId = 1;
  private nextLensId = 1;
  private endReason: PulseSnapshot['endReason'];
  private deadEndNodeId: number | undefined;
  private collapsed = false;
  private stabilized = false;
  private buildInputs: BuildInput[] = [];
  private liveInputs: LiveInput[] = [];
  private links: PulseLink[] = [];
  private pulses: PulseState[] = [];
  private lenses: HorizonLens[] = [];
  private lastInputResult: PulseInputResult = { ok: true, kind: 'none', message: 'CONNECT TWO NODES' };
  private selectedNodeId: number | undefined;
  private stepHash = '00000000';
  private lensCharges = LENS_MAX_CHARGES;
  private tutorialActive = false;
  private tutorialStep: TutorialStep = 'skipped';
  private lastChainNodeIds: number[] = [];
  private lastTapAction: NodeTapAction = 'none';
  private energyNodesHit = new Set<number>();
  private slowDrainMs = 0;

  constructor(options: PulseSimulationOptions) {
    this.seedValue = options.seed;
    this.startedAt = options.startedAt;
    this.level = generatePulseLevel(options.seed);
    if (options.seed === 'tutorial-001') {
      this.startTutorial();
    }
    this.updateHash();
  }

  get seed(): string {
    return this.seedValue;
  }

  reset(seed = this.seed): void {
    this.seedValue = seed;
    this.level = generatePulseLevel(seed);
    this.phase = 'build';
    this.timeMs = 0;
    this.score = 0;
    this.darkEnergy = INITIAL_ENERGY;
    this.multiplier = 1;
    this.maxMultiplier = 1;
    this.chainLength = 0;
    this.loopsCompleted = 0;
    this.nextLinkId = 1;
    this.nextPulseId = 1;
    this.nextLensId = 1;
    this.endReason = undefined;
    this.deadEndNodeId = undefined;
    this.collapsed = false;
    this.stabilized = false;
    this.buildInputs = [];
    this.liveInputs = [];
    this.links = [];
    this.pulses = [];
    this.lenses = [];
    this.selectedNodeId = undefined;
    this.lensCharges = LENS_MAX_CHARGES;
    this.lastChainNodeIds = [];
    this.lastTapAction = 'none';
    this.energyNodesHit = new Set();
    this.slowDrainMs = 0;
    this.tutorialActive = seed === 'tutorial-001';
    this.tutorialStep = this.tutorialActive ? 'swipe-chain' : 'skipped';
    this.lastInputResult = { ok: true, kind: 'none', message: this.tutorialActive ? 'SWIPE THROUGH THESE NODES' : 'DRAW A CHAIN' };
    this.updateHash();
  }

  step(dtMs: number): void {
    if (this.phase === 'ended') {
      this.timeMs += dtMs;
      this.updateTimedVisuals(dtMs);
      this.updateHash();
      return;
    }

    this.timeMs += dtMs;
    this.updateTimedVisuals(dtMs);

    if (this.phase === 'pulse') {
      const tutorialGrace = this.tutorialActive && this.timeMs < 10000;
      const drainScale = this.slowDrainMs > 0 || tutorialGrace ? 0.35 : 1;
      this.darkEnergy = clamp(this.darkEnergy - (dtMs / 1000) * ENERGY_DRAIN_PER_SECOND * drainScale, 0, MAX_ENERGY);
      this.slowDrainMs = Math.max(0, this.slowDrainMs - dtMs);
      this.updatePulses(dtMs);
      this.expireTemporaryLinks(dtMs);
      if (this.darkEnergy <= 0) {
        this.endRun('collapsed');
      } else if (this.score >= this.level.targetScore || this.timeMs >= this.level.targetSurvivalMs) {
        this.endRun('stabilized');
      } else if (this.pulses.every((pulse) => !pulse.alive) && this.timeMs > 500) {
        this.darkEnergy = clamp(this.darkEnergy - 0.9, 0, MAX_ENERGY);
        if (this.darkEnergy <= 0) {
          this.endRun('collapsed');
        } else {
          this.endRun('pulse-died');
        }
      }
    }
    this.updateHash();
  }

  selectNode(nodeId: number | undefined): PulseInputResult {
    this.selectedNodeId = nodeId;
    this.lastInputResult = nodeId
      ? { ok: true, kind: 'select', message: 'NODE SELECTED', fromId: nodeId }
      : { ok: true, kind: 'none', message: 'SELECT A NODE' };
    return this.lastInputResult;
  }

  addLink(fromId: number, toId: number, record = true): PulseInputResult {
    const validation = this.validateLink(fromId, toId, false);
    if (!validation.ok) {
      this.lastInputResult = validation;
      return validation;
    }
    const link: PulseLink = {
      id: this.nextLinkId,
      fromId,
      toId,
      temporary: false,
      ageMs: 0,
      expiresMs: 0,
      flashMs: 420
    };
    this.nextLinkId += 1;
    this.links.push(link);
    if (record) {
      this.buildInputs.push({ t: Math.round(this.timeMs), kind: 'link', fromId, toId });
    }
    this.selectedNodeId = undefined;
    this.lastInputResult = { ok: true, kind: 'link', message: 'GRAVITATIONAL LINK', fromId, toId };
    this.updateHash();
    return this.lastInputResult;
  }

  applyChainSwipe(points: readonly GesturePathPoint[], record = true): PulseInputResult {
    if (this.phase !== 'build') {
      this.lastInputResult = { ok: false, kind: 'invalid', message: 'CHAIN ONLY DURING BUILD' };
      return this.lastInputResult;
    }
    const path = quantizeGesturePath(points, 24);
    const crossed = nodesCrossedByPath(this.level.nodes, path, 78);
    const nodeIds = crossed.map((node) => node.id);
    this.lastChainNodeIds = nodeIds;
    if (nodeIds.length < 2) {
      this.lastInputResult = { ok: false, kind: 'chainSwipe', message: 'NO NODES CROSSED', nodeIds };
      this.advanceTutorial('chain-miss');
      return this.lastInputResult;
    }

    let created = 0;
    const createdNodes: number[] = [nodeIds[0]];
    for (let index = 1; index < nodeIds.length; index += 1) {
      const fromId = nodeIds[index - 1];
      const toId = nodeIds[index];
      if (fromId === toId) {
        continue;
      }
      const result = this.addLink(fromId, toId, false);
      if (!result.ok) {
        if (result.message === 'LINK EXISTS') {
          createdNodes.push(toId);
          continue;
        }
        if (result.message === 'LINK LIMIT') {
          break;
        }
        continue;
      }
      created += 1;
      createdNodes.push(toId);
    }

    if (created > 0 && record) {
      this.buildInputs.push({ t: Math.round(this.timeMs), kind: 'chainSwipe', nodeIds: createdNodes, path });
    }
    this.selectedNodeId = undefined;
    this.lastInputResult = created > 0
      ? { ok: true, kind: 'chainSwipe', message: `CHAIN CREATED ${created} LINKS`, nodeIds: createdNodes }
      : { ok: false, kind: 'chainSwipe', message: 'CHAIN BLOCKED', nodeIds };
    this.advanceTutorial('chain');
    this.updateHash();
    return this.lastInputResult;
  }

  tapNode(nodeId: number, record = true): PulseInputResult {
    const node = this.nodeById(nodeId);
    if (!node) {
      this.lastInputResult = { ok: false, kind: 'invalid', message: 'NO NODE', nodeId };
      return this.lastInputResult;
    }
    if (this.phase === 'pulse') {
      return this.stabilizeNode(nodeId, record);
    }

    let action: NodeTapAction = 'select';
    if (node.type === 'energy') {
      node.primed = !node.primed;
      node.activationMs = 520;
      action = 'prime';
      this.lastInputResult = { ok: true, kind: 'nodeTap', message: node.primed ? 'ENERGY PRIMED' : 'ENERGY UNPRIMED', nodeId };
    } else if (node.type === 'delay') {
      node.delayLevel = ((node.delayLevel + 1) % 3) as 0 | 1 | 2;
      node.activationMs = 520;
      action = 'delay';
      this.lastInputResult = { ok: true, kind: 'nodeTap', message: `DELAY ${node.delayLevel + 1}`, nodeId };
    } else if (node.type === 'splitter') {
      node.splitterPriority = (node.splitterPriority + 1) % 3;
      node.activationMs = 520;
      action = 'splitter';
      this.lastInputResult = { ok: true, kind: 'nodeTap', message: 'SPLITTER AIMED', nodeId };
      this.advanceTutorial('splitter');
    } else {
      this.selectedNodeId = nodeId;
      this.lastInputResult = { ok: true, kind: 'select', message: `SELECTED ${node.label}`, nodeId };
    }
    this.lastTapAction = action;
    if (record) {
      this.buildInputs.push({ t: Math.round(this.timeMs), kind: 'nodeTap', nodeId, action });
    }
    this.updateHash();
    return this.lastInputResult;
  }

  stabilizeNode(nodeId: number, record = true): PulseInputResult {
    const node = this.nodeById(nodeId);
    if (!node) {
      this.lastInputResult = { ok: false, kind: 'invalid', message: 'NO NODE', nodeId };
      return this.lastInputResult;
    }
    const arrival = this.arrivalReadiness(nodeId);
    let rating: 'perfect' | 'stabilized' | 'early' | 'late' = 'early';
    let success = false;
    if (arrival === 'late') {
      rating = 'late';
    } else if (arrival === 'perfect') {
      rating = 'perfect';
      success = true;
    } else if (arrival === 'soon') {
      rating = 'stabilized';
      success = true;
    }

    if (success) {
      node.stabilizedMs = 760;
      node.activationMs = 620;
      this.addScore(rating === 'perfect' ? STABILIZE_SCORE + 25 : STABILIZE_SCORE, 2.2);
      this.slowDrainMs = 1500;
      this.lastInputResult = {
        ok: true,
        kind: 'stabilize',
        message: rating === 'perfect' ? 'PERFECT TAP +75' : 'STABILIZED +50',
        nodeId,
        scoreDelta: rating === 'perfect' ? 75 : 50,
        energyDelta: 2
      };
    } else {
      this.lastInputResult = { ok: false, kind: 'stabilize', message: rating === 'late' ? 'LATE' : 'EARLY', nodeId };
    }
    this.lastTapAction = 'stabilize';
    if (record) {
      this.liveInputs.push({ t: Math.round(this.timeMs), kind: 'stabilize', nodeId, rating, success });
    }
    this.advanceTutorial('stabilize');
    this.updateHash();
    return this.lastInputResult;
  }

  removeLinkNear(point: WorldPoint): PulseInputResult {
    if (this.phase !== 'build') {
      this.lastInputResult = { ok: false, kind: 'invalid', message: 'LINKS LOCKED' };
      return this.lastInputResult;
    }
    let bestIndex = -1;
    let bestDistance = 54;
    for (let index = 0; index < this.links.length; index += 1) {
      const link = this.links[index];
      if (link.temporary) {
        continue;
      }
      const from = this.nodeById(link.fromId);
      const to = this.nodeById(link.toId);
      if (!from || !to) {
        continue;
      }
      const distance = distancePointToSegment(point, from, to);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }
    if (bestIndex === -1) {
      this.lastInputResult = { ok: false, kind: 'invalid', message: 'NO LINK' };
      return this.lastInputResult;
    }
    this.links.splice(bestIndex, 1);
    this.lastInputResult = { ok: true, kind: 'clear', message: 'LINK REMOVED' };
    this.updateHash();
    return this.lastInputResult;
  }

  undo(): PulseInputResult {
    const index = [...this.links].map((link, linkIndex) => ({ link, linkIndex })).reverse().find((entry) => !entry.link.temporary);
    if (!index) {
      this.lastInputResult = { ok: false, kind: 'invalid', message: 'NO LINK TO UNDO' };
      return this.lastInputResult;
    }
    this.links.splice(index.linkIndex, 1);
    this.buildInputs.push({ t: Math.round(this.timeMs), kind: 'undo' });
    this.lastInputResult = { ok: true, kind: 'undo', message: 'LINK UNDONE' };
    this.updateHash();
    return this.lastInputResult;
  }

  clearLinks(): PulseInputResult {
    this.links = this.links.filter((link) => link.temporary);
    this.buildInputs.push({ t: Math.round(this.timeMs), kind: 'clear' });
    this.selectedNodeId = undefined;
    this.lastInputResult = { ok: true, kind: 'clear', message: 'LINKS CLEARED' };
    this.updateHash();
    return this.lastInputResult;
  }

  playPulse(record = true): PulseInputResult {
    if (this.phase !== 'build') {
      this.lastInputResult = { ok: false, kind: 'invalid', message: 'PULSE ALREADY RUNNING' };
      return this.lastInputResult;
    }
    const outgoing = this.outgoingLinks(this.level.sourceId);
    if (outgoing.length === 0) {
      this.lastInputResult = { ok: false, kind: 'invalid', message: 'CONNECT SOURCE FIRST' };
      return this.lastInputResult;
    }
    this.phase = 'pulse';
    this.timeMs = 0;
    this.emitFromNode(this.level.sourceId, undefined, 0, []);
    if (record) {
      this.buildInputs.push({ t: 0, kind: 'play' });
    }
    this.lastInputResult = { ok: true, kind: 'play', message: 'STABILIZING PULSE' };
    this.advanceTutorial('play');
    this.updateHash();
    return this.lastInputResult;
  }

  applyLens(points: readonly GesturePathPoint[]): PulseInputResult {
    const path = quantizeGesturePath(points, 24);
    const lensPath = path.map((point) => ({ x: point.x, y: point.y }));
    if (this.phase !== 'pulse') {
      this.lastInputResult = { ok: false, kind: 'invalid', message: 'LENS ONLY DURING PLAYBACK' };
      return this.lastInputResult;
    }
    if (this.lensCharges <= 0) {
      this.lastInputResult = { ok: false, kind: 'lens', message: 'LENS RECHARGING' };
      return this.lastInputResult;
    }

    const anchors = nearestTwoNodesToPath(this.level.nodes, lensPath, 132);
    if (!anchors) {
      this.createLens(lensPath, false);
      this.liveInputs.push({ t: Math.round(this.timeMs), kind: 'lens', path, success: false });
      this.lastInputResult = { ok: false, kind: 'lens', message: 'NO ANCHOR - SWIPE BETWEEN TWO NODES' };
      return this.lastInputResult;
    }

    const [from, to] = anchors;
    const validation = this.validateLink(from.id, to.id, true);
    if (!validation.ok) {
      this.createLens(lensPath, false);
      this.liveInputs.push({ t: Math.round(this.timeMs), kind: 'lens', path, fromId: from.id, toId: to.id, success: false });
      this.lastInputResult = { ok: false, kind: 'lens', message: 'NO ANCHOR - SWIPE BETWEEN TWO NODES', fromId: from.id, toId: to.id };
      return this.lastInputResult;
    }

    this.links.push({
      id: this.nextLinkId,
      fromId: from.id,
      toId: to.id,
      temporary: true,
      ageMs: 0,
      expiresMs: this.tutorialActive ? TUTORIAL_LENS_DURATION_MS : LENS_DURATION_MS,
      flashMs: 520
    });
    this.nextLinkId += 1;
    this.lensCharges = Math.max(0, this.lensCharges - 1);
    this.createLens(lensPath, true, from.id, to.id);
    this.liveInputs.push({ t: Math.round(this.timeMs), kind: 'lens', path, fromId: from.id, toId: to.id, success: true });
    this.lastInputResult = { ok: true, kind: 'lens', message: 'HORIZON LENS - BRIDGE CREATED', fromId: from.id, toId: to.id };
    this.advanceTutorial('lens');
    this.updateHash();
    return this.lastInputResult;
  }

  forceBuildPhase(): void {
    this.phase = 'build';
    this.pulses = [];
    this.endReason = undefined;
    this.collapsed = false;
    this.stabilized = false;
    this.darkEnergy = Math.max(this.darkEnergy, 45);
    this.updateHash();
  }

  forcePulsePhase(): void {
    if (this.phase === 'build') {
      void this.playPulse(false);
    }
  }

  forceCollapse(): void {
    this.endRun('collapsed');
  }

  startTutorial(): void {
    this.seedValue = 'tutorial-001';
    this.level = generatePulseLevel(this.seedValue);
    this.tutorialActive = true;
    this.tutorialStep = 'swipe-chain';
    this.phase = 'build';
    this.timeMs = 0;
    this.score = 0;
    this.multiplier = 1;
    this.maxMultiplier = 1;
    this.chainLength = 0;
    this.loopsCompleted = 0;
    this.nextLinkId = 1;
    this.nextPulseId = 1;
    this.nextLensId = 1;
    this.buildInputs = [];
    this.liveInputs = [];
    this.links = [];
    this.pulses = [];
    this.lenses = [];
    this.endReason = undefined;
    this.deadEndNodeId = undefined;
    this.collapsed = false;
    this.stabilized = false;
    this.selectedNodeId = undefined;
    this.darkEnergy = INITIAL_ENERGY;
    this.lensCharges = LENS_MAX_CHARGES;
    this.lastChainNodeIds = [];
    this.lastTapAction = 'none';
    this.energyNodesHit = new Set();
    this.slowDrainMs = 0;
    this.lastInputResult = { ok: true, kind: 'none', message: 'SWIPE THROUGH THESE NODES', nodeIds: [1, 2, 3] };
    this.updateHash();
  }

  skipTutorial(): void {
    this.tutorialActive = false;
    this.tutorialStep = 'skipped';
    this.lastInputResult = { ok: true, kind: 'none', message: 'DRAW A CHAIN' };
    this.updateHash();
  }

  getTutorialStep(): TutorialStep {
    return this.tutorialStep;
  }

  analyzeChain(): ChainAnalysis {
    return this.computeChainAnalysis();
  }

  getSuggestedFixes(): readonly SuggestedFix[] {
    return this.computeSuggestedFixes();
  }

  primeNode(id: number): PulseInputResult {
    const node = this.nodeById(id);
    if (!node || node.type !== 'energy') {
      this.lastInputResult = { ok: false, kind: 'invalid', message: 'NOT ENERGY', nodeId: id };
      return this.lastInputResult;
    }
    node.primed = true;
    node.activationMs = 520;
    this.lastTapAction = 'prime';
    this.lastInputResult = { ok: true, kind: 'nodeTap', message: 'ENERGY PRIMED', nodeId: id };
    this.updateHash();
    return this.lastInputResult;
  }

  cycleNode(id: number): PulseInputResult {
    return this.tapNode(id);
  }

  fixChain(): PulseInputResult {
    this.forceBuildPhase();
    this.lastInputResult = { ok: true, kind: 'fix', message: 'FIX THE DEAD END', nodeId: this.deadEndNodeId };
    return this.lastInputResult;
  }

  getNodes(): readonly PulseNode[] {
    return this.level.nodes;
  }

  getLinks(): readonly PulseLink[] {
    return this.links;
  }

  getPulses(): readonly PulseState[] {
    return this.pulses;
  }

  getLastInputResult(): PulseInputResult {
    return { ...this.lastInputResult };
  }

  getReplayPayload(): PulseReplayPayload {
    return {
      version: 1,
      mode: 'pulse-chain',
      seed: this.seed,
      startedAt: this.startedAt,
      buildInputs: this.buildInputs.map((input) =>
        input.kind === 'chainSwipe'
          ? { ...input, nodeIds: [...input.nodeIds], path: input.path.map((point) => ({ ...point })) }
          : { ...input }
      ),
      liveInputs: this.liveInputs.map((input) =>
        input.kind === 'lens'
          ? { ...input, path: input.path.map((point) => ({ ...point })) }
          : { ...input }
      ),
      result: this.getResult(),
      stepHash: this.stepHash
    };
  }

  getSnapshot(): PulseSnapshot {
    return {
      mode: 'pulse-chain',
      seed: this.seed,
      phase: this.phase,
      timeMs: Math.round(this.timeMs),
      score: this.score,
      darkEnergy: this.darkEnergy,
      collapseMeter: this.darkEnergy,
      multiplier: this.multiplier,
      maxMultiplier: this.maxMultiplier,
      chainLength: this.chainLength,
      loopsCompleted: this.loopsCompleted,
      linkBudget: this.level.linkBudget,
      linksUsed: this.links.filter((link) => !link.temporary).length,
      lensCharges: this.lensCharges,
      targetScore: this.level.targetScore,
      targetSurvivalMs: this.level.targetSurvivalMs,
      ended: this.phase === 'ended',
      endReason: this.endReason,
      collapsed: this.collapsed,
      stabilized: this.stabilized,
      nodes: this.level.nodes,
      links: this.links,
      pulses: this.pulses,
      lenses: this.lenses,
      selectedNodeId: this.selectedNodeId,
      tutorialHint: this.tutorialHint(),
      tutorialActive: this.tutorialActive,
      tutorialStep: this.tutorialStep,
      tutorialHighlightNodeIds: this.tutorialHighlightNodeIds(),
      tutorialGhostPath: this.tutorialGhostPath(),
      chainAnalysis: this.computeChainAnalysis(),
      suggestedFixes: this.computeSuggestedFixes(),
      lastChainNodeIds: this.lastChainNodeIds,
      lastTapAction: this.lastTapAction,
      deadEndNodeId: this.deadEndNodeId,
      lastInputResult: this.lastInputResult,
      stepHash: this.stepHash
    };
  }

  private validateLink(fromId: number, toId: number, temporary: boolean): PulseInputResult {
    if (this.phase !== 'build' && !temporary) {
      return { ok: false, kind: 'invalid', message: 'LINKS LOCKED' };
    }
    const from = this.nodeById(fromId);
    const to = this.nodeById(toId);
    if (!from || !to) {
      return { ok: false, kind: 'invalid', message: 'NO ANCHOR', fromId, toId };
    }
    if (fromId === toId) {
      return { ok: false, kind: 'invalid', message: 'NO SELF LINK', fromId, toId };
    }
    if (this.links.some((link) => link.fromId === fromId && link.toId === toId)) {
      return { ok: false, kind: 'invalid', message: 'LINK EXISTS', fromId, toId };
    }
    if (!temporary && this.links.filter((link) => !link.temporary).length >= this.level.linkBudget) {
      return { ok: false, kind: 'invalid', message: 'LINK LIMIT', fromId, toId };
    }
    const maxOutgoing = from.type === 'splitter' ? 3 : from.type === 'source' ? 2 : 1;
    if (this.outgoingLinks(fromId).filter((link) => !link.temporary || temporary).length >= maxOutgoing) {
      return { ok: false, kind: 'invalid', message: 'NODE OUTPUT FULL', fromId, toId };
    }
    return { ok: true, kind: 'link', message: 'VALID', fromId, toId };
  }

  private updatePulses(dtMs: number): void {
    for (const pulse of this.pulses) {
      if (!pulse.alive) {
        continue;
      }
      pulse.ageMs += dtMs;
      if (pulse.delayMs > 0) {
        pulse.delayMs = Math.max(0, pulse.delayMs - dtMs);
        continue;
      }
      if (pulse.nextNodeId === undefined) {
        this.continuePulse(pulse);
        continue;
      }
      const from = this.nodeById(pulse.currentNodeId);
      const to = this.nodeById(pulse.nextNodeId);
      if (!from || !to) {
        this.killPulse(pulse);
        continue;
      }
      const length = Math.max(1, Math.hypot(to.x - from.x, to.y - from.y));
      pulse.progress += (pulse.speed * (dtMs / 1000)) / length;
      if (pulse.progress >= 1) {
        this.arriveAtNode(pulse, to.id);
      }
    }
    this.pulses = this.pulses.filter((pulse) => pulse.alive);
  }

  private arriveAtNode(pulse: PulseState, nodeId: number): void {
    const node = this.nodeById(nodeId);
    if (!node) {
      this.killPulse(pulse);
      return;
    }
    pulse.previousNodeId = pulse.currentNodeId;
    pulse.currentNodeId = nodeId;
    pulse.nextNodeId = undefined;
    pulse.progress = 0;
    pulse.comboChainLength += 1;
    pulse.visitedNodeIds.push(nodeId);
    this.chainLength = Math.max(this.chainLength, pulse.comboChainLength);
    this.multiplier = multiplierForChain(pulse.comboChainLength);
    this.maxMultiplier = Math.max(this.maxMultiplier, this.multiplier);
    node.activationMs = 520;
    this.addScore(LINK_TRAVERSAL_SCORE, 0.18);

    const firstRepeatedIndex = pulse.visitedNodeIds.indexOf(nodeId);
    if (firstRepeatedIndex >= 0 && firstRepeatedIndex < pulse.visitedNodeIds.length - 1) {
      const loopLength = pulse.visitedNodeIds.length - 1 - firstRepeatedIndex;
      if (loopLength >= 4) {
        this.loopsCompleted += 1;
        this.addScore(140 * this.loopsCompleted, 1.2);
        this.multiplier = Math.max(this.multiplier, Math.min(12, this.multiplier + this.loopsCompleted));
        this.maxMultiplier = Math.max(this.maxMultiplier, this.multiplier);
        this.lensCharges = Math.min(LENS_MAX_CHARGES, this.lensCharges + 1);
      }
    }

    if (node.type === 'energy') {
      const fresh = node.scoreCooldownMs <= 0;
      const primedBonus = node.primed ? 80 : 0;
      this.addScore((fresh ? ENERGY_NODE_SCORE : 25) + primedBonus, fresh ? 6.2 + primedBonus / 40 : 1.4);
      node.primed = false;
      node.scoreCooldownMs = fresh ? 2600 : node.scoreCooldownMs;
      this.energyNodesHit.add(node.id);
      this.lensCharges = Math.min(LENS_MAX_CHARGES, this.lensCharges + 1);
    } else if (node.type === 'delay') {
      this.addScore(DELAY_NODE_SCORE, 1.1);
      pulse.delayMs = DELAY_MS[node.delayLevel];
      return;
    } else if (node.type === 'splitter') {
      this.addScore(SPLITTER_NODE_SCORE, 1.8);
    }

    this.continuePulse(pulse);
  }

  private continuePulse(pulse: PulseState): void {
    const outgoing = this.outgoingLinks(pulse.currentNodeId);
    if (outgoing.length === 0) {
      this.killPulse(pulse);
      return;
    }

    const currentNode = this.nodeById(pulse.currentNodeId);
    const orderedOutgoing = currentNode?.type === 'splitter'
      ? [...outgoing].sort((a, b) => splitterOrder(a, b, currentNode.splitterPriority))
      : outgoing;

    if (currentNode?.type === 'splitter' && orderedOutgoing.length > 1) {
      for (const link of orderedOutgoing) {
        this.spawnPulse(pulse.currentNodeId, link.toId, pulse.previousNodeId, pulse.comboChainLength, pulse.visitedNodeIds);
      }
      pulse.alive = false;
      return;
    }

    const preferred = orderedOutgoing.find((link) => link.toId !== pulse.previousNodeId) ?? orderedOutgoing[0];
    pulse.nextNodeId = preferred.toId;
    pulse.progress = 0;
  }

  private emitFromNode(nodeId: number, previousNodeId: number | undefined, combo: number, visited: number[]): void {
    const outgoing = this.outgoingLinks(nodeId);
    if (outgoing.length === 0) {
      return;
    }
    for (const link of outgoing) {
      this.spawnPulse(nodeId, link.toId, previousNodeId, combo, visited.length > 0 ? visited : [nodeId]);
    }
  }

  private spawnPulse(
    currentNodeId: number,
    nextNodeId: number,
    previousNodeId: number | undefined,
    comboChainLength: number,
    visitedNodeIds: number[]
  ): void {
    this.pulses.push({
      id: this.nextPulseId,
      currentNodeId,
      previousNodeId,
      nextNodeId,
      progress: 0,
      speed: this.tutorialActive ? TUTORIAL_PULSE_SPEED : NORMAL_PULSE_SPEED,
      ageMs: 0,
      energy: 1,
      comboChainLength,
      delayMs: 0,
      alive: true,
      visitedNodeIds: [...visitedNodeIds]
    });
    this.nextPulseId += 1;
  }

  private killPulse(pulse: PulseState): void {
    pulse.alive = false;
    this.deadEndNodeId = pulse.currentNodeId;
    this.darkEnergy = clamp(this.darkEnergy - 5.6, 0, MAX_ENERGY);
    this.multiplier = 1;
    this.lastInputResult = { ok: false, kind: 'invalid', message: 'DEAD END' };
  }

  private addScore(base: number, energyGain: number): void {
    this.score += Math.round(base * this.multiplier);
    this.darkEnergy = clamp(this.darkEnergy + energyGain, 0, MAX_ENERGY);
  }

  private outgoingLinks(nodeId: number): PulseLink[] {
    return this.links.filter((link) => link.fromId === nodeId);
  }

  private nodeById(nodeId: number): PulseNode | undefined {
    return this.level.nodes.find((node) => node.id === nodeId);
  }

  private updateTimedVisuals(dtMs: number): void {
    for (const node of this.level.nodes) {
      node.activationMs = Math.max(0, node.activationMs - dtMs);
      node.scoreCooldownMs = Math.max(0, node.scoreCooldownMs - dtMs);
      node.stabilizedMs = Math.max(0, node.stabilizedMs - dtMs);
    }
    for (const link of this.links) {
      link.flashMs = Math.max(0, link.flashMs - dtMs);
    }
    for (let index = this.lenses.length - 1; index >= 0; index -= 1) {
      const lens = this.lenses[index];
      lens.ageMs += dtMs;
      if (lens.ageMs >= lens.durationMs) {
        this.lenses.splice(index, 1);
      }
    }
  }

  private expireTemporaryLinks(dtMs: number): void {
    for (let index = this.links.length - 1; index >= 0; index -= 1) {
      const link = this.links[index];
      if (!link.temporary) {
        continue;
      }
      link.ageMs += dtMs;
      if (link.ageMs >= link.expiresMs) {
        this.links.splice(index, 1);
      }
    }
  }

  private createLens(path: WorldPoint[], success: boolean, fromId?: number, toId?: number): void {
    this.lenses.push({
      id: this.nextLensId,
      path,
      fromId,
      toId,
      ageMs: 0,
      durationMs: LENS_DURATION_MS,
      success,
      message: success ? 'BRIDGE CREATED' : 'NO ANCHOR'
    });
    this.nextLensId += 1;
  }

  private endRun(reason: Exclude<PulseSnapshot['endReason'], undefined>): void {
    if (this.phase === 'ended') {
      return;
    }
    this.phase = 'ended';
    this.endReason = reason;
    this.collapsed = reason === 'collapsed';
    this.stabilized = reason === 'stabilized';
    if (this.stabilized) {
      this.addScore(350 + (this.level.linkBudget - this.links.filter((link) => !link.temporary).length) * 80, 0);
    }
    this.pulses = [];
    this.updateHash();
  }

  private getResult(): PulseResult {
    return {
      score: this.score,
      survivalMs: Math.round(this.timeMs),
      maxMultiplier: this.maxMultiplier,
      loopsCompleted: this.loopsCompleted,
      linksUsed: this.links.filter((link) => !link.temporary).length,
      bestChainLength: this.chainLength,
      energyNodesHit: this.energyNodesHit.size,
      stabilized: this.stabilized,
      collapsed: this.collapsed
    };
  }

  private tutorialHint(): string {
    if (this.tutorialActive) {
      if (this.tutorialStep === 'swipe-chain') {
        return 'SWIPE THROUGH THESE NODES';
      }
      if (this.tutorialStep === 'tap-splitter') {
        return 'TAP THE SPLITTER TO AIM IT';
      }
      if (this.tutorialStep === 'press-play') {
        return 'PRESS PLAY';
      }
      if (this.tutorialStep === 'stabilize') {
        return 'TAP THE NEXT NODE TO STABILIZE';
      }
      if (this.tutorialStep === 'lens') {
        return 'SWIPE BETWEEN NODES TO CREATE A HORIZON LENS';
      }
      if (this.tutorialStep === 'loops') {
        return 'BUILD LOOPS TO DELAY COLLAPSE';
      }
    }
    if (this.phase === 'build') {
      if (this.links.filter((link) => !link.temporary).length === 0) {
        return 'SWIPE THROUGH NODES TO DRAW A CHAIN';
      }
      return 'PRESS PLAY';
    }
    if (this.phase === 'pulse' && this.liveInputs.length === 0) {
      return 'SWIPE TO CREATE A HORIZON LENS';
    }
    return this.phase === 'ended' ? (this.stabilized ? 'SECTOR STABILIZED' : 'GALAXY COLLAPSED') : 'WATCH THE PULSE';
  }

  private advanceTutorial(event: 'chain' | 'chain-miss' | 'splitter' | 'play' | 'stabilize' | 'lens'): void {
    if (!this.tutorialActive) {
      return;
    }
    if (this.tutorialStep === 'swipe-chain' && event === 'chain' && this.links.some((link) => link.fromId === 1 && link.toId === 2) && this.links.some((link) => link.fromId === 2 && link.toId === 3)) {
      this.tutorialStep = 'tap-splitter';
      this.lastInputResult = { ...this.lastInputResult, message: 'CHAIN CREATED. TAP THE SPLITTER' };
    } else if (this.tutorialStep === 'tap-splitter' && event === 'splitter') {
      this.tutorialStep = 'press-play';
    } else if (this.tutorialStep === 'press-play' && event === 'play') {
      this.tutorialStep = 'stabilize';
    } else if (this.tutorialStep === 'stabilize' && event === 'stabilize') {
      this.tutorialStep = 'lens';
    } else if (this.tutorialStep === 'lens' && event === 'lens') {
      this.tutorialStep = 'loops';
    }
  }

  private tutorialHighlightNodeIds(): number[] {
    if (!this.tutorialActive) {
      return [];
    }
    if (this.tutorialStep === 'swipe-chain') {
      return [1, 2, 3];
    }
    if (this.tutorialStep === 'tap-splitter') {
      return [4];
    }
    if (this.tutorialStep === 'stabilize') {
      return [3, 4];
    }
    if (this.tutorialStep === 'lens') {
      return [3, 4];
    }
    return [];
  }

  private tutorialGhostPath(): WorldPoint[] {
    const ids = this.tutorialHighlightNodeIds();
    if (ids.length < 2) {
      return [];
    }
    return ids
      .map((id) => this.nodeById(id))
      .filter((node): node is PulseNode => node !== undefined)
      .map((node) => ({ x: node.x, y: node.y }));
  }

  private computeChainAnalysis(): ChainAnalysis {
    const totalEnergyNodes = this.level.nodes.filter((node) => node.type === 'energy').length;
    const reachable = this.reachableFromSource();
    const reachableEnergyNodes = this.level.nodes.filter((node) => node.type === 'energy' && reachable.has(node.id)).length;
    const deadEndNodeIds = [...reachable].filter((nodeId) => nodeId !== this.level.sourceId && this.outgoingLinks(nodeId).filter((link) => !link.temporary).length === 0);
    const hasLoop = this.hasReachableLoop();
    const linksUsed = this.links.filter((link) => !link.temporary).length;
    let quality: ChainAnalysis['quality'] = 'Draw a chain';
    if (linksUsed > 0) {
      quality = 'Good start';
    }
    if (deadEndNodeIds.length > 0) {
      quality = 'Dead end detected';
    } else if (hasLoop && reachableEnergyNodes >= 2) {
      quality = 'Great loop';
    } else if (hasLoop) {
      quality = 'Loop possible';
    } else if (reachableEnergyNodes < Math.min(2, totalEnergyNodes)) {
      quality = 'Hit more Energy nodes';
    }
    return { reachableEnergyNodes, totalEnergyNodes, deadEndNodeIds, hasLoop, linksUsed, quality };
  }

  private computeSuggestedFixes(): SuggestedFix[] {
    const analysis = this.computeChainAnalysis();
    const fromId = this.deadEndNodeId ?? analysis.deadEndNodeIds[0];
    const from = fromId ? this.nodeById(fromId) : undefined;
    if (!from) {
      return [];
    }
    return this.level.nodes
      .filter((node) => node.id !== from.id && !this.links.some((link) => link.fromId === from.id && link.toId === node.id))
      .sort((a, b) => Math.hypot(a.x - from.x, a.y - from.y) - Math.hypot(b.x - from.x, b.y - from.y))
      .slice(0, 2)
      .map((node) => ({ fromId: from.id, toId: node.id, message: `Try linking ${from.label} to ${node.label}` }));
  }

  private reachableFromSource(): Set<number> {
    const seen = new Set<number>();
    const queue = [this.level.sourceId];
    while (queue.length > 0) {
      const nodeId = queue.shift();
      if (nodeId === undefined || seen.has(nodeId)) {
        continue;
      }
      seen.add(nodeId);
      for (const link of this.outgoingLinks(nodeId).filter((candidate) => !candidate.temporary)) {
        queue.push(link.toId);
      }
    }
    return seen;
  }

  private hasReachableLoop(): boolean {
    const reachable = this.reachableFromSource();
    const visiting = new Set<number>();
    const visited = new Set<number>();
    const visit = (nodeId: number): boolean => {
      if (!reachable.has(nodeId)) {
        return false;
      }
      if (visiting.has(nodeId)) {
        return true;
      }
      if (visited.has(nodeId)) {
        return false;
      }
      visiting.add(nodeId);
      for (const link of this.outgoingLinks(nodeId).filter((candidate) => !candidate.temporary)) {
        if (visit(link.toId)) {
          return true;
        }
      }
      visiting.delete(nodeId);
      visited.add(nodeId);
      return false;
    };
    return visit(this.level.sourceId);
  }

  private arrivalReadiness(nodeId: number): 'perfect' | 'soon' | 'early' | 'late' {
    for (const pulse of this.pulses) {
      if (pulse.nextNodeId === nodeId) {
        if (pulse.progress >= 0.78) {
          return 'perfect';
        }
        if (pulse.progress >= 0.42) {
          return 'soon';
        }
        return 'early';
      }
      if (pulse.currentNodeId === nodeId) {
        return 'late';
      }
    }
    return 'early';
  }

  private updateHash(): void {
    const data = [
      this.phase,
      Math.round(this.timeMs),
      this.score,
      Math.round(this.darkEnergy * 10),
      this.multiplier,
      this.tutorialStep,
      this.level.nodes.map((node) => `${node.id}:${node.primed ? 1 : 0}:${node.delayLevel}:${node.splitterPriority}`).join('|'),
      this.links.map((link) => `${link.fromId}>${link.toId}:${link.temporary ? Math.round(link.expiresMs - link.ageMs) : 0}`).join('|'),
      this.pulses.map((pulse) => `${pulse.currentNodeId}>${pulse.nextNodeId ?? 0}:${Math.round(pulse.progress * 1000)}:${Math.round(pulse.delayMs)}`).join('|')
    ].join(';');
    let hash = 2166136261;
    for (let index = 0; index < data.length; index += 1) {
      hash ^= data.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    this.stepHash = (hash >>> 0).toString(16).padStart(8, '0');
  }
}

function multiplierForChain(chainLength: number): number {
  if (chainLength >= 15) {
    return 8;
  }
  if (chainLength >= 10) {
    return 5;
  }
  if (chainLength >= 7) {
    return 3;
  }
  if (chainLength >= 4) {
    return 2;
  }
  return 1;
}

function splitterOrder(a: PulseLink, b: PulseLink, priority: number): number {
  const aValue = (a.toId + priority * 7) % 13;
  const bValue = (b.toId + priority * 7) % 13;
  return aValue - bValue;
}
