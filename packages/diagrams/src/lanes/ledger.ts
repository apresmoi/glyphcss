/**
 * `report.ledger` entries specific to the lane-DAG form — mirrors
 * `sequence/ledger.ts` (see its doc comment): a lane-shaped entry (columns,
 * collapsed lanes, panels-by-time) is never folded into the graph
 * pipeline's or the sequence form's own vocabulary.
 */
import type { GlyphDiagramLedgerEntry } from "../ledger";

function entry(code: string, message: string, detail?: Record<string, unknown>): GlyphDiagramLedgerEntry {
  return detail === undefined ? { code, message } : { code, message, detail };
}

export function ledgerLaneLayoutOverflow(opts: { readonly naturalWidth: number; readonly naturalHeight: number; readonly requestedWidth: number; readonly requestedHeight: number }): GlyphDiagramLedgerEntry {
  return entry("lane-layout-overflow", `The lane DAG is ${opts.naturalWidth}x${opts.naturalHeight}, too wide for the requested ${opts.requestedWidth}x${opts.requestedHeight} even after collapsing lanes.`, { ...opts });
}

export function ledgerLaneCapCollapsed(opts: { readonly collapsedLanes: number; readonly nodeIds: readonly string[] }): GlyphDiagramLedgerEntry {
  const plural = opts.nodeIds.length === 1;
  return entry("lane-cap-collapsed", `Collapsed ${opts.collapsedLanes} of the least-active lane${opts.collapsedLanes === 1 ? "" : "s"} into one shared column to fit the requested width; ${opts.nodeIds.length} node${plural ? "" : "s"} (${opts.nodeIds.join(", ")}) lost ${plural ? "its own" : "their own"} lane position but still ${plural ? "renders its own row" : "render their own rows"}.`, { ...opts });
}

export function ledgerLanePaged(opts: { readonly panels: number }): GlyphDiagramLedgerEntry {
  return entry("lane-paged", `Split the lane DAG into ${opts.panels} panels by time to fit the requested height; a lane that continues across a page boundary keeps its column.`, { ...opts });
}
