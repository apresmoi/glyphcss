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
 * verifiable by inspection alone, so this file measures three concrete
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
 *
 * BASELINE numbers below were measured against the PRE-round code (`git
 * stash push` on just the touched source/fixture files, run, `git stash
 * pop` to restore — never re-derived from a description) for every preset
 * that existed before this round; each is asserted to stay AT OR BELOW its
 * own baseline post-round. The new CI-pipeline-dag preset has no baseline
 * (it didn't exist before) — its own measured numbers are asserted as an
 * upper bound with headroom, so a future regression still trips it.
 */

function cross(o: [number, number], a: [number, number], b: [number, number]): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}
function segmentsCross(a1: [number, number], a2: [number, number], b1: [number, number], b2: [number, number]): boolean {
  const d1 = cross(b1, b2, a1), d2 = cross(b1, b2, a2), d3 = cross(a1, a2, b1), d4 = cross(a1, a2, b2);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

const W = 110, H = 34, ASPECT = 2.0;

interface DiagramMetrics { readonly crossings: number; readonly overlaps: number; readonly labelsDropped: number; }

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

  const silhouettes = [...glyphDiagram3dNodeSilhouettes(laid.nodes, camera, W, H, ASPECT).values()];
  let overlaps = 0;
  for (let i = 0; i < silhouettes.length; i++) {
    for (let j = i + 1; j < silhouettes.length; j++) {
      const a = silhouettes[i]!, b = silhouettes[j]!;
      if (a.maxCol >= b.minCol && a.minCol <= b.maxCol && a.maxRow >= b.minRow && a.minRow <= b.maxRow) overlaps++;
    }
  }

  const labelsDropped = result.report.ledger.filter((e) => e.code === "3d-label-dropped").length;
  return { crossings, overlaps, labelsDropped };
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
  // metric, restore) — see this file's own top-of-file doc.
  const baselines: Record<string, DiagramMetrics> = {
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
  it.each(cases)("%s stays at or below its pre-round baseline on every metric (mutation: regress the layout/shape/label logic) → red", async (name, buildInput) => {
    const before = baselines[name]!;
    const after = await measure(buildInput());
    expect(after.crossings, `${name} crossings`).toBeLessThanOrEqual(before.crossings);
    expect(after.overlaps, `${name} overlaps`).toBeLessThanOrEqual(before.overlaps);
    expect(after.labelsDropped, `${name} labelsDropped`).toBeLessThanOrEqual(before.labelsDropped);
  });

  // The new preset (no baseline — it didn't exist before this round).
  // Measured: crossings=29, overlaps=5, labelsDropped=4 on a genuinely
  // dense 19-node/31-edge fan-out/fan-in DAG — a much harder graph than
  // any prior preset, so nonzero here is expected (2D's own budget/
  // compaction ladder doesn't apply to 3D layered layout at all). Gated
  // with headroom above the measured values so a future regression still
  // trips it, never re-measured live (that would silently ratchet the
  // bound upward on every regression).
  it("ci-pipeline-dag (new, dense fan-out/fan-in preset) stays under a measured-with-headroom ceiling on every metric (mutation: regress the layout so it packs tighter) → red", async () => {
    const after = await measure(fixtureGraph("ci-pipeline-dag.json"));
    expect(after.crossings).toBeLessThanOrEqual(45);
    expect(after.overlaps).toBeLessThanOrEqual(10);
    expect(after.labelsDropped).toBeLessThanOrEqual(8);
  });
});
