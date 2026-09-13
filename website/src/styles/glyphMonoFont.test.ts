import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Gate: the shipped "Glyph Mono" web font (packet item 2 — a Cascadia Mono
// subset with full box-drawing/braille coverage, renamed with fontTools so
// the OFL reserved-name clause is respected) must actually be declared and
// wired in front of the charts/diagrams pages' rendered font stack. A
// mutation that drops the @font-face or reorders the stack goes red here.
const cssPath = fileURLToPath(new URL("./glyph-demo.css", import.meta.url));
const css = readFileSync(cssPath, "utf8");

describe("Glyph Mono web font", () => {
  it("glyph-demo.css declares the @font-face for both weights", () => {
    expect(css).toContain('@font-face');
    expect(css).toMatch(/font-family:\s*"Glyph Mono"/);
    expect(css).toContain('src: url("/fonts/glyph-mono.woff2") format("woff2")');
    expect(css).toContain('src: url("/fonts/glyph-mono-bold.woff2") format("woff2")');
    expect(css).toMatch(/font-weight:\s*400/);
    expect(css).toMatch(/font-weight:\s*700/);
    expect(css).toMatch(/font-display:\s*block/);
  });

  it("glyph-demo.css's own .glyph-output font stacks put Glyph Mono first", () => {
    const stacks = [...css.matchAll(/font-family:\s*([^;]+);/g)].map((m) => m[1]);
    const glyphOutputStacks = stacks.filter((s) => s.includes("ui-monospace"));
    expect(glyphOutputStacks.length).toBeGreaterThan(0);
    for (const stack of glyphOutputStacks) expect(stack.trim().startsWith('"Glyph Mono"')).toBe(true);
  });

  it.each(["charts", "diagrams", "maps", "synth"])("the %s page's rendered font stack starts with Glyph Mono", (page) => {
    const astroPath = fileURLToPath(new URL(`../pages/${page}.astro`, import.meta.url));
    const source = readFileSync(astroPath, "utf8");
    expect(source).toContain("import '../styles/glyph-demo.css';");
    const match = source.match(/font-family:\s*([^;]+);/);
    expect(match).not.toBeNull();
    expect(match![1]!.trim().startsWith('"Glyph Mono"')).toBe(true);
  });
});
