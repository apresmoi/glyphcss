import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { loadMeshFromFile } from "./loadMeshFromFile";
import { compileFile } from "./compileFile";
import { glyphcssCompile } from "./vite";

const DOG = fileURLToPath(new URL("../../../website/public/gallery/glb/Dog.glb", import.meta.url));

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
