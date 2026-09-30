import { describe, expect, it } from "vitest";
import { glyphDiagramRepairHint } from "@glyphcss/diagrams";
import { glyphLaneDagRepairHint } from "@glyphcss/diagrams/lanes";
import { glyphSequenceRepairHint } from "@glyphcss/diagrams/sequence";
import { locateDiagramsSourceError } from "./diagramsSourceErrors";
import { buildGlyphDiagramsWorkbenchGraph, buildGlyphDiagramsWorkbenchLanes, buildGlyphDiagramsWorkbenchSequence, createGlyphDiagramsWorkbenchState, reduceGlyphDiagramsWorkbenchState, type GlyphDiagramsFormId } from "./diagramsWorkbenchState";
import { renderGlyphDiagramsWorkbenchState } from "../render/diagramsWorkbenchRender";
import type { DiagramsSourceDialect } from "./diagramsSourceTokens";

/** The REAL failure for a source, exactly as the page's render wrapper shapes it (`code: glyphcss: code: message`). */
function realFailure(form: GlyphDiagramsFormId, dialect: DiagramsSourceDialect, source: string) {
  let state = createGlyphDiagramsWorkbenchState();
  if (form === "graph") {
    state = reduceGlyphDiagramsWorkbenchState(state, { type: "set-editor", editor: dialect as "mermaid" | "json" });
    state = reduceGlyphDiagramsWorkbenchState(state, { type: "edit-source", value: source });
  } else if (form === "sequence") {
    state = reduceGlyphDiagramsWorkbenchState(state, { type: "set-form", form });
    state = reduceGlyphDiagramsWorkbenchState(state, { type: "set-sequence-editor", editor: dialect as "mermaid" | "json" });
    state = reduceGlyphDiagramsWorkbenchState(state, { type: "edit-sequence-source", value: source });
  } else {
    state = reduceGlyphDiagramsWorkbenchState(state, { type: "set-form", form });
    state = reduceGlyphDiagramsWorkbenchState(state, { type: "set-lanes-editor", editor: dialect as "gitlog" | "json" });
    state = reduceGlyphDiagramsWorkbenchState(state, { type: "edit-lanes-source", value: source });
  }
  const build = form === "graph" ? buildGlyphDiagramsWorkbenchGraph : form === "sequence" ? buildGlyphDiagramsWorkbenchSequence : buildGlyphDiagramsWorkbenchLanes;
  try { build(state); }
  catch (error) {
    const failure = error as Error & { code?: string };
    return { error: failure.code ? `${failure.code}: ${failure.message}` : failure.message, code: failure.code };
  }
  throw new Error("expected the source to fail");
}

describe("locateDiagramsSourceError — message and hint", () => {
  it("strips the stacked `code: glyphcss: code:` prefixes and attaches the library's own repair hint for the code", () => {
    const failure = realFailure("graph", "mermaid", "flowchart LR\n  a[Alpha --> b");
    const diagnostic = locateDiagramsSourceError("graph", "mermaid", "flowchart LR\n  a[Alpha --> b", failure);
    expect(diagnostic.code).toBe("GLYPH_MERMAID_SYNTAX");
    expect(diagnostic.message).not.toContain("glyphcss:");
    expect(diagnostic.message).not.toMatch(/^GLYPH_MERMAID_SYNTAX/);
    expect(diagnostic.hint).toBe(glyphDiagramRepairHint("GLYPH_MERMAID_SYNTAX"));
  });
  it("reads each form's OWN hint table, never the graph one", () => {
    expect(locateDiagramsSourceError("sequence", "json", "{}", { error: "bad-sequence: x", code: "bad-sequence" }).hint).toBe(glyphSequenceRepairHint("bad-sequence"));
    expect(locateDiagramsSourceError("lanes", "json", "{}", { error: "bad-lane-dag: x", code: "bad-lane-dag" }).hint).toBe(glyphLaneDagRepairHint("bad-lane-dag"));
  });
  it("a failure with no code carries no hint (nothing to invent one from)", () => {
    expect(locateDiagramsSourceError("graph", "mermaid", "x", { error: "boom" })).toEqual({ code: undefined, message: "boom", hint: undefined, line: undefined });
  });
});

describe("locateDiagramsSourceError — placing the error on a line", () => {
  it("Mermaid: an unclosed shape (a positionless `Unclosed …` from the statement splitter) lands on the first unbalanced line", () => {
    // Mutation: drop the `mermaidUnbalancedLine` rule -> the message quotes
    // nothing, so `line` is undefined -> red.
    const source = "flowchart LR\n  a[Alpha] --> b[Beta]\n  b --> c[Broken\n  c --> a";
    const failure = realFailure("graph", "mermaid", source);
    expect(failure.error).toContain("Unclosed");
    expect(locateDiagramsSourceError("graph", "mermaid", source, failure).line).toBe(3);
  });
  it("Mermaid: a stray closer (`near \"]\"`) lands on the line that ENDS with it, past an earlier asymmetric `>…]` shape that merely contains one", () => {
    // Mutation: drop `matchingLines`' ends-with preference -> line 2 -> red.
    const source = "flowchart LR\n  a>Asym] --> b\n  b --> c]\n  c --> d";
    const failure = realFailure("graph", "mermaid", source);
    expect(failure.error).toContain('near "]"');
    expect(locateDiagramsSourceError("graph", "mermaid", source, failure).line).toBe(3);
  });
  it("Mermaid: the splitter's positionless `Unmatched` closer lands on the first line whose brackets go negative", () => {
    const source = "flowchart LR\n  a>Asym] --> b\n  b --> c\n  c --> d)";
    expect(locateDiagramsSourceError("graph", "mermaid", source, { error: 'GLYPH_MERMAID_SYNTAX: Unmatched ")" in Mermaid source.', code: "GLYPH_MERMAID_SYNTAX" }).line).toBe(4);
  });
  it("Mermaid: an HTML `<p>` inside an earlier label never reads as an asymmetric opener (seen live on the LangGraph preset)", () => {
    // Mutation: drop the `depth === 0` guard on the `>` opener -> line 3 -> red.
    const source = "graph TD;\n  x\n  __start__([<p>__start__</p>]):::first\n  agent(agent\n  tools(tools)";
    expect(locateDiagramsSourceError("graph", "mermaid", source, realFailure("graph", "mermaid", source)).line).toBe(4);
  });
  it("Mermaid: an unclosed quoted label lands on its line", () => {
    const source = 'flowchart LR\n  a["Alpha"] --> b\n  b --> c["Broken]\n  c --> d';
    expect(locateDiagramsSourceError("graph", "mermaid", source, realFailure("graph", "mermaid", source)).line).toBe(3);
  });
  it("Mermaid: an unsupported edge operator lands on its statement", () => {
    const source = "flowchart TB\n  a --> b\n  b ~~> c";
    expect(locateDiagramsSourceError("graph", "mermaid", source, realFailure("graph", "mermaid", source)).line).toBe(3);
  });
  it("Mermaid: an unsupported diagram kind lands on the declaration line, past comments and blank lines", () => {
    const source = "%% a comment\n\nclassDiagram\n  A <|-- B";
    const failure = realFailure("graph", "mermaid", source);
    expect(failure.code).toMatch(/^GLYPH_MERMAID_UNSUPPORTED_/);
    expect(locateDiagramsSourceError("graph", "mermaid", source, failure).line).toBe(3);
  });
  it("Mermaid: an unclosed subgraph lands on the `subgraph` line", () => {
    const source = "flowchart LR\n  a --> b\n  subgraph crew[Crew]\n    b --> c";
    expect(locateDiagramsSourceError("graph", "mermaid", source, realFailure("graph", "mermaid", source)).line).toBe(3);
  });
  it("sequence Mermaid: an unrecognised statement lands on its line", () => {
    const source = "sequenceDiagram\n  participant A\n  A => B: nope\n  A->>B: ok";
    expect(locateDiagramsSourceError("sequence", "mermaid", source, realFailure("sequence", "mermaid", source)).line).toBe(3);
  });
  it("JSON: a syntax error lands on the line the parser's character offset names, for every form's own BAD_JSON code", () => {
    const source = '{\n  "nodes": [\n    { "id": "a", "label": "A" }\n    { "id": "b", "label": "B" }\n  ]\n}';
    const graph = realFailure("graph", "json", source);
    expect(graph.code).toBe("GLYPH_DIAGRAM_BAD_JSON");
    expect(locateDiagramsSourceError("graph", "json", source, graph).line).toBe(4);
    const lanes = realFailure("lanes", "json", source);
    expect(lanes.code).toBe("GLYPH_LANE_BAD_JSON");
    expect(locateDiagramsSourceError("lanes", "json", source, lanes).line).toBe(4);
    expect(locateDiagramsSourceError("sequence", "json", source, realFailure("sequence", "json", source)).line).toBe(4);
  });
  it("JSON: a syntax message in the `line L column C` form is read directly", () => {
    expect(locateDiagramsSourceError("graph", "json", "{\n\n}", { error: "GLYPH_DIAGRAM_BAD_JSON: Invalid JSON: Unexpected token (line 2 column 1)", code: "GLYPH_DIAGRAM_BAD_JSON" }).line).toBe(2);
  });
  it("JSON: an unknown node referenced by an edge lands on the REFERENCE, not on a node that merely shares the other endpoint", () => {
    // Mutation: pick the first fragment instead of the one with the fewest
    // matching lines -> "a" (declared on line 3, referenced on line 7)
    // wins over "zzz" (referenced on line 8 only) -> line 3 -> red.
    const source = '{\n  "nodes": [\n    { "id": "a", "label": "A" }\n  ],\n  "edges": [\n    {\n      "from": "a",\n      "to": "zzz"\n    }\n  ],\n  "direction": "TB"\n}';
    const failure = realFailure("graph", "json", source);
    expect(failure.code).toBe("unknown-node");
    expect(locateDiagramsSourceError("graph", "json", source, failure).line).toBe(8);
  });
  it("JSON: a duplicate node id lands on the SECOND `\"id\"` declaration, past an edge that references the first", () => {
    // Mutation: drop the duplicate-code second-occurrence rule -> line 3 -> red.
    const source = '{\n  "nodes": [\n    { "id": "a", "label": "A" },\n    { "id": "b", "label": "B" },\n    { "id": "a", "label": "Again" }\n  ],\n  "edges": [ { "from": "a", "to": "b" } ],\n  "direction": "TB"\n}';
    const failure = realFailure("graph", "json", source);
    expect(failure.code).toBe("duplicate-node-id");
    expect(locateDiagramsSourceError("graph", "json", source, failure).line).toBe(5);
  });
  it("lanes JSON: an unknown parent lands on the line naming it", () => {
    const source = '{\n  "nodes": [\n    { "id": "b", "label": "B", "parents": ["a"] },\n    { "id": "a", "label": "A", "parents": ["ghost"] }\n  ]\n}';
    const failure = realFailure("lanes", "json", source);
    expect(failure.code).toBe("unknown-parent");
    expect(locateDiagramsSourceError("lanes", "json", source, failure).line).toBe(4);
  });
  it("git log: a malformed line lands on itself", () => {
    const source = "b|a||Second\nthis line has no pipes\na|||First";
    const failure = realFailure("lanes", "gitlog", source);
    expect(failure.code).toBe("GLYPH_LANE_GIT_SYNTAX");
    expect(locateDiagramsSourceError("lanes", "gitlog", source, failure).line).toBe(2);
  });
  it("Mermaid: an edge naming an unknown node (`a -> b` in the message, `a --> b` in the source) lands on the edge via word co-occurrence", () => {
    // The Mermaid adapter auto-declares nodes, so this failure shape comes
    // from the JSON path; the LOCATOR is dialect-agnostic on purpose (the
    // same message can arrive with the Mermaid tab showing).
    const source = "flowchart LR\n  a --> b\n  q --> zz";
    expect(locateDiagramsSourceError("graph", "mermaid", source, { error: 'unknown-node: Edge "q -> zz" references an unknown node.', code: "unknown-node" }).line).toBe(3);
  });
});

describe("locateDiagramsSourceError — saying `unknown` rather than inventing a position", () => {
  it("a positionless layout failure (unroutable) reports no line even though its message quotes ids", () => {
    const source = "flowchart LR\n  a --> b";
    expect(locateDiagramsSourceError("graph", "mermaid", source, { error: 'GLYPH_DIAGRAM_UNROUTABLE: Edge "a -> b" has no legal lane.', code: "GLYPH_DIAGRAM_UNROUTABLE" }).line).toBeUndefined();
  });
  it("a message whose quoted fragments occur nowhere in the current draft reports no line", () => {
    expect(locateDiagramsSourceError("graph", "mermaid", "flowchart LR\n  a --> b", { error: 'unknown-node: Node "nope" references unknown group "g".', code: "unknown-group" }).line).toBeUndefined();
  });
  it("a JSON syntax message with no offset reports no line", () => {
    expect(locateDiagramsSourceError("graph", "json", "{", { error: "GLYPH_DIAGRAM_BAD_JSON: Invalid JSON: Unexpected end of input", code: "GLYPH_DIAGRAM_BAD_JSON" }).line).toBeUndefined();
  });
  it("the page's own render wrapper produces exactly the input shape this locator reads", async () => {
    let state = reduceGlyphDiagramsWorkbenchState(createGlyphDiagramsWorkbenchState(), { type: "edit-source", value: "flowchart LR\n  a[Alpha --> b" });
    const rendered = await renderGlyphDiagramsWorkbenchState(state);
    expect(rendered.ok).toBe(false);
    if (rendered.ok) return;
    expect(locateDiagramsSourceError("graph", "mermaid", state.mermaid, rendered)).toMatchObject({ code: "GLYPH_MERMAID_SYNTAX", line: 2 });
    state = reduceGlyphDiagramsWorkbenchState(state, { type: "edit-source", value: "flowchart LR\n  a[Alpha] --> b" });
    expect((await renderGlyphDiagramsWorkbenchState(state)).ok).toBe(true);
  });
});
