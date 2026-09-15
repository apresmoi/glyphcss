import { describe, expect, it, vi } from "vitest";
import mutagRow0 from "./fixtures/graphDatasetMutagRow0.json";
import { GRAPH_DATASET_NODE_CAP, loadGraphDatasetRow, loadRandomGraphDatasetRow, type GraphDatasetLoadFetch } from "./graphDatasetLoad";

const REF = "graphs-datasets/MUTAG";
const SPLITS_BODY = JSON.stringify({ splits: [{ dataset: REF, config: "default", split: "train" }] });

function jsonResponse(status: number, body: unknown): { ok: boolean; status: number; text(): Promise<string> } {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
}

/** A fetch stub keyed on whether the URL is the `/splits` or `/rows`
 *  endpoint — `rowsBody` is served for EVERY `/rows` call (tests that need
 *  per-call variation build their own `vi.fn`). */
function stubFetch(rowsBody: unknown, status = 200): GraphDatasetLoadFetch {
  return vi.fn(async (url: string) => {
    if (url.includes("/splits")) return jsonResponse(200, JSON.parse(SPLITS_BODY));
    return jsonResponse(status, rowsBody);
  });
}

describe("loadGraphDatasetRow — vendored MUTAG row0 fixture", () => {
  it("round-trips edge_index into deduped, undirected edges", async () => {
    const result = await loadGraphDatasetRow(REF, 0, { fetch: stubFetch(mutagRow0) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The fixture's own edge_index has 38 directed columns; MUTAG stores
    // every bond as both (a,b) and (b,a), so exactly half survive as one
    // undirected edge each. A regression that stops deduping would leave
    // 38 edges and 0 dedupedMirrorEdges here — this assertion goes red on it.
    expect(result.graph.edges.length).toBe(19);
    expect(result.dedupedMirrorEdges).toBe(19);
    expect(result.graph.nodes.length).toBe(17);
    expect(result.originalNodeCount).toBe(17);
    expect(result.originalEdgeCount).toBe(38);
    expect(result.logicalEdgeCount).toBe(19);
    expect(result.edgeDirection).toBe("undirected");
    expect(result.simplified).toBe(false);
    // Every kept edge carries `style: "undirected"` — no arrowhead.
    expect(result.graph.edges.every((e) => e.style === "undirected")).toBe(true);
    // Every edge is a real (from,to) pair over existing node ids, and no
    // edge appears with both orderings (the dedupe's own promise).
    const seen = new Set<string>();
    for (const edge of result.graph.edges) {
      expect(result.graph.nodes.some((n) => n.id === edge.from)).toBe(true);
      expect(result.graph.nodes.some((n) => n.id === edge.to)).toBe(true);
      const key = [edge.from, edge.to].sort().join(":");
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it("labels MUTAG nodes from the one-hot atom vocabulary, falling back to index for an unrecognized dataset", async () => {
    const result = await loadGraphDatasetRow(REF, 0, { fetch: stubFetch(mutagRow0) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The fixture's raw node_feat: nodes 0-13 are one-hot index 0 (C), node
    // 14 is index 1 (N), nodes 15-16 are index 2 (O) — read directly off
    // the vendored row, not asserted from memory.
    const labels = result.graph.nodes.map((n) => n.label);
    expect(labels.slice(0, 14)).toEqual(Array(14).fill("C"));
    expect(labels[14]).toBe("N");
    expect(labels.slice(15)).toEqual(["O", "O"]);

    const unknownDataset = await loadGraphDatasetRow("graphs-datasets/UNKNOWN", 0, { fetch: stubFetch(mutagRow0) });
    expect(unknownDataset.ok).toBe(true);
    if (!unknownDataset.ok) return;
    // No curated vocabulary for this ref — every label is the bare index.
    expect(unknownDataset.graph.nodes.map((n) => n.label)).toEqual(unknownDataset.graph.nodes.map((n) => n.id));
  });

  it("records the graph label from y", async () => {
    const result = await loadGraphDatasetRow(REF, 0, { fetch: stubFetch(mutagRow0) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.label).toBe("1"); // the fixture's own row carries y: [1]
  });

  it("truncates a graph over the node cap and reports it as simplified", async () => {
    const bigRow = {
      num_rows_total: 1,
      rows: [{ row: {
        num_nodes: GRAPH_DATASET_NODE_CAP + 10,
        edge_index: [Array.from({ length: GRAPH_DATASET_NODE_CAP + 9 }, (_, i) => i), Array.from({ length: GRAPH_DATASET_NODE_CAP + 9 }, (_, i) => i + 1)],
        y: [0],
      } }],
    };
    const result = await loadGraphDatasetRow(REF, 0, { fetch: stubFetch(bigRow) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.simplified).toBe(true);
    expect(result.graph.nodes.length).toBe(GRAPH_DATASET_NODE_CAP);
    expect(result.originalNodeCount).toBe(GRAPH_DATASET_NODE_CAP + 10);
    // Every edge touching a dropped node (id >= cap) is gone too.
    expect(result.graph.edges.every((e) => Number(e.from) < GRAPH_DATASET_NODE_CAP && Number(e.to) < GRAPH_DATASET_NODE_CAP)).toBe(true);
    // P3 — "K of L edges shown": the path graph (a simple chain, no
    // mirrors) is directed and keeps every one of its 49 edges pre-cap
    // (`logicalEdgeCount`), but only 39 of them touch two surviving nodes
    // (`graph.edges.length`) — the gap IS the count the card must show. A
    // regression that stops counting the cap's own edge loss (reporting
    // `logicalEdgeCount === graph.edges.length`) goes red here.
    expect(result.edgeDirection).toBe("directed");
    expect(result.logicalEdgeCount).toBe(49);
    expect(result.graph.edges.length).toBe(39);
    expect(result.logicalEdgeCount).toBeGreaterThan(result.graph.edges.length);
  });
});

describe("loadGraphDatasetRow — edge direction (P1 fix round)", () => {
  it("classifies a fully symmetric edge_index as undirected and dedupes it", async () => {
    // Every (s,d) has its own (d,s): a plain 3-node triangle stored both ways.
    const symmetricRow = {
      num_rows_total: 1,
      rows: [{ row: {
        num_nodes: 3,
        edge_index: [[0, 1, 1, 2, 0, 2], [1, 0, 2, 1, 2, 0]],
        y: [0],
      } }],
    };
    const result = await loadGraphDatasetRow(REF, 0, { fetch: stubFetch(symmetricRow) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.edgeDirection).toBe("undirected");
    expect(result.graph.edges.length).toBe(3);
    expect(result.dedupedMirrorEdges).toBe(3);
    expect(result.graph.edges.every((e) => e.style === "undirected")).toBe(true);
  });

  it("keeps a genuinely directed graph in full — a one-way edge anywhere stops the whole graph from being deduped", async () => {
    // A->B and B->A DO mirror each other, but C->D has no D->C — the graph
    // as a whole is NOT symmetric, so nothing is deduped: all 3 edges
    // survive, directed. A regression that dedupes per-pair (rather than
    // classifying the WHOLE graph first) would drop A->B or B->A to 1 edge
    // here, losing a genuinely directed relationship — this test goes red
    // on that mutation.
    const asymmetricRow = {
      num_rows_total: 1,
      rows: [{ row: {
        num_nodes: 4,
        edge_index: [[0, 1, 2], [1, 0, 3]], // A->B, B->A, C->D
        y: [0],
      } }],
    };
    const result = await loadGraphDatasetRow(REF, 0, { fetch: stubFetch(asymmetricRow) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.edgeDirection).toBe("directed");
    expect(result.dedupedMirrorEdges).toBe(0);
    expect(result.graph.edges.length).toBe(3);
    expect(result.logicalEdgeCount).toBe(3);
    // No edge carries `style: "undirected"` — every one keeps its arrowhead.
    expect(result.graph.edges.some((e) => e.style === "undirected")).toBe(false);
    expect(result.graph.edges).toEqual(expect.arrayContaining([
      { from: "0", to: "1" }, { from: "1", to: "0" }, { from: "2", to: "3" },
    ]));
  });
});

describe("loadGraphDatasetRow — failure kinds", () => {
  it("reports gated on a 401 from /splits", async () => {
    const fetch: GraphDatasetLoadFetch = vi.fn(async () => jsonResponse(401, {}));
    const result = await loadGraphDatasetRow(REF, 0, { fetch });
    expect(result).toMatchObject({ ok: false, kind: "gated" });
  });

  it("reports gated on a 403 from /splits too — a genuinely distinct status the 401 case alone never exercises", async () => {
    const fetch: GraphDatasetLoadFetch = vi.fn(async () => jsonResponse(403, {}));
    const result = await loadGraphDatasetRow(REF, 0, { fetch });
    expect(result).toMatchObject({ ok: false, kind: "gated" });
  });

  it("reports not-found on a 404 from /splits", async () => {
    const fetch: GraphDatasetLoadFetch = vi.fn(async () => jsonResponse(404, {}));
    const result = await loadGraphDatasetRow(REF, 0, { fetch });
    expect(result).toMatchObject({ ok: false, kind: "not-found" });
  });

  it("reports network on a 500 from /splits", async () => {
    const fetch: GraphDatasetLoadFetch = vi.fn(async () => jsonResponse(500, {}));
    const result = await loadGraphDatasetRow(REF, 0, { fetch });
    expect(result).toMatchObject({ ok: false, kind: "network" });
  });

  it("reports not-graph when a row has no edge_index/num_nodes", async () => {
    const fetch = stubFetch({ num_rows_total: 1, rows: [{ row: { some_other_field: 1 } }] });
    const result = await loadGraphDatasetRow(REF, 0, { fetch });
    expect(result).toMatchObject({ ok: false, kind: "not-graph" });
  });

  it("reports row-not-found when the rows page comes back empty", async () => {
    const fetch = stubFetch({ num_rows_total: 0, rows: [] });
    const result = await loadGraphDatasetRow(REF, 0, { fetch });
    expect(result).toMatchObject({ ok: false, kind: "row-not-found" });
  });

  it("never throws for any of the above — every branch resolves", async () => {
    const fetch: GraphDatasetLoadFetch = vi.fn(async () => { throw new Error("boom"); });
    await expect(loadGraphDatasetRow(REF, 0, { fetch })).resolves.toMatchObject({ ok: false, kind: "network" });
  });
});

describe("loadRandomGraphDatasetRow", () => {
  it("respects the node cap by retrying a different row rather than always returning row 0", async () => {
    const small = { num_nodes: 5, edge_index: [[0, 1], [1, 2]], y: [0] };
    const big = { num_nodes: GRAPH_DATASET_NODE_CAP + 5, edge_index: [[0], [1]], y: [0] };
    let call = 0;
    const fetch: GraphDatasetLoadFetch = vi.fn(async (url: string) => {
      if (url.includes("/splits")) return jsonResponse(200, JSON.parse(SPLITS_BODY));
      call++;
      // Row 0 (the probe) is oversized; every retry is small — a caller
      // that stopped retrying after the probe would return the oversized
      // one, which this test's own `simplified: false` assertion catches.
      const isProbe = call === 1;
      return jsonResponse(200, { num_rows_total: 100, rows: [{ row: isProbe ? big : small }] });
    });
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.5);
    try {
      const result = await loadRandomGraphDatasetRow(REF, { fetch });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.simplified).toBe(false);
      expect(result.graph.nodes.length).toBe(5);
    } finally {
      randomSpy.mockRestore();
    }
  });

  it("falls back to a truncated graph when every attempt is oversized, rather than failing", async () => {
    const big = { num_nodes: GRAPH_DATASET_NODE_CAP + 20, edge_index: [[0, 1], [1, 2]], y: [0] };
    const fetch: GraphDatasetLoadFetch = vi.fn(async (url: string) => {
      if (url.includes("/splits")) return jsonResponse(200, JSON.parse(SPLITS_BODY));
      return jsonResponse(200, { num_rows_total: 100, rows: [{ row: big }] });
    });
    const result = await loadRandomGraphDatasetRow(REF, { fetch });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.simplified).toBe(true);
    expect(result.graph.nodes.length).toBe(GRAPH_DATASET_NODE_CAP);
  });

  it("reports the dataset's real total row count", async () => {
    const fetch: GraphDatasetLoadFetch = vi.fn(async (url: string) => {
      if (url.includes("/splits")) return jsonResponse(200, JSON.parse(SPLITS_BODY));
      return jsonResponse(200, { num_rows_total: 188, rows: [{ row: mutagRow0.rows[0].row }] });
    });
    const result = await loadRandomGraphDatasetRow(REF, { fetch });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.totalRows).toBe(188);
  });
});
