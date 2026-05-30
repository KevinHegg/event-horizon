import { INITIAL_ENERGY, MAX_ENERGY } from '../constants';
import { clamp } from '../math';
import { quantizeGesturePath, type GesturePathPoint, type WorldPoint } from '../gestures';
import { nearestTwoNodesToPath } from './PulseGeometry';
import { generatePulseLevel } from './PulseLevelGenerator';
import type {
  BuildInput,
  HorizonLens,
  LiveInput,
  PulseGamePhase,
  PulseInputResult,
  PulseLevel,
  PulseLink,
  PulseNode,
  PulseReplayPayload,
  PulseResult,
  PulseSnapshot,
  PulseState
} from './PulseTypes';

const PULSE_SPEED = 460;
const LINK_TRAVERSAL_SCORE = 10;
const ENERGY_NODE_SCORE = 100;
const DELAY_NODE_SCORE = 25;
const SPLITTER_NODE_SCORE = 75;
const LENS_DURATION_MS = 1200;
const LENS_MAX_CHARGES = 2;
const ENERGY_DRAIN_PER_SECOND = 0.52;

export interface PulseSimulationOptions {
  seed: string;
  startedAt: number;
}

export class PulseSimulation {
  readonly seed: string;
  readonly startedAt: number;
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

  constructor(options: PulseSimulationOptions) {
    this.seed = options.seed;
    this.startedAt = options.startedAt;
    this.level = generatePulseLevel(options.seed);
    this.updateHash();
  }

  reset(seed = this.seed): void {
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
    this.collapsed = false;
    this.stabilized = false;
    this.buildInputs = [];
    this.liveInputs = [];
    this.links = [];
    this.pulses = [];
    this.lenses = [];
    this.selectedNodeId = undefined;
    this.lensCharges = LENS_MAX_CHARGES;
    this.lastInputResult = { ok: true, kind: 'none', message: 'CONNECT TWO NODES' };
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
      this.darkEnergy = clamp(this.darkEnergy - (dtMs / 1000) * ENERGY_DRAIN_PER_SECOND, 0, MAX_ENERGY);
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
      expiresMs: 0
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
      this.lastInputResult = { ok: false, kind: 'lens', message: 'NO ANCHOR' };
      return this.lastInputResult;
    }

    const [from, to] = anchors;
    const validation = this.validateLink(from.id, to.id, true);
    if (!validation.ok) {
      this.createLens(lensPath, false);
      this.liveInputs.push({ t: Math.round(this.timeMs), kind: 'lens', path, fromId: from.id, toId: to.id, success: false });
      this.lastInputResult = { ok: false, kind: 'lens', message: 'NO ANCHOR', fromId: from.id, toId: to.id };
      return this.lastInputResult;
    }

    this.links.push({
      id: this.nextLinkId,
      fromId: from.id,
      toId: to.id,
      temporary: true,
      ageMs: 0,
      expiresMs: LENS_DURATION_MS
    });
    this.nextLinkId += 1;
    this.lensCharges = Math.max(0, this.lensCharges - 1);
    this.createLens(lensPath, true, from.id, to.id);
    this.liveInputs.push({ t: Math.round(this.timeMs), kind: 'lens', path, fromId: from.id, toId: to.id, success: true });
    this.lastInputResult = { ok: true, kind: 'lens', message: 'BRIDGE CREATED', fromId: from.id, toId: to.id };
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
      buildInputs: this.buildInputs.map((input) => ({ ...input })),
      liveInputs: this.liveInputs.map((input) => ({
        ...input,
        path: input.path.map((point) => ({ ...point }))
      })),
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
      this.addScore(fresh ? ENERGY_NODE_SCORE : 25, fresh ? 6.2 : 1.4);
      node.scoreCooldownMs = fresh ? 2600 : node.scoreCooldownMs;
      this.lensCharges = Math.min(LENS_MAX_CHARGES, this.lensCharges + 1);
    } else if (node.type === 'delay') {
      this.addScore(DELAY_NODE_SCORE, 1.1);
      pulse.delayMs = 620;
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

    if (this.nodeById(pulse.currentNodeId)?.type === 'splitter' && outgoing.length > 1) {
      for (const link of outgoing) {
        this.spawnPulse(pulse.currentNodeId, link.toId, pulse.previousNodeId, pulse.comboChainLength, pulse.visitedNodeIds);
      }
      pulse.alive = false;
      return;
    }

    const preferred = outgoing.find((link) => link.toId !== pulse.previousNodeId) ?? outgoing[0];
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
      speed: PULSE_SPEED,
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
      stabilized: this.stabilized,
      collapsed: this.collapsed
    };
  }

  private tutorialHint(): string {
    if (this.phase === 'build') {
      if (this.links.filter((link) => !link.temporary).length === 0) {
        return 'CONNECT TWO NODES';
      }
      return 'PRESS PLAY';
    }
    if (this.phase === 'pulse' && this.liveInputs.length === 0) {
      return 'SWIPE TO CREATE A HORIZON LENS';
    }
    return this.phase === 'ended' ? (this.stabilized ? 'SECTOR STABILIZED' : 'GALAXY COLLAPSED') : 'WATCH THE PULSE';
  }

  private updateHash(): void {
    const data = [
      this.phase,
      Math.round(this.timeMs),
      this.score,
      Math.round(this.darkEnergy * 10),
      this.multiplier,
      this.links.map((link) => `${link.fromId}>${link.toId}:${link.temporary ? Math.round(link.expiresMs - link.ageMs) : 0}`).join('|'),
      this.pulses.map((pulse) => `${pulse.currentNodeId}>${pulse.nextNodeId ?? 0}:${Math.round(pulse.progress * 1000)}:${pulse.delayMs}`).join('|')
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
