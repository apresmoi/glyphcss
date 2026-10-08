import { describe, expect, it, vi } from "vitest";
import { GRAPH_DATASET_SEARCH_RESULT_LIMIT, searchGraphDatasets, type GraphDatasetSearchFetch } from "./graphDatasetSearch";

describe("searchGraphDatasets", () => {
  it("filters the request to task_categories:graph-ml and maps live hits", async () => {
    const fetchJson: GraphDatasetSearchFetch = vi.fn(async (url: string) => {
      expect(url).toContain("filter=task_categories%3Agraph-ml");
      expect(url).toContain("search=protein");
      return [
        { id: "graphs-datasets/PROTEINS", downloads: 164, tags: ["task_categories:graph-ml"], cardData: { pretty_name: "PROTEINS" }, description: "Protein graphs." },
      ];
    });
    const hits = await searchGraphDatasets("protein", { fetchJson });
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ id: "graphs-datasets/PROTEINS", kind: "hf", ref: "graphs-datasets/PROTEINS", title: "PROTEINS" });
  });

  it("returns an empty array (never throws) on a network failure", async () => {
    const fetchJson: GraphDatasetSearchFetch = vi.fn(async () => { throw new Error("offline"); });
    await expect(searchGraphDatasets("mutag", { fetchJson })).resolves.toEqual([]);
  });

  it("returns an empty array for a blank query without calling the network", async () => {
    const fetchJson: GraphDatasetSearchFetch = vi.fn();
    const hits = await searchGraphDatasets("   ", { fetchJson });
    expect(hits).toEqual([]);
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("drops a private/gated/disabled hit and ranks the survivors by downloads", async () => {
    // Each of the three exclusion flags gets its own hit — a mutation that
    // deletes only ONE of the three `||` clauses in `toGraphHit`'s guard
    // still fails this (that hit alone survives and the exact `["org/high",
    // "org/low"]` list gains an extra id), where the original single-hit
    // "gated" test could not distinguish "checks gated" from "checks
    // private/disabled too".
    const fetchJson: GraphDatasetSearchFetch = vi.fn(async () => [
      { id: "org/low", downloads: 1, tags: [] },
      { id: "org/gated", downloads: 999, gated: true, tags: [] },
      { id: "org/private", downloads: 998, private: true, tags: [] },
      { id: "org/disabled", downloads: 997, disabled: true, tags: [] },
      { id: "org/high", downloads: 500, tags: [] },
    ]);
    const hits = await searchGraphDatasets("x", { fetchJson });
    expect(hits.map((h) => h.id)).toEqual(["org/high", "org/low"]);
  });

  it("caps results at the result limit even when the Hub returns more", async () => {
    const fetchJson: GraphDatasetSearchFetch = vi.fn(async () =>
      Array.from({ length: 20 }, (_, i) => ({ id: `org/g${i}`, downloads: i, tags: [] })));
    const hits = await searchGraphDatasets("x", { fetchJson });
    expect(hits.length).toBe(GRAPH_DATASET_SEARCH_RESULT_LIMIT);
  });
});
