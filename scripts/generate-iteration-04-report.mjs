import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { chromium } from '@playwright/test';

const repoRoot = new URL('../', import.meta.url);
const docsDir = new URL('../docs/', import.meta.url);
const artifactsDir = new URL('artifacts/', docsDir);
const reportPath = new URL('iteration-04-report.md', docsDir);
const pdfPath = new URL('iteration-04-report.pdf', docsDir);
const testResultsPath = new URL('artifacts/iteration-04-test-results.txt', docsDir);
const baseRef = process.env.REPORT_BASE_REF ?? 'origin/main';
const screenshots = [
  ['Help and tutorial entry', 'iteration-04-help-mobile.jpg'],
  ['Swipe-chain tutorial', 'iteration-04-tutorial-swipe-chain-mobile.jpg'],
  ['Node tap strategy', 'iteration-04-node-tap-strategy-mobile.jpg'],
  ['Pulse running', 'iteration-04-pulse-running-mobile.jpg'],
  ['Horizon Lens rescue', 'iteration-04-horizon-lens-mobile.jpg'],
  ['Dead-end fix prompt', 'iteration-04-dead-end-fix-mobile.jpg'],
  ['End screen', 'iteration-04-end-screen-mobile.jpg']
];

await mkdir(docsDir, { recursive: true });

const changedFiles = await collectChangedFiles();
const sourceFiles = changedFiles.filter((file) => isTextSource(file));
const binaryFiles = changedFiles.filter((file) => !isTextSource(file));
const testResults = existsSync(testResultsPath)
  ? await readFile(testResultsPath, 'utf8')
  : 'Test result log was not present when this report was generated.';
const diffStat = git(['diff', '--stat', `${baseRef}...HEAD`]) || git(['diff', '--stat']);
const trackedDiff = [git(['diff', '--cached', '--no-ext-diff', '--unified=2']), git(['diff', '--no-ext-diff', '--unified=2'])]
  .filter(Boolean)
  .join('\n');

const markdown = await buildMarkdown(sourceFiles, binaryFiles, testResults, diffStat, trackedDiff);
await writeFile(reportPath, markdown);

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();
await page.setContent(await buildHtml(markdown, sourceFiles), { waitUntil: 'load' });
await page.pdf({
  path: pdfPath.pathname,
  format: 'Letter',
  printBackground: true,
  preferCSSPageSize: true,
  margin: { top: '0.42in', right: '0.38in', bottom: '0.42in', left: '0.38in' }
});
await browser.close();

const size = await stat(pdfPath);
console.log('Wrote docs/iteration-04-report.md');
console.log(`Wrote docs/iteration-04-report.pdf (${Math.round(size.size / 1024)} KiB)`);

async function collectChangedFiles() {
  const names = new Set([
    ...lines(git(['diff', `${baseRef}...HEAD`, '--name-only'])),
    ...lines(git(['diff', '--cached', '--name-only'])),
    ...lines(git(['diff', '--name-only'])),
    ...lines(git(['ls-files', '--others', '--exclude-standard']))
  ]);
  names.delete('docs/iteration-04-report.md');
  names.delete('docs/iteration-04-report.pdf');
  return [...names].sort();
}

async function buildMarkdown(sourceFiles, binaryFiles, testResults, diffStat, trackedDiff) {
  const sourceBlocks = [];
  for (const file of sourceFiles) {
    const content = await readFile(new URL(file, repoRoot), 'utf8');
    sourceBlocks.push(`### ${file}\n\n\`\`\`${languageFor(file)}\n${content.replaceAll('```', '`\\`\\`')}\n\`\`\``);
  }

  return `# Event Horizon Iteration 04 Report

## Summary

Iteration 04 focuses on playability. The core grammar is now visible and teachable: swipe through nodes to draw a chain, tap nodes to tune strategy, press Play, tap the pulse's next node to stabilize it, and swipe a Horizon Lens bridge to rescue the run.

## Diagnosis Of Iteration 03 Confusion

Iteration 03 introduced the Pulse Chain pivot, but it still asked players to infer too much. Link placement was possible, but the first move was not obvious, node types were mostly color-coded, tap had little strategic meaning, and failure did not explain what to fix. Iteration 04 turns those missing ideas into tutorial steps and direct feedback.

## New Tap/Swipe/Strategy Grammar

- Build: swipe through several nodes to create a directional chain automatically.
- Build: tap one node, then another node to create a precise link.
- Build: tap selected special nodes to prime Energy, cycle Delay timing, or aim Splitters.
- Run: tap the next node shortly before pulse arrival to stabilize it for score and dark-energy gain.
- Rescue: swipe between two nodes during playback to create a temporary Horizon Lens bridge.
- Strategy: hit Energy nodes, use Delay timing, branch with Splitters, avoid dead ends, and build loops.

## Exact Files Changed

${[...sourceFiles, ...binaryFiles].map((file) => `- ${file}`).join('\n')}

## Diff Summary

\`\`\`text
${(diffStat || 'No diff stat was available.').trim()}
\`\`\`

## Tests Run And Results

\`\`\`text
${testResults.trim()}
\`\`\`

## Screenshots

${screenshots.map(([, file]) => `- docs/artifacts/${file}`).join('\n')}

## Known Limitations

- Playwright mobile simulation passed; no physical phone was manually tested in this run.
- Tutorial is intentionally hand-tuned for \`tutorial-001\`; future seeds still use simple generated layouts.
- Horizon Lens is still implemented as a temporary bridge, not freeform pulse deflection.
- Splitter aiming is useful and visible, but the strategy model can still be tuned further with player testing.
- Sound, haptics, and richer retry analytics remain future work.

## Next Recommended Iteration

- Test on real iPhone and Android hardware and tune touch radii and tutorial timing.
- Add audio/haptic feedback for chain creation, stabilization, lens creation, and dead ends.
- Add a replay viewer that visually replays chain swipes, taps, and Horizon Lens inputs.
- Add a small “why this chain is good” animation after successful loops.

## Full Diffs For Tracked Changes

\`\`\`diff
${trackedDiff.trim() || 'No tracked working-tree diff was present. Untracked files are included in full-source sections below.'}
\`\`\`

## Full Source Code For Changed Text Files

${sourceBlocks.join('\n\n')}
`;
}

async function buildHtml(markdown, sourceFiles) {
  const images = await Promise.all(screenshots.map(async ([label, file]) => {
    const url = new URL(file, artifactsDir);
    if (!existsSync(url)) {
      return '';
    }
    const bytes = await readFile(url);
    return `<figure><img src="data:image/jpeg;base64,${bytes.toString('base64')}" alt="${escapeHtml(label)}" /><figcaption>${escapeHtml(label)}</figcaption></figure>`;
  }));

  return `<!doctype html>
<html lang="en-US">
<head>
  <meta charset="utf-8" />
  <title>Event Horizon Iteration 04 Report</title>
  <style>
    @page { size: Letter; margin: 0.42in 0.38in; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #15202b; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 10px; line-height: 1.34; }
    h1, h2, h3 { color: #07111f; line-height: 1.12; margin: 0.58rem 0 0.28rem; break-after: avoid; page-break-after: avoid; }
    h1 { font-size: 21px; border-bottom: 2px solid #2f7ea1; padding-bottom: 7px; }
    h2 { font-size: 14.5px; }
    h3 { font-size: 11px; }
    p { margin: 0 0 0.4rem; }
    ul, ol { margin: 0 0 0.5rem 1.08rem; padding: 0; }
    li { margin: 0.08rem 0; }
    code { font-family: "SFMono-Regular", Menlo, Consolas, monospace; font-size: 7.8px; }
    pre { margin: 0.32rem 0 0.62rem; padding: 7px; white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; background: #f3f6f9; border: 1px solid #d9e2ea; border-radius: 5px; font-family: "SFMono-Regular", Menlo, Consolas, monospace; font-size: 6.2px; line-height: 1.18; break-inside: auto; page-break-inside: auto; }
    .cover { background: #07111f; color: #eef9ff; border-radius: 8px; padding: 17px; margin-bottom: 11px; break-inside: avoid; }
    .cover h1 { color: #fff; border-color: #80e3ff; margin-top: 0; }
    .cover p { color: #cbeaf4; margin-bottom: 0; }
    .gallery { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 8px 0 12px; break-inside: avoid; }
    figure { margin: 0; break-inside: avoid; }
    img { display: block; width: 100%; max-height: 220px; object-fit: contain; border: 1px solid #d9e2ea; border-radius: 6px; background: #03040a; }
    figcaption { margin-top: 3px; color: #526171; font-size: 8.4px; text-align: center; }
    .source-index { columns: 2; column-gap: 22px; }
  </style>
</head>
<body>
  <section class="cover"><h1>Event Horizon Iteration 04 Report</h1><p>Playability, tutorial clarity, and tap/swipe/strategy grammar.</p></section>
  <section><h2>Screenshots</h2><div class="gallery">${images.join('')}</div></section>
  <section><h2>Changed Source Index</h2><ul class="source-index">${sourceFiles.map((file) => `<li>${escapeHtml(file)}</li>`).join('')}</ul></section>
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
    return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 1024 * 1024 * 32 });
  } catch {
    return '';
  }
}

function lines(value) {
  return value.split('\n').map((line) => line.trim()).filter(Boolean);
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
