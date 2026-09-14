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
