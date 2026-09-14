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
 * D2 round 7 (user, verbatim: "we need to use braille and blocks for 3d
 * diagrams" — box-drawing/bar glyphs can't represent an edge/box seen at an
 * angle). `braille` and `blocks` are the ONLY two 3D diagram charsets now;
 * an `"ascii"`/`"box"` request DEGRADES rather than rendering literal
 * line-glyph box drawing — to `"blocks"` on `chat` (a chat client's own
 * fenced-code font carries the Block Elements range but essentially never
 * braille, AGENTS.md's "Targets and page") and to `"braille"` everywhere
 * else (`web`/`terminal`, which both already default to braille). Logged
 * once per render, naming the target that decided the destination.
 */
export function ledger3dCharsetDegraded(opts: { readonly charset: "ascii" | "box"; readonly target: "chat" | "terminal" | "web"; readonly renderedAs: "braille" | "blocks" }): GlyphDiagramLedgerEntry {
  return entry(
    "3d-charset-degraded",
    `3D diagrams only render through braille or blocks — box-drawing glyphs can't trace an edge or a box face at an angle. Requesting "${opts.charset}" on ${opts.target} rendered as ${opts.renderedAs} instead.`,
    { ...opts },
  );
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
 * (the ribbon mesh still shows the edge itself), reported ONCE.
 * `arrowheads: true`/`false` always overrides this.
 */
export function ledger3dArrowheadsSuppressed(opts: { readonly edgeCount: number; readonly threshold: number }): GlyphDiagramLedgerEntry {
  return entry("3d-arrowheads-suppressed", `${opts.edgeCount} edges is past the ${opts.threshold}-edge density budget — arrowheads are hidden to reduce clutter; pass arrowheads: true to override.`, { ...opts });
}

/**
 * D2 round 7: the `blocks` charset paints two colours per cell
 * (`glyphcss`'s `encodeGlyphBuffersDual`, halfblock), which has NO ANSI
 * SGR form — only plain text or HTML `<span>` markup (AGENTS.md's "Render
 * modes"). An ANSI colour mode (`ansi16`/`ansi256`/`truecolor`) requested
 * alongside `charset: "blocks"` degrades to plain, colourless text rather
 * than silently dropping the requested colour with no signal.
 */
export function ledger3dBlocksAnsiUnsupported(opts: { readonly color: string }): GlyphDiagramLedgerEntry {
  return entry("3d-blocks-ansi-unsupported", `The blocks charset has no ANSI colour form — rendering "${opts.color}" as plain text instead. Use color: "css" for a coloured blocks export.`, { ...opts });
}
