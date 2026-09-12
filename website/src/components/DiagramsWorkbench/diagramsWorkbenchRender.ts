import { renderGlyphDiagram, type GlyphDiagramResult } from "@glyphcss/diagrams";
import { buildGlyphDiagramsWorkbenchGraph, glyphDiagramsWorkbenchRenderOptions, type GlyphDiagramsWorkbenchState } from "./diagramsWorkbenchState";

export type GlyphDiagramsWorkbenchRender =
  | { ok: true; display: string; isHtml: boolean; text: string; ansi?: string; meta: GlyphDiagramResult["meta"] }
  | { ok: false; error: string; code?: string };

export async function renderGlyphDiagramsWorkbenchState(state: GlyphDiagramsWorkbenchState): Promise<GlyphDiagramsWorkbenchRender> {
  try {
    const result = await renderGlyphDiagram(buildGlyphDiagramsWorkbenchGraph(state), glyphDiagramsWorkbenchRenderOptions(state));
    const text = result.pages.map(({ grid }) => Array.from({ length: grid.rows }, (_, row) => grid.char.slice(row * grid.cols, (row + 1) * grid.cols).join("")).join("\n")).join("\n\n");
    const isHtml = result.html !== undefined;
    return { ok: true, text, display: result.html ?? text, isHtml, ansi: result.text.includes("\x1b[") ? result.text : undefined, meta: result.meta };
  } catch (error) {
    const failure = error as Error & { code?: string };
    return { ok: false, error: failure.code ? `${failure.code}: ${failure.message}` : failure.message, code: failure.code };
  }
}
