import { expect, test, type Page } from '@playwright/test';

const WORLD_WIDTH = 1080;
const WORLD_HEIGHT = 1920;

test('first visit opens updated help and tutorial', async ({ page }) => {
  await openGame(page);
  await expect(page.locator('#help-overlay')).toBeVisible();
  await expect(page.locator('#help-overlay')).toContainText('Build a chain. Then keep it alive.');
  await expect(page.locator('#help-play-button')).toHaveText('START TUTORIAL');
});

test('tutorial Step 1 highlights nodes and swipe creates a chain', async ({ page }) => {
  await startTutorial(page);
  const snapshot = await getSnapshot(page);
  expect(snapshot.tutorialStep).toBe('swipe-chain');
  expect(snapshot.tutorialHighlightNodeIds).toEqual([1, 2, 3]);
  await swipeThroughNodes(page, [1, 2, 3]);
  await page.waitForTimeout(160);
  const after = await getSnapshot(page);
  expect(after.linksUsed).toBe(2);
  expect(after.tutorialStep).toBe('tap-splitter');
  expect(after.lastChainNodeIds).toEqual([1, 2, 3]);
});

test('tapping splitter changes tutorial state and output priority', async ({ page }) => {
  await tutorialChainReady(page);
  const before = await nodeById(page, 4);
  await tapNode(page, 4);
  const after = await nodeById(page, 4);
  expect(after.splitterPriority).not.toBe(before.splitterPriority);
  expect((await getSnapshot(page)).tutorialStep).toBe('press-play');
});

test('pressing Play launches visible pulse and node tap stabilizes it', async ({ page }) => {
  await tutorialReadyToPlay(page);
  await page.locator('#pulse-play-button').click();
  await page.waitForFunction(() => (window.__EVENT_HORIZON__?.getSnapshot() as { phase?: string } | undefined)?.phase === 'pulse');
  await page.waitForTimeout(2200);
  await tapNode(page, 3);
  await page.waitForTimeout(120);
  const snapshot = await getSnapshot(page);
  expect(snapshot.lastInputResult.kind).toBe('stabilize');
  expect(snapshot.lastInputResult.ok).toBe(true);
  expect(snapshot.tutorialStep).toBe('lens');
});

test('swiping Horizon Lens creates bridge and replay records grammar', async ({ page }) => {
  await tutorialPulseReadyForLens(page);
  await swipeThroughNodes(page, [3, 4]);
  await page.waitForTimeout(160);
  const snapshot = await getSnapshot(page);
  const replay = await page.evaluate(() => window.__EVENT_HORIZON__?.getReplayPayload()) as {
    buildInputs: Array<{ kind: string }>;
    liveInputs: Array<{ kind: string; success?: boolean }>;
  };
  expect(snapshot.lastInputResult.kind).toBe('lens');
  expect(snapshot.lastInputResult.ok).toBe(true);
  expect(snapshot.links.some((link) => link.temporary && link.fromId === 3 && link.toId === 4)).toBe(true);
  expect(replay.buildInputs.some((input) => input.kind === 'chainSwipe')).toBe(true);
  expect(replay.buildInputs.some((input) => input.kind === 'nodeTap')).toBe(true);
  expect(replay.buildInputs.some((input) => input.kind === 'play')).toBe(true);
  expect(replay.liveInputs.some((input) => input.kind === 'stabilize')).toBe(true);
  expect(replay.liveInputs.some((input) => input.kind === 'lens')).toBe(true);
});

test('dead-end failure shows suggested fix and FIX CHAIN returns to build', async ({ page }) => {
  await startTutorial(page);
  await page.evaluate(() => {
    window.__EVENT_HORIZON_DEBUG__?.skipTutorial();
    window.__EVENT_HORIZON_DEBUG__?.clearLinks();
    window.__EVENT_HORIZON_DEBUG__?.addLink(1, 2);
    window.__EVENT_HORIZON_DEBUG__?.playPulse();
  });
  await page.waitForFunction(() => (window.__EVENT_HORIZON__?.getSnapshot() as { phase?: string } | undefined)?.phase === 'ended', null, { timeout: 9000 });
  const ended = await getSnapshot(page);
  expect(ended.endReason).toBe('pulse-died');
  expect(ended.suggestedFixes.length).toBeGreaterThan(0);
  await page.locator('#pulse-undo-button').click();
  await page.waitForTimeout(120);
  expect((await getSnapshot(page)).phase).toBe('build');
});

async function openGame(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.clear();
  });
  await page.goto('./?seed=tutorial-001&debugInput=1');
  await page.locator('canvas').waitFor({ state: 'visible' });
}

async function startTutorial(page: Page): Promise<void> {
  await openGame(page);
  await page.locator('#help-play-button').click();
  await expect(page.locator('#help-overlay')).toBeHidden();
}

async function tutorialChainReady(page: Page): Promise<void> {
  await startTutorial(page);
  await swipeThroughNodes(page, [1, 2, 3]);
  await page.waitForFunction(() => (window.__EVENT_HORIZON__?.getSnapshot() as { tutorialStep?: string } | undefined)?.tutorialStep === 'tap-splitter');
}

async function tutorialReadyToPlay(page: Page): Promise<void> {
  await tutorialChainReady(page);
  await tapNode(page, 4);
  await page.waitForFunction(() => (window.__EVENT_HORIZON__?.getSnapshot() as { tutorialStep?: string } | undefined)?.tutorialStep === 'press-play');
}

async function tutorialPulseReadyForLens(page: Page): Promise<void> {
  await tutorialReadyToPlay(page);
  await page.locator('#pulse-play-button').click();
  await page.waitForFunction(() => (window.__EVENT_HORIZON__?.getSnapshot() as { phase?: string } | undefined)?.phase === 'pulse');
  await page.waitForTimeout(2200);
  await tapNode(page, 3);
  await page.waitForFunction(() => (window.__EVENT_HORIZON__?.getSnapshot() as { tutorialStep?: string } | undefined)?.tutorialStep === 'lens');
}

async function getSnapshot(page: Page) {
  return (await page.evaluate(() => window.__EVENT_HORIZON__?.getSnapshot())) as {
    phase: string;
    tutorialStep: string;
    tutorialHighlightNodeIds: number[];
    linksUsed: number;
    lastChainNodeIds: number[];
    lastInputResult: { kind: string; ok: boolean; message: string };
    links: Array<{ fromId: number; toId: number; temporary: boolean }>;
    suggestedFixes: unknown[];
    endReason?: string;
  };
}

async function nodeById(page: Page, id: number) {
  const node = await page.evaluate((nodeId) => {
    const nodes = window.__EVENT_HORIZON_DEBUG__?.getNodes() as Array<{ id: number; x: number; y: number; splitterPriority: number }> | undefined;
    return nodes?.find((candidate) => candidate.id === nodeId);
  }, id);
  if (!node) {
    throw new Error(`Missing node ${id}`);
  }
  return node as { id: number; x: number; y: number; splitterPriority: number };
}

async function tapNode(page: Page, id: number): Promise<void> {
  const node = await nodeById(page, id);
  const point = await worldToScreen(page, node.x, node.y);
  await page.mouse.click(point.x, point.y);
}

async function swipeThroughNodes(page: Page, ids: number[]): Promise<void> {
  const points = [];
  for (const id of ids) {
    const node = await nodeById(page, id);
    points.push(await worldToScreen(page, node.x, node.y));
  }
  await page.mouse.move(points[0].x, points[0].y);
  await page.mouse.down();
  for (const point of points.slice(1)) {
    await page.mouse.move(point.x, point.y, { steps: 8 });
  }
  await page.mouse.up();
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
