import { expect, test, type Page } from '@playwright/test';

const WORLD_WIDTH = 1080;
const WORLD_HEIGHT = 1920;
const BLACK_HOLE_X = WORLD_WIDTH / 2;
const BLACK_HOLE_Y = WORLD_HEIGHT * 0.44;

test('help overlay opens on first visit and closes with play', async ({ page }) => {
  await openGame(page);
  await expect(page.locator('#help-overlay')).toBeVisible();
  await page.locator('#help-play-button').click();
  await expect(page.locator('#help-overlay')).toBeHidden();
  await page.waitForTimeout(250);
  const snapshot = await page.evaluate(() => window.__EVENT_HORIZON__?.getSnapshot());
  expect(snapshot?.timeMs).toBeGreaterThan(0);
});

test('smoke renders playable Pixi canvas', async ({ page }) => {
  await openGameAndPlay(page);
  const canvas = page.locator('canvas');
  await expect(canvas).toBeVisible();
  await page.waitForTimeout(650);
  const snapshot = await page.evaluate(() => window.__EVENT_HORIZON__?.getSnapshot());
  expect(snapshot?.phase).toBeGreaterThanOrEqual(1);
  expect(snapshot?.energy).toBeGreaterThan(0);
});

test('tap and tether swipe are captured into replay payload', async ({ page }) => {
  await openGameAndPlay(page, '?debugInput=1');
  const canvas = page.locator('canvas');
  const box = await canvas.boundingBox();
  expect(box).toBeTruthy();
  if (!box) {
    return;
  }

  await page.touchscreen.tap(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await waitForTutorialOrb(page);
  const before = await page.evaluate(() => window.__EVENT_HORIZON__?.getSnapshot());
  const swipe = await makeTutorialTetherSwipe(page);
  await page.mouse.move(swipe.start.x, swipe.start.y);
  await page.mouse.down();
  await page.mouse.move(swipe.mid.x, swipe.mid.y, { steps: 4 });
  await page.mouse.move(swipe.end.x, swipe.end.y, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(120);

  const replay = await page.evaluate(() => window.__EVENT_HORIZON__?.getReplayPayload());
  const after = await page.evaluate(() => window.__EVENT_HORIZON__?.getSnapshot());
  const lastGesture = await page.evaluate(() => window.__EVENT_HORIZON_DEBUG__?.getLastGesture());
  const lastSwipe = replay?.swipeEvents.at(-1);
  expect(replay?.tapEvents.length).toBeGreaterThanOrEqual(1);
  expect(replay?.swipeEvents.length).toBeGreaterThanOrEqual(1);
  expect(lastSwipe?.path.length).toBeGreaterThanOrEqual(2);
  expect(lastSwipe?.target).not.toBe('empty');
  expect(lastSwipe?.success).toBe(true);
  expect(after?.score).toBeGreaterThan(before?.score ?? 0);
  expect(lastGesture?.activeTrailCount).toBeGreaterThan(0);
});

test('posterizer exports a compact png data url', async ({ page }) => {
  await openGameAndPlay(page);
  await page.waitForTimeout(900);
  const poster = await page.evaluate(() => window.__EVENT_HORIZON__?.exportPoster());
  expect(poster).toMatch(/^data:image\/png;base64,/);
  expect(poster?.length).toBeGreaterThan(1200);
});

test('miss swipe records visible feedback state', async ({ page }) => {
  await openGameAndPlay(page, '?debugInput=1');
  await page.waitForTimeout(250);
  const result = await page.evaluate(() =>
    window.__EVENT_HORIZON_DEBUG__?.simulateSwipeWorld([
      { x: 80, y: 1760 },
      { x: 180, y: 1840 }
    ])
  );
  const lastGesture = await page.evaluate(() => window.__EVENT_HORIZON_DEBUG__?.getLastGesture());
  expect(result?.success).toBe(false);
  expect(result?.message).toBe('MISS');
  expect(lastGesture?.activeTrailCount).toBeGreaterThan(0);
});

test('end-state collapse is reachable', async ({ page }) => {
  await openGameAndPlay(page);
  await page.evaluate(() => window.__EVENT_HORIZON__?.forceEnd());
  await page.waitForTimeout(250);
  const snapshot = await page.evaluate(() => window.__EVENT_HORIZON__?.getSnapshot());
  expect(snapshot?.ended).toBe(true);
  expect(snapshot?.collapseT).toBeGreaterThan(0);
});

async function openGame(page: Page, query = ''): Promise<void> {
  await page.addInitScript(() => {
    localStorage.clear();
  });
  await page.goto(query ? `.${query}` : './');
  await page.locator('canvas').waitFor({ state: 'visible' });
}

async function openGameAndPlay(page: Page, query = ''): Promise<void> {
  await openGame(page, query);
  await expect(page.locator('#help-overlay')).toBeVisible();
  await page.locator('#help-play-button').click();
  await expect(page.locator('#help-overlay')).toBeHidden();
}

async function waitForTutorialOrb(page: Page) {
  return page.waitForFunction(() => {
    const snapshot = window.__EVENT_HORIZON__?.getSnapshot();
    return snapshot?.orbs.some((orb) => orb.active && orb.tutorial && !orb.captured);
  });
}

async function makeTutorialTetherSwipe(page: Page) {
  const canvas = page.locator('canvas');
  const box = await canvas.boundingBox();
  if (!box) {
    throw new Error('Canvas box unavailable.');
  }
  const snapshot = await page.evaluate(() => window.__EVENT_HORIZON__?.getSnapshot());
  const orb = snapshot?.orbs.find((candidate) => candidate.active && candidate.tutorial && !candidate.captured);
  if (!orb) {
    throw new Error('Tutorial orb unavailable.');
  }
  const targetX = BLACK_HOLE_X + (orb.x - BLACK_HOLE_X) * 0.78;
  const targetY = BLACK_HOLE_Y + (orb.y - BLACK_HOLE_Y) * 0.78;
  const dx = orb.x - BLACK_HOLE_X;
  const dy = orb.y - BLACK_HOLE_Y;
  const length = Math.max(1, Math.hypot(dx, dy));
  const normalX = -dy / length;
  const normalY = dx / length;
  const start = worldToScreen(box, targetX - normalX * 150, targetY - normalY * 150);
  const mid = worldToScreen(box, targetX, targetY);
  const end = worldToScreen(box, targetX + normalX * 150, targetY + normalY * 150);
  return { start, mid, end };
}

function worldToScreen(box: { x: number; y: number; width: number; height: number }, x: number, y: number) {
  const scale = Math.min(box.width / WORLD_WIDTH, box.height / WORLD_HEIGHT);
  const offsetX = (box.width - WORLD_WIDTH * scale) / 2;
  const offsetY = (box.height - WORLD_HEIGHT * scale) / 2;
  return {
    x: box.x + offsetX + x * scale,
    y: box.y + offsetY + y * scale
  };
}
