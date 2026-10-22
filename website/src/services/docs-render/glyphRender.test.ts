// @vitest-environment happy-dom
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { transform } from "@astrojs/compiler";
import { build } from "esbuild";
import { expect, it } from "vitest";
import { experimental_AstroContainer as AstroContainer } from "astro/container";

import { renderGlyphDiagram } from "@glyphcss/diagrams";
import { renderGlyphSequence } from "@glyphcss/diagrams/sequence";
import { renderGlyphLaneDag } from "@glyphcss/diagrams/lanes";
import { renderGlyphChart, renderGlyphChartMermaid } from "@glyphcss/charts";
import { renderGlyphDocs, type GlyphDocsRenderInput } from "./glyphRender";

// Compile the real Astro adapter without loading the site's routing integrations
// into Vitest. CSS is checked separately by the website's style audit.
const require = createRequire(resolve("package.json"));
const filename = resolve("src/integrations/astro/GlyphRender.astro");
const compiled = await transform(readFileSync(filename, "utf8"), {
  filename,
  internalURL: "astro/compiler-runtime",
  resultScopedSlot: true,
  resolvePath: (path) => path,
});
const bundled = await build({
  stdin: { contents: compiled.code, loader: "ts", resolveDir: resolve("src/integrations/astro") },
  bundle: true,
  write: false,
  outfile: "/tmp/glyph-docs-render-test.mjs",
  platform: "node",
  format: "esm",
  loader: { ".css": "empty" },
  plugins: [
    {
      name: "astro-test-imports",
      setup(builder) {
        builder.onResolve({ filter: /^astro\/compiler-runtime$/ }, (args) => ({
          path: pathToFileURL(require.resolve(args.path)).href,
          external: true,
        }));
        builder.onResolve({ filter: /^@glyphcss\// }, (args) => ({
          path: pathToFileURL(require.resolve(args.path)).href,
          external: true,
        }));
        builder.onResolve({ filter: /services\/docs-render\/glyphRender$/ }, () => ({
          path: resolve("src/services/docs-render/glyphRender.ts"),
        }));
      },
    },
  ],
});
const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0]!.text).toString("base64")}`;
const GlyphRender = (await import(/* @vite-ignore */ moduleUrl)).default;

function parseMarkup(html: string) {
  const template = document.createElement("template");
  template.innerHTML = html;
  return template.content;
}

const options = { target: "chat" as const, color: "none" as const, width: 48, height: 12 };
const fixtures: GlyphDocsRenderInput[] = [
  { kind: "diagram", source: "flowchart LR; Input --> Output", options },
  {
    kind: "diagram",
    source: { direction: "LR", nodes: [{ id: "n", label: "JSON <node> & text" }], edges: [] },
    options,
  },
  { kind: "sequence", source: "sequenceDiagram\n Client->>API: Request\n API-->>Client: Reply", options },
  {
    kind: "lanes",
    source: {
      nodes: [
        { id: "new", label: "New", parents: ["old"] },
        { id: "old", label: "Old", parents: [] },
      ],
    },
    options,
  },
  { kind: "diagram", source: 'gitGraph TB:\n commit id: "Start"\n commit id: "Ship"', options },
  { kind: "chart", source: [2, 5, 3], options },
  { kind: "chart-mermaid", source: 'pie\n "Docs" : 3\n "Code" : 7', options },
];

it.each(fixtures)("uses the real $kind renderer and keeps source-dependent text", async (input) => {
  const actual = await renderGlyphDocs(input);
  let expected;
  switch (input.kind) {
    case "diagram":
      expected = await renderGlyphDiagram(input.source, input.options);
      break;
    case "sequence":
      expected = await renderGlyphSequence(input.source, input.options);
      break;
    case "lanes":
      expected = await renderGlyphLaneDag(input.source, input.options);
      break;
    case "chart":
      expected = renderGlyphChart(input.source, input.options);
      break;
    case "chart-mermaid":
      expected = renderGlyphChartMermaid(input.source, input.options);
      break;
  }
  expect(actual.text).toBe(expected.text);
  expect(actual.text.trim().length).toBeGreaterThan(0);
});

it("defaults to plain chat output, honors options, and preserves escaped CSS HTML", async () => {
  const source = "flowchart LR; Input --> Output";
  expect((await renderGlyphDocs({ kind: "diagram", source })).text).toBe(
    (await renderGlyphDiagram(source, { target: "chat", color: "none" })).text,
  );
  const input: GlyphDocsRenderInput = {
    kind: "diagram",
    source: {
      direction: "LR",
      nodes: [{ id: "n", label: "<script> & order" }],
      edges: [],
    },
    options: { target: "web", color: "css", charset: "ascii", width: 44, height: 9, title: "Example" },
  };
  const result = await renderGlyphDocs(input);
  expect(result.html).toBe((await renderGlyphDiagram(input.source, input.options)).html);
  expect(result.html).toContain("&lt;script&gt;");
  expect(result.html).not.toContain("<script>");
  await expect(renderGlyphDocs({ kind: "diagram", source, options: { color: "truecolor" } })).rejects.toThrow(
    "none or css",
  );
});

const docs = resolve("src/content/docs/diagrams");
const pages = readdirSync(docs)
  .filter((name) => name.endsWith(".mdx"))
  .map((name) => {
    const content = readFileSync(resolve(docs, name), "utf8");
    const inputs = [
      ...content.matchAll(/kind="([^"]+)" source={(.*?)} options={(.*?)}(?: showSource={false})? \/>/g),
    ].map(
      (match) =>
        ({ kind: match[1], source: JSON.parse(match[2]!), options: JSON.parse(match[3]!) }) as GlyphDocsRenderInput,
    );
    return { name, content, inputs };
  });

it.each(pages)("validates metadata and renders every source in $name", async ({ content, inputs }) => {
  const description = content.match(/^description: (.*)$/m)?.[1];
  expect(description?.length).toBeGreaterThanOrEqual(120);
  expect(description?.length).toBeLessThanOrEqual(160);
  expect(content.match(/^title: .+$/m)).not.toBeNull();
  expect(content).not.toMatch(/```(?:text|ascii)/);
  expect(inputs.length).toBe((content.match(/<GlyphRender /g) ?? []).length);
  for (const input of inputs) {
    const result = await renderGlyphDocs(input);
    expect(result.text.trim(), JSON.stringify(input.source)).not.toBe("");
    if ("unroutable" in result.report) expect(result.report.unroutable, JSON.stringify(input.source)).toEqual([]);
    const container = await AstroContainer.create();
    const markup = parseMarkup(await container.renderToString(GlyphRender, { props: input }));
    const pre = markup.querySelector("pre.glyph-docs-output");
    expect(pre?.textContent).toBe(result.html ? parseMarkup(result.html).textContent : result.text);
    expect(markup.querySelector(".glyph-docs-source code")?.textContent).toBe(
      typeof input.source === "string" ? input.source : JSON.stringify(input.source, null, 2),
    );
  }
});

it.each(fixtures)("emits real $kind output inside a static pre through Astro", async (input) => {
  const container = await AstroContainer.create();
  for (const color of ["none", "css"] as const) {
    const props = { ...input, options: { ...input.options, color }, showSource: false } as GlyphDocsRenderInput & {
      showSource: boolean;
    };
    const html = await container.renderToString(GlyphRender, { props });
    const markup = parseMarkup(html);
    const expected = await renderGlyphDocs(props);
    const pre = markup.querySelector("pre.glyph-docs-output");
    expect(pre).not.toBeNull();
    expect(pre!.textContent).toBe(expected.html ? parseMarkup(expected.html).textContent : expected.text);
    expect(markup.querySelector(".glyph-docs-source")).toBeNull();
    expect(markup.querySelector("script")).toBeNull();
    expect(pre!.querySelector("pre")).toBeNull();
  }
});
