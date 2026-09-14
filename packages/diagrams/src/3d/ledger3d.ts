/**
 * `report.ledger` entries specific to the 3D static-frame export (packet
 * D2, PLAN-3d.md §11's D2 row) — same shape and one-plain-English-sentence
 * convention as `../ledger.ts`, kept in this directory because it is the 3D
 * track's own vocabulary (a 2D diagram never degrades a charset to
 * wireframe or clips a camera-fit frame).
 */
import type { GlyphDiagramLedgerEntry } from "../ledger";

function entry(code: string, message: string, detail?: Record<string, unknown>): GlyphDiagramLedgerEntry {
  return detail === undefined ? { code, message } : { code, message, detail };
}

/**
 * D2 round 3: the default (and `style: "ink"`) detail comes from the
 * renderer's own `ink` (crisp silhouette+crease line art, box/ascii) or
 * `wireframe`+`charMode: "braille"` (2x4 sub-cell dots) modes rather than
 * solid Lambert-shaded fills — message 2's own "we should be able to render
 * those with good detail using braille or ink mode", and AGENTS.md's
 * `hiddenLines: "hide"` on both so an occluded object/back edge disappears
 * rather than showing through. Braille there is the INTENDED look, not a
 * fallback from something else, so `resolveCharset` logs no entry for it —
 * this constructor is never called for that case. `"blocks"` still can't
 * carry the stamped edge/label overlays this renderer depends on (its
 * quadrant/halfblock dual-color encoder bypasses `CellGrid`/`transformCells`
 * entirely), so it degrades to the SAME `ink` render `"ascii"`/`"box"` use,
 * just with ASCII glyphs instead of its own sub-cell shading — that call
 * IS logged (`renderedAs: "ascii ink"`). An explicit `style: "solid"`
 * override reaches the OLD Lambert-shaded box render for a caller who wants
 * it back; THERE braille genuinely can't follow (solid has no wireframe
 * analogue), so it falls back to wireframe and that call is logged too
 * (`renderedAs: "wireframe"`, `charset: "braille"` — the only caller of
 * that combination; `style: "solid"`'s own `"blocks"` case logs
 * `renderedAs: "ascii"` instead, a different message below).
 */
export function ledger3dCharsetDegraded(opts: { readonly charset: "blocks" | "braille"; readonly renderedAs: "ascii ink" | "wireframe" | "ascii" }): GlyphDiagramLedgerEntry {
  const message = opts.renderedAs === "wireframe"
    ? "Braille can only draw wireframe outlines in 3D, not solid Lambert-shaded surfaces — node and group volumes render as wireframe boxes."
    : opts.renderedAs === "ascii ink"
      ? "The blocks charset's sub-cell shading can't carry stamped edges and labels — rendering as ASCII ink line art instead."
      : "The blocks charset's sub-cell shading can't carry stamped edges and labels — rendering as solid ASCII instead.";
  return entry("3d-charset-degraded", message, { ...opts });
}

/**
 * D2 review P1-2 (codex): a single node's own label text is LONGER than the
 * frame can ever show (`cols` minus both margins), independent of camera
 * zoom or position — geometry shrinks with zoom, but a label's cell width
 * doesn't. The analytic fit (`render3d.ts`'s `fitDiagramCamera`) excludes
 * such a label from its own constraint set (so it can't force every OTHER
 * label's zoom toward zero) and reports it here instead of silently
 * clipping it with no signal at all.
 */
export function ledger3dLabelUnfittable(opts: { readonly nodeId: string; readonly label: string; readonly cols: number }): GlyphDiagramLedgerEntry {
  return entry("3d-label-unfittable", `The "${opts.nodeId}" label ("${opts.label}") is wider than the ${opts.cols}-column frame itself — no camera zoom can show it whole; widen the frame or shorten the label.`, { ...opts });
}

/**
 * D2 review P1-2 (codex): the analytic fit computes where every label
 * SHOULD land, but the shared `GlyphLabelArbiter` can still refuse one at
 * render time (two labels genuinely colliding on screen from THIS
 * rotation, or a foreign mesh's `winnerMesh` covering one of its cells) —
 * a real case the fit's own geometry can't rule out in advance. `render3d.ts`
 * verifies every node's predicted label text actually landed in the FINAL
 * grid and logs this, naming the node, for any that didn't — never a
 * silent drop (the review's own repro: "Orchestrator vanished... with an
 * empty ledger").
 */
export function ledger3dLabelDropped(opts: { readonly nodeId: string; readonly label: string }): GlyphDiagramLedgerEntry {
  return entry("3d-label-dropped", `The "${opts.nodeId}" label ("${opts.label}") didn't make it into the final frame — likely hidden behind another node or collided with a neighboring label at this camera angle.`, { ...opts });
}

/**
 * D2 fix round 3, P1-2 (codex): the layered layout's dagre X/Y placement
 * was designed for an agent-style pipeline, not a dense social-network
 * graph (Zachary's karate club, 34 nodes / 78 edges), and collapses into
 * overlapping nodes and dense edge noise past a node-count threshold. When
 * the caller left `layout` unset, `render3d.ts` defaults it to `"force"`
 * above that threshold instead — reported here ONCE (not per-node), naming
 * the count and threshold, so the choice is visible and `layout: "layered"`
 * (or `"force"`) always overrides it explicitly.
 */
export function ledger3dLayoutAutoForce(opts: { readonly nodeCount: number; readonly threshold: number }): GlyphDiagramLedgerEntry {
  return entry("3d-layout-auto-force", `${opts.nodeCount} nodes is past the ${opts.threshold}-node legibility threshold for the layered layout — defaulted to "force" instead; pass layout: "layered" to override.`, { ...opts });
}

/**
 * D2 fix round 3, P1-2 (codex): past a node-count threshold every label
 * can no longer fit on screen without collapsing into illegible noise —
 * `render3d.ts` keeps only the highest-DEGREE node labels (ties broken by
 * id, the same priority `glyphDiagramObject`'s own label arbiter
 * candidates use) up to a budget and drops the rest, reported ONCE here
 * (naming how many of how many were kept) rather than one
 * `ledger3dLabelDropped` entry per suppressed node, which would bury the
 * one genuine per-label signal (an actual arbiter collision) in noise.
 * `maxLabels` always overrides this — `Infinity` shows every label
 * regardless of count.
 */
export function ledger3dLabelsSuppressed(opts: { readonly total: number; readonly kept: number; readonly threshold: number }): GlyphDiagramLedgerEntry {
  return entry("3d-labels-suppressed", `${opts.total} node labels would overlap at this size — showing the ${opts.kept} highest-degree nodes only; pass maxLabels to override (Infinity shows every label).`, { ...opts });
}

/**
 * D2 fix round 3, P1-2 (codex): past an edge-count density budget, every
 * edge's own arrowhead adds more visual noise than direction information
 * on a dense graph — `render3d.ts` drops arrowheads by default there
 * (the plain slope glyph still shows the edge itself), reported ONCE.
 * `arrowheads: true`/`false` always overrides this.
 */
export function ledger3dArrowheadsSuppressed(opts: { readonly edgeCount: number; readonly threshold: number }): GlyphDiagramLedgerEntry {
  return entry("3d-arrowheads-suppressed", `${opts.edgeCount} edges is past the ${opts.threshold}-edge density budget — arrowheads are hidden to reduce clutter; pass arrowheads: true to override.`, { ...opts });
}
