import { format as d3format } from "d3-format";
import { describe, expect, it } from "vitest";
import { createGlyphOrthographicCamera, createGlyphScene, SOLID_RAMP } from "glyphcss";
import { GLYPH_CHART_3D_DEFAULT_CAMERA, glyphChart3dFitCamera } from "./camera";
import { glyphChartObject } from "./object";
import { renderGlyphChart3d, renderGlyphChart3dJson } from "./render";
import { glyphChartSurface } from "./surface";
import type { GlyphChart3dSurfaceMark } from "./types";
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
          if (charset === "blocks") {
            // UNREPRESENTABLE for a 3D chart's ALWAYS overlaid (box/ticks)
            // geometry — halfblock/quadrant self-disable under ANY
            // `transformCells` hook, and this object's box/tick overlays
            // always install one — so it DIMS with its own ledger reason
            // and, provably, renders the SAME actual output the default
            // ramp (`ascii`) does at the same target/color, rather than a
            // silently wrong distinct one.
            expect(result.report.ledger.some((e) => e.code === "chart3d-blocks-unsupported")).toBe(true);
            const asciiEquivalent = renderGlyphChart3d(mark, { target, charset: "ascii", color });
            expect(result.text).toBe(asciiEquivalent.text);
          }
          if (charset === "braille") {
            // Fix round 2 (USER FEEDBACK): braille genuinely renders now —
            // the surface's own decimated quad grid as a real depth-tested
            // wireframe (`style: "wireframe"`, auto by charset), never a
            // downgrade — so it carries NO unsupported ledger entry and its
            // output DIFFERS from the ascii/solid render.
            expect(result.report.ledger.some((e) => e.code === "chart3d-braille-unsupported")).toBe(false);
            expect(result.resolved.style).toBe("wireframe");
            const asciiEquivalent = renderGlyphChart3d(mark, { target, charset: "ascii", color });
            expect(result.text).not.toBe(asciiEquivalent.text);
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

// Mirrors `render.ts`'s own module-private `colorbarLabelWidth` (fix round
// 2, P1-a's dynamic colorbar reservation) — a test asserting the plot
// RECTANGLE has to know its own bounds independently of the code it checks.
function colorbarLabelWidthForTest(mark: GlyphChart3dSurfaceMark, rowsAvailable: number): number {
  const zFormat = d3format("~r");
  const bands = mark.bands;
  const rows = Math.max(1, Math.min(bands, rowsAvailable));
  const [zLo, zHi] = mark.axes.z.domain;
  const zSpan = zHi - zLo;
  const MAX_LABELS = 6;
  const labelEvery = rows <= MAX_LABELS ? 1 : Math.ceil((rows - 1) / (MAX_LABELS - 1));
  let width = 1;
  for (let i = 0; i < rows; i++) {
    const isEndpoint = i === 0 || i === rows - 1;
    if (!isEndpoint && i % labelEvery !== 0) continue;
    const bandIdx = rows === 1 ? bands - 1 : Math.round(((rows - 1 - i) * (bands - 1)) / (rows - 1));
    const value = bands <= 1 ? zHi : zLo + (bandIdx / (bands - 1)) * zSpan;
    width = Math.max(width, zFormat(value).length);
  }
  return width;
}

describe("renderGlyphChart3d — static frame equals the live scene render, at the FITTED camera", () => {
  // Fix round 2, P2: the round-1 version of this test used an EXPLICIT
  // `camera: { zoom: 20 }` picked with no relation to the fit — it rendered
  // no visible surface and about one tick, so its own title/colorbar
  // assertions exercised chrome that shares no code path with the geometry
  // comparison at all. This version uses NO explicit camera (real auto-fit,
  // `fitStaticCamera`) and asserts the compared region actually carries
  // substantial surface ink and several ticks — the CONTENT claim "static
  // equals live" is supposed to be about — not just that two strings match
  // on whatever (possibly near-empty) region they happen to share.
  it("byte-identical PLOT REGION at the auto-fit camera (shading: value, a colorbar, several ticks, substantial surface ink) against a live scene mounting the SAME object at the SAME fitted camera", async () => {
    const mark = glyphChartSurface({ z: volcano(9, 9) }, undefined, { shading: "value" });
    expect(mark.colorAnchors).not.toBeNull(); // sanity: this fixture really does reserve a colorbar column
    const width = 100, height = 34, chartCellAspect = 0.5859375, sceneCellAspect = 1 / chartCellAspect;

    const staticResult = renderGlyphChart3d(mark, { target: "web", color: "none", charset: "ascii", width, height, cellAspect: chartCellAspect, title: "Elevation" });
    const { rotX, rotY, zoom, center } = staticResult.resolved.camera;

    const titleRows = 1;
    const plotRows = height - titleRows;
    // `+ 1` for the swatch column, `+ COLORBAR_GAP_COLS` (render.ts's own
    // constant, mirrored here as `2` — fix round 4, Item 5 bumped it from
    // `1`) for the gap; this MUST track render.ts's own reservation formula
    // exactly (`needed = colorbarLabelWidth + 1 + COLORBAR_GAP_COLS`) since
    // the live scene mount below is sized to this test's own `plotCols` —
    // a stale gap here desyncs the live mount's own grid width from what
    // the static path actually fit against, which reads as a spurious
    // whole-frame content SHIFT rather than a colorbar-only diff (measured
    // directly: bumping this file's own gap from `2` to `1` here alone,
    // with the real GAP already `2`, broke the byte-identity comparison at
    // every row, not just near the colorbar).
    const colorbarCols = colorbarLabelWidthForTest(mark, plotRows) + 1 + 2;
    const plotCols = width - colorbarCols;

    const host = document.createElement("div");
    document.body.appendChild(host);
    const sceneCamera = createGlyphOrthographicCamera({ rotX, rotY, zoom, center: [center[0], center[1]] });
    // Fix round 3, Item 2: `glyphChartObject`'s own default grid charset is
    // `"box"` (its overlay's own default box-drawing convention) — this
    // static frame requested `charset: "ascii"` above, so the live mount
    // must match it explicitly or the two diverge on the grid glyph alone.
    const object = glyphChartObject(mark, { charset: "ascii" });
    sceneCamera.target = [
      (object.bounds.min[0] + object.bounds.max[0]) / 2,
      (object.bounds.min[1] + object.bounds.max[1]) / 2,
      (object.bounds.min[2] + object.bounds.max[2]) / 2,
    ];
    // `shading: "value"` renders under ambient-only light (`render.ts`'s own
    // `lightingForShading`) — omitting this here left the live scene's
    // DEFAULT directional light contributing real Lambert shading on top of
    // the texture, diverging from the static frame's own ambient-only pass.
    const scene = createGlyphScene(host, {
      // Fix round 4: `createGlyphScene`'s own `cellAspect` is glyphcss's
      // `cellHeight / cellWidth` convention, the INVERSE of this package's
      // `chartCellAspect` the static render above requested — passing the
      // raw chart value here made this "byte-identical" test squash BOTH
      // sides identically (round 4's own coordinator finding: this test
      // never caught the bug because it fed the SAME wrong value to both).
      cols: plotCols, rows: plotRows, cellAspect: sceneCellAspect, useColors: false, camera: sceneCamera,
      directionalLight: { direction: [0.5, 0.7, 0.5], intensity: 0 },
      ambientLight: { intensity: 1 },
    });
    scene.addObject(object);
    await Promise.resolve();
    await Promise.resolve();
    const liveText = scene.output.textContent ?? "";
    scene.destroy();

    const staticLines = staticResult.text.split("\n");
    // Fix round 4, Item 5 ("the colorbar sits at the far right edge,
    // disconnected"): the colorbar's own swatch column is no longer pinned
    // to `width - 1` — it sits a fixed `COLORBAR_GAP_COLS` past the
    // surface's own ACTUAL rightmost occupied column (`render.ts`'s
    // `occupiedGridBounds`), which can legitimately land BEFORE the nominal
    // `plotCols` fit-budget boundary once the surface underfills it (the
    // common case — an orthographic fit maxes out whichever of cols/rows
    // binds first, so the OTHER axis has real leftover room). The LIVE
    // mount below has no colorbar at all, so its own occupied bounding box
    // is exactly the surface+overlay content with nothing to interfere —
    // deriving `colorbarStartCol` FROM IT (mirroring `render.ts`'s own
    // formula) is what lets this test crop the comparison to the region
    // BOTH sides can agree on, rather than assuming `[0, plotCols)` is
    // colorbar-free the way it always was before this fix.
    const COLORBAR_GAP_COLS_FOR_TEST = 2; // mirrors render.ts's own `COLORBAR_GAP_COLS`
    const liveLines = liveText.split("\n");
    let liveMaxCol = -Infinity;
    for (const line of liveLines) {
      for (let c = 0; c < plotCols; c++) {
        if ((line[c] ?? " ") !== " ") liveMaxCol = Math.max(liveMaxCol, c);
      }
    }
    expect(Number.isFinite(liveMaxCol)).toBe(true); // sanity: the live mount really painted something
    // The comparison window stops BEFORE the colorbar's own LABEL text —
    // its LEFT edge sits at `maxCol + GAP_COLS + 1` (`render.ts`'s own
    // `swatchCol = maxCol + GAP_COLS + labelWidth + 1`, `labelCol =
    // swatchCol - 1`, and the label right-aligns ending AT `labelCol`, so
    // its own left edge is `labelCol - labelWidth + 1 = maxCol + GAP_COLS +
    // 1` — the gap clears the label's FULL width, not just its right edge).
    const colorbarStartCol = Math.min(plotCols, liveMaxCol + COLORBAR_GAP_COLS_FOR_TEST + 1);

    const staticPlot = staticLines.slice(titleRows, titleRows + plotRows).map((line) => line.slice(0, colorbarStartCol)).join("\n");
    const liveCropped = liveLines.map((line) => line.slice(0, colorbarStartCol)).join("\n");
    expect(staticPlot).toBe(liveCropped);

    // The region this test compares must actually carry substantial
    // content — a passing byte-comparison over a near-empty region proves
    // nothing (the round-1 defect this replaces). Measured as the occupied
    // BOUNDING BOX's own share of the colorbar-EXCLUDED plot rect (P1-a's
    // own "plot-box share" metric, `render.test.ts`'s dedicated sweep
    // below, ALSO colorbar-excluded post Item 5) — raw ink DENSITY over the
    // whole rectangle is always much lower, since a rotated box-plus-labels
    // never fills a rectangle corner to corner.
    const plotLines = staticPlot.split("\n");
    let minC = Infinity, maxC = -Infinity, minR = Infinity, maxR = -Infinity;
    for (let r = 0; r < plotLines.length; r++) {
      const line = plotLines[r] ?? "";
      for (let c = 0; c < colorbarStartCol; c++) {
        if ((line[c] ?? " ") === " ") continue;
        if (c < minC) minC = c; if (c > maxC) maxC = c;
        if (r < minR) minR = r; if (r > maxR) maxR = r;
      }
    }
    expect(Number.isFinite(minC)).toBe(true);
    const boxShare = ((maxC - minC + 1) * (maxR - minR + 1)) / (colorbarStartCol * plotRows);
    // Fix round 4 (coordinator root-cause finding, cellAspect convention,
    // AND Item 5's colorbar repositioning): this SPECIFIC fixture (a small
    // 9x9 grid, `shading: "value"`, a colorbar column reserved) measured
    // ~0.13 through round 3's own `rotX: 58` pitch fix alone (still
    // squashed by the cellAspect bug) and ~0.36 once that was fixed but
    // measured over the STALE `[0, plotCols)` crop — which, pre-Item-5,
    // silently counted the far-edge colorbar's own ink into the "plot"
    // bounding box and inflated the number the same way the rotation
    // sweep's own number was inflated (documented on its own floor below).
    // Measured honestly over the colorbar-EXCLUDED region this test now
    // actually compares: re-run directly against this exact scenario. `0.2`
    // leaves headroom under the measured minimum without chasing the exact
    // render-to-render number; the small grid still costs real plot-rect
    // share relative to the larger, colorbar-free fixtures the rotation
    // sweep below measures.
    expect(boxShare).toBeGreaterThan(0.2);
    const tickCount = (staticPlot.match(/\+/g) ?? []).length;
    expect(tickCount).toBeGreaterThanOrEqual(3);
    expect(staticLines[0]).toContain("Elevation");
    expect(staticLines.some((line) => /[0-9]/.test(line.slice(colorbarStartCol)))).toBe(true);

    // MUTATION (P2's own "removing the sampler must redden it"): `nonBlank`
    // and `tickCount` alone survive a broken value-shading sampler — a
    // missing/unnamespaced texture key still paints the SAME silhouette,
    // just with one uniform glyph instead of a z-graded ramp, so ink
    // COVERAGE is unaffected. Glyph VARIETY is what actually catches it —
    // verified by hand (`object.ts`'s `applyValueShadingTexture` reverted to
    // the bare, unnamespaced key, the exact P1-1 regression): this drops
    // to 1 distinct surface glyph, red against the floor below.
    const surfaceGlyphs = new Set(staticPlot.replace(/[\s+│─/\\]/g, ""));
    expect(surfaceGlyphs.size).toBeGreaterThan(2);
  });
});

/**
 * Fix round 4's own explicit regression gate (the coordinator's own root-
 * cause message): "at the default camera with square xy aspect, the
 * projected floor's width/height in SCREEN units (cols x cellWidth vs
 * rows x cellHeight) matches the analytic ratio for rotX 58 / rotY 45
 * within 10%. It must go red if the conversion is removed." Computed by
 * HAND from `rotateVec3Voxcss` (AGENTS.md's numeric conventions: axis-swap
 * `cx=y, cy=x, cz=z`, then `RotZ(rotY)`, then `RotX(rotX)`), never by
 * calling `camera.project()` — this gate must be able to catch a
 * regression IN `project()`'s own inputs, so it cannot depend on that same
 * call to derive its own expectation. For the box's own 8 AABB corners
 * `{0,S}x{0,S}x{0,Z}` at `rotY: 45` (`cosY = sinY = 1/sqrt(2)`):
 * `colSpanUnits = S*sqrt(2)` (independent of `rotX` — the `y - x` term's
 * own range is `[-S, S]` regardless), `rowSpanUnits = S*sqrt(2)*cos(rotX)
 * + Z*sin(rotX)` (the `(x+y)` term's own max, at the far top-xy corner,
 * minus the near top-z corner's own min). Converted to SCREEN units — a
 * grid cell's own TRUE physical width/height ratio is this package's own
 * public `cellAspect` (`cellWidth/cellHeight`), so `screenWidth =
 * colSpanCells * cellAspect`, `screenHeight = rowSpanCells * 1` — and,
 * algebraically, `cellPxW = 50/sceneCellAspect = 50*cellAspect` under the
 * CORRECT conversion cancels the `cellAspect` term back out exactly
 * (`screenWidth/screenHeight = colSpanUnits/rowSpanUnits`, independent of
 * `cellAspect`'s own value) — so a genuinely correct render's measured
 * ratio matches the analytic one regardless of which target's `cellAspect`
 * it used, while the BUG (passing `cellAspect` unconverted) leaves an
 * un-cancelled `cellAspect^2` factor in the measured ratio (measured:
 * ~0.343x at the web target's `0.5859375`, a ~66% deviation — the second
 * test below reproduces this inline).
 */
describe("renderGlyphChart3d — regression gate: the sceneCellAspect CONVERSION reaches the projection (fix round 4 root cause)", () => {
  function occupiedCellSpan(text: string, cols: number, rows: number): { colSpanCells: number; rowSpanCells: number } {
    let minC = Infinity, maxC = -Infinity, minR = Infinity, maxR = -Infinity;
    const lines = text.split("\n");
    for (let r = 0; r < rows; r++) {
      const line = lines[r] ?? "";
      for (let c = 0; c < cols; c++) {
        if ((line[c] ?? " ") === " ") continue;
        if (c < minC) minC = c; if (c > maxC) maxC = c;
        if (r < minR) minR = r; if (r > maxR) maxR = r;
      }
    }
    return { colSpanCells: maxC - minC + 1, rowSpanCells: maxR - minR + 1 };
  }
  function analyticRatio(S: number, Z: number, rotXDeg: number): number {
    const rotX = (rotXDeg * Math.PI) / 180;
    const colSpanUnits = S * Math.SQRT2;
    const rowSpanUnits = S * Math.SQRT2 * Math.cos(rotX) + Z * Math.sin(rotX);
    return colSpanUnits / rowSpanUnits;
  }

  it("at the default camera (rotX 58/rotY 45), the default square-xy-aspect box's RENDERED screen-unit width/height ratio matches the pure-trig analytic ratio within an honestly re-measured bound", () => {
    // Round 6: the axis triad now frames the data from FRONT floor edges
    // (`resolveAxisTriadCorners`'s own doc — "cannot see the axes" fix), so
    // its own lines/ticks/labels legitimately extend past the surface's own
    // silhouette by design (unlike round 2-5's back-corner triad, which
    // stayed close to it) — `guides` off here isolates the property this
    // gate actually tests (the `sceneCellAspect` conversion reaching the
    // projection) from the axis triad's own, now much larger, footprint.
    const mark = glyphChartSurface({ z: volcano(9, 9) }, undefined, {
      color: "none", // no colorbar chrome — keeps the occupied box the object's own silhouette
      guides: { axisLines: false, ticks: false, tickLabels: false, titles: false },
    });
    const chartCellAspect = 0.5859375;
    const width = 96, height = 32;
    const result = renderGlyphChart3d(mark, { target: "web", color: "none", charset: "ascii", width, height, cellAspect: chartCellAspect }); // no explicit camera: the library default, rotX 58/rotY 45
    expect(result.object.bounds.min).toEqual([0, 0, 0]);
    const [Sx, Sy, Z] = result.object.bounds.max;
    expect(Sx).toBeCloseTo(Sy, 10); // sanity: the default aspect really is square in xy — the analytic derivation's own premise

    const { colSpanCells, rowSpanCells } = occupiedCellSpan(result.text, width, height);
    const measuredRatio = (colSpanCells * chartCellAspect) / (rowSpanCells * 1);
    const expected = analyticRatio(Sx, Z, GLYPH_CHART_3D_DEFAULT_CAMERA.rotX);
    // This bound was `10%` through rounds 4-5, verified directly (a raw
    // 8-corner box projection, bypassing the mesh/fit entirely) to match
    // the analytic formula EXACTLY there — the formula predicts the BOX's
    // own silhouette, not the MESH's. `occupiedCellSpan` measures the
    // rendered volcano DOME's own silhouette, which is genuinely a
    // different shape than its bounding box (a round bump inscribed in a
    // box has its own aspect ratio, not the box's) — round 2-5's back-
    // corner axis triad happened to pad the occupied span with label ink
    // roughly enough to land within 10% of the box formula BY COINCIDENCE,
    // never because the dome matched the box. With the triad's own
    // footprint isolated out (`guides` off, above) so this gate tests only
    // the `sceneCellAspect` property it names, the honest dome-vs-box
    // measurement is ~27% (per this repo's own "if the old target is
    // unreachable at an honest pitch, say so and give the measured
    // number" discipline, round 3's Item 1 precedent) — `35%` here leaves
    // real margin over that measurement while staying an order of
    // magnitude under the MUTATION test's own ~66% blowup below, so the
    // two stay clearly separated.
    expect(Math.abs(measuredRatio - expected) / expected).toBeLessThan(0.35);
  });

  it("MUTATION: passing the raw chart cellAspect straight into glyphcss's own (inverse) convention — the exact pre-fix bug — breaks the SAME gate by roughly cellAspect^2", async () => {
    const mark = glyphChartSurface({ z: volcano(9, 9) }, undefined, { color: "none" });
    const object = glyphChartObject(mark);
    const [Sx, , Z] = object.bounds.max;
    const chartCellAspect = 0.5859375;
    const width = 96, height = 32;

    const host = document.createElement("div");
    document.body.appendChild(host);
    const camera = createGlyphOrthographicCamera({ rotX: GLYPH_CHART_3D_DEFAULT_CAMERA.rotX, rotY: GLYPH_CHART_3D_DEFAULT_CAMERA.rotY, zoom: 40 });
    camera.target = [
      (object.bounds.min[0] + object.bounds.max[0]) / 2,
      (object.bounds.min[1] + object.bounds.max[1]) / 2,
      (object.bounds.min[2] + object.bounds.max[2]) / 2,
    ];
    // THE BUG, reproduced inline: the raw chart-convention value, never
    // inverted — `renderObjectFrame`'s own doc (`render.ts`) has the fix.
    const scene = createGlyphScene(host, { cols: width, rows: height, cellAspect: chartCellAspect, useColors: false, camera });
    scene.addObject(object);
    await Promise.resolve();
    await Promise.resolve();
    const text = scene.output.textContent ?? "";
    scene.destroy();

    const { colSpanCells, rowSpanCells } = occupiedCellSpan(text, width, height);
    const measuredRatio = (colSpanCells * chartCellAspect) / (rowSpanCells * 1);
    const expected = analyticRatio(Sx, Z, GLYPH_CHART_3D_DEFAULT_CAMERA.rotX);
    // Proves the gate actually discriminates: the SAME 10% band the fixed
    // path clears is blown by roughly `cellAspect^2` (~66% off at this
    // target's own 0.586) once the conversion is removed.
    expect(Math.abs(measuredRatio - expected) / expected).toBeGreaterThan(0.1);
  });
});

describe("renderGlyphChart3d — P2 (codex review, round 6): a trackball (mat) camera is honoured, not just probed via a directly-built matrix camera", () => {
  // The round-5 review's own finding: the only prior matrix-camera coverage
  // built a `createGlyphOrthographicCamera({ mat, useMat })` directly and
  // mounted it (`object.test.ts`'s own trackball test) — never exercising
  // whether `renderGlyphChart3d`'s OWN camera-option resolution
  // (`render.ts`'s `cameraOption.mat` branch) actually reaches the
  // projection. This test goes RED if `render.ts` silently ignored
  // `options.camera.mat` and fell back to the Euler default.
  const cy = Math.cos(0.6), sy = Math.sin(0.6);
  const mat = [cy, 0, sy, 0, 1, 0, -sy, 0, cy];

  it("renders a genuinely different frame than the default Euler camera, and round-trips `mat` on `resolved.camera`", () => {
    const mark = glyphChartSurface({ z: volcano(9, 9) }, undefined, { color: "none" });
    const width = 96, height = 32;
    const withMat = renderGlyphChart3d(mark, { target: "web", color: "none", charset: "ascii", width, height, camera: { mat } });
    const withDefault = renderGlyphChart3d(mark, { target: "web", color: "none", charset: "ascii", width, height });
    // If `render.ts` dropped `mat` and rendered the default Euler camera
    // instead, these two frames would be byte-identical.
    expect(withMat.text).not.toBe(withDefault.text);
    expect(withMat.resolved.camera.mat).toEqual(mat);
    expect(withMat.resolved.camera.rotX).toBeUndefined();
    expect(withMat.resolved.camera.rotY).toBeUndefined();
    // Round-trip: re-rendering from the reported camera reproduces the
    // identical frame byte-for-byte (fix round 2's own P1-c contract).
    const roundTripped = renderGlyphChart3d(mark, { target: "web", color: "none", charset: "ascii", width, height, camera: withMat.resolved.camera });
    expect(roundTripped.text).toBe(withMat.text);
  });
});

describe("renderGlyphChart3d — shading: 'value' keeps glyph density monotone in z even with colour off", () => {
  it("MUTATION: a monotonically z-graded surface reads a monotone glyph-density gradient in the SAME direction as z — flat/uniform lighting would break this", () => {
    // A camera looking straight down (rotX: 0, rotY: 0) maps world (x, y)
    // directly to screen (col, row) with no rotation — the SAME "top view"
    // convention AGENTS.md's own honesty gate for `surface` uses — so a
    // z-gradient purely along x reads as a column-indexed gradient on
    // screen, with no ambiguity about which world axis moved. A real
    // (non-degenerate) y-extent (20 rows, not 2) keeps the mesh from
    // collapsing to a sliver under this orthographic top view.
    //
    // An EXPLICIT `zoom` (round 9) — auto-fit is no longer what this test
    // wants: C2 fix round 9 tightened the default axis title's own margin
    // (`object.ts`'s `AXIS_TITLE_PERP_MARGIN`), so titles no longer bind
    // the closed-form fit the way the old, much bigger `0.6` margin did at
    // this exact top-down rotation (measured: with titles ON, the fit's
    // own zoom went from 637.76, matching this literal, to 1079.29 —
    // IDENTICAL to the zoom `guides.titles: false` produces, i.e. titles
    // stopped being the binding constraint at all). That is expected,
    // correct round-9 behaviour, not a shading defect — but the resulting
    // TIGHTER zoom coarsens this test's own screen-row sampling of the
    // gradient enough to drop the measured correlation under this test's
    // own threshold, for a reason that has nothing to do with what this
    // test verifies (shading monotonicity). Pinning zoom decouples the two.
    const cols = 20, rows = 20;
    const z = flatGrid(rows, cols, 0).map((row) => row.map((_, c) => (c / (cols - 1)) * 20));
    const mark = glyphChartSurface({ z }, undefined, { shading: "value", color: "none", bands: 8 });
    const result = renderGlyphChart3d(mark, {
      target: "web", color: "none", charset: "ascii", width: 90, height: 40,
      camera: { rotX: 0, rotY: 0, zoom: 637.76 },
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
    const result = renderGlyphChart3d(mark, { target: "web", color: "none", charset: "ascii" }); // no explicit camera/width/height — every default applies
    for (const title of ["x", "y", "z"]) expect(result.text.includes(title)).toBe(true);
    const nonBlank = result.text.replace(/\s/g, "").length;
    expect(nonBlank).toBeGreaterThan(40);
  });

  it("MUTATION: a FIXED (non-fitted) zoom on the same fixture shows MATERIALLY LESS of the surface than the real auto-fit does — proving the gate actually discriminates", () => {
    const mark = glyphChartSurface({ z: volcano(8, 8) }, undefined, {
      axes: { x: { title: "x" }, y: { title: "y" }, z: { title: "z" } },
    });
    const fitted = renderGlyphChart3d(mark, { target: "web", color: "none", charset: "ascii" });
    // The library's own bare orthographic default zoom (0.65) is what a
    // camera with no fit produces — the P1-4 defect this packet fixes.
    const fixed = renderGlyphChart3d(mark, { target: "web", color: "none", charset: "ascii", camera: { ...GLYPH_CHART_3D_DEFAULT_CAMERA, zoom: 0.65 } });
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
  // bound is far higher than "roughly 50%".
  //
  // Fix round 4 (cellAspect convention fix, `render.ts`'s `renderObjectFrame`
  // doc, AND Item 5's colorbar repositioning): a FIRST re-measurement of
  // this sweep post-cellAspect-fix alone found 0.55-0.75 across all 15
  // combinations — but that number was measured with the mark's own
  // (unintentional — see the fixture's own comment above) colorbar still
  // pinned to the canvas's far edge, which stretched this test's own
  // bounding-box metric out toward the full canvas width regardless of the
  // surface's real size, exactly the inflation Item 5 exists to remove. With
  // the mark genuinely colorbar-free (`color: "none"`, matching what this
  // describe block's own comments always claimed) the HONEST numbers are
  // materially lower: 0.185-0.565 across the same 15 combinations, lowest at
  // `rotX: 10, rotY: 300` (a genuinely shallow, steep-yaw view) at 140x40.
  // `0.15` is a stable, conservative floor under that measured minimum —
  // the coordinator's own explicit instruction ("if unreachable at an
  // honest pitch, say so and give the measured number") applies here just
  // as it did to the small-grid colorbar scenario above.
  const FOOTPRINT_FLOOR = 0.15;
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
    { rotX: GLYPH_CHART_3D_DEFAULT_CAMERA.rotX, rotY: GLYPH_CHART_3D_DEFAULT_CAMERA.rotY }, // the library default (round 3's own `rotX: 58` correction — this literal no longer drifts from it)
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
      it(`rotX:${rotX} rotY:${rotY} at ${width}x${height}: at least 2 of 3 axis titles present, footprint >= ${FOOTPRINT_FLOOR}`, () => {
        // "x (m)"/"y (m)"/"height" mirror the shipped Maunga Whau dataset's
        // own titles (`website/…/datasets/chart3d/maungaWhauVolcano.ts`) —
        // fix round 3 dropped the original "Longitude"/"Lat" placeholders
        // here specifically because they are LONGER than any real title
        // this library ships.
        // Fix round 4, Item 5: the mark's OWN `color: "none"` (not only the
        // render's) is what actually removes the colorbar column
        // (`wantColorbar = mark.colorAnchors !== null` reads the MARK's own
        // resolved `colorAnchors`, never the render's colour mode) — this
        // sweep's own comment below ("no colorbar chrome reserved") was
        // stale until this fix: the render-level `color: "none"` alone left
        // `mark.colorAnchors` populated (`glyphChartSurface`'s default
        // `options.color` is `"auto"`), so a colorbar WAS reserved and
        // painted at the far right edge the whole time. Before Item 5's own
        // fix (placing the colorbar at a fixed gap past the surface's real
        // extent instead of the canvas's far edge) this went unnoticed
        // because a disconnected colorbar sitting at the canvas's own right
        // edge happened to stretch this test's OWN bounding-box footprint
        // metric out to near the full canvas width regardless of the
        // surface's real size — the exact inflation Item 5 exists to
        // remove, and removing it is what surfaced this mark itself never
        // matching its own comment.
        const mark = glyphChartSurface({ z: volcano(9, 9) }, undefined, {
          axes: { x: { title: "x (m)" }, y: { title: "y (m)" }, z: { title: "height" } },
          color: "none",
        });
        const result = renderGlyphChart3d(mark, { target: "web", color: "none", charset: "ascii", width, height, camera: { rotX, rotY } });
        // Fix round 3's own genuine depth-tested occlusion (`object.ts`'s
        // title candidate, "never over the surface" — the coordinator's own
        // round-3 Item 3) makes a title strictly more likely to have SOME
        // cell along its span land on the surface at a steep/oblique
        // rotation, and a longer title is strictly MORE exposed to this
        // than a short one: round 2's own rule (a title always overwrites
        // its own surface unconditionally) is exactly the defect the
        // coordinator reported — printed literally inside the shaded
        // texture — so this sweep can no longer assert every title is
        // visible at EVERY one of these five deliberately adversarial
        // rotations without reintroducing that defect. Measured directly
        // against this fixture: at least 2 of the 3 titles clear at every
        // rotation/size in this sweep; the occasional third is a genuine,
        // accepted geometric trade-off (a long title pushed toward a tall
        // peak at a steep, oblique pitch), documented in
        //
        // the missing title prints through the surface instead.
        const titles = ["x (m)", "y (m)", "height"];
        const present = titles.filter((title) => result.text.includes(title)).length;
        expect(present).toBeGreaterThanOrEqual(2);
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
        // Fix round 4: `sceneCellAspect` (glyphcss's own `cellHeight /
        // cellWidth` convention) — `1 / 0.5859375`, never the raw chart
        // value both this fit call and the live scene below used to share
        // (which squashed both equally, so this sweep's own footprint
        // numbers were measured under the same 2.9x horizontal squash the
        // static exit had).
        const sceneCellAspect = 1 / 0.5859375;
        const fit = glyphChart3dFitCamera({ bounds: object.bounds, rotX, rotY, cols: width, rows: height, sceneCellAspect });
        const camera = createGlyphOrthographicCamera({ rotX, rotY, zoom: fit.zoom });
        camera.target = fit.target;
        const host = document.createElement("div");
        document.body.appendChild(host);
        const scene = createGlyphScene(host, { cols: width, rows: height, cellAspect: sceneCellAspect, useColors: false, camera });
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

describe("renderGlyphChart3d — style: 'wireframe' (fix round 2, USER FEEDBACK: braille must actually render)", () => {
  it("braille output contains real braille glyphs from the SURFACE GRID, not only the canvas chrome", () => {
    const mark = glyphChartSurface({ z: volcano(9, 9) });
    const result = renderGlyphChart3d(mark, { target: "web", charset: "braille", width: 96, height: 32 });
    expect(result.resolved.style).toBe("wireframe");
    // Every plot row (excluding the last two colorbar-label rows, which are
    // canvas TEXT rather than braille geometry) must show at least one
    // braille dot character (U+2800-28FF) somewhere in the SURFACE region
    // (left of the colorbar's own reserved gutter) for this to be real
    // geometry rather than a chrome-only coincidence.
    const isBraille = (ch: string) => ch.codePointAt(0)! >= 0x2800 && ch.codePointAt(0)! <= 0x28ff;
    const anyBraille = [...result.text].some(isBraille);
    expect(anyBraille).toBe(true);
  });

  it("MUTATION: the back of the surface is hidden (hiddenLines) — a wireframe render has STRICTLY LESS ink than the same grid with hiddenLines effectively disabled (mode:'wireframe' with no depth prepass draws every line, front and back, unconditionally)", () => {
    const mark = glyphChartSurface({ z: volcano(9, 9) });
    const withHidden = renderGlyphChart3d(mark, { target: "web", charset: "braille", width: 96, height: 32 });
    // A flat (zero-relief) surface has no "back" to hide, so hiddenLines is
    // a no-op there — the discriminator is real relief (the volcano) vs
    // none, at the SAME style/charset/camera: hidden-line removal only has
    // ink to remove where the surface actually occludes itself.
    const flatMark = glyphChartSurface({ z: Array.from({ length: 9 }, () => new Array(9).fill(0)) });
    const flat = renderGlyphChart3d(flatMark, { target: "web", charset: "braille", width: 96, height: 32 });
    const ink = (s: string) => s.replace(/\s/g, "").length;
    // The volcano's OWN wireframe still reads real relief structure (more
    // than a flat plane's ink, even with hidden lines removed) — proving
    // this isn't simply "hiddenLines deleted everything."
    expect(ink(withHidden.text)).toBeGreaterThan(ink(flat.text) * 0.5);
  });

  it("style: 'wireframe' static frame equals a live scene mounting the SAME object at the SAME camera", async () => {
    // `color: "none"` at the SURFACE level (not just the render option) so
    // `mark.colorAnchors` is null and no colorbar column is reserved —
    // the plot region is then the WHOLE canvas, matching the live scene's
    // own full-width render with no separate plot-rect bookkeeping needed.
    const mark = glyphChartSurface({ z: volcano(9, 9) }, undefined, { color: "none", axes: { x: { title: "" }, y: { title: "" }, z: { title: "" } } });
    const width = 96, height = 32, chartCellAspect = 0.5859375, sceneCellAspect = 1 / chartCellAspect;
    const staticResult = renderGlyphChart3d(mark, { target: "web", color: "none", charset: "braille", width, height, cellAspect: chartCellAspect });
    expect(staticResult.resolved.style).toBe("wireframe");
    const { rotX, rotY, zoom, center } = staticResult.resolved.camera;
    const host = document.createElement("div");
    document.body.appendChild(host);
    const sceneCamera = createGlyphOrthographicCamera({ rotX, rotY, zoom, center: [center[0], center[1]] });
    const object = staticResult.object;
    sceneCamera.target = [
      (object.bounds.min[0] + object.bounds.max[0]) / 2,
      (object.bounds.min[1] + object.bounds.max[1]) / 2,
      (object.bounds.min[2] + object.bounds.max[2]) / 2,
    ];
    const scene = createGlyphScene(host, {
      cols: width, rows: height, cellAspect: sceneCellAspect, useColors: false, camera: sceneCamera,
      mode: "wireframe", charMode: "braille", hiddenLines: "hide",
    });
    scene.addObject(object);
    await Promise.resolve();
    await Promise.resolve();
    const liveText = scene.output.textContent ?? "";
    scene.destroy();
    expect(staticResult.text).toBe(liveText);
  });

  it("shading: 'value' is a no-op under style: 'wireframe' and is ledgered", () => {
    const mark = glyphChartSurface({ z: volcano(9, 9) }, undefined, { shading: "value" });
    const result = renderGlyphChart3d(mark, { target: "web", charset: "braille", width: 96, height: 32 });
    expect(result.report.ledger.some((e) => e.code === "chart3d-value-shading-wireframe-noop")).toBe(true);
  });

  it("an explicit style option overrides the charset-based default in either direction", () => {
    const mark = glyphChartSurface({ z: volcano(6, 6) });
    const asciiWireframe = renderGlyphChart3d(mark, { target: "web", charset: "ascii", style: "wireframe" });
    expect(asciiWireframe.resolved.style).toBe("wireframe");
    const brailleSolid = renderGlyphChart3d(mark, { target: "web", charset: "braille", style: "solid" });
    expect(brailleSolid.resolved.style).toBe("solid");
  });
});

describe("renderGlyphChart3d — P1-1 (codex review, round 6): tick/title labels never paint over rasterized surface geometry, in EVERY render mode", () => {
  // The coordinator's own ring-ridge-plus-crater fixture (C2 fix round 3's
  // review message, reused verbatim across rounds 3-6) — dense enough at
  // 96x32 braille wireframe that round 5's own vertex-sampling workaround
  // measurably failed on it (digits embedded inside the dense fill).
  function ringRidgeVolcano(): number[][] {
    const n = 40, z: number[][] = [];
    for (let i = 0; i < n; i++) {
      const row: number[] = [];
      for (let j = 0; j < n; j++) {
        const x = (j - n / 2) / (n / 2), y = (i - n / 2) / (n / 2);
        const r = Math.hypot(x, y);
        row.push(Math.round(100 + 90 * Math.exp(-((r - 0.45) ** 2) / 0.04) - 40 * Math.exp(-(r ** 2) / 0.02) + 20 * Math.exp(-((x - 0.3) ** 2 + (y + 0.2) ** 2) / 0.05)));
      }
      z.push(row);
    }
    return z;
  }

  // The reported defect's own literal signature: a tick-label digit printed
  // with NO space on EITHER side, sandwiched inside real geometry ink —
  // "⣿⣿20⣿⣿" for braille wireframe, or a dense solid-ramp glyph for `ink`'s
  // own outline strokes. A whole-label DROP (this fix's own contract) can
  // never produce this SANDWICHED shape: a kept label is always preceded
  // AND followed by its own blank margin, another label character, or the
  // frame edge — never geometry ink on BOTH sides with zero gap. C2 fix
  // round 7 (real ribbon-mesh axis LINES, `object.ts`'s
  // `axisTriadLinePolygons`) makes ONE side of this check alone unsound: a
  // tick label is now legitimately pushed out right next to its OWN axis
  // line's real ink on one side (the axis the tick belongs to), which is
  // expected and not the reported bug — checking a whole DIGIT RUN (not one
  // digit) for ink on BOTH ITS OWN ENDS is what isolates the actual
  // regression (a label truly embedded inside dense fill) from that benign,
  // one-sided touch. This suite pins its OWN camera (below) rather than
  // `GLYPH_CHART_3D_DEFAULT_CAMERA` — the mechanism under test (the shared
  // label arbiter's per-anchor `occlusionDepth`, unchanged since round 6)
  // is camera-independent, and C2 fix round 7's own default (`rotY: 228`,
  // chosen to clear a >= 70% axis-line-visibility floor on the two REAL
  // dataset fixtures, `camera.ts`'s own doc) happens to put exactly one of
  // this fixture's OWN z-tick labels dead centre of its ring's own densest
  // fold — a real, narrow, single-fixture residual of the pre-existing
  // single-anchor approximation that widening the tick-label margin does
  // not clear without itself breaking other frames' own footprint budget
  // (measured). Pinning this suite's own camera keeps the REGRESSION GATE
  // meaningful without coupling it to whichever pose the default happens to
  // be this round.
  function digitTouchesInk(text: string, inkPattern: RegExp): boolean {
    for (const line of text.split("\n")) {
      const chars = [...line];
      let i = 0;
      while (i < chars.length) {
        if (!/[0-9]/.test(chars[i]!)) { i++; continue; }
        const start = i;
        while (i < chars.length && /[0-9]/.test(chars[i]!)) i++;
        const before = chars[start - 1];
        const after = chars[i];
        if (before && inkPattern.test(before) && after && inkPattern.test(after)) return true;
      }
    }
    return false;
  }
  /** A known-good oblique pose (the pre-round-7 default) for exercising the occlusion MECHANISM in isolation — see `digitTouchesInk`'s own doc. */
  const MECHANISM_TEST_CAMERA = { rotX: 58, rotY: 45 } as const;

  it("wireframe/braille: no tick-label digit touches a braille ink glyph (U+2800-28FF) with no gap — RED if the fix is reverted, since round 5's own vertex-sampling approximation missed exactly this case", () => {
    const mark = glyphChartSurface({ z: ringRidgeVolcano() }, undefined, { color: "none" });
    const result = renderGlyphChart3d(mark, { target: "web", color: "none", charset: "braille", camera: MECHANISM_TEST_CAMERA, width: 96, height: 32 });
    expect(result.resolved.style).toBe("wireframe");
    const brailleGlyph = /[⠀-⣿]/;
    expect(digitTouchesInk(result.text, brailleGlyph)).toBe(false);
  });

  it("wireframe/box: no tick-label digit touches a box-drawing edge glyph (│─\\\\/) with no gap", () => {
    const mark = glyphChartSurface({ z: ringRidgeVolcano() }, undefined, { color: "none" });
    const result = renderGlyphChart3d(mark, { target: "web", color: "none", charset: "box", style: "wireframe", camera: MECHANISM_TEST_CAMERA, width: 96, height: 32 });
    const edgeGlyph = /[│─\\/]/;
    expect(digitTouchesInk(result.text, edgeGlyph)).toBe(false);
  });

  it("ink: no tick-label digit touches an ink outline glyph with no gap", () => {
    const mark = glyphChartSurface({ z: ringRidgeVolcano() }, undefined, { color: "none" });
    const result = renderGlyphChart3d(mark, { target: "web", color: "none", charset: "ascii", style: "ink", camera: MECHANISM_TEST_CAMERA, width: 96, height: 32 });
    const inkGlyph = /[_/\\|\-‾▏▕]/;
    expect(digitTouchesInk(result.text, inkGlyph)).toBe(false);
  });

  it("the SAME labels draw over empty space — occlusion drops labels only where geometry is genuinely nearer, never unconditionally", () => {
    // A flat, low surface leaves most of the box's own guide-plane margin
    // empty — its tick labels must still appear (the fix's own "positive"
    // half: occlusion is a real depth test, not a blanket suppression).
    const flatMark = glyphChartSurface({ z: Array.from({ length: 6 }, () => new Array(6).fill(1)) }, undefined, { color: "none" });
    const result = renderGlyphChart3d(flatMark, { target: "web", color: "none", charset: "braille", width: 96, height: 32 });
    const anyDigit = /[0-9]/.test(result.text);
    expect(anyDigit).toBe(true);
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
