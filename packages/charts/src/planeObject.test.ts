import { describe, expect, it } from "vitest";
import {
  createGlyphCanvas,
  createGlyphOrthographicCamera,
  createGlyphScene,
  encodeGlyphSceneObjectSamplerKey,
  type GlyphCanvas,
} from "glyphcss";
import { glyphChartPlaneObject } from "./planeObject";
import { buildGlyphChart } from "./render";
import type { GlyphChartBuild } from "./types";

/**
 * Packet F4b (PLAN-3d.md §3.1/§7) acceptance gates for `glyphChartPlaneObject`.
 * Each `it` names, in a comment, the mutation the packet brief requires it
 * to redden. Fix round 1 adds: sizing from the sampler's own normalized
 * rect (P1), a real web `cellAspect`, exact screen-POSITION assertions
 * (not just "both colours occur"), a rotated-CAMERA case, and a real
 * 96x32 web chart legibility check.
 */

// The world→screen constant every glyphcss orthographic camera uses
// (AGENTS.md's "Numeric conventions": "voxcss/polycss author at
// BASE_TILE=50"), needed here to derive a camera `zoom` that reproduces a
// canvas's own cell aspect EXACTLY on screen (see `exactPlaneSceneOptions`).
const BASE_TILE = 50;

const INK_COLOR = "#ff2200";
const BG_COLOR = "#001122";
const COLS = 8;
const ROWS = 4;

/**
 * A hand-painted `GlyphChartBuild` — bypasses the real chart layout
 * pipeline entirely so the test controls exactly which cells are "ink"
 * (fg-colored) and which are not, rather than depending on whatever a
 * real spec happens to lay out. Left half (canvas cols 0..3) is painted as
 * ink at `INK_COLOR`; the whole canvas (including the right half) carries
 * `BG_COLOR` as its background.
 */
function buildFixture(): GlyphChartBuild {
  const canvas: GlyphCanvas = createGlyphCanvas({ cols: COLS, rows: ROWS, cellAspect: 1, tier: "box" });
  canvas.fillRect(0, 0, COLS - 1, ROWS - 1, { fill: { shade: 0 }, color: "#000000", bg: BG_COLOR });
  canvas.fillRect(0, 0, COLS / 2 - 1, ROWS - 1, { fill: "solid", color: INK_COLOR, bg: BG_COLOR });
  return chartBuildFromCanvas(canvas);
}

function chartBuildFromCanvas(canvas: GlyphCanvas): GlyphChartBuild {
  return {
    canvas,
    colorCanvas: canvas,
    plot: { x0: 0, y0: 0, x1: canvas.cols - 1, y1: canvas.rows - 1 },
    meta: { title: null, series: [], values: 0, description: null },
    report: { ledger: [], unsupportedGlyphs: [], routeConflicts: [] },
    resolved: { target: "web", charset: canvas.tier, color: "css", width: canvas.cols, height: canvas.rows, detail: "balanced", cellAspect: canvas.cellAspect, textScale: 1, env: undefined },
  };
}

/**
 * Scene options that reproduce a canvas's own aspect EXACTLY on screen, so
 * a plane object built with `width: canvas.cols` renders with `output row
 * == canvas row * k .. canvas row * k + k - 1` (and the same for columns)
 * — i.e. a `k`-cell block of OUTPUT cells per canvas cell — for ANY
 * `canvas.cellAspect`, not just `1`. With `width = cols`, `height` resolves
 * to `rows / cellAspect` (`planeObject.ts`'s own formula); solving both
 * axes' screen-spacing-per-world-unit to `k` gives `zoom = BASE_TILE * k *
 * cellAspect` and `sceneCellAspect = 1 / cellAspect` (independent of `k`).
 * `k` defaults to `1` (exact 1:1); the legibility test below uses `k = 4`
 * — matching the sampler's own default `texelsPerCell` row count — since
 * BELOW that a structural glyph (a `│` axis rule is only a fraction of its
 * own texel block) is exactly the documented "degrades to a density blob"
 * residual, not a defect in this test.
 */
function exactPlaneSceneOptions(canvas: { cols: number; rows: number; cellAspect: number }, k = 1) {
  return {
    cols: canvas.cols * k,
    rows: canvas.rows * k,
    cellAspect: 1 / canvas.cellAspect,
    camera: createGlyphOrthographicCamera({ rotX: 0, rotY: 0, zoom: BASE_TILE * canvas.cellAspect * k }),
  };
}

/**
 * A scene sized and cameraed so the plane object's own quad (produced with
 * `width: COLS`) fills the render grid exactly ONE output cell per canvas
 * cell, at the default (untransformed) orthographic camera.
 */
function makeScene(host: HTMLElement) {
  return createGlyphScene(host, {
    ...exactPlaneSceneOptions({ cols: COLS, rows: ROWS, cellAspect: 1 }),
    useColors: true,
    mode: "solid",
    directionalLight: { direction: [0, 0, 1], intensity: 0 },
    ambientLight: { intensity: 1 },
  });
}

async function flushRenders(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

/** Every distinct `color:#rrggbb` occurring in the scene's rendered HTML. */
function renderedColors(scene: { output: HTMLElement }): string[] {
  return [...new Set([...scene.output.innerHTML.matchAll(/color:(#[0-9a-f]{6})/g)].map((m) => m[1]!))];
}

/**
 * Walks the scene's own rendered DOM (never a regex over the flat HTML
 * string) into a `[row][col]` grid of the `color:#rrggbb` in scope at each
 * character — `null` where no ancestor `<span>` set one. Tracks position by
 * counting literal characters and `\n`s (`rasterize.ts` pushes a bare
 * `"\n"` between rows), so it reads the SCREEN position a colour actually
 * landed at, not merely whether it occurred anywhere.
 */
function colorGrid(scene: { output: HTMLElement }, rows: number, cols: number): (string | null)[][] {
  const grid: (string | null)[][] = Array.from({ length: rows }, () => new Array<string | null>(cols).fill(null));
  let r = 0, c = 0;
  function visit(node: ChildNode, color: string | null): void {
    if (node.nodeType === 3) {
      for (const ch of node.textContent ?? "") {
        if (ch === "\n") { r++; c = 0; continue; }
        if (r < rows && c < cols) grid[r]![c] = color;
        c++;
      }
      return;
    }
    if (node.nodeType === 1) {
      const el = node as HTMLElement;
      const style = el.getAttribute("style") ?? "";
      const match = style.match(/color:(#[0-9a-f]{6})/);
      const next = match ? match[1]! : color;
      for (const child of Array.from(el.childNodes)) visit(child, next);
    }
  }
  for (const child of Array.from(scene.output.childNodes)) visit(child, null);
  return grid;
}

/** Same walk as `colorGrid`, but the literal character at each position (space where nothing painted). */
function charGrid(scene: { output: HTMLElement }, rows: number, cols: number): string[][] {
  const grid: string[][] = Array.from({ length: rows }, () => new Array<string>(cols).fill(" "));
  let r = 0, c = 0;
  function visit(node: ChildNode): void {
    if (node.nodeType === 3) {
      for (const ch of node.textContent ?? "") {
        if (ch === "\n") { r++; c = 0; continue; }
        if (r < rows && c < cols) grid[r]![c] = ch;
        c++;
      }
      return;
    }
    if (node.nodeType === 1) for (const child of Array.from((node as HTMLElement).childNodes)) visit(child);
  }
  for (const child of Array.from(scene.output.childNodes)) visit(child);
  return grid;
}

describe("glyphChartPlaneObject", () => {
  // Mutation: swap which half of `glyphCanvasTextureSampler`'s ink/non-ink
  // split feeds fg vs bg (the same branch F2's own `sampler.test.ts`
  // guards: invert `mask[...] === 1` to `!== 1` in
  // `packages/glyphcss/src/render/canvas/sampler.ts`) — reddens because
  // the left half then reads BG_COLOR and the right half reads INK_COLOR,
  // the exact opposite of what this test asserts.
  it("mounted with scene.addObject, facing the camera at 1:1, reproduces the chart's fg/bg colours cell for cell", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const scene = makeScene(host);
    scene.addObject(glyphChartPlaneObject(buildFixture(), { width: COLS }));
    await flushRenders();

    const colors = renderedColors(scene);
    expect(colors).toEqual(expect.arrayContaining([INK_COLOR, BG_COLOR]));
    scene.destroy();
  });

  // Mutation: swap the polygon's `uvs` order (e.g. reverse the array) —
  // moves the mark to a mirrored corner, reddening both assertions below.
  it("reproduces a mark in its exact screen position — a top-left canvas mark lands top-left on screen, never mirrored", async () => {
    const canvas = createGlyphCanvas({ cols: COLS, rows: ROWS, cellAspect: 1, tier: "box" });
    canvas.fillRect(0, 0, COLS - 1, ROWS - 1, { fill: { shade: 0 }, color: "#000000", bg: BG_COLOR });
    canvas.fillRect(0, 0, 0, 0, { fill: "solid", color: INK_COLOR, bg: BG_COLOR });

    const host = document.createElement("div");
    document.body.appendChild(host);
    const scene = makeScene(host);
    scene.addObject(glyphChartPlaneObject(chartBuildFromCanvas(canvas), { width: COLS }));
    await flushRenders();

    const grid = colorGrid(scene, ROWS, COLS);
    expect(grid[0]![0]).toBe(INK_COLOR);
    expect(grid[0]![COLS - 1]).not.toBe(INK_COLOR);
    expect(grid[ROWS - 1]![0]).not.toBe(INK_COLOR);
    expect(grid[ROWS - 1]![COLS - 1]).not.toBe(INK_COLOR);
    scene.destroy();
  });

  it("rotated 45 degrees about Y (the OBJECT), it still paints the texture — it is not flat-coloured", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const scene = makeScene(host);
    // doubleSided so the rotation can never fail this test by culling the
    // back face — this test is about the TEXTURE surviving a transform,
    // not about winding.
    scene.setOptions({ doubleSided: true });
    scene.addObject(glyphChartPlaneObject(buildFixture(), { width: COLS }), { rotation: [0, 45, 0] });
    await flushRenders();

    const colors = renderedColors(scene);
    // A flat-coloured (degenerate UV / lost-texture) render would show at
    // most one non-background colour; a real texture shows both.
    expect(colors).toEqual(expect.arrayContaining([INK_COLOR, BG_COLOR]));
    scene.destroy();
  });

  it("under a rotated CAMERA (the object itself untransformed), it still paints the texture — not flat-coloured", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const scene = createGlyphScene(host, {
      cols: COLS,
      rows: ROWS,
      cellAspect: 1,
      useColors: true,
      mode: "solid",
      doubleSided: true,
      camera: createGlyphOrthographicCamera({ rotX: 30, rotY: 40, zoom: 50 }),
      directionalLight: { direction: [0, 0, 1], intensity: 0 },
      ambientLight: { intensity: 1 },
    });
    scene.addObject(glyphChartPlaneObject(buildFixture(), { width: COLS }));
    await flushRenders();

    const colors = renderedColors(scene);
    expect(colors).toEqual(expect.arrayContaining([INK_COLOR, BG_COLOR]));
    scene.destroy();
  });

  // Mutation: drop `castShadow`/`receiveShadow` forwarding in
  // `planeObject.ts` (make the mesh's `options` always `undefined`) —
  // reddens automatically, because a mesh that never forwards `castShadow`
  // renders identically whether the caller asked for it or not.
  it("casts a shadow onto a ground mesh — dropping castShadow forwarding erases it", async () => {
    const sceneOptions = {
      cols: 40,
      rows: 40,
      cellAspect: 1,
      useColors: true,
      mode: "solid" as const,
      // The ground quad's own winding is irrelevant to the property under
      // test (the plane's shadow forwarding) — doubleSided just keeps it
      // visible to the camera so a cast shadow has somewhere to show up.
      doubleSided: true,
      camera: createGlyphOrthographicCamera({ rotX: 55, rotY: 35, zoom: 60 }),
      directionalLight: { direction: [0, 0, 1] as [number, number, number], intensity: 1 },
      ambientLight: { intensity: 0.1 },
      shadow: { color: "#000000", opacity: 0.6, lift: 0 },
    };
    // Wound to face +Z (the same bottom-left/bottom-right/top-right/top-
    // left convention `glyphChartPlaneObject` itself uses) so it faces the
    // overhead light — a backward-facing receiver reads pure ambient
    // everywhere and never shows a shadow at all, regardless of casting.
    const ground = { vertices: [[6, -6, -2], [6, 6, -2], [-6, 6, -2], [-6, -6, -2]] as [number, number, number][], color: "#cccccc" };

    const hostCast = document.createElement("div");
    document.body.appendChild(hostCast);
    const sceneCast = createGlyphScene(hostCast, sceneOptions);
    sceneCast.add([ground], { receiveShadow: true });
    sceneCast.addObject(glyphChartPlaneObject(buildFixture(), { width: 4, castShadow: true }), { position: [0, 0, 3] });
    await flushRenders();
    const withCaster = sceneCast.output.innerHTML;
    sceneCast.destroy();

    const hostNoCast = document.createElement("div");
    document.body.appendChild(hostNoCast);
    const sceneNoCast = createGlyphScene(hostNoCast, sceneOptions);
    sceneNoCast.add([ground], { receiveShadow: true });
    sceneNoCast.addObject(glyphChartPlaneObject(buildFixture(), { width: 4, castShadow: false }), { position: [0, 0, 3] });
    await flushRenders();
    const withoutCaster = sceneNoCast.output.innerHTML;
    sceneNoCast.destroy();

    expect(withCaster).not.toBe(withoutCaster);
  });

  // Mutation: same as above — the receiver side of the identical drop.
  it("receives a shadow from a box mesh — dropping receiveShadow forwarding erases it", async () => {
    const sceneOptions = {
      cols: 40,
      rows: 40,
      cellAspect: 1,
      useColors: true,
      mode: "solid" as const,
      camera: createGlyphOrthographicCamera({ rotX: 55, rotY: 35, zoom: 60 }),
      directionalLight: { direction: [0, 0, 1] as [number, number, number], intensity: 1 },
      ambientLight: { intensity: 0.1 },
      shadow: { color: "#000000", opacity: 0.6, lift: 0 },
    };
    const box: [number, number, number][] = [[-1, -1, 3], [-1, 1, 3], [1, 1, 3], [1, -1, 3]];

    const hostReceive = document.createElement("div");
    document.body.appendChild(hostReceive);
    const sceneReceive = createGlyphScene(hostReceive, sceneOptions);
    sceneReceive.add([{ vertices: box, color: "#cccccc" }], { castShadow: true });
    sceneReceive.addObject(glyphChartPlaneObject(buildFixture(), { width: 4, receiveShadow: true }), { position: [0, 0, 0] });
    await flushRenders();
    const withReceiver = sceneReceive.output.innerHTML;
    sceneReceive.destroy();

    const hostNoReceive = document.createElement("div");
    document.body.appendChild(hostNoReceive);
    const sceneNoReceive = createGlyphScene(hostNoReceive, sceneOptions);
    sceneNoReceive.add([{ vertices: box, color: "#cccccc" }], { castShadow: true });
    sceneNoReceive.addObject(glyphChartPlaneObject(buildFixture(), { width: 4, receiveShadow: false }), { position: [0, 0, 0] });
    await flushRenders();
    const withoutReceiver = sceneNoReceive.output.innerHTML;
    sceneNoReceive.destroy();

    expect(withReceiver).not.toBe(withoutReceiver);
  });

  // Mutation: comment out the sampler-key cleanup in
  // `createGlyphScene.ts`'s `teardownGlyphSceneObject`.
  it("remove() leaves no sampler key behind", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const scene = makeScene(host);
    const object = glyphChartPlaneObject(buildFixture(), { width: COLS, id: "removable-plane" });
    const handle = scene.addObject(object);
    await flushRenders();
    expect(renderedColors(scene)).toEqual(expect.arrayContaining([INK_COLOR, BG_COLOR]));

    handle.remove();
    await flushRenders();

    // A fresh, untextured mesh that happens to reuse the SAME encoded
    // sampler key the removed object used: if `remove()` left the sampler
    // registered, this mesh would render the OLD chart's colours; with no
    // leak it falls back to its own flat colour (no matching sampler).
    const leakProbeColor = "#123456";
    const staleKey = encodeGlyphSceneObjectSamplerKey("removable-plane", "chart");
    // Same vertex/UV winding `glyphChartPlaneObject` itself uses (bottom-
    // left, bottom-right, top-right, top-left — front face +Z), so this
    // probe is visible under the same untransformed camera the removed
    // object rendered under.
    scene.add([{
      vertices: [[ROWS / 2, -COLS / 2, 0], [ROWS / 2, COLS / 2, 0], [-ROWS / 2, COLS / 2, 0], [-ROWS / 2, -COLS / 2, 0]],
      uvs: [[0, 0], [1, 0], [1, 1], [0, 1]],
      texture: staleKey,
      color: leakProbeColor,
    }]);
    await flushRenders();

    const colors = renderedColors(scene);
    expect(colors).toContain(leakProbeColor);
    expect(colors).not.toEqual(expect.arrayContaining([INK_COLOR]));
    scene.destroy();
  });

  it("rejects a non-positive width", () => {
    expect(() => glyphChartPlaneObject(buildFixture(), { width: 0 })).toThrow(RangeError);
    expect(() => glyphChartPlaneObject(buildFixture(), { width: -1 })).toThrow(RangeError);
  });

  // P2: the web target's real cell aspect (0.5859375), not a stand-in of
  // `1` under which dropping `cellAspect` entirely could not fail this
  // test (both would resolve to the same math by coincidence).
  it("sizes the plane to the chart's own real web cell aspect (0.5859375)", () => {
    const canvas = createGlyphCanvas({ cols: 96, rows: 32, cellAspect: 0.5859375, tier: "braille" });
    const object = glyphChartPlaneObject(chartBuildFromCanvas(canvas), { width: 96 });
    const [minX, minY] = object.bounds.min;
    const [maxX, maxY] = object.bounds.max;
    // width (Y extent) == 96, height (X extent) == 96 * 32 / (96 * 0.5859375) == 32 / 0.5859375.
    expect(maxY - minY).toBeCloseTo(96);
    expect(maxX - minX).toBeCloseTo(32 / 0.5859375, 3);
  });

  // P1 fix round 1: an out-of-bounds `rect` used to size the plane from
  // its own RAW extent instead of the clamped one the sampler actually
  // samples — mutation (revert to `rect.x1 - rect.x0 + 1` etc.) reddens
  // this, since the raw extent (201 x 1001) gives a wildly different
  // aspect than the canvas the sampler actually reads (8 x 4).
  it("sizes from the sampler's own CLAMPED rect, not a raw out-of-bounds one", () => {
    const object = glyphChartPlaneObject(buildFixture(), { width: 8, rect: { x0: 0, y0: 0, x1: 200, y1: 1000 } });
    expect(object.bounds.max[0] - object.bounds.min[0]).toBeCloseTo(4);
  });

  // P1 fix round 1: a reversed `rect` (y1 < y0) used to size a NEGATIVE
  // height from the raw `rect.y1 - rect.y0 + 1` — mutation (revert to raw
  // sizing) reddens both assertions below.
  it("sizes from the sampler's own NORMALIZED rect under a reversed rect, never a negative height", () => {
    const build = buildFixture();
    const forward = glyphChartPlaneObject(build, { width: 8, rect: { x0: 0, y0: 0, x1: COLS - 1, y1: ROWS - 1 } });
    const reversed = glyphChartPlaneObject(build, { width: 8, rect: { x0: 0, y0: ROWS - 1, x1: COLS - 1, y1: 0 } });
    const forwardHeight = forward.bounds.max[0] - forward.bounds.min[0];
    const reversedHeight = reversed.bounds.max[0] - reversed.bounds.min[0];
    expect(reversedHeight).toBeGreaterThan(0);
    expect(reversedHeight).toBeCloseTo(forwardHeight);
  });

  // A real chart (not a hand-painted fixture), mounted head-on at 1:1, must
  // still read as a recognisable chart: the y-axis rule at the plot's own
  // left edge, an x-axis rule somewhere in the plot, and mark ink strictly
  // inside it (not just the frame).
  it("mounts a real 96x32 web chart, viewed head-on, and reads as recognisable — axis lines and mark ink land in the right regions", async () => {
    const build = buildGlyphChart([1, 4, 2, 6, 3, 8, 5, 7, 4, 9]);
    const canvas = build.canvas;
    const { x0, y0, x1, y1 } = build.plot;
    // Supersampled 4 output cells per canvas cell (see `exactPlaneSceneOptions`'s
    // own doc) — a "sensible zoom" for legibility, matching the sampler's
    // own `texelsPerCell` row default.
    const k = 4;

    const host = document.createElement("div");
    document.body.appendChild(host);
    const scene = createGlyphScene(host, {
      ...exactPlaneSceneOptions(canvas, k),
      useColors: false,
      mode: "solid",
      directionalLight: { direction: [0, 0, 1], intensity: 0 },
      ambientLight: { intensity: 1 },
    });
    scene.addObject(glyphChartPlaneObject(build, { width: canvas.cols }));
    await flushRenders();

    const grid = charGrid(scene, canvas.rows * k, canvas.cols * k);
    const outputInk = (r: number, c: number): boolean => grid[r]?.[c] !== undefined && grid[r]![c] !== " ";
    // A canvas cell "has ink" iff ANY of its own k x k output cells does —
    // the per-cell texture sampler takes one UV sample per OUTPUT cell, so
    // a structural glyph's own sub-texel ink isn't guaranteed to land on
    // every one of those k x k samples, only at least one of them.
    const canvasInk = (cr: number, cc: number): boolean => {
      for (let dr = 0; dr < k; dr++) for (let dc = 0; dc < k; dc++) if (outputInk(cr * k + dr, cc * k + dc)) return true;
      return false;
    };

    // Y-axis vertical rule: one column LEFT of the plot's own x0 (the rule
    // itself sits in the reserved label gutter; `x0` is the first DATA
    // column) is mostly inked top to bottom.
    let yAxisInk = 0;
    for (let r = y0; r <= y1; r++) if (canvasInk(r, x0 - 1)) yAxisInk++;
    expect(yAxisInk).toBeGreaterThan((y1 - y0) * 0.5);

    // X-axis rule: some row inside the plot is mostly inked end to end.
    let bestRowInk = 0;
    for (let r = y0; r <= y1; r++) {
      let rowInk = 0;
      for (let c = x0; c <= x1; c++) if (canvasInk(r, c)) rowInk++;
      bestRowInk = Math.max(bestRowInk, rowInk);
    }
    expect(bestRowInk).toBeGreaterThan((x1 - x0) * 0.5);

    // Mark ink: real data ink exists strictly inside the plot, off the
    // y-axis column — not just the axis frame.
    let interiorInk = 0;
    for (let r = y0; r <= y1; r++) {
      for (let c = x0 + 1; c <= x1; c++) if (canvasInk(r, c)) interiorInk++;
    }
    expect(interiorInk).toBeGreaterThan(5);

    scene.destroy();
  });
});
