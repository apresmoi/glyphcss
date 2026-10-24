// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { mountGlyphDemo } from './mountGlyphDemo';
import type { Tunables } from './types';
import { loadMeshAsGeometry } from './geometry';
import { createGlyphScene } from 'glyphcss';

vi.mock('glyphcss', async importOriginal => {
  const original = await importOriginal<typeof import('glyphcss')>();
  return { ...original, createGlyphScene: vi.fn(original.createGlyphScene) };
});

vi.mock('./geometry', async importOriginal => {
  const original = await importOriginal<typeof import('./geometry')>();
  return { ...original, loadMeshAsGeometry: vi.fn() };
});
const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.splice(0).forEach(dispose => dispose());
  document.body.replaceChildren();
  vi.clearAllMocks();
});
function mount(mesh?: string, attributes: Record<string, string> = {}) {
  const host = document.createElement('div');
  host.setAttribute('data-no-hotspots', '1');
  if (mesh) host.setAttribute('data-mesh', mesh);
  for (const [key, value] of Object.entries(attributes)) host.setAttribute(key, value);
  host.innerHTML = '<div class="glyph-demo__scene-host"></div><div class="glyph-demo__loading"></div><div class="glyph-demo__stats"></div>';
  document.body.append(host);
  let update!: (partial: Partial<Tunables>) => void;
  const changes = vi.fn();
  const dispose = mountGlyphDemo(host, { onReady: fn => { update = fn; }, onChange: changes })!;
  cleanups.push(dispose);
  return { host, update, changes };
}
it('applies built-in geometry and camera edits through the docs adapter and publishes real fitted values', () => {
  const { host, update, changes } = mount();
  expect(changes).toHaveBeenCalled();
  update({ geometry: 'cube' });
  expect(changes.mock.calls.at(-1)![0].geometry).toBe('cube');
  update({ zoom: 2.5, rotX: 42, stretch: 1.2 });
  expect(changes.mock.calls.at(-1)![0]).toMatchObject({ geometry: 'cube', zoom: 2.5, rotX: 42, stretch: 1.2 });
  expect(host.querySelector('pre.glyph-output')!.textContent!.trim().length).toBeGreaterThan(0);
});
it('keeps loaded mesh polygons through docs camera and rendering changes', async () => {
  const triangle = { vertices: [[-10, 0, 0], [10, 0, 0], [0, 10, 0]] as [[number, number, number], [number, number, number], [number, number, number]], color: '#ffffff' };
  vi.mocked(loadMeshAsGeometry).mockResolvedValue({
    vertices: triangle.vertices,
    edges: [{ from: triangle.vertices[0], to: triangle.vertices[1] }],
    polygons: [triangle], animations: [], sample: () => [triangle],
  });
  const { host, update, changes } = mount('/apple.glb');
  await vi.waitFor(() => expect(changes).toHaveBeenCalled(), { timeout: 5000 });
  const handle = (host as HTMLElement & { glyphcssDemo: { getPolygons: () => unknown } }).glyphcssDemo;
  const polygons = handle.getPolygons();
  update({ zoom: 2.5 });
  update({ stretch: 1.2 });
  update({ renderMode: 'solid' });
  expect(handle.getPolygons()).toBe(polygons);
  expect(changes.mock.calls.at(-1)![0]).toMatchObject({ zoom: 2.5, stretch: 1.2, renderMode: 'solid' });
  expect(loadMeshAsGeometry).toHaveBeenCalledOnce();
});


it('forwards rendering controls to the real scene and changes its character output', async () => {
  const { host, update } = mount(undefined, { 'data-defaults': '{"colorEncoding":"spans","colorTolerance":24}' });
  const scene = vi.mocked(createGlyphScene).mock.results.at(-1)!.value;
  expect(scene.getOptions().colorTolerance).toBe(24);
  update({ charMode: 'braille', hiddenLines: 'hide', wireframeJunctions: true, colorTolerance: 64 });
  expect(scene.getOptions()).toMatchObject({ charMode: 'braille', hiddenLines: 'hide', wireframeJunctions: true, colorTolerance: 64 });
  expect(host.querySelector('pre.glyph-output')!.textContent).toMatch(/[\u2801-\u28ff]/);
  update({ colorEncoding: 'atlas' });
  expect(scene.getOptions().colorEncoding).toBe('atlas');
  update({ colorEncoding: 'spans' });
  expect(scene.getOptions().colorEncoding).toBe('spans');
});

it('mounts a selectable hotspot on the real hit layer and disposes it on unmount', () => {
  const { host, update } = mount(undefined, { 'data-docs-hotspot': '1', 'data-no-hotspots': '0' });
  const anchor = host.querySelector<HTMLElement>('[data-hotspot-id="anchor"]')!;
  const button = anchor.querySelector('button')!;
  expect(button.textContent).toBe('Select anchor');
  expect(button.getAttribute('aria-pressed')).toBe('false');
  const bubbled = vi.fn();
  host.addEventListener('pointerdown', bubbled);
  button.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  expect(bubbled).not.toHaveBeenCalled();
  button.click();
  expect(button.textContent).toBe('Selected');
  expect(button.getAttribute('aria-pressed')).toBe('true');
  update({ rotY: 30 });
  expect(host.querySelector('[data-hotspot-id="anchor"]')).toBe(anchor);
  update({ renderMode: 'ink' });
  const rebuilt = host.querySelector<HTMLButtonElement>('[data-hotspot-id="anchor"] button')!;
  expect(rebuilt.getAttribute('aria-pressed')).toBe('true');
  rebuilt.click();
  expect(rebuilt.textContent).toBe('Select anchor');
  cleanups.pop()!();
  expect(host.querySelector('[data-hotspot-id="anchor"]')).toBeNull();
  // Aborting the lifecycle detaches the listener even from a retained button.
  rebuilt.click();
  expect(rebuilt.textContent).toBe('Select anchor');
});
