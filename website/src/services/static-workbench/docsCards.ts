import { docsSidebar } from "../../config/docsSidebar.mjs";
import { firstGlyphDocsExample } from "../docs-render/firstExample";
import { fitGlyphDocsOutput, renderGlyphDocs } from "../docs-render/glyphRender";

export const DOCS_SECTION_RENDERS: Record<string, string> = {
  "Getting Started": "docs-start",
  Components: "docs-components",
  Guides: "docs-guides",
  "API Reference": "docs-api",
  Maps: "home",
  Diagrams: "diagrams",
  Charts: "charts",
  "Coding agents": "diagrams",
  Help: "docs-start",
};

export type SocialGrid = { html: string; cols: number; rows: number };

export function socialGrid(entry: { text: string; html?: string }): SocialGrid {
  const lines = entry.text.split("\n");
  const html = entry.html ?? entry.text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return { html, cols: Math.max(...lines.map((line) => [...line].length)), rows: lines.length };
}

type DocsEntry = { id: string; body?: string; data: { title: string } };

export async function socialDocsCards(entries: DocsEntry[]) {
  const manifest = [];
  const renders: Record<string, SocialGrid[]> = {};
  for (const { id, body = "", data } of entries) {
    const slug = `docs/${id || "index"}`;
    const section = docsSidebar.find((group) => group.items.some((item) => item.slug === id))?.label ?? "Help";
    const input = await firstGlyphDocsExample(body);
    if (input) {
      const output = fitGlyphDocsOutput(
        await renderGlyphDocs(input),
        "textScale" in (input.options ?? {}) ? (input.options as { textScale?: number }).textScale : 1,
      );
      renders[slug] = [socialGrid(output)];
    }
    manifest.push({
      slug,
      title: data.title,
      section,
      render: input ? slug : DOCS_SECTION_RENDERS[section]!,
      url: `/${id}/`,
    });
  }
  if (!manifest.some((doc) => doc.slug === "docs/404")) {
    manifest.push({
      slug: "docs/404",
      title: "Page not found",
      section: "Help",
      render: DOCS_SECTION_RENDERS.Help!,
      url: "/404/",
    });
  }
  return { manifest: manifest.sort((a, b) => a.slug.localeCompare(b.slug)), renders };
}
