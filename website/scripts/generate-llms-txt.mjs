/**
 * Generates llms.txt, llms-full.txt, and copies raw .md files into dist/.
 * Run after `astro build`.
 */

import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, copyFileSync } from 'fs';
import { join, relative, dirname } from 'path';

const DOCS_DIR = new URL('../src/content/docs', import.meta.url).pathname;
const DIST_DIR = new URL('../dist', import.meta.url).pathname;
const SITE_URL = 'https://polycss.com';

function walkDir(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      files.push(...walkDir(fullPath));
    } else if (entry.endsWith('.md') || entry.endsWith('.mdx')) {
      files.push(fullPath);
    }
  }
  return files;
}

function extractFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const fm = {};
  for (const line of match[1].split('\n')) {
    const [key, ...rest] = line.split(':');
    if (key && rest.length) {
      fm[key.trim()] = rest.join(':').trim();
    }
  }
  return fm;
}

function getSlug(filePath) {
  let slug = relative(DOCS_DIR, filePath)
    .replace(/\.mdx?$/, '')
    .replace(/\/index$/, '');
  if (slug === 'index') slug = '';
  return slug;
}

const files = walkDir(DOCS_DIR).sort();

const docsOutDir = join(DIST_DIR, 'docs');
for (const file of files) {
  const slug = getSlug(file);
  if (!slug) continue;
  const outPath = join(docsOutDir, `${slug}.md`);
  mkdirSync(dirname(outPath), { recursive: true });
  copyFileSync(file, outPath);
}

const indexLines = [
  '# Polycss',
  '',
  '> A CSS polygon mesh engine. DOM-native 3D rendering. MIT licensed.',
  '',
  '## Documentation',
  '',
];

for (const file of files) {
  const content = readFileSync(file, 'utf8');
  const fm = extractFrontmatter(content);
  const slug = getSlug(file);
  if (!slug) continue;
  const url = `${SITE_URL}/docs/${slug}.md`;
  const title = fm.title || slug;
  indexLines.push(`- [${title}](${url})`);
}

indexLines.push('', '## Source', '', '- GitHub: https://github.com/LayoutitStudio/polycss', '- License: MIT', '');

writeFileSync(join(DIST_DIR, 'llms.txt'), indexLines.join('\n'));

const fullLines = [
  '# Polycss -- Full Documentation',
  '',
  '> A CSS polygon mesh engine. DOM-native 3D rendering.',
  '',
];

for (const file of files) {
  const content = readFileSync(file, 'utf8');
  const fm = extractFrontmatter(content);
  const body = content.replace(/^---\n[\s\S]*?\n---\n*/, '');
  const title = fm.title || getSlug(file) || 'Home';

  fullLines.push(`---`, '', `# ${title}`, '', body.trim(), '', '');
}

writeFileSync(join(DIST_DIR, 'llms-full.txt'), fullLines.join('\n'));

console.log(`Generated llms.txt (${files.length} pages), llms-full.txt, and raw .md files in docs/`);
