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
await page.goto('http://127.0.0.1:5173/event-horizon/?seed=tutorial-002', { waitUntil: 'networkidle' });
await page.locator('canvas').waitFor({ state: 'visible', timeout: 10000 });
await screenshot('iteration-05-help-goal-mobile.jpg', 78);

await page.locator('#help-skip-button').click();
await page.locator('#legend-button').click();
await page.waitForTimeout(180);
await screenshot('iteration-05-node-legend-mobile.jpg', 78);
await page.locator('#legend-close-button').click();

await page.evaluate(() => window.__EVENT_HORIZON_DEBUG__?.startTutorial());
await page.waitForTimeout(220);
await screenshot('iteration-05-battery-objectives-mobile.jpg', 80);

await page.waitForFunction(() => window.__EVENT_HORIZON__?.getSnapshot()?.tutorialStep === 'swipe-batteries');
await tapNode(2);
await page.waitForTimeout(180);
await screenshot('iteration-05-node-info-card-mobile.jpg', 80);

await tapEmpty();
await createTutorialLoop();
await page.waitForTimeout(220);
await screenshot('iteration-05-loop-ready-mobile.jpg', 80);

await page.locator('#pulse-play-button').click();
await page.waitForFunction(() => window.__EVENT_HORIZON__?.getSnapshot()?.batteriesLit >= 1, null, { timeout: 9000 });
await page.waitForTimeout(180);
await screenshot('iteration-05-battery-lit-mobile.jpg', 80);

await resetForDeadEnd();
await page.waitForFunction(() => window.__EVENT_HORIZON__?.getSnapshot()?.phase === 'ended', null, { timeout: 9000 });
await page.waitForTimeout(180);
await screenshot('iteration-05-failure-explained-mobile.jpg', 76);

await page.evaluate(() => {
  window.__EVENT_HORIZON__?.restart();
  window.__EVENT_HORIZON_DEBUG__?.startTutorial();
});
await page.waitForFunction(() => window.__EVENT_HORIZON__?.getSnapshot()?.tutorialStep === 'swipe-batteries');
await createTutorialLoop();
await page.locator('#pulse-play-button').click();
await page.waitForFunction(() => window.__EVENT_HORIZON__?.getSnapshot()?.endReason === 'stabilized', null, { timeout: 15000 });
await page.waitForTimeout(180);
await screenshot('iteration-05-sector-stabilized-mobile.jpg', 76);

await browser.close();

for (const file of [
  'iteration-05-help-goal-mobile.jpg',
  'iteration-05-node-legend-mobile.jpg',
  'iteration-05-battery-objectives-mobile.jpg',
  'iteration-05-node-info-card-mobile.jpg',
  'iteration-05-loop-ready-mobile.jpg',
  'iteration-05-battery-lit-mobile.jpg',
  'iteration-05-failure-explained-mobile.jpg',
  'iteration-05-sector-stabilized-mobile.jpg'
]) {
  console.log(`Captured docs/artifacts/${file}`);
}

async function resetForDeadEnd() {
  await page.evaluate(() => {
    window.__EVENT_HORIZON__?.restart();
    window.__EVENT_HORIZON_DEBUG__?.skipTutorial();
    window.__EVENT_HORIZON_DEBUG__?.clearLinks();
    window.__EVENT_HORIZON_DEBUG__?.addLink(1, 3);
    window.__EVENT_HORIZON_DEBUG__?.playPulse();
  });
}

async function createTutorialLoop() {
  await swipeNodes([1, 2, 3, 4]);
  await page.waitForFunction(() => window.__EVENT_HORIZON__?.getSnapshot()?.tutorialStep === 'add-battery');
  await swipeNodes([4, 5, 6]);
  await page.waitForFunction(() => window.__EVENT_HORIZON__?.getSnapshot()?.tutorialStep === 'close-loop');
  await swipeNodes([6, 1]);
  await page.waitForFunction(() => window.__EVENT_HORIZON__?.getSnapshot()?.tutorialStep === 'press-play');
}

async function tapNode(id) {
  const node = await nodeById(id);
  const point = await worldToScreen(node.x, node.y);
  await page.mouse.click(point.x, point.y);
}

async function tapEmpty() {
  const point = await worldToScreen(1000, 360);
  await page.mouse.click(point.x, point.y);
}

async function swipeNodes(ids) {
  const points = [];
  for (const id of ids) {
    const node = await nodeById(id);
    points.push(await worldToScreen(node.x, node.y));
  }
  await page.mouse.move(points[0].x, points[0].y);
  await page.mouse.down();
  for (const point of points.slice(1)) {
    await page.mouse.move(point.x, point.y, { steps: 8 });
  }
  await page.mouse.up();
}

async function nodeById(id) {
  const node = await page.evaluate((nodeId) => window.__EVENT_HORIZON_DEBUG__?.getNodes().find((candidate) => candidate.id === nodeId), id);
  if (!node) {
    throw new Error(`Node ${id} not found.`);
  }
  return node;
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
