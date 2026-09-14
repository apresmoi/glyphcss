import { renderGlyphDiagram, type GlyphDiagramRenderOptions, type GlyphDiagramResult } from "@glyphcss/diagrams";
import { renderGlyphDiagram3d, type GlyphDiagram3dRenderOptions, type GlyphDiagram3dResult } from "@glyphcss/diagrams/3d";
import {
  buildGlyphDiagramsWorkbenchGraph, glyphDiagramsWorkbenchRenderOptions, glyphDiagramsWorkbenchRenderOptions3d,
  type GlyphDiagramsWorkbenchCamera3d, type GlyphDiagramsWorkbenchState,
} from "./diagramsWorkbenchState";

export type GlyphDiagramsWorkbenchRender =
  | {
      ok: true; display: string; isHtml: boolean; text: string; ansi?: string; meta: GlyphDiagramResult["meta"];
      /** Mirrors `chartsWorkbenchRender.ts`'s own field — see its doc
       *  (CHARTS-RESEARCH `DIAGNOSIS-target-matrix.md` C4). */
      charsetDowngraded?: true;
    }
  | { ok: false; error: string; code?: string };

// See `chartsWorkbenchRender.ts`'s `chatCharsetDowngrade` — identical rule,
// mirrored here rather than shared because the two packages' render-option
// types are structurally distinct (`GlyphDiagramRenderOptions` vs
// `GlyphChartRenderOptions`) with no common module both already import.
function chatCharsetDowngrade(options: GlyphDiagramRenderOptions): GlyphDiagramRenderOptions {
  return options.target === "chat" && options.charset === "braille" ? { ...options, charset: "box" } : options;
}
/** Same rule, 3D's own options type (see `renderGlyphDiagramsWorkbenchState3d`'s doc for why chat still needs it). */
function chatCharsetDowngrade3d(options: GlyphDiagram3dRenderOptions): GlyphDiagram3dRenderOptions {
  return options.target === "chat" && options.charset === "braille" ? { ...options, charset: "box" } : options;
}

export async function renderGlyphDiagramsWorkbenchState(state: GlyphDiagramsWorkbenchState): Promise<GlyphDiagramsWorkbenchRender> {
  try {
    const options = glyphDiagramsWorkbenchRenderOptions(state);
    const downgraded = chatCharsetDowngrade(options);
    const charsetDowngraded = downgraded !== options;
    const result = await renderGlyphDiagram(buildGlyphDiagramsWorkbenchGraph(state), downgraded);
    const text = result.pages.map(({ canvas }) => { const { grid } = canvas; return Array.from({ length: grid.rows }, (_, row) => grid.char.slice(row * grid.cols, (row + 1) * grid.cols).join("")).join("\n"); }).join("\n\n");
    const isHtml = result.html !== undefined;
    return {
      ok: true, text, display: result.html ?? text, isHtml, ansi: result.text.includes("\x1b[") ? result.text : undefined, meta: result.meta,
      ...(charsetDowngraded ? { charsetDowngraded: true as const } : {}),
    };
  } catch (error) {
    const failure = error as Error & { code?: string };
    return { ok: false, error: failure.code ? `${failure.code}: ${failure.message}` : failure.message, code: failure.code };
  }
}

/**
 * Packet D3's 3D result shape — mirrors the 2D one above (`ok`/`error`
 * union, same `charsetDowngraded` idiom) so `TargetPreview` and the export
 * bar need no view-specific branch beyond which render function fed them.
 * Also carries `camera`/`object`: the RESOLVED camera (after auto-fit, when
 * it ran) so a caller can commit it back to `state.camera3d` — the exact
 * mechanism that makes "Copy reads the current camera" and "the live
 * viewport starts from the library's own auto-fit" the SAME call.
 */
export type GlyphDiagramsWorkbenchRender3d =
  | { ok: true; text: string; html?: string; ansi?: string; camera: GlyphDiagramsWorkbenchCamera3d; object: GlyphDiagram3dResult["object"]; charsetDowngraded?: true }
  | { ok: false; error: string; code?: string };

export async function renderGlyphDiagramsWorkbenchState3d(state: GlyphDiagramsWorkbenchState): Promise<GlyphDiagramsWorkbenchRender3d> {
  try {
    const graph = buildGlyphDiagramsWorkbenchGraph(state);
    const options = glyphDiagramsWorkbenchRenderOptions3d(state);
    // `resolveCharset`'s own `braille` -> wireframe degrade (`render3d.ts`)
    // still renders REAL braille dot glyphs — a wireframe rendered as
    // braille is exactly what that charset means in 3D, unlike 2D's own
    // chat-only concern. `chat` still can't display them (no chat client's
    // fenced-code font carries the braille block — AGENTS.md's "Targets and
    // page"), so this applies the SAME page-level downgrade the 2D path
    // does, on top of (never instead of) the library's own solid->wireframe
    // one.
    const pageDowngraded = chatCharsetDowngrade3d(options);
    const result = await renderGlyphDiagram3d(graph, pageDowngraded);
    const charsetDowngraded = pageDowngraded !== options || result.report.ledger.some((entry) => entry.code === "3d-charset-degraded");
    return {
      ok: true, text: result.text, ...(result.html === undefined ? {} : { html: result.html }),
      ansi: result.text.includes("\x1b[") ? result.text : undefined,
      camera: result.camera, object: result.object,
      ...(charsetDowngraded ? { charsetDowngraded: true as const } : {}),
    };
  } catch (error) {
    const failure = error as Error & { code?: string };
    return { ok: false, error: failure.code ? `${failure.code}: ${failure.message}` : failure.message, code: failure.code };
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
