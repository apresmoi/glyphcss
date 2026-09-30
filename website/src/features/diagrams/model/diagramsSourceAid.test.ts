import { describe, expect, it } from "vitest";
import { glyphGraphFromMermaid, glyphGraphFromJson, GLYPH_GRAPH_NODE_SHAPES } from "@glyphcss/diagrams";
import { glyphSequenceFromMermaid, parseGlyphSequenceJson, validateGlyphSequence } from "@glyphcss/diagrams/sequence";
import { glyphLaneDagFromGitLog, parseGlyphLaneDagJson, validateGlyphLaneDag } from "@glyphcss/diagrams/lanes";
import {
  DIAGRAMS_SHAPE_CATALOGUE, diagramsSourceCompletionContext, diagramsSourceCompletions, diagramsSourceInsertion, diagramsSourceLineOfId, diagramsSourceSnippets,
} from "./diagramsSourceAid";

const apply = (text: string, caret: number, snip: ReturnType<typeof diagramsSourceSnippets>[number]) => {
  const ins = diagramsSourceInsertion(text, caret, snip, snip.body.startsWith("{") ? "json" : "mermaid");
  const next = `${text.slice(0, ins.start)}${ins.insert}${text.slice(ins.end)}`;
  return { next, selected: next.slice(ins.select[0], ins.select[1]) };
};

describe("diagramsSourceAid — the shape legend matches the renderer's own shape list", () => {
  it("covers every GlyphGraphNodeShape exactly once, and offers on the Mermaid tab only what the adapter parses", () => {
    expect([...DIAGRAMS_SHAPE_CATALOGUE.map((s) => s.shape)].sort()).toEqual([...GLYPH_GRAPH_NODE_SHAPES].sort());
    for (const entry of DIAGRAMS_SHAPE_CATALOGUE) {
      const graph = glyphGraphFromJson({ nodes: [{ id: "n", label: "L", shape: entry.shape }], edges: [], direction: "TB" });
      expect(graph.nodes[0]!.shape).toBe(entry.shape);
      if (!entry.mermaid) continue;
      // Mutation: swap a delimiter pair (say `((`/`)]`) -> the adapter
      // rejects or mis-shapes it -> red.
      const parsed = glyphGraphFromMermaid(`flowchart TB\n  n${entry.open}Label${entry.close}`);
      expect(parsed.nodes[0]).toMatchObject({ id: "n", label: "Label", shape: entry.shape });
    }
    expect(DIAGRAMS_SHAPE_CATALOGUE.find((s) => s.shape === "cylinder")!.mermaid).toBe(false);
  });
});

describe("diagramsSourceAid — every snippet inserts syntax the library accepts", () => {
  it("graph Mermaid snippets each parse when appended to a flowchart", () => {
    for (const snip of diagramsSourceSnippets("graph", "mermaid")) {
      const { next, selected } = apply("flowchart LR\n  a --> b\n", "flowchart LR\n  a --> b\n".length, snip);
      expect(() => glyphGraphFromMermaid(next.replace("member", "a"))).not.toThrow();
      expect(selected.length).toBeGreaterThan(0); // a placeholder is selected
    }
  });
  it("graph JSON snippets are each a valid node/edge/group object", () => {
    for (const snip of diagramsSourceSnippets("graph", "json")) {
      const object = JSON.parse(snip.body) as Record<string, unknown>;
      const graph = "from" in object
        ? { nodes: [{ id: "from", label: "F" }, { id: "to", label: "T" }], edges: [object], direction: "TB" }
        : "members" in object
          ? { nodes: [{ id: "member", label: "M", group: "group" }], edges: [], groups: [object], direction: "TB" }
          : { nodes: [object], edges: [], direction: "TB" };
      expect(() => glyphGraphFromJson(graph)).not.toThrow();
    }
  });
  it("sequence snippets parse on both tabs", () => {
    for (const snip of diagramsSourceSnippets("sequence", "mermaid")) {
      const base = "sequenceDiagram\n  participant from\n  participant to\n  participant id\n";
      const { next } = apply(base, base.length, snip);
      expect(() => glyphSequenceFromMermaid(next)).not.toThrow();
    }
    for (const snip of diagramsSourceSnippets("sequence", "json")) {
      const object = JSON.parse(snip.body) as Record<string, unknown>;
      const sequence = {
        participants: [{ id: "from", label: "F" }, { id: "to", label: "T" }],
        messages: [{ from: "from", to: "to" }],
        ..."kind" in object ? { frames: [object] } : "over" in object ? { notes: [object] } : "from" in object ? { messages: [object] } : {},
      };
      // The participant snippet declares `id` itself; the note snippet refers to it.
      if ("over" in object) sequence.participants.push({ id: "id", label: "I" });
      if (!("kind" in object) && !("over" in object) && !("from" in object)) sequence.participants.push(object as { id: string; label: string });
      expect(() => validateGlyphSequence(parseGlyphSequenceJson(JSON.stringify(sequence)))).not.toThrow();
    }
  });
  it("lanes snippets parse on both tabs", () => {
    for (const snip of diagramsSourceSnippets("lanes", "gitlog")) {
      const { next } = apply("", 0, snip);
      expect(() => glyphLaneDagFromGitLog(`${next}\nparent|||P\nother|||O`)).not.toThrow();
    }
    for (const snip of diagramsSourceSnippets("lanes", "json")) {
      const node = JSON.parse(snip.body) as { parents: string[] };
      const dag = { nodes: [node, { id: "parent", label: "P", parents: [] }] };
      expect(() => validateGlyphLaneDag(parseGlyphLaneDagJson(JSON.stringify(dag)))).not.toThrow();
    }
  });
});

describe("diagramsSourceInsertion — a snippet lands on its own line at the caret line's indent, placeholder selected", () => {
  const edge = diagramsSourceSnippets("graph", "mermaid").find((s) => s.id === "edge")!;
  const subgraph = diagramsSourceSnippets("graph", "mermaid").find((s) => s.id === "subgraph")!;
  it("an occupied line: after that line, wherever the caret sat in it; a blank line: in place", () => {
    // Mutation: insert at the caret instead of after the occupied line ->
    // the mid-line case splices `from --> to` into `a --> b` -> red.
    expect(apply("flowchart LR\n  a --> b", "flowchart LR\n  a --> b".length, edge)).toEqual({ next: "flowchart LR\n  a --> b\n  from --> to", selected: "from" });
    expect(apply("flowchart LR\n  a --> b\n  c", "flowchart LR\n  a -".length, edge)).toEqual({ next: "flowchart LR\n  a --> b\n  from --> to\n  c", selected: "from" });
    expect(apply("flowchart LR\n  ", "flowchart LR\n  ".length, edge)).toEqual({ next: "flowchart LR\n  from --> to", selected: "from" });
  });
  it("JSON: a new element gets its comma — after a closing line, or carried when the line already continues", () => {
    // Mutation: drop the comma rules -> `}` directly followed by `{` -> the
    // JSON below no longer parses -> red.
    const node = diagramsSourceSnippets("graph", "json").find((s) => s.id === "node-rect")!;
    const closed = '{\n  "nodes": [\n    { "id": "a", "label": "A" }\n  ],\n  "edges": []\n}';
    const afterClosed = apply(closed, closed.indexOf('"a"'), { ...node, body: node.body });
    expect(() => JSON.parse(afterClosed.next.replace(/\n/g, ""))).not.toThrow();
    expect(afterClosed.next.split("\n")[2]).toBe('    { "id": "a", "label": "A" },');
    expect(afterClosed.selected).toBe("id");
    const continuing = '{\n  "nodes": [\n    { "id": "a", "label": "A" },\n    { "id": "b", "label": "B" }\n  ],\n  "edges": []\n}';
    const afterContinuing = apply(continuing, continuing.indexOf('"a"'), node);
    expect(() => JSON.parse(afterContinuing.next)).not.toThrow();
    expect(afterContinuing.next.split("\n")[3]).toBe('    { "id": "id", "label": "Label", "shape": "rect" },');
  });
  it("a multi-line body carries the indent onto every line and the selection offsets follow", () => {
    // Mutation: drop the `breaks * indent.length` shift -> the selection
    // lands off the placeholder -> red.
    const { next, selected } = apply("flowchart LR\n    a", "flowchart LR\n    a".length, subgraph);
    expect(next).toBe("flowchart LR\n    a\n    subgraph group[Group]\n      member\n    end");
    expect(selected).toBe("group");
    const note = diagramsSourceSnippets("sequence", "mermaid").find((s) => s.id === "alt")!;
    const alt = apply("sequenceDiagram\n  x", "sequenceDiagram\n  x".length, note);
    expect(alt.selected).toBe("condition");
  });
});

describe("diagramsSourceCompletionContext — where an existing id is expected", () => {
  it("Mermaid: the id under the caret, but never a keyword or label text", () => {
    const text = "flowchart LR\n  agent --> to";
    expect(diagramsSourceCompletionContext("mermaid", text, text.length)).toEqual({ start: text.length - 2, prefix: "to" });
    expect(diagramsSourceCompletionContext("mermaid", "flowchart LR\n  a[Alp", "flowchart LR\n  a[Alp".length)).toBeNull();
    expect(diagramsSourceCompletionContext("mermaid", "flowchart LR\n  subgraph", "flowchart LR\n  subgraph".length)).toBeNull();
    expect(diagramsSourceCompletionContext("mermaid", "sequenceDiagram\n  A->>B: hel", "sequenceDiagram\n  A->>B: hel".length)).toBeNull();
    expect(diagramsSourceCompletionContext("mermaid", "sequenceDiagram\n  A->>Bo", "sequenceDiagram\n  A->>Bo".length)).toEqual({ start: "sequenceDiagram\n  A->>".length, prefix: "Bo" });
  });
  it("JSON: an unterminated string value under from/to/parents/members/group/over — not under label or id", () => {
    // Mutation: drop the key gate -> `"label": "ag` offers node ids -> red.
    expect(diagramsSourceCompletionContext("json", '{ "from": "ag', '{ "from": "ag'.length)).toEqual({ start: '{ "from": "'.length, prefix: "ag" });
    expect(diagramsSourceCompletionContext("json", '"parents": ["build", "li', '"parents": ["build", "li'.length)).toEqual({ start: '"parents": ["build", "'.length, prefix: "li" });
    expect(diagramsSourceCompletionContext("json", '{ "label": "ag', '{ "label": "ag'.length)).toBeNull();
    expect(diagramsSourceCompletionContext("json", '{ "id": "ag', '{ "id": "ag'.length)).toBeNull();
    expect(diagramsSourceCompletionContext("json", '"from": "ag"', '"from": "ag"'.length)).toBeNull(); // closed string
    expect(diagramsSourceCompletionContext("json", '  "ag', '  "ag'.length)).toEqual({ start: 3, prefix: "ag" }); // a members array continued on its own line
  });
  it("git log: only the parents field", () => {
    expect(diagramsSourceCompletionContext("gitlog", "c|a b", 5)).toEqual({ start: 4, prefix: "b" });
    expect(diagramsSourceCompletionContext("gitlog", "c", 1)).toBeNull();
    expect(diagramsSourceCompletionContext("gitlog", "c|a||Sub", 8)).toBeNull();
  });
});

describe("diagramsSourceCompletions", () => {
  const ids = [{ id: "agent", label: "Agent" }, { id: "agenda" }, { id: "tools" }, { id: "agent" }];
  it("prefix-matches case-insensitively, dedupes, and hides a lone exact match", () => {
    expect(diagramsSourceCompletions(ids, "AG").map((c) => c.id)).toEqual(["agent", "agenda"]);
    expect(diagramsSourceCompletions(ids, "agen").map((c) => c.id)).toEqual(["agent", "agenda"]);
    expect(diagramsSourceCompletions(ids, "tools")).toEqual([]); // the lone exact match is nothing to offer
    expect(diagramsSourceCompletions(ids, "agent").map((c) => c.id)).toEqual([]);
    expect(diagramsSourceCompletions(ids, "zzz")).toEqual([]);
  });
});

describe("diagramsSourceLineOfId", () => {
  it("finds the declaration line per dialect, falling back to the first mention", () => {
    expect(diagramsSourceLineOfId("mermaid", "flowchart LR\n  a --> b\n  b --> c", "b")).toBe(2);
    expect(diagramsSourceLineOfId("json", '{\n  "edges": [{ "from": "b", "to": "c" }],\n  "nodes": [\n    { "id": "b" }\n  ]\n}', "b")).toBe(4);
    expect(diagramsSourceLineOfId("gitlog", "b|a||B\na|||A", "a")).toBe(2);
    expect(diagramsSourceLineOfId("mermaid", "flowchart LR", "zzz")).toBeUndefined();
  });
});
