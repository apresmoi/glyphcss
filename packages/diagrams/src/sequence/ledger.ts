/** Sequence ledger entries describe participants and time panels, independent of graph layout. */
import type { GlyphDiagramLedgerEntry } from "../ledger";

function entry(code: string, message: string, detail?: Record<string, unknown>): GlyphDiagramLedgerEntry {
  return detail === undefined ? { code, message } : { code, message, detail };
}

export function ledgerSequenceLayoutOverflow(opts: { readonly naturalWidth: number; readonly naturalHeight: number; readonly requestedWidth: number; readonly requestedHeight: number }): GlyphDiagramLedgerEntry {
  return entry("sequence-layout-overflow", `The sequence is ${opts.naturalWidth}x${opts.naturalHeight}, too wide for the requested ${opts.requestedWidth}x${opts.requestedHeight} even after abbreviating every label.`, { ...opts });
}

export function ledgerSequencePaged(opts: { readonly panels: number }): GlyphDiagramLedgerEntry {
  return entry("sequence-paged", `Split the sequence into ${opts.panels} panels by time to fit the requested height; every panel repeats the participant header.`, { ...opts });
}

export function ledgerSequenceMarkerDropped(opts: { readonly kind: string; readonly label?: string; readonly reason: string }): GlyphDiagramLedgerEntry {
  const named = opts.label ? ` "${opts.label}"` : "";
  return entry("sequence-marker-dropped", `Dropped the ${opts.kind}${named} marker — ${opts.reason}.`, { ...opts });
}
