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
import { createGlyphOrthographicCamera, createGlyphScene, type GlyphCamera } from "glyphcss";
import { layout3d, renderGlyphDiagram3d, type GlyphDiagram3dNode } from "@glyphcss/diagrams/3d";
import { glyphGraphFromJson } from "@glyphcss/diagrams";
import { getGlyphEffect, defaultGlyphEffectParams } from "@glyphcss/effects";

const GRAPH = glyphGraphFromJson({
  nodes: [{ id: "a", label: "Alpha" }, { id: "b", label: "Beta" }, { id: "c", label: "Gamma" }],
  edges: [{ from: "a", to: "b" }, { from: "b", to: "c" }],
  direction: "TB",
});
const COLS = 96, ROWS = 40, CELL_ASPECT = 2.0;

interface Fit { readonly camera: GlyphCamera; readonly rows: readonly string[]; }

async function buildCamera() {
  const fit = await renderGlyphDiagram3d(GRAPH, { layout: "layered", zBy: "none", target: "web", width: COLS, height: ROWS });
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
    const definition = getGlyphEffect("glitch")!;
    const layer = scene.addEffectLayer({ effect: definition, params: { ...defaultGlyphEffectParams(definition), time: 0.5 }, target: handle.meshes.get(`node:${targetNodeId}`) });
    expect(layer).toBeDefined();
  }
  scene.rerender();
  const text = scene.output.textContent ?? "";
  const rows = text.split("\n");
  scene.destroy();
  expect(rows.length, "scene.output.textContent should be `rows` newline-joined lines").toBe(ROWS);
  for (const row of rows) expect(row.length, "each row should be exactly `cols` characters").toBe(COLS);
  return { camera, rows };
}

function diffCells(a: readonly string[], b: readonly string[]): { row: number; col: number }[] {
  const diffs: { row: number; col: number }[] = [];
  for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) {
    if (a[row]![col] !== b[row]![col]) diffs.push({ row, col });
  }
  return diffs;
}

/**
 * P2-3 (fix round 2) — the disjointness check alone doesn't prove targeting
 * A never touches a cell that is neither A's own nor B's (a stray background
 * or edge cell changing under both targets would still read as "disjoint").
 * This computes, per node, the padded screen-space cell box its own mesh
 * can possibly occupy — `layout3d`'s `center`/`half` projected through the
 * SAME camera `renderWithTarget` builds (D1's own layout is deterministic
 * and SEEDED, AGENTS.md's Diagrams 3D contract, so re-deriving it here
 * reproduces the identical geometry, not merely "close enough") — so the
 * strengthened test below can assert every changed cell falls inside the
 * TARGETED node's own box, never a foreign one's, and that every cell
 * belonging to a NON-target node is byte-identical to the no-effect
 * baseline.
 */
async function nodeCellBoxes(camera: GlyphCamera): Promise<ReadonlyMap<string, { minCol: number; maxCol: number; minRow: number; maxRow: number }>> {
  const layout = await layout3d(GRAPH, { layout: "layered", zBy: "none" });
  const boxes = new Map<string, { minCol: number; maxCol: number; minRow: number; maxRow: number }>();
  for (const node of layout.nodes as readonly GlyphDiagram3dNode[]) {
    let minCol = Infinity, maxCol = -Infinity, minRow = Infinity, maxRow = -Infinity;
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      const corner: [number, number, number] = [
        node.center[0] + sx * node.half[0], node.center[1] + sy * node.half[1], node.center[2] + sz * node.half[2],
      ];
      const [col, row] = camera.project(corner, COLS, ROWS, CELL_ASPECT);
      minCol = Math.min(minCol, col); maxCol = Math.max(maxCol, col);
      minRow = Math.min(minRow, row); maxRow = Math.max(maxRow, row);
    }
    // No padding: adjacent nodes' boxes can already overlap at this camera
    // (a compact auto-fit view of a small TB graph), so widening them
    // further would let a cell genuinely inside the TARGET's own box get
    // mistaken for a foreign node's — measured exact at `PAD = 0` for this
    // fixture (every changed cell landed inside its own node's real
    // projected box with no rounding slack needed).
    boxes.set(node.id, { minCol: Math.floor(minCol), maxCol: Math.ceil(maxCol), minRow: Math.floor(minRow), maxRow: Math.ceil(maxRow) });
  }
  return boxes;
}

function inBox(cell: { row: number; col: number }, box: { minCol: number; maxCol: number; minRow: number; maxRow: number }): boolean {
  return cell.col >= box.minCol && cell.col <= box.maxCol && cell.row >= box.minRow && cell.row <= box.maxRow;
}

it("targeting one node's own mesh changes only that node's own cells, never another node's", async () => {
  const baseline = await renderWithTarget(null);
  const targetedA = await renderWithTarget("a");
  const targetedB = await renderWithTarget("b");

  const diffA = diffCells(baseline.rows, targetedA.rows);
  const diffB = diffCells(baseline.rows, targetedB.rows);

  // Mutation: mount the effect with no `target` (scene-wide) → `diffA`
  // covers node b's/c's cells too, so the box checks below redden.
  expect(diffA.length, "targeting node a should paint SOMETHING").toBeGreaterThan(0);
  expect(diffB.length, "targeting node b should paint SOMETHING").toBeGreaterThan(0);

  const boxes = await nodeCellBoxes(baseline.camera);
  const boxA = boxes.get("a")!, boxB = boxes.get("b")!, boxC = boxes.get("c")!;

  // Every CHANGED cell must fall inside the TARGETED node's own padded box.
  // Mutation: target the WHOLE scene (`target: undefined`) regardless of
  // the requested node id → these pick up node b's/c's own cells (well
  // outside a's/b's own box) and redden.
  const outsideA = diffA.filter((cell) => !inBox(cell, boxA));
  const outsideB = diffB.filter((cell) => !inBox(cell, boxB));
  expect(outsideA, "every cell targeting a changes must lie inside node a's own box").toEqual([]);
  expect(outsideB, "every cell targeting b changes must lie inside node b's own box").toEqual([]);

  // The disjointness AGENTS.md's own acceptance criterion asks for falls
  // out of the two box checks above (disjoint boxes → disjoint diffs), kept
  // as its own explicit assertion since it is the literal wording of the
  // acceptance criterion.
  const inBothBoxes = diffA.filter((cell) => diffB.some((other) => other.row === cell.row && other.col === cell.col));
  expect(inBothBoxes, "cells changed by targeting a must be disjoint from cells changed by targeting b").toEqual([]);

  // P2-3 (fix round 2) — the complementary, literal statement: every cell
  // belonging to a NON-target node (b's and c's own boxes, while targeting
  // a) is byte-identical to the no-effect baseline — not merely "not in
  // diffA", which a mutation that painted the WRONG node instead of a could
  // still satisfy by chance if it happened to skip b/c too.
  for (const [label, box] of [["b", boxB], ["c", boxC]] as const) {
    for (let row = Math.max(0, box.minRow); row <= Math.min(ROWS - 1, box.maxRow); row++) {
      for (let col = Math.max(0, box.minCol); col <= Math.min(COLS - 1, box.maxCol); col++) {
        expect(targetedA.rows[row]![col], `targeting a must leave node ${label}'s own cell (row ${row}, col ${col}) unchanged`).toBe(baseline.rows[row]![col]);
      }
    }
  }
}, 20_000);
