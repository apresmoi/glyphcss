/**
 * Structured `report.ledger` entries for `@glyphcss/diagrams` — mirrors
 * `@glyphcss/charts`' own `ledger.ts` (see its doc comment for the full
 * rationale). `code` is a stable kebab id, `message` is one plain-English
 * sentence written for the person reading the diagram, `detail` carries
 * the exact numbers/ids behind it.
 */

export interface GlyphDiagramLedgerEntry {
  readonly code: string;
  readonly message: string;
  readonly detail?: Record<string, unknown>;
}

function entry(code: string, message: string, detail?: Record<string, unknown>): GlyphDiagramLedgerEntry {
  return detail === undefined ? { code, message } : { code, message, detail };
}

export function ledgerDuplicateEdgeMerged(opts: { readonly edgeId: string; readonly into: string }): GlyphDiagramLedgerEntry {
  return entry("duplicate-edge-merged", `Merged the duplicate connection "${opts.edgeId}" into "${opts.into}".`, { ...opts });
}

export function ledgerLeafClusterCollapsed(opts: { readonly members: readonly string[]; readonly into: string }): GlyphDiagramLedgerEntry {
  // `into` is always a synthesized `cluster:[...]` id (never user-authored,
  // see `glyphDiagramCollapseLeaves`) — a reader has no use for it, and its
  // own colon would break the ledger's own "no colon" sentence rule.
  return entry("leaf-cluster-collapsed", `Grouped ${opts.members.length} sibling nodes (${opts.members.join(", ")}) into one summary node to save space; the originals are kept in the diagram's metadata.`, { ...opts });
}

export function ledgerGroupMemberList(opts: { readonly groupId: string; readonly reason: "overlap" | "unrelated-nodes" }): GlyphDiagramLedgerEntry {
  const why = opts.reason === "overlap" ? "its membership overlaps another group" : "a box around it would include unrelated nodes";
  return entry("group-member-list", `Showed group "${opts.groupId}" as a plain list instead of a box, because ${why}.`, { ...opts });
}

export function ledgerLabelAbbreviated(opts: { readonly role: string; readonly before: string; readonly after: string }): GlyphDiagramLedgerEntry {
  return entry("label-abbreviated", `Abbreviated the ${opts.role} from "${opts.before}" to "${opts.after}" to fit.`, { ...opts });
}

export function ledgerLabelDropped(opts: { readonly role: string; readonly text?: string; readonly reason: string }): GlyphDiagramLedgerEntry {
  const named = opts.text ? ` "${opts.text}"` : "";
  return entry("label-dropped", `Dropped the ${opts.role}${named} — ${opts.reason}.`, { ...opts });
}

export function ledgerLabelFolded(opts: { readonly nodeId: string; readonly before: string; readonly after: string }): GlyphDiagramLedgerEntry {
  return entry("label-folded", `Replaced unsupported characters in the "${opts.nodeId}" label — it now reads "${opts.after}".`, { ...opts });
}

/**
 * USER FEEDBACK, verbatim: "the label of retry shouldn't be near workers,
 * it should be from the other side of the workers box, otherwise its
 * confusing". `glyphDiagramLabelLayout`'s `avoid` preference (`labels.ts`)
 * tries every candidate clear of a foreign group's rect before ever using
 * one that isn't; this entry fires only in the rare case where the whole
 * route offers no such candidate, so the label still lands (least-bad,
 * never dropped for this reason alone) but a reader — or a future layout
 * change — can see exactly which label and which group it couldn't clear.
 */
export function ledgerLabelNearForeignGroup(opts: { readonly role: string; readonly text: string; readonly groupId: string }): GlyphDiagramLedgerEntry {
  return entry("label-near-foreign-group", `The ${opts.role} "${opts.text}" has no room clear of group "${opts.groupId}" and was placed next to it anyway.`, { ...opts });
}

export function ledgerRouteConflict(opts: { readonly kind: "parallel" | "corner" | "multi"; readonly col: number; readonly row: number; readonly edgeIds: readonly string[] }): GlyphDiagramLedgerEntry {
  const ids = opts.edgeIds.join(", ");
  const phrase = opts.kind === "parallel" ? `Connections ${ids} run in parallel through the same cell`
    : opts.kind === "corner" ? `Connections ${ids} share a corner`
    : `Connections ${ids} cross`;
  return entry("route-conflict", `${phrase} at column ${opts.col}, row ${opts.row}.`, { ...opts });
}

export function ledgerRoutingAttempt(opts: { readonly edgeId: string; readonly stage: "degrade" | "split" }): GlyphDiagramLedgerEntry {
  const message = opts.stage === "degrade"
    ? `Connection "${opts.edgeId}" couldn't be routed as drawn and needs simplifying.`
    : `Connection "${opts.edgeId}" couldn't be routed and will be split into its own panel.`;
  return entry("routing-attempt", message, { ...opts });
}

/**
 * RC4 (DIAGNOSIS-diagrams-fanout.md): `attempt()` used to route against the
 * requested viewport even when the layout itself didn't fit, so every port
 * lying outside it was logged as a `routing-attempt` failure — a SIZE
 * overflow misreported as a routing one, and the entry never said which
 * dimension overflowed by how much. `layout-overflow` is the honest report
 * for that case; `routing-attempt` is reserved for a genuine A* failure
 * inside a layout that already fits.
 */
// REVIEW-diagrams-fanout-opus.md P3-3: this entry's laid-out size used to
// share the plain `width`/`height` keys with `ledgerSplitPanelDropped`'s
// own `detail`, which means the REQUESTED viewport there — an agent
// reading `detail` uniformly got opposite meanings from the same two keys
// depending which entry it landed on. `layoutWidth`/`layoutHeight` names
// what THIS entry adds (the size the engine actually produced);
// `requestedWidth`/`requestedHeight` is the vocabulary both this entry and
// `split-panel-dropped` now share for the size the caller actually asked
// for, so the same key means the same thing everywhere in the ledger.
export function ledgerLayoutOverflow(opts: { readonly stage: "degrade" | "split"; readonly layoutWidth: number; readonly layoutHeight: number; readonly requestedWidth: number; readonly requestedHeight: number }): GlyphDiagramLedgerEntry {
  const message = opts.stage === "degrade"
    ? `The layout is ${opts.layoutWidth}x${opts.layoutHeight}, too large for the requested ${opts.requestedWidth}x${opts.requestedHeight}, and needs simplifying.`
    : `The layout is ${opts.layoutWidth}x${opts.layoutHeight}, too large for the requested ${opts.requestedWidth}x${opts.requestedHeight}, and will be split into panels.`;
  return entry("layout-overflow", message, { ...opts });
}

// `GlyphDiagramDegradeStage` derives from `degrade.ts`'s own
// `GLYPH_DIAGRAM_DEGRADE_STAGES` (the ladder's real order — see
// render.ts) rather than repeating the literal union here, so the two
// can never drift apart; a type-only import keeps this from becoming a
// runtime circular dependency (degrade.ts already imports from this file).
import type { GLYPH_DIAGRAM_DEGRADE_STAGES } from "./degrade";
export type GlyphDiagramDegradeStage = (typeof GLYPH_DIAGRAM_DEGRADE_STAGES)[number];
const BUDGET_STAGE_MESSAGE: Readonly<Record<GlyphDiagramDegradeStage, string>> = {
  compaction: "Tightened the layout's margins and spacing to fit the diagram's size limit, before changing anything it draws.",
  decoration: "Dropped optional shapes, group captions, edge labels and line styling to fit the diagram's size limit; the originals are kept in the diagram's metadata.",
  duplicates: "Merged duplicate parallel connections to fit the diagram's size limit.",
  "leaf-clusters": "Collapsed sibling leaf nodes to fit the diagram's size limit.",
  split: "Split the diagram into multiple panels to fit the size limit; boundary nodes repeat across panels so every connection stays visible.",
};

export function ledgerBudgetStage(stage: GlyphDiagramDegradeStage): GlyphDiagramLedgerEntry {
  return entry(`budget-${stage}`, BUDGET_STAGE_MESSAGE[stage]);
}

export function ledgerDetailFaithful(): GlyphDiagramLedgerEntry {
  return entry("detail-faithful", "Kept every shape, label and duplicate connection as drawn — splitting into panels was the only change allowed to fit the diagram.");
}

export function ledgerSplitPanelDropped(opts: { readonly panel: number; readonly requestedWidth: number; readonly requestedHeight: number; readonly nodes: readonly string[] }): GlyphDiagramLedgerEntry {
  return entry("split-panel-dropped", `Panel ${opts.panel} didn't fit in ${opts.requestedWidth}×${opts.requestedHeight} and was left out; its nodes are kept in the diagram's metadata.`, { ...opts });
}

export function ledgerUnroutable(opts: { readonly edgeId: string; readonly reason: string }): GlyphDiagramLedgerEntry {
  return entry("unroutable", `Couldn't route the "${opts.edgeId}" connection — ${opts.reason}.`, { ...opts });
}

export function ledgerDoubleDiagonalSolid(opts: { readonly col: number; readonly row: number }): GlyphDiagramLedgerEntry {
  return entry("double-diagonal-solid", `Drew a diagonal line near column ${opts.col}, row ${opts.row} solid — the double-line style has no diagonal form.`, { ...opts });
}

/**
 * See `@glyphcss/charts`' `chartLedgerEntryFromCanvasMessage` — same shared
 * `glyphcss` cell-canvas source, same single free-text shape to parse.
 */
export function diagramLedgerEntryFromCanvasMessage(raw: string): GlyphDiagramLedgerEntry {
  const match = /cell \((\d+), (\d+)\)/.exec(raw);
  return ledgerDoubleDiagonalSolid({ col: match ? Number(match[1]) : 0, row: match ? Number(match[2]) : 0 });
}

/**
 * `renderGlyphDiagram` used to dedupe its accumulated ledger with a plain
 * `[...new Set(ledger)]` — fine for strings, but a `new Set` of entry
 * OBJECTS never collapses two structurally-identical entries (each object
 * literal is a distinct reference), so the same degradation logged from two
 * attempt() passes would show up twice. Dedupe by content instead.
 */
export function dedupeGlyphDiagramLedger(ledger: readonly GlyphDiagramLedgerEntry[]): GlyphDiagramLedgerEntry[] {
  const seen = new Map<string, GlyphDiagramLedgerEntry>();
  for (const entry of ledger) seen.set(JSON.stringify(entry), entry);
  return [...seen.values()];
}
