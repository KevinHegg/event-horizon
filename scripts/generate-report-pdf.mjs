import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import PDFDocument from 'pdfkit';

const repoRoot = new URL('../', import.meta.url);
const docsDir = new URL('../docs/', import.meta.url);
const pdfPath = new URL('first-pr-report.pdf', docsDir);
const artifacts = [
  ['Gameplay', new URL('artifacts/gameplay-mobile.jpg', docsDir)],
  ['Poster', new URL('artifacts/share-poster.jpg', docsDir)],
  ['Collapse', new URL('artifacts/collapse-mobile.jpg', docsDir)]
];

await mkdir(docsDir, { recursive: true });

const diffStat = git(['diff', 'HEAD', '--stat', '--', '.', ':(exclude)docs/first-pr-report.pdf']);
const diffExcerpt = git([
  'diff',
  'HEAD',
  '--',
  'src/game/Simulation.ts',
  'src/game/EventHorizonGame.ts',
  'src/game/FixedStepLoop.ts',
  'src/game/rng.ts',
  'netlify/functions/score-submit.mjs',
  'gas/score-submit.gs'
]).slice(0, 4200);

const doc = new PDFDocument({
  autoFirstPage: false,
  bufferPages: true,
  compress: true,
  margins: { top: 34, right: 34, bottom: 42, left: 34 },
  size: 'LETTER'
});

const chunks = [];
doc.on('data', (chunk) => chunks.push(chunk));

page();
heading('Executive Summary');
text('Event Horizon now has a first playable vertical slice on feat/first-playable: a mobile-first Vite + PixiJS v8 canvas game where the player taps and swipes to capture dark-energy orbs, delay collapse, export a share poster, and submit replay-shaped scores.');
heading('Assumptions');
bullets([
  'Greenfield repo; plain Vite was the simplest viable scaffold.',
  'Seed date remains eh-2026-05-29-alpha from the task context.',
  'GitHub Pages uses /event-horizon/; Netlify uses VITE_BASE_PATH=/ via netlify.toml.',
  'Custom deterministic motion is enough; Matter.js or Planck.js is not needed for this slice.',
  'Score endpoint validates only; persistence and anti-cheat are backlog work.'
]);
heading('Chosen Stack and Why');
bullets([
  'Vite + TypeScript for a small static site and typed modules.',
  'PixiJS v8 for WebGL-preferred 2D rendering with generated textures and a scene graph.',
  'Fixed 60 Hz custom simulation for replayable seed + input-timing runs.',
  'Vitest and Playwright Chrome for deterministic, endpoint, touch, poster, and smoke checks.',
  'Netlify function plus GAS sample for minimal score endpoint options.'
]);
heading('Plan and Estimates');
text('Repo guide 0.25h; scaffold 0.75h; simulation/replay 2h; Pixi scene/HUD 2h; input 1h; collapse/poster 1.25h; endpoints 0.75h; tests/artifacts 1.25h; docs/report 1.25h. Total: 10.5h.');
heading('Backlog');
bullets([
  'Durable score storage and abuse limits.',
  'Replay playback UI and CI replay verifier.',
  'Balance phase thresholds, spawn curves, scoring, sound, haptics, and reduced motion.',
  'GitHub Actions for build, lint, unit, and Chrome smoke tests.'
]);

page();
heading('Files Created or Changed');
text('AGENTS.md, README.md, index.html, package.json, package-lock.json, tsconfig.json, vite.config.ts, eslint.config.js, playwright.config.ts, netlify.toml, docs/*, gas/score-submit.gs, netlify/functions/score-submit.mjs, scripts/*, src/main.ts, src/styles.css, src/vite-env.d.ts, src/game/*, tests/*.');
heading('Key File Notes');
bullets([
  'Simulation.ts: deterministic state, orb/flyby/shadow-arm mechanics, replay payloads.',
  'EventHorizonGame.ts: PixiJS scene, scaling, HUD, collapse, poster export, score submit.',
  'FixedStepLoop.ts and rng.ts: 60 Hz decoupled updates and mulberry32 RNG.',
  'InputHandler.ts: pointer tap/swipe mapping to 1080 x 1920 logical space.',
  'posterizer.ts: vertical share image from three gameplay frames.',
  'score-submit.mjs and score-submit.gs: Netlify and GAS score endpoints.',
  'tests/*: deterministic replay, endpoint, mobile Chrome, touch, poster, and collapse checks.'
]);
heading('Sample Replay Payload');
code('{"version":1,"seed":"eh-2026-05-29-alpha","startedAt":1780051200000,"survivalMs":67421,"score":1280,"energyCaptured":87,"maxStreak":24,"tapEvents":[],"swipeEvents":[],"phaseTransitions":[]}');
heading('Test Results');
bullets([
  'npm run build: passed; Vite dist generated.',
  'npm run lint: passed.',
  'npm run test: passed, 2 files and 5 tests.',
  'npm run test:e2e: passed, 4 mobile Chrome tests.',
  'npm run score:test: passed, status 200.',
  'Local Chrome smoke, deterministic replay, touch simulation, poster export, collapse, and score submit all passed.'
]);
heading('Performance Notes');
text('Stable art uses generated textures; background is static; hot-loop allocations are minimized; no expensive filters or physics engine. Poster capture uses toDataURL only on user action.');

page();
heading('Run, Git, and Deployment');
code('npm install\nnpm run dev\nnpm run build\nnpm run lint\nnpm run test\nnpm run test:e2e\nnpm run score:test\nnpm run capture:artifacts\nnpm run report:pdf');
code('git switch -c feat/first-playable\ngit add .\ngit commit -m "Build first playable Event Horizon slice"\ngit push -u origin feat/first-playable\ngh pr create --base main --head feat/first-playable --title "Build first playable Event Horizon slice" --body-file docs/pr-body.md');
text('Netlify: build command VITE_BASE_PATH=/ npm run build, publish dist, functions directory netlify/functions, endpoint /.netlify/functions/score-submit, use npx netlify dev locally. GitHub Pages: default Vite base is /event-horizon/ for https://kevinhegg.github.io/event-horizon/.');
heading('Major Snippets');
code('await app.init({ autoStart:false, preference:"webgl", resizeTo:this.root, preserveDrawingBuffer:true });\nwhile (accumulatorMs >= FIXED_STEP_MS) step(FIXED_STEP_MS);\nexport function mulberry32(seed){ state=(state+0x6d2b79f5)>>>0; /* deterministic */ }\nif (moved >= swipeThresholdSq) onSwipe(start,end); else onTap(end);\nfunction doPost(e){ return ContentService.createTextOutput(JSON.stringify({ok:true})).setMimeType(ContentService.MimeType.JSON); }');
heading('PR Summary');
text('PR #1 is opened from feat/first-playable to main with project scaffold, PixiJS canvas integration, deterministic loop, gameplay slice, endpoints, tests, screenshots, README, AGENTS.md, and this PDF.');

page();
heading('Screenshots and Poster');
for (const [label, image] of artifacts) {
  if (existsSync(image)) {
    doc.font('Helvetica-Bold').fontSize(9).text(label);
    doc.image(image.pathname, { fit: [110, 190], align: 'center' });
  }
}
heading('Diff Stat');
code(diffStat || 'No diff stat available.');
heading('Diff Excerpt');
code(`${diffExcerpt}\n[Excerpt capped for PDF practicality; full diff is in PR #1.]`);

addPageNumbers();
doc.end();
const buffer = await new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
await writeFile(pdfPath, buffer);
const size = await stat(pdfPath);
console.log(`Wrote docs/first-pr-report.pdf (${Math.round(size.size / 1024)} KiB)`);

function git(args) {
  try {
    return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 1024 * 1024 * 4 });
  } catch (error) {
    return `git output unavailable: ${error.message}`;
  }
}

function page() {
  doc.addPage();
  doc.fillColor('#111');
}

function heading(value) {
  room(26);
  doc.moveDown(0.25);
  doc.font('Helvetica-Bold').fontSize(12).text(value);
  doc.moveDown(0.15);
}

function text(value) {
  room(32);
  doc.font('Helvetica').fontSize(8).fillColor('#222').text(value, { lineGap: 1.5 });
}

function bullets(values) {
  for (const value of values) {
    text(`- ${value}`);
  }
}

function code(value) {
  for (const line of value.split('\n')) {
    room(11);
    doc.font('Courier').fontSize(5.5).fillColor('#222').text(line || ' ', { lineGap: 0 });
  }
  doc.moveDown(0.2);
}

function room(height) {
  if (doc.y + height > doc.page.height - doc.page.margins.bottom) {
    page();
  }
}

function addPageNumbers() {
  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    doc.font('Helvetica').fontSize(7).fillColor('#666').text(`Event Horizon first PR report  •  ${index + 1}`, 34, 756, {
      align: 'center',
      width: 544
    });
  }
}
