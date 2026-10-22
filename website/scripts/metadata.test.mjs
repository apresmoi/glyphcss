import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  unlinkSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { cleanMarkdown, readDocs, sitemapLastmod } from "./metadata.mjs";
import { checkPageImages } from "./check-page-images.mjs";
import { docsPages, PAGES, templateHtml } from "./generate-og.mjs";

test("Markdown twins remove MDX wrappers and imports, preserving fenced/inline code verbatim", () => {
  const code =
    '```tsx\nimport { GlyphMesh } from "@glyphcss/react";\n<GlyphMesh />\n```';
  const source = `---\ntitle: Hello\n---\nimport {\n Tabs, TabItem\n} from '@astrojs/starlight/components';\n<Tabs>\n<TabItem label="React">\nProse with \`<GlyphMesh>\` and \`import X\`.\n\n${code}\n</TabItem>\n</Tabs>\n`;
  const result = cleanMarkdown(source);
  assert.ok(result.includes(code));
  assert.ok(result.includes("Prose with `<GlyphMesh>` and `import X`."));
  assert.ok(
    !result.includes("<Tabs>") &&
      !result.includes("<TabItem") &&
      !result.includes("starlight/components"),
  );
  assert.equal(
    cleanMarkdown("~~~jsx\n<Widget />\n~~~\n<Widget />"),
    "~~~jsx\n<Widget />\n~~~\n",
  );
});

test("new docs sections and custom slugs are discovered without editing a catalog", () => {
  const root = mkdtempSync(path.join(tmpdir(), "glyphcss-docs-"));
  try {
    for (const section of ["diagrams", "charts"]) {
      mkdirSync(path.join(root, section));
      writeFileSync(
        path.join(root, section, "index.mdx"),
        `---\ntitle: "${section} guide"\n---\nExample`,
      );
    }
    writeFileSync(
      path.join(root, "custom.md"),
      "---\ntitle: Custom\nslug: diagrams/custom\n---\nProse",
    );
    const docs = readDocs(root);
    assert.deepEqual(
      docs.map((doc) => doc.slug),
      ["charts", "diagrams", "diagrams/custom"],
    );
    assert.equal(docs[0].title, "charts guide");
    assert.equal(docs[0].section, "charts");
    assert.equal(docs[1].section, "diagrams");
    const cards = docsPages(
      docs.map((doc) => ({
        ...doc,
        slug: `docs/${doc.slug}`,
        section: doc.slug.split("/")[0],
        render: "diagrams",
        url: `/${doc.slug}/`,
      })),
    );
    assert.equal(cards.length, 3);
    assert.equal(cards[2].tagline[0], "Custom");
  } finally {
    rmSync(root, { recursive: true });
  }
});

test("all source docs preserve every code fence in cleaned output", () => {
  for (const doc of readDocs()) {
    const fences = doc.source.match(/^```[^\n]*\n[\s\S]*?^```/gm) ?? [];
    const cleaned = cleanMarkdown(doc.source);
    for (const code of fences)
      assert.ok(cleaned.includes(code), `${doc.slug}: changed code fence`);
  }
  assert.ok(
    !Number.isNaN(
      Date.parse(sitemapLastmod("https://glyphcss.com/introduction/")),
    ),
  );
});

test("OG checker rejects deleted files, shared cards and missing metadata (mutation check)", () => {
  const dist = mkdtempSync(path.join(tmpdir(), "glyphcss-og-"));
  try {
    mkdirSync(path.join(dist, "og"));
    for (const route of ["diagrams", "charts"]) {
      mkdirSync(path.join(dist, route));
      writeFileSync(path.join(dist, "og", `${route}.png`), "fixture");
      writeFileSync(
        path.join(dist, route, "index.html"),
        `<head><meta property="og:image" content="https://glyphcss.com/og/${route}.png"><meta name="twitter:image" content="https://glyphcss.com/og/${route}.png"></head>`,
      );
    }
    assert.deepEqual(checkPageImages(dist), { count: 2, errors: [] });
    unlinkSync(path.join(dist, "og/charts.png"));
    assert.match(checkPageImages(dist).errors.join("\n"), /missing OG image/);
    writeFileSync(path.join(dist, "og/charts.png"), "fixture");
    assert.match(
      checkPageImages(dist, (document) => {
        for (const meta of document.querySelectorAll("meta"))
          meta.setAttribute("content", "https://glyphcss.com/og/charts.png");
      }).errors.join("\n"),
      /shares OG image/,
    );
    assert.match(
      checkPageImages(
        dist,
        (document) => (document.head.innerHTML = ""),
      ).errors.join("\n"),
      /expected one/,
    );
  } finally {
    rmSync(dist, { recursive: true });
  }
});

test("cards compose real render HTML at 1200×630 and have distinct output paths", () => {
  const html = templateHtml(
    PAGES.find((page) => page.slug === "diagrams"),
    [{ html: '<span style="color:red">┌─┐</span>', cols: 3, rows: 1 }],
  );
  assert.ok(html.includes('<span style="color:red">┌─┐</span>'));
  assert.ok(html.includes("1200px") && html.includes("630px"));
  assert.equal(
    new Set(PAGES.map((page) => page.output ?? `${page.slug}.png`)).size,
    PAGES.length,
  );
  assert.equal(PAGES.find((page) => page.slug === "home").render, "home");
  assert.equal(PAGES.find((page) => page.slug === "charts").render, "charts");
  assert.ok(
    readFileSync(
      new URL("../src/pages/og-manifest.json.ts", import.meta.url),
      "utf8",
    ).includes('getCollection("docs")'),
  );
});
