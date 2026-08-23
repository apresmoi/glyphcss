import { describe, it, expect, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { GlyphSceneStatic } from "./GlyphSceneStatic";
import { cubePolygons, icosahedronPolygons } from "@glyphcss/core";
import { compileScene, createGlyphPerspectiveCamera, computeGlyphControlContentSha256, computeGlyphControlGeometryHashes, type GlyphControlSceneManifest, type GlyphObjectDictionary } from "glyphcss";

const semanticPolygon = { vertices: [[-1, -1, 0], [1, -1, 0], [1, 1, 0], [-1, 1, 0]], color: "#ffffff" } as const;
const digest = (char: string) => char.repeat(64);
const dictionaryBase = {
  schemaVersion: "glyph-object-dictionary/v2" as const, id: "dictionary/react-static",
  font: { id: "font/react-static", version: "1", sha256: digest("a") },
  classes: [{ id: 1, name: "quad", semanticGlyph: "Q", controlColor: "#123456" }],
};
const dictionary: GlyphObjectDictionary = { ...dictionaryBase, contentSha256: computeGlyphControlContentSha256(dictionaryBase) };
const hashes = computeGlyphControlGeometryHashes([semanticPolygon]);
const manifestBase = { schemaVersion: "control-scene/v1" as const, id: "scene/react-static", dictionaryId: dictionary.id, dictionarySha256: dictionary.contentSha256, ...hashes, contentSha256: "", instances: [{ id: "quad", classId: 1 }], surfaces: [{ id: "surface", instanceId: "quad" }], polygonSurfaceIds: ["surface"] };
const manifest: GlyphControlSceneManifest = { ...manifestBase, contentSha256: computeGlyphControlContentSha256(manifestBase) };

const containers: HTMLElement[] = [];
function render(node: React.ReactNode): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  containers.push(container);
  const root = createRoot(container);
  act(() => root.render(node));
  return container;
}

afterEach(() => {
  for (const c of containers.splice(0)) c.remove();
});

describe("GlyphSceneStatic (React)", () => {
  it("renders a .glyph-output <pre> with compiled content, no runtime", () => {
    const polys = cubePolygons({ center: [0, 0, 0], size: 1 });
    const el = render(
      <GlyphSceneStatic polygons={polys} cols={40} rows={16} autoCenter rotX={60} rotY={45} zoom={0.6} />,
    );
    const pre = el.querySelector("pre.glyph-output");
    expect(pre).not.toBeNull();
    expect((pre?.innerHTML ?? "").length).toBeGreaterThan(0);
    // colored output → spans
    expect(pre?.innerHTML).toContain("<span");
  });

  it("passes className/style through", () => {
    const polys = cubePolygons({ center: [0, 0, 0], size: 1 });
    const el = render(<GlyphSceneStatic polygons={polys} cols={20} rows={8} className="hero" />);
    const pre = el.querySelector("pre.glyph-output");
    expect(pre?.className).toContain("hero");
  });

  it("forwards colorTolerance to compileScene (COLOR-TOLERANCE.md Phase 3)", () => {
    const polys = icosahedronPolygons({ center: [0, 0, 0], size: 3 });
    const camera = createGlyphPerspectiveCamera({ rotX: 20, rotY: 25, zoom: 15 });
    const cfg = { camera, cols: 40, rows: 20, useColors: true, colorTolerance: 400 } as const;
    const expected = compileScene({ polygons: polys, ...cfg }).inner;
    const el = render(<GlyphSceneStatic polygons={polys} {...cfg} />);
    expect(el.querySelector("pre")?.innerHTML).toBe(expected);

    // Doing real work on this fixture, not merely failing to regress a no-op.
    const withoutTolerance = compileScene({ polygons: polys, ...cfg, colorTolerance: 0 }).inner;
    const spanCount = (s: string) => (s.match(/<span/g) ?? []).length;
    expect(spanCount(expected)).toBeLessThan(spanCount(withoutTolerance));
  });

  it("re-renders when only the colorTolerance prop changes (useMemo deps wiring)", () => {
    const polys = icosahedronPolygons({ center: [0, 0, 0], size: 3 });
    const camera = createGlyphPerspectiveCamera({ rotX: 20, rotY: 25, zoom: 15 });
    const container = document.createElement("div");
    document.body.appendChild(container);
    containers.push(container);
    const root = createRoot(container);
    act(() => root.render(
      <GlyphSceneStatic polygons={polys} camera={camera} cols={40} rows={20} useColors colorTolerance={0} />,
    ));
    const off = container.querySelector("pre.glyph-output")?.innerHTML;
    act(() => root.render(
      <GlyphSceneStatic polygons={polys} camera={camera} cols={40} rows={20} useColors colorTolerance={400} />,
    ));
    const on = container.querySelector("pre.glyph-output")?.innerHTML;
    expect(on).not.toBe(off);
  });

  it("matches compileScene semantic output in colored and plain modes", () => {
    for (const useColors of [false, true]) {
      const expected = compileScene({ polygons: [semanticPolygon], cols: 12, rows: 8, useColors, glyphOutput: "semantic", sceneManifest: manifest, dictionary }).inner;
      expect(expected).toContain("Q");
      const el = render(<GlyphSceneStatic polygons={[semanticPolygon]} cols={12} rows={8} useColors={useColors} glyphOutput="semantic" sceneManifest={manifest} dictionary={dictionary} />);
      expect(el.querySelector("pre")?.innerHTML).toBe(expected);
    }
  });
});
