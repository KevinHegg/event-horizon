import { expect, test, type Page } from '@playwright/test';

const WORLD_WIDTH = 1080;
const WORLD_HEIGHT = 1920;

test('help opens on first visit', async ({ page }) => {
  await openGame(page);
  await expect(page.locator('#help-overlay')).toBeVisible();
  await expect(page.locator('#help-title')).toHaveText('EVENT HORIZON');
  await expect(page.locator('#help-overlay')).toContainText('Build a dark-energy chain');
});

test('connect two nodes by tap-tap', async ({ page }) => {
  await openGameAndPlay(page);
  const nodes = await getNodes(page);
  const source = nodes.find((node) => node.type === 'source');
  const target = nodes.find((node) => node.type === 'energy');
  expect(source).toBeTruthy();
  expect(target).toBeTruthy();
  await tapWorld(page, source!.x, source!.y);
  await tapWorld(page, target!.x, target!.y);
  const links = await page.evaluate(() => window.__EVENT_HORIZON_DEBUG__?.getLinks()) as Array<{ fromId: number; toId: number }>;
  expect(links.some((link) => link.fromId === source!.id && link.toId === target!.id)).toBe(true);
});

test('connect two nodes by drag', async ({ page }) => {
  await openGameAndPlay(page);
  const nodes = await getNodes(page);
  const from = nodes.find((node) => node.type === 'energy');
  const to = nodes.find((node) => node.type === 'delay');
  expect(from).toBeTruthy();
  expect(to).toBeTruthy();
  const a = await worldToScreen(page, from!.x, from!.y);
  const b = await worldToScreen(page, to!.x, to!.y);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
  const result = await page.evaluate(() => window.__EVENT_HORIZON_DEBUG__?.getLastInputResult()) as { ok: boolean; message: string };
  expect(result.ok).toBe(true);
});

test('press play, pulse moves, and energy node scores', async ({ page }) => {
  await openGameAndPlay(page);
  await buildTutorialChain(page);
  await page.locator('#pulse-play-button').click();
  await page.waitForFunction(() => {
    const snapshot = window.__EVENT_HORIZON__?.getSnapshot() as { phase?: string; pulses?: unknown[] };
    return snapshot?.phase === 'pulse' && Number(snapshot.pulses?.length) > 0;
  });
  const before = await page.evaluate(() => window.__EVENT_HORIZON__?.getSnapshot()) as { score: number };
  await page.waitForFunction((score) => {
    const snapshot = window.__EVENT_HORIZON__?.getSnapshot() as { score?: number };
    return Number(snapshot?.score) > Number(score);
  }, before.score);
  const after = await page.evaluate(() => window.__EVENT_HORIZON__?.getSnapshot()) as { score: number; multiplier: number; phase: string };
  expect(after.phase).toBe('pulse');
  expect(after.score).toBeGreaterThan(before.score);
  expect(after.multiplier).toBeGreaterThanOrEqual(1);
});

test('swipe during pulse phase creates Horizon Lens and records replay inputs', async ({ page }) => {
  await openGameAndPlay(page);
  await buildTutorialChain(page);
  await page.locator('#pulse-play-button').click();
  await page.waitForFunction(() => (window.__EVENT_HORIZON__?.getSnapshot() as { phase?: string })?.phase === 'pulse');
  const nodes = await getNodes(page);
  const a = nodes.find((node) => node.id === 6) ?? nodes[4];
  const b = nodes.find((node) => node.id === 8) ?? nodes[5];
  const start = await worldToScreen(page, a.x, a.y);
  const end = await worldToScreen(page, b.x, b.y);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move((start.x + end.x) / 2, (start.y + end.y) / 2 - 30, { steps: 5 });
  await page.mouse.move(end.x, end.y, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(120);
  const result = await page.evaluate(() => window.__EVENT_HORIZON_DEBUG__?.getLastInputResult()) as { kind: string; message: string };
  const replay = await page.evaluate(() => window.__EVENT_HORIZON__?.getReplayPayload()) as {
    buildInputs: unknown[];
    liveInputs: Array<{ kind: string; success: boolean }>;
  };
  expect(result.kind).toBe('lens');
  expect(['BRIDGE CREATED', 'NO ANCHOR']).toContain(result.message);
  expect(replay.buildInputs.some((input) => (input as { kind: string }).kind === 'play')).toBe(true);
  expect(replay.liveInputs.some((input) => input.kind === 'lens')).toBe(true);
});

test('collapse or stabilized end state is reachable', async ({ page }) => {
  await openGameAndPlay(page);
  await page.evaluate(() => window.__EVENT_HORIZON_DEBUG__?.forceCollapse());
  await page.waitForTimeout(150);
  const snapshot = await page.evaluate(() => window.__EVENT_HORIZON__?.getSnapshot()) as {
    phase: string;
    collapsed: boolean;
    stabilized: boolean;
  };
  expect(snapshot.phase).toBe('ended');
  expect(snapshot.collapsed || snapshot.stabilized).toBe(true);
});

async function openGame(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.clear();
  });
  await page.goto('./?seed=tutorial&debugInput=1');
  await page.locator('canvas').waitFor({ state: 'visible' });
}

async function openGameAndPlay(page: Page): Promise<void> {
  await openGame(page);
  await page.locator('#help-play-button').click();
  await expect(page.locator('#help-overlay')).toBeHidden();
}

async function buildTutorialChain(page: Page): Promise<void> {
  const nodes = await getNodes(page);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (const [fromId, toId] of [
    [1, 2],
    [2, 3],
    [3, 4],
    [4, 5],
    [4, 6]
  ]) {
    const from = byId.get(fromId);
    const to = byId.get(toId);
    expect(from).toBeTruthy();
    expect(to).toBeTruthy();
    await tapWorld(page, from!.x, from!.y);
    await tapWorld(page, to!.x, to!.y);
  }
}

async function getNodes(page: Page) {
  return (await page.evaluate(() => window.__EVENT_HORIZON_DEBUG__?.getNodes())) as Array<{
    id: number;
    type: string;
    x: number;
    y: number;
  }>;
}

async function tapWorld(page: Page, x: number, y: number): Promise<void> {
  const point = await worldToScreen(page, x, y);
  await page.mouse.click(point.x, point.y);
}

async function worldToScreen(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const box = await page.locator('canvas').boundingBox();
  if (!box) {
    throw new Error('Canvas box unavailable.');
  }
  const scale = Math.min(box.width / WORLD_WIDTH, box.height / WORLD_HEIGHT);
  const offsetX = (box.width - WORLD_WIDTH * scale) / 2;
  const offsetY = (box.height - WORLD_HEIGHT * scale) / 2;
  return {
    x: box.x + offsetX + x * scale,
    y: box.y + offsetY + y * scale
  };
}
