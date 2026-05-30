import { expect, test, type Page } from '@playwright/test';

const WORLD_WIDTH = 1080;
const WORLD_HEIGHT = 1920;

test('help states the primary goal clearly', async ({ page }) => {
  await openGame(page);
  await expect(page.locator('#help-overlay')).toBeVisible();
  await expect(page.locator('#help-overlay')).toContainText('Light all Dark Energy Batteries');
  await expect(page.locator('#help-overlay')).toContainText('Close the loop');
  await expect(page.locator('#help-play-button')).toHaveText('START TUTORIAL');
});

test('legend explains every node type', async ({ page }) => {
  await openGame(page);
  await page.locator('#help-skip-button').click();
  await page.locator('#legend-button').click();
  await expect(page.locator('#legend-overlay')).toBeVisible();
  for (const label of ['SOURCE', 'BATTERY', 'RELAY', 'CAPACITOR', 'ROUTER']) {
    await expect(page.locator('#legend-overlay')).toContainText(label);
  }
});

test('tutorial first screen highlights Battery objectives', async ({ page }) => {
  await startTutorial(page);
  const snapshot = await getSnapshot(page);
  expect(snapshot.tutorialStep).toBe('battery-goal');
  expect(snapshot.tutorialHint).toContain('LIGHT ALL 3 BATTERIES');
  expect(snapshot.tutorialHighlightNodeIds).toEqual([2, 4, 6]);
});

test('tapping each node type shows an info card', async ({ page }) => {
  await startTutorial(page);
  await page.waitForTimeout(1200);
  for (const [id, title] of [
    [1, 'SOURCE'],
    [2, 'BATTERY'],
    [3, 'RELAY'],
    [7, 'CAPACITOR'],
    [8, 'ROUTER']
  ] as const) {
    await tapNode(page, id);
    await page.waitForTimeout(80);
    expect((await getSnapshot(page)).nodeInfoCard?.title).toBe(title);
    await tapEmpty(page);
  }
});

test('swipe chain lights Batteries and updates goal HUD state', async ({ page }) => {
  await startTutorial(page);
  await page.waitForFunction(() => (window.__EVENT_HORIZON__?.getSnapshot() as { tutorialStep?: string } | undefined)?.tutorialStep === 'swipe-batteries');
  await swipeThroughNodes(page, [1, 2, 3, 4]);
  await page.waitForFunction(() => (window.__EVENT_HORIZON__?.getSnapshot() as { linksUsed?: number } | undefined)?.linksUsed === 3);
  await page.locator('#pulse-play-button').click();
  await page.waitForFunction(() => ((window.__EVENT_HORIZON__?.getSnapshot() as { batteriesLit?: number } | undefined)?.batteriesLit ?? 0) >= 1, null, {
    timeout: 9000
  });
  const snapshot = await getSnapshot(page);
  expect(snapshot.batteriesLit).toBeGreaterThanOrEqual(1);
  expect(snapshot.lastInputResult.message).toMatch(/BATTERY LIT|ALL BATTERIES LIT/);
});

test('closing loop shows LOOP READY and sector stabilization is reachable', async ({ page }) => {
  await startTutorial(page);
  await page.waitForFunction(() => (window.__EVENT_HORIZON__?.getSnapshot() as { tutorialStep?: string } | undefined)?.tutorialStep === 'swipe-batteries');
  await createTutorialLoop(page);
  const build = await getSnapshot(page);
  expect(build.chainAnalysis.sourceLoopClosed).toBe(true);
  expect(build.chainAnalysis.hint).toMatch(/Great loop|Good chain/);
  await page.locator('#pulse-play-button').click();
  await page.waitForFunction(() => (window.__EVENT_HORIZON__?.getSnapshot() as { endReason?: string } | undefined)?.endReason === 'stabilized', null, { timeout: 15000 });
  const ended = await getSnapshot(page);
  expect(ended.batteriesLit).toBe(3);
  expect(ended.primaryGoalComplete).toBe(true);
  expect(ended.stabilized).toBe(true);
});

test('failure screen names the problem and Fix Chain returns to build', async ({ page }) => {
  await startTutorial(page);
  await page.evaluate(() => {
    window.__EVENT_HORIZON_DEBUG__?.skipTutorial();
    window.__EVENT_HORIZON_DEBUG__?.clearLinks();
    window.__EVENT_HORIZON_DEBUG__?.addLink(1, 3);
    window.__EVENT_HORIZON_DEBUG__?.playPulse();
  });
  await page.waitForFunction(() => (window.__EVENT_HORIZON__?.getSnapshot() as { phase?: string } | undefined)?.phase === 'ended', null, { timeout: 9000 });
  const ended = await getSnapshot(page);
  expect(ended.failureReason).toContain('Batteries');
  await expect(page.locator('canvas')).toBeVisible();
  await page.locator('#pulse-undo-button').click();
  await page.waitForTimeout(120);
  expect((await getSnapshot(page)).phase).toBe('build');
});

async function openGame(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.clear();
  });
  await page.goto('./?seed=tutorial-002&debugInput=1');
  await page.locator('canvas').waitFor({ state: 'visible' });
}

async function startTutorial(page: Page): Promise<void> {
  await openGame(page);
  await page.locator('#help-play-button').click();
  await expect(page.locator('#help-overlay')).toBeHidden();
}

async function createTutorialLoop(page: Page): Promise<void> {
  await swipeThroughNodes(page, [1, 2, 3, 4]);
  await page.waitForFunction(() => (window.__EVENT_HORIZON__?.getSnapshot() as { tutorialStep?: string } | undefined)?.tutorialStep === 'add-battery');
  await swipeThroughNodes(page, [4, 5, 6]);
  await page.waitForFunction(() => (window.__EVENT_HORIZON__?.getSnapshot() as { tutorialStep?: string } | undefined)?.tutorialStep === 'close-loop');
  await swipeThroughNodes(page, [6, 1]);
  await page.waitForFunction(() => (window.__EVENT_HORIZON__?.getSnapshot() as { tutorialStep?: string } | undefined)?.tutorialStep === 'press-play');
}

async function getSnapshot(page: Page) {
  return (await page.evaluate(() => window.__EVENT_HORIZON__?.getSnapshot())) as {
    phase: string;
    tutorialStep: string;
    tutorialHint: string;
    tutorialHighlightNodeIds: number[];
    linksUsed: number;
    batteriesLit: number;
    primaryGoalComplete: boolean;
    stabilized: boolean;
    endReason?: string;
    failureReason: string;
    nodeInfoCard?: { title: string };
    chainAnalysis: { sourceLoopClosed: boolean; hint: string };
    lastInputResult: { kind: string; ok: boolean; message: string };
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

async function tapEmpty(page: Page): Promise<void> {
  const point = await worldToScreen(page, 1000, 360);
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
