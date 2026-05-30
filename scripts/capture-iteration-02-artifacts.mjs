import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const WORLD_WIDTH = 1080;
const WORLD_HEIGHT = 1920;
const BLACK_HOLE_X = WORLD_WIDTH / 2;
const BLACK_HOLE_Y = WORLD_HEIGHT * 0.44;

const outputDir = new URL('../docs/artifacts/', import.meta.url);
await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true
});

await page.addInitScript(() => window.localStorage.clear());
await page.goto('http://127.0.0.1:5173/event-horizon/', { waitUntil: 'networkidle' });
await page.locator('canvas').waitFor({ state: 'visible', timeout: 10000 });
await page.screenshot({
  path: new URL('iteration-02-help-mobile.jpg', outputDir).pathname,
  type: 'jpeg',
  quality: 72,
  fullPage: false
});

await page.locator('#help-play-button').click();
await page.waitForFunction(() => {
  const snapshot = window.__EVENT_HORIZON__?.getSnapshot();
  return snapshot?.orbs.some((orb) => orb.active && orb.tutorial && !orb.captured);
});
await page.waitForTimeout(180);
await page.screenshot({
  path: new URL('iteration-02-gameplay-mobile.jpg', outputDir).pathname,
  type: 'jpeg',
  quality: 70,
  fullPage: false
});

const swipe = await makeTutorialTetherSwipe(page);
await page.mouse.move(swipe.start.x, swipe.start.y);
await page.mouse.down();
await page.mouse.move(swipe.mid.x, swipe.mid.y, { steps: 4 });
await page.mouse.move(swipe.end.x, swipe.end.y, { steps: 5 });
await page.mouse.up();
await page.waitForTimeout(130);
await page.screenshot({
  path: new URL('iteration-02-swipe-trail-mobile.jpg', outputDir).pathname,
  type: 'jpeg',
  quality: 76,
  fullPage: false
});

await page.evaluate(() =>
  window.__EVENT_HORIZON_DEBUG__?.simulateSwipeWorld([
    { x: 80, y: 1760 },
    { x: 180, y: 1840 }
  ])
);
await page.waitForTimeout(250);

await page.evaluate(() => window.__EVENT_HORIZON__?.restart());
await page.waitForTimeout(150);
await page.evaluate(() => window.__EVENT_HORIZON__?.forceEnd());
await page.waitForTimeout(1100);
await page.screenshot({
  path: new URL('iteration-02-collapse-mobile.jpg', outputDir).pathname,
  type: 'jpeg',
  quality: 66,
  fullPage: false
});

await browser.close();

console.log('Captured docs/artifacts/iteration-02-help-mobile.jpg');
console.log('Captured docs/artifacts/iteration-02-gameplay-mobile.jpg');
console.log('Captured docs/artifacts/iteration-02-swipe-trail-mobile.jpg');
console.log('Captured docs/artifacts/iteration-02-collapse-mobile.jpg');

async function makeTutorialTetherSwipe(page) {
  const box = await page.locator('canvas').boundingBox();
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
  return {
    start: worldToScreen(box, targetX - normalX * 150, targetY - normalY * 150),
    mid: worldToScreen(box, targetX, targetY),
    end: worldToScreen(box, targetX + normalX * 150, targetY + normalY * 150)
  };
}

function worldToScreen(box, x, y) {
  const scale = Math.min(box.width / WORLD_WIDTH, box.height / WORLD_HEIGHT);
  const offsetX = (box.width - WORLD_WIDTH * scale) / 2;
  const offsetY = (box.height - WORLD_HEIGHT * scale) / 2;
  return {
    x: box.x + offsetX + x * scale,
    y: box.y + offsetY + y * scale
  };
}
