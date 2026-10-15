import { describe, expect, it } from "vitest";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import Ajv from "ajv/dist/2020";
import { glyphParseMermaid, glyphGraphFromMermaid } from "./mermaid";
import { renderGlyphDiagram } from "./render";
import { glyphDiagramJsonSchema, GLYPH_DIAGRAM_JSON_SCHEMA_KEYWORDS } from "./schema";
import { validateGlyphGraph } from "./validate";
import { glyphDiagramDropDecoration, glyphDiagramMergeDuplicates, glyphDiagramCollapseLeaves } from "./degrade";
import { glyphDiagramGroupRects, measureGlyphGraph, reserveGlyphGraphPorts } from "./pipeline";
import { glyphDiagramRectsOverlap } from "./labels";
import { glyphDiagramRouteQuality } from "./routeQuality";
import type { GlyphGraph, GlyphGraphEdgeHead } from "./types";

const examples: { id: string; source: string; options?: { autoDirection: boolean } }[] = JSON.parse(readFileSync("fixtures/mermaid-task4.json", "utf8"));
const example = (id: string) => glyphGraphFromMermaid(examples.find(item => item.id === id)!.source);

it("preserves visibility, classifiers, generics, return types and both member syntaxes", () => {
  expect(example("class-members").nodes).toEqual([{ id: "Box", label: "Box~T~\n<<interface>>", shape: "compartment", compartments: [
    ["+T value", "-int size$", "#List~T~ values", "~bool ready"],
    ["+get() T*", "+make()$ T", "+set(T value) void", "-clear() void$"],
  ] }]);
  const labels = example("class-labels-annotations");
  expect(labels.nodes.map(node => node.label)).toEqual(["Public API\n<<Service>>", "B\n<<Abstract>>", "C-D\n<<Enumeration>>"]);
  expect(labels.nodes[2]!.compartments).toEqual([["OPEN", "CLOSED"]]);
  expect(example("class-inline-blocks").nodes[0]!.compartments).toEqual([["+int id"], ["+run() void"]]);
});

it("keeps namespaces, labels and implicit ancestors as nested groups", () => {
  const graph = example("class-namespaces");
  expect(graph.direction).toBe("LR");
  expect(graph.groups).toEqual([
    { id: "namespace:App", label: "App", members: ["User", "Key"] },
    { id: "namespace:App.Models", label: "Models", members: ["User", "Key"], parent: "namespace:App" },
    { id: "namespace:App.Models.Internal", label: "Internal", members: ["Key"], parent: "namespace:App.Models" },
  ]);
  expect(graph.nodes[1]!.group).toBe("namespace:App.Models.Internal");
});

it("keeps notes, ordered cardinality, metadata and inert interactions", () => {
  const parsed = glyphParseMermaid(examples.find(item => item.id === "class-notes-inert")!.source);
  expect(parsed.graph.nodes.map(node => [node.label, node.compartments])).toEqual([
    ["User", [["Note: Keeps keys\nNever fetches URLs"]]], ["Note", [["Review before release"]]],
  ]);
  expect(parsed.notes.map(note => note.detail?.kind)).toEqual(expect.arrayContaining(["frontmatter", "configuration", "styling", "accessibility", "class-notes"]));
  expect(example("class-cardinality").edges[0]!.label).toBe("[1] employs [0..*]");
});

const relations: [string, GlyphGraphEdgeHead, GlyphGraphEdgeHead, string][] = [
  ["inheritance", "triangle", "none", "solid"], ["composition", "filled-diamond", "none", "solid"], ["aggregation", "open-diamond", "none", "solid"],
  ["association", "none", "arrow", "solid"], ["dependency", "none", "arrow", "dotted"], ["realization", "none", "triangle", "dotted"],
  ["link", "none", "none", "solid"], ["dashed", "none", "none", "dotted"], ["bidirectional", "triangle", "triangle", "solid"],
  ["reverse", "arrow", "none", "solid"], ["lollipop-left", "circle", "none", "solid"], ["lollipop-right", "none", "circle", "solid"],
];
it.each(relations)("parses class relation %s without reversing the endpoints", (name, startHead, endHead, style) => {
  expect(example(`class-${name}`).edges).toEqual([{ from: "A", to: "B", startHead, endHead, style, label: name }]);
});

it("preserves ER types, names, keys, comments, aliases and several attributes per line", () => {
  expect(example("er-attributes").nodes[0]).toEqual({ id: "CUSTOMER", label: "Customers", shape: "compartment", compartments: [[
    "int id PK — primary", "string? email UK", "int owner FK,UK", "string[] tags", "varchar(32) name — display name",
  ]] });
  const graph = example("er-quoted-unicode");
  expect(graph.nodes.map(node => node.label)).toEqual(["User account", "Entries"]);
  expect(graph.edges[0]!.label).toBe("owns rows");
  expect(graph.nodes[1]!.compartments).toEqual([["int id PK", "int user FK"]]);
  expect(graph.nodes[0]!.compartments).toEqual([["int *id PK", "string 名称 — name"]]);
});

it.each(["er-zero-one", "er-one", "er-zero-many", "er-many"])("preserves both ends of %s", head => {
  const index = ["er-zero-one", "er-one", "er-zero-many", "er-many"].indexOf(head);
  expect(example(`er-cardinality-${index}`).edges[0]).toMatchObject({ startHead: head, endHead: head, style: "solid", label: "links" });
});
it("normalizes every ER cardinality and identification alias", () => {
  for (const [i, head] of ["er-zero-one", "er-many", "er-many", "er-zero-many", "er-zero-many", "er-one"].entries()) {
    expect(example(`er-alias-${i}`).edges[0]).toMatchObject({ startHead: head, endHead: head, style: i === 1 ? "dotted" : "solid" });
  }
});
it.each(["TB", "BT", "LR", "RL"])("honours %s and non-identifying ER lines", direction => {
  expect(example(`er-direction-${direction}`)).toMatchObject({ direction, edges: [{ style: "dotted" }] });
});
it("keeps nested ER groups and resolves group endpoints to real entities", () => {
  expect(example("er-groups-inert").groups).toEqual([
    { id: "subgraph:DB", label: "Storage", members: ["USER", "ROW"] },
    { id: "subgraph:Core", label: "Core", members: ["USER"], parent: "subgraph:DB" },
  ]);
  expect(example("er-group-endpoints").edges[0]).toMatchObject({ from: "USER", to: "ROW" });
});

it.each(["classDiagram\nclass A {", "erDiagram\nA { int }", "classDiagram\nA ??? B", 'erDiagram\nA["unclosed]'])("tags malformed input: %s", source => {
  expect(() => glyphGraphFromMermaid(source)).toThrow(/GLYPH_MERMAID_(?:CLASS|ER)_SYNTAX/);
});
it.each(["classDiagram", "erDiagram"])("accepts the valid empty %s", source => {
  expect(glyphGraphFromMermaid(source).nodes).toHaveLength(1);
  expect(glyphParseMermaid(source).notes.some(note => note.detail?.kind === "empty-diagram")).toBe(true);
});
it("keeps schema/runtime parity for compartments and relation heads", () => {
  const ajv = new Ajv({ strict: false });
  for (const keyword of GLYPH_DIAGRAM_JSON_SCHEMA_KEYWORDS) ajv.addKeyword(keyword);
  const schema = ajv.compile(glyphDiagramJsonSchema());
  for (const fixture of examples) expect(schema(glyphGraphFromMermaid(fixture.source)), fixture.id).toBe(true);
  for (const bad of [{ shape: "compartment", compartments: [1] }, { shape: "rect", compartments: [["member"]] }, { compartments: [[]] }]) {
    const graph = { nodes: [{ id: "A", label: "A", ...bad }], edges: [], direction: "TB" };
    expect(schema(graph)).toBe(false);
    expect(() => validateGlyphGraph(graph)).toThrow(/bad-node/);
  }
});

it("protects literal styling and braces in labels while metadata and empty groups stay inert", () => {
  const graph = example("class-literal-labels");
  expect(graph.nodes[0]!.label).toBe("A:::literal");
  expect(graph.edges[0]!.label).toBe("set {key}:::text");
  const er = example("er-metadata");
  expect(er.nodes[0]!.label).toBe("API:::literal");
  expect(er.edges[0]!.label).toBe("set {key}:::text");
  expect(er.groups).toBeUndefined();
});

it("preserves semantic compartment content and relation styles throughout fallback", async () => {
  const graph = example("class-labels-annotations");
  const degraded = glyphDiagramDropDecoration(graph);
  expect(degraded.nodes).toEqual(graph.nodes);
  expect(degraded.edges).toEqual(graph.edges);
  expect(glyphDiagramCollapseLeaves(graph).graph.nodes).toEqual(graph.nodes);
  const parallel = { ...graph, edges: [graph.edges[0]!, { ...graph.edges[0]!, style: "dotted" as const, label: "second meaning" }] };
  expect(glyphDiagramMergeDuplicates(parallel).graph.edges).toHaveLength(2);
  const paged = await renderGlyphDiagram(graph, { target: "chat", width: 72, height: 20 });
  expect(paged.pages.length).toBeGreaterThan(1);
  expect(paged.text).toContain("uses");
  expect(paged.text).toContain("reads");
  expect(paged.pages.flatMap(page => page.routes).some(route => route.edge.style === "dotted")).toBe(true);
});

it("measures rules as rows and folds member text through the shared ledger", () => {
  const measured = measureGlyphGraph(example("er-attributes"), { charset: "ascii", labelWidth: 12 });
  expect(measured.nodes[0]!.separators).toEqual([1]);
  expect(measured.nodes[0]!.height).toBe(measured.nodes[0]!.lines.length + 2);
  expect(measured.ledger.some(note => note.code === "label-folded" && note.detail?.role === "member row")).toBe(true);
});

it("omits empty compartments and measures only populated member sections", () => {
  for (const compartments of [undefined, [], [[]], [[], []], [[" "]]]) {
    const measured = measureGlyphGraph({ direction: "LR", edges: [], nodes: [{ id: "A", label: "A", shape: "compartment", compartments }] });
    expect(measured.nodes[0]!.height).toBe(3);
    expect(measured.nodes[0]!.lines).toEqual(["A"]);
    expect(measured.nodes[0]!.separators ?? []).toEqual([]);
  }
  const measured = measureGlyphGraph(example("class-empty-compartments"));
  expect(measured.nodes.map(node => node.height)).toEqual([3, 3, 5, 5]);
  expect(measured.nodes.map(node => node.separators ?? [])).toEqual([[], [], [1], [1]]);
});

it("keeps both relationship captions in one automatic LR panel at 72 by 24", async () => {
  const result = await renderGlyphDiagram(example("class-labels-annotations"), { target: "chat", width: 72, height: 24, autoDirection: true });
  expect(result.pages).toHaveLength(1);
  expect(result.layout.direction).toBe("LR");
  expect(result.labels.filter(label => label.id.startsWith("edge:")).map(label => label.text)).toEqual(["uses", "reads"]);
  expect(result.report.ledger.filter(note => note.code === "label-dropped")).toEqual([]);
});

it("accepts upstream class and ER identifier forms at every reference position", () => {
  const classes = example("class-identifier-forms");
  expect(classes.nodes.map(node => node.id)).toEqual(["-A", "123", "名前", "a / b", "Box"]);
  expect(classes.nodes[0]!.compartments).toEqual([["+int id", "Note: leading hyphen"]]);
  expect(classes.edges.map(edge => [edge.from, edge.to])).toEqual([["-A", "123"], ["123", "名前"], ["名前", "a / b"], ["a / b", "Box"]]);
  expect(classes.nodes[4]!.label).toBe("Box~Map<K, V>~");
  const entities = example("er-identifier-forms");
  expect(entities.nodes.map(node => node.id)).toEqual(["-A", "*B", "1.5", "名前", "with / punctuation"]);
  expect(entities.nodes[0]!.compartments).toEqual([["int id PK", "custom type? given name"]]);
  expect(entities.edges.map(edge => [edge.from, edge.to])).toEqual([["-A", "*B"], ["*B", "1.5"], ["1.5", "名前"], ["名前", "with / punctuation"]]);
});

it("reserves separator-free side ports before layout, including crowded fans and loops", () => {
  for (const direction of ["TB", "BT", "LR", "RL"] as const) {
    const graph: GlyphGraph = { direction, nodes: ["A", "B", "C", "D"].map(id => ({ id, label: id, shape: "compartment", compartments: [["id"], ["run()"]] })),
      edges: [{ from: "A", to: "A", label: "retry" }, ...["B", "C", "D"].map(to => ({ from: "A", to, startHead: "triangle" as const }))] };
    const reserved = reserveGlyphGraphPorts(measureGlyphGraph(graph));
    for (const port of reserved.ports) {
      const node = reserved.nodes.find(node => node.id === port.nodeId)!;
      if (port.side !== "w" && port.side !== "e") continue;
      const top = Math.floor((node.height - node.lines.length) / 2);
      expect(port.offset).toBeGreaterThan(0);
      expect(port.offset).toBeLessThan(node.height - 1);
      expect((node.separators ?? []).map(row => row + top)).not.toContain(port.offset);
    }
  }
});

describe("72-column class and ER target renders", () => {
  for (const target of ["chat", "web"] as const) for (const fixture of examples) {
    it(`${target}: ${fixture.id}`, async () => {
      const result = await renderGlyphDiagram(fixture.source, { target, width: 72, ...fixture.options });
      expect(result.canvas.tier).toBe(target === "chat" ? "box" : "braille");
      expect(result.report.unroutable).toEqual([]);
      expect(result.report.ledger.filter(note => ["word-cut", "label-dropped", "split-panel-dropped", "unroutable"].includes(note.code))).toEqual([]);
      if (fixture.id === "er-quoted-unicode") expect(result.report.ledger.some(note => note.code === "label-folded" && String(note.detail?.before).includes("名称"))).toBe(true);
      if (["class-wrapped-ports", "class-three-row-snake", "flow-three-row-snake"].includes(fixture.id)) {
        expect(result.pages).toHaveLength(1);
        expect(result.report.ledger.some(note => note.code === "layout-wrapped")).toBe(true);
      }
      for (const page of result.pages) {
        expect(page.text.split("\n").every(row => row.length === 72)).toBe(true);
        const quality = glyphDiagramRouteQuality(page.layout, page.routes);
        expect(quality.crossings, fixture.id).toBe(0);
        expect(quality.fakeFrames, fixture.id).toBe(0);
        if (["class-three-row-snake", "flow-three-row-snake"].includes(fixture.id)) for (const [from, to] of [["C", "D"], ["F", "G"]]) {
          const route = page.routes.find(route => route.edge.from === from && route.edge.to === to)!;
          expect(quality.edges.find(edge => edge.edgeId === route.edge.id)!.bends, `${from}→${to}`).toBe(0);
          expect(new Set(route.cells.map(cell => cell.x)).size).toBe(1);
        }
        expect(page.layout.nodes.length).toBeGreaterThan(0);
        const frames = glyphDiagramGroupRects(page.layout, { cols: 72, rows: page.canvas.grid.rows });
        for (const label of page.labels.filter(label => label.id.startsWith("edge:"))) for (const rect of frames.values()) {
          const borders = [{ ...rect, y1: rect.y0 }, { ...rect, y0: rect.y1 }, { ...rect, x1: rect.x0 }, { ...rect, x0: rect.x1 }];
          expect(borders.some(border => glyphDiagramRectsOverlap(label, border)), `${fixture.id}: caption ${label.text} overlaps frame`).toBe(false);
        }
        for (const rect of frames.values()) for (let y = rect.y0; y <= rect.y1; y++) for (let x = rect.x0; x <= rect.x1; x++) {
          if (x !== rect.x0 && x !== rect.x1 && y !== rect.y0 && y !== rect.y1) continue;
          const cell = { x0: x, x1: x, y0: y, y1: y };
          // Route notches and group captions intentionally interrupt the dotted ring.
          if (page.layout.nodes.some(node => glyphDiagramRectsOverlap(node, cell))
            || page.labels.some(label => label.id.startsWith("group:") && glyphDiagramRectsOverlap(label, cell))
            || page.routes.some(route => route.cells.some(p => Math.abs(p.x - x) + Math.abs(p.y - y) <= 1))) continue;
          expect(page.canvas.grid.char[y * 72 + x], `${fixture.id}: frame at ${x},${y}`).toBe("·");
        }
        for (const node of page.layout.nodes) {
          expect(node.shape).toBe(fixture.id === "flow-three-row-snake" ? "rect" : "compartment");
          const top = node.y0 + Math.floor((node.height - node.lines.length) / 2);
          node.lines.forEach((line, index) => {
            if (!line) return;
            const row = page.canvas.grid.char.slice((top + index) * 72 + node.x0 + 1, (top + index) * 72 + node.x1).join("");
            expect(row, `${fixture.id}: member/header ${line}`).toContain(line);
          });
          for (const row of node.separators ?? []) {
            const rule = page.canvas.grid.char.slice((top + row) * 72 + node.x0, (top + row) * 72 + node.x1 + 1).join("");
            expect(rule).toBe(`├${"─".repeat(node.width - 2)}┤`);
          }
          for (const port of page.layout.ports.filter(port => port.nodeId === node.id)) {
            if (port.side === "n" || port.side === "s") {
              expect(port.anchor.x).toBeGreaterThan(node.x0);
              expect(port.anchor.x).toBeLessThan(node.x1);
            } else {
              expect(port.anchor.y).toBeGreaterThan(node.y0);
              expect(port.anchor.y).toBeLessThan(node.y1);
              expect((node.separators ?? []).map(row => top + row)).not.toContain(port.anchor.y);
            }
          }
        }
      }
      if (target === "web") expect(result.html).toContain("<");
    });
  }
});

it("paints proposed endpoint glyphs after compartment borders in every direction", async () => {
  for (const direction of ["TB", "BT", "LR", "RL"] as const) for (const head of ["triangle", "filled-diamond", "open-diamond", "er-one", "er-zero-one", "er-many", "er-zero-many"] as const) {
    const graph: GlyphGraph = { direction, nodes: ["A", "B"].map(id => ({ id, label: id, shape: "compartment", compartments: [["int id"]] })), edges: [{ from: "A", to: "B", startHead: head, endHead: head, style: "solid" }] };
    const result = await renderGlyphDiagram(graph, { target: "chat", width: 72, autoDirection: false });
    expect(result.routes).toHaveLength(1);
    for (const port of result.layout.ports) {
      const at = (x: number, y: number) => result.canvas.grid.char[y * 72 + x];
      const expected = head === "triangle" ? "△" : head === "filled-diamond" ? "◆" : head === "open-diamond" ? "◇" : head === "er-many" || head === "er-zero-many" ? { n: "v", s: "^", e: "<", w: ">" }[port.side] : "┼";
      expect(at(port.anchor.x, port.anchor.y)).toBe(expected);
      if (head.startsWith("er-")) expect(at(port.escape.x, port.escape.y)).toBe(head.startsWith("er-zero") ? "○" : "┼");
    }
  }
});

it("writes all verbatim target examples only when explicitly requested", async () => {
  const dir = process.env.GLYPH_T4_ARTIFACT_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  const text: string[] = [], html: string[] = [];
  for (const fixture of examples) {
    text.push(`=== ${fixture.id}: source ===\n${fixture.source}`);
    for (const target of ["chat", "web"] as const) {
      const result = await renderGlyphDiagram(fixture.source, { target, width: 72, ...fixture.options });
      text.push(`=== ${fixture.id}: ${target}, 72 columns, ${target === "chat" ? "box" : "braille"}${fixture.options ? `, ${JSON.stringify(fixture.options)}` : ""} ===\n${result.text}\nLEDGER ${JSON.stringify(result.report.ledger)}\n`);
      if (target === "web") html.push(`<h2>${fixture.id}</h2><pre>${result.html}</pre>`);
    }
  }
  writeFileSync(`${dir}/t4.txt`, text.join("\n"));
  const font = readFileSync("../../website/public/fonts/glyph-mono.woff2").toString("base64");
  writeFileSync(`${dir}/t4-web.html`, `<!doctype html><meta charset="utf-8"><title>Class and ER target review</title><style>@font-face{font-family:"Glyph Mono";src:url(data:font/woff2;base64,${font})}body{background:#111827;color:#e5e7eb}pre{font:14px/1 "Glyph Mono",monospace;white-space:pre}</style>${html.join("\n")}`);
});
