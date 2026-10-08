import { describe, expect, it } from "vitest";
import { diagramsSourceItemOfSlot, diagramsSourceSlotOfItem } from "./diagramsSourceSelection";
import { diagramsSourceSlots } from "./diagramsSourceSlots";

const at = (text: string, slot: { start: number; end: number } | undefined) => (slot ? text.slice(slot.start, slot.end) : undefined);

describe("diagramsSourceSelection — Mermaid", () => {
  const text = "flowchart LR\n  a[Alpha] --> b{Beta?}\n  b -->|yes| c\n  c --> d[Delta] --> a\n  subgraph crew[Crew]\n    c\n  end";
  const slots = diagramsSourceSlots("graph", "mermaid", text);
  const slotAt = (needle: string, offset = 0) => slots.find((s) => s.start <= text.indexOf(needle) + offset && text.indexOf(needle) + offset < s.end)!;

  it("click: a node selects its label wherever it is declared, else its id; an edge selects its label, else its arrow", () => {
    // Mutation: return the id instead of the label -> "Alpha" becomes "a" -> red.
    expect(at(text, diagramsSourceSlotOfItem(slots, text, "mermaid", { kind: "node", id: "a" }))).toBe("Alpha");
    expect(at(text, diagramsSourceSlotOfItem(slots, text, "mermaid", { kind: "node", id: "d" }))).toBe("Delta"); // declared on an edge line, after the arrow
    const c = diagramsSourceSlotOfItem(slots, text, "mermaid", { kind: "node", id: "c" })!;
    expect(at(text, c)).toBe("c"); // no label anywhere: its first mention as a node id (`|yes| c`), not the later `c -->` endpoint
    expect(c.start).toBe(text.indexOf("| c") + 2);
    expect(at(text, diagramsSourceSlotOfItem(slots, text, "mermaid", { kind: "edge", from: "b", to: "c" }))).toBe("yes");
    const arrow = diagramsSourceSlotOfItem(slots, text, "mermaid", { kind: "edge", from: "d", to: "a" })!;
    expect(arrow.role).toBe("arrow");
    expect(arrow.start).toBeGreaterThan(text.indexOf("Delta"));
    expect(diagramsSourceSlotOfItem(slots, text, "mermaid", { kind: "node", id: "zzz" })).toBeUndefined();
  });

  it("reverse: the field under the caret names its node, or its edge per link of a chain; a subgraph's own fields name nothing", () => {
    // Mutation: resolve every field on an edge line to the line's first
    // endpoint -> "Delta" reads as node c -> red.
    expect(diagramsSourceItemOfSlot(slots, text, "mermaid", slotAt("Alpha"))).toEqual({ kind: "node", id: "a" });
    expect(diagramsSourceItemOfSlot(slots, text, "mermaid", slotAt("Delta"))).toEqual({ kind: "node", id: "d" });
    expect(diagramsSourceItemOfSlot(slots, text, "mermaid", slotAt("{Beta"))).toEqual({ kind: "node", id: "b" }); // the shape opener
    expect(diagramsSourceItemOfSlot(slots, text, "mermaid", slotAt("yes"))).toEqual({ kind: "edge", from: "b", to: "c" });
    expect(diagramsSourceItemOfSlot(slots, text, "mermaid", slotAt("--> a"))).toEqual({ kind: "edge", from: "d", to: "a" });
    expect(diagramsSourceItemOfSlot(slots, text, "mermaid", slotAt("c --> d"))).toEqual({ kind: "node", id: "c" });
    expect(diagramsSourceItemOfSlot(slots, text, "mermaid", slotAt("Crew"))).toBeUndefined();
    expect(diagramsSourceItemOfSlot(slots, text, "mermaid", slots[0]!)).toBeUndefined(); // the direction
  });
});

describe("diagramsSourceSelection — JSON", () => {
  const text = '{\n  "nodes": [\n    { "id": "a", "label": "Alpha" },\n    { "id": "b" }\n  ],\n  "edges": [{ "from": "a", "to": "b", "label": "go" }, { "from": "b", "to": "a" }],\n  "direction": "LR"\n}';
  const slots = diagramsSourceSlots("graph", "json", text);
  const slotAt = (needle: string) => slots.find((s) => s.start <= text.indexOf(needle) && text.indexOf(needle) < s.end)!;

  it("click: a node's label else its id; an edge's label else its from", () => {
    expect(at(text, diagramsSourceSlotOfItem(slots, text, "json", { kind: "node", id: "a" }))).toBe("Alpha");
    expect(diagramsSourceSlotOfItem(slots, text, "json", { kind: "node", id: "b" })!.role).toBe('"id"');
    expect(at(text, diagramsSourceSlotOfItem(slots, text, "json", { kind: "edge", from: "a", to: "b" }))).toBe("go");
    const from = diagramsSourceSlotOfItem(slots, text, "json", { kind: "edge", from: "b", to: "a" })!;
    expect(from.role).toBe('"from"');
    expect(from.start).toBeGreaterThan(text.indexOf('"go"'));
  });

  it("reverse: the enclosing object names the item — nested objects never leak into the root, whose own values name nothing", () => {
    // Mutation: count slots of nested objects as the root's -> "LR" reads as node a -> red.
    expect(diagramsSourceItemOfSlot(slots, text, "json", slotAt("Alpha"))).toEqual({ kind: "node", id: "a" });
    expect(diagramsSourceItemOfSlot(slots, text, "json", slotAt("go"))).toEqual({ kind: "edge", from: "a", to: "b" });
    expect(diagramsSourceItemOfSlot(slots, text, "json", slotAt("LR"))).toBeUndefined();
  });
});
