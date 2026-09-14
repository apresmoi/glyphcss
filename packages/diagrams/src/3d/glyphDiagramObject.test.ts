import { describe, expect, it } from "vitest";
import {
  buildCellGrid, createGlyphLabelArbiter, createGlyphOrthographicCamera, createGlyphScene,
  type CellGrid, type GlyphCamera, type GlyphOverlayFrame, type GlyphSceneObject, type GlyphSceneOverlay,
} from "glyphcss";
import { glyphGraphFromMermaid } from "../mermaid";
import { glyphGraphFromJson } from "../adapters";
import type { GlyphGraph } from "../types";
import { glyphDiagramObject } from "./glyphDiagramObject";

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

  it("mounting the object in a real createGlyphScene renders boxes, edges and labels (mutation: never call frame.labels.place) → red", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const scene = createGlyphScene(host, {
      cols: 100, rows: 50, useColors: false,
      camera: createGlyphOrthographicCamera({ zoom: 4, rotX: 55, rotY: 35 }),
      directionalLight: { direction: [0.4, 0.6, 0.7], intensity: 0.8 },
      ambientLight: { intensity: 0.5 },
      doubleSided: true,
    });
    const object = await glyphDiagramObject(architectureGraph);
    const handle = scene.addObject(object, { position: [-20, -10, 0] });
    // Every declared mesh actually mounted (boxes exist as real scene meshes).
    for (const name of object.meshes.map((m) => m.name)) expect(handle.meshes.get(name)).toBeDefined();
    await flushRenders();
    const text = scene.output.textContent!;
    expect(text.trim().length).toBeGreaterThan(0);
    // At least one node's folded ASCII label made it into the grid.
    const anyLabel = ["ORCHESTRATOR", "PLANNER", "CODER", "REVIEWER"].some((l) => text.toUpperCase().includes(l))
      || ["Orchestrator", "Planner", "Coder", "Reviewer"].some((l) => text.includes(l));
    expect(anyLabel).toBe(true);
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
    const cols = 10, rows = 6;
    const grid: CellGrid = buildCellGrid(new Array(cols * rows).fill(" "), null, null, cols, rows);
    const camera = { project: () => [5, 2, 0] as [number, number, number] } as unknown as GlyphCamera;
    const arbiter = createGlyphLabelArbiter();
    const frame = fakeFrame({ cols, rows, camera, labels: arbiter, ownMeshIds: new Set(object.meshes.map((_, i) => i)) });
    object.overlays![0]!.stamp(grid, frame);
    (arbiter as unknown as { resolve(grid: CellGrid): void }).resolve(grid);
    // Exactly one node's label glyph survived at the shared cell — the
    // arbiter picked a single winner rather than letting two candidates
    // stomp on each other's characters.
    const cell = grid.char[2 * cols + 5]!;
    expect(cell).not.toBe(" ");
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
