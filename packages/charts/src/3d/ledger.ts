/**
 * Structured `report.ledger` entries for `@glyphcss/charts/3d` — same
 * discipline as the root package's own `ledger.ts` (AGENTS.md's "Charts"):
 * a stable kebab `code`, ONE plain-English `message`, and a `detail` object
 * carrying the exact numbers.
 */
export interface GlyphChart3dLedgerEntry {
  readonly code: string;
  readonly message: string;
  readonly detail?: Record<string, unknown>;
}

function entry(code: string, message: string, detail?: Record<string, unknown>): GlyphChart3dLedgerEntry {
  return detail === undefined ? { code, message } : { code, message, detail };
}

/** `blocks` is a 2D cell-canvas tier, not a 3D scene `charMode` a chart's ALWAYS-mounted overlays (box wireframe, ticks) leave usable — halfblock/quadrant disable themselves whenever a `transformCells` hook exists (fix round 1, P1-4). Faithfully downgrades to the default solid ramp. Braille no longer downgrades (fix round 2's own `style: "wireframe"` support — braille renders a real depth-tested wireframe surface grid instead). */
export function ledgerCharset3dBlocksUnsupported(): GlyphChart3dLedgerEntry {
  return entry(
    "chart3d-blocks-unsupported",
    "3D charts always mount an axis box/tick overlay, which disables the halfblock encoder; this frame uses the default ramp instead.",
  );
}

/** `shading: "value"` has no effect under `style: "wireframe"` — a wireframe line has no fill face to texture, so colour is the surface's own per-quad band colour instead (fix round 2). */
export function ledgerChart3dValueShadingWireframeNoop(): GlyphChart3dLedgerEntry {
  return entry(
    "chart3d-value-shading-wireframe-noop",
    "shading: \"value\" has no effect under style: \"wireframe\" (no fill face to texture); the surface's own band colour is used per line instead.",
  );
}

/** A tick/title label's own text is wider than the requested frame itself, so no zoom could ever fit it — excluded from the auto-fit's own constraint set (fix round 2, P1-b) rather than forcing every OTHER label toward zoom zero. */
export function ledgerChart3dLabelUnfittable(opts: { readonly text: string; readonly cols: number }): GlyphChart3dLedgerEntry {
  return entry(
    "chart3d-label-unfittable",
    `Label ${JSON.stringify(opts.text)} is wider than the ${opts.cols}-column frame; excluded from the auto-fit.`,
    { ...opts },
  );
}

/** The chrome column for the value colorbar was skipped — the render is too narrow to reserve it and still leave a usable plot. */
export function ledgerColorbarOmitted(opts: { readonly width: number; readonly minWidth: number }): GlyphChart3dLedgerEntry {
  return entry(
    "chart3d-colorbar-omitted",
    `Render width ${opts.width} is too narrow to reserve a colorbar column (needs at least ${opts.minWidth}); omitted it.`,
    { ...opts },
  );
}

export function ledgerSurfaceDecimated(opts: {
  readonly sourceRows: number;
  readonly sourceCols: number;
  readonly keptRows: number;
  readonly keptCols: number;
}): GlyphChart3dLedgerEntry {
  const { sourceRows, sourceCols, keptRows, keptCols } = opts;
  return entry(
    "surface-decimated",
    `Reduced the ${sourceRows}x${sourceCols} surface grid to ${keptRows}x${keptCols} quads (kept its own peak and trough).`,
    { ...opts },
  );
}
