// The rules layer must be movable to its own package unchanged: no imports outside rules/
// and no DOM globals.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("reader rules isolation", () => {
  it("imports only sibling rules modules and touches no DOM", () => {
    const dir = __dirname;
    const sources = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
    expect(sources.length).toBeGreaterThan(0);
    for (const f of sources) {
      const src = readFileSync(join(dir, f), "utf8");
      for (const m of src.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) expect(m[1], `${f} imports ${m[1]}`).toMatch(/^\.\/[^/]+$/);
      expect(src, `${f} uses the DOM`).not.toMatch(/\b(document|window|HTMLElement|requestAnimationFrame)\b/);
    }
  });
});
