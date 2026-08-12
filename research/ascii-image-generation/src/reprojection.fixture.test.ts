import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("reprojection fixture", () => {
  it("keeps the NCHW golden explicit and hashed by the committed fixture", async () => {
    const fixture = JSON.parse(await readFile(fileURLToPath(new URL("../fixtures/reprojection/golden-v1.json", import.meta.url)), "utf8"));
    expect(fixture.schemaVersion).toBe("glyph-reprojection-fixture/v1");
    expect(fixture.sourceRgbCellMajor).toEqual([1, 0, 0, 0, 1, 0]);
    expect(fixture.expectedWarpRgbNchw).toEqual([1, 0, 0, 1, 0, 0]);
  });
});
