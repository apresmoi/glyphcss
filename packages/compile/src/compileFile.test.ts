import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { loadMeshFromFile } from "./loadMeshFromFile";
import { compileFile } from "./compileFile";
import { glyphcssCompile } from "./vite";

// Resolve from cwd (the package dir under vitest) — env-agnostic, unlike
// import.meta.url which happy-dom rewrites to a non-file:// URL.
const DOG = resolve(process.cwd(), "../../website/public/gallery/glb/Dog.glb");

describe("@glyphcss/compile", () => {
  it("loadMeshFromFile parses a .glb from disk", async () => {
    const result = await loadMeshFromFile(DOG);
    expect(result.polygons.length).toBeGreaterThan(0);
  });

  it("compileFile produces a non-empty <pre> with content", async () => {
    const r = await compileFile(DOG, { autoCenter: true, rotX: 60, rotY: 45, zoom: 0.5, cols: 80, rows: 30 });
    expect(r.html.startsWith('<pre class="glyph-output">')).toBe(true);
    expect(r.html.endsWith("</pre>")).toBe(true);
    expect(r.cols).toBe(80);
    expect(r.rows).toBe(30);
    // Actual rendered glyphs (not just whitespace).
    expect(r.inner.replace(/<[^>]*>/g, "").replace(/\s/g, "").length).toBeGreaterThan(100);
  });

  it("compileFile honors --no-colors (plain escaped text, no spans)", async () => {
    const r = await compileFile(DOG, { autoCenter: true, useColors: false, cols: 40, rows: 16 });
    expect(r.inner.includes("<span")).toBe(false);
  });

  it("vite plugin compiles a mesh import with ?glyph", async () => {
    const plugin = glyphcssCompile();
    const id = `${DOG}?glyph&autoCenter=1&rotX=60&rotY=45&zoom=0.5&cols=60&rows=24`;
    const code = await (plugin.load as (id: string) => Promise<string | null>)(id);
    expect(code).toBeTruthy();
    expect(code).toContain("export default");
    expect(code).toContain("glyph-output");
    expect(code).toContain("export const meta");
  });

  it("vite plugin ignores non-glyph mesh imports", async () => {
    const plugin = glyphcssCompile();
    const out = await (plugin.load as (id: string) => Promise<string | null>)(`${DOG}?url`);
    expect(out).toBeNull();
  });
});

describe("@glyphcss/compile — autoFit", () => {
  it("sizes the grid to the content (cropped tight) without cols/rows", async () => {
    const r = await compileFile(DOG, { autoFit: { target: 40, by: "cols" }, autoCenter: true, rotX: 72, rotY: 28 });
    expect(r.cols).toBeGreaterThan(0);
    expect(r.cols).toBeLessThanOrEqual(60);      // ~target, cropped (not the padded grid)
    expect(r.rows).toBeGreaterThan(0);
    // no leading empty column across the whole block (cropped left)
    const lines = r.inner.split("\n");
    const minLead = Math.min(...lines.filter((l) => l.replace(/<[^>]*>/g, "").trim()).map((l) => {
      const t = l.replace(/<[^>]*>/g, ""); return t.length - t.replace(/^ +/, "").length;
    }));
    expect(minLead).toBe(0);
  });

  it("loads OBJ material + bakes texture colors (no palette-blue fallback)", async () => {
    const EXT = resolve(process.cwd(), "../../website/public/gallery/obj/opengameart/fire-extinguisher/extinguisher.obj");
    const r = await loadMeshFromFile(EXT);
    const colors = new Set(r.polygons.map((p) => p.color).filter(Boolean) as string[]);
    expect(colors.size).toBeGreaterThan(10);     // sampled from the texture → many colors
    expect(colors.has("#3b82f6")).toBe(false);   // not parseObj's palette fallback
    const reddish = [...colors].some((c) => {
      const rr = parseInt(c.slice(1, 3), 16), bb = parseInt(c.slice(5, 7), 16);
      return rr > 120 && rr > bb + 40;            // extinguisher body red
    });
    expect(reddish).toBe(true);
  });

  it("fits by rows — cols adapt to show the whole model", async () => {
    const r = await compileFile(DOG, { autoFit: { target: 24, by: "rows" }, autoCenter: true, rotX: 72, rotY: 28 });
    expect(r.rows).toBeGreaterThan(0);
    expect(r.rows).toBeLessThanOrEqual(40);   // ~24 rows, cropped (not the padded grid)
    expect(r.cols).toBeGreaterThan(0);        // width adapted to content
  });
});
