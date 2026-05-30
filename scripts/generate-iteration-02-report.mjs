import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { chromium } from '@playwright/test';

const repoRoot = new URL('../', import.meta.url);
const docsDir = new URL('../docs/', import.meta.url);
const artifactsDir = new URL('artifacts/', docsDir);
const reportPath = new URL('iteration-02-report.md', docsDir);
const pdfPath = new URL('iteration-02-report.pdf', docsDir);
const testResultsPath = new URL('artifacts/iteration-02-test-results.txt', docsDir);
const baseRef = process.env.REPORT_BASE_REF ?? 'origin/main';

await mkdir(docsDir, { recursive: true });

const changedFiles = await collectChangedFiles();
const sourceFiles = changedFiles.filter((file) => isTextSource(file));
const binaryFiles = changedFiles.filter((file) => !isTextSource(file));
const testResults = existsSync(testResultsPath)
  ? await readFile(testResultsPath, 'utf8')
  : 'Test result log was not present when this report was generated.';

const markdown = await buildMarkdown(sourceFiles, binaryFiles, testResults);
await writeFile(reportPath, markdown);

const html = await buildHtml(markdown);
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();
await page.setContent(html, { waitUntil: 'load' });
await page.pdf({
  path: pdfPath.pathname,
  format: 'Letter',
  printBackground: true,
  margin: {
    top: '0.5in',
    right: '0.46in',
    bottom: '0.5in',
    left: '0.46in'
  }
});
await browser.close();

const size = await stat(pdfPath);
console.log(`Wrote docs/iteration-02-report.md`);
console.log(`Wrote docs/iteration-02-report.pdf (${Math.round(size.size / 1024)} KiB)`);

async function collectChangedFiles() {
  const names = new Set([
    ...lines(git(['diff', `${baseRef}...HEAD`, '--name-only'])),
    ...lines(git(['diff', '--cached', '--name-only'])),
    ...lines(git(['diff', '--name-only'])),
    ...lines(git(['ls-files', '--others', '--exclude-standard']))
  ]);
  names.delete('docs/iteration-02-report.md');
  names.delete('docs/iteration-02-report.pdf');
  return [...names].sort();
}

async function buildMarkdown(sourceFiles, binaryFiles, testResults) {
  const sourceBlocks = [];
  for (const file of sourceFiles) {
    const content = await readFile(new URL(file, repoRoot), 'utf8');
    sourceBlocks.push(`### ${file}\n\n\`\`\`${languageFor(file)}\n${content.replaceAll('```', '`\\`\\`')}\n\`\`\``);
  }

  return `# Event Horizon Iteration 02 Report

## Summary

Iteration 02 focuses on mobile input reliability, player comprehension, and game feel. Swipes now capture full gesture paths, render the exact interpreted trail, and hit-test against the glowing tether near an orb instead of requiring precision on the orb body. A first-run help overlay, a slower onboarding ramp, clearer Dark Energy HUD labels, hit/miss feedback, and debug hooks make smartphone testing much easier.

## Diagnosis Of The Smartphone Swipe Issue

The first playable treated a swipe mostly as a start/end segment and classified it using world-space movement. On a phone, that made the gesture brittle because small browser-coordinate movements can become large or inconsistent after viewport scaling, and the player naturally swipes through the visible tether rather than through a small orb. There was also no rendered trail or result message, so a player could not tell whether the game saw a tap, swipe, miss, or harvest.

## What Changed

- Pointer Events now capture full gesture paths, use CSS-pixel thresholds, use coalesced samples when available, and include TouchEvent fallback.
- CSS locks the gameplay surface against scroll, zoom, selection, overscroll, and long-press callouts.
- Swipe simulation now quantizes and records path samples, then tests each gesture segment against active tether segments.
- The first 30 seconds now use slower, larger, brighter tutorial orbs with delayed flyby/arm pressure.
- Pixi renders live/fading trails, start dots, end sparks, hit/miss labels, orb/tether flashes, Dark Energy meter glow, and energy pulses.
- HTML help opens automatically on first visit, pauses the simulation, and can be reopened with the ? button.
- Debug hooks expose snapshots, replay payloads, last gesture details, and world-space tap/swipe simulation.

## Exact Files Changed

${[...sourceFiles, ...binaryFiles].map((file) => `- ${file}`).join('\n')}

## Binary Or Generated Artifacts

${binaryFiles.length > 0 ? binaryFiles.map((file) => `- ${file}`).join('\n') : '- None'}

## Test Results

\`\`\`text
${testResults.trim()}
\`\`\`

## Screenshots

- docs/artifacts/iteration-02-help-mobile.jpg
- docs/artifacts/iteration-02-swipe-trail-mobile.jpg
- docs/artifacts/iteration-02-gameplay-mobile.jpg
- docs/artifacts/iteration-02-collapse-mobile.jpg

## Known Limitations

- Playwright mobile simulation passed; this has not been manually verified on a physical smartphone in this run.
- Score submission still uses the minimal validation endpoint; GitHub Pages does not host Netlify Functions.
- Tutorial state is intentionally simple and localStorage-based, not a full scripted tutorial engine.
- Touch fallback is present, but the primary tested path is modern Chrome Pointer Events.

## Next Recommended Iteration

- Test on an actual iPhone and Android device, then tune CSS-pixel thresholds and tether width from observations.
- Add a replay playback viewer so path-based replay data can be reviewed visually.
- Add sound and haptic settings, plus a reduced-motion option.
- Tune scoring, streak rewards, and phase transitions once the core gesture feels good.

## Full Source Code For Changed Text Files

${sourceBlocks.join('\n\n')}
`;
}

async function buildHtml(markdown) {
  const images = await Promise.all(
    [
      ['Help overlay', new URL('iteration-02-help-mobile.jpg', artifactsDir)],
      ['Swipe trail and harvest feedback', new URL('iteration-02-swipe-trail-mobile.jpg', artifactsDir)],
      ['Tutorial gameplay', new URL('iteration-02-gameplay-mobile.jpg', artifactsDir)],
      ['Collapse state', new URL('iteration-02-collapse-mobile.jpg', artifactsDir)]
    ].map(async ([label, url]) => {
      if (!existsSync(url)) {
        return '';
      }
      const bytes = await readFile(url);
      return `<figure><img src="data:image/jpeg;base64,${bytes.toString('base64')}" alt="${escapeHtml(label)}" /><figcaption>${escapeHtml(label)}</figcaption></figure>`;
    })
  );

  return `<!doctype html>
<html lang="en-US">
<head>
  <meta charset="utf-8" />
  <title>Event Horizon Iteration 02 Report</title>
  <style>
    @page { size: Letter; margin: 0.5in 0.46in; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: #15202b;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 10.5px;
      line-height: 1.36;
    }
    h1, h2, h3 { color: #07111f; line-height: 1.12; margin: 0.56rem 0 0.28rem; break-after: avoid; }
    h1 { font-size: 22px; border-bottom: 2px solid #2f7ea1; padding-bottom: 7px; }
    h2 { font-size: 15px; }
    h3 { font-size: 11.5px; }
    p { margin: 0 0 0.42rem; }
    ul, ol { margin: 0 0 0.5rem 1.1rem; padding: 0; }
    li { margin: 0.08rem 0; }
    code { font-family: "SFMono-Regular", Menlo, Consolas, monospace; font-size: 8px; }
    pre {
      margin: 0.35rem 0 0.65rem;
      padding: 8px;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      background: #f3f6f9;
      border: 1px solid #d9e2ea;
      border-radius: 5px;
      font-family: "SFMono-Regular", Menlo, Consolas, monospace;
      font-size: 6.6px;
      line-height: 1.22;
    }
    .cover {
      background: #07111f;
      color: #eef9ff;
      border-radius: 8px;
      padding: 18px;
      margin-bottom: 12px;
    }
    .cover h1 { color: #fff; border-color: #80e3ff; margin-top: 0; }
    .cover p { color: #cbeaf4; margin-bottom: 0; }
    .gallery {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 10px;
      margin: 8px 0 12px;
      break-inside: avoid;
    }
    figure { margin: 0; break-inside: avoid; }
    img {
      display: block;
      width: 100%;
      max-height: 330px;
      object-fit: contain;
      border: 1px solid #d9e2ea;
      border-radius: 6px;
      background: #03040a;
    }
    figcaption { margin-top: 4px; color: #526171; font-size: 9px; text-align: center; }
  </style>
</head>
<body>
  <section class="cover">
    <h1>Event Horizon Iteration 02 Report</h1>
    <p>Mobile input, clarity, onboarding, and game feel pass.</p>
  </section>
  <section>
    <h2>Screenshots</h2>
    <div class="gallery">${images.join('')}</div>
  </section>
  ${markdownToHtml(markdown)}
</body>
</html>`;
}

function markdownToHtml(markdown) {
  const lines = markdown.split('\n');
  const html = [];
  let inCode = false;
  let codeLines = [];
  let listOpen = false;

  for (const line of lines) {
    if (line.startsWith('```')) {
      if (inCode) {
        html.push(`<pre>${escapeHtml(codeLines.join('\n'))}</pre>`);
        codeLines = [];
      }
      inCode = !inCode;
      continue;
    }

    if (inCode) {
      codeLines.push(line);
      continue;
    }

    if (line.startsWith('- ')) {
      if (!listOpen) {
        html.push('<ul>');
        listOpen = true;
      }
      html.push(`<li>${inlineMarkdown(line.slice(2))}</li>`);
      continue;
    }

    if (listOpen) {
      html.push('</ul>');
      listOpen = false;
    }

    if (line.startsWith('# ')) {
      html.push(`<h1>${inlineMarkdown(line.slice(2))}</h1>`);
    } else if (line.startsWith('## ')) {
      html.push(`<h2>${inlineMarkdown(line.slice(3))}</h2>`);
    } else if (line.startsWith('### ')) {
      html.push(`<h3>${inlineMarkdown(line.slice(4))}</h3>`);
    } else if (/^\d+\.\s/.test(line)) {
      html.push(`<p>${inlineMarkdown(line)}</p>`);
    } else if (line.trim()) {
      html.push(`<p>${inlineMarkdown(line)}</p>`);
    }
  }

  if (listOpen) {
    html.push('</ul>');
  }
  return html.join('\n');
}

function inlineMarkdown(value) {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function git(args) {
  try {
    return execFileSync('git', args, {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 16
    });
  } catch {
    return '';
  }
}

function lines(value) {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function isTextSource(file) {
  if (file.startsWith('docs/artifacts/') || file.endsWith('.pdf')) {
    return false;
  }
  return ['.css', '.html', '.js', '.json', '.md', '.mjs', '.ts', '.tsx', '.yml'].includes(extname(file));
}

function languageFor(file) {
  const extension = extname(file);
  if (extension === '.ts') {
    return 'ts';
  }
  if (extension === '.mjs' || extension === '.js') {
    return 'js';
  }
  if (extension === '.css') {
    return 'css';
  }
  if (extension === '.html') {
    return 'html';
  }
  if (extension === '.json') {
    return 'json';
  }
  if (extension === '.yml') {
    return 'yaml';
  }
  return 'text';
}
