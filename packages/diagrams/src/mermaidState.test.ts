import { describe, expect, it } from "vitest";
import { renderGlyphDiagram } from "./render";
import { glyphGraphFromMermaid, glyphMermaidNotes } from "./mermaid";
import { glyphGraphFromMermaidState, glyphMermaidStateNotes } from "./mermaidState";
import { glyphDiagramRepairHint, GLYPH_DIAGRAM_VALIDATION_RULES } from "./validate";
import { measureGlyphGraph } from "./pipeline";

const parse = (body: string, header = "stateDiagram-v2") => glyphGraphFromMermaid(`${header}\n${body}`);
const ids = (graph: ReturnType<typeof parse>) => graph.nodes.map((n) => n.id);
const edgeList = (graph: ReturnType<typeof parse>) => graph.edges.map((e) => `${e.from}>${e.to}${e.label ? `:${e.label}` : ""}`);

describe("state diagram adapter", () => {
  it("is reached through glyphGraphFromMermaid for both headers and defaults to top-down", () => {
    // Mutation: drop the stateDiagram dispatch in glyphGraphFromMermaid -> the old UNSUPPORTED_STATEDIAGRAM rejection returns.
    for (const header of ["stateDiagram", "stateDiagram-v2"]) {
      const graph = parse("A --> B", header);
      expect(graph.direction).toBe("TB");
      expect(ids(graph)).toEqual(["A", "B"]);
    }
    expect(glyphGraphFromMermaidState("stateDiagram-v2\nA --> B")).toEqual(parse("A --> B"));
  });

  it("builds rounded states and labelled transitions, declaring states by use", () => {
    const graph = parse("A --> B\nB --> C : go now\nA --> C: skip");
    expect(graph.nodes).toEqual([{ id: "A", label: "A", shape: "rounded" }, { id: "B", label: "B", shape: "rounded" }, { id: "C", label: "C", shape: "rounded" }]);
    expect(graph.edges).toEqual([{ from: "A", to: "B", style: "solid" }, { from: "B", to: "C", label: "go now", style: "solid" }, { from: "A", to: "C", label: "skip", style: "solid" }]);
  });

  it.each([["LR", "LR"], ["TB", "TB"], ["RL", "RL"], ["BT", "BT"], ["TD", "TB"]])("honours direction %s", (word, expected) => {
    // Mutation: ignore the direction statement -> every case but TB goes red.
    expect(parse(`direction ${word}\nA --> B`).direction).toBe(expected);
  });

  it("ignores a direction inside a composite state", () => {
    expect(parse("state P {\n direction LR\n A --> B\n}").direction).toBe("TB");
  });

  it("names a state with `state \"Name\" as Id` and appends description lines to its label", () => {
    // Mutation: drop the description append -> the label loses its second row.
    const graph = parse(`state "Waiting for payment" as Pending\nPending : holds stock\nPending : 30 min limit\nPaid : done\n[*] --> Pending\nPending --> Paid`);
    const label = (id: string) => graph.nodes.find((n) => n.id === id)!.label;
    expect(label("Pending")).toBe("Waiting for payment\nholds stock\n30 min limit");
    expect(label("Paid")).toBe("Paid\ndone");
  });

  it("applies a description given before the state is otherwise mentioned", () => {
    expect(parse("A : first\nA --> B").nodes[0]!.label).toBe("A\nfirst");
  });

  it("decodes entities once and does not split on a description's entity semicolon", () => {
    expect(parse("A : a&nbsp;b &amp; c\nA --> B").nodes[0]!.label).toBe("A\na b & c");
  });

  it("splits statements on ';' outside quoted names", () => {
    const graph = parse(`state "x; y" as S; A --> S; S --> B`);
    expect(graph.nodes.find((n) => n.id === "S")!.label).toBe("x; y");
    expect(edgeList(graph)).toEqual(["A>S", "S>B"]);
  });

  it("keeps hyphenated ids whole without swallowing the arrow", () => {
    expect(edgeList(parse("in-flight-->done\nin-flight --> out-1"))).toEqual(["in-flight>done", "in-flight>out-1"]);
  });

  it("renders a self transition as a self edge", () => {
    expect(parse("A --> A : retry").edges).toEqual([{ from: "A", to: "A", label: "retry", style: "solid" }]);
  });
});

describe("state diagram start and end markers", () => {
  it("shares one start and one end node per scope across every [*] use", () => {
    // Mutation: mint a marker per use -> two starts / three ends, the id and count assertions go red.
    const graph = parse("[*] --> A\n[*] --> B\nA --> [*]\nB --> [*]\nA --> B");
    expect(ids(graph).filter((id) => id.startsWith("[*]"))).toEqual(["[*]:start", "[*]:end"]);
    expect(edgeList(graph)).toEqual(["[*]:start>A", "[*]:start>B", "A>[*]:end", "B>[*]:end", "A>B"]);
  });

  it("types the markers as one-glyph points: filled for start, ringed for end", () => {
    const graph = parse("[*] --> A\nA --> [*]");
    expect(graph.nodes.find((n) => n.id === "[*]:start")).toEqual({ id: "[*]:start", label: "●", kind: "state-start", shape: "point" });
    expect(graph.nodes.find((n) => n.id === "[*]:end")).toEqual({ id: "[*]:end", label: "◉", kind: "state-end", shape: "point" });
  });

  it("measures the ascii glyphs without folding them to '?'", () => {
    // Mutation: drop the marker table in measureGlyphGraph -> ascii yields "?" plus a label-folded ledger entry.
    const graph = parse("[*] --> A\nA --> [*]");
    const lines = (charset: "ascii" | "box") => Object.fromEntries(measureGlyphGraph(graph, { charset }).nodes.filter((n) => n.kind).map((n) => [n.id, n.lines]));
    expect(lines("ascii")).toEqual({ "[*]:start": ["*"], "[*]:end": ["@"] });
    expect(lines("box")).toEqual({ "[*]:start": ["●"], "[*]:end": ["◉"] });
    // The fold is reported like any other, once per marker, and nothing else is.
    expect(measureGlyphGraph(graph, { charset: "ascii" }).ledger.map((e) => [e.code, e.detail?.after])).toEqual([["label-folded", "*"], ["label-folded", "@"]]);
  });

  it("gives each composite its own start and end, owned by the composite", () => {
    const graph = parse("[*] --> P\nstate P {\n [*] --> X\n X --> [*]\n}\nP --> [*]");
    expect(ids(graph).sort()).toEqual(["X", "[*]:end", "[*]:end:P", "[*]:start", "[*]:start:P"].sort());
    expect(graph.groups).toEqual([{ id: "P", label: "P", members: ["[*]:start:P", "X", "[*]:end:P"] }]);
    expect(graph.nodes.find((n) => n.id === "[*]:start:P")!.group).toBe("P");
    expect(graph.nodes.find((n) => n.id === "[*]:start")!.group).toBeUndefined();
  });
});

describe("state diagram composites and choices", () => {
  it("turns a composite into a group whose members are its inner states", () => {
    const graph = parse("[*] --> Idle\nIdle --> Active\nstate Active {\n [*] --> Running\n Running --> Paused\n}");
    expect(graph.groups).toEqual([{ id: "Active", label: "Active", members: ["[*]:start:Active", "Running", "Paused"] }]);
    expect(ids(graph)).not.toContain("Active");
    expect(graph.nodes.find((n) => n.id === "Running")!.group).toBe("Active");
  });

  it("targets a composite's inner start for entering edges and its inner end for leaving ones", () => {
    // Mutation: resolve both roles to the start marker -> the leaving edge goes red.
    const graph = parse("A --> P\nP --> B\nstate P {\n [*] --> X\n X --> [*]\n}");
    expect(edgeList(graph)).toEqual(["A>[*]:start:P", "[*]:end:P>B", "[*]:start:P>X", "X>[*]:end:P"]);
  });

  it("falls back to the first and last inner state when the composite has no marker", () => {
    const graph = parse("A --> P\nP --> B\nstate P {\n X --> Y\n Y --> Z\n}");
    expect(edgeList(graph).slice(0, 2)).toEqual(["A>X", "Z>B"]);
  });

  it("resolves a reference that precedes the composite's declaration", () => {
    const graph = parse("A --> P\nstate P {\n [*] --> X\n}");
    expect(ids(graph)).not.toContain("P");
    expect(edgeList(graph)[0]).toBe("A>[*]:start:P");
  });

  it("nests composites, with the inner states belonging to both groups", () => {
    const graph = parse("state Outer {\n state Inner {\n  A --> B\n }\n C --> Inner\n}");
    const members = (id: string) => graph.groups!.find((g) => g.id === id)!.members;
    expect(members("Inner")).toEqual(["A", "B"]);
    expect(members("Outer")).toEqual(["A", "B", "C"]);
    expect(graph.nodes.find((n) => n.id === "A")!.group).toBe("Inner");
    expect(edgeList(graph)).toContain("C>A");
  });

  it("names a composite with `state \"Name\" as Id {`", () => {
    expect(parse(`state "Order is active" as Active {\n A --> B\n}`).groups![0]).toMatchObject({ id: "Active", label: "Order is active" });
  });

  it("treats a composite with no inner state as a plain state", () => {
    const graph = parse("A --> P\nstate P {\n}");
    expect(graph.groups).toBeUndefined();
    expect(graph.nodes.find((n) => n.id === "P")).toMatchObject({ label: "P", shape: "rounded" });
  });

  it.each(["state P {\n A --> B", "A --> B\n}", "state P {\n A\n}\nstate P {\n B\n}"])("rejects unbalanced or repeated composites: %j", (body) => {
    expect(() => parse(body)).toThrow(expect.objectContaining({ code: "GLYPH_MERMAID_SYNTAX" }));
  });

  it("turns <<choice>> into a diamond holding one marker glyph", () => {
    for (const source of ["state c <<choice>>", "state c [[choice]]"]) {
      const graph = parse(`${source}\nA --> c\nc --> B : yes\nc --> C : no`);
      expect(graph.nodes.find((n) => n.id === "c")).toEqual({ id: "c", label: "◆", kind: "state-choice", shape: "diamond" });
    }
  });
});

describe("state diagram inert and rejected constructs", () => {
  it("accepts comments, classDef, class, style and ':::' as inert data", () => {
    const graph = parse(`%% a comment\nclassDef bad fill:#f00\nA:::bad --> B\nclass B bad\nstyle A fill:#fff\naccTitle: x\nA --> B`);
    expect(ids(graph)).toEqual(["A", "B"]);
    expect(edgeList(graph)).toEqual(["A>B", "A>B"]);
  });

  it.each([
    ["GLYPH_MERMAID_STATE_NOTE", "A\nnote right of A\nunclosed"],
    ["GLYPH_MERMAID_STATE_NOTE", 'floating note "x" as N'],
    ["GLYPH_MERMAID_STATE_CONCURRENCY", "A\n--\nB"],
  ])("rejects malformed constructs by name: %s", (code, body) => {
    expect(() => parse(body)).toThrow(expect.objectContaining({ code }));
    expect(GLYPH_DIAGRAM_VALIDATION_RULES).toContain(code);
    expect(glyphDiagramRepairHint(code)).not.toMatch(/^Check the graph/);
  });

  it.each(["", "stateDiagram-v2\nA ~~ B", "stateDiagram-v2\nA --> ", "stateDiagram-v2\nstate \"unclosed as X", "stateDiagram-v2\nstate"])("rejects malformed source %j with a syntax rule", (source) => {
    expect(() => glyphGraphFromMermaid(source)).toThrow(expect.objectContaining({ code: "GLYPH_MERMAID_SYNTAX" }));
  });
});

describe("state diagram edge cases", () => {
  it("degrades composite self transitions to exit-to-entry links with a ledger note", () => {
    const body = "state P {\n X --> Y\n}\nP --> P : restart";
    expect(edgeList(parse(body))).toEqual(["X>Y", "Y>X:restart"]);
    expect(glyphMermaidNotes(`stateDiagram-v2\n${body}`).some(n => n.detail?.kind === "state-composite-loop")).toBe(true);
    expect(parse("A --> A : again").edges).toHaveLength(1);
    expect(parse("P --> P\nstate P {\n}").edges).toEqual([{ from: "P", to: "P", style: "solid" }]);
  });

  it.each(["hide empty description", "scale 350 width", "scale 2"])("accepts %j as inert source", (statement) => {
    // Mutation: drop the inert pattern -> GLYPH_MERMAID_SYNTAX.
    expect(ids(parse(`${statement}\nA --> B`))).toEqual(["A", "B"]);
  });

  it("drops a trailing %% comment from a statement", () => {
    // Mutation: only recognise a comment at the start of a statement -> the comment becomes label text or a syntax error.
    const graph = parse("A --> B %% why\nB --> C : go %% there\nstate P { %% open\n X --> Y\n}");
    expect(edgeList(graph)).toEqual(["A>B", "B>C:go", "X>Y"]);
  });

  it("accepts a multi-line init directive before the header, as the flowchart adapter does", () => {
    // Mutation: stop at the first line of the directive -> its later lines parse as statements.
    const graph = glyphGraphFromMermaid("%%{init: {\n  'theme': 'dark',\n  'themeVariables': {}\n}}%%\nstateDiagram-v2\n  A --> B");
    expect(ids(graph)).toEqual(["A", "B"]);
    expect(() => glyphGraphFromMermaid("stateDiagram-v2\n%%{init: {\nA --> B")).toThrow(expect.objectContaining({ code: "GLYPH_MERMAID_SYNTAX" }));
  });

  it("keeps everything after a transition's colon as its label, semicolons included", () => {
    // Mutation: split on ';' inside a transition label -> state "y" appears and the label is cut to "x".
    const graph = parse("A --> B : x; y\nB --> C : p ; q ; r");
    expect(ids(graph)).toEqual(["A", "B", "C"]);
    expect(edgeList(graph)).toEqual(["A>B:x; y", "B>C:p ; q ; r"]);
    // Statements without a transition label still split.
    expect(edgeList(parse("A --> B; B --> C"))).toEqual(["A>B", "B>C"]);
  });

  it.each(["state --> A", "A --> end", "end --> A", "direction --> B"])("rejects the keyword used as a state in %j", (body) => {
    // Mutation: drop the endpoint keyword check -> a state named "state"/"end" is created.
    expect(() => parse(body)).toThrow(expect.objectContaining({ code: "GLYPH_MERMAID_SYNTAX" }));
  });

  it("parses a choice declared with a quoted name", () => {
    // Mutation: drop the optional `"name" as` from the stereotype pattern -> the line is a syntax error.
    const graph = parse(`state "Decide" as c <<choice>>\nA --> c\nc --> B : yes`);
    expect(graph.nodes.find((n) => n.id === "c")).toMatchObject({ shape: "diamond", kind: "state-choice" });
    expect(parse(`state "Split" as f <<fork>>`).nodes[0]).toMatchObject({ label: "Split\n[fork]", shape: "rounded", kind: "state-fork" });
  });
});

describe("composites named or described separately from their body", () => {
  it.each([
    ["a quoted name", 'stateDiagram-v2\nstate P {\n}\nstate "Working" as P\n[*] --> P'],
    ["a description", 'stateDiagram-v2\nstate P {\n}\nP : Working\n[*] --> P'],
    ["a name before the body", 'stateDiagram-v2\nstate "Working" as P\nstate P {\n}\n[*] --> P'],
  ])("turns an empty composite followed by %s into one ordinary state", (_how, source) => {
    // Mutation: append the composite to the node order a second time (drop the `created.includes` guard in state()) -> duplicate-node-id.
    const graph = glyphGraphFromMermaid(source);
    const p = graph.nodes.filter((n) => n.id === "P");
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ shape: "rounded" });
    expect(p[0]!.label.split("\n")[0] === "Working" || p[0]!.label === "P\nWorking").toBe(true);
    expect(graph.edges).toEqual([{ from: "[*]:start", to: "P", style: "solid" }]);
  });

  it.each([
    ["before the body", "stateDiagram-v2\nP : Working\nstate P {\n  A --> B\n}"],
    ["after the body", "stateDiagram-v2\nstate P {\n  A --> B\n}\nP : Working"],
  ])("keeps a composite's description in its label, %s", (_when, source) => {
    // Mutation: label the group from its name alone -> "Working" is lost.
    expect(glyphGraphFromMermaid(source).groups).toEqual([{ id: "P", label: "P - Working", members: ["A", "B"] }]);
  });

  it("puts a quoted name first and every description after it, joined by an ASCII hyphen", () => {
    const graph = glyphGraphFromMermaid('stateDiagram-v2\nstate "Working" as P\nP : first\nP : second\nstate P {\n  A --> B\n}');
    expect(graph.groups![0]!.label).toBe("Working - first - second");
  });
});

describe("a state id used inside a second composite", () => {
  const SOURCE = "stateDiagram-v2\nstate P {\n  A --> B\n}\nstate Q {\n  C --> A\n}";
  it("is the same state, and the render's ledger says so", async () => {
    // Mutation: drop the notes from renderGlyphDiagram's ledger -> no state-shared entry.
    const r = await renderGlyphDiagram(SOURCE, { target: "chat", width: 72, height: 40, autoDirection: false });
    const note = r.report.ledger.find((e) => e.code === "state-shared");
    expect(note).toMatchObject({ detail: { id: "A", owner: "P", scope: "Q" } });
    expect(r.meta.nodes.find((n) => n.id === "A")).toMatchObject({ group: "P" });
  });

  it("says nothing for an id used in its own composite, a nested one, or at the top level", async () => {
    const quiet = await renderGlyphDiagram("stateDiagram-v2\nstate P {\n  A --> B\n  state R {\n    A --> C\n  }\n}\nA --> Z", { target: "chat", width: 72, height: 40, autoDirection: false });
    expect(quiet.report.ledger.map((e) => e.code)).not.toContain("state-shared");
  });

  it("reports an id once per composite it is reused in, however often it is used there", () => {
    // Mutation: drop the once-per-composite guard -> one note per use.
    const notes = glyphMermaidStateNotes("stateDiagram-v2\nstate P {\n  A --> B\n}\nstate Q {\n  C --> A\n  A --> C\n}");
    expect(notes.map((e) => e.detail)).toEqual([{ id: "A", owner: "P", scope: "Q" }]);
    expect(glyphMermaidNotes("flowchart TB\nA --> B")).toEqual([]);
  });
});

describe("quotes outside a state name are ordinary characters", () => {
  const edges = (body: string) => glyphGraphFromMermaid(`stateDiagram-v2\n${body}`).edges.map((e) => `${e.from}>${e.to}:${e.label ?? ""}`);

  it("keeps an inch mark in a transition label, line after line", () => {
    // Mutation: open a quote at any `"` -> the first line swallows the second, or an unmatched mark throws.
    expect(edges('A --> B : 5" pipe\nB --> C : 6" pipe')).toEqual(['A>B:5" pipe', 'B>C:6" pipe']);
    expect(edges('A --> B : 5" pipe')).toEqual(['A>B:5" pipe']);
  });

  it("keeps quotes in a label whole instead of unquoting it", () => {
    // Mutation: unquote a label that starts and ends with quotes (drop `literalQuotes`) -> the quotes vanish.
    expect(edges('A --> B : "yes"')).toEqual(['A>B:"yes"']);
    expect(edges('A --> B : say "hi"; later')).toEqual(['A>B:say "hi"; later']);
  });

  it("keeps quotes in a description", () => {
    const graph = glyphGraphFromMermaid('stateDiagram-v2\nA : 5" pipe\nA : "quoted"\nA --> B');
    expect(graph.nodes[0]!.label).toBe('A\n5" pipe\n"quoted"');
  });

  it("still reads a quoted name, with a semicolon and a colon inside it, for a state and a composite", () => {
    const graph = glyphGraphFromMermaid('stateDiagram-v2\nstate "One; two: three" as S\nstate "Big; one" as P {\n  A --> B\n}\nS --> A');
    expect(graph.nodes.find((n) => n.id === "S")!.label).toBe("One; two: three");
    expect(graph.groups![0]!.label).toBe("Big; one");
  });

  it("ends an unclosed name at its line, naming the problem, whatever follows", () => {
    // Mutation: let a quote run across lines -> the later quote closes it and the error names an unsupported statement instead.
    expect(() => glyphGraphFromMermaid('stateDiagram-v2\nstate "x\nA --> B : 5"')).toThrow(/Unclosed quoted state name/);
    expect(() => glyphGraphFromMermaid('stateDiagram-v2\nstate "x')).toThrow(/Unclosed quoted state name/);
  });

  it("does not let a quote in one line hide a comment or a separator in the next", () => {
    expect(edges('A --> B : 5" pipe\n%% a comment\nC --> D')).toEqual(['A>B:5" pipe', "C>D:"]);
  });
});

describe("saying something about an id never changes who holds it", () => {
  const ROOT = "stateDiagram-v2\nstate P {\n  A\n}\n";
  it.each([
    ["a name", 'state "Other" as P'],
    ["a description", "P : more"],
    ["a bare mention", "P"],
    ["a class suffix", "P:::hot"],
  ])("a composite given %s inside another composite stays out of it", (_what, inner) => {
    // Mutation: write a composite's metadata through the ordinary state record (`state()` instead of `meta()`) -> it joins the other composite, which then looks non-empty and has no members.
    const graph = glyphGraphFromMermaid(`${ROOT}state Q {\n  ${inner}\n}\nQ --> Z`);
    expect(graph.groups!.map((g) => g.id)).toEqual(["P"]);
    expect(graph.nodes.find((n) => n.id === "Q")).toMatchObject({ shape: "rounded" });
    expect(graph.edges).toEqual([{ from: "Q", to: "Z", style: "solid" }]);
  });

  it("names the composite, wherever the naming statement stands", () => {
    expect(glyphGraphFromMermaid(`${ROOT}state Q {\n  state "Other" as P\n}`).groups![0]!.label).toBe("Other");
  });

  it("keeps a composite named before its declaration out of the scope that named it", () => {
    // Mutation: leave the placeholder in the scope that named it -> Q lists P, looks non-empty, and its group has no members.
    const graph = glyphGraphFromMermaid('stateDiagram-v2\nstate Q {\n  state "Other" as P\n}\nstate P {\n  A\n}\nQ --> Z');
    expect(graph.groups!.map((g) => g.id)).toEqual(["P"]);
    expect(graph.nodes.map((n) => n.id).sort()).toEqual(["A", "Q", "Z"]);
  });

  it.each([
    ["a choice stereotype", "state A <<choice>>"],
    ["a description", "A : more"],
    ["a bare mention", "A"],
    ["a class suffix", "A:::hot"],
    ["a name", 'state "Other" as A'],
  ])("%s on a state held by another composite leaves it there", (_what, inner) => {
    const graph = glyphGraphFromMermaid(`${ROOT}state Q {\n  ${inner}\n}\nQ --> Z`);
    expect(graph.groups!.map((g) => [g.id, g.members])).toEqual([["P", ["A"]]]);
    expect(graph.nodes.find((n) => n.id === "A")).toMatchObject({ group: "P" });
    expect(graph.nodes.find((n) => n.id === "Q")).toBeDefined();
  });
});

describe("edges into and out of nested composites pick by direction", () => {
  const leave = (body: string) => glyphGraphFromMermaid(`stateDiagram-v2\n${body}\nP --> Z`).edges.find((e) => e.to === "Z")!.from;
  const enter = (body: string) => glyphGraphFromMermaid(`stateDiagram-v2\n${body}\nZ --> P`).edges.find((e) => e.from === "Z")!.to;

  it("leaves a composite whose only inner composite holds nothing but a start and an end through that end", () => {
    // Mutation: fall back to the first member for either direction -> leaving P is drawn from Q's start marker.
    expect(leave("state P {\n  state Q {\n    [*] --> [*]\n  }\n}")).toBe("[*]:end:Q");
    expect(enter("state P {\n  state Q {\n    [*] --> [*]\n  }\n}")).toBe("[*]:start:Q");
  });

  it("goes through nested composites to their markers or their states, last child out and first child in", () => {
    const body = "state P {\n  X\n  state Q {\n    A --> B\n  }\n}";
    expect(enter(body)).toBe("X");
    expect(leave(body)).toBe("B");
    const reversed = "state P {\n  state Q {\n    [*] --> A\n    A --> [*]\n  }\n  Y\n}";
    expect(enter(reversed)).toBe("[*]:start:Q");
    expect(leave(reversed)).toBe("Y");
  });

  it("uses a composite's own markers before any child, and never a nested composite's markers as its own", () => {
    expect(leave("state P {\n  state Q {\n    [*] --> A\n    A --> [*]\n  }\n  [*] --> Q\n  Q --> [*]\n}")).toBe("[*]:end:P");
    // A child that is a state first used in another composite is not this composite's child.
    expect(leave("state O {\n  S\n}\nstate P {\n  S --> T\n}")).toBe("T");
    expect(enter("state O {\n  S\n}\nstate P {\n  S --> T\n}")).toBe("T");
  });

  it("never picks an edge's end from the wrong marker when a composite holds only markers", () => {
    expect(leave("state P {\n  [*] --> [*]\n}")).toBe("[*]:end:P");
    expect(enter("state P {\n  [*] --> [*]\n}")).toBe("[*]:start:P");
  });
});

describe("state statements read the same at any indentation (class)", () => {
  const indents = ["", "  ", "\t", " \t "];
  const names = ["plain", "x; y", "50%% off", "a: b", "{brace}", "}", "a { b", "%%", ";"];
  it.each(indents.map((indent) => [JSON.stringify(indent), indent] as const))("%s: every naming form keeps names holding ; %% : { } intact", (_label, i) => {
    // Mutation: test for `state` at the very start of the statement (`^state\s+$` without the leading `\s*`) -> an indented name is not recognised as quoted and the line is a syntax error.
    for (const name of names) {
      const named = glyphGraphFromMermaid(`stateDiagram-v2\n${i}state "${name}" as S\n${i}S --> B : x; y`);
      expect({ name, label: named.nodes.find((n) => n.id === "S")!.label, edge: named.edges[0]!.label }).toEqual({ name, label: name, edge: "x; y" });

      const composite = glyphGraphFromMermaid(`stateDiagram-v2\n${i}state "${name}" as S {\n${i}  X --> Y : p; q\n${i}}\n${i}S --> Z`);
      expect({ name, label: composite.groups![0]!.label }).toEqual({ name, label: name });
      expect(composite.edges.map((e) => e.label)).toEqual(["p; q", undefined]);

      const choice = glyphGraphFromMermaid(`stateDiagram-v2\n${i}state "${name}" as C <<choice>>\n${i}A --> C`);
      expect(choice.nodes.find((n) => n.id === "C")).toMatchObject({ shape: "diamond" });
    }
  });

  it.each(indents.map((indent) => [JSON.stringify(indent), indent] as const))("%s: quotes and separators in labels and descriptions stay text", (_label, i) => {
    const graph = glyphGraphFromMermaid(`stateDiagram-v2\n${i}A --> B : 5" pipe; more\n${i}B --> C : 6" pipe\n${i}A : 7" pipe\n${i}%% a comment\n${i}C --> D`);
    expect(graph.edges.map((e) => e.label)).toEqual(['5" pipe; more', '6" pipe', undefined]);
    expect(graph.nodes.find((n) => n.id === "A")!.label).toBe('A\n7" pipe');
  });
});

describe("a composite named or declared in several scopes has one owner (class)", () => {
  type G = ReturnType<typeof glyphGraphFromMermaid>;
  const permutations = <T,>(items: readonly T[]): T[][] => items.length <= 1 ? [[...items]] : items.flatMap((item, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]));
  const subsets = <T,>(items: readonly T[]): T[][] => items.reduce<T[][]>((all, item) => [...all, ...all.map((s) => [...s, item])], [[]]);
  const inQ = ['state "Other" as P', "P : d", "P", "A", "P:::hot"];
  const declarations = [
    ["empty at the top", "state P {\n}"],
    ["with a state at the top", "state P {\n  B\n}"],
    ["empty in R", "state R {\n  state P {\n  }\n  C\n}"],
    ["with a state in R", "state R {\n  state P {\n    B\n  }\n  C\n}"],
  ] as const;
  const transitions = [["P --> Z"], ["Z --> P"], ["P --> Z", "Z --> P"]] as const;

  const check = (graph: G, source: string) => {
    const asNode = graph.nodes.filter((n) => n.id === "P"), asGroup = (graph.groups ?? []).filter((g) => g.id === "P");
    expect({ source, owners: asNode.length + asGroup.length }).toEqual({ source, owners: 1 });
    const listing = (graph.groups ?? []).filter((g) => g.members.includes("P"));
    if (asNode.length) {
      const owner = asNode[0]!.group;
      // Every group that lists the state is its owner or encloses it; with no owner no group lists it.
      expect({ source, listing: listing.map((g) => g.id).sort(), owner }).toEqual({ source, listing: expect.any(Array), owner });
      if (owner === undefined) expect({ source, listing: listing.length }).toEqual({ source, listing: 0 });
      else expect({ source, owned: listing.some((g) => g.id === owner) }).toEqual({ source, owned: true });
    } else {
      expect({ source, listed: listing.length }).toEqual({ source, listed: 0 });
    }
    for (const node of graph.nodes) if (node.group !== undefined) expect({ source, node: node.id, ok: graph.groups!.find((g) => g.id === node.group)!.members.includes(node.id) }).toEqual({ source, node: node.id, ok: true });
  };

  it("validates and keeps P's ownership consistent across every ordering", () => {
    // Mutation: leave a stale owner when a composite is declared at the top (drop the `else owners.delete(id)`) -> an empty P converts into a state of a group that no longer lists it.
    let cases = 0;
    for (const inner of subsets(inQ).flatMap((subset) => permutations(subset))) for (const [, declaration] of declarations) for (const moves of transitions) for (const order of permutations(["q", "p", "t"])) {
      const parts = { q: `state Q {\n${[...inner, "A"].filter((x, i, all) => all.indexOf(x) === i).map((x) => `  ${x}`).join("\n")}\n}`, p: declaration, t: moves.join("\n") };
      const source = `stateDiagram-v2\n${order.map((key) => parts[key as "q" | "p" | "t"]).join("\n")}`;
      let graph: G;
      try { graph = glyphGraphFromMermaid(source); } catch (error) { throw new Error(`${(error as Error).message}\n${source}`); }
      check(graph, source);
      cases++;
    }
    expect(cases).toBeGreaterThan(1000);
  });
});
