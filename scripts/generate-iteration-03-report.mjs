import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { chromium } from '@playwright/test';

const repoRoot = new URL('../', import.meta.url);
const docsDir = new URL('../docs/', import.meta.url);
const artifactsDir = new URL('artifacts/', docsDir);
const reportPath = new URL('iteration-03-report.md', docsDir);
const pdfPath = new URL('iteration-03-report.pdf', docsDir);
const testResultsPath = new URL('artifacts/iteration-03-test-results.txt', docsDir);
const baseRef = process.env.REPORT_BASE_REF ?? 'origin/main';
const screenshotFiles = [
  ['Help overlay', 'iteration-03-help-mobile.jpg'],
  ['Build phase', 'iteration-03-build-phase-mobile.jpg'],
  ['Link placement', 'iteration-03-link-placement-mobile.jpg'],
  ['Pulse running', 'iteration-03-pulse-running-mobile.jpg'],
  ['Horizon Lens bridge', 'iteration-03-horizon-lens-mobile.jpg'],
  ['End screen', 'iteration-03-end-screen-mobile.jpg']
];

await mkdir(docsDir, { recursive: true });

const changedFiles = await collectChangedFiles();
const sourceFiles = changedFiles.filter((file) => isTextSource(file));
const binaryFiles = changedFiles.filter((file) => !isTextSource(file));
const testResults = existsSync(testResultsPath)
  ? await readFile(testResultsPath, 'utf8')
  : 'Test result log was not present when this report was generated.';
const diffStat = git(['diff', '--stat', `${baseRef}...HEAD`]) || git(['diff', '--stat']);
const currentDiff = git(['diff', '--no-ext-diff', '--unified=2']);
const stagedDiff = git(['diff', '--cached', '--no-ext-diff', '--unified=2']);

const markdown = await buildMarkdown({
  sourceFiles,
  binaryFiles,
  testResults,
  diffStat,
  diffs: [stagedDiff, currentDiff].filter(Boolean).join('\n')
});
await writeFile(reportPath, markdown);

const html = await buildHtml(markdown, sourceFiles);
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();
await page.setContent(html, { waitUntil: 'load' });
await page.pdf({
  path: pdfPath.pathname,
  format: 'Letter',
  printBackground: true,
  preferCSSPageSize: true,
  margin: {
    top: '0.42in',
    right: '0.38in',
    bottom: '0.42in',
    left: '0.38in'
  }
});
await browser.close();

const size = await stat(pdfPath);
console.log('Wrote docs/iteration-03-report.md');
console.log(`Wrote docs/iteration-03-report.pdf (${Math.round(size.size / 1024)} KiB)`);

async function collectChangedFiles() {
  const names = new Set([
    ...lines(git(['diff', `${baseRef}...HEAD`, '--name-only'])),
    ...lines(git(['diff', '--cached', '--name-only'])),
    ...lines(git(['diff', '--name-only'])),
    ...lines(git(['ls-files', '--others', '--exclude-standard']))
  ]);
  names.delete('docs/iteration-03-report.md');
  names.delete('docs/iteration-03-report.pdf');
  return [...names].sort();
}

async function buildMarkdown({ sourceFiles, binaryFiles, testResults, diffStat, diffs }) {
  const sourceBlocks = [];
  for (const file of sourceFiles) {
    const content = await readFile(new URL(file, repoRoot), 'utf8');
    sourceBlocks.push(`### ${file}\n\n\`\`\`${languageFor(file)}\n${content.replaceAll('```', '`\\`\\`')}\n\`\`\``);
  }

  return `# Event Horizon Iteration 03 Report

## Summary Of Pivot

Iteration 03 pivots Event Horizon from tether-swiping survival into the default Pulse Chain mode: connect Dark Energy Nodes with Gravitational Links, press Play, watch a Stabilizing Pulse traverse the network, and rescue the run with short-lived Horizon Lens bridges during playback.

## Why The Old Loop Was Not Fun Enough

The earlier prototype improved mobile input, but its main action still felt like touching a moving target. It asked for precision during chaos before the player understood the plan. Pulse Chain moves the fun toward planning, payoff, readable cause and effect, and one live skill action that supports the puzzle instead of becoming the entire challenge.

## New Gameplay Explanation

- Build phase: tap-tap or drag from one node to another to place a directional Gravitational Link.
- Pulse phase: press Play to launch a Stabilizing Pulse from the Source Node.
- Scoring: Energy Nodes refill the Collapse Meter, long chains raise multipliers, Splitter Nodes branch pulses, and Delay Nodes hold timing.
- Rescue phase: swipe during playback to draw a Horizon Lens. If the swipe anchors near two valid nodes, it creates a temporary bridge.
- End state: reaching the score or survival target stabilizes the sector; empty energy collapses the galaxy.

## Exact Files Changed

${[...sourceFiles, ...binaryFiles].map((file) => `- ${file}`).join('\n')}

## Diff Summary

\`\`\`text
${(diffStat || 'No committed diff stat was available at report generation time.').trim()}
\`\`\`

## Tests Run And Results

\`\`\`text
${testResults.trim()}
\`\`\`

## Screenshots

${screenshotFiles.map(([, file]) => `- docs/artifacts/${file}`).join('\n')}

## Known Limitations

- Playwright mobile simulation passed; this run did not include hands-on testing on a physical phone.
- Horizon Lens uses the understandable temporary-link mechanic for this iteration, not full pulse deflection.
- When all pulses die, the run currently ends with accelerated collapse pressure represented as a pulse-died end reason; future tuning should return players to build/retry more gracefully.
- Node labels are visualized mostly through shape and color; richer in-canvas labels and sound are good next steps.
- GitHub Pages serves the static game only. Netlify Functions remain available only on Netlify or local Netlify dev.

## Next Recommended Iteration

- Tune the tutorial seed on a real iPhone and Android phone.
- Add sound, haptics, and stronger pulse arrival bursts.
- Add a retry flow that preserves the same seed and highlights the failed dead end.
- Build a replay viewer for the Pulse Chain payload.
- Add leaderboards or local seed challenge sharing once the loop feels sticky.

## Full Diffs For Tracked Changes

\`\`\`diff
${diffs.trim() || 'No tracked working-tree diff was present. Untracked files are included in full-source sections below.'}
\`\`\`

## Full Source Code For Changed Text Files

${sourceBlocks.join('\n\n')}
`;
}

async function buildHtml(markdown, sourceFiles) {
  const images = await Promise.all(
    screenshotFiles.map(async ([label, file]) => {
      const url = new URL(file, artifactsDir);
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
  <title>Event Horizon Iteration 03 Report</title>
  <style>
    @page { size: Letter; margin: 0.42in 0.38in; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: #15202b;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 10px;
      line-height: 1.34;
    }
    h1, h2, h3 {
      color: #07111f;
      line-height: 1.12;
      margin: 0.58rem 0 0.28rem;
      break-after: avoid;
      page-break-after: avoid;
    }
    h1 { font-size: 21px; border-bottom: 2px solid #2f7ea1; padding-bottom: 7px; }
    h2 { font-size: 14.5px; }
    h3 { font-size: 11px; }
    p { margin: 0 0 0.4rem; }
    ul, ol { margin: 0 0 0.5rem 1.08rem; padding: 0; }
    li { margin: 0.08rem 0; }
    code { font-family: "SFMono-Regular", Menlo, Consolas, monospace; font-size: 7.8px; }
    pre {
      margin: 0.32rem 0 0.62rem;
      padding: 7px;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      word-break: break-word;
      background: #f3f6f9;
      border: 1px solid #d9e2ea;
      border-radius: 5px;
      font-family: "SFMono-Regular", Menlo, Consolas, monospace;
      font-size: 6.2px;
      line-height: 1.18;
      break-inside: auto;
      page-break-inside: auto;
    }
    a { color: #0b6f9c; text-decoration: none; }
    .cover {
      background: #07111f;
      color: #eef9ff;
      border-radius: 8px;
      padding: 17px;
      margin-bottom: 11px;
      break-inside: avoid;
    }
    .cover h1 { color: #fff; border-color: #80e3ff; margin-top: 0; }
    .cover p { color: #cbeaf4; margin-bottom: 0; }
    .gallery {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
      margin: 8px 0 12px;
      break-inside: avoid;
    }
    figure { margin: 0; break-inside: avoid; }
    img {
      display: block;
      width: 100%;
      max-height: 235px;
      object-fit: contain;
      border: 1px solid #d9e2ea;
      border-radius: 6px;
      background: #03040a;
    }
    figcaption { margin-top: 3px; color: #526171; font-size: 8.4px; text-align: center; }
    .source-index { columns: 2; column-gap: 22px; }
  </style>
</head>
<body>
  <section class="cover">
    <h1>Event Horizon Iteration 03 Report</h1>
    <p>Pulse Chain pivot: planning, payoff, and Horizon Lens rescue play.</p>
  </section>
  <section>
    <h2>Screenshots</h2>
    <div class="gallery">${images.join('')}</div>
  </section>
  <section>
    <h2>Changed Source Index</h2>
    <ul class="source-index">${sourceFiles.map((file) => `<li>${escapeHtml(file)}</li>`).join('')}</ul>
  </section>
  ${markdownToHtml(markdown)}
</body>
</html>`;
}

function markdownToHtml(markdown) {
  const rows = markdown.split('\n');
  const html = [];
  let inCode = false;
  let codeLines = [];
  let listOpen = false;

  for (const row of rows) {
    if (row.startsWith('```')) {
      if (inCode) {
        html.push(`<pre>${escapeHtml(codeLines.join('\n'))}</pre>`);
        codeLines = [];
      }
      inCode = !inCode;
      continue;
    }

    if (inCode) {
      codeLines.push(row);
      continue;
    }

    if (row.startsWith('- ')) {
      if (!listOpen) {
        html.push('<ul>');
        listOpen = true;
      }
      html.push(`<li>${inlineMarkdown(row.slice(2))}</li>`);
      continue;
    }

    if (listOpen) {
      html.push('</ul>');
      listOpen = false;
    }

    if (row.startsWith('# ')) {
      html.push(`<h1>${inlineMarkdown(row.slice(2))}</h1>`);
    } else if (row.startsWith('## ')) {
      html.push(`<h2>${inlineMarkdown(row.slice(3))}</h2>`);
    } else if (row.startsWith('### ')) {
      html.push(`<h3>${inlineMarkdown(row.slice(4))}</h3>`);
    } else if (/^\d+\.\s/.test(row)) {
      html.push(`<p>${inlineMarkdown(row)}</p>`);
    } else if (row.trim()) {
      html.push(`<p>${inlineMarkdown(row)}</p>`);
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
      maxBuffer: 1024 * 1024 * 32
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
  return ['.css', '.html', '.js', '.json', '.md', '.mjs', '.ts', '.tsx', '.txt', '.yml'].includes(extname(file));
}

function languageFor(file) {
  const extension = extname(file);
  if (extension === '.ts' || extension === '.tsx') {
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
  if (extension === '.md') {
    return 'md';
  }
  return 'text';
}
