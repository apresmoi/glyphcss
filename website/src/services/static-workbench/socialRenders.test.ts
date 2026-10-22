import { describe, expect, it } from "vitest";
import { socialBench, socialEarth } from "./socialRenders";

describe("social-card scene sources", () => {
  it("compiles the home page's actual Earth mesh into coloured text", async () => {
    const result = await socialEarth();
    expect(result.cols).toBe(120);
    expect(result.rows).toBe(60);
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
