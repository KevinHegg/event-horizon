import { describe, expect, it } from 'vitest';
import { Simulation, type TimedInput } from '../src/game/Simulation';
import { hashStringToUint, mulberry32 } from '../src/game/rng';

const options = {
  seed: 'eh-2026-05-29-alpha',
  startedAt: 1780051200000
};

describe('deterministic simulation', () => {
  it('mulberry32 returns the same sequence for the same seed', () => {
    const a = mulberry32(hashStringToUint(options.seed));
    const b = mulberry32(hashStringToUint(options.seed));
    expect([a(), a(), a(), a()]).toEqual([b(), b(), b(), b()]);
  });

  it('same seed and same input timings produce identical replay outcomes', () => {
    const inputs: TimedInput[] = [
      { kind: 'tap', t: 800, x: 520, y: 620 },
      { kind: 'swipe', t: 1600, x: 240, y: 1220, x2: 820, y2: 860 },
      { kind: 'tap', t: 3300, x: 540, y: 845 },
      { kind: 'swipe', t: 5100, x: 900, y: 1160, x2: 410, y2: 660 }
    ];
    const first = new Simulation(options).runInputs(inputs, 12000);
    const second = new Simulation(options).runInputs(inputs, 12000);
    expect(second).toEqual(first);
  });

  it('records tap and swipe events with simulation timestamps', () => {
    const sim = new Simulation(options);
    sim.step(1000);
    sim.applyTap(100, 200);
    sim.step(1000 / 60);
    sim.applySwipe(120, 300, 600, 500);
    const replay = sim.getReplayPayload();
    expect(replay.tapEvents).toHaveLength(1);
    expect(replay.swipeEvents).toHaveLength(1);
    expect(replay.tapEvents[0].t).toBe(1000);
    expect(replay.swipeEvents[0].x2).toBe(600);
  });
});
