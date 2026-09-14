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

/** Braille is wireframe-only in glyphcss (AGENTS.md's "Render modes"); a 3D chart is always solid, so a requested `braille` charset downgrades to the default ASCII solid ramp. */
export function ledgerCharset3dBrailleUnsupported(): GlyphChart3dLedgerEntry {
  return entry(
    "chart3d-braille-unsupported",
    "3D charts render solid geometry; braille is wireframe-only in glyphcss, so this frame uses the default ramp instead.",
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
