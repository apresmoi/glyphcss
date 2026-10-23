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
