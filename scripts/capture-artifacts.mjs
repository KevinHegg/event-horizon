import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const outputDir = new URL('../docs/artifacts/', import.meta.url);
await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true
});

await page.goto('http://127.0.0.1:5173/event-horizon/', { waitUntil: 'networkidle' });
await page.locator('canvas').waitFor({ state: 'visible', timeout: 10000 });
await page.waitForTimeout(1300);
await page.screenshot({
  path: new URL('gameplay-mobile.jpg', outputDir).pathname,
  type: 'jpeg',
  quality: 62,
  fullPage: false
});

const canvasBox = await page.locator('canvas').boundingBox();
if (canvasBox) {
  await page.touchscreen.tap(canvasBox.x + canvasBox.width * 0.48, canvasBox.y + canvasBox.height * 0.42);
  await page.mouse.move(canvasBox.x + canvasBox.width * 0.28, canvasBox.y + canvasBox.height * 0.72);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + canvasBox.width * 0.76, canvasBox.y + canvasBox.height * 0.46, {
    steps: 8
  });
  await page.mouse.up();
}

await page.waitForTimeout(900);
const posterDataUrl = await page.evaluate(() => window.__EVENT_HORIZON__?.exportPoster());
if (!posterDataUrl || !posterDataUrl.startsWith('data:image/png;base64,')) {
  throw new Error('Poster export failed.');
}
const posterJpeg = await page.evaluate(async (dataUrl) => {
  const image = await new Promise((resolve, reject) => {
    const candidate = new Image();
    candidate.onload = () => resolve(candidate);
    candidate.onerror = () => reject(new Error('Unable to load poster image.'));
    candidate.src = dataUrl;
  });
  const canvas = document.createElement('canvas');
  canvas.width = 540;
  canvas.height = 960;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Unable to create poster compression canvas.');
  }
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.7);
}, posterDataUrl);
await writeFile(new URL('share-poster.jpg', outputDir), Buffer.from(posterJpeg.split(',')[1], 'base64'));

await page.evaluate(() => window.__EVENT_HORIZON__?.forceEnd());
await page.waitForTimeout(950);
await page.screenshot({
  path: new URL('collapse-mobile.jpg', outputDir).pathname,
  type: 'jpeg',
  quality: 58,
  fullPage: false
});

await browser.close();
console.log('Captured docs/artifacts/gameplay-mobile.jpg');
console.log('Captured docs/artifacts/share-poster.jpg');
console.log('Captured docs/artifacts/collapse-mobile.jpg');
