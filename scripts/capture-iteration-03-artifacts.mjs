import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const WORLD_WIDTH = 1080;
const WORLD_HEIGHT = 1920;
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
await page.goto('http://127.0.0.1:5173/event-horizon/?seed=tutorial&debugInput=1', { waitUntil: 'networkidle' });
await page.locator('canvas').waitFor({ state: 'visible', timeout: 10000 });
await screenshot('iteration-03-help-mobile.jpg', 76);

await page.locator('#help-play-button').click();
await page.waitForFunction(() => window.__EVENT_HORIZON__?.getSnapshot()?.phase === 'build');
await page.waitForTimeout(220);
await screenshot('iteration-03-build-phase-mobile.jpg', 78);

await buildTutorialChain();
await page.waitForTimeout(180);
await screenshot('iteration-03-link-placement-mobile.jpg', 78);

await page.locator('#pulse-play-button').click();
await page.waitForFunction(() => {
  const snapshot = window.__EVENT_HORIZON__?.getSnapshot();
  return snapshot?.phase === 'pulse' && snapshot.pulses.length > 0;
});
await page.waitForTimeout(850);
await screenshot('iteration-03-pulse-running-mobile.jpg', 78);

await makeLensSwipe(6, 8);
await page.waitForTimeout(140);
await screenshot('iteration-03-horizon-lens-mobile.jpg', 80);

await page.evaluate(() => window.__EVENT_HORIZON_DEBUG__?.forceCollapse());
await page.waitForTimeout(260);
await screenshot('iteration-03-end-screen-mobile.jpg', 72);

await browser.close();

for (const file of [
  'iteration-03-help-mobile.jpg',
  'iteration-03-build-phase-mobile.jpg',
  'iteration-03-link-placement-mobile.jpg',
  'iteration-03-pulse-running-mobile.jpg',
  'iteration-03-horizon-lens-mobile.jpg',
  'iteration-03-end-screen-mobile.jpg'
]) {
  console.log(`Captured docs/artifacts/${file}`);
}

async function buildTutorialChain() {
  for (const [fromId, toId] of [
    [1, 2],
    [2, 3],
    [3, 4],
    [4, 5],
    [4, 6]
  ]) {
    const from = await nodeById(fromId);
    const to = await nodeById(toId);
    await tapWorld(from.x, from.y);
    await tapWorld(to.x, to.y);
    await page.waitForTimeout(50);
  }
}

async function makeLensSwipe(fromId, toId) {
  const from = await nodeById(fromId);
  const to = await nodeById(toId);
  const start = await worldToScreen(from.x, from.y);
  const end = await worldToScreen(to.x, to.y);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move((start.x + end.x) / 2, (start.y + end.y) / 2 - 42, { steps: 6 });
  await page.mouse.move(end.x, end.y, { steps: 6 });
  await page.mouse.up();
}

async function nodeById(id) {
  const node = await page.evaluate((nodeId) => window.__EVENT_HORIZON_DEBUG__?.getNodes().find((candidate) => candidate.id === nodeId), id);
  if (!node) {
    throw new Error(`Node ${id} not found.`);
  }
  return node;
}

async function tapWorld(x, y) {
  const point = await worldToScreen(x, y);
  await page.mouse.click(point.x, point.y);
}

async function worldToScreen(x, y) {
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

async function screenshot(file, quality) {
  await page.screenshot({
    path: new URL(file, outputDir).pathname,
    type: 'jpeg',
    quality,
    fullPage: false
  });
}
