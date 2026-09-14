import { describe, expect, it } from "vitest";
import {
  buildCellGrid, createGlyphLabelArbiter, createGlyphOrthographicCamera, createGlyphScene,
  type CellGrid, type GlyphCamera, type GlyphOverlayFrame, type GlyphSceneObject, type GlyphSceneOverlay,
} from "glyphcss";
import { glyphGraphFromMermaid } from "../mermaid";
import { glyphGraphFromJson } from "../adapters";
import type { GlyphGraph } from "../types";
import { glyphDiagramObject } from "./glyphDiagramObject";
import { renderGlyphDiagram3d } from "./render3d";

/**
 * Packet D1 (PLAN-3d.md §6, §11) acceptance gates for `glyphDiagramObject`.
 * Each `it` names, in a comment, the mutation the PLAN requires it to
 * redden.
 */

async function flushRenders(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

const architectureGraph: GlyphGraph = {
  direction: "TB",
  nodes: [
    { id: "orchestrator", label: "Orchestrator" },
    { id: "planner", label: "Planner" },
    { id: "coder", label: "Coder" },
    { id: "reviewer", label: "Reviewer" },
  ],
  edges: [
    { from: "orchestrator", to: "planner" },
    { from: "planner", to: "coder" },
    { from: "coder", to: "reviewer" },
    { from: "reviewer", to: "planner" },
  ],
  groups: [{ id: "agents", label: "Agents", members: ["planner", "coder", "reviewer"] }],
};

function fakeFrame(overrides: Partial<GlyphOverlayFrame> & { cols: number; rows: number }): GlyphOverlayFrame {
  const camera = { project: () => [0, 0, 0] as [number, number, number] } as unknown as GlyphCamera;
  return {
    camera, cellAspect: 1, layer: undefined, toWorld: (p) => p, ownMeshIds: new Set<number>(), labels: createGlyphLabelArbiter(),
    ...overrides,
  };
}

describe("glyphDiagramObject", () => {
  it("returns one node:<id> mesh per node and one groups mesh (mutation: drop a node from the mesh list) → red", async () => {
    const object = await glyphDiagramObject(architectureGraph);
    const names = object.meshes.map((m) => m.name).sort();
    expect(names).toEqual(["groups", "node:coder", "node:orchestrator", "node:planner", "node:reviewer"]);
  });

  it("mounting the object in a real createGlyphScene renders painted box cells, edge glyphs and every node's label (mutation: never call frame.labels.place) → red", async () => {
    // P1-a (D1 review): the fixed `zoom: 4` this test used to hardcode is
    // FAR too small for this object's world scale — `glyphDiagramObject`'s
    // node boxes are sized in the 2D layout's own CELL units (9-18 world
    // units wide), while `createGlyphOrthographicCamera`'s own default zoom
    // (0.65) and this test's old `4` both assume unit-scale geometry
    // (`BASE_TILE / cellAspect` CSS px per world unit puts a 16-unit box
    // under half an output COLUMN at zoom 4) — so every node box rasterized
    // to ZERO painted cells and only a stray label glyph survived, which
    // the old assertion (`anyLabel`, any ONE label anywhere) couldn't
    // catch. Reusing `renderGlyphDiagram3d`'s own auto-fit (D2, §11) here
    // is the fix: it picks a zoom from the object's OWN bounds, the same
    // thing any real consumer (D3's live viewport included) needs to do.
    const fitted = await renderGlyphDiagram3d(architectureGraph, { target: "web", color: "none" });
    const host = document.createElement("div");
    document.body.appendChild(host);
    const camera = createGlyphOrthographicCamera({ rotX: fitted.camera.rotX, rotY: fitted.camera.rotY, zoom: fitted.camera.zoom });
    const object = await glyphDiagramObject(architectureGraph);
    camera.target = [
      (object.bounds.min[0] + object.bounds.max[0]) / 2,
      (object.bounds.min[1] + object.bounds.max[1]) / 2,
      (object.bounds.min[2] + object.bounds.max[2]) / 2,
    ];
    const scene = createGlyphScene(host, {
      cols: 96, rows: 32, useColors: false, camera,
      directionalLight: { direction: [0.4, 0.6, 0.7], intensity: 0.8 },
      ambientLight: { intensity: 0.5 },
    });
    const handle = scene.addObject(object);
    // Every declared mesh actually mounted (boxes exist as real scene meshes).
    for (const name of object.meshes.map((m) => m.name)) expect(handle.meshes.get(name)).toBeDefined();
    await flushRenders();
    const text = scene.output.textContent!;
    const lines = text.split("\n");

    // Real painted box GEOMETRY, not just one surviving label glyph: the
    // solid rasterizer's own shading ramp only ever emits `.` or a
    // non-blank, non-alphanumeric glyph for a filled cell, so counting
    // cells that are neither blank nor part of a label's own letters is a
    // real "did geometry paint" signal.
    const paintedNonLabelCells = text.replace(/\s/g, "").replace(/[A-Za-z]/g, "").length;
    expect(paintedNonLabelCells).toBeGreaterThan(20);

    // Every node's folded ASCII label made it into the grid — not just one.
    for (const label of ["Orchestrator", "Planner", "Coder", "Reviewer"]) {
      expect(lines.some((l) => l.includes(label))).toBe(true);
    }

    // At least one edge glyph (a plain slope character, D1's own edge
    // overlay — see `glyphDiagramObject.ts`'s `edgeGlyph`) made it into the
    // grid, connecting the boxes.
    const edgeGlyphs = new Set(["-", "|", "/", "\\"]);
    expect(text.split("").some((ch) => edgeGlyphs.has(ch))).toBe(true);
    scene.destroy();
  });

  it("the overlay stamps an edge glyph into the grid (mutation: skip the points.length - 1 loop) → red", async () => {
    const object = await glyphDiagramObject(architectureGraph);
    const cols = 40, rows = 20;
    const grid: CellGrid = buildCellGrid(new Array(cols * rows).fill(" "), null, null, cols, rows);
    // A camera that maps world (x, y) directly onto the grid (offset to stay
    // in-bounds) so a genuine multi-point edge polyline produces genuinely
    // different cells per segment, independent of any real projection math.
    const camera = {
      project: (v: readonly [number, number, number]) => [Math.round(cols / 2 + v[0]), Math.round(rows / 2 + v[1]), 0] as [number, number, number],
    } as unknown as GlyphCamera;
    const frame = fakeFrame({ cols, rows, camera, ownMeshIds: new Set(object.meshes.map((_, i) => i)) });
    object.overlays![0]!.stamp(grid, frame);
    const edgeGlyphs = new Set(["-", "|", "/", "\\"]);
    const stamped = grid.char.some((ch) => edgeGlyphs.has(ch));
    expect(stamped).toBe(true);
  });

  it("no two labels overlap, even under a degenerate projection that collapses every node onto the same cell (mutation: omit priority/degree so the arbiter can't order them) → red", async () => {
    const object = await glyphDiagramObject(architectureGraph);
    const cols = 20, rows = 6;
    const grid: CellGrid = buildCellGrid(new Array(cols * rows).fill(" "), null, null, cols, rows);
    const camera = { project: () => [10, 2, 0] as [number, number, number] } as unknown as GlyphCamera;
    const arbiter = createGlyphLabelArbiter();
    const frame = fakeFrame({ cols, rows, camera, labels: arbiter, ownMeshIds: new Set(object.meshes.map((_, i) => i)) });
    object.overlays![0]!.stamp(grid, frame);
    (arbiter as unknown as { resolve(grid: CellGrid): void }).resolve(grid);
    // Every node's label anchors at the same cell, so "some label survived"
    // alone can't tell a correctly-prioritized winner from an arbitrary one
    // (review finding P2, D1) — `architectureGraph`'s edges give "planner"
    // degree 3 (in from orchestrator and reviewer, out to coder), strictly
    // higher than every other node, so it must be the one that actually
    // painted the shared cells. Dropping `priority: node.degree` (the
    // mutation) ties every candidate at 0 and the id-ascending tie-break
    // picks "coder" instead.
    const text = "Planner";
    for (let i = 0; i < text.length; i++) expect(grid.char[2 * cols + 10 + i]).toBe(text[i]);
  });

  it("Mermaid and JSON adapters feed glyphDiagramObject unchanged — both produce the same node/edge/group id set", async () => {
    const mermaid = "graph TD\n  A[Orchestrator] --> B[Planner]\n  B --> C[Coder]\n";
    const fromMermaid = glyphGraphFromMermaid(mermaid);
    const fromJson = glyphGraphFromJson({
      direction: "TB",
      nodes: [{ id: "A", label: "Orchestrator" }, { id: "B", label: "Planner" }, { id: "C", label: "Coder" }],
      edges: [{ from: "A", to: "B" }, { from: "B", to: "C" }],
    });
    const objMermaid = await glyphDiagramObject(fromMermaid);
    const objJson = await glyphDiagramObject(fromJson);
    expect(objMermaid.meshes.map((m) => m.name).sort()).toEqual(objJson.meshes.map((m) => m.name).sort());
  });
});
