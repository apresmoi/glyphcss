import { describe, it, expect, vi } from "vitest";
import { createGlyphScene, encodeGlyphSceneObjectSamplerKey } from "./createGlyphScene";
import { createGlyphOrthographicCamera, createGlyphPerspectiveCamera } from "./createGlyphCamera";
import { compileScene } from "./compileScene";
import { icosahedronPolygons, cubePolygons, type Polygon, type TextureSampler } from "@glyphcss/core";
import type { GlyphSolidWeightRampStep } from "./types";
import { GLYPH_FONT_ATLAS, GLYPH_FONT_ATLAS_ASCII, decodeGlyphAtlasText } from "../render/fontAtlas";
import { stampGlyphOverlayCell } from "../render/overlay";
import type { GlyphSceneObject } from "./sceneObject";
import { computeGlyphControlContentSha256, computeGlyphControlGeometryHashes } from "./controlFrame";
import type { GlyphControlSceneManifest, GlyphObjectDictionary } from "./controlFrame";

/**
 * The static compiler must produce byte-identical output to the runtime render
 * for the same inputs — otherwise a compiled page wouldn't match hydration.
 */
function runtimeRender(polys: ReturnType<typeof icosahedronPolygons>, opts: {
  rotX: number; rotY: number; zoom: number; cols: number; rows: number; useColors: boolean;
  mode?: "wireframe" | "solid"; charMode?: "ascii" | "braille" | "halfblock" | "quadrant";
  hiddenLines?: "show" | "hide";
  solidWeightRamp?: GlyphSolidWeightRampStep[];
  colorTolerance?: number;
}): string {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const camera = createGlyphPerspectiveCamera({ rotX: opts.rotX, rotY: opts.rotY, zoom: opts.zoom });
  const scene = createGlyphScene(host, {
    camera, cols: opts.cols, rows: opts.rows, useColors: opts.useColors,
    mode: opts.mode, charMode: opts.charMode, hiddenLines: opts.hiddenLines,
    solidWeightRamp: opts.solidWeightRamp, colorTolerance: opts.colorTolerance,
  });
  scene.add(polys);
  scene.rerender(); // createGlyphScene paints async (rAF); force a synchronous render
  const out = opts.useColors ? scene.output.innerHTML : scene.output.textContent ?? "";
  scene.destroy();
  host.remove();
  return out;
}

describe("compileScene — matches the runtime render", () => {
  for (const useColors of [true, false]) {
    it(`icosahedron, useColors=${useColors}`, () => {
      const polys = icosahedronPolygons({ center: [0, 0, 0], size: 1 });
      const cfg = { rotX: 65, rotY: 45, zoom: 0.3, cols: 60, rows: 24, useColors };
      const runtime = runtimeRender(polys, cfg);
      const compiled = compileScene({
        polygons: polys,
        camera: createGlyphPerspectiveCamera({ rotX: cfg.rotX, rotY: cfg.rotY, zoom: cfg.zoom }),
        cols: cfg.cols, rows: cfg.rows, useColors: cfg.useColors,
      });
      // For colored output the runtime sets innerHTML (raw spans); compileScene's
      // `inner` is the same raw string. For plain output the runtime sets
      // textContent (the browser un-escapes); compileScene escapes for inlining,
      // so compare against the runtime's textContent directly.
      const expected = useColors ? runtime : runtime;
      const got = useColors ? compiled.inner : compiled.inner
        .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
      expect(got).toBe(expected);
    });
  }

  it("cube matches at a different camera", () => {
    const polys = cubePolygons({ center: [0, 0, 0], size: 1 });
    const cfg = { rotX: 30, rotY: 20, zoom: 0.5, cols: 50, rows: 20, useColors: true };
    const runtime = runtimeRender(polys, cfg);
    const compiled = compileScene({
      polygons: polys,
      camera: createGlyphPerspectiveCamera({ rotX: cfg.rotX, rotY: cfg.rotY, zoom: cfg.zoom }),
      cols: cfg.cols, rows: cfg.rows,
    });
    expect(compiled.inner).toBe(runtime);
  });

  it("braille wireframe, charMode set, matches the runtime render", () => {
    const polys = icosahedronPolygons({ center: [0, 0, 0], size: 1 });
    const cfg = { rotX: 65, rotY: 45, zoom: 0.3, cols: 60, rows: 24, useColors: true } as const;
    const runtime = runtimeRender(polys, { ...cfg, mode: "wireframe", charMode: "braille" });
    const compiled = compileScene({
      polygons: polys,
      camera: createGlyphPerspectiveCamera({ rotX: cfg.rotX, rotY: cfg.rotY, zoom: cfg.zoom }),
      cols: cfg.cols, rows: cfg.rows, useColors: cfg.useColors,
      mode: "wireframe", charMode: "braille",
    });
    expect(compiled.inner).toBe(runtime);
    // And it must actually differ from the ASCII wireframe render — otherwise
    // the option silently no-op'd instead of taking effect.
    const asciiCompiled = compileScene({
      polygons: polys,
      camera: createGlyphPerspectiveCamera({ rotX: cfg.rotX, rotY: cfg.rotY, zoom: cfg.zoom }),
      cols: cfg.cols, rows: cfg.rows, useColors: cfg.useColors,
      mode: "wireframe",
    });
    expect(compiled.inner).not.toBe(asciiCompiled.inner);
  });

  it("halfblock solid, charMode set, matches the runtime render", () => {
    const polys = cubePolygons({ center: [0, 0, 0], size: 1 });
    const cfg = { rotX: 30, rotY: 20, zoom: 0.5, cols: 50, rows: 20, useColors: true } as const;
    const runtime = runtimeRender(polys, { ...cfg, mode: "solid", charMode: "halfblock" });
    const compiled = compileScene({
      polygons: polys,
      camera: createGlyphPerspectiveCamera({ rotX: cfg.rotX, rotY: cfg.rotY, zoom: cfg.zoom }),
      cols: cfg.cols, rows: cfg.rows, useColors: cfg.useColors,
      mode: "solid", charMode: "halfblock",
    });
    expect(compiled.inner).toBe(runtime);
  });

  it("quadrant solid, charMode set, matches the runtime render", () => {
    const polys = cubePolygons({ center: [0, 0, 0], size: 1 });
    const cfg = { rotX: 30, rotY: 20, zoom: 0.5, cols: 50, rows: 20, useColors: true } as const;
    const runtime = runtimeRender(polys, { ...cfg, mode: "solid", charMode: "quadrant" });
    const compiled = compileScene({
      polygons: polys,
      camera: createGlyphPerspectiveCamera({ rotX: cfg.rotX, rotY: cfg.rotY, zoom: cfg.zoom }),
      cols: cfg.cols, rows: cfg.rows, useColors: cfg.useColors,
      mode: "solid", charMode: "quadrant",
    });
    expect(compiled.inner).toBe(runtime);
    // And it must actually differ from both ascii and halfblock — otherwise
    // the option silently no-op'd or fell through to a sibling encoding.
    const asciiCompiled = compileScene({
      polygons: polys,
      camera: createGlyphPerspectiveCamera({ rotX: cfg.rotX, rotY: cfg.rotY, zoom: cfg.zoom }),
      cols: cfg.cols, rows: cfg.rows, useColors: cfg.useColors,
      mode: "solid",
    });
    const halfblockCompiled = compileScene({
      polygons: polys,
      camera: createGlyphPerspectiveCamera({ rotX: cfg.rotX, rotY: cfg.rotY, zoom: cfg.zoom }),
      cols: cfg.cols, rows: cfg.rows, useColors: cfg.useColors,
      mode: "solid", charMode: "halfblock",
    });
    expect(compiled.inner).not.toBe(asciiCompiled.inner);
    expect(compiled.inner).not.toBe(halfblockCompiled.inner);
  });

  it("solidWeightRamp, solid mode, matches the runtime render", () => {
    const polys = cubePolygons({ center: [0, 0, 0], size: 1 });
    const cfg = { rotX: 30, rotY: 20, zoom: 0.5, cols: 50, rows: 20, useColors: true } as const;
    const solidWeightRamp: GlyphSolidWeightRampStep[] = [
      { glyph: ".", weight: 400 },
      { glyph: ".", weight: 700 },
      { glyph: "o", weight: 400 },
      { glyph: "o", weight: 700 },
      { glyph: "#", weight: 700 },
    ];
    const runtime = runtimeRender(polys, { ...cfg, mode: "solid", solidWeightRamp });
    const compiled = compileScene({
      polygons: polys,
      camera: createGlyphPerspectiveCamera({ rotX: cfg.rotX, rotY: cfg.rotY, zoom: cfg.zoom }),
      cols: cfg.cols, rows: cfg.rows, useColors: cfg.useColors,
      mode: "solid", solidWeightRamp,
    });
    expect(compiled.inner).toBe(runtime);
    expect(compiled.inner).toMatch(/font-weight:(400|700)/);
    // And it must actually differ from the plain (no weight ramp) solid render.
    const plainCompiled = compileScene({
      polygons: polys,
      camera: createGlyphPerspectiveCamera({ rotX: cfg.rotX, rotY: cfg.rotY, zoom: cfg.zoom }),
      cols: cfg.cols, rows: cfg.rows, useColors: cfg.useColors,
      mode: "solid",
    });
    expect(compiled.inner).not.toBe(plainCompiled.inner);
  });

  it("hiddenLines: \"hide\", wireframe, matches the runtime render", () => {
    // Wireframe's per-cell glyph pick within a weight tier is randomized —
    // pin it so the compiled and runtime renders (two independent calls,
    // each consuming Math.random separately) are directly comparable.
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      // A coarse grid relative to mesh size maximizes the chance that a front
      // and a back edge of this closed convex mesh land in the SAME output
      // cell (where HLR has something to remove) — icosahedron wireframe
      // draws every edge, front and back, with no culling of its own
      // (parameters mirror `research/contour-first-text/experiments/05-wireframe-hlr.mjs`,
      // which measured a real front/back overlap at this mesh-size/grid ratio).
      const polys = icosahedronPolygons({ center: [0, 0, 0], size: 3 });
      const cfg = { rotX: 20, rotY: 25, zoom: 15, cols: 24, rows: 12, useColors: true } as const;
      const runtime = runtimeRender(polys, { ...cfg, mode: "wireframe", hiddenLines: "hide" });
      const compiled = compileScene({
        polygons: polys,
        camera: createGlyphPerspectiveCamera({ rotX: cfg.rotX, rotY: cfg.rotY, zoom: cfg.zoom }),
        cols: cfg.cols, rows: cfg.rows, useColors: cfg.useColors,
        mode: "wireframe", hiddenLines: "hide",
      });
      expect(compiled.inner).toBe(runtime);
      // And it must actually differ from "show" — otherwise the option
      // silently no-op'd instead of taking effect.
      const shown = compileScene({
        polygons: polys,
        camera: createGlyphPerspectiveCamera({ rotX: cfg.rotX, rotY: cfg.rotY, zoom: cfg.zoom }),
        cols: cfg.cols, rows: cfg.rows, useColors: cfg.useColors,
        mode: "wireframe", hiddenLines: "show",
      });
      expect(compiled.inner).not.toBe(shown.inner);
    } finally {
      randomSpy.mockRestore();
    }
  });

  it("omitting hiddenLines is byte-identical to today (\"show\" default, unchanged)", () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      const polys = icosahedronPolygons({ center: [0, 0, 0], size: 1 });
      const cfg = { rotX: 65, rotY: 45, zoom: 0.3, cols: 60, rows: 24, useColors: true } as const;
      const withoutOption = compileScene({
        polygons: polys,
        camera: createGlyphPerspectiveCamera({ rotX: cfg.rotX, rotY: cfg.rotY, zoom: cfg.zoom }),
        cols: cfg.cols, rows: cfg.rows, useColors: cfg.useColors,
        mode: "wireframe",
      });
      const explicitShow = compileScene({
        polygons: polys,
        camera: createGlyphPerspectiveCamera({ rotX: cfg.rotX, rotY: cfg.rotY, zoom: cfg.zoom }),
        cols: cfg.cols, rows: cfg.rows, useColors: cfg.useColors,
        mode: "wireframe", hiddenLines: "show",
      });
      expect(withoutOption.inner).toBe(explicitShow.inner);
    } finally {
      randomSpy.mockRestore();
    }
  });

  it("omitting charMode is byte-identical to today (ascii default, unchanged)", () => {
    // Solid mode is deterministic (Lambert-shaded, no per-render random glyph
    // pick like wireframe's tier selection), so two separate compileScene
    // calls are directly comparable here.
    const polys = icosahedronPolygons({ center: [0, 0, 0], size: 1 });
    const cfg = { rotX: 65, rotY: 45, zoom: 0.3, cols: 60, rows: 24, useColors: true } as const;
    const withoutOption = compileScene({
      polygons: polys,
      camera: createGlyphPerspectiveCamera({ rotX: cfg.rotX, rotY: cfg.rotY, zoom: cfg.zoom }),
      cols: cfg.cols, rows: cfg.rows, useColors: cfg.useColors,
    });
    const explicitAscii = compileScene({
      polygons: polys,
      camera: createGlyphPerspectiveCamera({ rotX: cfg.rotX, rotY: cfg.rotY, zoom: cfg.zoom }),
      cols: cfg.cols, rows: cfg.rows, useColors: cfg.useColors,
      charMode: "ascii",
    });
    expect(withoutOption.inner).toBe(explicitAscii.inner);

    // And every pre-existing (no-charMode) call site is unaffected: the
    // original parity tests above already assert compileScene === runtime
    // render byte-for-byte with charMode entirely absent from both calls.
  });

  it("colorTolerance forwards to the runtime scene byte-for-byte (COLOR-TOLERANCE.md Phase 3)", () => {
    // Solid mode is deterministic (see the charMode test above), so a direct
    // byte comparison is meaningful. A large tolerance is picked deliberately
    // so the assertion is sensitive to `colorTolerance` actually reaching the
    // render — if `compileScene` dropped the option, its output would still
    // match a colorTolerance:0 runtime render (MORE spans) but NOT this one.
    const polys = icosahedronPolygons({ center: [0, 0, 0], size: 3 });
    const cfg = { rotX: 20, rotY: 25, zoom: 15, cols: 40, rows: 20, useColors: true, colorTolerance: 400 } as const;
    const runtime = runtimeRender(polys, cfg);
    const compiled = compileScene({
      polygons: polys,
      camera: createGlyphPerspectiveCamera({ rotX: cfg.rotX, rotY: cfg.rotY, zoom: cfg.zoom }),
      cols: cfg.cols, rows: cfg.rows, useColors: cfg.useColors,
      colorTolerance: cfg.colorTolerance,
    });
    expect(compiled.inner).toBe(runtime);

    // And the tolerance is doing real work on this fixture, not merely
    // failing to regress a no-op: span count strictly drops vs colorTolerance: 0.
    const compiledOff = compileScene({
      polygons: polys,
      camera: createGlyphPerspectiveCamera({ rotX: cfg.rotX, rotY: cfg.rotY, zoom: cfg.zoom }),
      cols: cfg.cols, rows: cfg.rows, useColors: cfg.useColors,
    });
    const spanCount = (s: string) => (s.match(/<span/g) ?? []).length;
    expect(spanCount(compiled.inner)).toBeLessThan(spanCount(compiledOff.inner));
  });

  // `fontAtlas` chooses which PUA glyph modulus the atlas encoder maps against.
  // Both shipped variants share the same PUA range, so a compiled bake that
  // silently used the default would emit code points a caller decoding (or
  // rendering) against the ASCII atlas reads as different, wrong glyphs.
  describe("fontAtlas — the compiled bake targets the variant it was given", () => {
    const polys = icosahedronPolygons({ center: [0, 0, 0], size: 1 });
    const base = {
      polygons: polys,
      camera: createGlyphPerspectiveCamera({ rotX: 65, rotY: 45, zoom: 0.3 }),
      cols: 60, rows: 24,
      // Every step of this ramp is printable ASCII, so the scene fits BOTH atlases.
      glyphPalette: "dense",
      atlasPalette: ["#ff0000", "#00ff00", "#0000ff"],
    } as const;

    it("encodes against the ASCII atlas when asked, not the universal default", () => {
      const universal = compileScene({ ...base, colorEncoding: "atlas" });
      const ascii = compileScene({ ...base, colorEncoding: "atlas", fontAtlas: GLYPH_FONT_ATLAS_ASCII });
      expect(universal.inner).not.toContain("<span");
      expect(ascii.inner).not.toContain("<span");
      expect(ascii.inner).not.toBe(universal.inner);
    });

    it("round-trips through its own atlas, and garbles through the other one", () => {
      const plain = compileScene({ ...base, useColors: false }).inner;
      const ascii = compileScene({ ...base, colorEncoding: "atlas", fontAtlas: GLYPH_FONT_ATLAS_ASCII });
      expect(decodeGlyphAtlasText(ascii.inner, GLYPH_FONT_ATLAS_ASCII)).toBe(plain);
      expect(decodeGlyphAtlasText(ascii.inner, GLYPH_FONT_ATLAS)).not.toBe(plain);
    });
  });

  it("wraps output in a .glyph-output <pre>", () => {
    const polys = cubePolygons({ center: [0, 0, 0], size: 1 });
    const r = compileScene({ polygons: polys, cols: 20, rows: 8 });
    expect(r.html.startsWith('<pre class="glyph-output">')).toBe(true);
    expect(r.html.endsWith("</pre>")).toBe(true);
    expect(r.cols).toBe(20);
  });
});

/**
 * Packet F5b (PLAN-3d.md §11's F5 row, contract 3): `compileScene` accepts
 * `objects` and explicit `textureSamplers`, and returns `grid` as well.
 */
describe("compileScene — objects, textureSamplers, grid (contract 3, packet F5b)", () => {
  function quad(cx: number, cy: number, half = 1, color = "#4488cc"): Polygon[] {
    return [{
      vertices: [
        [cx - half, cy - half, 0],
        [cx - half, cy + half, 0],
        [cx + half, cy + half, 0],
        [cx + half, cy - half, 0],
      ],
      color,
    }];
  }

  const sceneOptions = {
    cols: 40,
    rows: 16,
    useColors: true,
    camera: createGlyphOrthographicCamera({ zoom: 30 }),
    doubleSided: true,
  } as const;

  function runtimeObjectRender(object: GlyphSceneObject): string {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const scene = createGlyphScene(host, sceneOptions);
    scene.addObject(object);
    scene.rerender();
    const out = scene.output.innerHTML;
    scene.destroy();
    host.remove();
    return out;
  }

  it("a mounted object's mesh, overlay and hotspot all reach the compiled render exactly like the live scene (mutation: skip overlays in compile, which must go red)", () => {
    const object: GlyphSceneObject = {
      id: "obj-1",
      meshes: [{ name: "mesh", polygons: quad(0, 0) }],
      overlays: [{
        id: "marker",
        stamp(grid): void {
          stampGlyphOverlayCell(grid, { col: 2, row: 2, char: "@", color: "#ff00ff" });
        },
      }],
      hotspots: [{ id: "h1", at: [0, 0, 0] }],
      bounds: { min: [-1, -1, 0], max: [1, 1, 0] },
    };

    const runtimeHtml = runtimeObjectRender(object);

    const compiled = compileScene({ polygons: [], objects: [object], ...sceneOptions });
    expect(compiled.inner).toBe(runtimeHtml);
    expect(compiled.inner).toContain("@");

    // The captured grid reflects the overlay's own stamp, not just the string.
    const idx = 2 * compiled.cols + 2;
    expect(compiled.grid.char[idx]).toBe("@");

    // Every mounted object's hotspots are projected through this render's camera.
    expect(compiled.hotspots).toHaveLength(1);
    expect(compiled.hotspots[0]!.id).toBe("h1");
    expect(compiled.hotspots[0]!.visible).toBe(true);

    // Mutation: an object mounted with its overlays stripped must render
    // differently — proves the overlay is actually doing the work above,
    // not merely failing to regress a no-op.
    const withoutOverlay = compileScene({ polygons: [], objects: [{ ...object, overlays: [] }], ...sceneOptions });
    expect(withoutOverlay.inner).not.toBe(compiled.inner);
    expect(withoutOverlay.inner).not.toContain("@");
  });

  it("two objects' overlays share ONE label arbiter and compose in mount order, exactly like the live scene", () => {
    const objectA: GlyphSceneObject = {
      id: "a",
      meshes: [],
      overlays: [{ id: "low", stamp(_grid, frame): void { frame.labels.place({ id: "low", priority: 1, col: 10, row: 5, text: "LOW" }); } }],
      bounds: { min: [0, 0, 0], max: [0, 0, 0] },
    };
    const objectB: GlyphSceneObject = {
      id: "b",
      meshes: [],
      overlays: [{ id: "high", stamp(_grid, frame): void { frame.labels.place({ id: "high", priority: 2, col: 10, row: 5, text: "HIGH" }); } }],
      bounds: { min: [0, 0, 0], max: [0, 0, 0] },
    };

    const host = document.createElement("div");
    document.body.appendChild(host);
    const scene = createGlyphScene(host, { ...sceneOptions, useColors: false });
    scene.addObject(objectA);
    scene.addObject(objectB);
    scene.rerender();
    const runtimeText = scene.output.textContent!;
    scene.destroy();
    host.remove();

    const compiled = compileScene({ polygons: [], objects: [objectA, objectB], ...sceneOptions, useColors: false });
    expect(compiled.inner).toBe(runtimeText);
    expect(runtimeText).toContain("HIGH");
    expect(runtimeText).not.toContain("LOW");
  });

  it("an object's own textureSamplers merge in exactly like the live scene (F2 sampler on a quad; mutation: drop object texture-sampler merging)", () => {
    const sampler: TextureSampler = { width: 1, height: 1, lowDetail: false, data: new Uint8ClampedArray([10, 20, 30, 255]) };
    const texturedQuad: Polygon = { ...quad(0, 0, 3, "#eeeeee")[0]!, texture: encodeGlyphSceneObjectSamplerKey("tex-obj", "tex"), uvs: [[0, 1], [1, 1], [1, 0], [0, 0]] };
    const object: GlyphSceneObject = {
      id: "tex-obj",
      meshes: [{ name: "m", polygons: [texturedQuad] }],
      textureSamplers: new Map([["tex", sampler]]),
      bounds: { min: [-3, -3, 0], max: [3, 3, 0] },
    };

    const runtimeHtml = runtimeObjectRender(object);
    const compiled = compileScene({ polygons: [], objects: [object], ...sceneOptions });
    expect(compiled.inner).toBe(runtimeHtml);

    const withoutSampler = compileScene({ polygons: [], objects: [{ ...object, textureSamplers: undefined }], ...sceneOptions });
    expect(withoutSampler.inner).not.toBe(compiled.inner);
  });

  it("an explicit textureSamplers entry wins a key collision with an object's own sampler, matching the live scene (contract 9)", () => {
    const objectSampler: TextureSampler = { width: 1, height: 1, lowDetail: false, data: new Uint8ClampedArray([10, 20, 30, 255]) };
    const explicitSampler: TextureSampler = { width: 1, height: 1, lowDetail: false, data: new Uint8ClampedArray([250, 240, 230, 255]) };
    const key = encodeGlyphSceneObjectSamplerKey("tex-obj-2", "tex");
    const texturedQuad: Polygon = { ...quad(0, 0, 3, "#eeeeee")[0]!, texture: key, uvs: [[0, 1], [1, 1], [1, 0], [0, 0]] };
    const object: GlyphSceneObject = {
      id: "tex-obj-2",
      meshes: [{ name: "m", polygons: [texturedQuad] }],
      textureSamplers: new Map([["tex", objectSampler]]),
      bounds: { min: [-3, -3, 0], max: [3, 3, 0] },
    };

    const withOnlyObjectSampler = compileScene({ polygons: [], objects: [object], ...sceneOptions });
    const withExplicitOverride = compileScene({
      polygons: [], objects: [object], textureSamplers: new Map([[key, explicitSampler]]), ...sceneOptions,
    });
    // Different pixel data must produce a different render — the explicit
    // entry is actually reaching the rasterizer, not merely accepted and
    // ignored (which would leave this equal to withOnlyObjectSampler).
    expect(withExplicitOverride.inner).not.toBe(withOnlyObjectSampler.inner);
  });

  it("objects omitted (or []) is byte-identical to before this option existed", () => {
    const polys = cubePolygons({ center: [0, 0, 0], size: 1 });
    const camera = createGlyphPerspectiveCamera({ rotX: 30, rotY: 20, zoom: 0.5 });
    const cfg = { polygons: polys, camera, cols: 40, rows: 16, useColors: true } as const;
    const baseline = compileScene(cfg);
    const withEmptyArray = compileScene({ ...cfg, objects: [] });
    expect(withEmptyArray.inner).toBe(baseline.inner);
    expect(withEmptyArray.grid.char).toEqual(baseline.grid.char);

    // And returning `grid` does not disable the halfblock/quadrant charMode
    // no-op gate (attaching ANY hook to the string-producing pass would).
    const halfblock = compileScene({ ...cfg, mode: "solid", charMode: "halfblock" });
    const quadrant = compileScene({ ...cfg, mode: "solid", charMode: "quadrant" });
    const asciiSolid = compileScene({ ...cfg, mode: "solid" });
    expect(halfblock.inner).not.toBe(asciiSolid.inner);
    expect(quadrant.inner).not.toBe(asciiSolid.inner);
    expect(quadrant.inner).not.toBe(halfblock.inner);
  });

  it("grid is always returned and matches the render, with or without objects", () => {
    const polys = cubePolygons({ center: [0, 0, 0], size: 1 });
    const camera = createGlyphPerspectiveCamera({ rotX: 30, rotY: 20, zoom: 0.5 });
    const compiled = compileScene({ polygons: polys, camera, cols: 30, rows: 12 });
    expect(compiled.grid.cols).toBe(30);
    expect(compiled.grid.rows).toBe(12);
    expect(compiled.grid.char.join("")).not.toBe(" ".repeat(30 * 12));
    expect(compiled.hotspots).toEqual([]);
  });

  it("rejects objects with glyphOutput: \"semantic\" rather than silently dropping them or misaligning the manifest", () => {
    const semanticPolygon: Polygon = { vertices: [[-1, -1, 0], [1, -1, 0], [1, 1, 0], [-1, 1, 0]], color: "#ffffff" };
    const digest = (char: string) => char.repeat(64);
    const dictionaryBase = {
      schemaVersion: "glyph-object-dictionary/v2" as const, id: "dictionary/compile-objects-test",
      font: { id: "font/compile-objects-test", version: "1", sha256: digest("a") },
      classes: [{ id: 1, name: "quad", semanticGlyph: "Q", controlColor: "#123456" }],
    };
    const dictionary: GlyphObjectDictionary = { ...dictionaryBase, contentSha256: computeGlyphControlContentSha256(dictionaryBase) };
    const hashes = computeGlyphControlGeometryHashes([semanticPolygon]);
    const manifestBase = {
      schemaVersion: "control-scene/v1" as const, id: "scene/compile-objects-test", dictionaryId: dictionary.id, dictionarySha256: dictionary.contentSha256,
      ...hashes, contentSha256: "", instances: [{ id: "quad", classId: 1 }], surfaces: [{ id: "surface", instanceId: "quad" }], polygonSurfaceIds: ["surface"],
    };
    const manifest: GlyphControlSceneManifest = { ...manifestBase, contentSha256: computeGlyphControlContentSha256(manifestBase) };
    const object: GlyphSceneObject = { id: "x", meshes: [{ name: "m", polygons: quad(0, 0) }], bounds: { min: [-1, -1, 0], max: [1, 1, 0] } };

    expect(() => compileScene({
      polygons: [semanticPolygon], cols: 12, rows: 8, glyphOutput: "semantic", sceneManifest: manifest, dictionary, objects: [object],
    })).toThrow(TypeError);
  });
});
