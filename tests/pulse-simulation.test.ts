import { describe, expect, it } from 'vitest';
import { generatePulseLevel } from '../src/game/pulse/PulseLevelGenerator';
import { PulseSimulation } from '../src/game/pulse/PulseSimulation';

const options = {
  seed: 'tutorial-001',
  startedAt: 1780185600000
};

describe('pulse-chain mode', () => {
  it('tutorial level is deterministic and hand-tuned', () => {
    const first = generatePulseLevel('tutorial-001');
    const second = generatePulseLevel('tutorial-001');
    expect(second).toEqual(first);
    expect(first.nodes.slice(0, 4).map((node) => node.type)).toEqual(['source', 'energy', 'delay', 'splitter']);
  });

  it('seeded level generation is deterministic for normal seeds', () => {
    expect(generatePulseLevel('abc')).toEqual(generatePulseLevel('abc'));
    expect(generatePulseLevel('abc').nodes).not.toEqual(generatePulseLevel('xyz').nodes);
  });

  it('swipe crossing 3 nodes creates 2 links and records chainSwipe', () => {
    const sim = new PulseSimulation(options);
    const result = sim.applyChainSwipe(pathFor(sim, [1, 2, 3]));
    expect(result.ok).toBe(true);
    expect(sim.getLinks().map((link) => [link.fromId, link.toId])).toEqual([
      [1, 2],
      [2, 3]
    ]);
    expect(sim.getReplayPayload().buildInputs.some((input) => input.kind === 'chainSwipe')).toBe(true);
  });

  it('chain swipe ignores duplicate adjacent nodes and avoids self-links', () => {
    const sim = new PulseSimulation(options);
    sim.applyChainSwipe(pathFor(sim, [1, 2, 2, 3]));
    expect(sim.getLinks().map((link) => [link.fromId, link.toId])).toEqual([
      [1, 2],
      [2, 3]
    ]);
  });

  it('chain swipe respects link budget', () => {
    const sim = new PulseSimulation(options);
    sim.applyChainSwipe(pathFor(sim, [1, 2, 3, 4, 5, 6, 8, 11]));
    expect(sim.getSnapshot().linksUsed).toBeLessThanOrEqual(sim.getSnapshot().linkBudget);
  });

  it('chain analysis detects reachable energy nodes, dead ends, and loops', () => {
    const sim = new PulseSimulation(options);
    sim.applyChainSwipe(pathFor(sim, [1, 2, 3]));
    expect(sim.analyzeChain()).toMatchObject({ reachableEnergyNodes: 1, deadEndNodeIds: [3], hasLoop: false });
    sim.addLink(3, 4);
    sim.addLink(4, 7);
    sim.addLink(7, 9);
    sim.addLink(9, 2);
    const analysis = sim.analyzeChain();
    expect(analysis.hasLoop).toBe(true);
    expect(analysis.deadEndNodeIds).toHaveLength(0);
  });

  it('tapping Energy primes it, Delay cycles delay, and Splitter cycles priority', () => {
    const sim = new PulseSimulation(options);
    expect(sim.primeNode(2).ok).toBe(true);
    expect(sim.getNodes().find((node) => node.id === 2)?.primed).toBe(true);
    const delayBefore = sim.getNodes().find((node) => node.id === 3)?.delayLevel;
    sim.cycleNode(3);
    expect(sim.getNodes().find((node) => node.id === 3)?.delayLevel).not.toBe(delayBefore);
    const splitterBefore = sim.getNodes().find((node) => node.id === 4)?.splitterPriority;
    sim.cycleNode(4);
    expect(sim.getNodes().find((node) => node.id === 4)?.splitterPriority).not.toBe(splitterBefore);
  });

  it('pulse travels, delay pauses, splitter branches, and energy scores', () => {
    const sim = new PulseSimulation(options);
    sim.applyChainSwipe(pathFor(sim, [1, 2, 3, 4]));
    sim.addLink(4, 5);
    sim.addLink(4, 6);
    sim.playPulse();
    step(sim, 6500);
    const snapshot = sim.getSnapshot();
    expect(snapshot.score).toBeGreaterThan(100);
    expect(snapshot.maxMultiplier).toBeGreaterThanOrEqual(1);
  });

  it('pulse-phase tap stabilizes a node shortly before arrival', () => {
    const sim = new PulseSimulation(options);
    sim.applyChainSwipe(pathFor(sim, [1, 2, 3]));
    sim.playPulse();
    step(sim, 2200);
    const result = sim.stabilizeNode(3);
    expect(result.ok).toBe(true);
    expect(sim.getReplayPayload().liveInputs.some((input) => input.kind === 'stabilize' && input.nodeId === 3)).toBe(true);
  });

  it('Horizon Lens creates a temporary bridge', () => {
    const sim = new PulseSimulation(options);
    sim.applyChainSwipe(pathFor(sim, [1, 2, 3]));
    sim.playPulse();
    step(sim, 2600);
    const result = sim.applyLens(pathFor(sim, [3, 4]));
    expect(result.ok).toBe(true);
    expect(sim.getLinks().some((link) => link.temporary && link.fromId === 3 && link.toId === 4)).toBe(true);
    expect(sim.getReplayPayload().liveInputs.some((input) => input.kind === 'lens')).toBe(true);
  });

  it('dead end kills pulse and suggests fixes', () => {
    const sim = new PulseSimulation(options);
    sim.addLink(1, 2);
    sim.playPulse();
    step(sim, 6000);
    expect(sim.getSnapshot().phase).toBe('ended');
    expect(sim.getSnapshot().endReason).toBe('pulse-died');
    expect(sim.getSuggestedFixes().length).toBeGreaterThan(0);
  });

  it('replay with chainSwipe, taps, and lens reproduces result and stepHash', () => {
    const first = runScripted();
    const second = runScripted();
    expect(second.getReplayPayload().result).toEqual(first.getReplayPayload().result);
    expect(second.getReplayPayload().stepHash).toBe(first.getReplayPayload().stepHash);
  });
});

function step(sim: PulseSimulation, ms: number): void {
  const frames = Math.ceil(ms / (1000 / 60));
  for (let index = 0; index < frames; index += 1) {
    sim.step(1000 / 60);
  }
}

function pathFor(sim: PulseSimulation, nodeIds: number[]) {
  return nodeIds.flatMap((nodeId, index) => {
    const node = sim.getNodes().find((candidate) => candidate.id === nodeId);
    if (!node) {
      throw new Error(`Missing node ${nodeId}`);
    }
    return [
      { x: node.x - 8, y: node.y - 8, t: index * 90 },
      { x: node.x, y: node.y, t: index * 90 + 35 },
      { x: node.x + 8, y: node.y + 8, t: index * 90 + 70 }
    ];
  });
}

function runScripted(): PulseSimulation {
  const sim = new PulseSimulation(options);
  sim.applyChainSwipe(pathFor(sim, [1, 2, 3]));
  sim.cycleNode(4);
  sim.playPulse();
  step(sim, 2200);
  sim.stabilizeNode(3);
  step(sim, 300);
  sim.applyLens(pathFor(sim, [3, 4]));
  step(sim, 6500);
  return sim;
}
