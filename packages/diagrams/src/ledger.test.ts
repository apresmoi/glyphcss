import { describe, expect, it } from "vitest";
import {
  dedupeGlyphDiagramLedger,
  diagramLedgerEntryFromCanvasMessage,
  ledgerBudgetStage,
  ledgerDetailFaithful,
  ledgerDoubleDiagonalSolid,
  ledgerDuplicateEdgeMerged,
  ledgerGroupMemberList,
  ledgerLabelAbbreviated,
  ledgerLabelDropped,
  ledgerLabelFolded,
  ledgerLeafClusterCollapsed,
  ledgerRouteConflict,
  ledgerRoutingAttempt,
  ledgerSplitPanelDropped,
  ledgerUnroutable,
} from "./ledger";

const SAMPLES = [
  ledgerDuplicateEdgeMerged({ edgeId: "e2", into: "e1" }),
  ledgerLeafClusterCollapsed({ members: ["a", "b", "c"], into: "cluster:1" }),
  ledgerGroupMemberList({ groupId: "G1", reason: "overlap" }),
  ledgerGroupMemberList({ groupId: "G2", reason: "unrelated-nodes" }),
  ledgerLabelAbbreviated({ role: "edge label", before: "a very long edge label", after: "a very long e…" }),
  ledgerLabelDropped({ role: "group label", text: "Group 1", reason: "there was no room for any text" }),
  ledgerLabelFolded({ nodeId: "n1", before: "café 漢字", after: "cafe ??" }),
  ledgerRouteConflict({ kind: "parallel", col: 3, row: 4, edgeIds: ["e1", "e2"] }),
  ledgerRouteConflict({ kind: "corner", col: 1, row: 2, edgeIds: ["e1", "e2"] }),
  ledgerRouteConflict({ kind: "multi", col: 5, row: 6, edgeIds: ["e1", "e2", "e3"] }),
  ledgerRoutingAttempt({ edgeId: "e1", stage: "degrade" }),
  ledgerRoutingAttempt({ edgeId: "e1", stage: "split" }),
  ledgerBudgetStage("decoration"),
  ledgerBudgetStage("duplicates"),
  ledgerBudgetStage("leaf-clusters"),
  ledgerBudgetStage("split"),
  ledgerDetailFaithful(),
  ledgerSplitPanelDropped({ panel: 2, width: 60, height: 20, nodes: ["a", "b"] }),
  ledgerUnroutable({ edgeId: "e1", reason: "no path was found from \"a\" to \"b\"" }),
  ledgerDoubleDiagonalSolid({ col: 4, row: 6 }),
];

describe("diagram ledger entries read like sentences, not internal logs", () => {
  it("every message starts capitalised, ends with a period, and has no colon or arrow", () => {
    for (const entry of SAMPLES) expect(entry.message).toMatch(/^[A-Z][^:>]*\.$/);
  });
  it("no message has a broken ordinal (2th) — 1st/2nd/3rd are the only correct forms", () => {
    for (const entry of SAMPLES) expect(entry.message).not.toMatch(/\b[123]th\b/);
  });
  it("every code is a stable kebab id", () => {
    for (const entry of SAMPLES) expect(entry.code).toMatch(/^[a-z][a-z0-9-]*$/);
  });
  it("the four budget-ladder stage markers are distinguishable from a per-panel drop", () => {
    const stageCodes = ["decoration", "duplicates", "leaf-clusters", "split"].map((s) => ledgerBudgetStage(s as never).code);
    for (const code of stageCodes) expect(code.startsWith("budget-")).toBe(true);
    expect(ledgerSplitPanelDropped({ panel: 1, width: 10, height: 10, nodes: [] }).code.startsWith("budget-")).toBe(false);
  });
  it("parses the canvas's own free-text double-diagonal note into a structured entry", () => {
    const raw = 'line(): "double" style has no diagonal analogue and rendered solid starting at cell (4, 6).';
    expect(diagramLedgerEntryFromCanvasMessage(raw)).toEqual(ledgerDoubleDiagonalSolid({ col: 4, row: 6 }));
  });
  it("dedupes structurally-identical entries even though they are distinct object references", () => {
    const a = ledgerDetailFaithful(), b = ledgerDetailFaithful();
    expect(a).not.toBe(b);
    expect(dedupeGlyphDiagramLedger([a, b])).toHaveLength(1);
    expect(dedupeGlyphDiagramLedger([a, ledgerUnroutable({ edgeId: "x", reason: "r" })])).toHaveLength(2);
  });
});
