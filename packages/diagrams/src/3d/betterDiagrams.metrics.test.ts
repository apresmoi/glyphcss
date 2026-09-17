import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createGlyphOrthographicCamera, type Vec3 } from "glyphcss";
import type { GlyphGraph } from "../types";
import { glyphGraphFromMermaid } from "../mermaid";
import { glyphGraphFromJson } from "../adapters";
import { layout3d } from "./layout3d";
import { glyphDiagram3dNodeSilhouettes } from "./glyphDiagramObject";
import { renderGlyphDiagram3d } from "./render3d";

/**
 * Acceptance gate for the "better diagrams" round (USER FEEDBACK, verbatim:
 * "the lenet5 the transformer and the multi agent and the fan out suck, can
 * we actually have better diagrams there please?" / "those look like shit,
 * we need better diagrams man, maybe other shapes, not only blocks or
 * cylinders, lets make something good man"). "Looks better" isn't
 * verifiable by inspection alone, so this file measures four concrete
 * proxies for legibility at the shipped default camera and a realistic
 * size (110x34, braille):
 *
 *   (a) projected EDGE-SEGMENT CROSSINGS — a pair of drawn segments from
 *       DIFFERENT edges whose screen-space projections properly cross
 *       (shared endpoints at a node don't count — `segmentsCross` requires
 *       a genuine straddle on both sides).
 *   (b) NODE-SILHOUETTE OVERLAPS — pairs of nodes whose projected AABBs
 *       (`glyphDiagram3dNodeSilhouettes`, the same primitive the label
 *       arbiter itself uses) intersect.
 *   (c) LABELS DROPPED — `3d-label-dropped` ledger entries.
 *   (d) RANK-BAND OVERLAPS (D2 round 9, "clear levels" — USER FEEDBACK,
 *       verbatim: "in a vertical tree structure with multiple branches but
 *       with clear levels") — per-rank screen bands, along whichever
 *       screen axis the graph's own flow axis primarily maps to at this
 *       module's fixed default camera (ROW for TB/BT, since world Z is
 *       purely vertical there; COLUMN for LR/RL, since world X is
 *       column-dominant there — this file's own `rankBandAxis` doc), must
 *       never overlap an ADJACENT rank's own band, or a reader can't tell
 *       "these boxes are one level" from "these are two". Gated at exactly
 *       `0` for every preset (a genuine invariant this round establishes,
 *       not a regression-permitted baseline).
 *
 * BASELINE numbers below for (a)-(c) were measured against the PRE-round
 * code (`git stash push` on just the touched source/fixture files, run,
 * `git stash pop` to restore — never re-derived from a description) for
 * every preset that existed before this round; each is asserted to stay AT
 * OR BELOW its own baseline post-round. The new CI-pipeline-dag preset has
 * no baseline for (a)-(c) (it didn't exist before) — its own measured
 * numbers are asserted as an upper bound with headroom, so a future
 * regression still trips it. Metric (d) has no pre-round baseline for
 * ANY preset (the property didn't exist to measure before this round) and
 * is gated at `0` uniformly.
 */

function cross(o: [number, number], a: [number, number], b: [number, number]): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}
function segmentsCross(a1: [number, number], a2: [number, number], b1: [number, number], b2: [number, number]): boolean {
  const d1 = cross(b1, b2, a1), d2 = cross(b1, b2, a2), d3 = cross(a1, a2, b1), d4 = cross(a1, a2, b2);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

const W = 110, H = 34, ASPECT = 2.0;

interface DiagramMetrics { readonly crossings: number; readonly overlaps: number; readonly labelsDropped: number; readonly rankOverlaps: number; }

/**
 * Which SCREEN axis a graph's own flow axis primarily maps to, at this
 * module's fixed default camera (`layout3d.ts`'s own `GLYPH_DIAGRAM_3D_
 * CAMERA_ROT_X`/`_ROT_Y`, reused here rather than re-derived): TB/BT's own
 * flow axis is world Z, which projects with ZERO column contribution
 * (purely vertical) — "level" reads as a ROW band. LR/RL's own flow axis
 * is world X, which is COLUMN-dominant at this camera — "level" reads as a
 * COLUMN band. Matches `layout3d.ts`'s own `resolveRowAxis` reasoning,
 * applied to the FLOW axis instead of the in-plane spread axis.
 */
function rankBandAxis(direction: GlyphGraph["direction"]): "row" | "col" {
  return direction === "LR" || direction === "RL" ? "col" : "row";
}

async function measure(input: GlyphGraph | string): Promise<DiagramMetrics> {
  const result = await renderGlyphDiagram3d(input, { target: "web", charset: "braille", width: W, height: H, layout: "layered" });
  const graph = typeof input === "string" ? glyphGraphFromMermaid(input) : input;
  const laid = await layout3d(graph, { layout: "layered" });
  const camera = createGlyphOrthographicCamera({
    rotX: result.camera.rotX, rotY: result.camera.rotY, zoom: result.camera.zoom,
    mat: result.camera.mat ? [...result.camera.mat] : undefined, useMat: result.camera.mat !== undefined,
  });
  const project = (p: Vec3): [number, number] => { const [col, row] = camera.project(p, W, H, ASPECT); return [col, row]; };

  const segments: [[number, number], [number, number]][] = [];
  for (const edge of laid.edges) {
    for (let i = 0; i < edge.points.length - 1; i++) segments.push([project(edge.points[i]!), project(edge.points[i + 1]!)]);
  }
  let crossings = 0;
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      if (segmentsCross(segments[i]![0], segments[i]![1], segments[j]![0], segments[j]![1])) crossings++;
    }
  }

  const silhouettes = glyphDiagram3dNodeSilhouettes(laid.nodes, camera, W, H, ASPECT);
  const silhouetteList = [...silhouettes.values()];
  let overlaps = 0;
  for (let i = 0; i < silhouetteList.length; i++) {
    for (let j = i + 1; j < silhouetteList.length; j++) {
      const a = silhouetteList[i]!, b = silhouetteList[j]!;
      if (a.maxCol >= b.minCol && a.minCol <= b.maxCol && a.maxRow >= b.minRow && a.minRow <= b.maxRow) overlaps++;
    }
  }

  const labelsDropped = result.report.ledger.filter((e) => e.code === "3d-label-dropped").length;

  // Part 1's own "clear levels" DEFINITION OF DONE: cluster nodes into
  // ranks by their own RAW flow-axis world coordinate (the same tolerance
  // `layout3d.ts`'s own internal `clusterRanks` uses — every same-rank
  // node shares that coordinate exactly by construction, so the tolerance
  // only absorbs float noise), then check each rank's own projected screen
  // band (along `rankBandAxis`) against its immediate neighbour's.
  const flowAxisIndex = graph.direction === "LR" || graph.direction === "RL" ? 0 : 2;
  const byFlow = [...laid.nodes].sort((a, b) => a.center[flowAxisIndex] - b.center[flowAxisIndex]);
  const ranks: (typeof laid.nodes[number])[][] = [];
  for (const n of byFlow) {
    const last = ranks[ranks.length - 1];
    if (last && Math.abs(last[0]!.center[flowAxisIndex] - n.center[flowAxisIndex]) <= 1) last.push(n);
    else ranks.push([n]);
  }
  const axis = rankBandAxis(graph.direction);
  const bandOf = (rank: (typeof laid.nodes[number])[]): { readonly min: number; readonly max: number } => {
    let min = Infinity, max = -Infinity;
    for (const n of rank) {
      const box = silhouettes.get(n.id)!;
      const lo = axis === "row" ? box.minRow : box.minCol, hi = axis === "row" ? box.maxRow : box.maxCol;
      min = Math.min(min, lo); max = Math.max(max, hi);
    }
    return { min, max };
  };
  const bands = ranks.map(bandOf);
  let rankOverlaps = 0;
  for (let i = 0; i < bands.length - 1; i++) {
    if (bands[i]!.max >= bands[i + 1]!.min && bands[i]!.min <= bands[i + 1]!.max) rankOverlaps++;
  }

  return { crossings, overlaps, labelsDropped, rankOverlaps };
}

function fixture(name: string): string {
  return readFileSync(join(__dirname, "../../fixtures", name), "utf8");
}
function fixtureGraph(name: string): GlyphGraph {
  return glyphGraphFromJson(JSON.parse(fixture(name)));
}

// The crew preset is inline Mermaid in `diagramsWorkbenchState.ts` (not a
// fixture file); reproduced verbatim here (post-round shapes) so this gate
// doesn't need a website-package import.
const CREW_MERMAID = `flowchart LR
  request((Request)) --> manager{Manager}
  subgraph crew[Crew]
    researcher[[Researcher]] --> writer[[Writer]]
  end
  manager --> researcher
  writer --> review{Review}
  review -->|approved| result([Result])
  review -.->|revise| writer
`;

describe("better-diagrams round — measured legibility gate (110x34 braille, shipped default camera)", () => {
  // Measured against the PRE-round code (rewind glyphDiagramObject.ts,
  // layout3d.ts and the three touched fixtures to HEAD, run this exact
  // metric, restore) — see this file's own top-of-file doc. No `rankOverlaps`
  // baseline exists for any preset — that metric didn't exist to measure
  // pre-round (it's a NEW invariant this round establishes, gated at `0`
  // directly below, never against a baseline).
  const baselines: Record<string, Pick<DiagramMetrics, "crossings" | "overlaps" | "labelsDropped">> = {
    lenet5: { crossings: 0, overlaps: 0, labelsDropped: 0 },
    transformer: { crossings: 0, overlaps: 0, labelsDropped: 0 },
    "agent-supervisor": { crossings: 0, overlaps: 0, labelsDropped: 0 },
    crew: { crossings: 0, overlaps: 0, labelsDropped: 0 },
    "fan-join-split": { crossings: 2, overlaps: 3, labelsDropped: 0 },
  };

  const cases: readonly (readonly [string, () => GlyphGraph | string])[] = [
    ["lenet5", () => fixtureGraph("lenet5-cnn.json")],
    ["transformer", () => fixtureGraph("transformer-encoder.json")],
    ["agent-supervisor", () => fixture("agent-supervisor.mmd")],
    ["crew", () => CREW_MERMAID],
    ["fan-join-split", () => fixture("fan-join-split.mmd")],
  ];
  it.each(cases)("%s stays at or below its pre-round baseline on every metric, AND has zero rank-band overlaps (mutation: regress the layout/shape/label logic) → red", async (name, buildInput) => {
    const before = baselines[name]!;
    const after = await measure(buildInput());
    expect(after.crossings, `${name} crossings`).toBeLessThanOrEqual(before.crossings);
    expect(after.overlaps, `${name} overlaps`).toBeLessThanOrEqual(before.overlaps);
    expect(after.labelsDropped, `${name} labelsDropped`).toBeLessThanOrEqual(before.labelsDropped);
    expect(after.rankOverlaps, `${name} rankOverlaps`).toBe(0);
  });

  // The new preset (no baseline — it didn't exist before this round).
  // Measured post-D2-round-9 (row arrangement + offset-magnitude-aware
  // rank spacing): crossings=11, overlaps=0, labelsDropped=2, rankOverlaps=0
  // on a genuinely dense 19-node/31-edge fan-out/fan-in DAG — a much harder
  // graph than any prior preset, so nonzero crossings/labelsDropped is
  // still expected (2D's own budget/compaction ladder doesn't apply to 3D
  // layered layout at all). Gated with headroom above the measured values
  // so a future regression still trips it, never re-measured live (that
  // would silently ratchet the bound upward on every regression);
  // `rankOverlaps` is the one metric gated at its true value (`0`), since
  // "clear levels" is an invariant, not a budget.
  it("ci-pipeline-dag (new, dense fan-out/fan-in preset) stays under a measured-with-headroom ceiling on every metric, with zero rank-band overlaps (mutation: regress the layout so it packs tighter) → red", async () => {
    const after = await measure(fixtureGraph("ci-pipeline-dag.json"));
    expect(after.crossings).toBeLessThanOrEqual(20);
    expect(after.overlaps).toBeLessThanOrEqual(5);
    expect(after.labelsDropped).toBeLessThanOrEqual(6);
    expect(after.rankOverlaps).toBe(0);
  });

  // Part 2(a) of the "vertical tree, more pieces" round (USER FEEDBACK,
  // verbatim: "can we render a multiagent system but with more pieces? in a
  // vertical tree structure with multiple branches but with clear
  // levels") — a genuinely branching 20-node/31-edge DAG (root -> single
  // orchestrator -> 3 supervisors -> 12 specialist workers -> 3 shared
  // tool/memory/output nodes, with cross-links from several workers into
  // more than one shared node). No baseline (new preset). Measured:
  // crossings=21, overlaps=0, labelsDropped=8 (of 20 nodes, past the
  // library's own 16-node auto-label-suppression threshold — AGENTS.md's
  // own adaptive-label-density policy, not a layout defect), rankOverlaps=0
  // — the "clear levels" property this round exists to guarantee holds
  // even on the densest fan-out this round ships.
  it("multi-agent-tree (new, vertical branching preset) stays under a measured-with-headroom ceiling on every metric, with zero rank-band overlaps (mutation: regress the layout so it packs tighter) → red", async () => {
    const after = await measure(fixtureGraph("multi-agent-tree.json"));
    expect(after.crossings).toBeLessThanOrEqual(35);
    expect(after.overlaps).toBeLessThanOrEqual(4);
    expect(after.labelsDropped).toBeLessThanOrEqual(14);
    expect(after.rankOverlaps).toBe(0);
  });

  // Part 2(b) — a VGG-style CNN (20 nodes: input -> 5x [conv, conv, pool]
  // blocks -> flatten -> 2 fc -> softmax), every layer's `size` encoding
  // its real tensor shape (spatial dims shrinking, channel depth growing),
  // the payoff for the `layout3d.ts` size-floor fix this repo's own
  // AGENTS.md context names. A pure chain (1 node per rank), so crossings
  // and rank-band overlaps are expected to stay at (or extremely near)
  // zero regardless of layout tuning — nonzero here would mean something
  // is genuinely wrong, not just "a harder graph."
  it("vgg-cnn (new, many-layer sized preset) stays under a measured-with-headroom ceiling on every metric, with zero rank-band overlaps (mutation: regress the layout so it packs tighter) → red", async () => {
    const after = await measure(fixtureGraph("vgg-cnn.json"));
    expect(after.crossings).toBeLessThanOrEqual(3);
    expect(after.overlaps).toBeLessThanOrEqual(3);
    expect(after.labelsDropped).toBeLessThanOrEqual(6);
    expect(after.rankOverlaps).toBe(0);
  });
});
