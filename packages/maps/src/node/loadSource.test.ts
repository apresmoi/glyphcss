import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { loadGlyphMapSource } from "./loadSource";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(__dirname, "../../fixtures/sample-region.asc");

describe("loadGlyphMapSource", () => {
  it("reads a plain ASCII Grid file", async () => {
    const src = await loadGlyphMapSource({ path: FIXTURE, id: "sample-region" });
    expect(src.cols).toBe(60);
    expect(src.rows).toBe(40);
    expect(src.id).toBe("sample-region");
    expect(src.values.length).toBe(60 * 40);
  });

  it("gunzips a .gz-suffixed path automatically", async () => {
    const raw = await fs.readFile(FIXTURE);
    const gz = zlib.gzipSync(raw);
    const tmp = path.join(__dirname, "sample-region.tmp.asc.gz");
    await fs.writeFile(tmp, gz);
    try {
      const src = await loadGlyphMapSource({ path: tmp, id: "sample-region-gz" });
      expect(src.cols).toBe(60);
      expect(src.rows).toBe(40);
    } finally {
      await fs.unlink(tmp);
    }
  });
});
