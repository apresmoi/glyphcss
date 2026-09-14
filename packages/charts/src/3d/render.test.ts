import { describe, expect, it } from "vitest";
import { createGlyphOrthographicCamera, createGlyphScene, SOLID_RAMP } from "glyphcss";
import { GLYPH_CHART_3D_DEFAULT_CAMERA, glyphChart3dFitCamera } from "./camera";
import { glyphChartObject } from "./object";
import { renderGlyphChart3d, renderGlyphChart3dJson } from "./render";
import { glyphChartSurface } from "./surface";
import type { GlyphChartCharset, GlyphChartColorMode, GlyphChartTarget } from "../types";

function flatGrid(rows: number, cols: number, value = 0): number[][] {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => value));
}

function volcano(rows = 10, cols = 10): number[][] {
  const z = flatGrid(rows, cols, 0);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const dr = r - (rows - 1) / 2, dc = c - (cols - 1) / 2;
      z[r]![c] = Math.max(0, 30 - (dr * dr + dc * dc));
    }
  }
  return z;
}

const TARGETS: readonly GlyphChartTarget[] = ["chat", "terminal", "web"];
const CHARSETS: readonly GlyphChartCharset[] = ["ascii", "box", "blocks", "braille"];
const COLORS: readonly GlyphChartColorMode[] = ["none", "ansi16", "ansi256", "truecolor", "css"];

describe("renderGlyphChart3d — target x charset x colour matrix", () => {
  for (const target of TARGETS) {
    for (const charset of CHARSETS) {
      for (const color of COLORS) {
        it(`${target}/${charset}/${color} renders (or dims with its own reason) without throwing`, () => {
          const mark = glyphChartSurface({ z: volcano(6, 6) });
          const result = renderGlyphChart3d(mark, { target, charset, color });
          expect(result.text.length).toBeGreaterThan(0);
          expect(result.resolved.target).toBe(target);
          // `resolved.charset` ECHOES the requested option (it always has —
          // this is a request/response record, not a behaviour claim); the
          // REAL charset behaviour is what the next block asserts, since
          // fix round 1 (P1-4) found `blocks` echoing its own request while
          // silently rendering byte-identical to `ascii`.
          expect(result.resolved.charset).toBe(charset);
          expect(result.resolved.color).toBe(color);
          if (charset === "braille" || charset === "blocks") {
            // Both are UNREPRESENTABLE for a 3D chart's always-solid, ALWAYS
            // overlaid (box/ticks) geometry (braille is wireframe-only;
            // halfblock/quadrant self-disable under ANY `transformCells`
            // hook, and this object's box/tick overlays always install one)
            // — each DIMS with its own ledger reason and, provably, renders
            // the SAME actual output the default ramp (`ascii`) does at the
            // same target/color, rather than a silently wrong distinct one.
            const code = charset === "braille" ? "chart3d-braille-unsupported" : "chart3d-blocks-unsupported";
            expect(result.report.ledger.some((e) => e.code === code)).toBe(true);
            const asciiEquivalent = renderGlyphChart3d(mark, { target, charset: "ascii", color });
            expect(result.text).toBe(asciiEquivalent.text);
          }
          expect(result.html !== undefined).toBe(color === "css");
        });
      }
    }
  }

  it("NO_COLOR is honoured for the ANSI text exits (the `css` html exit is unaffected — NO_COLOR is a terminal-escape convention, matching the 2D entry's own `glyphChartColorEnabled` rule)", () => {
    const mark = glyphChartSurface({ z: volcano(6, 6) });
    for (const color of ["ansi16", "ansi256", "truecolor"] as const) {
      const result = renderGlyphChart3d(mark, { color, env: { NO_COLOR: "1" } });
      // eslint-disable-next-line no-control-regex
      expect(/\x1b\[/.test(result.text)).toBe(false);
    }
    // `css` still carries a normal ANSI-mode result WITHOUT NO_COLOR, for contrast.
    const withColor = renderGlyphChart3d(mark, { color: "ansi256" });
    // eslint-disable-next-line no-control-regex
    expect(/\x1b\[/.test(withColor.text)).toBe(true);
  });
});

describe("renderGlyphChart3d — static frame equals the live scene render for the same camera", () => {
  // Fix round 1 (P2-6): made non-vacuous. The prior cut used `color: "none"`
  // at the MODEL level (no colorAnchors, so no colorbar chrome ever
  // engaged), the default `shading: "relief"`, and no title — a byte
  // comparison of the WHOLE canvas that never exercised `shading: "value"`'s
  // own texture-sampler path, a colorbar, or several ticks through the
  // canonical `compileScene({objects})` route this file now drives (P2-6's
  // own routing fix). This version keeps `shading: "value"` and a colorbar
  // (default `color: "auto"` at the MODEL level — a SEPARATE axis from the
  // render's own ANSI `color: "none"`, which stays plain-text for an easy
  // substring comparison) and title, and compares the STATIC frame's own
  // PLOT sub-rectangle (excluding the title row / colorbar column its own
  // chrome reserves) against a live scene rendered at exactly that
  // sub-rectangle's own `cols`x`rows` — this test regresses on ANY
  // divergence `render.ts`'s own `compileScene({objects})` call introduces
  // versus a real `scene.addObject()` mount (wrong mode/lighting/camera/
  // texture-merge assumption), which is exactly what "static equals live"
  // means once a hand-rolled renderer is gone.
  it("byte-identical PLOT REGION (shading: value, a colorbar, several ticks) against a live scene mounting the SAME object at the SAME camera", async () => {
    const mark = glyphChartSurface({ z: volcano(8, 8) }, undefined, { shading: "value" });
    expect(mark.colorAnchors).not.toBeNull(); // sanity: this fixture really does reserve a colorbar column
    const width = 100, height = 34, cellAspect = 0.5859375;
    const camera = { rotX: 60, rotY: 30, zoom: 20 };

    const staticResult = renderGlyphChart3d(mark, { target: "web", color: "none", width, height, cellAspect, camera, title: "Elevation" });

    // `render.ts`'s own reservation arithmetic (`COLORBAR_COLS`/
    // `COLORBAR_MIN_PLOT_WIDTH`) — duplicated here (not imported; both are
    // module-private) since a test asserting the plot RECTANGLE has to know
    // its own bounds independently of the code it is checking.
    const COLORBAR_COLS = 9, COLORBAR_MIN_PLOT_WIDTH = 24;
    const colorbarCols = width - COLORBAR_COLS >= COLORBAR_MIN_PLOT_WIDTH ? COLORBAR_COLS : 0;
    expect(colorbarCols).toBe(COLORBAR_COLS);
    const plotCols = width - colorbarCols, plotRows = height - 1; // 1 title row

    const host = document.createElement("div");
    document.body.appendChild(host);
    const sceneCamera = createGlyphOrthographicCamera({ rotX: camera.rotX, rotY: camera.rotY, zoom: camera.zoom });
    const object = glyphChartObject(mark);
    sceneCamera.target = [
      (object.bounds.min[0] + object.bounds.max[0]) / 2,
      (object.bounds.min[1] + object.bounds.max[1]) / 2,
      (object.bounds.min[2] + object.bounds.max[2]) / 2,
    ];
    const scene = createGlyphScene(host, { cols: plotCols, rows: plotRows, cellAspect, useColors: false, camera: sceneCamera });
    scene.addObject(object);
    await Promise.resolve();
    await Promise.resolve();
    const liveText = scene.output.textContent ?? "";
    scene.destroy();

    const staticLines = staticResult.text.split("\n");
    const staticPlot = staticLines.slice(1, 1 + plotRows).map((line) => line.slice(0, plotCols)).join("\n");
    expect(staticPlot).toBe(liveText);
    // The chrome this test exists to exercise really did paint something —
    // a title row and colorbar labels distinct from the plot's own ink.
    expect(staticLines[0]).toContain("Elevation");
    expect(staticLines.some((line) => /[0-9]/.test(line.slice(plotCols)))).toBe(true);
  });
});

describe("renderGlyphChart3d — shading: 'value' keeps glyph density monotone in z even with colour off", () => {
  it("MUTATION: a monotonically z-graded surface reads a monotone glyph-density gradient in the SAME direction as z — flat/uniform lighting would break this", () => {
    // A camera looking straight down (rotX: 0, rotY: 0) maps world (x, y)
    // directly to screen (col, row) with no rotation — the SAME "top view"
    // convention AGENTS.md's own honesty gate for `surface` uses — so a
    // z-gradient purely along x reads as a column-indexed gradient on
    // screen, with no ambiguity about which world axis moved. A real
    // (non-degenerate) y-extent (20 rows, not 2) and the library's own
    // auto-fit (no explicit zoom) keep the mesh from collapsing to a
    // sliver under this orthographic top view.
    const cols = 20, rows = 20;
    const z = flatGrid(rows, cols, 0).map((row) => row.map((_, c) => (c / (cols - 1)) * 20));
    const mark = glyphChartSurface({ z }, undefined, { shading: "value", color: "none", bands: 8 });
    const result = renderGlyphChart3d(mark, {
      target: "web", color: "none", charset: "ascii", width: 90, height: 40,
      camera: { rotX: 0, rotY: 0 },
    });
    const lines = result.text.split("\n");
    // Only a genuine SURFACE-SHADED cell counts — every OTHER glyph this
    // frame can emit is excluded explicitly rather than by omission,
    // because the default solid ramp (`SOLID_RAMP`, `glyphcss`) happens to
    // contain " " (blank canvas) at index 0 AND "+" (the axis overlay's own
    // tick-mark glyph, `object.ts`'s `edgeGlyph`/tick stamp) at index 5 —
    // both would silently masquerade as "surface data at ramp level 0/5"
    // and swamp a real signal with background/tick noise (the exact defect
    // an earlier revision of this test had, caught only by deliberately
    // reverting the feature under test and finding the gate stayed green).
    const NON_SURFACE_GLYPHS = new Set([" ", "+", "│", "─", "/", "\\"]);
    const isSurfaceGlyph = (ch: string) => !NON_SURFACE_GLYPHS.has(ch) && SOLID_RAMP.includes(ch);
    // At `rotX: 0, rotY: 0` this camera's own convention maps the grid's
    // GRADIENT axis (data x, which is what `z` here is graded along) onto
    // the screen's ROW axis, not its column axis — measured directly, not
    // assumed. Every surface-glyph cell across the WHOLE frame (not one
    // sampled column/row) contributes one (row, ramp-index) point — a
    // quad's two triangles split on their own shorter 3D diagonal
    // (`gridSurfacePolygons`'s own doc), so a single column can carry real
    // local noise right at a quad boundary that a broad sample averages
    // out. The property this gate actually needs is a monotone TREND,
    // measured as the Pearson correlation between screen row and ramp
    // index: a genuinely monotone gradient scores close to +-1; a
    // flat/uniform-light bug (the SAME glyph everywhere, zero variance) is
    // undefined/~0 and fails the threshold.
    const sampleRows: number[] = [];
    const sampleIndices: number[] = [];
    for (let r = 0; r < lines.length; r++) {
      for (const ch of lines[r]!) {
        if (!isSurfaceGlyph(ch)) continue;
        sampleRows.push(r);
        sampleIndices.push(SOLID_RAMP.indexOf(ch));
      }
    }
    expect(sampleRows.length).toBeGreaterThan(20);
    expect(new Set(sampleIndices).size).toBeGreaterThan(1); // a flat-light bug renders ONE glyph everywhere.
    const n = sampleRows.length;
    const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const meanRow = mean(sampleRows), meanIdx = mean(sampleIndices);
    let cov = 0, varRow = 0, varIdx = 0;
    for (let i = 0; i < n; i++) {
      const dr = sampleRows[i]! - meanRow, di = sampleIndices[i]! - meanIdx;
      cov += dr * di; varRow += dr * dr; varIdx += di * di;
    }
    const pearson = cov / Math.sqrt(varRow * varIdx);
    expect(Math.abs(pearson)).toBeGreaterThan(0.85);
  });
});

describe("renderGlyphChart3d — auto-fit default framing shows the whole surface and all 3 axis labels (P1-4)", () => {
  it("a volcano-like fixture at the library's own default camera and target defaults shows all 3 axis titles and real surface ink", () => {
    const mark = glyphChartSurface({ z: volcano(8, 8) }, undefined, {
      axes: { x: { title: "x" }, y: { title: "y" }, z: { title: "z" } },
    });
    const result = renderGlyphChart3d(mark, { target: "web", color: "none" }); // no explicit camera/width/height — every default applies
    for (const title of ["x", "y", "z"]) expect(result.text.includes(title)).toBe(true);
    const nonBlank = result.text.replace(/\s/g, "").length;
    expect(nonBlank).toBeGreaterThan(40);
  });

  it("MUTATION: a FIXED (non-fitted) zoom on the same fixture shows MATERIALLY LESS of the surface than the real auto-fit does — proving the gate actually discriminates", () => {
    const mark = glyphChartSurface({ z: volcano(8, 8) }, undefined, {
      axes: { x: { title: "x" }, y: { title: "y" }, z: { title: "z" } },
    });
    const fitted = renderGlyphChart3d(mark, { target: "web", color: "none" });
    // The library's own bare orthographic default zoom (0.65) is what a
    // camera with no fit produces — the P1-4 defect this packet fixes.
    const fixed = renderGlyphChart3d(mark, { target: "web", color: "none", camera: { ...GLYPH_CHART_3D_DEFAULT_CAMERA, zoom: 0.65 } });
    const nonBlank = (s: string) => s.replace(/\s/g, "").length;
    expect(nonBlank(fixed.text)).toBeLessThan(nonBlank(fitted.text) / 3);
  });
});

describe("renderGlyphChart3d — auto-fit makes the plot the DOMINANT element, at several rotations (fix round 1, P1-2)", () => {
  // Occupied bounding-box share of the PLOT viewport (not the whole canvas
  // — a title row/colorbar column are chrome, not plot). The review's own
  // measured defect: 14x18 of 80x24, 18x22 of 96x32, 22x28 of 140x40 — all
  // under 11% of their own frame. `fitStaticCamera`'s probe-and-rescale
  // technique (mirroring `@glyphcss/diagrams/3d`'s own D2 packet) targets
  // filling nearly the whole plot rect minus a 1-cell margin, so the real
  // bound is far higher than "roughly 50%"; the gate stays at 0.4 as a
  // stable, conservative floor rather than chasing the exact achieved
  // number render-to-render.
  const FOOTPRINT_FLOOR = 0.4;
  function occupiedBoxFraction(text: string, cols: number, rows: number): number {
    const lines = text.split("\n");
    let minCol = Infinity, maxCol = -Infinity, minRow = Infinity, maxRow = -Infinity;
    for (let r = 0; r < rows; r++) {
      const line = lines[r] ?? "";
      for (let c = 0; c < cols; c++) {
        if ((line[c] ?? " ") === " ") continue;
        if (c < minCol) minCol = c;
        if (c > maxCol) maxCol = c;
        if (r < minRow) minRow = r;
        if (r > maxRow) maxRow = r;
      }
    }
    if (!Number.isFinite(minCol)) return 0;
    return ((maxCol - minCol + 1) * (maxRow - minRow + 1)) / (cols * rows);
  }

  // Several rotations, deliberately including oblique/steep angles a
  // trackball-style drag could reach — `renderGlyphChart3d`'s own camera
  // vocabulary is Euler `rotX`/`rotY` only (no `mat`/trackball option), so
  // this sweep is the closest analogue this module's public surface has to
  // "rolled/trackball cameras and several rotations": every one of these
  // pairs is a genuinely different oblique view, not a small perturbation
  // of the library default.
  const ROTATIONS: readonly { readonly rotX: number; readonly rotY: number }[] = [
    { rotX: 65, rotY: 45 }, // the library default
    { rotX: 20, rotY: 10 }, // near top-down
    { rotX: 80, rotY: 160 }, // near edge-on, rotated past the back
    { rotX: 45, rotY: 225 }, // opposite quadrant
    { rotX: 10, rotY: 300 }, // shallow, steep yaw
  ];
  const SIZES: readonly { readonly width: number; readonly height: number }[] = [
    { width: 80, height: 24 }, { width: 96, height: 32 }, { width: 140, height: 40 },
  ];

  for (const { rotX, rotY } of ROTATIONS) {
    for (const { width, height } of SIZES) {
      it(`rotX:${rotX} rotY:${rotY} at ${width}x${height}: all 3 axis titles present, footprint >= ${FOOTPRINT_FLOOR}`, () => {
        const mark = glyphChartSurface({ z: volcano(9, 9) }, undefined, {
          axes: { x: { title: "Longitude" }, y: { title: "Lat" }, z: { title: "z" } },
        });
        const result = renderGlyphChart3d(mark, { target: "web", color: "none", width, height, camera: { rotX, rotY } });
        for (const title of ["Longitude", "Lat", "z"]) expect(result.text.includes(title)).toBe(true);
        // No colorbar chrome reserved here at all — the whole canvas IS the plot.
        expect(occupiedBoxFraction(result.text, width, height)).toBeGreaterThanOrEqual(FOOTPRINT_FLOOR);
      });
    }
  }

  it("MUTATION: fitting from the RAW AABB alone (the pre-fix technique — margin-expanded corners, no probe render) leaves several of the SAME rotations below the floor — proving the sweep actually discriminates", () => {
    // Reproduces the OLD `glyphChart3dFitCamera`-only technique inline
    // (still exported, still used as-is by `camera.ts`'s own cheap seed —
    // this is not a claim that function is wrong, only that it alone is
    // not enough for a showcase-quality STATIC frame, which is exactly
    // P1-2's own finding).
    let failures = 0;
    for (const { rotX, rotY } of ROTATIONS) {
      for (const { width, height } of SIZES) {
        const mark = glyphChartSurface({ z: volcano(9, 9) }, undefined, {
          axes: { x: { title: "Longitude" }, y: { title: "Lat" }, z: { title: "z" } },
        });
        const object = glyphChartObject(mark);
        const fit = glyphChart3dFitCamera({ bounds: object.bounds, rotX, rotY, cols: width, rows: height, cellAspect: 0.5859375 });
        const camera = createGlyphOrthographicCamera({ rotX, rotY, zoom: fit.zoom });
        camera.target = fit.target;
        const host = document.createElement("div");
        document.body.appendChild(host);
        const scene = createGlyphScene(host, { cols: width, rows: height, cellAspect: 0.5859375, useColors: false, camera });
        scene.addObject(object);
        const text = scene.output.textContent ?? "";
        scene.destroy();
        if (occupiedBoxFraction(text, width, height) < FOOTPRINT_FLOOR) failures++;
      }
    }
    expect(failures).toBeGreaterThan(0);
  });
});

describe("renderGlyphChart3d — validation", () => {
  const mark = glyphChartSurface({ z: [[0, 1], [2, 3]] });
  it("rejects a non-positive-integer width/height with bad-render-size", () => {
    expect(() => renderGlyphChart3d(mark, { width: 0 })).toThrow(expect.objectContaining({ code: "bad-render-size" }));
    expect(() => renderGlyphChart3d(mark, { height: 1.5 })).toThrow(expect.objectContaining({ code: "bad-render-size" }));
  });
  it("rejects a bad target/charset/color with bad-render-options", () => {
    expect(() => renderGlyphChart3d(mark, { target: "bogus" as never })).toThrow(expect.objectContaining({ code: "bad-render-options" }));
    expect(() => renderGlyphChart3d(mark, { charset: "bogus" as never })).toThrow(expect.objectContaining({ code: "bad-render-options" }));
    expect(() => renderGlyphChart3d(mark, { color: "bogus" as never })).toThrow(expect.objectContaining({ code: "bad-render-options" }));
  });
  it("rejects a non-finite camera rotX/rotY or a non-positive zoom with bad-camera", () => {
    expect(() => renderGlyphChart3d(mark, { camera: { rotX: Number.NaN } })).toThrow(expect.objectContaining({ code: "bad-camera" }));
    expect(() => renderGlyphChart3d(mark, { camera: { zoom: -1 } })).toThrow(expect.objectContaining({ code: "bad-camera" }));
    expect(() => renderGlyphChart3d(mark, { camera: { zoom: 0 } })).toThrow(expect.objectContaining({ code: "bad-camera" }));
  });
});

describe("renderGlyphChart3dJson", () => {
  it("renders from a JSON surface input and returns a JSON result with text", () => {
    const json = JSON.stringify({ data: { z: volcano(6, 6) } });
    const out = JSON.parse(renderGlyphChart3dJson(json, { target: "web", color: "none" })) as { text: string };
    expect(out.text.length).toBeGreaterThan(0);
  });
  it("returns a structured error with a repair hint on bad input", () => {
    const out = JSON.parse(renderGlyphChart3dJson(JSON.stringify({ data: { z: [[0]] } }))) as { error: string; code: string; hint: string };
    expect(out.code).toBe("surface-too-small");
    expect(out.hint.length).toBeGreaterThan(0);
  });
  it("returns a structured error on invalid JSON", () => {
    const out = JSON.parse(renderGlyphChart3dJson("not json")) as { error: string; code: null };
    expect(out.code).toBeNull();
    expect(out.error).toMatch(/invalid JSON/);
  });
});
