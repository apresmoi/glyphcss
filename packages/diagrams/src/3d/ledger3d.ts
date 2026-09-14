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
 * `charset: "braille"` can only draw a scene in WIREFRAME (AGENTS.md's
 * "Render modes": braille is a documented no-op in solid/voxel/ink), so a
 * solid node/group volume degrades to its wireframe outline; `"blocks"`
 * asks for the quadrant/halfblock dual-color encoder, which bypasses
 * `CellGrid`/`transformCells` entirely (AGENTS.md's "Cell canvas" / the
 * `RasterizeContextOptions.charMode` doc) — incompatible with the stamped
 * edge/label overlays this renderer depends on — so it falls back to the
 * same solid ASCII render `"ascii"`/`"box"` already produce.
 */
export function ledger3dCharsetDegraded(opts: { readonly charset: "blocks" | "braille"; readonly renderedAs: "ascii" | "wireframe" }): GlyphDiagramLedgerEntry {
  const message = opts.charset === "braille"
    ? "Braille can only draw wireframe outlines in 3D, not solid Lambert-shaded surfaces — node and group volumes render as wireframe boxes."
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
