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

const BUDGET_STAGE_MESSAGE: Readonly<Record<"decoration" | "duplicates" | "leaf-clusters" | "split", string>> = {
  decoration: "Dropped optional shapes, group captions, edge labels and line styling to fit the diagram's size limit; the originals are kept in the diagram's metadata.",
  duplicates: "Merged duplicate parallel connections to fit the diagram's size limit.",
  "leaf-clusters": "Collapsed sibling leaf nodes to fit the diagram's size limit.",
  split: "Split the diagram into multiple panels to fit the size limit; boundary nodes repeat across panels so every connection stays visible.",
};

export function ledgerBudgetStage(stage: "decoration" | "duplicates" | "leaf-clusters" | "split"): GlyphDiagramLedgerEntry {
  return entry(`budget-${stage}`, BUDGET_STAGE_MESSAGE[stage]);
}

export function ledgerDetailFaithful(): GlyphDiagramLedgerEntry {
  return entry("detail-faithful", "Kept every shape, label and duplicate connection as drawn — splitting into panels was the only change allowed to fit the diagram.");
}

export function ledgerSplitPanelDropped(opts: { readonly panel: number; readonly width: number; readonly height: number; readonly nodes: readonly string[] }): GlyphDiagramLedgerEntry {
  return entry("split-panel-dropped", `Panel ${opts.panel} didn't fit in ${opts.width}×${opts.height} and was left out; its nodes are kept in the diagram's metadata.`, { ...opts });
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
