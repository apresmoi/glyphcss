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
 * Auto-fit (§11's D2 row) measures a probe render and scales the camera to
 * fit `cols`×`rows` with margin — real content, so it can only be WRONG when
 * the graph is dense enough that label text (which doesn't shrink with
 * zoom, unlike geometry) still overflows the fitted frame. Never thrown:
 * the frame is returned as-is, clipped, with this entry naming it.
 */
export function ledger3dContentOverflow(opts: { readonly cols: number; readonly rows: number }): GlyphDiagramLedgerEntry {
  return entry("3d-content-overflow", `The diagram is dense enough that some labels may be clipped at ${opts.cols}x${opts.rows} even after auto-fit — widen the frame or simplify the graph.`, { ...opts });
}
