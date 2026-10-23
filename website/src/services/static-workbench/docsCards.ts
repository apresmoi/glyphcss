import { docsSidebar } from "../../config/docsSidebar.mjs";
import { glyphDocsExamples } from "../docs-render/firstExample";
import { fitGlyphDocsOutput, renderGlyphDocs } from "../docs-render/glyphRender";

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
  const lines = entry.text.split("\n");
  const html = entry.html ?? entry.text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inked = lines.filter((line) => /[^ \u2800]/.test(line));
  const indent = Math.min(...inked.map((line) => [...line].findIndex((char) => char !== " " && char !== "\u2800")));
  const width = Math.max(...inked.map((line) => [...line.replace(/[ \u2800]+$/, "")].length));
  return { html, cols: Math.max(1, width - indent), rows: lines.length, indent: Number.isFinite(indent) ? indent : 0 };
}

// The fitted font size the card panel gives a grid; mirrors generate-og.mjs.
export const CARD_PANEL = { w: 548, h: 490, maxFont: 30 };
export function cardFont(grid: Pick<SocialGrid, "cols" | "rows">) {
  return Math.min(CARD_PANEL.maxFont, CARD_PANEL.w / (grid.cols * 0.6), CARD_PANEL.h / grid.rows);
}

// Inked area on the card in px²: favours examples that are both rich and large.
function cardScore(text: string, grid: SocialGrid) {
  return text.replace(/[\s\u2800]/g, "").length * cardFont(grid) ** 2;
}

type DocsEntry = { id: string; body?: string; data: { title: string } };

export async function socialDocsCards(entries: DocsEntry[]) {
  const manifest = [];
  const renders: Record<string, SocialGrid[]> = {};
  for (const { id, body = "", data } of entries) {
    const slug = `docs/${id || "index"}`;
    const section = docsSidebar.find((group) => group.items.some((item) => item.slug === id))?.label ?? "Help";
    let best: { grid: SocialGrid; score: number } | undefined;
    for (const input of await glyphDocsExamples(body)) {
      const output = fitGlyphDocsOutput(
        await renderGlyphDocs(input),
        "textScale" in (input.options ?? {}) ? (input.options as { textScale?: number }).textScale : 1,
      );
      const grid = socialGrid(output);
      const score = cardScore(output.text, grid);
      if (!best || score > best.score) best = { grid, score };
    }
    if (best) renders[slug] = [best.grid];
    manifest.push({
      slug,
      title: data.title,
      section,
      render: best ? slug : DOCS_SECTION_RENDERS[section]!,
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
