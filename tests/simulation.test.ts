import { describe, expect, it } from 'vitest';
import { BLACK_HOLE_X, BLACK_HOLE_Y } from '../src/game/constants';
import { quantizeGesturePath } from '../src/game/gestures';
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
    const path = makeTetherCrossingPath(new Simulation(options));
    const inputs: TimedInput[] = [
      { kind: 'tap', t: 800, x: 520, y: 620 },
      { kind: 'swipe', t: 1600, x: path[0].x, y: path[0].y, x2: path[1].x, y2: path[1].y, path },
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
    expect(replay.swipeEvents[0].path).toHaveLength(2);
  });

  it('a path crossing the readable tether captures the orb', () => {
    const sim = new Simulation(options);
    const path = makeTetherCrossingPath(sim);
    const before = sim.getSnapshot();
    const result = sim.applySwipePath(path);
    const after = sim.getSnapshot();
    expect(result.success).toBe(true);
    expect(result.target).toBe('tether');
    expect(result.orbId).toBeDefined();
    expect(result.path.length).toBeGreaterThanOrEqual(2);
    expect(after.score).toBeGreaterThan(before.score);
    expect(after.energyCaptured).toBeGreaterThan(before.energyCaptured);
  });

  it('a path missing all tethers does not capture', () => {
    const sim = new Simulation(options);
    stepUntilFirstOrb(sim);
    const before = sim.getSnapshot();
    const result = sim.applySwipePath([
      { x: 80, y: 1760, t: 0 },
      { x: 180, y: 1840, t: 80 }
    ]);
    const after = sim.getSnapshot();
    expect(result.success).toBe(false);
    expect(result.target).toBe('empty');
    expect(result.message).toBe('MISS');
    expect(after.score).toBe(before.score);
    expect(after.energyCaptured).toBe(before.energyCaptured);
  });

  it('simplifies and quantizes long swipe paths for replay', () => {
    const points = Array.from({ length: 80 }, (_, index) => ({
      x: 120 + index * 9.25,
      y: 700 + Math.sin(index * 0.24) * 90,
      t: index * 7.5
    }));
    const path = quantizeGesturePath(points, 24);
    expect(path.length).toBeLessThanOrEqual(24);
    expect(path[0]).toEqual({ x: 120, y: 700, t: 0 });
    expect(path[path.length - 1].x).toBe(Math.round(points[points.length - 1].x));
  });

  it('backwards simple swipe calls still capture when crossing a tether', () => {
    const sim = new Simulation(options);
    const path = makeTetherCrossingPath(sim);
    const result = sim.applySwipe(path[0].x, path[0].y, path[1].x, path[1].y);
    expect(result.success).toBe(true);
    expect(result.target).toBe('tether');
  });
});

function stepUntilFirstOrb(sim: Simulation) {
  for (let index = 0; index < 80; index += 1) {
    sim.step(1000 / 60);
    const orb = sim.getSnapshot().orbs.find((candidate) => candidate.active && !candidate.captured);
    if (orb) {
      return orb;
    }
  }
  throw new Error('No tutorial orb spawned.');
}

function makeTetherCrossingPath(sim: Simulation) {
  const orb = stepUntilFirstOrb(sim);
  const targetX = BLACK_HOLE_X + (orb.x - BLACK_HOLE_X) * 0.78;
  const targetY = BLACK_HOLE_Y + (orb.y - BLACK_HOLE_Y) * 0.78;
  const dx = orb.x - BLACK_HOLE_X;
  const dy = orb.y - BLACK_HOLE_Y;
  const length = Math.max(1, Math.hypot(dx, dy));
  const normalX = -dy / length;
  const normalY = dx / length;
  return [
    { x: targetX - normalX * 150, y: targetY - normalY * 150, t: 0 },
    { x: targetX + normalX * 150, y: targetY + normalY * 150, t: 96 }
  ];
}
