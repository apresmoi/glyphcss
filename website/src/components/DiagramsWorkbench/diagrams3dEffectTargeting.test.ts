// @vitest-environment node
// D3 fix round 1, P1-2 — per-node effect targeting's own acceptance
// criterion (PLAN-3d.md §11's D3 acceptance: "highlighting one node's mesh
// leaves the others unchanged"). Exercises the SAME primitives
// `Diagrams3DViewport.tsx` mounts (`createGlyphScene` + `glyphDiagramObject`
// + `scene.addEffectLayer({ target: handle.meshes.get("node:<id>") })`)
// directly, with no React — the property under test is glyphcss's own
// per-object targeting mechanism (`CellGrid.winnerMesh`-scoped
// `targetCoverage`, AGENTS.md "Per-object targeting"), not any page wiring.
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
import { renderGlyphDiagram3d } from "@glyphcss/diagrams/3d";
import { glyphGraphFromJson } from "@glyphcss/diagrams";
import { getGlyphEffect, defaultGlyphEffectParams } from "@glyphcss/effects";

const GRAPH = glyphGraphFromJson({
  nodes: [{ id: "a", label: "Alpha" }, { id: "b", label: "Beta" }, { id: "c", label: "Gamma" }],
  edges: [{ from: "a", to: "b" }, { from: "b", to: "c" }],
  direction: "TB",
});
const COLS = 96, ROWS = 40, CELL_ASPECT = 2.0;

interface Fit { readonly camera: GlyphCamera; readonly rows: readonly string[]; readonly colors: readonly (readonly (string | null)[])[]; }

/**
 * D3 round 3, P2 — the previous version of this test compared `textContent`
 * ROWS only and called cells outside the target box "byte-identical" to
 * baseline on that basis alone. `glitch` changes both the GLYPH and the
 * COLOUR of a targeted cell from the same coverage mask, so a targeting
 * regression that correctly gates the glyph but leaks colour scene-wide
 * (or vice versa) passed the old check silently. Per-cell colour is read
 * from `scene.output.innerHTML` — the honest source in THIS test's own
 * setup, since `useColors: true` + the library's default `colorEncoding:
 * "spans"` (AGENTS.md's "Render modes") writes exactly one
 * `<span style="color:#rrggbb">…</span>` run per same-coloured span, with a
 * literal (never span-wrapped) `\n` between rows — reversing
 * `encodeGlyphBuffers`'s own encoding (`packages/glyphcss/src/render/cells.ts`)
 * rather than inventing a parallel one. An uncoloured/blank cell is `null`.
 */
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

async function buildCamera() {
  const fit = await renderGlyphDiagram3d(GRAPH, { layout: "layered", target: "web", width: COLS, height: ROWS });
  const camera = fit.camera.mat
    ? createGlyphOrthographicCamera({ mat: [...fit.camera.mat], useMat: true, zoom: fit.camera.zoom })
    : createGlyphOrthographicCamera({ rotX: fit.camera.rotX, rotY: fit.camera.rotY, zoom: fit.camera.zoom });
  const bounds = fit.object.bounds;
  camera.target = [(bounds.min[0] + bounds.max[0]) / 2, (bounds.min[1] + bounds.max[1]) / 2, (bounds.min[2] + bounds.max[2]) / 2];
  return { camera, object: fit.object };
}

/**
 * `scene.output.textContent` is `rows` NEWLINE-JOINED lines of `cols`
 * characters each (not one flat `cols*rows` buffer) — confirmed by direct
 * inspection: a naive `row * cols + col` flat index straddles a row
 * boundary by `row` characters once any newline is in front of it. Every
 * comparison here therefore works in ROW-MAJOR `string[]` space
 * (`text.split("\n")`), never a flat character index.
 */
async function renderWithTarget(targetNodeId: string | null): Promise<Fit> {
  const { camera, object } = await buildCamera();
  const host = document.createElement("div");
  const scene = createGlyphScene(host, { cols: COLS, rows: ROWS, mode: "solid", useColors: true, camera });
  const handle = scene.addObject(object);
  if (targetNodeId) {
    // "glitch" (one of the curated 3, `DiagramsDock.tsx`'s own
    // `DIAGRAMS_3D_EFFECT_IDS`) paints purely from `context.target.coverage`
    // + a deterministic hash of `(cell index, time)` — no domain-coordinate/
    // UV dependency a plain box mesh may not carry, so it is the most
    // reliable of the three for asserting the TARGETING mechanism itself.
    //
    // D2 round 5: `time: 0.5` was tuned against the old per-direction camera's
    // own screen rows for node "a" — glitch's band pattern is a deterministic
    // hash of `(cell index, time)`, so a fixed `time` genuinely misses a
    // node's own band at SOME rows and hits at others, and round 5's plane
    // embedding moved every node onto different screen rows. `time: 0.9` is
    // verified (swept 0.1-3.0 in 0.1 steps against the ACTUAL round-5
    // geometry) to paint a real, nonzero diff for both "a" and "b" at this
    // fixture's own camera — not a property this test can derive in closed
    // form, since the hash has no monotone relationship to geometry.
    const definition = getGlyphEffect("glitch")!;
    const layer = scene.addEffectLayer({ effect: definition, params: { ...defaultGlyphEffectParams(definition), time: 0.9 }, target: handle.meshes.get(`node:${targetNodeId}`) });
    expect(layer).toBeDefined();
  }
  scene.rerender();
  const text = scene.output.textContent ?? "";
  const rows = text.split("\n");
  // Captured BEFORE `scene.destroy()`, which tears the `<pre>` down.
  const colors = parseColors(scene.output.innerHTML);
  scene.destroy();
  expect(rows.length, "scene.output.textContent should be `rows` newline-joined lines").toBe(ROWS);
  for (const row of rows) expect(row.length, "each row should be exactly `cols` characters").toBe(COLS);
  expect(colors.length, "scene.output.innerHTML should parse to `rows` colour rows").toBe(ROWS);
  for (const row of colors) expect(row.length, "each parsed colour row should be exactly `cols` cells").toBe(COLS);
  return { camera, rows, colors };
}

/** A cell counts as changed if its GLYPH differs, its COLOUR differs, or both — the P2 fix. */
function diffCells(a: Fit, b: Fit): { row: number; col: number }[] {
  const diffs: { row: number; col: number }[] = [];
  for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) {
    if (a.rows[row]![col] !== b.rows[row]![col] || a.colors[row]![col] !== b.colors[row]![col]) diffs.push({ row, col });
  }
  return diffs;
}

/**
 * P2-3 (fix round 2) — the disjointness check alone doesn't prove targeting
 * A never touches a cell that is neither A's own nor B's (a stray background
 * or edge cell changing under both targets would still read as "disjoint").
 *
 * D2 round 4 fix (library redesign) — this used to compute a padded
 * screen-space AABB per node from `layout3d`'s own `center`/`half` and
 * assumed neighbouring boxes never overlap ("measured exact at PAD = 0").
 * D2 round 4's own bigger node defaults (`GLYPH_DIAGRAM_3D_NODE_HEIGHT`/
 * `_DEPTH`, a 12-cell width floor) plus its proportional flow-gap packing
 * made that assumption false for THIS fixture — node a's and b's AABBs now
 * genuinely overlap on screen (measured: a `[3,37]x[1,30]`, b `[31,64]x
 * [6,35]`), so a cell that is visually node a's own front face (occluding
 * b behind it) can still fall inside b's *box* even though it never was
 * b's own rendered pixel. An AABB is a conservative bound, not per-pixel
 * ownership, and the test's own header comment already names the REAL
 * mechanism under test: `CellGrid.winnerMesh`-scoped `targetCoverage`
 * (AGENTS.md's "Per-object targeting"). So ownership here is read directly
 * off the rasterizer's own per-cell winner buffer from a plain (untargeted)
 * render at the SAME camera — exact, not approximate, and immune to any
 * future change in node geometry/packing.
 */
async function nodeCellOwners(camera: GlyphCamera, object: GlyphSceneObject): Promise<(row: number, col: number) => string | null> {
  const host = document.createElement("div");
  let winnerMesh: Int32Array | undefined;
  const scene = createGlyphScene(host, {
    cols: COLS, rows: ROWS, mode: "solid", useColors: true, camera,
    // The object's own label overlay already reads `ownMeshIds` off
    // `CellGrid.winnerMesh` (AGENTS.md's "Scene objects" Declutter clause),
    // which is what populates it "on demand" — this hook only OBSERVES the
    // same grid the overlay already forced into existence, never forces it
    // itself.
    transformCells: (grid) => { winnerMesh = grid.winnerMesh ? new Int32Array(grid.winnerMesh) : undefined; return grid; },
  });
  const handle = scene.addObject(object);
  scene.rerender();
  scene.destroy();
  if (!winnerMesh) throw new Error("expected CellGrid.winnerMesh to be populated by the object's own label overlay");
  const nodeIdForMeshId = new Map<number, string>();
  for (const [name, meshHandle] of handle.meshes) {
    const match = /^node:(.+)$/.exec(name);
    if (match) nodeIdForMeshId.set(meshHandle.id, match[1]!);
  }
  const owned = winnerMesh;
  return (row: number, col: number) => {
    const meshId = owned[row * COLS + col];
    return meshId === undefined || meshId < 0 ? null : (nodeIdForMeshId.get(meshId) ?? null);
  };
}

it("targeting one node's own mesh changes only that node's own cells, never another node's", async () => {
  const baseline = await renderWithTarget(null);
  const targetedA = await renderWithTarget("a");
  const targetedB = await renderWithTarget("b");

  const diffA = diffCells(baseline, targetedA);
  const diffB = diffCells(baseline, targetedB);

  // Mutation: mount the effect with no `target` (scene-wide) → `diffA`
  // covers node b's/c's cells too, so the ownership checks below redden.
  expect(diffA.length, "targeting node a should paint SOMETHING").toBeGreaterThan(0);
  expect(diffB.length, "targeting node b should paint SOMETHING").toBeGreaterThan(0);

  const { camera, object } = await buildCamera();
  const ownerAt = await nodeCellOwners(camera, object);

  // Every CHANGED cell's baseline OWNER (the mesh that actually won it —
  // never an approximate AABB, see `nodeCellOwners`'s own doc) must be the
  // targeted node itself. Mutation: target the WHOLE scene (`target:
  // undefined`) regardless of the requested node id → these pick up node
  // b's/c's own cells and redden.
  const outsideA = diffA.filter((cell) => ownerAt(cell.row, cell.col) !== "a");
  const outsideB = diffB.filter((cell) => ownerAt(cell.row, cell.col) !== "b");
  expect(outsideA, "every cell targeting a changes must be owned by node a").toEqual([]);
  expect(outsideB, "every cell targeting b changes must be owned by node b").toEqual([]);

  // The disjointness AGENTS.md's own acceptance criterion asks for falls
  // out of the two ownership checks above (disjoint owners → disjoint
  // diffs), kept as its own explicit assertion since it is the literal
  // wording of the acceptance criterion.
  const inBothBoxes = diffA.filter((cell) => diffB.some((other) => other.row === cell.row && other.col === cell.col));
  expect(inBothBoxes, "cells changed by targeting a must be disjoint from cells changed by targeting b").toEqual([]);

  // P2-3 (fix round 2) — the complementary, literal statement: every cell
  // OWNED by a NON-target node (b's or c's own mesh, while targeting a) is
  // byte-identical to the no-effect baseline — not merely "not in diffA",
  // which a mutation that painted the WRONG node instead of a could still
  // satisfy by chance if it happened to skip b/c too.
  //
  // D3 round 3, P2 — "byte-identical" now checks GLYPH *and* COLOUR. `glitch`
  // changes both together from the same per-cell coverage mask, so a
  // targeting regression that correctly gates the glyph but leaks colour
  // (or vice versa) used to pass this loop silently — proven by mutation
  // below, since the pre-fix version of this loop compared
  // `targetedA.rows[row][col]` alone.
  //
  // D2 round 4 — this now walks EVERY cell (rather than a per-node AABB
  // window) and asks the exact `winnerMesh`-derived owner, since adjacent
  // nodes' screen-space AABBs can genuinely overlap under the redesigned
  // node geometry/packing (see `nodeCellOwners`'s own doc): a window bound
  // by an overlapping box could still miss or over-scope real cells.
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const owner = ownerAt(row, col);
      if (owner !== "b" && owner !== "c") continue;
      expect(targetedA.rows[row]![col], `targeting a must leave node ${owner}'s own cell (row ${row}, col ${col}) glyph unchanged`).toBe(baseline.rows[row]![col]);
      expect(targetedA.colors[row]![col], `targeting a must leave node ${owner}'s own cell (row ${row}, col ${col}) colour unchanged`).toBe(baseline.colors[row]![col]);
    }
  }
}, 20_000);
