import { describe, expect, it } from "vitest";
import { DATASET_SEARCH_RESULT_LIMIT, parseDatasetHitFromQuery, searchDatasets } from "./datasetSearch";

// No network in this file — every `searchDatasets` call injects a stub
// `fetchJson`. Real HF response shapes (`format:csv`, `modality:tabular`,
// `size_categories:n<1K`, `cardData.pretty_name`) are read off the live API
// during development (see `datasets/remoteIndex.ts`'s own header), not
// invented here.

function hfEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: "scikit-learn/iris", downloads: 13528, likes: 12, private: false, gated: false, disabled: false,
    tags: ["license:cc0-1.0", "size_categories:n<1K", "format:csv", "modality:tabular"],
    description: "\n\t\nIris Species Dataset\n\nThe Iris dataset was used in R.A. Fisher's classic 1936 paper.",
    cardData: { pretty_name: "Iris Species Dataset" },
    ...overrides,
  };
}

describe("searchDatasets", () => {
  it("returns [] for a blank query without calling fetch", async () => {
    let called = false;
    const result = await searchDatasets("   ", { fetchJson: async () => { called = true; return []; } });
    expect(result).toEqual([]);
    expect(called).toBe(false);
  });

  it("maps a real-shaped tabular hit into a DatasetHit", async () => {
    const hits = await searchDatasets("iris", { fetchJson: async () => [hfEntry()] });
    expect(hits).toEqual([{
      id: "scikit-learn/iris", kind: "hf", ref: "scikit-learn/iris", title: "Iris Species Dataset",
      description: "Iris Species Dataset", downloads: 13528, likes: 12,
      tags: ["license:cc0-1.0", "size_categories:n<1K", "format:csv", "modality:tabular"],
      url: "https://huggingface.co/datasets/scikit-learn/iris", licence: "cc0-1.0",
    }]);
  });

  it("filters out a hit with no tabular tag at all (the common case — most Hub datasets are image/audio/text corpora)", async () => {
    const hits = await searchDatasets("cats", { fetchJson: async () => [hfEntry({ id: "some/cat-images", tags: ["task_categories:image-classification"] })] });
    expect(hits).toEqual([]);
  });

  it("filters out private, gated and disabled hits", async () => {
    for (const flag of ["private", "gated", "disabled"] as const) {
      const hits = await searchDatasets("x", { fetchJson: async () => [hfEntry({ [flag]: true })] });
      expect(hits).toEqual([]);
    }
  });

  it("falls back to the bare id when cardData.pretty_name is absent", async () => {
    const hits = await searchDatasets("titanic", { fetchJson: async () => [hfEntry({ id: "mstz/titanic", cardData: undefined })] });
    expect(hits[0]!.title).toBe("mstz/titanic");
  });

  it("ranks by downloads descending, ignoring the injected fetch's own order", async () => {
    const hits = await searchDatasets("x", {
      fetchJson: async () => [
        hfEntry({ id: "a/a", downloads: 10 }), hfEntry({ id: "b/b", downloads: 9000 }), hfEntry({ id: "c/c", downloads: 500 }),
      ],
    });
    expect(hits.map((h) => h.id)).toEqual(["b/b", "c/c", "a/a"]);
  });

  it("caps at the default limit, and respects an explicit one", async () => {
    const many = Array.from({ length: 20 }, (_, i) => hfEntry({ id: `x/x${i}`, downloads: 20 - i }));
    const hits = await searchDatasets("x", { fetchJson: async () => many });
    expect(hits).toHaveLength(DATASET_SEARCH_RESULT_LIMIT);
    const capped = await searchDatasets("x", { fetchJson: async () => many, limit: 3 });
    expect(capped).toHaveLength(3);
  });

  it("never throws on a network failure or a malformed body — resolves empty instead", async () => {
    await expect(searchDatasets("x", { fetchJson: async () => { throw new Error("offline"); } })).resolves.toEqual([]);
    await expect(searchDatasets("x", { fetchJson: async () => ({ not: "an array" }) })).resolves.toEqual([]);
  });

  it("size_categories alone (no format:/modality: tag) still counts as tabular when it's a SMALL bucket", async () => {
    const hits = await searchDatasets("x", { fetchJson: async () => [hfEntry({ tags: ["size_categories:1K<n<10K"] })] });
    expect(hits).toHaveLength(1);
  });

  it("a large size_categories bucket with no other tabular signal is filtered out", async () => {
    const hits = await searchDatasets("x", { fetchJson: async () => [hfEntry({ tags: ["size_categories:100M<n<1B"] })] });
    expect(hits).toEqual([]);
  });
});

describe("parseDatasetHitFromQuery", () => {
  it("recognizes a raw GitHub CSV/JSON/TSV file URL", () => {
    const hit = parseDatasetHitFromQuery("https://raw.githubusercontent.com/owner/repo/main/data/cars.csv");
    expect(hit).toEqual({ id: "https://raw.githubusercontent.com/owner/repo/main/data/cars.csv", kind: "url", ref: "https://raw.githubusercontent.com/owner/repo/main/data/cars.csv", title: "cars.csv", url: "https://raw.githubusercontent.com/owner/repo/main/data/cars.csv" });
  });

  it("recognizes a Hugging Face resolve file URL", () => {
    const url = "https://huggingface.co/datasets/scikit-learn/iris/resolve/main/Iris.csv";
    const hit = parseDatasetHitFromQuery(url);
    expect(hit).toMatchObject({ kind: "url", ref: url, title: "Iris.csv" });
  });

  it("recognizes a bare org/name id", () => {
    expect(parseDatasetHitFromQuery("mstz/titanic")).toEqual({ id: "mstz/titanic", kind: "hf", ref: "mstz/titanic", title: "mstz/titanic", url: "https://huggingface.co/datasets/mstz/titanic" });
  });

  it("returns null for a plain search phrase, a bare word, or an unsupported URL", () => {
    expect(parseDatasetHitFromQuery("iris flowers")).toBeNull();
    expect(parseDatasetHitFromQuery("titanic")).toBeNull();
    expect(parseDatasetHitFromQuery("https://example.com/data.csv")).toBeNull();
    expect(parseDatasetHitFromQuery("")).toBeNull();
    expect(parseDatasetHitFromQuery("   ")).toBeNull();
  });

  it("rejects a non-CSV/JSON/TSV raw GitHub URL", () => {
    expect(parseDatasetHitFromQuery("https://raw.githubusercontent.com/owner/repo/main/README.md")).toBeNull();
  });
});
