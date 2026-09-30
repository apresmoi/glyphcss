import fs from 'node:fs/promises';
import path from 'node:path';
import * as prettier from 'prettier';
import * as astroPlugin from 'prettier-plugin-astro';
const root = path.resolve(import.meta.dirname, '../../src');
async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => entry.isDirectory() ? walk(path.join(dir, entry.name)) : path.join(dir, entry.name)))).flat();
}
const write = process.argv.includes('--write');
const files = (await walk(root)).filter(file => /\.(tsx?|astro|css)$/.test(file) && !/\.test\.|\/test\//.test(file));
let failures = 0;
for (const file of files) {
  const source = await fs.readFile(file, 'utf8');
  const formatted = await prettier.format(source, { filepath: file, printWidth: 120, plugins: [astroPlugin] });
  if (source === formatted) continue;
  if (write) await fs.writeFile(file, formatted);
  else { console.error(path.relative(root, file)); failures++; }
}
if (failures) process.exitCode = 1;
else console.log(`Website source formatting ${write ? 'applied' : 'checked'} (${files.length} files).`);
