import { describe, it, expect, vi, afterEach } from "vitest";
import { loadMesh } from "./loadMesh";

// ── Helpers ────────────────────────────────────────────────────────────────

const SIMPLE_OBJ = `v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n`;

function makeMockFetch(opts: {
  ok?: boolean;
  status?: number;
  text?: string;
  arrayBuffer?: ArrayBuffer;
}) {
  return vi.fn().mockResolvedValue({
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    text: () => Promise.resolve(opts.text ?? ""),
    arrayBuffer: () => Promise.resolve(opts.arrayBuffer ?? new ArrayBuffer(0)),
  });
}

// Build a minimal valid GLB (no mesh — just magic + empty JSON chunk +
// empty BIN chunk). parseGltf requires a BIN chunk to be present, even if
// the document has no meshes.
function buildMinimalGlb(): ArrayBuffer {
  const jsonStr = JSON.stringify({
    asset: { version: "2.0" },
    meshes: [],
    scenes: [{ nodes: [] }],
    scene: 0,
  });
  const jsonBytes = new TextEncoder().encode(jsonStr);
  const padLen = (4 - (jsonBytes.length % 4)) % 4;
  const jsonChunkLen = jsonBytes.length + padLen;
  const binChunkLen = 0;

  const totalLen = 12 + 8 + jsonChunkLen + 8 + binChunkLen;
  const buf = new ArrayBuffer(totalLen);
  const view = new DataView(buf);
  let off = 0;

  // GLB header: magic "glTF", version 2, total length
  view.setUint32(off, 0x46546c67, true); off += 4; // "glTF"
  view.setUint32(off, 2, true); off += 4;           // version
  view.setUint32(off, totalLen, true); off += 4;    // total length

  // JSON chunk
  view.setUint32(off, jsonChunkLen, true); off += 4;
  view.setUint32(off, 0x4e4f534a, true); off += 4; // CHUNK_JSON
  const jsonOut = new Uint8Array(buf, off, jsonChunkLen);
  jsonOut.set(jsonBytes);
  for (let i = jsonBytes.length; i < jsonChunkLen; i++) jsonOut[i] = 0x20;
  off += jsonChunkLen;

  // BIN chunk (empty)
  view.setUint32(off, binChunkLen, true); off += 4;
  view.setUint32(off, 0x004e4942, true); off += 4; // CHUNK_BIN

  return buf;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe("loadMesh", () => {
  describe(".obj dispatch", () => {
    it("fetches .obj URL as text and returns ParseResult", async () => {
      const fetchMock = makeMockFetch({ text: SIMPLE_OBJ });
      vi.stubGlobal("fetch", fetchMock);

      const result = await loadMesh("model.obj");
      expect(fetchMock).toHaveBeenCalledWith("model.obj");
      expect(result.polygons.length).toBeGreaterThan(0);
    });

    it("passes text to parseObj, returning polygons", async () => {
      vi.stubGlobal("fetch", makeMockFetch({ text: SIMPLE_OBJ }));
      const result = await loadMesh("model.obj");
      expect(result.polygons).toHaveLength(1);
    });
  });

  describe(".glb dispatch", () => {
    it("fetches .glb URL as arrayBuffer and dispatches to parseGltf", async () => {
      const glbBuf = buildMinimalGlb();
      const fetchMock = makeMockFetch({ arrayBuffer: glbBuf });
      vi.stubGlobal("fetch", fetchMock);

      const result = await loadMesh("model.glb");
      expect(fetchMock).toHaveBeenCalledWith("model.glb");
      expect(result).toHaveProperty("polygons");
      expect(result).toHaveProperty("dispose");
    });
  });

  describe(".gltf dispatch", () => {
    it("fetches .gltf URL as arrayBuffer and dispatches to parseGltf", async () => {
      const glbBuf = buildMinimalGlb();
      const fetchMock = makeMockFetch({ arrayBuffer: glbBuf });
      vi.stubGlobal("fetch", fetchMock);

      const result = await loadMesh("model.gltf");
      expect(fetchMock).toHaveBeenCalledWith("model.gltf");
      expect(result).toHaveProperty("polygons");
    });
  });

  describe(".mtl rejection", () => {
    it("throws for .mtl URLs without fetching", async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      await expect(loadMesh("material.mtl")).rejects.toThrow(
        ".mtl is a material file"
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("unknown extension", () => {
    it("throws for unknown extension", async () => {
      vi.stubGlobal("fetch", makeMockFetch({}));
      await expect(loadMesh("model.stl")).rejects.toThrow("unsupported extension");
    });

    it("throws for extension-less URL", async () => {
      vi.stubGlobal("fetch", makeMockFetch({}));
      await expect(loadMesh("model")).rejects.toThrow("unsupported extension");
    });
  });

  describe("fetch error paths", () => {
    it("throws when fetch returns !ok for .obj", async () => {
      vi.stubGlobal("fetch", makeMockFetch({ ok: false, status: 404 }));
      await expect(loadMesh("missing.obj")).rejects.toThrow("404");
    });

    it("throws when fetch returns !ok for .glb", async () => {
      vi.stubGlobal("fetch", makeMockFetch({ ok: false, status: 500 }));
      await expect(loadMesh("missing.glb")).rejects.toThrow("500");
    });

    it("throws when fetch is not available in globalThis", async () => {
      // Remove fetch from globalThis
      vi.stubGlobal("fetch", undefined);
      await expect(loadMesh("model.obj")).rejects.toThrow("no fetch()");
    });
  });

  describe("baseUrl option", () => {
    it("accepts baseUrl option and passes it to parseGltf", async () => {
      const glbBuf = buildMinimalGlb();
      vi.stubGlobal("fetch", makeMockFetch({ arrayBuffer: glbBuf }));

      const result = await loadMesh("model.glb", { baseUrl: "https://example.com/models/" });
      expect(result).toHaveProperty("polygons");
    });
  });

  describe("mtlUrl option (OBJ companion materials)", () => {
    // OBJ that references a material named "Wood" — without an mtl, the
    // parser falls back to the auto-palette; with the mtl, "Wood" → Kd.
    const OBJ_WITH_MTL = [
      "v 0 0 0",
      "v 1 0 0",
      "v 0 1 0",
      "usemtl Wood",
      "f 1 2 3",
      "",
    ].join("\n");

    function makeMultiFetch(map: Record<string, { text?: string; ok?: boolean; status?: number }>) {
      return vi.fn().mockImplementation((url: string) => {
        const entry = map[url];
        if (!entry) {
          return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve(""), arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) });
        }
        return Promise.resolve({
          ok: entry.ok ?? true,
          status: entry.status ?? 200,
          text: () => Promise.resolve(entry.text ?? ""),
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
        });
      });
    }

    it("fetches mtl, parses Kd, and applies the color to the matching usemtl group", async () => {
      vi.stubGlobal("fetch", makeMultiFetch({
        "https://example.com/m.obj": { text: OBJ_WITH_MTL },
        "https://example.com/m.mtl": { text: "newmtl Wood\nKd 0.8 0.4 0.2\n" },
      }));

      const result = await loadMesh("https://example.com/m.obj", {
        mtlUrl: "https://example.com/m.mtl",
      });

      expect(result.polygons.length).toBe(1);
      // Kd 0.8 0.4 0.2 → toHex round → cc 66 33
      expect(result.polygons[0].color?.toLowerCase()).toBe("#cc6633");
    });

    it("propagates map_Kd as a texture, resolving relative paths against the mtl URL", async () => {
      vi.stubGlobal("fetch", makeMultiFetch({
        "https://example.com/models/m.obj": { text: OBJ_WITH_MTL },
        "https://example.com/models/m.mtl": {
          text: "newmtl Wood\nKd 1 1 1\nmap_Kd wood.png\n",
        },
      }));

      const result = await loadMesh("https://example.com/models/m.obj", {
        mtlUrl: "https://example.com/models/m.mtl",
      });

      expect(result.polygons.length).toBe(1);
      expect(result.polygons[0].texture).toBe("https://example.com/models/wood.png");
    });

    it("fails loudly when the mtl URL 404s instead of silently rendering without materials", async () => {
      vi.stubGlobal("fetch", makeMultiFetch({
        "m.obj": { text: OBJ_WITH_MTL },
        "missing.mtl": { ok: false, status: 404 },
      }));

      await expect(
        loadMesh("m.obj", { mtlUrl: "missing.mtl" })
      ).rejects.toThrow(/missing\.mtl/);
    });

    it("ignores mtlUrl for GLB (materials embedded in the glTF JSON)", async () => {
      // GLB carries its own materials. Passing mtlUrl shouldn't fetch it
      // OR throw — it's just irrelevant.
      const glb = buildMinimalGlb();
      const fetchMock = makeMultiFetch({
        "model.glb": {},
      });
      // Override the model.glb branch to return arrayBuffer
      fetchMock.mockImplementation((url: string) => {
        if (url === "model.glb") {
          return Promise.resolve({
            ok: true,
            status: 200,
            text: () => Promise.resolve(""),
            arrayBuffer: () => Promise.resolve(glb),
          });
        }
        // Any other URL (e.g., the mtl we shouldn't fetch) → 404
        return Promise.resolve({
          ok: false, status: 404,
          text: () => Promise.resolve(""),
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
        });
      });
      vi.stubGlobal("fetch", fetchMock);

      const result = await loadMesh("model.glb", { mtlUrl: "ignored.mtl" });
      expect(result).toHaveProperty("polygons");
      // Only the GLB itself should have been fetched; the mtl ignored.
      const fetchedUrls = fetchMock.mock.calls.map((c: unknown[]) => c[0]);
      expect(fetchedUrls).toEqual(["model.glb"]);
    });

    it("user-supplied objOptions.materialColors override mtl-derived colors for the same name", async () => {
      vi.stubGlobal("fetch", makeMultiFetch({
        "m.obj": { text: OBJ_WITH_MTL },
        "m.mtl": { text: "newmtl Wood\nKd 0.8 0.4 0.2\n" },
      }));

      const result = await loadMesh("m.obj", {
        mtlUrl: "m.mtl",
        objOptions: { materialColors: { Wood: "#000000" } },
      });

      expect(result.polygons[0].color).toBe("#000000");
    });
  });

  describe("URL with query params and hash", () => {
    it("extracts extension from URL with ?query", async () => {
      vi.stubGlobal("fetch", makeMockFetch({ text: SIMPLE_OBJ }));
      const result = await loadMesh("model.obj?v=123");
      expect(result.polygons.length).toBeGreaterThan(0);
    });

    it("extracts extension from URL with #hash", async () => {
      vi.stubGlobal("fetch", makeMockFetch({ text: SIMPLE_OBJ }));
      const result = await loadMesh("model.obj#section");
      expect(result.polygons.length).toBeGreaterThan(0);
    });
  });
});
