import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const checker = path.join(import.meta.dirname, 'architecture.mjs');
test('architecture gate rejects new boundary, folder, inline-style and theme violations', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'glyphcss-architecture-'));
  const write = (file, text) => { const dest = path.join(root, file); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, text); };
  const check = () => spawnSync(process.execPath, [checker, root], { encoding: 'utf8' });
  try {
    write('components/Control/Control.tsx', 'export function Control() { return <button>Pick</button>; }');
    write('components/Control/index.ts', 'export { Control } from "./Control";');
    write('components/Control/Child/Child.tsx', 'export function Child() { return <button>Pick</button>; }');
    write('components/Control/Child/index.ts', 'export { Child } from "./Child";');
    assert.equal(check().status, 0);
    for (const [file, source, message] of [
      ['features/chart.ts', 'import { Control } from "../components/Control/Control";', /Lower layers cannot depend/],
      ['components/Control/Control.module.css', '.root { color: #abcdef; }', /Use a color token/],
      ['components/Control/Child.tsx', 'export const child = <div style={{ padding: 12 }} />;', /Static inline padding/],
      ['components/Control/Child.tsx', 'export const child = <select><option>Pick</option></select>;', /Use BracketSelect/],
      ['components/Control/Consumer.tsx', 'import { Child } from "./Child/Child";', /Import Child through its public index/],
      ['components/Control/View.astro', '<div>UI</div>', /Reusable UI belongs in TSX/],
      ['components/Control/index.ts', 'export * from "./Control";', /explicit exports only/],
      ['pages/example.astro', '---\nimport { Control } from "../components/Control/Control";\n---\n<Control />', /through its public index/],
      ['pages/example.astro', '<style>body { color: red; }</style>', /styles belong to a component CSS Module/],
    ]) {
      write(file, source);
      const result = check();
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stderr, message);
      fs.rmSync(path.join(root, file));
      write('components/Control/index.ts', 'export { Control } from "./Control";');
    }
    write('utils/a.ts', 'import { b } from "./b"; export const a = () => b();');
    write('utils/b.ts', 'import { a } from "./a"; export const b = () => a();');
    assert.match(check().stderr, /Runtime import cycle/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
