import { describe, it, expect, afterEach } from "vitest";
import { createApp, h } from "vue";
import { GlyphSceneStatic } from "./GlyphSceneStatic";
import { cubePolygons, icosahedronPolygons } from "@glyphcss/core";
import { GLYPH_FONT_ATLAS_ASCII, compileScene, createGlyphPerspectiveCamera, computeGlyphControlContentSha256, computeGlyphControlGeometryHashes, type GlyphControlSceneManifest, type GlyphObjectDictionary } from "glyphcss";
import type { Polygon } from "@glyphcss/core";

const semanticPolygon: Polygon = { vertices: [[-1, -1, 0], [1, -1, 0], [1, 1, 0], [-1, 1, 0]], color: "#ffffff" };
const digest = (char: string) => char.repeat(64);
const dictionaryBase = { schemaVersion: "glyph-object-dictionary/v2" as const, id: "dictionary/vue-static", font: { id: "font/vue-static", version: "1", sha256: digest("a") }, classes: [{ id: 1, name: "quad", semanticGlyph: "Q", controlColor: "#123456" }] };
const dictionary: GlyphObjectDictionary = { ...dictionaryBase, contentSha256: computeGlyphControlContentSha256(dictionaryBase) };
const hashes = computeGlyphControlGeometryHashes([semanticPolygon]);
const manifestBase = { schemaVersion: "control-scene/v1" as const, id: "scene/vue-static", dictionaryId: dictionary.id, dictionarySha256: dictionary.contentSha256, ...hashes, contentSha256: "", instances: [{ id: "quad", classId: 1 }], surfaces: [{ id: "surface", instanceId: "quad" }], polygonSurfaceIds: ["surface"] };
const manifest: GlyphControlSceneManifest = { ...manifestBase, contentSha256: computeGlyphControlContentSha256(manifestBase) };

function mount(props: Record<string, unknown>): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const app = createApp({ setup() { return () => h(GlyphSceneStatic, props); } });
  app.mount(container);
  return container;
}

describe("GlyphSceneStatic (Vue)", () => {
  afterEach(() => { document.body.innerHTML = ""; });

  it("renders a .glyph-output <pre> with compiled content, no runtime", () => {
    const polys = cubePolygons({ center: [0, 0, 0], size: 1 });
    const el = mount({ polygons: polys, cols: 40, rows: 16, autoCenter: true, rotX: 60, rotY: 45, zoom: 0.6 });
    const pre = el.querySelector("pre.glyph-output");
    expect(pre).not.toBeNull();
    expect((pre?.innerHTML ?? "").length).toBeGreaterThan(0);
    expect(pre?.innerHTML).toContain("<span");
  });

  it("respects useColors=false (plain text, no spans)", () => {
    const polys = cubePolygons({ center: [0, 0, 0], size: 1 });
    const el = mount({ polygons: polys, cols: 30, rows: 12, autoCenter: true, useColors: false });
    const pre = el.querySelector("pre.glyph-output");
    expect(pre?.innerHTML).not.toContain("<span");
  });

  it("forwards colorTolerance to compileScene (COLOR-TOLERANCE.md Phase 3)", () => {
    const polys = icosahedronPolygons({ center: [0, 0, 0], size: 3 });
    const camera = createGlyphPerspectiveCamera({ rotX: 20, rotY: 25, zoom: 15 });
    const cfg = { camera, cols: 40, rows: 20, useColors: true, colorTolerance: 400 } as const;
    const expected = compileScene({ polygons: polys, ...cfg }).inner;
    const el = mount({ polygons: polys, ...cfg });
    expect(el.querySelector("pre")?.innerHTML).toBe(expected);

    // Doing real work on this fixture, not merely failing to regress a no-op.
    const withoutTolerance = compileScene({ polygons: polys, ...cfg, colorTolerance: 0 }).inner;
    const spanCount = (s: string) => (s.match(/<span/g) ?? []).length;
    expect(spanCount(expected)).toBeLessThan(spanCount(withoutTolerance));
  });

  it("matches compileScene semantic output in colored and plain modes", () => {
    for (const useColors of [false, true]) {
      const expected = compileScene({ polygons: [semanticPolygon], cols: 12, rows: 8, useColors, glyphOutput: "semantic", sceneManifest: manifest, dictionary }).inner;
      expect(expected).toContain("Q");
      const el = mount({ polygons: [semanticPolygon], cols: 12, rows: 8, useColors, glyphOutput: "semantic", sceneManifest: manifest, dictionary });
      expect(el.querySelector("pre")?.innerHTML).toBe(expected);
    }
  });

  it("forwards fontAtlas to compileScene (the ASCII variant, not the universal default)", () => {
    const polys = icosahedronPolygons({ center: [0, 0, 0], size: 1 });
    const camera = createGlyphPerspectiveCamera({ rotX: 65, rotY: 45, zoom: 0.3 });
    const shared = { polygons: polys, camera, cols: 60, rows: 24, glyphPalette: "dense", atlasPalette: ["#ff0000", "#00ff00", "#0000ff"], colorEncoding: "atlas" as const };
    const el = mount({ ...shared, fontAtlas: GLYPH_FONT_ATLAS_ASCII });
    const inner = el.querySelector("pre.glyph-output")?.innerHTML ?? "";
    expect(inner).toBe(compileScene({ ...shared, fontAtlas: GLYPH_FONT_ATLAS_ASCII }).inner);
    expect(inner).not.toBe(compileScene(shared).inner);
  });
});
