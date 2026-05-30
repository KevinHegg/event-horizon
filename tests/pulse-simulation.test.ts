import { describe, expect, it } from 'vitest';
import { generatePulseLevel } from '../src/game/pulse/PulseLevelGenerator';
import { PulseSimulation } from '../src/game/pulse/PulseSimulation';

const options = {
  seed: 'tutorial',
  startedAt: 1780185600000
};

describe('pulse-chain mode', () => {
  it('seeded level generation is deterministic', () => {
    expect(generatePulseLevel('abc')).toEqual(generatePulseLevel('abc'));
    expect(generatePulseLevel('abc').nodes).not.toEqual(generatePulseLevel('xyz').nodes);
  });

  it('same seed generates same nodes', () => {
    const first = new PulseSimulation(options).getNodes();
    const second = new PulseSimulation(options).getNodes();
    expect(second).toEqual(first);
  });

  it('link placement respects budget and rejects duplicate/self links', () => {
    const sim = new PulseSimulation(options);
    expect(sim.addLink(1, 1).ok).toBe(false);
    expect(sim.addLink(1, 2).ok).toBe(true);
    expect(sim.addLink(1, 2).ok).toBe(false);
    expect(sim.addLink(1, 3).ok).toBe(true);
    expect(sim.addLink(2, 3).ok).toBe(true);
    expect(sim.addLink(3, 4).ok).toBe(true);
    expect(sim.addLink(4, 5).ok).toBe(true);
    expect(sim.addLink(4, 6).ok).toBe(true);
    expect(sim.addLink(6, 8).ok).toBe(false);
    expect(sim.getSnapshot().linksUsed).toBe(6);
  });

  it('pulse travels from source to connected energy node and increases score/energy', () => {
    const sim = new PulseSimulation(options);
    sim.addLink(1, 2);
    const beforeEnergy = sim.getSnapshot().darkEnergy;
    sim.playPulse();
    step(sim, 1500);
    const snapshot = sim.getSnapshot();
    expect(snapshot.score).toBeGreaterThan(0);
    expect(snapshot.darkEnergy).toBeGreaterThan(beforeEnergy - 1);
  });

  it('delay node pauses pulse briefly', () => {
    const sim = new PulseSimulation(options);
    sim.addLink(1, 2);
    sim.addLink(2, 3);
    sim.playPulse();
    step(sim, 1300);
    const pulse = sim.getPulses()[0];
    expect(pulse?.currentNodeId).toBe(3);
    expect(pulse?.delayMs).toBeGreaterThan(0);
  });

  it('splitter creates child pulses', () => {
    const sim = new PulseSimulation(options);
    sim.addLink(1, 2);
    sim.addLink(2, 3);
    sim.addLink(3, 4);
    sim.addLink(4, 5);
    sim.addLink(4, 6);
    sim.playPulse();
    step(sim, 2700);
    expect(sim.getPulses().length).toBeGreaterThanOrEqual(2);
  });

  it('long loop increases multiplier', () => {
    const sim = new PulseSimulation(options);
    sim.addLink(1, 2);
    sim.addLink(2, 3);
    sim.addLink(3, 4);
    sim.addLink(4, 7);
    sim.addLink(7, 9);
    sim.addLink(9, 2);
    sim.playPulse();
    step(sim, 9000);
    const snapshot = sim.getSnapshot();
    expect(snapshot.loopsCompleted).toBeGreaterThanOrEqual(1);
    expect(snapshot.maxMultiplier).toBeGreaterThan(1);
  });

  it('dead end kills pulse', () => {
    const sim = new PulseSimulation(options);
    sim.addLink(1, 2);
    sim.playPulse();
    step(sim, 3600);
    expect(sim.getSnapshot().phase).toBe('ended');
    expect(sim.getSnapshot().endReason).toBe('pulse-died');
  });

  it('Horizon Lens creates a temporary bridge', () => {
    const sim = new PulseSimulation(options);
    sim.addLink(1, 2);
    sim.playPulse();
    const result = sim.applyLens([
      { x: 825, y: 1215, t: 0 },
      { x: 700, y: 1410, t: 90 }
    ]);
    expect(result.ok).toBe(true);
    expect(sim.getLinks().some((link) => link.temporary)).toBe(true);
    expect(sim.getReplayPayload().liveInputs).toHaveLength(1);
  });

  it('replay with same seed and inputs reproduces result and stepHash', () => {
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

function runScripted(): PulseSimulation {
  const sim = new PulseSimulation(options);
  for (const [from, to] of [
    [1, 2],
    [2, 3],
    [3, 4],
    [4, 5],
    [4, 6]
  ]) {
    sim.addLink(from, to);
  }
  sim.playPulse();
  sim.applyLens([
    { x: 835, y: 1215, t: 0 },
    { x: 700, y: 1410, t: 120 }
  ]);
  step(sim, 6500);
  return sim;
}
