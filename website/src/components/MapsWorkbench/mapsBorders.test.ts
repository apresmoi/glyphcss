import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workbench = readFileSync(new URL("./hooks/useMapsWorkbench.ts", import.meta.url), "utf8");

describe("default /maps borders", () => {
  it("opts the mounted border layer into live VW and atlas box glyphs", () => {
    const layers = [...workbench.matchAll(/id: BORDER_LAYER_ID,[\s\S]*?\n\s*}/g)];
    expect(layers).toHaveLength(2);
    for (const [options] of layers) {
      expect(options).toContain('simplify: "vw"');
      expect(options).toContain('experimentalGlyphStrategy: "box"');
      expect(options).toContain("density: borderDensity");
    }
  });
});
