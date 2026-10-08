import { renderGlyphDiagram, type GlyphDiagramRenderOptions, type GlyphDiagramResult } from "@glyphcss/diagrams";
import { renderGlyphLaneDag, type GlyphLaneRenderOptions, type GlyphLaneResult } from "@glyphcss/diagrams/lanes";
import {
  renderGlyphSequence,
  type GlyphSequenceRenderOptions,
  type GlyphSequenceResult,
} from "@glyphcss/diagrams/sequence";
import {
  buildGlyphDiagramsWorkbenchGraph,
  buildGlyphDiagramsWorkbenchLanes,
  buildGlyphDiagramsWorkbenchSequence,
  glyphDiagramsWorkbenchChatCharset,
  glyphDiagramsWorkbenchLanesRenderOptions,
  glyphDiagramsWorkbenchRenderOptions,
  glyphDiagramsWorkbenchSequenceRenderOptions,
  type GlyphDiagramsWorkbenchState,
  type GlyphPixelBox,
} from "../model/diagramsWorkbenchState";
export type { GlyphPixelBox } from "../model/diagramsWorkbenchState";

// Reused for BOTH pipelines (graph and sequence): the same ok/error union,
// the same `display`/`isHtml`/`text`/`ansi`/`meta` shape, so the viewport,
// Copy ASCII/ANSI and the rail's error banner (`DiagramsWorkbench.tsx`) need
// no per-form branch beyond which render function produced the value —
// `GlyphDiagramResult["meta"]` and `GlyphSequenceMeta` both carry a
// `description` string, the one field this type actually reads off `meta`.
export type GlyphDiagramsWorkbenchRender =
  | {
      ok: true;
      display: string;
      isHtml: boolean;
      text: string;
      ansi?: string;
      meta: { readonly description: string };
      /** Mirrors `chartsWorkbenchRender.ts`'s own field — see its doc
       *  (CHARTS-RESEARCH `DIAGNOSIS-target-matrix.md` C4). */
      charsetDowngraded?: true;
      /** Graph pipeline only — every node's own box and every straight run
       *  of every edge's route, in CELLS of the joined `text` (rows past the
       *  first panel are offset by that panel's rows plus the blank line
       *  `canvasPagesToText` puts between panels), plus the grid the cells
       *  index. These are the ANCHORS of the page's hotspot layer
       *  (`DiagramsHotspotLayer.tsx`): one real element per box, so a
       *  rendered node or edge is clickable back to its source field and
       *  stylable. The sequence/lanes results expose no per-item placement,
       *  so they carry none. */
      hotspots?: readonly GlyphDiagramsWorkbenchHotspot[];
      grid?: { readonly cols: number; readonly rows: number };
    }
  | { ok: false; error: string; code?: string };
export type GlyphDiagramsWorkbenchHotspot =
  | {
      readonly kind: "node";
      readonly id: string;
      readonly x0: number;
      readonly y0: number;
      readonly x1: number;
      readonly y1: number;
    }
  | {
      readonly kind: "edge";
      readonly from: string;
      readonly to: string;
      readonly x0: number;
      readonly y0: number;
      readonly x1: number;
      readonly y1: number;
    };

/** The node and edge hotspots of every panel, in the joined text's own row space; an edge contributes one box per straight run of its route. */
export function glyphDiagramsWorkbenchHotspots(pages: GlyphDiagramResult["pages"]): {
  hotspots: GlyphDiagramsWorkbenchHotspot[];
  grid: { cols: number; rows: number };
} {
  const hotspots: GlyphDiagramsWorkbenchHotspot[] = [];
  let offset = 0;
  let cols = 0;
  for (const page of pages) {
    for (const node of page.layout.nodes)
      hotspots.push({
        kind: "node",
        id: node.id,
        x0: node.x0,
        y0: node.y0 + offset,
        x1: node.x1,
        y1: node.y1 + offset,
      });
    for (const route of page.routes) {
      const { from, to } = route.edge;
      // Maximal horizontal/vertical runs — a bend starts a new box.
      let run: { x0: number; y0: number; x1: number; y1: number } | null = null;
      for (const cell of route.cells) {
        if (run && ((cell.y === run.y0 && run.y0 === run.y1) || (cell.x === run.x0 && run.x0 === run.x1))) {
          run = {
            x0: Math.min(run.x0, cell.x),
            y0: Math.min(run.y0, cell.y),
            x1: Math.max(run.x1, cell.x),
            y1: Math.max(run.y1, cell.y),
          };
          continue;
        }
        if (run)
          hotspots.push({ kind: "edge", from, to, x0: run.x0, y0: run.y0 + offset, x1: run.x1, y1: run.y1 + offset });
        run = { x0: cell.x, y0: cell.y, x1: cell.x, y1: cell.y };
      }
      if (run)
        hotspots.push({ kind: "edge", from, to, x0: run.x0, y0: run.y0 + offset, x1: run.x1, y1: run.y1 + offset });
    }
    cols = Math.max(cols, page.canvas.grid.cols);
    offset += page.canvas.grid.rows + 1;
  }
  return { hotspots, grid: { cols, rows: Math.max(0, offset - 1) } };
}

// See `chartsWorkbenchRender.ts`'s `chatCharsetDowngrade` — identical rule,
// mirrored here rather than shared because the two packages' render-option
// types are structurally distinct (`GlyphDiagramRenderOptions` vs
// `GlyphChartRenderOptions`) with no common module both already import.
// The rule itself lives in `diagramsWorkbenchState.ts`
// (`glyphDiagramsWorkbenchChatCharset`) so the export snippet prints the
// SAME options the render actually used — this file only names it per
// pipeline option type.
const chatCharsetDowngrade = (options: GlyphDiagramRenderOptions): GlyphDiagramRenderOptions =>
  glyphDiagramsWorkbenchChatCharset(options);
const chatCharsetDowngradeSequence = (options: GlyphSequenceRenderOptions): GlyphSequenceRenderOptions =>
  glyphDiagramsWorkbenchChatCharset(options);
const chatCharsetDowngradeLanes = (options: GlyphLaneRenderOptions): GlyphLaneRenderOptions =>
  glyphDiagramsWorkbenchChatCharset(options);

/** Shared by both pipelines' 2D render functions below — every panel's own
 *  canvas grid, joined the same way `GlyphSequenceResult.text`/
 *  `GlyphDiagramResult`'s own multi-page `text` already are (a blank line
 *  between panels), read straight off `canvas.grid` rather than `result.text`
 *  because `result.text` bakes in ANSI escapes whenever `color` isn't
 *  `"none"`/`"css"` (`paint.ts`'s own `encodeGlyphCanvasAnsi` branch) — this
 *  function's caller wants the PLAIN glyphs for `display`/`text`, and reads
 *  `result.text` separately, unmodified, for `ansi`. */
function canvasPagesToText(
  pages: readonly {
    readonly canvas: {
      readonly grid: { readonly rows: number; readonly cols: number; readonly char: readonly string[] };
    };
  }[],
): string {
  return pages
    .map(({ canvas }) => {
      const { grid } = canvas;
      return Array.from({ length: grid.rows }, (_, row) =>
        grid.char.slice(row * grid.cols, (row + 1) * grid.cols).join(""),
      ).join("\n");
    })
    .join("\n\n");
}

export async function renderGlyphDiagramsWorkbenchState(
  state: GlyphDiagramsWorkbenchState,
  viewportPx?: GlyphPixelBox,
): Promise<GlyphDiagramsWorkbenchRender> {
  try {
    const graph = buildGlyphDiagramsWorkbenchGraph(state);
    const options = glyphDiagramsWorkbenchRenderOptions(state, viewportPx);
    const downgraded = chatCharsetDowngrade(options);
    const charsetDowngraded = downgraded !== options;
    const result = await renderGlyphDiagram(graph, downgraded);
    const text = canvasPagesToText(result.pages);
    const isHtml = result.html !== undefined;
    return {
      ok: true,
      text,
      display: result.html ?? text,
      isHtml,
      ansi: result.text.includes("\x1b[") ? result.text : undefined,
      meta: result.meta,
      ...(charsetDowngraded ? { charsetDowngraded: true as const } : {}),
      ...glyphDiagramsWorkbenchHotspots(result.pages),
    };
  } catch (error) {
    const failure = error as Error & { code?: string };
    return {
      ok: false,
      error: failure.code ? `${failure.code}: ${failure.message}` : failure.message,
      code: failure.code,
    };
  }
}

/**
 * Mirrors `renderGlyphDiagramsWorkbenchState` exactly, one level down for
 * the sequence pipeline (task packet — see `DiagramsWorkbench.tsx`'s own
 * doc on the `form`-polymorphic `rendered` variable this feeds): same
 * charset-downgrade idiom, same plain-text-from-canvas / ANSI-from-`result.text`
 * split, same ok/error union — so the viewport, the rail's error banner and
 * Copy ASCII/ANSI need no branch on which pipeline produced the value.
 * `GLYPH_SEQUENCE_TARGET_DEFAULTS` (chat/terminal/web) matches
 * `GLYPH_DIAGRAM_TARGET_DEFAULTS` exactly today (both packages' own doc on
 * that), so a chat request for `braille` still needs the same forced
 * downgrade to `box` the graph pipeline needs (no chat client's fenced-code
 * font carries braille — `AGENTS.md`'s "Targets and page").
 */
export async function renderGlyphDiagramsWorkbenchSequenceState(
  state: GlyphDiagramsWorkbenchState,
  viewportPx?: GlyphPixelBox,
): Promise<GlyphDiagramsWorkbenchRender> {
  try {
    const options: GlyphSequenceRenderOptions = glyphDiagramsWorkbenchSequenceRenderOptions(state, viewportPx);
    const downgraded = chatCharsetDowngradeSequence(options);
    const charsetDowngraded = downgraded !== options;
    const result: GlyphSequenceResult = await renderGlyphSequence(
      buildGlyphDiagramsWorkbenchSequence(state),
      downgraded,
    );
    const text = canvasPagesToText(result.pages);
    const isHtml = result.html !== undefined;
    return {
      ok: true,
      text,
      display: result.html ?? text,
      isHtml,
      ansi: result.text.includes("\x1b[") ? result.text : undefined,
      meta: { description: result.meta.description },
      ...(charsetDowngraded ? { charsetDowngraded: true as const } : {}),
    };
  } catch (error) {
    const failure = error as Error & { code?: string };
    return {
      ok: false,
      error: failure.code ? `${failure.code}: ${failure.message}` : failure.message,
      code: failure.code,
    };
  }
}

/**
 * Mirrors `renderGlyphDiagramsWorkbenchSequenceState` exactly, one level
 * down for the lane-DAG pipeline: same charset-downgrade idiom, same
 * plain-text-from-canvas / ANSI-from-`result.text` split, same ok/error
 * union — so the viewport, the rail's error banner and Copy ASCII/ANSI need
 * no branch on which pipeline produced the value. `GLYPH_LANE_TARGET_DEFAULTS`
 * (chat/terminal/web) matches the other two pipelines' own target-default
 * tables (`render.ts`'s own comment on that), so the same forced chat
 * downgrade to `box` applies.
 */
export async function renderGlyphDiagramsWorkbenchLanesState(
  state: GlyphDiagramsWorkbenchState,
  viewportPx?: GlyphPixelBox,
): Promise<GlyphDiagramsWorkbenchRender> {
  try {
    const options: GlyphLaneRenderOptions = glyphDiagramsWorkbenchLanesRenderOptions(state, viewportPx);
    const downgraded = chatCharsetDowngradeLanes(options);
    const charsetDowngraded = downgraded !== options;
    const result: GlyphLaneResult = await renderGlyphLaneDag(buildGlyphDiagramsWorkbenchLanes(state), downgraded);
    const text = canvasPagesToText(result.pages);
    const isHtml = result.html !== undefined;
    return {
      ok: true,
      text,
      display: result.html ?? text,
      isHtml,
      ansi: result.text.includes("\x1b[") ? result.text : undefined,
      meta: { description: result.meta.description },
      ...(charsetDowngraded ? { charsetDowngraded: true as const } : {}),
    };
  } catch (error) {
    const failure = error as Error & { code?: string };
    return {
      ok: false,
      error: failure.code ? `${failure.code}: ${failure.message}` : failure.message,
      code: failure.code,
    };
  }
}

/**
 * The viewport's own content rule (never a readout, mirrors
 * `chartsWorkbenchRender.ts`'s own `chartsWorkbenchDisplayRender`): the
 * current completed render for THIS state when it succeeded, else whatever
 * last laid out OK — `null` for both "still laying out" and "errored" so
 * a bad graph or an in-flight layout dims the frame instead of collapsing
 * it. Pure, so the fallback rule — "current if ok, else the frozen
 * last-good" — has a test with no DOM/async layout engine in the loop.
 */
export function glyphDiagramsWorkbenchDisplayResult(
  current: GlyphDiagramsWorkbenchRender | null,
  lastGood: Extract<GlyphDiagramsWorkbenchRender, { ok: true }> | null,
): Extract<GlyphDiagramsWorkbenchRender, { ok: true }> | null {
  return current?.ok ? current : lastGood;
}
