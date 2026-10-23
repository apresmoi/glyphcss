// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { transform } from "@astrojs/compiler";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { build } from "esbuild";
import { expect, it } from "vitest";
import postcss from "postcss";
import { homeDiagrams } from "../../features/home/diagrams";
import { fitGlyphDocsOutput, glyphDocsInkBounds, renderGlyphDocs } from "../../services/docs-render/glyphRender";
import { readCss } from "../../test/styles";

const require = createRequire(resolve("package.json"));
const external = (path: string) => ({ path: pathToFileURL(require.resolve(path)).href, external: true });
const pageBundle = await build({
  entryPoints: [resolve("src/pages/index.astro")],
  bundle: true,
  write: false,
  outfile: "/tmp/glyph-home-test.mjs",
  platform: "node",
  format: "esm",
  jsx: "automatic",
  tsconfigRaw: {},
  loader: { ".css": "empty" },
  define: { "import.meta.env.PROD": "false" },
  plugins: [{
    name: "landing-astro-ssr",
    setup(builder) {
      builder.onLoad({ filter: /\.astro$/ }, async ({ path }) => {
        const compiled = await transform(readFileSync(path, "utf8"), {
          filename: path,
          internalURL: "astro/compiler-runtime",
          resultScopedSlot: true,
          resolvePath: async (specifier) => specifier,
        });
        return { contents: compiled.code, loader: "ts" };
      });
      builder.onResolve({ filter: /^node:/ }, ({ path }) => ({ path, external: true }));
      builder.onResolve({ filter: /^[^./]/ }, async ({ path, pluginData }) => {
        if (pluginData?.resolved) return;
        const result = await builder.resolve(path, {
          kind: "import-statement",
          resolveDir: resolve("."),
          pluginData: { resolved: true },
        });
        return { path: pathToFileURL(result.path).href, external: true };
      });
    },
  }],
});
const rendererBundle = await build({
  stdin: { contents: 'export { default } from "@astrojs/react/server.js";', resolveDir: resolve(".") },
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  plugins: [{
    name: "landing-react-ssr",
    setup(builder) {
      builder.onResolve({ filter: /^astro:react:opts$/ }, () => ({ path: "opts", namespace: "react-opts" }));
      builder.onLoad({ filter: /.*/, namespace: "react-opts" }, () => ({ contents: "export default {};" }));
      builder.onResolve({ filter: /^(?:react(?:\/|$)|react-dom(?:\/|$)|@astrojs\/internal-helpers\/)/ }, ({ path }) => external(path));
    },
  }],
});
async function importBundle(code: string) {
  return import(/* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}
const HomeRoute = (await importBundle(pageBundle.outputFiles[0]!.text)).default;
const reactRenderer = (await importBundle(rendererBundle.outputFiles[0]!.text)).default;

it("serves real coloured diagram glyphs in landing HTML without hydration or JavaScript", async () => {
  const container = await AstroContainer.create();
  container.addServerRenderer({ name: "@astrojs/react", renderer: reactRenderer });
  container.addClientRenderer({ name: "@astrojs/react", entrypoint: "@astrojs/react/client.js" });
  const html = await container.renderToString(HomeRoute, { request: new Request("https://glyphcss.com/") });
  const page = document.createElement("template");
  page.innerHTML = html;
  const section = page.content.querySelector("#how-it-works")!;
  expect(section).not.toBeNull();
  expect(section.querySelectorAll("pre.glyph-docs-output")).toHaveLength(2);
  expect(section.querySelector("script, astro-island, details, [aria-hidden=true]")).toBeNull();
  expect(section.textContent).not.toMatch(/JS · runs once|CSS · plays forever|steps\(N\)/);
  for (const { layout, input } of homeDiagrams) {
    const result = await renderGlyphDocs(input);
    const pre = section.querySelector(`.home-diagram-${layout} pre.glyph-docs-output`)!;
    expect(pre.textContent).toBe(fitGlyphDocsOutput(result).text);
    expect(pre.querySelector('span[style*="color:"]')).not.toBeNull();
    expect(result.report.ledger).toEqual([]);
    if ("unroutable" in result.report) expect(result.report.unroutable).toEqual([]);
    const maxCols = layout === "narrow" ? 34 : 110;
    expect(glyphDocsInkBounds(result.text).cols).toBeLessThanOrEqual(maxCols);
    expect(result.text).toContain("Scene + camera");
    expect(result.text).toContain("same camera");
    expect(result.text).toContain("DOM hotspots");
  }
  expect(page.content.querySelector("#hero-demo")).not.toBeNull();
  expect(page.content.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe("https://glyphcss.com/");
  expect(JSON.parse(page.content.querySelector('script[type="application/ld+json"]')!.textContent!).name).toBe("glyphcss");
});

it("leaves landing sections unframed and switches diagram layouts without shrinking glyphs", () => {
  const sheet = postcss.parse(readCss(resolve("src/components/HomePage/HomePage.module.css")));
  const outer = ["hero", "hero--ascii", "install", "stacking", "getting-started", "term-footer", "term-footer-bar"];
  sheet.walkRules((rule) => {
    if (outer.some((name) => rule.selector === `.root .${name}`)) {
      rule.walkDecls((decl) => {
        expect(decl.prop).not.toMatch(/^(border|background)/);
      });
    }
  });
  const displayRules: string[] = [];
  sheet.walkRules((rule) => {
    if (!/^\.root \.home-diagram-(wide|narrow)$/.test(rule.selector)) return;
    rule.walkDecls("display", (decl) => displayRules.push(`${rule.selector}:${decl.value}:${rule.parent?.type === "atrule" ? rule.parent.params : "base"}`));
  });
  expect(displayRules).toEqual([
    ".root .home-diagram-wide:none:base",
    ".root .home-diagram-wide:block:(min-width: 960px)",
    ".root .home-diagram-narrow:none:(min-width: 960px)",
  ]);
});

it("renders the wordmark as extruded star glyphs beside a real heading, without JavaScript", async () => {
  const container = await AstroContainer.create();
  container.addServerRenderer({ name: "@astrojs/react", renderer: reactRenderer });
  container.addClientRenderer({ name: "@astrojs/react", entrypoint: "@astrojs/react/client.js" });
  const html = await container.renderToString(HomeRoute, { request: new Request("https://glyphcss.com/") });
  const page = document.createElement("template");
  page.innerHTML = html;
  expect(page.content.querySelector("h1")?.textContent).toBe("glyphcss");
  const art = page.content.querySelector(".hero-wordmark pre");
  expect(art?.closest("[aria-hidden='true']")).not.toBeNull();
  expect(art?.textContent).toMatch(/★/);
  expect(art?.innerHTML).toContain("#f97316");
  expect(art?.innerHTML).toContain("#38bdf8");
});
