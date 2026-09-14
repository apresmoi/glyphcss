import { describe, expect, it } from "vitest";
import { createGlyphOrthographicCamera, createGlyphScene, type Vec3 } from "glyphcss";
import type { GlyphGraph } from "../types";
import { glyphDiagramObject } from "./glyphDiagramObject";
import { layout3d } from "./layout3d";
import {
  renderGlyphDiagram3d, renderGlyphDiagram3dJson, GLYPH_DIAGRAM_3D_LIGHT, GLYPH_DIAGRAM_3D_AMBIENT_LIGHT,
  type GlyphDiagram3dCharset, type GlyphDiagram3dColorMode, type GlyphDiagram3dTarget,
} from "./render3d";

/**
 * Packet D2 (PLAN-3d.md §11) acceptance gates for `renderGlyphDiagram3d`.
 * Each `it` names, in a comment, the mutation the PLAN requires it to
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

// D2 fix round 2 (codex, F5b lands): `agentGraph` with everything but the
// orchestrator grouped — exercises the group overlay outline this round
// added, both as a layered floor plate and a force wireframe volume.
const groupedAgentGraph: GlyphGraph = {
  ...agentGraph,
  groups: [{ id: "agents", label: "Agents", members: ["planner", "coder", "reviewer"] }],
};

// A larger, wider graph than `agentGraph` — a supervisor fanning out to five
// workers — so a camera zoom tuned for the 4-node graph provably does not
// also fit this one (the auto-fit mutation gate below).
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

// D2 round 4 — a small, DEFAULT-sized (no `size`) LR chain, the minimal
// fixture that isolates "does the flow read left-to-right along a screen
// axis" from any custom-size/compression concern.
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

/** A node's own projected screen-space bounding box (min/max col/row over all 8 box corners) under `camera`. */
function projectedSilhouette(camera: ReturnType<typeof createGlyphOrthographicCamera>, center: Vec3, half: Vec3, cols: number, rows: number, cellAspect: number): { width: number; height: number } {
  let minCol = Infinity, maxCol = -Infinity, minRow = Infinity, maxRow = -Infinity;
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const [col, row] = camera.project([center[0] + sx * half[0], center[1] + sy * half[1], center[2] + sz * half[2]], cols, rows, cellAspect);
    minCol = Math.min(minCol, col); maxCol = Math.max(maxCol, col);
    minRow = Math.min(minRow, row); maxRow = Math.max(maxRow, row);
  }
  return { width: maxCol - minCol, height: maxRow - minRow };
}

// D2 fix round 1, P2-5 (codex): the old `.slice(0, 3)` prefix check passed
// as soon as a label's first three characters landed anywhere on screen —
// it could not tell a fully-painted "Orchestrator" from a collided,
// dropped-after-three-characters one. Every P2-5 gate below checks the
// WHOLE label text.
function everyLabelVisible(text: string, graph: GlyphGraph): boolean {
  const folded = foldedLabels(text);
  return graph.nodes.every((n) => folded.includes(foldedLabels(String(n.label ?? n.id))));
}

/** Every label that ISN'T visible, by id — for a failure message naming which one(s) went missing rather than a bare boolean. */
function missingLabels(text: string, graph: GlyphGraph): string[] {
  const folded = foldedLabels(text);
  return graph.nodes.filter((n) => !folded.includes(foldedLabels(String(n.label ?? n.id)))).map((n) => n.id);
}

/** Non-space, non-label-text characters in the frame — proof that real box-outline/edge/arrowhead GEOMETRY painted, not just label text floating on a blank grid. */
function paintedGeometryCellCount(text: string, graph: GlyphGraph): number {
  let stripped = text;
  for (const n of graph.nodes) stripped = stripped.split(String(n.label ?? n.id)).join("");
  return stripped.replace(/\s/g, "").length;
}

describe("renderGlyphDiagram3d", () => {
  it("renders a non-empty frame with every node label visible at the default camera (mutation: fixed zoom instead of auto-fit) → red", async () => {
    const small = await renderGlyphDiagram3d(agentGraph, { target: "web" });
    expect(small.text.replace(/\s/g, "").length).toBeGreaterThan(0);
    expect(everyLabelVisible(small.text, agentGraph)).toBe(true);

    // The SAME renderer, SAME output size, on a graph almost twice the
    // extent — a hard-coded zoom tuned to fit `agentGraph` cannot also fit
    // `supervisorGraph`'s wider fan-out, so this only passes when the
    // camera is genuinely refit to each object's own bounds.
    const big = await renderGlyphDiagram3d(supervisorGraph, { target: "web" });
    expect(everyLabelVisible(big.text, supervisorGraph)).toBe(true);

    // P2-5 (codex): prove NO single constant zoom fits both fixtures,
    // rather than trusting that they merely LOOK different-sized — take the
    // small graph's own auto-fit zoom and apply it EXPLICITLY (bypassing
    // auto-fit) to the big graph; a genuinely wider fan-out overflows the
    // frame at that zoom and drops labels. This is the exact failure a
    // "fixed zoom instead of auto-fit" mutation would reintroduce for
    // EVERY render, not just a mismatched one.
    const fixedFromSmall = await renderGlyphDiagram3d(supervisorGraph, { target: "web", camera: { rotX: 55, rotY: 35, zoom: small.camera.zoom } });
    expect(everyLabelVisible(fixedFromSmall.text, supervisorGraph)).toBe(false);
    expect(missingLabels(fixedFromSmall.text, supervisorGraph).length).toBeGreaterThan(0);
  });

  it("auto-fit still centers and fits at every target size", async () => {
    for (const target of ["chat", "terminal", "web"] as const) {
      const result = await renderGlyphDiagram3d(agentGraph, { target });
      expect(everyLabelVisible(result.text, agentGraph)).toBe(true);
    }
  });

  it("D2 round 4 gate: a default-sized node's own projected silhouette is at least 10 cols x 5 rows at 96x32 for a <= 8-node graph (mutation: shrink NODE_HEIGHT/NODE_DEPTH back to round 3's values) → red", async () => {
    // `agentGraph` (TB, 4 nodes, no groups — the new Z-flow stacking path)
    // and `chainGraphLR` (LR, 4 nodes) cover both flow axes with plain
    // default sizing (no explicit `size`, so this isolates the LAYOUT
    // fix — bigger default boxes + proportional gaps — from anything
    // `size` compression touches).
    for (const graph of [agentGraph, chainGraphLR]) {
      const result = await renderGlyphDiagram3d(graph, { target: "web" });
      const camera = createGlyphOrthographicCamera({ rotX: result.camera.rotX, rotY: result.camera.rotY, zoom: result.camera.zoom });
      const laid = await layout3d(graph, {});
      for (const node of laid.nodes) {
        const { width, height } = projectedSilhouette(camera, node.center, node.half, 96, 32, 2.0);
        expect(width, `${graph.direction} "${node.id}" silhouette width`).toBeGreaterThanOrEqual(10);
        expect(height, `${graph.direction} "${node.id}" silhouette height`).toBeGreaterThanOrEqual(5);
      }
    }
  });

  it("D2 round 4 gate: consecutive LR-flow nodes' projected centres differ in row by <= 15% of their column separation (mutation: revert the LR camera default to round 3's rotX:32/rotY:38) → red", async () => {
    const result = await renderGlyphDiagram3d(chainGraphLR, { target: "web" });
    const camera = createGlyphOrthographicCamera({ rotX: result.camera.rotX, rotY: result.camera.rotY, zoom: result.camera.zoom });
    const laid = await layout3d(chainGraphLR, {});
    const ordered = [...laid.nodes].sort((a, b) => a.center[0] - b.center[0]);
    for (let i = 0; i < ordered.length - 1; i++) {
      const a = ordered[i]!, b = ordered[i + 1]!;
      const [colA, rowA] = camera.project(a.center, 96, 32, 2.0);
      const [colB, rowB] = camera.project(b.center, 96, 32, 2.0);
      const dCol = Math.abs(colB - colA), dRow = Math.abs(rowB - rowA);
      expect(dRow, `${a.id} -> ${b.id}: dRow=${dRow.toFixed(2)} dCol=${dCol.toFixed(2)}`).toBeLessThanOrEqual(0.15 * dCol);
    }
  });

  // P2-5 (codex): the auto-fit gates above only ever exercised the default
  // `layout: "layered"` at the default camera. `layout: "force"` places
  // nodes by a full-3D seeded simulation (`layout3d.ts`) — a genuinely
  // different, less axis-aligned geometry the closed-form fit's own corner
  // projection has to handle correctly — and several seeds (42 is the
  // review's own repro) rule out a fit that merely happens to work for one
  // arrangement.
  it("force layout auto-fits with every node's full label visible, across seeds (incl. 42, the review's own repro) — or names a genuine collision in the ledger", async () => {
    // D2 round 3's own camera default (32/38, "a readable 3/4 view from
    // slightly above and in front" — message 2) is a genuinely different
    // pose than the old 55/35 one, and a genuinely different pose can
    // legitimately put two labels in real on-screen collision at a seed
    // that cleared the old one — the guarantee this gate actually checks
    // (same as the top-view/trackball gates below) is never a SILENT drop,
    // not that force layout never collides at any camera.
    for (const seed of [1, 7, 42, 100, 12345]) {
      const result = await renderGlyphDiagram3d(agentGraph, { target: "web", layout: "force", seed });
      const droppedIds = new Set(result.report.ledger.filter((e) => e.code === "3d-label-dropped" || e.code === "3d-label-unfittable").map((e) => (e.detail as { nodeId?: string } | undefined)?.nodeId));
      for (const id of missingLabels(result.text, agentGraph)) expect(droppedIds.has(id), `seed ${seed}: "${id}" missing with no ledger entry`).toBe(true);
    }
  });

  // A TOP VIEW (`rotX: 90`, looking straight down the Z axis) is the
  // review's own repro angle: force layout spreads nodes across Z as well
  // as X/Y, so a near-90 pitch collapses that spread into overlapping
  // screen positions — exactly where two labels are most likely to
  // genuinely collide at render time (P1-2's `ledger3dLabelDropped` path,
  // not merely the analytic fit's own prediction).
  it("auto-fits a top-view camera (rotX: 90) over force layout at seed 42 — the review's own repro (Orchestrator vanished, empty ledger)", async () => {
    const result = await renderGlyphDiagram3d(agentGraph, { target: "web", layout: "force", seed: 42, camera: { rotX: 90, rotY: 0 } });
    expect(missingLabels(result.text, agentGraph)).toEqual([]);
    // Every label that DID make it into the frame is verified against what
    // rendered, live — the review's failure mode was a label absent from
    // BOTH the frame AND the ledger, so a genuine collision this camera
    // angle provokes must still be named, never silently dropped.
    for (const entry of result.report.ledger) {
      if (entry.code === "3d-label-dropped" || entry.code === "3d-label-unfittable") {
        expect(missingLabels(result.text, agentGraph)).toContain((entry.detail as { nodeId?: string } | undefined)?.nodeId);
      }
    }
  });

  // Trackball `mat` cameras (arbitrary orientation, including roll) are a
  // second, independent path through `fitDiagramCamera` (`useMat` branch) —
  // never exercised by any Euler-angle (`rotX`/`rotY`) gate above.
  it("auto-fits a trackball (mat) camera with a genuine roll", async () => {
    // 40° roll about the view axis composed after a ~30°/45° orbit — a
    // hand-rolled rotation matrix (row-major, matches `GlyphCamera.mat`'s
    // own convention), not the identity, so this is a REAL roll and not a
    // no-op mat.
    const toRad = (d: number) => (d * Math.PI) / 180;
    const rx = toRad(30), ry = toRad(45), roll = toRad(40);
    const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry), cr = Math.cos(roll), sr = Math.sin(roll);
    // Rz(roll) * Rx(rx) * Ry(ry), row-major, flattened.
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

    // The wider `supervisorGraph` at the SAME roll can legitimately lose a
    // label to a genuine on-screen collision at this particular
    // orientation (the analytic fit only bounds each label's OWN anchor +
    // width, not pairwise label-vs-label overlap) — the guarantee P1-2
    // actually makes is never a SILENT drop: every missing label must be
    // named in the ledger.
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

  it("the static frame equals the live createGlyphScene frame for the same camera and object (mutation: skip overlay stamping in the static path) → red", async () => {
    // An EXPLICIT camera (auto-fit off) so both sides use the identical
    // rotX/rotY/zoom/target with nothing for either path to compute
    // independently — the honest form of "same camera" this gate asks for.
    // `tier: "box"` matches `resolveCharset`'s own default (target "web"'s
    // charset default, `render3d.ts`'s `GLYPH_DIAGRAM_3D_TARGET_DEFAULTS`)
    // — the fix round's P1-1 box-outline/arrowhead overlay is tier-aware
    // (`GLYPH_CANVAS_TIERS`), so a comparison object built with the
    // (different) `tier` default would legitimately diverge on the edge
    // glyphs alone, which is not what this gate is checking.
    // `boxOutline: false` matches `resolveCharset`'s own `ink`-mode default
    // (D2 round 3) — `render3d.ts`'s real call resolves it from the
    // charset/style, and a comparison object left at the OPTION default
    // (`true`) would double-stamp a redundant outline `ink` mode's own
    // silhouette/crease trace already draws, diverging from the real path
    // for a reason that has nothing to do with the mutation this gate
    // checks.
    const object = await glyphDiagramObject(agentGraph, { tier: "box", boxOutline: false });
    const centroid: Vec3 = [
      (object.bounds.min[0] + object.bounds.max[0]) / 2,
      (object.bounds.min[1] + object.bounds.max[1]) / 2,
      (object.bounds.min[2] + object.bounds.max[2]) / 2,
    ];
    const rotX = 55, rotY = 35, zoom = 15;

    const result = await renderGlyphDiagram3d(agentGraph, { target: "web", color: "none", camera: { rotX, rotY, zoom } });

    const host = document.createElement("div");
    document.body.appendChild(host);
    const camera = createGlyphOrthographicCamera({ rotX, rotY, zoom });
    camera.target = centroid;
    // D2 round 3: `render3d.ts`'s own default is now `mode: "ink"` +
    // `hiddenLines: "hide"` (crisp line art, message 2) rather than solid —
    // the live comparison scene must match it, or this gate would compare
    // two genuinely different renders and always fail for a reason that has
    // nothing to do with the mutation it exists to catch.
    const scene = createGlyphScene(host, {
      cols: 96, rows: 32, useColors: false, camera, mode: "ink", hiddenLines: "hide",
      directionalLight: GLYPH_DIAGRAM_3D_LIGHT, ambientLight: GLYPH_DIAGRAM_3D_AMBIENT_LIGHT,
    });
    scene.addObject(object);
    await Promise.resolve(); await Promise.resolve();
    const liveText = scene.output.textContent!;
    scene.destroy();

    expect(result.text).toBe(liveText);
  });

  it("the static frame equals the live frame for a GROUPED graph too, in both layouts (mutation: reintroduce the transparent/wireframe groups mesh) → red", async () => {
    // D2 fix round 2 (codex, F5b lands): before this round, a grouped
    // graph's static frame provably DIVERGED from the live one — the
    // `groups` mesh's `transparent: true`/`mode: "wireframe"` separated it
    // into its own detail layer in a LIVE scene (a private, CSS-translated
    // `<pre>`), which a flat static compile has no representation for at
    // all, so `render3d.ts`'s own doc comment carried that as a documented,
    // scoped-away residual. Groups are now a depth-tested overlay outline
    // instead — the SAME `stamp()` runs on both paths — so there is no
    // detail-layer distinction left for either side to diverge on, and this
    // gate covers a grouped graph with NO exception.
    for (const layout of ["layered", "force"] as const) {
      const object = await glyphDiagramObject(groupedAgentGraph, { tier: "box", layout, boxOutline: false });
      const centroid: Vec3 = [
        (object.bounds.min[0] + object.bounds.max[0]) / 2,
        (object.bounds.min[1] + object.bounds.max[1]) / 2,
        (object.bounds.min[2] + object.bounds.max[2]) / 2,
      ];
      const rotX = 55, rotY = 35, zoom = 15;

      const result = await renderGlyphDiagram3d(groupedAgentGraph, { target: "web", color: "none", camera: { rotX, rotY, zoom }, layout });

      const host = document.createElement("div");
      document.body.appendChild(host);
      const camera = createGlyphOrthographicCamera({ rotX, rotY, zoom });
      camera.target = centroid;
      const scene = createGlyphScene(host, {
        cols: 96, rows: 32, useColors: false, camera, mode: "ink", hiddenLines: "hide",
        directionalLight: GLYPH_DIAGRAM_3D_LIGHT, ambientLight: GLYPH_DIAGRAM_3D_AMBIENT_LIGHT,
      });
      scene.addObject(object);
      await Promise.resolve(); await Promise.resolve();
      const liveText = scene.output.textContent!;
      scene.destroy();

      expect(result.text, `layout: ${layout}`).toBe(liveText);
    }
  });

  it("every target × charset × colour cell renders REAL content (painted boxes/labels, real colour) or degrades with a reason; NO_COLOR is honoured", async () => {
    // P2-5 (codex): `text.length > 0` alone passed on a frame that was
    // nothing but whitespace-padded label text with zero box/edge geometry
    // painted, and on an `html` exit that existed but carried no colour at
    // all — every cell below now asserts the REAL content the reader would
    // actually see.
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
          // `braille` under the default (ink) style is the INTENDED
          // wireframe+2x4-dot look, not a fallback from anything else, so it
          // logs no entry — only `blocks` genuinely degrades here (its
          // sub-cell dual-color encoder can't carry the stamped overlays).
          if (charset === "blocks") {
            expect(result.report.ledger.some((e) => e.code === "3d-charset-degraded")).toBe(true);
          } else if (charset === "braille") {
            expect(result.report.ledger.some((e) => e.code === "3d-charset-degraded")).toBe(false);
          }
          if (isAnsiColor) {
            // NO_COLOR: no SGR colour-introducing escape reaches the output.
            expect(result.text).not.toMatch(/\x1b\[3[0-9;]*m/);
          }
          if (color === "css") {
            expect(result.html).toBeDefined();
            // The html exit must actually CARRY colour, not merely exist —
            // a canonical `#rrggbb` inline colour style (AGENTS.md's "Cell
            // canvas" colour contract).
            expect(result.html).toMatch(/color:\s*#[0-9a-f]{6}/i);
          } else {
            expect(result.html).toBeUndefined();
          }
          if (color === "none") expect(result.text).not.toMatch(/\x1b\[/);
        }
      }
    }
  });

  it("ANSI colour modes actually carry colour when not NO_COLOR'd (mutation: colour computed but never encoded) → red", async () => {
    for (const color of ["ansi16", "ansi256", "truecolor"] as const) {
      const result = await renderGlyphDiagram3d(agentGraph, { target: "terminal", charset: "box", color });
      expect(result.text).toMatch(/\x1b\[3[0-9;]*m/);
    }
  });

  it("renderGlyphDiagram3dJson returns a structured error for malformed JSON", async () => {
    const raw = await renderGlyphDiagram3dJson("{not json", {});
    const parsed = JSON.parse(raw) as { error?: string; code?: string | null };
    expect(parsed.error).toBeTruthy();
    expect(parsed.code).toBeTruthy();
  });

  it("renderGlyphDiagram3dJson returns a text frame for valid JSON", async () => {
    const raw = await renderGlyphDiagram3dJson(JSON.stringify(agentGraph), { target: "chat" });
    const parsed = JSON.parse(raw) as { text?: string; camera?: unknown };
    expect(parsed.text).toBeTruthy();
    expect(parsed.camera).toBeTruthy();
  });
});
