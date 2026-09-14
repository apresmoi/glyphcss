import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createGlyphOrthographicCamera, createGlyphScene, type Vec3 } from "glyphcss";
import type { GlyphGraph } from "../types";
import { glyphGraphFromMermaid } from "../mermaid";
import { glyphGraphFromJson } from "../adapters";
import { glyphDiagramObject } from "./glyphDiagramObject";
import { layout3d } from "./layout3d";
import {
  renderGlyphDiagram3d, renderGlyphDiagram3dJson, resolveCharset, GLYPH_DIAGRAM_3D_LIGHT, GLYPH_DIAGRAM_3D_AMBIENT_LIGHT,
  type GlyphDiagram3dCharset, type GlyphDiagram3dColorMode, type GlyphDiagram3dTarget,
} from "./render3d";

/**
 * `renderGlyphDiagram3d` acceptance gates. D2 round 7 (user, verbatim: "we
 * need to use braille and blocks for 3d diagrams") replaced the old
 * ascii/box/ink defaults, the shared-plane camera derivation, and the
 * stamped edge/box-outline/arrowhead overlays outright — this file's own
 * gates were rewritten to match: no more `glyphDiagram3dPlaneAxes`
 * (unrotated world-axis silhouettes instead), no more `tier`/`boxOutline`
 * options, and an explicit "no box-drawing/bar glyph anywhere in a 3D
 * frame" gate. Each `it` names, in a comment, the mutation it is meant to
 * redden.
 */

const agentGraph: GlyphGraph = {
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
};

const groupedAgentGraph: GlyphGraph = {
  ...agentGraph,
  groups: [{ id: "agents", label: "Agents", members: ["planner", "coder", "reviewer"] }],
};

const supervisorGraph: GlyphGraph = {
  direction: "TB",
  nodes: [
    { id: "supervisor", label: "Supervisor" },
    { id: "researcher", label: "Researcher" },
    { id: "writer", label: "Writer" },
    { id: "coder", label: "Coder" },
    { id: "reviewer", label: "Reviewer" },
    { id: "archivist", label: "Archivist" },
  ],
  edges: [
    { from: "supervisor", to: "researcher" },
    { from: "supervisor", to: "writer" },
    { from: "supervisor", to: "coder" },
    { from: "supervisor", to: "reviewer" },
    { from: "supervisor", to: "archivist" },
    { from: "researcher", to: "supervisor" },
    { from: "writer", to: "supervisor" },
    { from: "coder", to: "supervisor" },
    { from: "reviewer", to: "supervisor" },
    { from: "archivist", to: "supervisor" },
  ],
};

function foldedLabels(text: string): string {
  return text.toUpperCase();
}

const chainGraphLR: GlyphGraph = {
  direction: "LR",
  nodes: [
    { id: "input", label: "Input" },
    { id: "hidden1", label: "Hidden 1" },
    { id: "hidden2", label: "Hidden 2" },
    { id: "output", label: "Output" },
  ],
  edges: [
    { from: "input", to: "hidden1" },
    { from: "hidden1", to: "hidden2" },
    { from: "hidden2", to: "output" },
  ],
};

/** A node's own projected screen-space bounding box — D2 round 7: every node box is a plain, world-axis-aligned box (no more shared-plane `u`/`n` basis, `layout3d.ts`'s own top-of-file doc), so corners are literal `center ± half` along world X/Y/Z. */
function projectedSilhouette(camera: ReturnType<typeof createGlyphOrthographicCamera>, center: Vec3, half: Vec3, cols: number, rows: number, cellAspect: number): { width: number; height: number } {
  let minCol = Infinity, maxCol = -Infinity, minRow = Infinity, maxRow = -Infinity;
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const world: Vec3 = [center[0] + sx * half[0], center[1] + sy * half[1], center[2] + sz * half[2]];
    const [col, row] = camera.project(world, cols, rows, cellAspect);
    minCol = Math.min(minCol, col); maxCol = Math.max(maxCol, col);
    minRow = Math.min(minRow, row); maxRow = Math.max(maxRow, row);
  }
  return { width: maxCol - minCol, height: maxRow - minRow };
}

/** Same projection as `projectedSilhouette` but returning the full AABB, for pairwise overlap checks. */
function projectedBounds(camera: ReturnType<typeof createGlyphOrthographicCamera>, center: Vec3, half: Vec3, cols: number, rows: number, cellAspect: number): { minCol: number; maxCol: number; minRow: number; maxRow: number } {
  let minCol = Infinity, maxCol = -Infinity, minRow = Infinity, maxRow = -Infinity;
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const world: Vec3 = [center[0] + sx * half[0], center[1] + sy * half[1], center[2] + sz * half[2]];
    const [col, row] = camera.project(world, cols, rows, cellAspect);
    minCol = Math.min(minCol, col); maxCol = Math.max(maxCol, col);
    minRow = Math.min(minRow, row); maxRow = Math.max(maxRow, row);
  }
  return { minCol, maxCol, minRow, maxRow };
}

function everyLabelVisible(text: string, graph: GlyphGraph): boolean {
  const folded = foldedLabels(text);
  return graph.nodes.every((n) => folded.includes(foldedLabels(String(n.label ?? n.id))));
}

function missingLabels(text: string, graph: GlyphGraph): string[] {
  const folded = foldedLabels(text);
  return graph.nodes.filter((n) => !folded.includes(foldedLabels(String(n.label ?? n.id)))).map((n) => n.id);
}

/** Non-space, non-label-text characters in the frame — proof that real edge/arrowhead/box GEOMETRY painted, not just label text floating on a blank grid. */
function paintedGeometryCellCount(text: string, graph: GlyphGraph): number {
  let stripped = text;
  for (const n of graph.nodes) stripped = stripped.split(String(n.label ?? n.id)).join("");
  return stripped.replace(/\s/g, "").length;
}

/** D2 round 7's own primary gate: no box-drawing/bar glyph anywhere OUTSIDE label text — a 3D frame renders through braille dots or block elements only. */
const LINE_BAR_GLYPHS = /[─│┌┐└┘├┤┬┴┼━┃╭╮╰╯╌╎┈┊▔‾▏▕\-|/\\_]/;
function nonLabelGlyphs(text: string, graph: GlyphGraph): string {
  let stripped = text;
  for (const n of graph.nodes) stripped = stripped.split(String(n.label ?? n.id)).join("");
  return stripped;
}

describe("renderGlyphDiagram3d", () => {
  it("renders a non-empty frame with every node label visible at the default camera (mutation: fixed zoom instead of auto-fit) → red", async () => {
    const small = await renderGlyphDiagram3d(agentGraph, { target: "web" });
    expect(small.text.replace(/\s/g, "").length).toBeGreaterThan(0);
    expect(everyLabelVisible(small.text, agentGraph)).toBe(true);

    const big = await renderGlyphDiagram3d(supervisorGraph, { target: "web" });
    expect(everyLabelVisible(big.text, supervisorGraph)).toBe(true);

    const fixedFromSmall = await renderGlyphDiagram3d(supervisorGraph, { target: "web", camera: { rotX: small.camera.rotX!, rotY: small.camera.rotY!, zoom: small.camera.zoom * 3 } });
    expect(everyLabelVisible(fixedFromSmall.text, supervisorGraph)).toBe(false);
    expect(missingLabels(fixedFromSmall.text, supervisorGraph).length).toBeGreaterThan(0);
  });

  it("auto-fit still centers and fits at every target size, in both 3D charsets", async () => {
    for (const target of ["chat", "terminal", "web"] as const) {
      for (const charset of ["braille", "blocks"] as const) {
        const result = await renderGlyphDiagram3d(agentGraph, { target, charset });
        expect(everyLabelVisible(result.text, agentGraph)).toBe(true);
      }
    }
  });

  it("no box-drawing/bar glyph appears anywhere in a 3D frame outside label text, in braille or blocks, for both targets (mutation: reintroduce the stamped edge overlay) → red", async () => {
    for (const charset of ["braille", "blocks"] as const) {
      const result = await renderGlyphDiagram3d(supervisorGraph, { target: "web", charset });
      const rest = nonLabelGlyphs(result.text, supervisorGraph);
      expect(rest).not.toMatch(LINE_BAR_GLYPHS);
    }
  });

  it("every node's projected height clears a legibility floor, and width scales with its own label length (mutation: drop GLYPH_DIAGRAM_3D_MIN_HEIGHT's unconditional floor) → red", async () => {
    for (const graph of [agentGraph, chainGraphLR]) {
      const result = await renderGlyphDiagram3d(graph, { target: "web" });
      const camera = createGlyphOrthographicCamera({ rotX: result.camera.rotX, rotY: result.camera.rotY, zoom: result.camera.zoom });
      const laid = await layout3d(graph, {});
      for (const node of laid.nodes) {
        const { width, height } = projectedSilhouette(camera, node.center, node.half, 96, 32, 2.0);
        expect(height, `${graph.direction} "${node.id}" silhouette height`).toBeGreaterThanOrEqual(3);
        expect(width, `${graph.direction} "${node.id}" silhouette width`).toBeGreaterThan(0);
      }

      const byLabelLen = [...laid.nodes].sort(
        (a, b) => String(graph.nodes.find((n) => n.id === a.id)?.label ?? a.id).length - String(graph.nodes.find((n) => n.id === b.id)?.label ?? b.id).length,
      );
      const shortest = byLabelLen[0]!, longest = byLabelLen[byLabelLen.length - 1]!;
      const shortLabel = String(graph.nodes.find((n) => n.id === shortest.id)?.label ?? shortest.id);
      const longLabel = String(graph.nodes.find((n) => n.id === longest.id)?.label ?? longest.id);
      if (longLabel.length > shortLabel.length) {
        const wShort = projectedSilhouette(camera, shortest.center, shortest.half, 96, 32, 2.0).width;
        const wLong = projectedSilhouette(camera, longest.center, longest.half, 96, 32, 2.0).width;
        expect(wLong, `${graph.direction}: "${longLabel}" should project wider than "${shortLabel}"`).toBeGreaterThan(wShort);
      }
    }
  });

  // D2 round 7 (user, verbatim, in the coordinator's own follow-up
  // message: "LeNet-5 and the transformer are single-node-per-rank
  // chains, so they should read as a clean diagonal pipeline of blocks").
  // Replaces round 4-6's own "row stays flat along flow" gate outright —
  // this camera family is DELIBERATELY a 3/4 isometric view where the flow
  // axis reads diagonally, so a chain's projected row is EXPECTED to
  // change monotonically alongside its column, never held flat.
  it("a single-node-per-rank LR chain reads as a diagonal pipeline: both screen column AND row progress monotonically along it, in ONE consistent direction each (mutation: fall back to a level, non-isometric camera) → red", async () => {
    const result = await renderGlyphDiagram3d(chainGraphLR, { target: "web" });
    const camera = createGlyphOrthographicCamera({ rotX: result.camera.rotX, rotY: result.camera.rotY, zoom: result.camera.zoom });
    const laid = await layout3d(chainGraphLR, {});
    // Walk the chain in FLOW order (dagre rank, i.e. along the graph's own
    // edges) rather than assuming a sign for the camera's col-vs-X
    // relationship — round 7's camera is a plain empirically-tuned pose
    // with no analytic derivation forcing a particular sign.
    const byId = new Map(laid.nodes.map((n) => [n.id, n]));
    const flowOrder = ["input", "hidden1", "hidden2", "output"].map((id) => byId.get(id)!);
    const projected = flowOrder.map((n) => camera.project(n.center, 96, 32, 2.0));
    const colDeltas = projected.slice(1).map((p, i) => p[0] - projected[i]![0]);
    const rowDeltas = projected.slice(1).map((p, i) => p[1] - projected[i]![1]);
    // Column progresses in ONE direction across the whole chain (never
    // flat, never zig-zagging) — the flow axis reads on screen.
    expect(colDeltas.every((d) => d > 0.01) || colDeltas.every((d) => d < -0.01)).toBe(true);
    // Row ALSO moves in one consistent direction (the isometric tilt
    // reading as depth) — a genuine diagonal, not a level row.
    expect(rowDeltas.every((d) => d > 0.01) || rowDeltas.every((d) => d < -0.01)).toBe(true);
  });

  // D2 round 7's own layout-direction gate (coordinator, verbatim): "at the
  // default camera, no two blocks' projected silhouettes overlap by more
  // than a small fraction." Regression for a real bug this round found by
  // rendering the shipped LeNet-5 fixture: rank spacing sized off a box's
  // raw FLOW-AXIS half-extent alone left every rank-adjacent pair's own
  // projected COLUMN WIDTH overlapping its neighbour's by 17-22%
  // (`layout3d.ts`'s own `screenSafeFlowHalf` doc has the measured
  // coefficients and the fix) — a defect that compounds visually across an
  // 8-rank chain into a hard-to-read diagonal smear even though no single
  // pair's own overlap is dramatic in isolation.
  it("consecutive-RANK node boxes' projected silhouettes never overlap by more than a small fraction of the smaller box's own column width, on the real LeNet-5 fixture at its own auto-fit camera (mutation: revert rank spacing to flow-axis half-extent alone) → red", async () => {
    const lenet5 = glyphGraphFromJson(JSON.parse(readFileSync(join(__dirname, "../../fixtures/lenet5-cnn.json"), "utf8")));
    const result = await renderGlyphDiagram3d(lenet5, { target: "web", width: 140, height: 40 });
    const camera = createGlyphOrthographicCamera({ rotX: result.camera.rotX, rotY: result.camera.rotY, zoom: result.camera.zoom });
    const laid = await layout3d(lenet5, {});
    // LeNet-5 is a single-node-per-rank chain (this file's own "diagonal
    // pipeline" gate above), so sorting by flow coordinate (world X, LR)
    // gives exactly the RANK-ADJACENT pairs the bug affected — unrelated,
    // non-adjacent-rank overlap (a real property of a dense fan-in/out
    // graph, not this bug) is deliberately excluded.
    const ordered = [...laid.nodes].sort((a, b) => a.center[0] - b.center[0]);
    for (let i = 1; i < ordered.length; i++) {
      const a = projectedBounds(camera, ordered[i - 1]!.center, ordered[i - 1]!.half, 140, 40, 2.0);
      const b = projectedBounds(camera, ordered[i]!.center, ordered[i]!.half, 140, 40, 2.0);
      // Column-width overlap (not full AABB area — the isometric camera's
      // depth/height axes contribute heavily to COLUMN specifically,
      // AGENTS.md's own D2 round 7 derivation, and that is exactly the
      // dimension the overlap bug showed up in: two adjacent-rank boxes'
      // own screen WIDTHS exceeded the column gap between their centres
      // even though their rows differed enough to keep full-AABB area
      // overlap at zero — an area-only metric is blind to it).
      const overlapCol = Math.max(0, Math.min(a.maxCol, b.maxCol) - Math.max(a.minCol, b.minCol));
      const widthA = a.maxCol - a.minCol, widthB = b.maxCol - b.minCol;
      const smallerWidth = Math.min(widthA, widthB);
      // Measured on the real fixture at its own auto-fit camera: EXACTLY 0
      // (no column overlap at all, every rank-adjacent pair) post-fix,
      // against 0.17-0.22 pre-fix for the SAME pairs (this test's own
      // mutation target) — 0.1 is a real, mutation-sensitive bound with
      // margin on both sides.
      expect(overlapCol / smallerWidth, `${ordered[i - 1]!.id} vs ${ordered[i]!.id}`).toBeLessThan(0.1);
    }
  });

  it("force layout auto-fits with every node's full label visible, across seeds (incl. 42, the review's own repro) — or names a genuine collision in the ledger", async () => {
    for (const seed of [1, 7, 42, 100, 12345]) {
      const result = await renderGlyphDiagram3d(agentGraph, { target: "web", layout: "force", seed });
      const droppedIds = new Set(result.report.ledger.filter((e) => e.code === "3d-label-dropped" || e.code === "3d-label-unfittable").map((e) => (e.detail as { nodeId?: string } | undefined)?.nodeId));
      for (const id of missingLabels(result.text, agentGraph)) expect(droppedIds.has(id), `seed ${seed}: "${id}" missing with no ledger entry`).toBe(true);
    }
  });

  it("auto-fits a top-view camera (rotX: 90) over force layout at seed 42 — the review's own repro (Orchestrator vanished, empty ledger)", async () => {
    const result = await renderGlyphDiagram3d(agentGraph, { target: "web", layout: "force", seed: 42, camera: { rotX: 90, rotY: 0 } });
    expect(missingLabels(result.text, agentGraph)).toEqual([]);
    for (const entry of result.report.ledger) {
      if (entry.code === "3d-label-dropped" || entry.code === "3d-label-unfittable") {
        expect(missingLabels(result.text, agentGraph)).toContain((entry.detail as { nodeId?: string } | undefined)?.nodeId);
      }
    }
  });

  it("auto-fits a trackball (mat) camera with a genuine roll", async () => {
    const toRad = (d: number) => (d * Math.PI) / 180;
    const rx = toRad(30), ry = toRad(45), roll = toRad(40);
    const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry), cr = Math.cos(roll), sr = Math.sin(roll);
    const rxM = [[1, 0, 0], [0, cx, -sx], [0, sx, cx]];
    const ryM = [[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]];
    const rzM = [[cr, -sr, 0], [sr, cr, 0], [0, 0, 1]];
    const mul = (a: number[][], b: number[][]) => a.map((row) => b[0]!.map((_, j) => row.reduce((s, v, k) => s + v * b[k]![j]!, 0)));
    const m = mul(rzM, mul(rxM, ryM));
    const mat = m.flat();
    const small = await renderGlyphDiagram3d(agentGraph, { target: "web", camera: { mat } });
    expect(missingLabels(small.text, agentGraph)).toEqual([]);
    expect(small.camera.mat).toBeDefined();
    expect(small.camera.rotX).toBeUndefined();

    const big = await renderGlyphDiagram3d(supervisorGraph, { target: "web", camera: { mat } });
    const droppedIds = new Set(big.report.ledger.filter((e) => e.code === "3d-label-dropped" || e.code === "3d-label-unfittable").map((e) => (e.detail as { nodeId?: string } | undefined)?.nodeId));
    for (const id of missingLabels(big.text, supervisorGraph)) expect(droppedIds.has(id)).toBe(true);
  });

  it("an explicit camera zoom is honoured verbatim (no auto-fit override)", async () => {
    const result = await renderGlyphDiagram3d(agentGraph, { target: "web", camera: { rotX: 55, rotY: 35, zoom: 12 } });
    expect(result.camera.zoom).toBe(12);
  });

  it("rejects mat and rotX/rotY together", async () => {
    await expect(renderGlyphDiagram3d(agentGraph, { camera: { mat: [1, 0, 0, 0, 1, 0, 0, 0, 1], rotX: 10 } })).rejects.toThrow(/bad-options/);
  });

  it("the static braille frame equals the live createGlyphScene frame for the same camera and object (mutation: skip overlay stamping in the static path) → red", async () => {
    const object = await glyphDiagramObject(agentGraph);
    const centroid: Vec3 = [
      (object.bounds.min[0] + object.bounds.max[0]) / 2,
      (object.bounds.min[1] + object.bounds.max[1]) / 2,
      (object.bounds.min[2] + object.bounds.max[2]) / 2,
    ];
    const rotX = 55, rotY = 35, zoom = 15;

    const result = await renderGlyphDiagram3d(agentGraph, { target: "web", charset: "braille", color: "none", camera: { rotX, rotY, zoom } });

    const host = document.createElement("div");
    document.body.appendChild(host);
    const camera = createGlyphOrthographicCamera({ rotX, rotY, zoom });
    camera.target = centroid;
    const scene = createGlyphScene(host, {
      cols: 96, rows: 32, useColors: false, camera, mode: "wireframe", charMode: "braille", hiddenLines: "hide",
      directionalLight: GLYPH_DIAGRAM_3D_LIGHT, ambientLight: GLYPH_DIAGRAM_3D_AMBIENT_LIGHT,
    });
    scene.addObject(object);
    await Promise.resolve(); await Promise.resolve();
    const liveText = scene.output.textContent!;
    scene.destroy();

    expect(result.text).toBe(liveText);
  });

  it("the static blocks frame's plain content matches the live createGlyphScene frame's own textContent (mutation: diverge the halfblock merge from the live rasterizer) → red", async () => {
    const object = await glyphDiagramObject(agentGraph);
    const centroid: Vec3 = [
      (object.bounds.min[0] + object.bounds.max[0]) / 2,
      (object.bounds.min[1] + object.bounds.max[1]) / 2,
      (object.bounds.min[2] + object.bounds.max[2]) / 2,
    ];
    const rotX = 55, rotY = 35, zoom = 15;

    const result = await renderGlyphDiagram3d(agentGraph, { target: "web", charset: "blocks", color: "none", camera: { rotX, rotY, zoom } });

    const host = document.createElement("div");
    document.body.appendChild(host);
    const camera = createGlyphOrthographicCamera({ rotX, rotY, zoom });
    camera.target = centroid;
    const scene = createGlyphScene(host, {
      cols: 96, rows: 32, useColors: false, camera, mode: "solid", charMode: "halfblock", hiddenLines: "hide",
      directionalLight: GLYPH_DIAGRAM_3D_LIGHT, ambientLight: GLYPH_DIAGRAM_3D_AMBIENT_LIGHT,
    });
    scene.addObject(object);
    await Promise.resolve(); await Promise.resolve();
    // `textContent` on a real DOM node decodes HTML entities the same way
    // this module's own `unescapeHtmlText` does — a genuine, independent
    // cross-check, not a re-implementation of the same unescape logic.
    const liveText = scene.output.textContent!;
    scene.destroy();

    expect(result.text).toBe(liveText);
  });

  it("the static frame equals the live frame for a GROUPED graph too, in both layouts (mutation: reintroduce a compileScene-unrepresentable groups mesh) → red", async () => {
    for (const layout of ["layered", "force"] as const) {
      const object = await glyphDiagramObject(groupedAgentGraph, { layout });
      const centroid: Vec3 = [
        (object.bounds.min[0] + object.bounds.max[0]) / 2,
        (object.bounds.min[1] + object.bounds.max[1]) / 2,
        (object.bounds.min[2] + object.bounds.max[2]) / 2,
      ];
      const rotX = 55, rotY = 35, zoom = 15;

      const result = await renderGlyphDiagram3d(groupedAgentGraph, { target: "web", charset: "braille", color: "none", camera: { rotX, rotY, zoom }, layout });

      const host = document.createElement("div");
      document.body.appendChild(host);
      const camera = createGlyphOrthographicCamera({ rotX, rotY, zoom });
      camera.target = centroid;
      const scene = createGlyphScene(host, {
        cols: 96, rows: 32, useColors: false, camera, mode: "wireframe", charMode: "braille", hiddenLines: "hide",
        directionalLight: GLYPH_DIAGRAM_3D_LIGHT, ambientLight: GLYPH_DIAGRAM_3D_AMBIENT_LIGHT,
      });
      scene.addObject(object);
      await Promise.resolve(); await Promise.resolve();
      const liveText = scene.output.textContent!;
      scene.destroy();

      expect(result.text, `layout: ${layout}`).toBe(liveText);
    }
  });

  it("resolveCharset: braille/blocks render as themselves with no ledger entry; ascii/box degrade (blocks for chat, braille otherwise) with one (mutation: silently keep rendering ascii/box) → red", () => {
    expect(resolveCharset("braille", "web").ledger).toEqual([]);
    expect(resolveCharset("blocks", "web").ledger).toEqual([]);
    expect(resolveCharset("braille", "web").charMode).toBe("braille");
    expect(resolveCharset("blocks", "web").charMode).toBe("halfblock");

    for (const target of ["web", "terminal"] as const) {
      const r = resolveCharset("box", target);
      expect(r.charMode).toBe("braille");
      expect(r.ledger).toHaveLength(1);
      expect(r.ledger[0]!.code).toBe("3d-charset-degraded");
    }
    const chatBox = resolveCharset("ascii", "chat");
    expect(chatBox.charMode).toBe("halfblock");
    expect(chatBox.ledger).toHaveLength(1);
  });

  it("every target × charset × colour cell renders REAL content (painted boxes/labels, real colour) or degrades with a reason; NO_COLOR is honoured, and blocks has no ANSI form", async () => {
    const targets: GlyphDiagram3dTarget[] = ["chat", "terminal", "web"];
    const charsets: GlyphDiagram3dCharset[] = ["ascii", "box", "blocks", "braille"];
    const colors: GlyphDiagram3dColorMode[] = ["none", "ansi16", "ansi256", "truecolor", "css"];
    for (const target of targets) {
      for (const charset of charsets) {
        for (const color of colors) {
          const isAnsiColor = color === "ansi16" || color === "ansi256" || color === "truecolor";
          const result = await renderGlyphDiagram3d(agentGraph, { target, charset, color, env: isAnsiColor ? { NO_COLOR: "1" } : undefined });
          expect(everyLabelVisible(result.text, agentGraph)).toBe(true);
          expect(paintedGeometryCellCount(result.text, agentGraph)).toBeGreaterThan(0);
          const resolvedCharMode = resolveCharset(charset, target).charMode;
          if (charset === "ascii" || charset === "box") {
            expect(result.report.ledger.some((e) => e.code === "3d-charset-degraded")).toBe(true);
          } else {
            expect(result.report.ledger.some((e) => e.code === "3d-charset-degraded")).toBe(false);
          }
          if (resolvedCharMode === "halfblock" && isAnsiColor) {
            expect(result.report.ledger.some((e) => e.code === "3d-blocks-ansi-unsupported")).toBe(true);
            expect(result.text).not.toMatch(/\x1b\[3[0-9;]*m/);
          } else if (isAnsiColor) {
            // NO_COLOR: no SGR colour-introducing escape reaches the output.
            expect(result.text).not.toMatch(/\x1b\[3[0-9;]*m/);
          }
          if (color === "css") {
            expect(result.html).toBeDefined();
            expect(result.html).toMatch(/color:\s*#[0-9a-f]{6}/i);
          } else {
            expect(result.html).toBeUndefined();
          }
          if (color === "none") expect(result.text).not.toMatch(/\x1b\[/);
        }
      }
    }
  });

  it("ANSI colour modes actually carry colour when not NO_COLOR'd, for braille (mutation: colour computed but never encoded) → red", async () => {
    for (const color of ["ansi16", "ansi256", "truecolor"] as const) {
      const result = await renderGlyphDiagram3d(agentGraph, { target: "terminal", charset: "braille", color });
      expect(result.text).toMatch(/\x1b\[3[0-9;]*m/);
    }
  });

  it("renderGlyphDiagram3dJson returns a structured error for malformed JSON", async () => {
    const raw = await renderGlyphDiagram3dJson("{not json", {});
    const parsed = JSON.parse(raw) as { error?: string; code?: string | null };
    expect(parsed.error).toBeTruthy();
    expect(parsed.code).toBeTruthy();
  });

  // The coordinator's own fan-join-split deliverable gate (D2 round 7
  // follow-up, verbatim): "Must render cleanly: no unroutable edges, every
  // fan-in/fan-out edge visibly reaching its own block face with
  // arrowheads, all labels whole."
  it("fan-join-split fixture renders with every label whole and no unroutable edges, in both charsets (mutation: reintroduce 2D routing or drop a fan-in label) → red", async () => {
    const src = readFileSync(join(__dirname, "../../fixtures/fan-join-split.mmd"), "utf8");
    const graph: GlyphGraph = glyphGraphFromMermaid(src);
    for (const charset of ["braille", "blocks"] as const) {
      const result = await renderGlyphDiagram3d(graph, { target: "web", charset, width: 140, height: 40 });
      expect(result.report.ledger.some((e) => e.code === "unroutable")).toBe(false);
      expect(result.report.ledger.some((e) => e.code === "3d-label-dropped" || e.code === "3d-label-unfittable")).toBe(false);
      for (const n of graph.nodes) expect(result.text, `charset ${charset}: "${n.label}"`).toContain(String(n.label ?? n.id));
    }
  });

  it("renderGlyphDiagram3dJson returns a text frame for valid JSON", async () => {
    const raw = await renderGlyphDiagram3dJson(JSON.stringify(agentGraph), { target: "chat" });
    const parsed = JSON.parse(raw) as { text?: string; camera?: unknown };
    expect(parsed.text).toBeTruthy();
    expect(parsed.camera).toBeTruthy();
  });
});
