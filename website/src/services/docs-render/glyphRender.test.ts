// @vitest-environment happy-dom
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { transform } from "@astrojs/compiler";
import { build } from "esbuild";
import { expect, it } from "vitest";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import postcss from "postcss";
import { readCss } from "../../test/styles";

import { renderGlyphDiagram } from "@glyphcss/diagrams";
import { renderGlyphSequence } from "@glyphcss/diagrams/sequence";
import { renderGlyphLaneDag } from "@glyphcss/diagrams/lanes";
import { renderGlyphChart, renderGlyphChartMermaid } from "@glyphcss/charts";
import { renderGlyphChart3d, glyphChartSurface } from "@glyphcss/charts/3d";
import {
  fitGlyphDocsOutput,
  normalizeGlyphDocsSource,
  renderGlyphDocs,
  type GlyphDocsRenderInput,
} from "./glyphRender";

// Compile the real Astro adapter without loading the site's routing integrations
// into Vitest. CSS is checked separately by the website's style audit.
const require = createRequire(resolve("package.json"));
const filename = resolve("src/integrations/astro/GlyphRender.astro");
const compiled = await transform(readFileSync(filename, "utf8"), {
  filename,
  internalURL: "astro/compiler-runtime",
  resultScopedSlot: true,
  resolvePath: async (path) => path,
});
const bundled = await build({
  stdin: { contents: compiled.code, loader: "ts", resolveDir: resolve("src/integrations/astro") },
  bundle: true,
  write: false,
  outfile: "/tmp/glyph-docs-render-test.mjs",
  platform: "node",
  format: "esm",
  jsx: "automatic",
  loader: { ".css": "empty" },
  plugins: [
    {
      name: "astro-test-imports",
      setup(builder) {
        builder.onResolve({ filter: /^astro\/compiler-runtime$/ }, (args) => ({
          path: pathToFileURL(require.resolve(args.path)).href,
          external: true,
        }));
        builder.onResolve({ filter: /^(?:@glyphcss\/|glyphcss$|react(?:\/|$)|react-dom(?:\/|$))/ }, (args) => ({
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

const reactRendererBundle = await build({
  stdin: { contents: 'export { default } from "@astrojs/react/server.js";', resolveDir: resolve(".") },
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  plugins: [{
    name: "astro-react-renderer",
    setup(builder) {
      builder.onResolve({ filter: /^astro:react:opts$/ }, () => ({ path: "opts", namespace: "react-opts" }));
      builder.onLoad({ filter: /.*/, namespace: "react-opts" }, () => ({ contents: "export default {};" }));
      builder.onResolve({ filter: /^(?:react(?:\/|$)|react-dom(?:\/|$)|@astrojs\/internal-helpers\/)/ }, (args) => ({
        path: pathToFileURL(require.resolve(args.path)).href,
        external: true,
      }));
    },
  }],
});
const rendererUrl = `data:text/javascript;base64,${Buffer.from(reactRendererBundle.outputFiles[0]!.text).toString("base64")}`;
const reactRenderer = (await import(/* @vite-ignore */ rendererUrl)).default;

async function createDocsContainer() {
  const container = await AstroContainer.create();
  container.addServerRenderer({ name: "@astrojs/react", renderer: reactRenderer });
  container.addClientRenderer({ name: "@astrojs/react", entrypoint: "@astrojs/react/client.js" });
  return container;
}

function parseMarkup(html: string) {
  const template = document.createElement("template");
  template.innerHTML = html;
  return template.content;
}

it("uses the workbench's Glyph Mono cell metrics for every target and inherits them into color spans", () => {
  const sheet = postcss.parse(readCss(resolve("src/integrations/astro/GlyphRender.module.css")));
  const output: Record<string, string> = {};
  const spans: Record<string, string> = {};
  sheet.walkRules((rule) => {
    if (rule.selector === ".root .glyph-docs-output") {
      rule.walkDecls((decl) => {
        output[decl.prop] = decl.value;
      });
    }
    if (rule.selector === ".root .glyph-docs-output span") {
      rule.walkDecls((decl) => {
        spans[decl.prop] = decl.value;
      });
    }
    expect(rule.selector).not.toContain("data-target");
  });
  expect(output).toMatchObject({
    "font-family": '"Glyph Mono", ui-monospace, "JetBrains Mono", "SF Mono", Menlo, monospace',
    "font-size": "13px",
    "line-height": "1",
    "letter-spacing": "normal",
    "white-space": "pre",
  });
  expect(spans).toMatchObject({ font: "inherit", "letter-spacing": "inherit" });
});

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
  {
    kind: "chart-3d",
    source: {
      type: "surface",
      args: [
        {
          z: [
            [0, 1],
            [1, 2],
          ],
        },
      ],
    },
    options,
  },
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
    case "chart-3d":
      expected = renderGlyphChart3d(
        glyphChartSurface(...(input.source as { type: "surface"; args: Parameters<typeof glyphChartSurface> }).args),
        input.options,
      );
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

it("defaults to CSS color with identical plain text, honors options, and preserves escaped HTML", async () => {
  const source = "flowchart LR; Input --> Output";
  const resultDefault = await renderGlyphDocs({ kind: "diagram", source });
  const expectedDefault = await renderGlyphDiagram(source, { target: "chat", color: "css" });
  expect(resultDefault.html).toBe(expectedDefault.html);
  expect(resultDefault.html).toContain('<span style="color:');
  expect(parseMarkup(resultDefault.html!).textContent).toBe(resultDefault.text);
  expect(resultDefault.text).toBe((await renderGlyphDiagram(source, { target: "chat", color: "none" })).text);
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

it.each([
  [
    "\n\n    sequenceDiagram\n      participant Browser\n      Browser->>API: Request\n  \n",
    "sequenceDiagram\n  participant Browser\n  Browser->>API: Request",
  ],
  ["\r\n\tflowchart LR\r\n\t\tA --> B\r\n", "flowchart LR\n\tA --> B"],
  ["\n  \n", ""],
  ["sequenceDiagram\n  participant Browser", "sequenceDiagram\n  participant Browser"],
])("dedents source without removing intentional nesting", (source, expected) => {
  expect(normalizeGlyphDocsSource(source)).toBe(expected);
});

it("renders dedented source in a closed disclosure without template whitespace", async () => {
  const source =
    "\n    sequenceDiagram\n      participant Browser\n      participant API\n      Browser->>API: Request\n    ";
  const expected = "sequenceDiagram\n  participant Browser\n  participant API\n  Browser->>API: Request";
  const container = await createDocsContainer();
  const markup = parseMarkup(await container.renderToString(GlyphRender, { props: { kind: "sequence", source } }));
  const pre = markup.querySelector("pre.glyph-docs-source")!;
  expect(pre.textContent).toBe(expected);
  expect(pre.closest("details")?.hasAttribute("open")).toBe(false);
  expect(pre.closest("details")?.querySelector("summary")?.textContent).toBe("Source");
  const output = markup.querySelector("figure pre.glyph-docs-output")!;
  expect(markup.querySelector("figure")?.firstElementChild?.contains(output)).toBe(true);
  expect(output.parentElement?.getAttribute("style")).toMatch(/--ink-cols:\d+;--ink-indent:\d+/);
  expect(markup.querySelector("figcaption")).toBeNull();
  const result = await renderGlyphDocs({ kind: "sequence", source });
  expect(result.text).toBe((await renderGlyphSequence(expected, { target: "chat", color: "none" })).text);
  expect(markup.querySelector("pre.glyph-docs-output")?.textContent).toBe(fitGlyphDocsOutput(result).text);
});

it.each(fixtures)("keeps $kind CSS output byte-identical to plain text", async (input) => {
  const plain = await renderGlyphDocs({
    ...input,
    options: { ...input.options, color: "none" },
  } as GlyphDocsRenderInput);
  const colored = await renderGlyphDocs({
    ...input,
    options: { ...input.options, color: "css" },
  } as GlyphDocsRenderInput);
  expect(colored.html).toBeDefined();
  expect(parseMarkup(colored.html!).textContent).toBe(plain.text);
});

const pages = [
  ...["diagrams", "charts"].flatMap((section) =>
    readdirSync(resolve(`src/content/docs/${section}`))
      .filter((name) => name.endsWith(".mdx"))
      .map((name) => `${section}/${name}`),
  ),
  "guides/coding-agents.mdx",
  "coding-agents/install.mdx",
].map((name) => {
  const content = readFileSync(resolve("src/content/docs", name), "utf8");
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
    const container = await createDocsContainer();
    const markup = parseMarkup(await container.renderToString(GlyphRender, { props: input }));
    const pre = markup.querySelector("pre.glyph-docs-output");
    const fitted = input.kind === "chart-3d" ? result : fitGlyphDocsOutput(result);
    expect(pre?.textContent).toBe(fitted.html ? parseMarkup(fitted.html).textContent : fitted.text);
    expect(markup.querySelector("pre.glyph-docs-source")?.textContent).toBe(
      typeof input.source === "string" ? normalizeGlyphDocsSource(input.source) : JSON.stringify(input.source, null, 2),
    );
  }
});

it.each(fixtures)("emits real $kind output inside a static pre through Astro", async (input) => {
  const container = await createDocsContainer();
  for (const color of ["none", "css"] as const) {
    const props = { ...input, options: { ...input.options, color }, showSource: false } as GlyphDocsRenderInput & {
      showSource: boolean;
    };
    const html = await container.renderToString(GlyphRender, { props });
    const markup = parseMarkup(html);
    const expected = await renderGlyphDocs(props);
    const pre = markup.querySelector("pre.glyph-docs-output");
    expect(pre).not.toBeNull();
    // 3D frames keep their full grid so dragging never changes the footprint.
    const fitted = input.kind === "chart-3d" ? expected : fitGlyphDocsOutput(expected);
    expect(pre!.textContent).toBe(fitted.html ? parseMarkup(fitted.html).textContent : fitted.text);
    expect(markup.querySelector(".glyph-docs-source")).toBeNull();
    const island = markup.querySelector("astro-island");
    if (input.kind === "chart-3d") {
      expect(island?.getAttribute("client")).toBe("visible");
      expect(island?.getAttribute("component-export")).toBe("GlyphChart3dPreview");
      // The server-rendered island IS the no-JS frame.
      expect(island?.contains(pre)).toBe(true);
      expect(island?.querySelectorAll("pre.glyph-docs-output")).toHaveLength(1);
    } else {
      expect(island).toBeNull();
      expect(markup.querySelector("script")).toBeNull();
    }
    expect(pre!.querySelector("pre")).toBeNull();
  }
});

it("fits documentation boxes to ink without removing interior rows, background ink, or scaled text space", () => {
  const result = {
    text: "    \n A  \n    \n B  \n    ",
    html: '    \n <span style="color:#00ff00">A</span>  \n    \n B  \n    ',
  };
  const fitted = fitGlyphDocsOutput(result);
  expect(fitted.text).toBe(" A  \n    \n B  ");
  expect(parseMarkup(fitted.html!).textContent).toBe(fitted.text);
  expect(fitGlyphDocsOutput(result, 2)).toBe(result);
  const background = { text: "  \n A", html: '<span style="background:#ff0000">  </span>\n A' };
  expect(fitGlyphDocsOutput(background)).toEqual(background);
  expect(fitGlyphDocsOutput({ text: "\u2800\nA\n " }).text).toBe("A");
});

it("covers all native marks, Mermaid chart families, and headless 3D constructors in the Charts section", () => {
  const inputs = pages.filter((page) => page.name.startsWith("charts/")).flatMap((page) => page.inputs);
  const native = inputs
    .filter((input) => input.kind === "chart")
    .flatMap((input) => {
      const source = input.source;
      if (!source || Array.isArray(source)) return [];
      return "marks" in source ? source.marks.map((mark) => mark.type) : "type" in source ? [source.type] : [];
    });
  expect([...new Set(native)].sort()).toEqual([
    "arc",
    "area",
    "bar",
    "cell",
    "dot",
    "funnel",
    "line",
    "rule",
    "sankey",
    "text",
    "treemap",
  ]);
  const mermaid = inputs
    .filter((input) => input.kind === "chart-mermaid")
    .map((input) => input.source.split(/[\s\n]/)[0]!.replace(/-beta$/, ""));
  expect([...new Set(mermaid)].sort()).toEqual([
    "gantt",
    "journey",
    "kanban",
    "packet",
    "pie",
    "quadrantChart",
    "radar",
    "sankey",
    "timeline",
    "treemap",
    "xychart",
  ]);
  const threeD = inputs.filter((input) => input.kind === "chart-3d").map((input) => input.source.type);
  expect(threeD.sort()).toEqual(["bars", "line", "parametric", "scatter", "surface"]);
});
