import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { build } from "esbuild";
import { transform } from "@astrojs/compiler";
import { experimental_AstroContainer } from "astro/container";
import { Window } from "happy-dom";
import { websiteRoot } from "./metadata.mjs";

async function renderLayout(removeHead) {
  const dir = await mkdtemp(path.join(tmpdir(), "glyphcss-head-"));
  try {
    const outfile = path.join(dir, "layout.mjs");
    const runtime = import.meta.resolve("astro/runtime/server/index.js");
    const output = await build({
      entryPoints: [
        path.join(websiteRoot, "src/layouts/WorkbenchLayout.astro"),
      ],
      bundle: true,
      format: "esm",
      platform: "node",
      write: false,
      define: { "import.meta.env.PROD": "false" },
      plugins: [
        {
          name: "astro-layout",
          setup(api) {
            api.onResolve({ filter: /^astro\/runtime\// }, () => ({
              path: runtime,
              external: true,
            }));
            api.onResolve({ filter: /components\/SiteHeader$/ }, () => ({
              path: "header",
              namespace: "header",
            }));
            // The header's UI is unrelated to head-slot propagation through these real layouts.
            api.onLoad({ filter: /.*/, namespace: "header" }, () => ({
              contents: `import {createComponent,render} from "astro/runtime/server/index.js"; export const SiteHeader = createComponent(() => render\`\`);`,
            }));
            api.onLoad({ filter: /\.css$/ }, () => ({
              contents: "",
              loader: "js",
            }));
            api.onLoad({ filter: /\.astro$/ }, async ({ path: file }) => {
              let source = await readFile(file, "utf8");
              if (removeHead && file.endsWith("WorkbenchLayout.astro"))
                source = source.replace(
                  /<slot\s+name="head"\s+slot="head"\s*\/>/,
                  "",
                );
              const result = await transform(source, {
                filename: file,
                resultScopedSlot: true,
                resolvePath: (specifier) => specifier,
              });
              return {
                contents: result.code,
                loader: "ts",
                resolveDir: path.dirname(file),
              };
            });
          },
        },
      ],
    });
    await writeFile(outfile, output.outputFiles[0].text);
    const { default: Layout } = await import(pathToFileURL(outfile).href);
    const container = await experimental_AstroContainer.create();
    return await container.renderToString(Layout, {
      props: {
        title: "Diagrams",
        description: "Mermaid diagrams as text",
        path: "/diagrams/",
      },
      slots: {
        default: "<p>Workbench</p>",
        head: '<script type="application/ld+json">{"@type":"SoftwareApplication"}</script>',
      },
      request: new Request("https://glyphcss.com/diagrams/"),
      partial: false,
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function hasJsonLd(html) {
  const window = new Window();
  try {
    window.document.write(html);
    return !!window.document.head.querySelector(
      'script[type="application/ld+json"]',
    );
  } finally {
    window.happyDOM.abort();
  }
}

test("workbench metadata reaches the document head; dropping the forwarding slot goes red", async () => {
  assert.equal(hasJsonLd(await renderLayout(false)), true);
  assert.equal(hasJsonLd(await renderLayout(true)), false);
});
