import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import PDFDocument from 'pdfkit';

const repoRoot = new URL('../', import.meta.url);
const docsDir = new URL('../docs/', import.meta.url);
const reportPath = new URL('first-pr-report.md', docsDir);
const pdfPath = new URL('first-pr-report.pdf', docsDir);
const artifacts = [
  new URL('artifacts/gameplay-mobile.jpg', docsDir),
  new URL('artifacts/share-poster.jpg', docsDir),
  new URL('artifacts/collapse-mobile.jpg', docsDir)
];

await mkdir(docsDir, { recursive: true });

const markdown = await readFile(reportPath, 'utf8');
const diffStat = runGit(['diff', 'HEAD', '--stat', '--', '.', ':(exclude)docs/first-pr-report.pdf']);
const diffTextRaw = runGit([
  'diff',
  'HEAD',
  '--',
  '.',
  ':(exclude)package-lock.json',
  ':(exclude)docs/artifacts/*.jpg',
  ':(exclude)docs/first-pr-report.pdf'
]);
const maxDiffChars = 8000;
const diffText =
  diffTextRaw.length > maxDiffChars
    ? `${diffTextRaw.slice(0, maxDiffChars)}\n\n[Diff truncated for PDF practicality. package-lock and binary images are represented in the stat above.]\n`
    : diffTextRaw;

const doc = new PDFDocument({
  autoFirstPage: false,
  bufferPages: true,
  compress: true,
  margins: { top: 48, right: 48, bottom: 54, left: 48 },
  size: 'LETTER'
});

const chunks = [];
doc.on('data', (chunk) => chunks.push(chunk));

addPage(doc);
doc.font('Helvetica-Bold').fontSize(20).text('Event Horizon First PR Report');
doc.moveDown(0.4);
doc.font('Helvetica').fontSize(9).fillColor('#444').text(`Generated: ${new Date().toISOString()}`);
doc.moveDown(1);

writeMarkdown(doc, markdown);
addScreenshots(doc);
addDiffSection(doc, diffStat, diffText);
addPageNumbers(doc);

doc.end();
const pdfBuffer = await new Promise((resolve) => {
  doc.on('end', () => resolve(Buffer.concat(chunks)));
});
await writeFile(pdfPath, pdfBuffer);
const size = await stat(pdfPath);
console.log(`Wrote docs/first-pr-report.pdf (${Math.round(size.size / 1024)} KiB)`);

function runGit(args) {
  try {
    return execFileSync('git', args, {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 8
    });
  } catch (error) {
    return `Unable to collect git output: ${error.message}\n`;
  }
}

function addPage(document) {
  document.addPage();
  document.fillColor('#111');
}

function writeMarkdown(document, source) {
  const lines = source.split('\n');
  let inCode = false;
  for (const line of lines) {
    if (line.startsWith('```')) {
      inCode = !inCode;
      document.moveDown(0.15);
      continue;
    }

    if (line.startsWith('# ')) {
      ensureRoom(document, 44);
      document.moveDown(0.6);
      document.font('Helvetica-Bold').fontSize(16).fillColor('#111').text(line.replace(/^# /, ''));
      document.moveDown(0.3);
    } else if (line.startsWith('## ')) {
      ensureRoom(document, 38);
      document.moveDown(0.4);
      document.font('Helvetica-Bold').fontSize(13).fillColor('#111').text(line.replace(/^## /, ''));
      document.moveDown(0.2);
    } else if (line.startsWith('### ')) {
      ensureRoom(document, 32);
      document.font('Helvetica-Bold').fontSize(11).fillColor('#111').text(line.replace(/^### /, ''));
    } else if (inCode) {
      ensureRoom(document, 18);
      document.font('Courier').fontSize(7.2).fillColor('#222').text(line || ' ', {
        lineGap: 1
      });
    } else if (line.trim().length === 0) {
      document.moveDown(0.35);
    } else {
      ensureRoom(document, 20);
      document.font(line.startsWith('- ') || /^\d+\./.test(line) ? 'Helvetica' : 'Helvetica').fontSize(8.7).fillColor('#222').text(line, {
        lineGap: 2
      });
    }
  }
}

function addScreenshots(document) {
  addPage(document);
  document.font('Helvetica-Bold').fontSize(16).fillColor('#111').text('Screenshots and Poster');
  document.moveDown(0.5);
  const labels = ['Gameplay mobile screenshot', 'Three-frame share poster', 'Collapse mobile screenshot'];
  for (let index = 0; index < artifacts.length; index += 1) {
    const image = artifacts[index];
    if (!existsSync(image)) {
      continue;
    }
    ensureRoom(document, 250);
    document.font('Helvetica-Bold').fontSize(10).text(labels[index]);
    document.moveDown(0.2);
    document.image(image.pathname, {
      fit: index === 1 ? [160, 230] : [130, 230],
      align: 'center'
    });
    document.moveDown(0.7);
  }
}

function addDiffSection(document, statText, fullDiff) {
  addPage(document);
  document.font('Helvetica-Bold').fontSize(16).fillColor('#111').text('File Diffs');
  document.moveDown(0.5);
  document.font('Helvetica-Bold').fontSize(11).text('Diff Stat');
  document.moveDown(0.2);
  writePre(document, statText || 'No diff stat available.');
  document.moveDown(0.7);
  document.font('Helvetica-Bold').fontSize(11).text('Unified Diff');
  document.moveDown(0.2);
  writePre(document, fullDiff || 'No text diff available.');
}

function writePre(document, text) {
  for (const line of text.split('\n')) {
    ensureRoom(document, 14);
    document.font('Courier').fontSize(6.5).fillColor('#222').text(line || ' ', {
      lineGap: 0.5
    });
  }
}

function ensureRoom(document, height) {
  if (document.y + height > document.page.height - document.page.margins.bottom) {
    addPage(document);
  }
}

function addPageNumbers(document) {
  const range = document.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    document.switchToPage(index);
    document.font('Helvetica').fontSize(8).fillColor('#666').text(`Event Horizon first PR report  •  ${index + 1}`, 48, 744, {
      align: 'center',
      width: 516
    });
  }
}
