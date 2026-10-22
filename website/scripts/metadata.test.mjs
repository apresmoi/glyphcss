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
import { docsPages, PAGES, socialPng, templateHtml } from "./generate-og.mjs";
import { randomBytes } from "node:crypto";
import sharp from "sharp";

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

test("OG checker excludes noindex static redirects while requiring metadata on ordinary pages", () => {
  const dist = mkdtempSync(path.join(tmpdir(), "glyphcss-og-redirect-"));
  try {
    const file = path.join(dist, "index.html");
    writeFileSync(
      file,
      '<meta http-equiv="refresh" content="0;url=/diagrams/overview/">' +
        '<meta name="robots" content="noindex"><link rel="canonical" href="https://glyphcss.com/diagrams/overview/">',
    );
    assert.deepEqual(checkPageImages(dist), { count: 0, errors: [] });
    for (const selector of [
      'meta[http-equiv="refresh"]',
      'meta[name="robots"]',
      'link[rel="canonical"]',
    ]) {
      const result = checkPageImages(dist, (document) =>
        document.querySelector(selector).remove(),
      );
      assert.match(
        result.errors.join("\n"),
        /expected one og:image and one twitter:image/,
      );
    }
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

test("docs subtitles preserve exact sidebar group labels", () => {
  for (const section of ["API Reference", "Getting Started", "Coding agents"]) {
    assert.equal(
      docsPages([{ title: "Example", section, url: "/example/" }])[0].sub,
      `${section} · glyphcss documentation`,
    );
  }
});

test("PNG compression produces cards below 150 KB and rejects oversized output", async () => {
  const small = await sharp({
    create: { width: 1200, height: 630, channels: 3, background: "#0d0f12" },
  })
    .png()
    .toBuffer();
  const png = await socialPng(small, "small");
  assert.ok(png.length < 150 * 1024);
  const metadata = await sharp(png).metadata();
  assert.equal(metadata.width, 1200);
  assert.equal(metadata.height, 630);
  const noise = await sharp(randomBytes(1200 * 630 * 3), {
    raw: { width: 1200, height: 630, channels: 3 },
  })
    .png()
    .toBuffer();
  await assert.rejects(
    socialPng(noise, "oversized"),
    /oversized: PNG exceeds 150 KB/,
  );
});
