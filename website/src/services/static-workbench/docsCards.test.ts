import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { docsSidebar } from "../../config/docsSidebar.mjs";
import { firstGlyphDocsExample } from "../docs-render/firstExample";
import { fitGlyphDocsOutput, renderGlyphDocs } from "../docs-render/glyphRender";
import { socialGrid } from "./docsCards";

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

  it("uses the first actual GlyphRender byte-for-byte for every page with examples", async () => {
    let count = 0;
    for (const entry of readEntries()) {
      const input = await firstGlyphDocsExample(entry.body);
      if (!input) continue;
      count++;
      const doc = manifest.find((doc: { slug: string }) => doc.slug === `docs/${entry.id}`);
      expect(doc.render).toBe(doc.slug);
      expect(renders[doc.render]).toEqual([socialGrid(fitGlyphDocsOutput(await renderGlyphDocs(input)))]);
      const [grid] = renders[doc.render];
      expect(Math.min(548 / (grid.cols * 0.6), 490 / grid.rows), entry.id).toBeGreaterThanOrEqual(11);
    }
    expect(count).toBeGreaterThan(35);
    expect(renders["docs/charts/bar"][0].html).toContain("Search");
    expect(renders["docs/charts/bar"]).not.toEqual(renders.charts);
    expect(renders["docs/diagrams/flowcharts"][0].html).toContain("Cart");
  });

  it("keeps workbench cards readable with one five-node flowchart and two bold charts", () => {
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
    for (const label of ["Start", "Ready?", "Build", "Fix", "Ship"]) expect(text).toContain(label);
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
