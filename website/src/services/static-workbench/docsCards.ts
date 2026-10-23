import { docsSidebar } from "../../config/docsSidebar.mjs";
import { glyphDocsExamples } from "../docs-render/firstExample";
import { fitGlyphDocsOutput, glyphDocsInkBounds, renderGlyphDocs } from "../docs-render/glyphRender";

export const DOCS_SECTION_RENDERS: Record<string, string> = {
  "Getting Started": "docs-start",
  Components: "docs-components",
  Guides: "docs-guides",
  "API Reference": "docs-api",
  Maps: "home",
  Diagrams: "diagrams",
  Charts: "charts",
  "Coding agents": "agents",
  Help: "docs-start",
};

// `indent` blank columns precede the art and `cols` covers the inked width, so
// the card crops the padding a render keeps for its chat or terminal width.
export type SocialGrid = { html: string; cols: number; rows: number; indent: number };

export function socialGrid(entry: { text: string; html?: string }): SocialGrid {
  const html = entry.html ?? entry.text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return { html, ...glyphDocsInkBounds(entry.text) };
}

// The fitted font size the card panel gives a grid; mirrors generate-og.mjs.
export const CARD_PANEL = { w: 548, h: 490, maxFont: 30 };
export function cardFont(grid: Pick<SocialGrid, "cols" | "rows">) {
  return Math.min(CARD_PANEL.maxFont, CARD_PANEL.w / (grid.cols * 0.6), CARD_PANEL.h / grid.rows);
}

type DocsEntry = { id: string; body?: string; data: { title: string } };

export async function socialDocsCards(entries: DocsEntry[]) {
  const manifest = [];
  const renders: Record<string, SocialGrid[]> = {};
  for (const { id, body = "", data } of entries) {
    const slug = `docs/${id || "index"}`;
    const section = docsSidebar.find((group) => group.items.some((item) => item.slug === id))?.label ?? "Help";
    // Each page opens with its showcase example, so that is the card.
    const [input] = await glyphDocsExamples(body);
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
