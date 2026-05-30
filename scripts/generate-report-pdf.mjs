import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const repoRoot = new URL('../', import.meta.url);
const docsDir = new URL('../docs/', import.meta.url);
const reportPath = new URL('first-pr-report.md', docsDir);
const pdfPath = new URL('first-pr-report.pdf', docsDir);
const baseRef = process.env.REPORT_BASE_REF ?? 'origin/main';

const reportMarkdown = await readFile(reportPath, 'utf8');
const diffStat = git(['diff', `${baseRef}...HEAD`, '--stat']);
const nameStatus = [
  git(['diff', `${baseRef}...HEAD`, '--name-status']),
  git(['diff', '--cached', '--name-status']),
  git(['diff', '--name-status'])
]
  .join('\n')
  .trim();
const diffExcerpt = [
  git(['diff', `${baseRef}...HEAD`, '--', 'src/game/Simulation.ts', 'src/game/EventHorizonGame.ts']),
  git(['diff', `${baseRef}...HEAD`, '--', 'src/game/FixedStepLoop.ts', 'src/game/rng.ts']),
  git(['diff', `${baseRef}...HEAD`, '--', 'netlify/functions/score-submit.mjs', 'gas/score-submit.gs'])
]
  .join('\n')
  .slice(0, 28000);

await mkdir(docsDir, { recursive: true });

const html = await buildHtml();
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();
await page.setContent(html, { waitUntil: 'load' });
await page.pdf({
  path: pdfPath.pathname,
  format: 'Letter',
  printBackground: true,
  margin: {
    top: '0.55in',
    right: '0.5in',
    bottom: '0.55in',
    left: '0.5in'
  }
});
await browser.close();

const size = await stat(pdfPath);
console.log(`Wrote docs/first-pr-report.pdf (${Math.round(size.size / 1024)} KiB)`);

async function buildHtml() {
  const images = await Promise.all(
    [
      ['Gameplay mobile screenshot', new URL('artifacts/gameplay-mobile.jpg', docsDir)],
      ['Three-frame share poster', new URL('artifacts/share-poster.jpg', docsDir)],
      ['Collapse mobile screenshot', new URL('artifacts/collapse-mobile.jpg', docsDir)]
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
  <title>Event Horizon First PR Report</title>
  <style>
    @page { size: Letter; margin: 0.55in 0.5in; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: #15202b;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 11px;
      line-height: 1.38;
    }
    h1, h2, h3 { color: #07111f; line-height: 1.12; margin: 0.55rem 0 0.28rem; }
    h1 { font-size: 22px; border-bottom: 2px solid #2f7ea1; padding-bottom: 7px; }
    h2 { font-size: 15px; break-after: avoid; }
    h3 { font-size: 12px; }
    p { margin: 0 0 0.42rem; }
    ul, ol { margin: 0 0 0.5rem 1.1rem; padding: 0; }
    li { margin: 0.08rem 0; }
    code { font-family: "SFMono-Regular", Menlo, Consolas, monospace; font-size: 9px; }
    pre {
      margin: 0.35rem 0 0.65rem;
      padding: 8px;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      background: #f3f6f9;
      border: 1px solid #d9e2ea;
      border-radius: 5px;
      font-family: "SFMono-Regular", Menlo, Consolas, monospace;
      font-size: 7.4px;
      line-height: 1.25;
    }
    a { color: #0b6f9f; text-decoration: none; }
    .cover {
      background: #07111f;
      color: #eef9ff;
      border-radius: 8px;
      padding: 18px;
      margin-bottom: 14px;
    }
    .cover h1 { color: #fff; border-color: #80e3ff; margin-top: 0; }
    .cover p { color: #cbeaf4; margin-bottom: 0; }
    .section { break-inside: avoid; }
    .gallery {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 10px;
      margin: 8px 0 12px;
    }
    figure { margin: 0; break-inside: avoid; }
    img {
      display: block;
      width: 100%;
      max-height: 290px;
      object-fit: contain;
      border: 1px solid #d9e2ea;
      border-radius: 6px;
      background: #03040a;
    }
    figcaption { margin-top: 4px; color: #526171; font-size: 9px; text-align: center; }
    .page-break { break-before: page; }
  </style>
</head>
<body>
  <section class="cover">
    <h1>Event Horizon First PR Report</h1>
    <p>Generated from the repository report source, current screenshots, tests, and PR diff.</p>
  </section>
  ${markdownToHtml(reportMarkdown)}
  <section class="page-break">
    <h2>Screenshots and Poster</h2>
    <div class="gallery">${images.join('')}</div>
  </section>
  <section>
    <h2>Changed Files From ${escapeHtml(baseRef)}</h2>
    <pre>${escapeHtml(nameStatus || 'No changed files found.')}</pre>
  </section>
  <section>
    <h2>Diff Stat</h2>
    <pre>${escapeHtml(diffStat || 'No diff stat available.')}</pre>
  </section>
  <section>
    <h2>Representative Diff Excerpt</h2>
    <pre>${escapeHtml(diffExcerpt || 'No text diff available.')}</pre>
  </section>
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
      maxBuffer: 1024 * 1024 * 12
    });
  } catch (error) {
    return `git output unavailable: ${error.message}`;
  }
}
