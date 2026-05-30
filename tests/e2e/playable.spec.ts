import { expect, test } from '@playwright/test';

test('smoke renders playable Pixi canvas', async ({ page }) => {
  await page.goto('/');
  const canvas = page.locator('canvas');
  await expect(canvas).toBeVisible();
  await page.waitForTimeout(650);
  const snapshot = await page.evaluate(() => window.__EVENT_HORIZON__?.getSnapshot());
  expect(snapshot?.phase).toBeGreaterThanOrEqual(1);
  expect(snapshot?.energy).toBeGreaterThan(0);
});

test('touch tap and swipe are captured into replay payload', async ({ page }) => {
  await page.goto('/');
  const canvas = page.locator('canvas');
  const box = await canvas.boundingBox();
  expect(box).toBeTruthy();
  if (!box) {
    return;
  }

  await page.touchscreen.tap(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.68);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.72, box.y + box.height * 0.44, { steps: 8 });
  await page.mouse.up();

  const replay = await page.evaluate(() => window.__EVENT_HORIZON__?.getReplayPayload());
  expect(replay?.tapEvents.length).toBeGreaterThanOrEqual(1);
  expect(replay?.swipeEvents.length).toBeGreaterThanOrEqual(1);
});

test('posterizer exports a compact png data url', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(900);
  const poster = await page.evaluate(() => window.__EVENT_HORIZON__?.exportPoster());
  expect(poster).toMatch(/^data:image\/png;base64,/);
  expect(poster?.length).toBeGreaterThan(1200);
});

test('end-state collapse is reachable', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => window.__EVENT_HORIZON__?.forceEnd());
  await page.waitForTimeout(250);
  const snapshot = await page.evaluate(() => window.__EVENT_HORIZON__?.getSnapshot());
  expect(snapshot?.ended).toBe(true);
  expect(snapshot?.collapseT).toBeGreaterThan(0);
});
