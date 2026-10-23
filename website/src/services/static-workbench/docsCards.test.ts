import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { docsSidebar } from "../../config/docsSidebar.mjs";
import { firstGlyphDocsExample, glyphDocsExamples } from "../docs-render/firstExample";
import { fitGlyphDocsOutput, renderGlyphDocs } from "../docs-render/glyphRender";
import { cardFont, socialGrid } from "./docsCards";

function readEntries(dir = "src/content/docs", root = dir): { id: string; body: string; data: { title: string } }[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return readEntries(path, root);
    if (!/\.mdx?$/.test(entry.name)) return [];
    const body = readFileSync(path, "utf8");
    const id = body.match(/^slug: (.+)$/m)?.[1] ?? path.slice(root.length + 1).replace(/\.mdx?$/, "");
    return [{ id, body, data: { title: body.match(/^title: (.+)$/m)?.[1] ?? id } }];
  });
}

vi.mock("astro:content", () => ({ getCollection: async () => readEntries() }));
const { GET: manifestGET } = await import("../../integrations/astro/og-manifest.json");
const { GET: rendersGET } = await import("../../integrations/astro/og-renders.json");
const manifest = await (await manifestGET()).json();
const renders = await (await rendersGET()).json();

describe("social JSON endpoints", () => {
  it("uses exact sidebar group labels, including coding agents outside its path prefix", () => {
    for (const group of docsSidebar) {
      for (const item of group.items) {
        expect(manifest.find((doc: { slug: string }) => doc.slug === `docs/${item.slug}`)?.section).toBe(group.label);
      }
    }
    expect(new Set(manifest.map((doc: { slug: string }) => doc.slug)).size).toBe(manifest.length);
  });

  it("includes every docs page and resolves every manifest render key", () => {
    for (const { id } of readEntries()) {
      expect(manifest.find((doc: { slug: string }) => doc.slug === `docs/${id}`)).toBeDefined();
    }
    for (const doc of manifest) expect(renders[doc.render], doc.slug).toBeDefined();
  });

  it("uses each page's first GlyphRender output, cropped and legible", async () => {
    let count = 0;
    for (const entry of readEntries()) {
      const inputs = await glyphDocsExamples(entry.body);
      if (!inputs.length) continue;
      count++;
      const doc = manifest.find((doc: { slug: string }) => doc.slug === `docs/${entry.id}`);
      expect(doc.render).toBe(doc.slug);
      const first = socialGrid(
        fitGlyphDocsOutput(
          await renderGlyphDocs(inputs[0]!),
          (inputs[0]!.options as { textScale?: number } | undefined)?.textScale ?? 1,
        ),
      );
      const [grid] = renders[doc.render];
      expect(grid, entry.id).toEqual(first);
      expect(cardFont(grid), entry.id).toBeGreaterThanOrEqual(10);
    }
    expect(count).toBeGreaterThan(35);
    expect(renders["docs/charts/bar"][0].html).toContain("Search");
    expect(renders["docs/charts/bar"]).not.toEqual(renders.charts);
  });

  it("keeps workbench cards readable with one branching pipeline flowchart and two bold charts", () => {
    expect(renders.diagrams).toHaveLength(1);
    expect(renders.charts).toHaveLength(2);
    for (const key of ["diagrams", "charts"]) {
      const tileHeight = (490 - 18 * (renders[key].length - 1)) / renders[key].length;
      for (const grid of renders[key]) {
        expect(Math.min(548 / (grid.cols * 0.6), tileHeight / grid.rows)).toBeGreaterThanOrEqual(11);
        expect(grid.html).toContain("color:");
        expect(grid.html).not.toMatch(/<(?:canvas|img|svg)\b/);
      }
    }
    const text = renders.diagrams[0].html.replace(/<[^>]*>/g, "");
    for (const label of ["Push commit", "Tests pass?", "Deploy prod", "Fix build"]) expect(text).toContain(label);
    expect(renders.charts[0].html).toMatch(/[█▀▄▌▐]/);
    expect(renders.charts[0].html).not.toMatch(/[\u2801-\u28ff]/);
  });

  it("uses distinct colourful real models per section without examples, and Earth for Maps", () => {
    const keys = ["docs-start", "docs-components", "docs-guides", "docs-api"];
    expect(new Set(keys.map((key) => renders[key][0].html)).size).toBe(keys.length);
    for (const key of keys) {
      const html = renders[key][0].html;
      expect(new Set(html.match(/color:[^";]+/g)).size).toBeGreaterThan(2);
      expect(html.replace(/<[^>]+>/g, "").replace(/\s/g, "").length).toBeGreaterThan(500);
    }
    for (const [id, key] of [
      ["introduction", "docs-start"],
      ["components/glyph-scene", "docs-components"],
      ["guides/meshes", "docs-guides"],
      ["api/react", "docs-api"],
      ["maps/overview", "home"],
    ]) {
      expect(manifest.find((doc: { slug: string }) => doc.slug === `docs/${id}`)?.render).toBe(key);
    }
  });
});

it("parses multiline JSON props in document order, ignoring fenced and inline code examples", async () => {
  const example = '<GlyphRender source={"flowchart LR; A --> B"} kind="diagram" options={{"width":48}} />';
  expect(await firstGlyphDocsExample(`\`\`\`mdx\n${example}\n\`\`\``)).toBeUndefined();
  expect(await firstGlyphDocsExample(`\`${example}\``)).toBeUndefined();
  const multiline = `~~~mdx\n${example}\n~~~\n<details>\n<GlyphRender
    source={"flowchart LR; First --> Actual"}
    kind="diagram"
    options={{"width":48}}
  />\n</details>\n${example}`;
  expect(await firstGlyphDocsExample(multiline)).toEqual({
    kind: "diagram",
    source: "flowchart LR; First --> Actual",
    options: { width: 48 },
  });
  await expect(firstGlyphDocsExample('<GlyphRender kind="diagram" source={variable} />')).rejects.toThrow();
});

describe("socialGrid", () => {
  it("crops the blank columns a render pads around its art", () => {
    expect(socialGrid({ text: "      \n   ab   \n    cde \n" })).toMatchObject({ indent: 3, cols: 4, rows: 4 });
  });
});
