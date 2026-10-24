import { expect, it } from 'vitest';
import { demoSnippets } from './demoSnippets';
import { DEFAULT_TUNABLES } from './types';

it('exports the loaded mesh in every framework, with matching camera and rendering settings', () => {
  const snippets = demoSnippets({ ...DEFAULT_TUNABLES, renderMode: 'solid', zoom: 23.5, stretch: 1.2, density: 2, lineHeight: 0.8 }, { mesh: '/gallery/glb/apple.glb' });
  for (const snippet of Object.values(snippets)) {
    expect(snippet).toContain('/gallery/glb/apple.glb');
    expect(snippet).not.toMatch(/cuboctahedron|resolveGeometry/);
    expect(snippet).toContain('solid');
    expect(snippet).toContain('23.5');
    expect(snippet).toContain('1.2');
    expect(snippet).toContain('0.8');
    expect(snippet).toContain('fontSize');
    expect(snippet).toContain('5');
  }
  expect(snippets.vanilla).toContain('scene.add(recenterPolygons(polygons))');
  expect(snippets.react).toContain('<GlyphMesh src={"/gallery/glb/apple.glb"} autoCenter />');
  expect(snippets.vue).toContain('<GlyphMesh src="/gallery/glb/apple.glb" auto-center />');
});

it('uses built-in geometry only when no loaded source is present', () => {
  const snippets = demoSnippets({ ...DEFAULT_TUNABLES, geometry: 'icosahedron' }, {});
  expect(snippets.vanilla).toContain('resolveGeometry("icosahedron", { size: 100 })');
  expect(snippets.react).toContain('<GlyphMesh geometry="icosahedron" size={100} />');
  expect(snippets.vue).toContain('<GlyphMesh geometry="icosahedron" :size="100" />');
});

it('exports indexed polygons before mesh URLs in every framework', () => {
  for (const snippet of Object.values(demoSnippets(DEFAULT_TUNABLES, { polygonsUrl: '/earth.json', mesh: '/apple.glb' }))) {
    expect(snippet).toContain('fetch("/earth.json")');
    expect(snippet).toContain('data.faces.map');
    expect(snippet).not.toMatch(/apple.glb|cuboctahedron|resolveGeometry|loadMesh/);
  }
});

it('carries a non-default character mode into every framework and omits the ascii default', () => {
  const braille = demoSnippets({ ...DEFAULT_TUNABLES, charMode: 'braille' }, {});
  expect(braille.vanilla).toContain('charMode: "braille"');
  expect(braille.react).toContain('charMode="braille"');
  expect(braille.vue).toContain('char-mode="braille"');
  for (const snippet of Object.values(demoSnippets({ ...DEFAULT_TUNABLES, charMode: 'ascii' }, {}))) {
    expect(snippet).not.toMatch(/char-?[mM]ode/);
  }
});

it('exports encoding, tolerance, junctions, and hidden lines in every binding', () => {
  const snippets = demoSnippets({ ...DEFAULT_TUNABLES, colorEncoding: 'atlas', colorTolerance: 64, hiddenLines: 'hide', wireframeJunctions: true }, {});
  expect(snippets.vanilla).toContain('colorEncoding: "atlas"');
  expect(snippets.vanilla).toContain('colorTolerance: 64');
  expect(snippets.vanilla).toContain('hiddenLines: "hide"');
  expect(snippets.vanilla).toContain('wireframeJunctions: true');
  expect(snippets.react).toContain('colorEncoding="atlas"');
  expect(snippets.react).toContain('colorTolerance={64}');
  expect(snippets.react).toContain('hiddenLines="hide"');
  expect(snippets.react).toContain('wireframeJunctions={true}');
  expect(snippets.vue).toContain('color-encoding="atlas"');
  expect(snippets.vue).toContain(':color-tolerance="64"');
  expect(snippets.vue).toContain('hidden-lines="hide"');
  expect(snippets.vue).toContain(':wireframe-junctions="true"');
});

it('exports a selectable native hotspot button only for the hotspot example', () => {
  const snippets = demoSnippets(DEFAULT_TUNABLES, { hotspot: true });
  for (const snippet of Object.values(snippets)) {
    expect(snippet).toContain('aria-pressed');
    expect(snippet).toContain('Selected');
    expect(snippet).toContain('Select anchor');
    expect(snippet).not.toContain('alert(');
  }
  expect(snippets.vanilla).toContain('scene.addHotspot({ id: "anchor", at: [0, 0, 0], size: [14, 3] })');
  expect(snippets.react).toContain('<GlyphHotspot id="anchor" at={[0, 0, 0]} size={[14, 3]}>');
  expect(snippets.vue).toContain('<GlyphHotspot id="anchor" :at="[0, 0, 0]" :size="[14, 3]">');
  for (const snippet of Object.values(demoSnippets(DEFAULT_TUNABLES, {}))) expect(snippet).not.toContain('Hotspot');
});
