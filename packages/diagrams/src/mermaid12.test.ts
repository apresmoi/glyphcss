import { describe, expect, it } from "vitest";
import examples from "../fixtures/mermaid-12.json";
import { glyphParseMermaid } from "./mermaid";
import { glyphSequenceFromMermaid, glyphSequenceMermaidNotes } from "./sequence/mermaid";
import { renderGlyphSequence } from "./sequence/render";
import { renderGlyphDiagram } from "./render";

it.each(examples)("accepts previously rejected Mermaid 12.2 doc example: $name", ({ source, type }) => {
  const result = type === "sequenceDiagram" ? glyphSequenceFromMermaid(source) : glyphParseMermaid(source).graph;
  expect(type === "sequenceDiagram" ? "messages" in result : "nodes" in result).toBe(true);
});

it("keeps sequence frontmatter/config inert and logs it for source and parsed IR renders", async () => {
  const body = "sequenceDiagram\nA->>B: hi";
  const source = `\uFEFF---\r\nconfig:\r\n  theme: dark\r\n---\r\n%%{init: {\n  "theme": "forest"\n}}%%\n${body}`;
  const parsed = glyphSequenceFromMermaid(source);
  expect(parsed.messages).toEqual(glyphSequenceFromMermaid(body).messages);
  for (const input of [source, parsed]) {
    const result = await renderGlyphSequence(input, { target: "chat" });
    expect(result.text).toBe((await renderGlyphSequence(body, { target: "chat" })).text);
    expect(result.report.ledger.filter(n => ["frontmatter", "configuration"].includes(String(n.detail?.kind)))).toHaveLength(2);
  }
});

it.each(["boundary", "control", "entity", "database", "collections", "queue"])("retains %s participant metadata, hyphenated ids, aliases and fallback notes", (type) => {
  const s = glyphSequenceFromMermaid(`sequenceDiagram\nparticipant API-gw @{"type":"${type}","alias":"Inline"} as Public API\nactor DB@{"type":"database","alias":"User Database"}\nAPI-gw-->>DB: hello`);
  expect(s.participants).toEqual([{ id: "API-gw", label: "Public API", kind: type }, { id: "DB", label: "User Database", kind: "database" }]);
  expect(s.messages).toEqual([{ from: "API-gw", to: "DB", label: "hello", style: "dashed" }]);
  expect(glyphSequenceMermaidNotes(s)).toEqual([expect.objectContaining({ code: "mermaid-degraded", detail: expect.objectContaining({ kind: "participant-type" }) })]);
});

it("create/destroy retain aliases, actor shape, order and full lifelines with a note", async () => {
  const s = glyphSequenceFromMermaid("sequenceDiagram\nparticipant A\ncreate actor B as Bee\nA->>B: hello\ndestroy B\nB-->>A: bye");
  expect(s.participants).toEqual([{ id: "A", label: "A" }, { id: "B", label: "Bee", shape: "actor" }]);
  expect(s.messages).toHaveLength(2);
  expect((await renderGlyphSequence(s)).report.ledger).toContainEqual(expect.objectContaining({ detail: expect.objectContaining({ kind: "participant-lifetime" }) }));
});

// Both reverse bottom variants have the same spelling in upstream's table.
const halfArrows = ["-|\\", "--|\\", "-|/", "--|/", "/|-", "/|--", "\\\\-", "\\\\--", "-\\\\", "--\\\\", "-//", "--//", "//-", "//--"];
it.each(halfArrows)("normalizes half arrow %s with direction and dash style intact", (op) => {
  const s = glyphSequenceFromMermaid(`sequenceDiagram\nA${op}B: signal`);
  const reverse = op.startsWith("/") || op.startsWith("\\");
  expect(s.participants.map(p => p.id)).toEqual(["A", "B"]);
  expect(s.messages).toEqual([{ from: reverse ? "B" : "A", to: reverse ? "A" : "B", label: "signal", style: op.includes("--") ? "dashed" : "solid" }]);
  expect(glyphSequenceMermaidNotes(s)[0]?.detail?.kind).toBe("half-arrows");
});

it.each(["A->>()B", "A()->>B", "A()->>()B"])("attaches central connection %s to existing lifelines and logs it", (arrow) => {
  const s = glyphSequenceFromMermaid(`sequenceDiagram\n${arrow}: hi`);
  expect(s.messages).toEqual([{ from: "A", to: "B", label: "hi", style: "solid" }]);
  expect(glyphSequenceMermaidNotes(s)[0]?.detail?.kind).toBe("central-connections");
});

it.each([["10 2", ["10. one", "12. two"]], ["5", ["5. one", "6. two"]], ["0 3", ["0. one", "3. two"]]] as const)("autonumber %s keeps the start and step", (args, labels) => {
  expect(glyphSequenceFromMermaid(`sequenceDiagram\nautonumber ${args}\nA->>B: one\nB-->>A: two`).messages.map(m => m.label)).toEqual(labels);
});

it.each(['link A: Dashboard @ https://example.test', 'links A: {"Dashboard":"https://example.test"}'])("keeps %s inert and logs the omission", async (menu) => {
  const base = "sequenceDiagram\nparticipant A\nparticipant B\nA->>B: hello";
  const result = await renderGlyphSequence(base.replace("A->>B:", `${menu}\nA->>B:`));
  expect(result.text).toBe((await renderGlyphSequence(base)).text);
  expect(result.html).not.toContain("https://");
  expect(result.report.ledger).toContainEqual(expect.objectContaining({ detail: expect.objectContaining({ kind: "actor-menus" }) }));
});

it("duplicate git ids keep every commit and valid ancestry without collisions", () => {
  const source = 'gitGraph\ncommit id:"same"\ncommit id:"same"\ncommit id:"tail"';
  const { graph, lanes, notes } = glyphParseMermaid(source);
  const nodes = lanes!.dag.nodes;
  expect(nodes).toHaveLength(3);
  expect(new Set(nodes.map(n => n.id)).size).toBe(3);
  expect(nodes[0]!.parents).toEqual([nodes[1]!.id]);
  expect(nodes[1]!.parents).toEqual(["same"]);
  expect(nodes[1]!.marks).toContain("id: same");
  expect(graph.nodes.map(n => n.label).join(" ")).toContain("id: same");
  expect(glyphParseMermaid(source).lanes!.dag).toEqual(lanes!.dag);
  expect(notes.some(n => n.detail?.kind === "git-duplicate-id")).toBe(true);
});

it.each(["o{--||", "o{ -- ||", "o{ .. ||"])("ER left %s and endpoint classes keep zero-many/one heads with classes inert", (relation) => {
  const { graph } = glyphParseMermaid(`erDiagram\nPERSON:::foo ${relation} HOUSE:::bar : has`);
  expect(graph.nodes.map(n => n.id)).toEqual(["PERSON", "HOUSE"]);
  expect(graph.edges).toMatchObject([{ from: "PERSON", to: "HOUSE", startHead: "er-zero-many", endHead: "er-one", label: "has", style: relation.includes("..") ? "dotted" : "solid" }]);
});

it.each(["chat", "web"] as const)("closing br has the same %s render as br for node, edge, state and class labels", async target => {
  for (const source of ['flowchart LR\nA["one<br>two"] -->|three<br>four| B', 'stateDiagram-v2\nA: one<br>two\nA --> B: three<br>four', 'classDiagram\nclass A {\n +one<br>two\n}']) {
    const options = { target, width: 72, height: 24, color: "none" as const };
    const expected = await renderGlyphDiagram(source, options);
    expect(expected.text).not.toContain("<br>");
    expect((await renderGlyphDiagram(source.replace(/<br>/g, "</br>"), options)).text).toBe(expected.text);
  }
});

it("accepts scalar YAML participant metadata, including quoted commas and multiline fields", () => {
  const s = glyphSequenceFromMermaid(`sequenceDiagram
participant A @{
type: database
alias: 'Store, primary'
}
participant B @{type: boundary, alias: "Public API"}
A->>B: hi`);
  expect(s.participants).toEqual([{ id: "A", label: "Store, primary", kind: "database" }, { id: "B", label: "Public API", kind: "boundary" }]);
  expect(() => glyphSequenceFromMermaid('sequenceDiagram\nparticipant A @{type: database')).toThrow(expect.objectContaining({ code: "GLYPH_SEQUENCE_MERMAID_SYNTAX" }));
});

it("git references to repeated ids resolve to their latest occurrence", () => {
  const source = 'gitGraph\ncommit id:"base"\nbranch left\ncommit id:"same"\ncheckout main\nbranch right\ncommit id:"same"';
  const latest = glyphParseMermaid(source).lanes!.dag.nodes[0]!.id;
  expect(latest).not.toBe("same");
  const picked = glyphParseMermaid(`${source}\ncheckout main\ncherry-pick id:"same"`).lanes!.dag.nodes[0]!;
  expect(picked.marks).toContain(`cherry-pick: ${latest}`);
  expect(picked.parents).toEqual(["base"]);
});
