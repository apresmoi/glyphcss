// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { mountGlyphDemo } from './mountGlyphDemo';
import type { Tunables } from './types';
import { loadMeshAsGeometry } from './geometry';

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
function mount(mesh?: string) {
  const host = document.createElement('div');
  host.setAttribute('data-no-hotspots', '1');
  if (mesh) host.setAttribute('data-mesh', mesh);
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
