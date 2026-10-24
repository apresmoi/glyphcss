import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, expect, it, vi } from "vitest";
import { Window } from "happy-dom";
import { textDocsAsset } from "../../../scripts/generate-text-docs.mjs";
import { cleanMarkdown, readDocs } from "../../../scripts/metadata.mjs";
import { docsSidebar } from "../../config/docsSidebar.mjs";
import { socialDocsCards } from "../static-workbench/docsCards";

const introduction = readFileSync(resolve("src/content/docs/introduction.mdx"), "utf8");
const text = readFileSync(resolve("src/content/docs/guides/text.mdx"), "utf8");
const asset = JSON.parse(readFileSync(resolve("public/data/docs-text.json"), "utf8"));
const windows: Window[] = [];

afterEach(() => {
  windows.splice(0).forEach((window) => window.happyDOM.abort());
  vi.unstubAllGlobals();
});

it("runs the introduction's published JS and reproduces its real pre text", async () => {
  const window = new Window();
  windows.push(window);
  vi.stubGlobal("document", window.document);
  const require = createRequire(resolve("package.json"));
  const snippet = introduction.match(/```js\n([\s\S]*?)\n```/)![1]!;
  const executable = snippet.replace(
    /from "([^"]+)"/g,
    (_, specifier) => `from ${JSON.stringify(pathToFileURL(require.resolve(specifier)).href)}`,
  );
  await import(/* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(executable).toString("base64")}`);
  const pre = document.querySelector("pre.glyph-output")!;
  expect(pre).not.toBeNull();
  expect(pre.children).toHaveLength(0);
  const output = pre.textContent!;
  expect(output.trim()).not.toBe("");
  const lines = output.split("\n").map((line) => line.trimEnd());
  while (!lines[0]?.trim()) lines.shift();
  while (!lines.at(-1)?.trim()) lines.pop();
  const excerpt = introduction.match(/```html\n([\s\S]*?)\n```/)![1]!;
  expect(excerpt).toBe(`<pre class="glyph-output">\n${lines.join("\n")}\n</pre>`);
  expect(await cleanMarkdown(introduction)).toContain(excerpt);
});

it("ships the reproducible font mesh with valid indexed faces and real extrusion", async () => {
  expect(await textDocsAsset()).toEqual(asset);
  expect(asset.faces.length).toBeGreaterThan(0);
  for (const face of asset.faces) {
    expect(face.v.length).toBeGreaterThanOrEqual(3);
    expect(asset.colors[face.c]).toMatch(/^#[0-9a-f]{6}$/i);
    for (const index of face.v) {
      expect(asset.vertices[index]).toHaveLength(3);
      expect(asset.vertices[index].every(Number.isFinite)).toBe(true);
    }
  }
  const depths = asset.vertices.map((vertex: number[]) => vertex[0]!);
  expect(Math.max(...depths) - Math.min(...depths)).toBe(30);
});

it("discovers both pages, preserves their Markdown examples, and routes fonts to a unique OG card", async () => {
  const docs = readDocs();
  for (const slug of ["introduction", "guides/text"]) {
    const doc = docs.find((entry: { slug: string }) => entry.slug === slug)!;
    expect(doc).toBeDefined();
    const description = doc.source.match(/^description: (.+)$/m)![1]!;
    expect(description.length).toBeGreaterThanOrEqual(120);
    expect(description.length).toBeLessThanOrEqual(160);
    const markdown = await cleanMarkdown(doc.source);
    expect(markdown).not.toContain("<GlyphDemo");
    for (const snippet of doc.source.matchAll(/```\w+\n[\s\S]*?\n```/g)) expect(markdown).toContain(snippet[0]);
  }
  expect(docsSidebar.find((group) => group.label === "Guides")!.items).toContainEqual({
    label: "Text & Fonts",
    slug: "guides/text",
  });
  const { manifest } = await socialDocsCards([{ id: "guides/text", body: text, data: { title: "Text & Fonts" } }]);
  expect(manifest).toContainEqual(
    expect.objectContaining({ slug: "docs/guides/text", section: "Guides", url: "/guides/text/" }),
  );
});

it("links all ten published packages to existing docs", () => {
  const names = [
    "glyphcss",
    "@glyphcss/core",
    "@glyphcss/react",
    "@glyphcss/vue",
    "@glyphcss/compile",
    "@glyphcss/effects",
    "@glyphcss/charts",
    "@glyphcss/diagrams",
    "@glyphcss/maps",
    "@glyphcss/fonts",
  ];
  const slugs = new Set(readDocs().map((doc: { slug: string }) => doc.slug));
  for (const name of names) {
    const row = introduction.match(new RegExp(`\\[${name.replaceAll("/", "\\/")}\\]\\(/([^)]*)/\\)`));
    expect(row, name).not.toBeNull();
    expect(slugs.has(row![1]!)).toBe(true);
  }
});
