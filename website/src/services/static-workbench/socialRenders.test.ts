import { describe, expect, it } from "vitest";
import { socialBench, socialEarth } from "./socialRenders";

describe("social-card scene sources", () => {
  it("renders the ETOPO1 globe over the Atlantic as coloured text", async () => {
    const result = await socialEarth();
    expect(result.rows).toBe(72);
    expect(result.cols).toBeGreaterThan(100);
    expect(result.html).toContain("color:");
    expect(result.html.replace(/<[^>]+>/g, "").replace(/\s/g, "").length).toBeGreaterThan(1000);
    expect(result.html).not.toMatch(/<(canvas|img|svg)\b/);
  });

  it("compiles the benchmark's default icosahedron into text", () => {
    const result = socialBench();
    expect(result.html.replace(/<[^>]+>/g, "").replace(/\s/g, "").length).toBeGreaterThan(1000);
    expect(result.html).toContain("color:");
  });
});
