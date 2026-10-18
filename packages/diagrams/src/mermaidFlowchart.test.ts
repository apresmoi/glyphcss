import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { glyphGraphFromMermaid, glyphMermaidNotes } from "./mermaid";
import * as mermaid from "./mermaid";
import * as mermaidState from "./mermaidState";
import { labelText } from "./mermaidText";
import { renderGlyphDiagram } from "./render";
import { computeGlyphDiagramQuality } from "./quality";
import { measureGlyphGraph } from "./pipeline";
import { validateGlyphGraph } from "./validate";
import { glyphDiagramJsonSchema, GLYPH_DIAGRAM_JSON_SCHEMA_KEYWORDS } from "./schema";
import Ajv2020 from "ajv/dist/2020.js";

const examples = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/flowchart-v11.json"), "utf8")) as { name: string; source: string; shape?: string; fallbackKind?: string | null }[];
const options = { target: "chat", width: 72, height: 24 } as const;
const example = (name: string) => examples.find(item => item.name === name)!.source;

describe("Mermaid flowchart v11 acceptance", () => {
  it.each(examples)("parses and renders $name in 72 columns", async ({ source, shape, fallbackKind }) => {
    const graph = glyphGraphFromMermaid(source);
    if (shape) {
      expect(graph.nodes[0]!.shape).toBe(shape);
      expect(graph.nodes[0]!.label).toBe("Read item");
      expect(glyphMermaidNotes(source).filter(note => String(note.detail?.kind).startsWith("shape:"))).toEqual(fallbackKind === null ? [] : [expect.objectContaining({ detail: { kind: `shape:${fallbackKind}` } })]);
    }
    for (const charset of ["box", "ascii"] as const) {
      const result = await renderGlyphDiagram(source, { ...options, charset });
      expect(result.report.unroutable).toEqual([]);
      expect(result.report.ledger.filter(entry => ["word-cut", "label-dropped", "split-panel-dropped"].includes(entry.code))).toEqual([]);
      expect(result.text.split("\n").every(line => line.length === 72 || line === "")).toBe(true);
      expect(result.text.trim().length).toBeGreaterThan(0);
      const quality = computeGlyphDiagramQuality(result, options);
      expect(quality.crossings).toBe(0);
      expect(quality.fakeFrames).toBe(0);
      expect(quality.droppedEdges).toBe(0);
    }
  });

  it.each([
    ["--o", "none", "●"], ["--x", "none", "✕"], ["o--o", "●", "●"], ["x--x", "✕", "✕"],
    ["<-->", "◀", "▶"], ["<-.->", "◀", "▶"], ["<==>", "◀", "▶"],
  ])("paints %s once with the correct border heads", async (operator, start, end) => {
    for (const charset of ["box", "ascii"] as const) {
      const result = await renderGlyphDiagram(`flowchart LR; A ${operator}|go| B`, { ...options, charset });
      expect(result.routes).toHaveLength(1);
      expect(result.labels.filter(label => label.text === "go")).toHaveLength(1);
      const charAt = (role: "from" | "to") => {
        const port = result.layout.ports.find(port => port.end === role)!;
        return result.canvas.grid.char[port.anchor.y * result.canvas.cols + port.anchor.x];
      };
      const ascii: Record<string, string> = { "●": "o", "✕": "x", "◀": "<", "▶": ">" };
      if (start !== "none") expect(charAt("from")).toBe(charset === "ascii" ? ascii[start!] : start);
      expect(charAt("to")).toBe(charset === "ascii" ? ascii[end!] : end);
    }
  });

  it.each(["TB", "BT", "RL", "LR"])("keeps both arrowheads on one route in %s", async direction => {
    const result = await renderGlyphDiagram(`flowchart ${direction}; A <--> B`, options);
    expect(result.routes).toHaveLength(1);
    const heads: Record<string, string> = { n: "▼", s: "▲", e: "◀", w: "▶" };
    for (const port of result.layout.ports) expect(result.canvas.grid.char[port.anchor.y * result.canvas.cols + port.anchor.x]).toBe(heads[port.side]);
  });

  it("keeps an invisible edge in layout but paints no cells, labels or heads", async () => {
    const source = "flowchart LR; A ~~~ B";
    const graph = glyphGraphFromMermaid(source);
    expect(graph.edges).toEqual([{ from: "A", to: "B", style: "undirected", invisible: true }]);
    const result = await renderGlyphDiagram(source, options);
    expect(result.layout.nodes.find(n => n.id === "A")!.x1).toBeLessThan(result.layout.nodes.find(n => n.id === "B")!.x0);
    expect(result.routes).toEqual([]);
    expect(result.labels.filter(label => label.id.startsWith("edge"))).toEqual([]);
    const a = result.layout.nodes.find(n => n.id === "A")!, b = result.layout.nodes.find(n => n.id === "B")!;
    for (let y = Math.min(a.y0, b.y0); y <= Math.max(a.y1, b.y1); y++) for (let x = a.x1 + 1; x < b.x0; x++) expect(result.canvas.grid.char[y * 72 + x]).toBe(" ");
    expect(computeGlyphDiagramQuality(result, options).droppedEdges).toBe(0);
  });

  it("marks flowchart diamonds, keeps state choice single, and folds the marker", async () => {
    for (const charset of ["box", "ascii"] as const) {
      const result = await renderGlyphDiagram(example("diamond"), { ...options, charset });
      expect(result.text).toContain(charset === "ascii" ? "* Ready?" : "◆ Ready?");
      expect(result.meta.nodes.find(node => node.shape === "diamond")!.label).toBe("Ready?");
      expect(result.report.ledger.filter(entry => entry.code === "label-folded")).toEqual([]);
    }
    const state = measureGlyphGraph(glyphGraphFromMermaid("stateDiagram-v2; state C <<choice>>"));
    expect(state.nodes[0]!.lines).toEqual(["◆"]);
  });

  it("logs one fallback per canonical shape kind, including aliases", () => {
    const source = "flowchart LR; A@{shape: hex}; B@{shape: hexagon}; C{{Classic}}; D@{shape: doc}; E@{shape: document}";
    expect(glyphMermaidNotes(source).map(note => note.detail?.kind)).toEqual(["shape:doc"]);
    expect(glyphMermaidNotes("flowchart LR; A@{shape: rect}; B@{shape: proc}")).toEqual([]);
    expect(glyphMermaidNotes(example("icon"))).toContainEqual(expect.objectContaining({ detail: { kind: "shape:icon" } }));
    expect(glyphMermaidNotes(example("image"))).toContainEqual(expect.objectContaining({ detail: { kind: "shape:image" } }));
  });

  it("preserves labels, classes and inert metadata without creating edge-id nodes", () => {
    expect(glyphGraphFromMermaid(example("property updates")).nodes[0]).toEqual({ id: "A", label: "New label", shape: "cylinder" });
    expect(glyphGraphFromMermaid('flowchart LR; A[Old]; A@{shape: cyl}').nodes[0]!.label).toBe("Old");
    expect(glyphGraphFromMermaid(example("quoted properties")).nodes[0]!.label).toBe("a, b: } ; c");
    expect(glyphGraphFromMermaid(example("edge metadata")).nodes.map(node => node.id)).toEqual(["A", "B"]);
    expect(glyphMermaidNotes(example("edge metadata")).filter(note => note.detail?.kind === "animation")).toHaveLength(1);
    expect(glyphGraphFromMermaid('flowchart LR; e1@{ curve: basis }; A e1@--> B; e1@{ unused: "safe" }').nodes.map(node => node.id)).toEqual(["A", "B"]);
    expect(glyphGraphFromMermaid(example("classes unicode comments")).nodes.map(node => node.id)).toEqual(["開始", "終了"]);
  });

  it("decodes markdown and Mermaid entities once", () => {
    const graph = glyphGraphFromMermaid(example("markdown"));
    expect(graph.nodes[0]!.label).toBe("Read the\nnext item");
    expect(graph.edges[0]!.label).toBe("then go");
    expect(glyphGraphFromMermaid(example("entities")).nodes[0]!.label).toBe('"Read" ♥');
    expect(glyphGraphFromMermaid(example("entities")).edges[0]!.label).toBe("& #");
  });

  it.each(["subgraph direction", "subgraph endpoints", "frontmatter", "accessibility"])("reports the approximation for %s", name => {
    expect(glyphMermaidNotes(example(name))).not.toEqual([]);
  });

  it("attaches subgraph links to real members without an extra group-name node", () => {
    const graph = glyphGraphFromMermaid(example("subgraph endpoints"));
    expect(graph.nodes.map(node => node.id)).toEqual(["A", "B", "X", "Y"]);
    expect(graph.edges.map(edge => [edge.from, edge.to])).toEqual([["A", "B"], ["X", "A"], ["B", "Y"]]);
  });

  it("validates head and invisibility fields with runtime/schema parity", () => {
    const ajv = new Ajv2020({ strict: false });
    for (const keyword of GLYPH_DIAGRAM_JSON_SCHEMA_KEYWORDS) ajv.addKeyword(keyword);
    const validate = ajv.compile(glyphDiagramJsonSchema());
    const graph = glyphGraphFromMermaid("flowchart LR; A o--o B; B ~~~ C");
    expect(validate(graph)).toBe(true);
    for (const patch of [{ startHead: "bad" }, { endHead: 3 }, { invisible: "true" }]) {
      const bad = { ...graph, edges: [{ ...graph.edges[0], ...patch }] };
      expect(validate(bad)).toBe(false);
      expect(() => validateGlyphGraph(bad)).toThrow(expect.objectContaining({ code: "bad-edge" }));
    }
  });
});

const bench = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/expected/flowchart-bench.json"), "utf8")) as { file: string; options: import("./renderTypes").GlyphDiagramRenderOptions; sha256: string }[];
it.each(bench)("keeps the approved corpus render $file byte-identical", async ({ file, options, sha256 }) => {
  const source = readFileSync(resolve(__dirname, "../bench/corpus", file), "utf8");
  const result = await renderGlyphDiagram(source, options);
  expect(createHash("sha256").update(result.text).digest("hex")).toBe(sha256);
});

it.each(["--->", "----", "-..->", "-..-", "===>", "===="])("reports compact spacing for the longer link %s", operator => {
  expect(glyphMermaidNotes(`flowchart LR; A ${operator} B`)).toContainEqual(expect.objectContaining({ detail: { kind: "edge-length" } }));
});

it("reports markdown flattening and keeps synthetic ids stable across head kinds", async () => {
  expect(glyphMermaidNotes(example("markdown"))).toContainEqual(expect.objectContaining({ detail: { kind: "markdown" } }));
  const graph = glyphGraphFromMermaid("flowchart LR; A o--o B; A x--x B");
  const one = measureGlyphGraph(graph), two = measureGlyphGraph({ ...graph, edges: [...graph.edges].reverse() });
  expect(one.edges).toEqual(two.edges);
  const hidden = await renderGlyphDiagram("flowchart LR; A ~~~ A", options);
  expect(hidden.routes).toEqual([]);
  expect(hidden.report.unroutable).toEqual([]);
});

const edgeCases = [
  ["--o", "solid", "none", "circle"], ["--x", "solid", "none", "cross"],
  ["o--o", "solid", "circle", "circle"], ["x--x", "solid", "cross", "cross"],
  ["<-->", "solid", "arrow", "arrow"], ["<-.->", "dotted", "arrow", "arrow"], ["<==>", "thick", "arrow", "arrow"],
  ["---o", "solid", "none", "circle"], ["----x", "solid", "none", "cross"],
  ["o----o", "solid", "circle", "circle"], ["x----x", "solid", "cross", "cross"],
  ["<---->", "solid", "arrow", "arrow"], ["<-...->", "dotted", "arrow", "arrow"], ["<====>", "thick", "arrow", "arrow"],
  ["---", "undirected", "none", "none"], ["----", "undirected", "none", "none"],
  ["-.->", "dotted", "none", "arrow"], ["-..->", "dotted", "none", "arrow"],
  ["-.-", "dotted", "none", "none"], ["-..-", "dotted", "none", "none"],
  ["==>", "thick", "none", "arrow"], ["===>", "thick", "none", "arrow"],
  ["===", "thick", "none", "none"], ["====", "thick", "none", "none"],
  ["-->", "solid", "none", "arrow"], ["--->", "solid", "none", "arrow"],
] as const;
it.each(edgeCases)("preserves label, style and both heads for %s", (operator, style, start, end) => {
  const graph = glyphGraphFromMermaid(example(`edge ${operator}`));
  expect(graph.nodes.map(node => node.id)).toEqual(["A", "B"]);
  expect(graph.edges).toHaveLength(1);
  const edge = graph.edges[0]!;
  expect(edge).toMatchObject({ from: "A", to: "B", style, label: "go" });
  expect(edge.startHead ?? "none").toBe(start);
  expect(edge.endHead ?? (style === "undirected" ? "none" : "arrow")).toBe(end);
});
it.each([
  ["-- text --o", "solid", "none", "circle"], ["-- text --x", "solid", "none", "cross"],
  ["o-- text --o", "solid", "circle", "circle"], ["x-- text --x", "solid", "cross", "cross"],
  ["<-- text -->", "solid", "arrow", "arrow"], ["<-. text .->", "dotted", "arrow", "arrow"],
  ["<== text ==>", "thick", "arrow", "arrow"], ["-- text ---->", "solid", "none", "arrow"],
  ["-. text ...->", "dotted", "none", "arrow"], ["== text ====>", "thick", "none", "arrow"],
  ["-- text ---", "undirected", "none", "none"], ["-. text .-", "dotted", "none", "none"], ["== text ===", "thick", "none", "none"],
])("preserves inline label, style and both heads for %s", (operator, style, start, end) => {
  const graph = glyphGraphFromMermaid(example(`edge text ${operator}`));
  expect(graph.edges).toHaveLength(1);
  const edge = graph.edges[0]!;
  expect(edge).toMatchObject({ from: "A", to: "B", label: "text", style });
  expect(edge.startHead ?? "none").toBe(start);
  expect(edge.endHead ?? (style === "undirected" ? "none" : "arrow")).toBe(end);
});

// These forms were accepted at HEAD, including zero whitespace and apostrophes.
const oldLabelCases = [
  ["-- it's fine -->", "it's fine", "solid"], ["--text-->", "text", "solid"],
  ["-.text.->", "text", "dotted"], ["==text==>", "text", "thick"],
  ["-- text-->", "text", "solid"], ["--text -->", "text", "solid"],
  ["-. it's fine .->", "it's fine", "dotted"], ["== it's fine ==>", "it's fine", "thick"],
  ['-- "a --> b" -->', "a --> b", "solid"], ["-- 'a --> b' -->", "a --> b", "solid"],
  ['-."a .-> b".->', "a .-> b", "dotted"], ['=="a ==> b"==>', "a ==> b", "thick"],
  ['-->|"a|b; c"|', "a|b; c", "solid"], ["-->|it's fine|", "it's fine", "solid"],
  ["---|text|", "text", "undirected"], ["-.->|text|", "text", "dotted"], ["==>|text|", "text", "thick"],
  ["-.&nbsp;next&nbsp;.->", "next", "dotted"],
] as const;
it.each(oldLabelCases)("keeps HEAD labelled-link behaviour: %s", (operator, label, style) => {
  const graph = glyphGraphFromMermaid(`flowchart LR; A ${operator} B; B --> C`);
  expect(graph.nodes.map(node => node.id)).toEqual(["A", "B", "C"]);
  expect(graph.edges).toEqual([{ from: "A", to: "B", label, style }, { from: "B", to: "C", style: "solid" }]);
});

it.each(["animate: true", "animation: fast", "curve: basis", "e1@--> B"])("does not classify quoted label %s as edge metadata", label => {
  const source = `flowchart LR; A@{shape: rect, label: "${label}"}; e1@{shape: rect, label: "Keep"}`;
  expect(glyphGraphFromMermaid(source).nodes).toEqual([{ id: "A", shape: "rect", label }, { id: "e1", shape: "rect", label: "Keep" }]);
  expect(glyphMermaidNotes(source)).toEqual([]);
});
it("uses parsed edge declarations to classify metadata before and after a link", () => {
  const source = 'flowchart LR; e1@{animate: true}; A e1@--> B; e1@{curve: basis}; N@{label: "curve: basis", animate: true}';
  expect(glyphGraphFromMermaid(source).nodes).toEqual([{ id: "A", label: "A" }, { id: "B", label: "B" }, { id: "N", label: "curve: basis" }]);
  expect(glyphMermaidNotes(source).map(note => note.detail?.kind)).toEqual(["animation", "edge-properties"]);
});
it.each([["copy", "©"], ["reg", "®"], ["alpha", "α"], ["AElig", "Æ"], ["aelig", "æ"], ["NotEqualTilde", "≂̸"]])("decodes named entity %s consistently across labels and separators", (name, value) => {
  for (const prefix of ["#", "&"]) {
    for (const operator of [`-- ${prefix}${name}; -->`, `-.${prefix}${name};.->`, `==${prefix}${name};==>`, `-->|${prefix}${name};|`]) {
      const graph = glyphGraphFromMermaid(`flowchart LR; A["${prefix}${name};"] ${operator} B; B --> C`);
      expect(graph.nodes[0]!.label).toBe(value);
      expect(graph.edges[0]!.label).toBe(value);
      expect(graph.edges).toHaveLength(2);
    }
  }
});
it("decodes HTML named references once without a DOM", () => {
  for (const [name, expected] of [["copy", "©"], ["amp", "&"], ["NotEqualTilde", "≂̸"], ["hearts", "♥"]]) {
    expect(labelText(`#${name};`), name).toBe(expected);
    expect(labelText(`&${name};`), name).toBe(expected);
  }
  expect(labelText("&amp;copy; #amp;copy;")).toBe("&copy; &copy;");
  expect(labelText("#constructor; &toString; #notAName;")).toBe("#constructor; &toString; #notAName;");
});
it.each(["flowchart LR; A --> B", "stateDiagram-v2; A --> B"])("parses source and source notes in one pass: %s", async source => {
  const parse = vi.spyOn(mermaid, "glyphParseMermaid");
  const state = vi.spyOn(mermaidState, "glyphParseMermaidState");
  try {
    await renderGlyphDiagram(source, options);
    expect(parse).toHaveBeenCalledTimes(1);
    expect(state).toHaveBeenCalledTimes(source.startsWith("state") ? 1 : 0);
  } finally { vi.restoreAllMocks(); }
});
it.each(["box", "ascii"] as const)("keeps a blank cell inside both diamond borders in %s", async charset => {
  const result = await renderGlyphDiagram('flowchart LR; A{Read item}', { ...options, charset });
  const node = result.layout.nodes[0]!;
  const row = result.text.split("\n").find(row => row.includes(charset === "box" ? "◆ Read item" : "* Read item"))!;
  expect(row.slice(node.x0 + 1, node.x1)).toBe(` ${charset === "box" ? "◆" : "*"} Read item `);
});
it.each(["B & C", "Z & B"])("keeps authored fan target order %s when a symmetric fit allows it", async targets => {
  const result = await renderGlyphDiagram(`flowchart LR; A --> ${targets}`, options);
  const [first, second] = targets.split(" & ").map(id => result.layout.nodes.find(node => node.id === id)!);
  expect(first!.y0).toBeLessThan(second!.y0);
  expect(computeGlyphDiagramQuality(result, options)).toMatchObject({ crossings: 0, droppedEdges: 0 });
});
