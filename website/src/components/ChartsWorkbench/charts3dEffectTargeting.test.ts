// @vitest-environment node
// Packet C4, item 4 — the shared Effects folder's own acceptance criterion,
// applied to `/charts` 3D: "targeting Surface changes only surface cells
// (glyph AND colour), and non-surface cells are byte-identical to the
// no-effect frame." Exercises the SAME primitives `Charts3dViewport.tsx`
// mounts (`createGlyphScene` + `glyphChartObject` + `scene.addEffectLayer({
// target: handle.meshes.get("surface") })`) directly, with no React — the
// property under test is glyphcss's own per-object targeting mechanism
// (`CellGrid.winnerMesh`-scoped `targetCoverage`, AGENTS.md "Per-object
// targeting"), not any page wiring. Mirrors
// `../DiagramsWorkbench/diagrams3dEffectTargeting.test.ts` (the reference
// this file was studied from), simplified for a single `"surface"` mesh
// plus overlay-only axis guides (confirmed by direct read of `object.ts`'s
// `glyphChartObject` — no second mesh to target).
vi.hoisted(async () => {
  const { Window } = await import("happy-dom");
  const window = new Window();
  const removeChild = window.Node.prototype.removeChild;
  window.Node.prototype.removeChild = function(child) {
    try { return removeChild.call(this, child); }
    catch (error) {
      if (error instanceof window.DOMException && error.message.includes("removeChild")) throw new window.DOMException(error.message, "NotFoundError");
      throw error;
    }
  };
  for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Event", "DOMException", "getComputedStyle"] as const) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === "window" ? window : window[key] });
  }
});
import { expect, it, vi } from "vitest";
import { createGlyphOrthographicCamera, createGlyphScene, type GlyphCamera, type GlyphSceneObject } from "glyphcss";
import { glyphChartObject, glyphChart3dFitCamera, GLYPH_CHART_3D_DEFAULT_CAMERA } from "@glyphcss/charts/3d";
import { getGlyphEffect, defaultGlyphEffectParams } from "@glyphcss/effects";
import { createCharts3dViewState, resolveCharts3dView } from "../../features/charts/model/chartsWorkbench3d";

const COLS = 96, ROWS = 40, CELL_ASPECT = 2.0;

interface Fit { readonly camera: GlyphCamera; readonly rows: readonly string[]; readonly colors: readonly (readonly (string | null)[])[]; }

// Same span-run-aware colour decoder `diagrams3dEffectTargeting.test.ts` uses
// (`encodeGlyphBuffers`'s own `<span style="color:#rrggbb">…</span>` runs
// with a literal `\n` between rows, `packages/glyphcss/src/render/cells.ts`).
const SPAN_RUN_RE = /<span style="color:([^;"]+)[^"]*">([^<]*)<\/span>|([^<]+)/g;
function decodeGlyphHtmlEntities(text: string): string {
  return text.replace(/&amp;|&lt;|&gt;/g, (entity) => (entity === "&amp;" ? "&" : entity === "&lt;" ? "<" : ">"));
}
function parseRowColors(rowHtml: string): (string | null)[] {
  const colors: (string | null)[] = [];
  SPAN_RUN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SPAN_RUN_RE.exec(rowHtml))) {
    const color = match[1] ?? null;
    const text = decodeGlyphHtmlEntities((color !== null ? match[2] : match[3]) ?? "");
    for (const _ch of text) colors.push(color);
  }
  return colors;
}
function parseColors(innerHtml: string): (string | null)[][] {
  return innerHtml.split("\n").map(parseRowColors);
}

function buildMarkAndBounds() {
  const resolved = resolveCharts3dView(createCharts3dViewState());
  if (!resolved.ok) throw new Error(resolved.error);
  return resolved.resolved.mark;
}

function buildCamera(bounds: { readonly min: readonly [number, number, number]; readonly max: readonly [number, number, number] }): GlyphCamera {
  const fit = glyphChart3dFitCamera({
    bounds, rotX: GLYPH_CHART_3D_DEFAULT_CAMERA.rotX, rotY: GLYPH_CHART_3D_DEFAULT_CAMERA.rotY,
    cols: COLS, rows: ROWS, sceneCellAspect: CELL_ASPECT,
  });
  const camera = createGlyphOrthographicCamera({ rotX: GLYPH_CHART_3D_DEFAULT_CAMERA.rotX, rotY: GLYPH_CHART_3D_DEFAULT_CAMERA.rotY, zoom: fit.zoom });
  camera.target = fit.target;
  return camera;
}

/** `scene.output.textContent` is `rows` newline-joined lines of `cols`
 *  characters each — same row-major convention `diagrams3dEffectTargeting.
 *  test.ts` verifies directly. */
async function renderWithTarget(targetId: "surface" | "all" | null): Promise<Fit> {
  const mark = buildMarkAndBounds();
  const object = glyphChartObject(mark);
  const camera = buildCamera(object.bounds);
  const host = document.createElement("div");
  const scene = createGlyphScene(host, { cols: COLS, rows: ROWS, cellAspect: CELL_ASPECT, mode: "solid", useColors: true, doubleSided: true, camera });
  const handle = scene.addObject(object);
  if (targetId !== null) {
    const definition = getGlyphEffect("glitch")!;
    const target = targetId === "surface" ? handle.meshes.get("surface") : undefined;
    const layer = scene.addEffectLayer({ effect: definition, params: { ...defaultGlyphEffectParams(definition), time: 0.9 }, target });
    expect(layer).toBeDefined();
  }
  scene.rerender();
  const text = scene.output.textContent ?? "";
  const rows = text.split("\n");
  const colors = parseColors(scene.output.innerHTML);
  scene.destroy();
  expect(rows.length).toBe(ROWS);
  for (const row of rows) expect(row.length).toBe(COLS);
  return { camera, rows, colors };
}

function diffCells(a: Fit, b: Fit): { row: number; col: number }[] {
  const diffs: { row: number; col: number }[] = [];
  for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) {
    if (a.rows[row]![col] !== b.rows[row]![col] || a.colors[row]![col] !== b.colors[row]![col]) diffs.push({ row, col });
  }
  return diffs;
}

/** Exact per-cell ownership off the rasterizer's own `CellGrid.winnerMesh`
 *  — never an approximate screen-space bound — mirroring
 *  `diagrams3dEffectTargeting.test.ts`'s own `nodeCellOwners`. A cell the
 *  surface mesh doesn't win (an overlay-only axis/tick/label cell, or
 *  blank background) reads `false`. */
async function surfaceCellOwners(): Promise<(row: number, col: number) => boolean> {
  const mark = buildMarkAndBounds();
  const object = glyphChartObject(mark);
  const camera = buildCamera(object.bounds);
  const host = document.createElement("div");
  let winnerMesh: Int32Array | undefined;
  const scene = createGlyphScene(host, {
    cols: COLS, rows: ROWS, cellAspect: CELL_ASPECT, mode: "solid", useColors: true, doubleSided: true, camera,
    // The object's own axis-triad overlay already reads `winnerMesh` (label
    // occlusion, AGENTS.md's "Scene objects" Declutter clause), which is
    // what populates it "on demand" — this hook only OBSERVES the same grid.
    transformCells: (grid) => { winnerMesh = grid.winnerMesh ? new Int32Array(grid.winnerMesh) : undefined; return grid; },
  });
  const handle = scene.addObject(object);
  scene.rerender();
  scene.destroy();
  if (!winnerMesh) throw new Error("expected CellGrid.winnerMesh to be populated by the object's own axis-triad overlay");
  const surfaceMeshId = handle.meshes.get("surface")!.id;
  const owned = winnerMesh;
  return (row: number, col: number) => owned[row * COLS + col] === surfaceMeshId;
}

it("targeting Surface changes only the surface mesh's own cells (glyph AND colour); non-surface cells stay byte-identical to the no-effect frame", async () => {
  const baseline = await renderWithTarget(null);
  const targetedSurface = await renderWithTarget("surface");
  const diff = diffCells(baseline, targetedSurface);

  // Mutation: mount the effect with no `target` (scene-wide, `targetId:
  // "all"`) instead of `handle.meshes.get("surface")` → this still paints
  // SOMETHING, so it alone doesn't catch a regression; the ownership check
  // below is what actually pins it.
  expect(diff.length, "targeting Surface should paint SOMETHING").toBeGreaterThan(0);

  const isSurface = await surfaceCellOwners();

  // Every CHANGED cell's baseline owner must be the surface mesh itself —
  // never an axis line, tick label, or grid cell. Mutation: pass `target:
  // undefined` (scene-wide) regardless of the requested target id → this
  // picks up overlay-only cells too and reddens.
  const outsideSurface = diff.filter((cell) => !isSurface(cell.row, cell.col));
  expect(outsideSurface, "every cell targeting Surface changes must be owned by the surface mesh").toEqual([]);

  // The complementary, literal statement: every cell NOT owned by the
  // surface mesh (an axis line/tick/label/grid cell, or blank background)
  // is byte-identical — glyph AND colour — to the no-effect baseline.
  // Mutation: a targeting regression that correctly gates the glyph but
  // leaks colour (or vice versa) is what the colour half of this check
  // catches specifically.
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      if (isSurface(row, col)) continue;
      expect(targetedSurface.rows[row]![col], `non-surface cell (row ${row}, col ${col}) glyph must stay unchanged`).toBe(baseline.rows[row]![col]);
      expect(targetedSurface.colors[row]![col], `non-surface cell (row ${row}, col ${col}) colour must stay unchanged`).toBe(baseline.colors[row]![col]);
    }
  }
}, 20_000);

// "Whole chart" (`target: undefined`, scene-wide) reaches every cell
// "Surface" does, identically — plus, since packet C5 made the axis triad's
// lines real `"axis-lines"` ribbon geometry (depth-producing, unlike the old
// stamped glyphs), cells on those lines too. So Surface's changed cells are a
// SUBSET of Whole chart's, each carrying the same glyph and colour.
it("targeting Whole chart (scene-wide) paints every cell Surface paints, identically, and may reach the axis-line geometry beyond it", async () => {
  const baseline = await renderWithTarget(null);
  const targetedSurface = await renderWithTarget("surface");
  const targetedAll = await renderWithTarget("all");
  const surfaceChanged = diffCells(baseline, targetedSurface);
  expect(surfaceChanged.length).toBeGreaterThan(0);
  for (const { row, col } of surfaceChanged) {
    expect(targetedAll.rows[row]![col], `surface cell (row ${row}, col ${col}) glyph under Whole chart`).toBe(targetedSurface.rows[row]![col]);
    expect(targetedAll.colors[row]![col], `surface cell (row ${row}, col ${col}) colour under Whole chart`).toBe(targetedSurface.colors[row]![col]);
  }
  expect(diffCells(baseline, targetedAll).length).toBeGreaterThanOrEqual(surfaceChanged.length);
}, 20_000);
