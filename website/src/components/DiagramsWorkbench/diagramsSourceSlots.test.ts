import { describe, expect, it } from "vitest";
import { glyphGraphFromMermaid } from "@glyphcss/diagrams";
import {
  diagramsSourceNearestSlot, diagramsSourceRepairSlots, diagramsSourceSlotAccepts, diagramsSourceSlotAt, diagramsSourceSlotChoose, diagramsSourceSlotCycle, diagramsSourceSlotOptionIndex, diagramsSourceSlotSanitize, diagramsSourceSlotStep, diagramsSourceSlots,
} from "./diagramsSourceSlots";
import { GLYPH_DIAGRAM_WORKBENCH_PRESETS, GLYPH_LANES_WORKBENCH_PRESETS, GLYPH_SEQUENCE_WORKBENCH_PRESETS } from "./diagramsWorkbenchState";

const spans = (text: string, slots: ReturnType<typeof diagramsSourceSlots>) => slots.map((s) => `${s.role}:${text.slice(s.start, s.end)}`);
/** Every character NOT inside a slot — the structure the editor protects. */
const protectedText = (text: string, slots: ReturnType<typeof diagramsSourceSlots>) =>
  Array.from(text).map((ch, i) => (slots.some((s) => s.start <= i && i < s.end) ? " " : ch)).join("");

describe("diagramsSourceSlots — Mermaid flowchart", () => {
  const text = "flowchart LR\n  a[Alpha] --> b{Beta?}\n  b -->|yes| c((C))\n  subgraph crew[Crew]\n    c\n  end\n  %% note";
  const slots = diagramsSourceSlots("graph", "mermaid", text);
  it("exposes ids, labels, arrows and shapes and nothing else", () => {
    expect(spans(text, slots)).toEqual([
      "direction:LR", "node id:a", "shape:[", "label:Alpha", "arrow:-->", "node id:b", "shape:{", "label:Beta?",
      "edge endpoint:b", "arrow:-->", "edge label:yes", "node id:c", "shape:((", "label:C",
      "subgraph id:crew", "shape:[", "label:Crew", "node id:c", "comment: note",
    ]);
    // The protected skeleton: keywords, closing brackets, `|`, `%%` and
    // whitespace. Arrows and OPENING brackets are cycle slots (they change
    // by cycling, never by typing), so they blank out here too. Mutation:
    // let a keyword or a closer into a slot -> a hole opens here -> red.
    expect(protectedText(text, slots)).toBe("flowchart   \n         ]            }\n       |   |     ))\n  subgraph          ]\n     \n  end\n  %%     ");
  });
  it("cycle slots rotate through the vocabulary; a shape rewrites both brackets and still parses", () => {
    const arrow = slots.find((s) => s.role === "arrow")!;
    expect(diagramsSourceSlotCycle(arrow, text, 1)).toEqual([{ start: arrow.start, end: arrow.end, replacement: "-.->" }]);
    expect(diagramsSourceSlotCycle(arrow, text, -1)).toEqual([{ start: arrow.start, end: arrow.end, replacement: "---" }]);
    // A direct choice: any listed option, nothing else, and the shape's closer rewritten with its opener.
    expect(diagramsSourceSlotChoose(arrow, "==>")).toEqual([{ start: arrow.start, end: arrow.end, replacement: "==>" }]);
    expect(diagramsSourceSlotChoose(arrow, "=>")).toBeNull();
    expect(diagramsSourceSlotOptionIndex(arrow, text)).toBe(0);
    const direction = slots[0]!;
    expect(diagramsSourceSlotCycle(direction, text, 1)![0]!.replacement).toBe("BT");
    const shape = slots.find((s) => s.role === "shape")!;
    let cycled = text;
    for (const edit of diagramsSourceSlotCycle(shape, text, 1)!) cycled = `${cycled.slice(0, edit.start)}${edit.replacement}${cycled.slice(edit.end)}`;
    expect(cycled.split("\n")[1]).toBe("  a(Alpha) --> b{Beta?}");
    expect(glyphGraphFromMermaid(cycled).nodes.find((n) => n.id === "a")!.shape).toBe("rounded");
    expect(diagramsSourceSlotCycle(slots[1]!, text, 1)).toBeNull(); // an id is not a cycle slot
  });
  it("an empty bracket pair and an empty |…| edge label still offer a zero-width slot to type into", () => {
    const empty = "flowchart TB\n  a[] -->|| b";
    const s = diagramsSourceSlots("graph", "mermaid", empty);
    expect(s.filter((x) => x.start === x.end).map((x) => x.role)).toEqual(["label", "edge label"]);
  });
});

describe("diagramsSourceSlots — Mermaid sequence", () => {
  const text = "sequenceDiagram\n  participant A as Alice\n  A->>B: hello there\n  alt ok\n    B-->>A: yes\n  else no\n    B-->>A:\n  end";
  const slots = diagramsSourceSlots("sequence", "mermaid", text);
  it("exposes participant kind/id/label, message endpoints, arrows and text, frame kind and label", () => {
    expect(spans(text, slots)).toEqual([
      "participant kind:participant", "participant id:A", "participant label:Alice",
      "message participant:A", "arrow:->>", "message participant:B", "message text:hello there",
      "frame kind:alt", "frame label:ok", "message participant:B", "arrow:-->>", "message participant:A", "message text:yes",
      "frame label:no", "message participant:B", "arrow:-->>", "message participant:A", "message text:",
    ]);
    expect(protectedText(text, slots)).toContain("sequenceDiagram");
    expect(protectedText(text, slots)).toContain("  else   \n");
    expect(protectedText(text, slots)).toContain("\n  end");
  });
  it("sequence arrows cycle through the sequence vocabulary, never the flowchart one", () => {
    const arrow = slots.find((s) => s.role === "arrow")!;
    expect(diagramsSourceSlotCycle(arrow, text, 1)![0]!.replacement).toBe("-->>");
  });
});

describe("diagramsSourceSlots — git log", () => {
  const text = "b|a c|(tag: v1)|Second commit\n\na|||First";
  const slots = diagramsSourceSlots("lanes", "gitlog", text);
  it("exposes id, parents, marks and subject; the pipes stay protected; a blank line has no slot", () => {
    expect(spans(text, slots)).toEqual(["commit id:b", "parents:a c", "marks:(tag: v1)", "subject:Second commit", "commit id:a", "parents:", "marks:", "subject:First"]);
    expect(protectedText(text, slots)).toBe(" |   |         |             \n\n |||     ");
  });
});

describe("diagramsSourceSlots — JSON", () => {
  const text = '{\n  "nodes": [\n    { "id": "a", "label": "Alpha", "shape": "diamond" }\n  ],\n  "edges": [{ "from": "a", "to": "b", "priority": 3, "style": "dotted" }],\n  "direction": "LR",\n  "flag": true\n}';
  const slots = diagramsSourceSlots("graph", "json", text);
  it("exposes VALUES only — never keys, braces, colons or commas — with enum values as cycle slots", () => {
    expect(spans(text, slots)).toEqual(['"id":a', '"label":Alpha', '"shape":diamond', '"from":a', '"to":b', '"priority":3', '"style":dotted', '"direction":LR', '"flag":true']);
    // Mutation: let key tokens become slots -> `"nodes"`/`"id"` appear here -> red.
    expect(protectedText(text, slots)).toBe('{\n  "nodes": [\n    { "id": " ", "label": "     ", "shape": "       " }\n  ],\n  "edges": [{ "from": " ", "to": " ", "priority":  , "style": "      " }],\n  "direction": "  ",\n  "flag":     \n}');
    expect(slots.find((s) => s.role === '"shape"')!.kind).toBe("cycle");
    expect(slots.find((s) => s.role === '"from"')!.kind).toBe("id");
    expect(slots.find((s) => s.role === '"label"')!.kind).toBe("text");
    expect(diagramsSourceSlotCycle(slots.find((s) => s.role === '"style"')!, text, 1)![0]!.replacement).toBe("thick");
    expect(diagramsSourceSlotCycle(slots.find((s) => s.role === '"flag"')!, text, 1)![0]!.replacement).toBe("false");
  });
  it("an array of ids under one key gives every element its own slot, keyed by that array's key", () => {
    const lanes = '{\n  "nodes": [\n    { "id": "c", "label": "C", "parents": [\n      "a",\n      "b"\n    ] }\n  ]\n}';
    expect(spans(lanes, diagramsSourceSlots("lanes", "json", lanes))).toEqual(['"id":c', '"label":C', '"parents":a', '"parents":b']);
  });
});

describe("diagramsSourceSlots — every shipped preset maps to slots that cover every id", () => {
  it.each(GLYPH_DIAGRAM_WORKBENCH_PRESETS.filter((p) => !("sourceKind" in p)))("'$label' (Mermaid)", (preset) => {
    const slots = diagramsSourceSlots("graph", "mermaid", preset.source);
    const ids = new Set(slots.filter((s) => s.kind === "id").map((s) => preset.source.slice(s.start, s.end)));
    for (const node of glyphGraphFromMermaid(preset.source).nodes) expect(ids.has(node.id)).toBe(true);
  });
  it.each(GLYPH_SEQUENCE_WORKBENCH_PRESETS)("'$label' (sequence)", (preset) => {
    expect(diagramsSourceSlots("sequence", "mermaid", preset.source).length).toBeGreaterThan(3);
  });
  it.each(GLYPH_LANES_WORKBENCH_PRESETS)("'$label' (lanes)", (preset) => {
    expect(diagramsSourceSlots("lanes", preset.sourceKind, preset.source).length).toBeGreaterThan(3);
  });
});

describe("diagramsSourceRepairSlots — a broken line becomes one free slot", () => {
  const text = "flowchart LR\n  a[Alpha --> b\n  b --> c";
  const normal = diagramsSourceSlots("graph", "mermaid", text);
  it("replaces the named line's slots with one whole-line slot that accepts anything, and leaves the other lines masked", () => {
    // Mutation: keep the broken line's own slots -> the `]` the reader
    // needs is refused inside the label -> red.
    const repaired = diagramsSourceRepairSlots(normal, text, 2);
    const line2 = repaired.filter((s) => s.start >= 13 && s.end <= 28);
    expect(line2).toEqual([{ start: 13, end: 28, kind: "text", role: "repair" }]);
    expect(diagramsSourceSlotAccepts(line2[0]!, "mermaid", "]")).toBe(true);
    expect(diagramsSourceSlotSanitize(line2[0]!, "mermaid", "x]\ny")).toBe("x]\ny");
    expect(repaired.filter((s) => s.role !== "repair").map((s) => text.slice(s.start, s.end))).toEqual(["LR", "b", "-->", "c"]);
  });
  it("with no line to name, every line is a repair slot", () => {
    const all = diagramsSourceRepairSlots(normal, text, "all");
    expect(all.map((s) => s.role)).toEqual(["repair", "repair", "repair"]);
    expect(all.map((s) => text.slice(s.start, s.end))).toEqual(text.split("\n"));
  });
});

describe("slot navigation and character rules", () => {
  const text = "flowchart LR\n  a   --> b";
  const slots = diagramsSourceSlots("graph", "mermaid", text);
  it("slotAt is inclusive at both ends; nearest redirects a stray caret; step wraps", () => {
    const a = slots[1]!;
    expect(diagramsSourceSlotAt(slots, a.start)).toBe(a);
    expect(diagramsSourceSlotAt(slots, a.end)).toBe(a);
    expect(diagramsSourceSlotAt(slots, a.end + 1)).toBeUndefined(); // the spaces before the arrow
    expect(diagramsSourceSlotAt(slots, a.start, a.end + 4)).toBeUndefined(); // a selection spanning into the arrow
    expect(diagramsSourceNearestSlot(slots, a.end + 1)).toBe(a);
    expect(diagramsSourceNearestSlot(slots, slots[2]!.start - 1)).toBe(slots[2]);
    expect(diagramsSourceSlotStep(slots, a.start, 1)).toBe(slots[2]);
    expect(diagramsSourceSlotStep(slots, slots[slots.length - 1]!.start, 1)).toBe(slots[0]);
    expect(diagramsSourceSlotStep(slots, slots[0]!.start, -1)).toBe(slots[slots.length - 1]);
    expect(diagramsSourceSlotStep(slots, 0, 1)).toBe(slots[0]);
  });
  it("ids refuse spaces and brackets, labels refuse closers, JSON strings refuse raw quotes, git fields refuse pipes, cycles refuse everything", () => {
    const id = slots[1]!;
    expect(diagramsSourceSlotAccepts(id, "mermaid", "x")).toBe(true);
    expect(diagramsSourceSlotAccepts(id, "mermaid", " ")).toBe(false);
    expect(diagramsSourceSlotAccepts(id, "mermaid", "[")).toBe(false);
    expect(diagramsSourceSlotSanitize(id, "mermaid", "new node\nid!")).toBe("newnodeid");
    const label = diagramsSourceSlots("graph", "mermaid", "flowchart LR\n  a[x]").find((s) => s.role === "label")!;
    expect(diagramsSourceSlotAccepts(label, "mermaid", "]")).toBe(false);
    expect(diagramsSourceSlotAccepts(label, "mermaid", " ")).toBe(true);
    const json = diagramsSourceSlots("graph", "json", '{ "label": "x" }')[0]!;
    expect(diagramsSourceSlotAccepts(json, "json", '"')).toBe(false);
    expect(diagramsSourceSlotSanitize(json, "json", 'say "hi"\nthere')).toBe("say hi there");
    const subject = diagramsSourceSlots("lanes", "gitlog", "a|||S").find((s) => s.role === "subject")!;
    expect(diagramsSourceSlotAccepts(subject, "gitlog", "|")).toBe(false);
    expect(diagramsSourceSlotAccepts(slots[0]!, "mermaid", "L")).toBe(false);
  });
});
