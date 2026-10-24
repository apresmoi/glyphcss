import { describe, expect, it } from "vitest";
import { socialBench, socialEarth } from "./socialRenders";

describe("social-card scene sources", () => {
  it("renders the ETOPO1 globe over the Atlantic as coloured text", async () => {
    const result = await socialEarth();
    expect(result.rows).toBe(36);
    expect(result.cols).toBeGreaterThan(50);
    expect(result.html).toContain("color:");
    expect(result.html.replace(/<[^>]+>/g, "").replace(/\s/g, "").length).toBeGreaterThan(500);
    expect(result.html).not.toMatch(/<(canvas|img|svg)\b/);
  });

  it("draws the benchmark's default icosahedron as braille outlines", () => {
    const result = socialBench();
    const text = result.html.replace(/<[^>]+>/g, "").replace(/\s/g, "");
    expect(text.length).toBeGreaterThan(300);
    expect(text).toMatch(/^[\u2800-\u28ff]+$/);
    expect(result.html).toContain("color:");
  });
});
