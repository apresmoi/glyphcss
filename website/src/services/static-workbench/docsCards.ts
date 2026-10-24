import { docsSidebar } from "../../config/docsSidebar.mjs";
import { glyphDocsExamples } from "../docs-render/firstExample";
import {
  fitGlyphDocsOutput,
  glyphDocsInkBounds,
  renderGlyphDocs,
  type GlyphDocsRenderInput,
} from "../docs-render/glyphRender";

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
export type SocialGrid = {
  html: string;
  cols: number;
  rows: number;
  indent: number;
};

export function socialGrid(entry: { text: string; html?: string }): SocialGrid {
  const html = entry.html ?? entry.text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return { html, ...glyphDocsInkBounds(entry.text) };
}

// Card geometry; mirrors generate-og.mjs. A lone render that reads larger
// across the full width (wide, short diagrams) moves under the title.
export const CARD_PANEL = { w: 548, h: 490, maxFont: 30 };
export const CARD_WIDE_PANEL = { w: 1056, h: 360 };
const fit = (grid: Pick<SocialGrid, "cols" | "rows">, panel: { w: number; h: number }) =>
  Math.min(CARD_PANEL.maxFont, panel.w / (grid.cols * 0.6), panel.h / grid.rows);
export function cardLayout(grid: Pick<SocialGrid, "cols" | "rows">) {
  const side = fit(grid, CARD_PANEL);
  const wide = fit(grid, CARD_WIDE_PANEL);
  const [layout, font, panel] =
    wide > side * 1.2 ? (["wide", wide, CARD_WIDE_PANEL] as const) : (["side", side, CARD_PANEL] as const);
  return {
    layout,
    font,
    fill: (grid.cols * 0.6 * font * grid.rows * font) / (panel.w * panel.h),
  };
}
export function cardFont(grid: Pick<SocialGrid, "cols" | "rows">) {
  return cardLayout(grid).font;
}

const CARD_DIAGRAM = {
  target: "web",
  charset: "box",
  overflow: "expand",
  nodeColor: "#69e0db",
  edgeColor: "#ffd166",
};

// Pages whose first example is too small to carry a card get a richer render
// of the same subject.
export const DOCS_CARD_OVERRIDES: Record<string, GlyphDocsRenderInput> = {
  "diagrams/shapes": {
    kind: "diagram",
    source: {
      direction: "LR",
      nodes: [
        { id: "a", label: "stadium", shape: "stadium" },
        { id: "b", label: "diamond", shape: "diamond" },
        { id: "c", label: "cylinder", shape: "cylinder" },
        { id: "d", label: "cloud", shape: "cloud" },
        { id: "e", label: "hexagon", shape: "hexagon" },
        { id: "f", label: "circle", shape: "circle" },
        { id: "g", label: "subroutine", shape: "subroutine" },
        { id: "h", label: "bang", shape: "bang" },
      ],
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
        { from: "c", to: "d" },
        { from: "e", to: "f" },
        { from: "f", to: "g" },
        { from: "g", to: "h" },
      ],
    },
    options: { ...CARD_DIAGRAM, width: 72, height: 30 },
  } as GlyphDocsRenderInput,
  "coding-agents/install": {
    kind: "diagram",
    source:
      "flowchart LR; Add[npx skills add] --> Claude[Claude Code]; Add --> Codex; Add --> Copilot; Add --> Other[Pi, Droid, ...]; Claude --> Skill[glyphcss-diagrams]; Codex --> Skill; Copilot --> Skill; Other --> Skill; Skill --> Chat[Diagram in chat]",
    options: { ...CARD_DIAGRAM, width: 72, height: 30 },
  } as GlyphDocsRenderInput,
  "guides/coding-agents": {
    kind: "sequence",
    source:
      "sequenceDiagram\n participant You\n participant Agent\n participant CLI as glyphcss CLI\n You->>Agent: draw the deploy flow\n Agent->>CLI: Mermaid or JSON\n CLI-->>Agent: aligned text\n Agent-->>You: diagram in chat",
    options: { ...CARD_DIAGRAM, width: 64, height: 24 },
  } as GlyphDocsRenderInput,
};

type DocsEntry = { id: string; body?: string; data: { title: string } };

export async function socialDocsCards(entries: DocsEntry[]) {
  const manifest = [];
  const renders: Record<string, SocialGrid[]> = {};
  for (const { id, body = "", data } of entries) {
    const slug = `docs/${id || "index"}`;
    const section = docsSidebar.find((group) => group.items.some((item) => item.slug === id))?.label ?? "Help";
    // Each page opens with its showcase example, so that is the card.
    const input = DOCS_CARD_OVERRIDES[id] ?? (await glyphDocsExamples(body))[0];
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
  return {
    manifest: manifest.sort((a, b) => a.slug.localeCompare(b.slug)),
    renders,
  };
}
