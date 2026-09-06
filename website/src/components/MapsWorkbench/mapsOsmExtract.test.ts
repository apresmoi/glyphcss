/**
 * The page's own OSM loader, against the REAL archive bytes the build copies
 * into `public/data/osm/` — not a stub. `fetch` is the only thing stubbed,
 * and it serves the vendored file straight off disk, so this exercises the
 * whole chain the browser runs: fetch → `glyphMapPMTilesBufferSource` →
 * `glyphMapProtomapsExtract`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAP_OSM_ARCHIVE_URL,
  MAP_OSM_DEFAULT_ON,
  MAP_OSM_SUBLAYERS,
  createOsmExtract,
  mapOsmExtentLabel,
  mapOsmExtractSummary,
} from "./mapsOsm";

const ARCHIVE = path.resolve(__dirname, "../../../public/data/osm/zurich-z12.pmtiles");

function serveArchive(): void {
  const bytes = readFileSync(ARCHIVE);
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    expect(url).toBe(MAP_OSM_ARCHIVE_URL);
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    };
  }));
}

afterEach(() => { vi.unstubAllGlobals(); });

describe("createOsmExtract", () => {
  it("reads the self-hosted archive the build copies into public/", async () => {
    serveArchive();
    const extract = await createOsmExtract();
    expect(extract.zoom).toBe(12);
    expect(extract.tileCount).toBe(2);
    expect(Object.keys(extract.sources)).toContain("roads");
    expect(extract.kinds.roads).toContain("highway");
  });

  it("defaults to this repo's own copy, never a third-party bucket", () => {
    expect(MAP_OSM_ARCHIVE_URL.startsWith("/")).toBe(true);
    expect(MAP_OSM_ARCHIVE_URL).not.toMatch(/^https?:/);
  });

  it("names the bake script when the archive has not been copied yet", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404 })));
    await expect(createOsmExtract()).rejects.toThrow(/copy-osm-fixture/);
  });

  it("summarises what the extract holds, in the reader's terms", async () => {
    serveArchive();
    const extract = await createOsmExtract();
    expect(mapOsmExtractSummary(extract)).toMatch(/^Zürich · z12 · 8 layers · [\d,]+ features$/);
    expect(mapOsmExtentLabel(extract.bounds)).toBe("8.52,47.36 → 8.56,47.39");
  });

  it("offers only sublayers the schema mapping declares, defaulting to the ones with the most data", () => {
    const ids = new Set(MAP_OSM_SUBLAYERS.map((s) => s.id));
    for (const id of MAP_OSM_DEFAULT_ON) expect(ids.has(id)).toBe(true);
    expect(MAP_OSM_SUBLAYERS.map((s) => s.id)).toContain("osm-roads");
    expect(MAP_OSM_SUBLAYERS.map((s) => s.id)).toContain("osm-places");
  });
});
