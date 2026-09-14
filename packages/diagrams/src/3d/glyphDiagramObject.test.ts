import { describe, expect, it } from "vitest";
import {
  buildCellGrid, createGlyphLabelArbiter, createGlyphOrthographicCamera, createGlyphScene,
  type CellGrid, type GlyphCamera, type GlyphOverlayFrame, type GlyphSceneObject, type GlyphSceneOverlay,
} from "glyphcss";
import { glyphGraphFromMermaid } from "../mermaid";
import { glyphGraphFromJson } from "../adapters";
import type { GlyphGraph } from "../types";
import { glyphDiagramObject, resolveGlyphDiagram3dLabelPlacement } from "./glyphDiagramObject";
import { layout3d } from "./layout3d";
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

/** A minimal, ungrouped, single-edge graph — isolates the NODE box outline (and the arrowhead) from `architectureGraph`'s own group-outline glyphs, which draw through the same `segmentGlyph` vocabulary and would otherwise confound a glyph-count assertion. */
const pairGraph: GlyphGraph = {
  direction: "TB",
  nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
  edges: [{ from: "a", to: "b" }],
};

/**
 * Same pair, laid out `LR` instead of `TB` — D2 fix round 3, P2-3 (codex
 * self-review): under `pairGraph`'s own TB layout at the arrowhead test's
 * camera, the edge's real travel direction happens to snap to the SAME
 * cardinal glyph ("▶") a "always return a fixed glyph" mutation would also
 * produce, so that test alone could not tell the two apart. An `LR` layout
 * places its two nodes predominantly along X rather than Z, so its edge's
 * real screen-space direction is genuinely different from the TB pair's —
 * asserting BOTH pairs' independently-computed expected glyphs is what
 * makes a single fixed glyph (any one glyph) fail on at least one of them.
 */
const pairGraphLR: GlyphGraph = {
  direction: "LR",
  nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
  edges: [{ from: "a", to: "b" }],
};

/** A single node, zero edges, zero groups — isolates the node box outline from EVERY other overlay glyph source (no edge, no group). */
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
  it("returns one node:<id> mesh per node, no groups mesh, and no member declares a compileScene-unrepresentable option (mutation: drop a node from the mesh list) → red", async () => {
    // D2 fix round 2 (codex, F5b): a `groups` mesh used to carry
    // `transparent: true` (layered) or `mode: "wireframe"` (force) — both
    // now REJECTED by `compileScene({ objects })`'s
    // `assertCompileMeshOptionsRepresentable` (a flat static compile has no
    // detail-layer pass to represent them with). Groups are drawn as a
    // depth-tested overlay outline instead (this file's next test), so
    // there is no `groups` mesh at all any more, and EVERY mesh this
    // object returns — node meshes included — must declare only
    // compile-representable options.
    const object = await glyphDiagramObject(architectureGraph);
    const names = object.meshes.map((m) => m.name).sort();
    expect(names).toEqual(["node:coder", "node:orchestrator", "node:planner", "node:reviewer"]);
    for (const mesh of object.meshes) {
      const opts = mesh.options as Record<string, unknown> | undefined;
      expect(opts?.density).toBeUndefined();
      expect(opts?.transparent).not.toBe(true);
      expect(opts?.glyphPalette).toBeUndefined();
      expect(opts?.ambientIntensity).toBeUndefined();
      expect(opts?.mode).toBeUndefined();
    }
  });

  it("a group's boundary renders as a depth-tested overlay outline, for both layered floor plates and force wireframe volumes (mutation: skip the group-outline loop) → red", async () => {
    for (const layout of ["layered", "force"] as const) {
      const object = await glyphDiagramObject(architectureGraph, { layout, tier: "ascii" });
      const camera = createGlyphOrthographicCamera({ rotX: 55, rotY: 35, zoom: 8 });
      const centroid: [number, number, number] = [
        (object.bounds.min[0] + object.bounds.max[0]) / 2,
        (object.bounds.min[1] + object.bounds.max[1]) / 2,
        (object.bounds.min[2] + object.bounds.max[2]) / 2,
      ];
      camera.target = centroid;
      const cols = 200, rows = 100;
      const grid: CellGrid = buildCellGrid(new Array(cols * rows).fill(" "), null, null, cols, rows);
      const frame = fakeFrame({ camera, cols, rows, toWorld: (p) => p });
      object.overlays![0]!.stamp(grid, frame);
      // The group outline paints SOME cell distinct from a blank grid —
      // the specific glyph varies by projected screen-space slope, so the
      // gate is "something painted", not a literal character.
      const paintedNonSpace = Array.from(grid.char).some((c) => c !== " " && c !== "");
      expect(paintedNonSpace).toBe(true);
    }
  });

  it("renderGlyphDiagram3d does not throw for a grouped diagram (mutation: reintroduce the transparent/wireframe groups mesh) → red", async () => {
    // The literal reproduction of the fix round's report: a `groups` mesh
    // used to make EVERY grouped diagram throw a `RangeError` the instant
    // `renderGlyphDiagram3d` routed through `compileScene({ objects })`.
    for (const layout of ["layered", "force"] as const) {
      await expect(renderGlyphDiagram3d(architectureGraph, { target: "web", layout })).resolves.toBeDefined();
    }
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

  it("box outline glyphs (the box tier's ─/│) disappear when boxOutline is disabled (mutation: drop the box-outline overlay loop) → red", async () => {
    // D2 fix round 3, P2-3 (codex): the pre-round gates only counted GENERIC
    // painted geometry — removing the box outline entirely kept them green,
    // since the node's own solid Lambert fill still paints plenty of
    // non-space cells. `soloGraph` (one node, zero edges, zero groups)
    // isolates the outline from every OTHER overlay glyph source, and `─`
    // (U+2500) / `│` (U+2502) never appear in the box tier's own solid
    // shading ramp — only `segmentGlyph`'s straight-run case emits them —
    // so a nonzero count is proof the outline itself painted, not merely
    // that SOME cell did.
    const cols = 200, rows = 100;
    const countOutlineGlyphs = async (boxOutline: boolean): Promise<number> => {
      // D2 round 6 — `resolveGlyphDiagram3dLabelPlacement`'s own screen-width
      // fix (real defect: a node's own label used to be checked against its
      // WORLD-unit face width, not the SCREEN-projected one) means "Solo"'s
      // own label can legitimately fall through to `"side"` mode at THIS
      // test's own deliberately zoomed-out camera, whose leader-line stamp
      // ALSO emits a `─`/`│` glyph — a real, correct consequence of the
      // fix, but one this test's own isolation (box outline ONLY) doesn't
      // want to count. `labelNodeIds: new Set()` suppresses every label
      // candidate outright, the same mechanism the adaptive large-graph
      // policy already uses (`render3d.ts`'s own doc).
      const object = await glyphDiagramObject(soloGraph, { tier: "box", boxOutline, labelNodeIds: new Set() });
      const camera = createGlyphOrthographicCamera({ rotX: 55, rotY: 35, zoom: 8 });
      camera.target = [
        (object.bounds.min[0] + object.bounds.max[0]) / 2,
        (object.bounds.min[1] + object.bounds.max[1]) / 2,
        (object.bounds.min[2] + object.bounds.max[2]) / 2,
      ];
      const grid: CellGrid = buildCellGrid(new Array(cols * rows).fill(" "), null, null, cols, rows);
      const frame = fakeFrame({ camera, cols, rows, toWorld: (p) => p });
      object.overlays![0]!.stamp(grid, frame);
      return grid.char.filter((c) => c === "─" || c === "│").length;
    };
    expect(await countOutlineGlyphs(true)).toBeGreaterThan(0);
    expect(await countOutlineGlyphs(false)).toBe(0);
  });

  it("the arrowhead glyph points toward its own edge's target (mutation: pick a fixed cardinal glyph regardless of travel direction) → red", async () => {
    // D2 fix round 3, P2-3 (codex, then self-review): the pre-round gates
    // only checked that SOME arrowhead-family glyph existed somewhere in
    // the frame — a mutation that always emitted (say) `▶` regardless of
    // the edge's actual screen-space direction stayed green. This test
    // recomputes the EXPECTED cardinal glyph independently (never importing
    // `arrowGlyph`) from the edge's own final two projected points through
    // the SAME camera, and asserts the EXACT glyph at the EXACT cell the
    // production code writes to — for TWO graphs (`pairGraph` TB,
    // `pairGraphLR` LR) whose real travel directions are genuinely
    // different, so a single always-return-this-glyph mutation (of ANY
    // glyph) can no longer coincidentally satisfy both.
    for (const graph of [pairGraph, pairGraphLR]) {
      const cols = 200, rows = 100;
      const object = await glyphDiagramObject(graph, { tier: "box" });
      const camera = createGlyphOrthographicCamera({ rotX: 55, rotY: 35, zoom: 8 });
      camera.target = [
        (object.bounds.min[0] + object.bounds.max[0]) / 2,
        (object.bounds.min[1] + object.bounds.max[1]) / 2,
        (object.bounds.min[2] + object.bounds.max[2]) / 2,
      ];
      const grid: CellGrid = buildCellGrid(new Array(cols * rows).fill(" "), null, null, cols, rows);
      const frame = fakeFrame({ camera, cols, rows, toWorld: (p) => p });
      object.overlays![0]!.stamp(grid, frame);

      const layout = await layout3d(graph, {});
      const points = layout.edges[0]!.points;
      const a = camera.project(points[points.length - 2]!, cols, rows, 1);
      const b = camera.project(points[points.length - 1]!, cols, rows, 1);
      const dCol = b[0] - a[0], dRow = b[1] - a[1];
      const expected = Math.abs(dCol) >= Math.abs(dRow) ? (dCol >= 0 ? "▶" : "◀") : (dRow >= 0 ? "▼" : "▲");
      const col = Math.round(b[0]), row = Math.round(b[1]);
      expect(grid.char[row * cols + col], `direction: ${graph.direction}`).toBe(expected);
    }
  });

  it("an arrowhead is refused when a genuinely FOREIGN mesh wins its cell nearer, but is NOT refused by its own target node (mutation: drop or widen the winnerMesh/depth exemption) → red", async () => {
    // D2 review, D2 fix round 3, P1-1 (codex): fix round 1 made the
    // arrowhead write unconditional (no depth test at all) because a FLAT
    // depth test against the raw winning depth lost every arrowhead to its
    // own target's nearer top face. That exemption was too WIDE — it also
    // let the arrowhead paint through a genuinely foreign node sitting
    // nearer at that exact cell. Narrowed: refuse the write only when the
    // depth-winning mesh is neither the edge's own source nor target AND
    // is nearer than the arrowhead's own point.
    const cols = 200, rows = 100;
    const object = await glyphDiagramObject(pairGraph, { tier: "box" });
    const camera = createGlyphOrthographicCamera({ rotX: 55, rotY: 35, zoom: 8 });
    camera.target = [
      (object.bounds.min[0] + object.bounds.max[0]) / 2,
      (object.bounds.min[1] + object.bounds.max[1]) / 2,
      (object.bounds.min[2] + object.bounds.max[2]) / 2,
    ];
    // `pairGraph`'s own mesh order is `node:a` then `node:b` (declaration
    // order) — `ownMeshIds`' insertion order (100, 101) maps a -> 100,
    // b -> 101, mirroring how `compileScene`/`createGlyphScene` really
    // assign ids (both walk `object.meshes` in array order).
    const ownMeshIds = new Set([100, 101]);
    const arrowGlyphs = new Set(["▲", "▶", "▼", "◀"]);

    // Baseline: render unoccluded (no `winnerMesh` buffer at all) and
    // locate the real arrowhead cell.
    const baseline: CellGrid = buildCellGrid(new Array(cols * rows).fill(" "), null, null, cols, rows);
    object.overlays![0]!.stamp(baseline, fakeFrame({ camera, cols, rows, toWorld: (p) => p, ownMeshIds }));
    const arrowIdx = baseline.char.findIndex((c) => arrowGlyphs.has(c));
    expect(arrowIdx).toBeGreaterThanOrEqual(0);
    const arrowGlyph = baseline.char[arrowIdx]!;

    // A genuinely FOREIGN winner (an id outside `ownMeshIds` entirely),
    // nearer than any real geometry — the arrow must NOT overwrite it.
    const foreign: CellGrid = buildCellGrid(new Array(cols * rows).fill(" "), null, null, cols, rows);
    foreign.winnerMesh = new Int32Array(cols * rows).fill(-1);
    foreign.winnerMesh[arrowIdx] = 999999;
    foreign.depth[arrowIdx] = 1e9;
    object.overlays![0]!.stamp(foreign, fakeFrame({ camera, cols, rows, toWorld: (p) => p, ownMeshIds }));
    expect(foreign.char[arrowIdx]).not.toBe(arrowGlyph);

    // The edge's own TARGET node ("b" -> mesh id 101) winning the SAME
    // cell, just as near — the arrow must STILL show; this is the
    // exemption the review's own P1-1 measurement required (a flat depth
    // test loses every arrowhead to its own target's nearer top face).
    const ownTarget: CellGrid = buildCellGrid(new Array(cols * rows).fill(" "), null, null, cols, rows);
    ownTarget.winnerMesh = new Int32Array(cols * rows).fill(-1);
    ownTarget.winnerMesh[arrowIdx] = 101;
    ownTarget.depth[arrowIdx] = 1e9;
    object.overlays![0]!.stamp(ownTarget, fakeFrame({ camera, cols, rows, toWorld: (p) => p, ownMeshIds }));
    expect(ownTarget.char[arrowIdx]).toBe(arrowGlyph);
  });

  it("shape follows node shape: cylinder gets a real cylinder mesh (not a 6-face box), diamond gets a box rotated 45° about its own center (mutation: always use boxPolygons) → red", async () => {
    // D2 round 3 (architecture objects) requirement 1: shape-aware node
    // geometry. A polygon-count/vertex-extent check rather than a visual
    // one — cheap, deterministic, and genuinely fails if the shape dispatch
    // is ever collapsed back to always-box.
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
    // A cylinder's default 16-sided mesh (16 walls + top + bottom cap) has
    // far more faces than a 6-face box — the shape genuinely changed, not
    // just its color/size.
    expect(cylMesh.polygons.length).toBeGreaterThan(6);

    // A diamond keeps the box's own 6 faces but ROTATED 45 degrees about
    // its own center — its vertices' own X extent grows by ~sqrt(2) over
    // an un-rotated box of the identical width, a signature no color or
    // size change alone could produce.
    const diaLayout = (await layout3d(shapeGraph, {})).nodes.find((n) => n.id === "dia")!;
    const xs = diaMesh.polygons.flatMap((p) => p.vertices.map((v) => v[0]));
    const diaXSpan = Math.max(...xs) - Math.min(...xs);
    // An un-rotated box's own X extent is exactly `half[0] * 2`. A 45-degree
    // rotation about its own center mixes the depth axis in — for a WIDE,
    // shallow box (the common label-sized case) that SHRINKS the X extent
    // rather than growing it, so the honest, direction-agnostic assertion
    // is simply "not equal to the unrotated width", not "wider".
    expect(diaXSpan).not.toBeCloseTo(diaLayout.half[0] * 2, 5);
  });

  it("an inside label is CLIPPED to its own face, never spilling past it (mutation: drop the clip) → red", () => {
    // D2 round 3, requirement 3 (labels: inside/side/auto). A node whose
    // custom `size` is deliberately narrower than its own label (the CNN
    // fixture's own conv/pool layers do this for real) — `"inside"` must
    // clip rather than let the label run past the node's own footprint.
    const narrowNode = { id: "n", label: "conv 28x28x6", shape: "rect" as const,
      center: [0, 0, 0] as const, half: [4.5, 1, 1] as const, kind: undefined, group: undefined, degree: 0 };
    const placement = resolveGlyphDiagram3dLabelPlacement(narrowNode as any, "conv 28x28x6", "inside");
    expect(placement.isSide).toBe(false);
    expect(placement.text.length).toBeLessThanOrEqual(Math.floor(narrowNode.half[0] * 2));
    expect(placement.text).toBe("conv 28x2"); // 6 cells wide, clipped verbatim, no ellipsis
  });

  it("a side label's leader touches its own object — leaderFrom sits exactly on the node's own edge (mutation: drop the + half[0] offset) → red", () => {
    // D2 round 3, requirement 3: "a side label must have its leader
    // touching its object" — asserted directly on the pure placement
    // function (the overlay's own leader-line stamp is a thin wrapper
    // around this exact point, see `glyphDiagramObject`'s label loop).
    const node = { id: "n", label: "n", shape: "rect" as const,
      center: [5, 2, 1] as const, half: [1, 1, 0.5] as const, kind: undefined, group: undefined, degree: 0 };
    const placement = resolveGlyphDiagram3dLabelPlacement(node as any, "a much longer label than fits", "side");
    expect(placement.isSide).toBe(true);
    expect(placement.leaderFrom).toBeDefined();
    const [lx, ly, lz] = placement.leaderFrom!;
    // Exactly the node's own +X face center — on the object, not floating
    // near it.
    expect(lx).toBe(node.center[0] + node.half[0]);
    expect(ly).toBe(node.center[1]);
    expect(lz).toBe(node.center[2] + node.half[2]);
    // The label's own anchor sits strictly further out than the leader's
    // start — free space, not overlapping the node.
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
});
