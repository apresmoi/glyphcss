import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderGlyphDiagram } from "./render";

const fixture = (name: string) => readFileSync(resolve(__dirname, `../fixtures/${name}.mmd`), "utf8");
const snapshot = (name: string) => resolve(__dirname, `../fixtures/expected/${name}.txt`);
// The target chat budget, with the options the chat skill renders state machines under.
const chat = { target: "chat" as const, width: 72, height: 24, overflow: "expand" as const, autoDirection: true, detail: "faithful" as const };
// In ascii the three marker glyphs fold to look-alikes, and say so like any other fold; anything else folded would be a defect.
const markerFolds = (r: Awaited<ReturnType<typeof renderGlyphDiagram>>) => r.report.ledger.filter((e) => e.code === "label-folded");
const degradation = (r: Awaited<ReturnType<typeof renderGlyphDiagram>>) => r.report.ledger.filter((e) => /^(label-(?!folded)|unroutable|routing-attempt|split-|budget-(decoration|duplicates|leaf-clusters|split))/.test(e.code));
const count = (text: string, glyph: string) => [...text].filter((c) => c === glyph).length;

describe("state diagram rendering", () => {
  it("renders an order lifecycle with every label whole, every transition routed and start/end markers", async () => {
    const r = await renderGlyphDiagram(fixture("state-order"), chat);
    const edges = r.meta.edges;
    expect(edges).toHaveLength(10);
    expect(r.report.unroutable).toEqual([]);
    expect(r.routes).toHaveLength(edges.length);
    expect(degradation(r)).toEqual([]);
    // Every authored event label is placed verbatim, and every state's name is intact in the cells.
    expect(r.labels.map((l) => l.text).sort()).toEqual(edges.flatMap((e) => e.label ? [e.label] : []).sort());
    for (const name of ["Pending", "Paid", "Shipped", "Delivered", "Cancelled", "Refunded"]) expect(r.text).toContain(name);
    // One shared start, one shared end, each drawn once.
    expect(r.layout.nodes.filter((n) => n.kind === "state-start").map((n) => n.id)).toEqual(["[*]:start"]);
    expect(r.layout.nodes.filter((n) => n.kind === "state-end").map((n) => n.id)).toEqual(["[*]:end"]);
    expect(count(r.text, "●")).toBe(1);
    expect(count(r.text, "◉")).toBe(1);
    expect(r.layout.direction).toBe("TB");
    // The self transition is the compact loop, label beside it.
    const loop = r.routes.find((route) => route.edge.from === route.edge.to)!;
    expect(loop.cells).toHaveLength(4);
    expect(r.labels.find((l) => l.text === "partial refund")!.x0).toBe(Math.max(...loop.cells.map((p) => p.x)) + 2);
    await expect(r.text).toMatchFileSnapshot(snapshot("state-order.box.chat72x24"));
  });

  it("draws states as rounded boxes", async () => {
    const r = await renderGlyphDiagram("stateDiagram-v2\nA --> B", chat);
    expect(r.text).toContain("╭");
    expect(r.text).toContain("╯");
  });

  it("renders a composite state as a group around its own start, states and end", async () => {
    const r = await renderGlyphDiagram(fixture("state-composite"), chat);
    expect(r.report.unroutable).toEqual([]);
    expect(r.routes).toHaveLength(r.meta.edges.length);
    expect(degradation(r)).toEqual([]);
    expect(r.layout.groups.map((g) => g.id)).toEqual(["Active"]);
    const inner = ["[*]:start:Active", "Running", "Paused", "[*]:end:Active"];
    expect([...r.layout.groups[0]!.members].sort()).toEqual([...inner].sort());
    // The group's rectangle holds exactly its own members and no outsider.
    const boxes = (ids: string[]) => ids.map((id) => r.layout.nodes.find((n) => n.id === id)!);
    const frame = { x0: Math.min(...boxes(inner).map((n) => n.x0)), x1: Math.max(...boxes(inner).map((n) => n.x1)), y0: Math.min(...boxes(inner).map((n) => n.y0)), y1: Math.max(...boxes(inner).map((n) => n.y1)) };
    for (const outsider of boxes(["Idle", "[*]:start", "[*]:end"])) expect(outsider.x1 < frame.x0 - 1 || outsider.x0 > frame.x1 + 1 || outsider.y1 < frame.y0 - 1 || outsider.y0 > frame.y1 + 1).toBe(true);
    expect(r.text).toContain("Active");
    expect(count(r.text, "●")).toBe(2);
    expect(count(r.text, "◉")).toBe(2);
    await expect(r.text).toMatchFileSnapshot(snapshot("state-composite.box.chat72x24"));
  });

  it("routes a transition that leaves a composite back to a state outside it", async () => {
    const r = await renderGlyphDiagram(`${fixture("state-composite")}    Active --> Idle : reset\n`, chat);
    expect(r.report.unroutable).toEqual([]);
    expect(r.routes).toHaveLength(r.meta.edges.length);
    expect(r.labels.map((l) => l.text)).toContain("reset");
    expect(degradation(r)).toEqual([]);
  });

  it("renders a choice as a diamond marked with one glyph, edges whole", async () => {
    const r = await renderGlyphDiagram(fixture("state-choice"), chat);
    expect(r.report.unroutable).toEqual([]);
    expect(degradation(r)).toEqual([]);
    expect(r.labels.map((l) => l.text).sort()).toEqual(["invalid", "valid"]);
    expect(r.layout.nodes.find((n) => n.id === "check")).toMatchObject({ shape: "diamond", lines: ["◆"] });
    expect(r.layout.direction).toBe("LR");
    await expect(r.text).toMatchFileSnapshot(snapshot("state-choice.box.chat72x24"));
  });

  it.each(["state-order", "state-composite", "state-choice"])("stays printable ASCII in the ascii charset: %s", async (name) => {
    // Mutation: drop the marker table in measureGlyphGraph -> '?' replaces the markers and this regex goes red.
    const r = await renderGlyphDiagram(fixture(name), { ...chat, charset: "ascii" });
    expect(r.text).toMatch(/^[\x20-\x7e\n]*$/);
    expect(r.text).not.toContain("?");
    expect(r.report.unroutable).toEqual([]);
    expect(degradation(r)).toEqual([]);
    expect(markerFolds(r).every((e) => /^[●◉◆]$/.test(String(e.detail?.before)) && /^[*@]$/.test(String(e.detail?.after)))).toBe(true);
    expect(r.report.unsupportedGlyphs).toEqual([]);
    if (name === "state-order") { expect(count(r.text, "*")).toBe(1); expect(count(r.text, "@")).toBe(1); }
    await expect(r.text).toMatchFileSnapshot(snapshot(`${name}.ascii.chat72x24`));
  });

  it("draws a node with an empty label without reporting a dropped label", async () => {
    // Mutation: remove the blank-candidate skip in glyphDiagramLabelLayout -> label-dropped appears for the empty row.
    const r = await renderGlyphDiagram({ direction: "TB", nodes: [{ id: "a", label: "" }, { id: "b", label: "B" }], edges: [{ from: "a", to: "b" }] }, { ...chat, charset: "ascii" });
    expect(r.report.ledger.map((e) => e.code)).not.toContain("label-dropped");
    expect(r.text).toContain("+");
  });

  it("draws a choice as a diamond holding an ascii twin of its marker", async () => {
    const r = await renderGlyphDiagram(fixture("state-choice"), { ...chat, charset: "ascii" });
    expect(r.layout.nodes.find((n) => n.id === "check")!.lines).toEqual(["*"]);
    expect(r.text).toContain("/");
    expect(markerFolds(r).map((e) => e.detail?.after)).toEqual(["*", "*", "@"]);
  });

  it("honours a direction statement and accepts the same source from the sibling adapter's output", async () => {
    const down = await renderGlyphDiagram("stateDiagram-v2\n[*] --> A\nA --> B", chat);
    const across = await renderGlyphDiagram("stateDiagram-v2\ndirection LR\n[*] --> A\nA --> B", chat);
    expect(down.layout.direction).toBe("TB");
    expect(across.layout.direction).toBe("LR");
    expect(down.layout.height).toBeGreaterThan(across.layout.height);
  });

  it("rejects an unsupported construct through the renderer with its code", async () => {
    await expect(renderGlyphDiagram("stateDiagram-v2\nA --> B\nnote right of A : hi", chat)).rejects.toMatchObject({ code: "GLYPH_MERMAID_STATE_NOTE" });
  });
});
