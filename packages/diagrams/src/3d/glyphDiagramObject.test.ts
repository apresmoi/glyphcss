import { describe, expect, it } from "vitest";
import {
  buildCellGrid, createGlyphLabelArbiter, createGlyphOrthographicCamera, createGlyphScene,
  type CellGrid, type GlyphCamera, type GlyphOverlayFrame,
} from "glyphcss";
import { glyphGraphFromMermaid } from "../mermaid";
import { glyphGraphFromJson } from "../adapters";
import type { GlyphGraph } from "../types";
import { glyphDiagramObject, resolveGlyphDiagram3dLabelPlacement } from "./glyphDiagramObject";
import { layout3d } from "./layout3d";
import { renderGlyphDiagram3d } from "./render3d";

/**
 * `glyphDiagramObject` acceptance gates. D2 round 7 (user, verbatim: "we
 * need to use braille and blocks for 3d diagrams" / "edges as ribbon
 * geometry and arrowheads as cone/pyramid geometry, not stamped glyphs")
 * replaced every stamped edge/box-outline/arrowhead glyph with real MESH
 * GEOMETRY — this file's own gates test that geometry directly (polygon
 * counts, spatial extent, face orientation) rather than scanning a
 * rendered grid for a specific line-drawing character, since box-drawing/
 * bar glyphs no longer appear anywhere in this module's own output at all.
 * Each `it` names, in a comment, the mutation it is meant to redden.
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

const pairGraph: GlyphGraph = {
  direction: "TB",
  nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
  edges: [{ from: "a", to: "b" }],
};

const soloGraph: GlyphGraph = {
  direction: "TB",
  nodes: [{ id: "solo", label: "Solo" }],
  edges: [],
};

function fakeFrame(overrides: Partial<GlyphOverlayFrame> & { cols: number; rows: number }): GlyphOverlayFrame {
  const camera = { project: () => [0, 0, 0] as [number, number, number] } as unknown as GlyphCamera;
  return {
    camera, cellAspect: 1, layer: undefined, toWorld: (p) => p, ownMeshIds: new Set<number>(), labels: createGlyphLabelArbiter(),
    ...overrides,
  };
}

describe("glyphDiagramObject", () => {
  it("returns one node:<id> mesh per node, one edge mesh per edge, one group mesh per group — and no member declares a compileScene-unrepresentable option (mutation: drop a mesh kind from the list) → red", async () => {
    const object = await glyphDiagramObject(architectureGraph, { groupOutlines: true });
    const names = object.meshes.map((m) => m.name);
    for (const id of ["orchestrator", "planner", "coder", "reviewer"]) expect(names).toContain(`node:${id}`);
    expect(names.filter((n) => n.startsWith("edge:")).length).toBe(architectureGraph.edges.length);
    expect(names.filter((n) => n.startsWith("group:"))).toEqual(["group:agents"]);
    // The box is OPT-IN (user report: "can we remove the box around the
    // nodes? thats annoying") — the default draws no group mesh at all.
    const noOutlines = await glyphDiagramObject(architectureGraph);
    expect(noOutlines.meshes.filter((m) => m.name.startsWith("group:"))).toEqual([]);
    for (const mesh of object.meshes) {
      const opts = mesh.options as Record<string, unknown> | undefined;
      expect(opts?.density).toBeUndefined();
      expect(opts?.transparent).not.toBe(true);
      expect(opts?.glyphPalette).toBeUndefined();
      expect(opts?.ambientIntensity).toBeUndefined();
      expect(opts?.mode).toBeUndefined();
    }
  });

  it("an edge mesh is real ribbon GEOMETRY (polygons with real vertex extent), never empty, for both layouts (mutation: build an empty edge mesh) → red", async () => {
    for (const layout of ["layered", "force"] as const) {
      const object = await glyphDiagramObject(architectureGraph, { layout });
      const edgeMeshes = object.meshes.filter((m) => m.name.startsWith("edge:"));
      expect(edgeMeshes.length).toBe(architectureGraph.edges.length);
      for (const mesh of edgeMeshes) {
        expect(mesh.polygons.length).toBeGreaterThan(0);
        // At least one ribbon SEGMENT (6 faces each, a thin oriented box) —
        // an arrowhead alone (5 faces) is never the whole mesh.
        expect(mesh.polygons.length).toBeGreaterThanOrEqual(6);
      }
    }
  });

  it("a group's boundary is a real 12-edge ribbon OUTLINE mesh (12 * 6 = 72 faces) bounding every one of its own members (mutation: skip the group-outline mesh) → red", async () => {
    for (const layout of ["layered", "force"] as const) {
      const object = await glyphDiagramObject(architectureGraph, { layout, groupOutlines: true });
      const groupMesh = object.meshes.find((m) => m.name === "group:agents")!;
      expect(groupMesh).toBeDefined();
      expect(groupMesh.polygons.length).toBe(72);
      const laid = await layout3d(architectureGraph, { layout });
      const group = laid.groups.find((g) => g.id === "agents")!;
      const members = laid.nodes.filter((n) => ["planner", "coder", "reviewer"].includes(n.id));
      for (const m of members) {
        for (let axis = 0; axis < 3; axis++) {
          expect(m.center[axis] - m.half[axis]).toBeGreaterThanOrEqual(group.min[axis] - 1e-6);
          expect(m.center[axis] + m.half[axis]).toBeLessThanOrEqual(group.max[axis] + 1e-6);
        }
      }
    }
  });

  it("an edge's arrowhead APEX sits exactly on the edge's own final point (the target's face) — real oriented geometry, not a fixed cardinal glyph (mutation: build the arrowhead pointing the wrong way) → red", async () => {
    const object = await glyphDiagramObject(pairGraph, { arrowheads: true });
    const laid = await layout3d(pairGraph, {});
    const edge = laid.edges[0]!;
    const tip = edge.points[edge.points.length - 1]!;
    const edgeMesh = object.meshes.find((m) => m.name.startsWith("edge:"))!;
    // The apex vertex is the one SHARED by all 4 side triangles (appearing
    // 4 times across the mesh's own polygons) — the base cap's 4 corners
    // each appear fewer times. Count vertex occurrences by rounded key.
    const key = (v: readonly [number, number, number]) => v.map((x) => x.toFixed(6)).join(",");
    const counts = new Map<string, number>();
    for (const poly of edgeMesh.polygons) for (const v of poly.vertices) counts.set(key(v), (counts.get(key(v)) ?? 0) + 1);
    const [mostCommonKey] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]!;
    const apex = mostCommonKey.split(",").map(Number) as [number, number, number];
    expect(Math.hypot(apex[0] - tip[0], apex[1] - tip[1], apex[2] - tip[2])).toBeLessThan(1e-6);
  });

  it("arrowheads never appear when arrowheads: false, and every edge mesh still exists as a ribbon (mutation: draw arrowheads unconditionally) → red", async () => {
    const withArrows = await glyphDiagramObject(pairGraph, { arrowheads: true });
    const withoutArrows = await glyphDiagramObject(pairGraph, { arrowheads: false });
    const edgeWith = withArrows.meshes.find((m) => m.name.startsWith("edge:"))!;
    const edgeWithout = withoutArrows.meshes.find((m) => m.name.startsWith("edge:"))!;
    expect(edgeWith.polygons.length).toBeGreaterThan(edgeWithout.polygons.length);
    expect(edgeWithout.polygons.length).toBeGreaterThan(0);
  });

  it("renderGlyphDiagram3d does not throw for a grouped diagram, in braille or blocks (mutation: reintroduce a compileScene-unrepresentable groups mesh) → red", async () => {
    for (const layout of ["layered", "force"] as const) {
      for (const charset of ["braille", "blocks"] as const) {
        await expect(renderGlyphDiagram3d(architectureGraph, { target: "web", layout, charset })).resolves.toBeDefined();
      }
    }
  });

  it("mounting the object in a real createGlyphScene renders painted geometry and every node's label (mutation: never call frame.labels.place) → red", async () => {
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
      cols: 96, rows: 32, useColors: false, camera, mode: "wireframe", charMode: "braille",
      directionalLight: { direction: [0.4, 0.6, 0.7], intensity: 0.8 },
      ambientLight: { intensity: 0.5 },
    });
    const handle = scene.addObject(object);
    for (const name of object.meshes.map((m) => m.name)) expect(handle.meshes.get(name)).toBeDefined();
    await flushRenders();
    const text = scene.output.textContent!;
    const lines = text.split("\n");

    // Real painted geometry — braille wireframe dots are never blank/space.
    const paintedCells = text.replace(/\s/g, "").length;
    expect(paintedCells).toBeGreaterThan(20);

    for (const label of ["Orchestrator", "Planner", "Coder", "Reviewer"]) {
      expect(lines.some((l) => l.includes(label))).toBe(true);
    }
    scene.destroy();
  });

  // D2 round 8 superseded this test's own premise (user, verbatim: "the
  // block itself stays fully visible: no label cell on any node's
  // silhouette, its own or a neighbour's"): under a projection this
  // degenerate every node's own silhouette IS the label's own candidate
  // cell, at EVERY direction tried, so there is no longer a "highest
  // priority still wins a visible cell" outcome to arbitrate — showing
  // ANY label here would mean showing it painted directly over a node's
  // own box, exactly what this round exists to stop. The correct,
  // intended outcome is that `pickGlyphDiagram3dLabelPlacements` drops
  // every one of them (each candidate collides with every node's own
  // identical silhouette) and `stamp()` never calls `frame.labels.place`
  // for a dropped label — so the grid stays exactly as seeded.
  it("under a fully degenerate projection (every node's own silhouette collapses to ONE shared cell) every label is DROPPED rather than painted over a node's own box (mutation: place it anyway when every candidate collides) → red", async () => {
    const object = await glyphDiagramObject(architectureGraph);
    const cols = 20, rows = 6;
    const grid: CellGrid = buildCellGrid(new Array(cols * rows).fill(" "), null, null, cols, rows);
    const camera = { project: () => [10, 2, 0] as [number, number, number] } as unknown as GlyphCamera;
    const arbiter = createGlyphLabelArbiter();
    const frame = fakeFrame({ cols, rows, camera, labels: arbiter, ownMeshIds: new Set(object.meshes.map((_, i) => i)) });
    object.overlays![0]!.stamp(grid, frame);
    (arbiter as unknown as { resolve(grid: CellGrid): void }).resolve(grid);
    expect(grid.char.every((c) => c === " ")).toBe(true);
  });

  it("shape follows node shape: cylinder gets a real cylinder mesh (not a 6-face box), diamond gets a true octahedron — 8 triangular faces, never a rotated box (mutation: always use boxPolygons) → red", async () => {
    const shapeGraph: GlyphGraph = {
      direction: "TB",
      nodes: [
        { id: "box", label: "Box" },
        { id: "cyl", label: "Cyl", shape: "cylinder" },
        { id: "dia", label: "Dia", shape: "diamond" },
      ],
      edges: [],
    };
    const object = await glyphDiagramObject(shapeGraph, {});
    const meshByName = new Map(object.meshes.map((m) => [m.name, m]));
    const boxMesh = meshByName.get("node:box")!, cylMesh = meshByName.get("node:cyl")!, diaMesh = meshByName.get("node:dia")!;

    expect(boxMesh.polygons.length).toBe(6);
    expect(cylMesh.polygons.length).toBeGreaterThan(6);

    // Diamond is a true octahedron now (8 triangular faces — a box's own 6
    // faces are quads) rather than the old 45-degree-rotated BOX, and its
    // own X-span sits EXACTLY at half[0]*2 (a pole vertex on each axis,
    // never past the node's own half-extent — the old rotated box
    // overshot it by its own diagonal). Reverting to `boxPolygons` fails
    // both the face count/shape check and, since a rotated box's diagonal
    // exceeds `half[0]*2`, would also fail a `toBeCloseTo` here.
    expect(diaMesh.polygons.length).toBe(8);
    expect(diaMesh.polygons.every((p) => p.vertices.length === 3)).toBe(true);
    const diaLayout = (await layout3d(shapeGraph, {})).nodes.find((n) => n.id === "dia")!;
    const xs = diaMesh.polygons.flatMap((p) => p.vertices.map((v) => v[0]));
    const diaXSpan = Math.max(...xs) - Math.min(...xs);
    expect(diaXSpan).toBeCloseTo(diaLayout.half[0] * 2, 5);
  });

  // Phase 1 of the "better diagrams" round — `rounded`/`stadium`/
  // `subroutine`/`asymmetric` used to fall through `nodePolygons`' default
  // branch (a plain 6-face box, indistinguishable from `rect`); each now
  // gets its own distinct solid.
  it("rounded/stadium/subroutine/asymmetric each get their OWN distinct solid, none of them the plain 6-quad box (mutation: fall through every case to boxPolygons) → red", async () => {
    const shapeGraph: GlyphGraph = {
      direction: "TB",
      nodes: [
        { id: "rounded", label: "Rounded", shape: "rounded" },
        { id: "stadium", label: "Stadium", shape: "stadium" },
        { id: "subroutine", label: "Subroutine", shape: "subroutine" },
        { id: "asymmetric", label: "Asymmetric", shape: "asymmetric" },
      ],
      edges: [],
    };
    const object = await glyphDiagramObject(shapeGraph, {});
    const meshByName = new Map(object.meshes.map((m) => [m.name, m]));
    // A plain box is exactly 6 quad (4-vertex) faces — every one of these
    // four shapes must differ from that on at least one of face count or
    // vertex-per-face shape, and no two of them may collapse onto the
    // SAME polygon count (each is a genuinely different solid).
    const isBox = (polys: { vertices: unknown[] }[]) => polys.length === 6 && polys.every((p) => p.vertices.length === 4);
    const counts = new Map<string, number>();
    for (const id of ["rounded", "stadium", "subroutine", "asymmetric"]) {
      const mesh = meshByName.get(`node:${id}`)!;
      expect(isBox(mesh.polygons)).toBe(false);
      counts.set(id, mesh.polygons.length);
    }
    expect(new Set(counts.values()).size).toBe(counts.size);
  });

  // Acceptance criterion (the task's own "must respect the node's own half
  // extents ... a wide node must render wide"): every shape's own drawn
  // mesh must (a) never exceed its node's own `±half` box on any axis and
  // (b) actually grow wider in X when the node's own `half[0]` grows —
  // `size[0]` maps straight onto `half[0]`/world X unambiguously (`layout3d
  // .ts`'s own `compressedSizes.get(id)[0] -> width -> half[0]`), so
  // comparing a wide-`size` graph against a narrow one isolates exactly the
  // property this criterion names, for every one of the new solids.
  it("every new solid's own drawn span never exceeds its node's ±half box, and a node with a larger half[0] actually renders wider in X, for every shape (mutation: use an isotropic size instead of per-axis stretch) → red", async () => {
    const shapes = ["rect", "rounded", "stadium", "circle", "diamond", "cylinder", "subroutine", "asymmetric"] as const;
    // Single-letter labels — a longer label (e.g. `"subroutine"`) would
    // widen the 2D-measured node width past the explicit narrow `size[0]`
    // (`layout3d.ts`'s own `Math.max(node.width, ceil(compressed[0]))`
    // readability floor, unrelated to this test), masking the very ratio
    // this test exists to prove.
    const wideGraph: GlyphGraph = { direction: "TB", nodes: shapes.map((shape) => ({ id: `${shape}-wide`, label: "n", shape, size: [20, 4, 4] as const })), edges: [] };
    const narrowGraph: GlyphGraph = { direction: "TB", nodes: shapes.map((shape) => ({ id: `${shape}-narrow`, label: "n", shape, size: [2, 4, 4] as const })), edges: [] };
    const wideObj = await glyphDiagramObject(wideGraph, {});
    const narrowObj = await glyphDiagramObject(narrowGraph, {});
    const wideLaid = await layout3d(wideGraph, {});
    const narrowLaid = await layout3d(narrowGraph, {});

    const meshSpan = (mesh: { polygons: { vertices: readonly (readonly number[])[] }[] }, center: readonly number[], axis: 0 | 1 | 2) => {
      const vals = mesh.polygons.flatMap((p) => p.vertices.map((v) => v[axis]! - center[axis]!));
      return Math.max(...vals) - Math.min(...vals);
    };

    for (const shape of shapes) {
      const wideMesh = wideObj.meshes.find((m) => m.name === `node:${shape}-wide`)!;
      const wideNode = wideLaid.nodes.find((n) => n.id === `${shape}-wide`)!;
      const narrowMesh = narrowObj.meshes.find((m) => m.name === `node:${shape}-narrow`)!;
      const narrowNode = narrowLaid.nodes.find((n) => n.id === `${shape}-narrow`)!;

      for (const [mesh, node] of [[wideMesh, wideNode], [narrowMesh, narrowNode]] as const) {
        for (const axis of [0, 1, 2] as const) {
          expect(meshSpan(mesh, node.center, axis)).toBeLessThanOrEqual(node.half[axis] * 2 + 1e-6);
        }
      }
      expect(wideNode.half[0]).toBeGreaterThan(narrowNode.half[0]); // sanity: the layout actually gave the wide graph a bigger half[0]
      const wideSpanX = meshSpan(wideMesh, wideNode.center, 0);
      const narrowSpanX = meshSpan(narrowMesh, narrowNode.center, 0);
      expect(wideSpanX).toBeGreaterThan(narrowSpanX * 2);
    }
  });

  it("an inside label is CLIPPED to its own face, never spilling past it (mutation: drop the clip) → red", () => {
    const narrowNode = { id: "n", label: "conv 28x28x6", shape: "rect" as const,
      center: [0, 0, 0] as const, half: [4.5, 1, 1] as const, kind: undefined, group: undefined, degree: 0 };
    const placement = resolveGlyphDiagram3dLabelPlacement(narrowNode as any, "conv 28x28x6", "inside");
    expect(placement.isSide).toBe(false);
    expect(placement.text.length).toBeLessThanOrEqual(Math.floor(narrowNode.half[0] * 2));
    expect(placement.text).toBe("conv 28x2"); // 6 cells wide, clipped verbatim, no ellipsis
  });

  it("a side label's leader touches its own object — leaderFrom sits exactly on the node's own edge (mutation: drop the + half[0] offset) → red", () => {
    const node = { id: "n", label: "n", shape: "rect" as const,
      center: [5, 2, 1] as const, half: [1, 1, 0.5] as const, kind: undefined, group: undefined, degree: 0 };
    const placement = resolveGlyphDiagram3dLabelPlacement(node as any, "a much longer label than fits", "side");
    expect(placement.isSide).toBe(true);
    expect(placement.leaderFrom).toBeDefined();
    const [lx, ly, lz] = placement.leaderFrom!;
    expect(lx).toBe(node.center[0] + node.half[0]);
    expect(ly).toBe(node.center[1] - node.half[1]);
    expect(lz).toBe(node.center[2] + node.half[2]);
    expect(placement.anchor[0]).toBeGreaterThan(lx);
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

  it("a solo node with no edges/groups still renders a real node mesh and nothing else (isolation sanity check)", async () => {
    const object = await glyphDiagramObject(soloGraph, {});
    expect(object.meshes.map((m) => m.name)).toEqual(["node:solo"]);
  });
});
