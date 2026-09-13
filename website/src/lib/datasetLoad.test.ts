import { describe, expect, it } from "vitest";
import { loadDatasetRows, type DatasetLoadFetch } from "./datasetLoad";
import type { DatasetHit } from "./datasetSearch";

// No network here — every case injects a stub `fetch`. Response shapes
// (`/splits`, `/rows`, `/api/datasets/<id>` siblings) match real recorded
// bodies (see this file's sibling `datasetSearch.test.ts` and the header
// comment on `datasets/remoteIndex.ts` for how those were verified live).

function res(status: number, body: string, headers: Record<string, string> = {}): Awaited<ReturnType<DatasetLoadFetch>> {
  return {
    ok: status >= 200 && status < 300, status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    text: async () => body,
  };
}

function streamRes(status: number, chunks: readonly string[], headers: Record<string, string> = {}): Awaited<ReturnType<DatasetLoadFetch>> {
  const encoder = new TextEncoder();
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= chunks.length) { controller.close(); return; }
      controller.enqueue(encoder.encode(chunks[i]!));
      i++;
    },
  });
  const full = chunks.join("");
  return { ok: status >= 200 && status < 300, status, headers: { get: (name: string) => headers[name.toLowerCase()] ?? null }, text: async () => full, body };
}

const hfHit: DatasetHit = { id: "scikit-learn/iris", kind: "hf", ref: "scikit-learn/iris", title: "Iris", url: "https://huggingface.co/datasets/scikit-learn/iris" };

describe("loadDatasetRows — Hugging Face rows-server path", () => {
  it("resolves splits then rows into flat TabularRow[]", async () => {
    const calls: string[] = [];
    const fetchImpl: DatasetLoadFetch = async (url) => {
      calls.push(url);
      if (url.includes("/splits?")) return res(200, JSON.stringify({ splits: [{ dataset: "scikit-learn/iris", config: "default", split: "train" }] }));
      if (url.includes("/rows?")) {
        return res(200, JSON.stringify({
          features: [{ name: "a" }, { name: "b" }],
          rows: [{ row_idx: 0, row: { a: 1, b: "x" } }, { row_idx: 1, row: { a: 2, b: "y" } }],
          num_rows_total: 2,
        }));
      }
      throw new Error(`unexpected url ${url}`);
    };
    const result = await loadDatasetRows(hfHit, { fetch: fetchImpl });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toEqual([{ a: 1, b: "x" }, { a: 2, b: "y" }]);
    expect(result.columns).toEqual(["a", "b"]);
    expect(result.truncated).toBe(false);
    expect(result.source.url).toBe("https://huggingface.co/datasets/scikit-learn/iris");
    expect(calls.some((u) => u.includes("/splits?"))).toBe(true);
  });

  it("pages past the rows-server's own 100-row cap up to maxRows", async () => {
    const fetchImpl: DatasetLoadFetch = async (url) => {
      if (url.includes("/splits?")) return res(200, JSON.stringify({ splits: [{ config: "default", split: "train" }] }));
      const offsetMatch = /offset=(\d+)/.exec(url);
      const offset = offsetMatch ? Number(offsetMatch[1]) : 0;
      const pageRows = Array.from({ length: 100 }, (_, i) => ({ row_idx: offset + i, row: { n: offset + i } }));
      return res(200, JSON.stringify({ features: [{ name: "n" }], rows: pageRows, num_rows_total: 250 }));
    };
    const result = await loadDatasetRows(hfHit, { fetch: fetchImpl, maxRows: 150 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(150);
    expect(result.rows[0]).toEqual({ n: 0 });
    expect(result.rows[149]).toEqual({ n: 149 });
    expect(result.truncated).toBe(true); // 150 loaded of 250 total
  });

  it("flattens a nested object/array field to a string rather than dropping it", async () => {
    const fetchImpl: DatasetLoadFetch = async (url) => {
      if (url.includes("/splits?")) return res(200, JSON.stringify({ splits: [{ config: "default", split: "train" }] }));
      return res(200, JSON.stringify({ features: [{ name: "tags" }], rows: [{ row_idx: 0, row: { tags: ["a", "b"] } }], num_rows_total: 1 }));
    };
    const result = await loadDatasetRows(hfHit, { fetch: fetchImpl });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rows[0]!.tags).toBe(JSON.stringify(["a", "b"]));
  });

  it("kind: gated when the rows-server itself refuses with 401/403", async () => {
    const fetchImpl: DatasetLoadFetch = async () => res(401, "");
    const result = await loadDatasetRows(hfHit, { fetch: fetchImpl });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("gated");
  });

  it("falls back to the raw-file sibling listing when /splits has no splits at all", async () => {
    const fetchImpl: DatasetLoadFetch = async (url) => {
      if (url.includes("/splits?")) return res(200, JSON.stringify({ splits: [] }));
      if (url.includes("/api/datasets/")) return res(200, JSON.stringify({ siblings: [{ rfilename: "README.md" }, { rfilename: "iris.csv" }] }));
      if (url.endsWith("/resolve/main/iris.csv")) return res(200, "a,b\n1,2\n3,4\n");
      throw new Error(`unexpected url ${url}`);
    };
    const result = await loadDatasetRows(hfHit, { fetch: fetchImpl });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rows).toEqual([{ a: 1, b: 2 }, { a: 3, b: 4 }]);
  });

  it("kind: not-found when neither the rows-server nor the metadata listing knows the id", async () => {
    const fetchImpl: DatasetLoadFetch = async (url) => {
      if (url.includes("/splits?")) return res(404, "");
      if (url.includes("/api/datasets/")) return res(404, "");
      throw new Error("unexpected");
    };
    const result = await loadDatasetRows(hfHit, { fetch: fetchImpl });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("not-found");
  });

  it("kind: not-tabular when the sibling listing has no CSV/TSV/JSON file", async () => {
    const fetchImpl: DatasetLoadFetch = async (url) => {
      if (url.includes("/splits?")) return res(200, JSON.stringify({ splits: [] }));
      if (url.includes("/api/datasets/")) return res(200, JSON.stringify({ siblings: [{ rfilename: "model.safetensors" }] }));
      throw new Error("unexpected");
    };
    const result = await loadDatasetRows(hfHit, { fetch: fetchImpl });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("not-tabular");
  });

  it("kind: network on a fetch rejection", async () => {
    const fetchImpl: DatasetLoadFetch = async () => { throw new Error("offline"); };
    const result = await loadDatasetRows(hfHit, { fetch: fetchImpl });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("network");
  });
});

describe("loadDatasetRows — raw URL (pasted GitHub/HF-resolve link)", () => {
  const urlHit: DatasetHit = { id: "https://raw.githubusercontent.com/o/r/main/d.csv", kind: "url", ref: "https://raw.githubusercontent.com/o/r/main/d.csv", title: "d.csv", url: "https://raw.githubusercontent.com/o/r/main/d.csv" };

  it("fetches and parses a small CSV file directly", async () => {
    const fetchImpl: DatasetLoadFetch = async () => res(200, "x,y\n1,2\n3,4\n");
    const result = await loadDatasetRows(urlHit, { fetch: fetchImpl });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rows).toEqual([{ x: 1, y: 2 }, { x: 3, y: 4 }]);
  });

  it("kind: too-big when Content-Length declares far more than the byte cap, with no body read", async () => {
    let textCalled = false;
    const fetchImpl: DatasetLoadFetch = async () => {
      const r = res(200, "unused", { "content-length": String(50 * 1024 * 1024) });
      return { ...r, text: async () => { textCalled = true; return "unused"; } };
    };
    const result = await loadDatasetRows(urlHit, { fetch: fetchImpl, maxBytes: 1024 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("too-big");
    expect(textCalled).toBe(false);
  });

  it("streams and caps a body with no declared Content-Length, dropping the trailing partial CSV line", async () => {
    const rows = Array.from({ length: 500 }, (_, i) => `${i},${i * 2}\n`);
    const chunks = ["a,b\n", ...rows];
    const fetchImpl: DatasetLoadFetch = async () => streamRes(200, chunks);
    const result = await loadDatasetRows(urlHit, { fetch: fetchImpl, maxBytes: 200, maxRows: 10_000 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.truncated).toBe(true);
    // Every kept row must be a genuinely complete "n,m" pair — a cut
    // trailing line would parse as a lone number with a missing "b"
    // column, which `parseTabular`'s own header-column-count check would
    // either reject outright or leave with an undefined field; this
    // asserts every row has both columns instead of just "didn't throw".
    for (const row of result.rows) { expect(row.a).toBeDefined(); expect(row.b).toBeDefined(); }
  });

  it("kind: not-found on a 404", async () => {
    const fetchImpl: DatasetLoadFetch = async () => res(404, "");
    const result = await loadDatasetRows(urlHit, { fetch: fetchImpl });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("not-found");
  });

  it("kind: gated on a 401/403", async () => {
    const fetchImpl: DatasetLoadFetch = async () => res(403, "");
    const result = await loadDatasetRows(urlHit, { fetch: fetchImpl });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("gated");
  });

  it("kind: not-tabular when the file doesn't parse as rows", async () => {
    const fetchImpl: DatasetLoadFetch = async () => res(200, "not,tabular,at,all\nbut\nonly\none\ncolumn\nreally");
    const jsonHit: DatasetHit = { ...urlHit, ref: "https://raw.githubusercontent.com/o/r/main/d.json", id: "https://raw.githubusercontent.com/o/r/main/d.json", url: "https://raw.githubusercontent.com/o/r/main/d.json" };
    const fetchBad: DatasetLoadFetch = async () => res(200, "not json at all {{{");
    const result = await loadDatasetRows(jsonHit, { fetch: fetchBad });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(["not-tabular", "too-big"]).toContain(result.kind);
    // Sanity: the CSV variant above at least resolves as SOME shape.
    await loadDatasetRows(urlHit, { fetch: fetchImpl });
  });

  it("kind: network when fetch rejects", async () => {
    const fetchImpl: DatasetLoadFetch = async () => { throw new Error("dns failure"); };
    const result = await loadDatasetRows(urlHit, { fetch: fetchImpl });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("network");
  });

  it("caps rows at maxRows even when the whole file fits under maxBytes", async () => {
    const rows = Array.from({ length: 50 }, (_, i) => `${i}\n`).join("");
    const fetchImpl: DatasetLoadFetch = async () => res(200, `n\n${rows}`);
    const result = await loadDatasetRows(urlHit, { fetch: fetchImpl, maxRows: 5 });
    expect(result.ok).toBe(true);
    if (result.ok) { expect(result.rows).toHaveLength(5); expect(result.truncated).toBe(true); }
  });
});
