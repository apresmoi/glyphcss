// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { compileScene, createGlyphCamera } from 'glyphcss';
import { cubePolygons, gridSurfacePolygons } from '@glyphcss/core';
import { mountGlyphDemo } from '../../services/glyph-scene/mountGlyphDemo';

const guide = (name: string) => readFileSync(resolve(`src/content/docs/guides/${name}.mdx`), 'utf8');
const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.splice(0).forEach(dispose => dispose());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

it('keeps all eight guides example-led with collapsed demo code and valid metadata', () => {
  for (const name of ['compile', 'density', 'render-modes', 'color-encoding', 'performance', 'creating-shapes', 'meshes', 'hit-layer']) {
    const source = guide(name);
    expect(source.indexOf('<GlyphDemo'), name).toBeLessThan(source.indexOf('\n## '));
    expect(source, name).not.toMatch(/\bnoCode\b/);
    expect(source.match(/^description: (.+)$/m)![1]!.length, name).toBeGreaterThanOrEqual(120);
    expect(source.match(/^description: (.+)$/m)![1]!.length, name).toBeLessThanOrEqual(160);
  }
});

it('executes the documented static frame and procedural surface APIs', () => {
  const compile = guide('compile').match(/```ts\n([\s\S]*?)\n```/)![1]!.replace(/^import .*;\n/gm, '');
  const html = new Function('compileScene', 'createGlyphCamera', 'cubePolygons', `${compile}\nreturn html;`)(compileScene, createGlyphCamera, cubePolygons);
  expect(html).toContain('<pre');
  expect(html.replace(/<[^>]*>/g, '').trim()).not.toBe('');
  const surface = guide('creating-shapes').match(/```ts\nimport \{ gridSurfacePolygons \}[^\n]*\n([\s\S]*?)\n```/)![1]!;
  const polygons = new Function('gridSurfacePolygons', `${surface}\nreturn waves;`)(gridSurfacePolygons);
  expect(polygons.length).toBeGreaterThan(0);
  expect(polygons.flatMap((polygon: { vertices: number[][] }) => polygon.vertices).flat().every(Number.isFinite)).toBe(true);
});

it('loads the actual gallery apple through the real runtime and fills a docs frame', async () => {
  const demo = guide('meshes').match(/<GlyphDemo\b[\s\S]*?\/>/)![0]!;
  const url = demo.match(/mesh="([^"]+)"/)![1]!;
  const data = readFileSync(resolve(`public${url}`));
  vi.stubGlobal('fetch', vi.fn(async () => new Response(data)));
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return this.style.visibility === 'hidden' ? new DOMRect(0, 0, 6, 200) : new DOMRect(0, 0, 400, 320);
  });
  const host = document.createElement('div');
  host.setAttribute('data-mesh', url);
  host.setAttribute('data-defaults', demo.match(/defaults='([^']+)'/)![1]!);
  host.setAttribute('data-no-hotspots', '1');
  host.innerHTML = '<div class="glyph-demo__scene-host"></div><div class="glyph-demo__loading"></div><div class="glyph-demo__stats"></div>';
  const sceneHost = host.querySelector('.glyph-demo__scene-host')!;
  Object.defineProperties(sceneHost, { clientWidth: { value: 400 }, clientHeight: { value: 320 } });
  document.body.append(host);
  const changed = vi.fn();
  cleanups.push(mountGlyphDemo(host, { onReady: () => {}, onChange: changed })!);
  await vi.waitFor(() => expect(changed).toHaveBeenCalled(), { timeout: 5000 });
  expect(fetch).toHaveBeenCalledWith(url);
  const rows = host.querySelector('pre.glyph-output')!.textContent!.split('\n');
  const painted = rows.flatMap((line, row) => Array.from(line).flatMap((char, col) => char.trim() ? [{ row, col }] : []));
  expect(painted.length).toBeGreaterThan(100);
  const width = Math.max(...painted.map(cell => cell.col)) - Math.min(...painted.map(cell => cell.col)) + 1;
  const height = Math.max(...painted.map(cell => cell.row)) - Math.min(...painted.map(cell => cell.row)) + 1;
  expect(Math.max(width / rows[0]!.length, height / rows.length)).toBeGreaterThan(0.65);
  expect(host.querySelector<HTMLElement>('.glyph-demo__loading')!.style.display).toBe('none');
});
