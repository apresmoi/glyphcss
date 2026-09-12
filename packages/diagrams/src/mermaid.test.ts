import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { glyphGraphFromMermaid } from "./mermaid";

const fixture = (name: string) => readFileSync(resolve(__dirname, "../fixtures", `${name}.mmd`), "utf8");

describe("Mermaid flowchart adapter", () => {
  it.each(["chain", "diamond", "fan-out", "cycle", "subgraph", "langgraph", "six-port"])("accepts the %s fixture unchanged", (name) => {
    const source = fixture(name);
    const graph = glyphGraphFromMermaid(source);
    expect(graph.nodes.length).toBeGreaterThan(0);
    expect(graph.edges.length).toBeGreaterThan(0);
    expect(glyphGraphFromMermaid(source)).toEqual(graph);
  });

  it("accepts a byte-for-byte LangGraph draw_mermaid export, including an entity-bearing edge-text label, and discards only markup/style", () => {
    const source = fixture("langgraph-export");
    expect(source.startsWith("%%{init: {'flowchart': {'curve': 'linear'}}}%%\ngraph TD;\n")).toBe(true);
    expect(source).toContain("__start__([<p>__start__</p>]):::first");
    expect(source).toContain("agent -. &nbsp;continue&nbsp; .-> tools;");
    expect(source).toContain("classDef default fill:#f2f0ff,line-height:1.2");
    expect(glyphGraphFromMermaid(source)).toEqual({
      direction: "TB",
      nodes: [
        { id: "__start__", label: "__start__", shape: "stadium" },
        { id: "agent", label: "agent", shape: "rounded" },
        { id: "tools", label: "tools", shape: "rounded" },
        { id: "__end__", label: "__end__", shape: "stadium" },
      ],
      edges: [
        { from: "__start__", to: "agent", style: "solid" },
        { from: "agent", to: "__end__", style: "dotted" },
        { from: "agent", to: "tools", style: "dotted", label: "continue" },
        { from: "tools", to: "agent", style: "solid" },
      ],
    });
  });
  // Mutation: split statements on ";" without protecting "-. text .->" spans
  // -> "&nbsp;"'s own decoded ";" truncates the statement and this throws.
  it("does not let an HTML entity's semicolon inside edge text end the statement early", () => {
    const graph = glyphGraphFromMermaid("graph TD; agent -. &nbsp;continue&nbsp; .-> tools;");
    expect(graph.edges).toEqual([{ from: "agent", to: "tools", style: "dotted", label: "continue" }]);
  });

  it.each(["TB", "TD", "LR", "BT", "RL"])("normalizes direction %s on both supported declarations", (direction) => {
    for (const kind of ["flowchart", "graph"]) expect(glyphGraphFromMermaid(`${kind} ${direction}; A-->B`).direction).toBe(direction === "TD" ? "TB" : direction);
  });

  it("retains every supported node shape, including quoted delimiters and HTML text", () => {
    const graph = glyphGraphFromMermaid(`flowchart TB
      a[Rect]
      b(Round)
      c{Decision}
      d((Circle))
      e[[Subroutine]]
      f>Asymmetric]
      g>(Other asymmetric]
      h([Stadium])
      i["a ] semicolon; &amp; &lt; &gt; &#65;"]
      j["line<br/>break"]
    `);
    expect(graph.nodes.map((node) => node.shape)).toEqual(["rect", "rounded", "diamond", "circle", "subroutine", "asymmetric", "asymmetric", "stadium", "rect", "rect"]);
    expect(graph.nodes[8]!.label).toBe("a ] semicolon; & < > A");
    expect(graph.nodes[9]!.label).toBe("line\nbreak");
  });

  it("retains all edge operators and both label forms, with endpoint ids rather than label matching", () => {
    const graph = glyphGraphFromMermaid(`graph LR;
      a[Repeated] --> b[Repeated]; b --- c; c -.-> d; d ==> e;
      e -- branch label --> f; f -->|pipe label| g; g -. conditional .-> a;
    `);
    expect(graph.edges.map(({ style, label }) => [style, label])).toEqual([
      ["solid", undefined], ["undirected", undefined], ["dotted", undefined], ["thick", undefined],
      ["solid", "branch label"], ["solid", "pipe label"], ["dotted", "conditional"],
    ]);
    expect(graph.edges[0]).toMatchObject({ from: "a", to: "b" });
  });

  it("expands fan-out/fan-in as a Cartesian product and chains each next hop", () => {
    const graph = glyphGraphFromMermaid("flowchart TB\n A & B --> C & D --> E");
    expect(graph.edges.map((edge) => `${edge.from}->${edge.to}`)).toEqual(["A->C", "A->D", "B->C", "B->D", "C->E", "D->E"]);
    expect(graph.nodes.map((node) => node.id)).toEqual(["A", "B", "C", "D", "E"]);
  });

  it("turns nested subgraphs into node groups and preserves the immediate owner", () => {
    const graph = glyphGraphFromMermaid(`flowchart TB
      subgraph outer [Outer group]
        A[Start]
        subgraph inner [Inner group]
          direction LR
          B(Work) --> C[Done]
        end
        A --> B
      end
      C --> D[Outside]
    `);
    expect(graph.groups).toEqual([
      { id: "outer", label: "Outer group", members: ["A", "B", "C"] },
      { id: "inner", label: "Inner group", members: ["B", "C"] },
    ]);
    expect(graph.nodes.map((node) => node.group)).toEqual(["outer", "inner", "inner", undefined]);
  });

  it("accepts styling/class/click statements as inert data without adding fake nodes", () => {
    const source = `graph TD;
      A[Safe]:::first --> B[Still safe]
      classDef first fill:#f2f0ff,stroke:rgb(0,0,0);
      class A,B first;
      style B fill:#ffffff;
      click A "javascript:globalThis.__glyphMermaidClicked = true" "Open" _blank;
      click B call nonExistentCallback();
      linkStyle 0 stroke:#f00,stroke-width:2px;
      %% ignored A --> Ghost
    `;
    expect(glyphGraphFromMermaid(source).nodes.map((node) => node.id)).toEqual(["A", "B"]);
    expect(glyphGraphFromMermaid(source).edges).toHaveLength(1);
    expect("__glyphMermaidClicked" in globalThis).toBe(false);
  });
  it.each(["classDef first fill:#f2f0ff", "class A,B first", "style B fill:#ffffff", 'click A "https://example.com"', "linkStyle 0 stroke:#f00", "%% a plain comment"])
  ("parses %j as inert data, never as a node or an executed statement", (directive) => {
    // Mutation: drop this directive from the inert allowlist -> it fails to
    // parse as a node/edge statement and throws GLYPH_MERMAID_SYNTAX instead.
    const graph = glyphGraphFromMermaid(`graph LR;\nA-->B;\n${directive}`);
    expect(graph.nodes.map((node) => node.id)).toEqual(["A", "B"]);
    expect(graph.edges).toEqual([{ from: "A", to: "B", style: "solid" }]);
  });
  // Mutation: split statements on ";" without protecting "|label|" spans ->
  // a pipe label containing an entity's ";" truncates the statement early.
  it("does not let an HTML entity's semicolon inside a pipe edge label end the statement early", () => {
    const graph = glyphGraphFromMermaid("graph LR; A -->|a&nbsp;label| B;");
    expect(graph.edges).toEqual([{ from: "A", to: "B", style: "solid", label: "a label" }]);
  });

  it.each([
    "sequenceDiagram", "stateDiagram", "stateDiagram-v2", "erDiagram", "pie", "gantt", "mindmap",
    "gitgraph", "classDiagram", "classDiagram-v2", "journey", "timeline", "C4", "C4Context", "C4Container",
    "C4Component", "C4Dynamic", "C4Deployment", "requirementDiagram", "quadrantChart", "xychart-beta",
    "block-beta", "sankey-beta", "packet-beta", "architecture-beta", "kanban", "radar-beta", "treemap-beta",
  ])("rejects %s by its exact kind name", (kind) => {
    // Mutation: silently accept/skip an unsupported header -> this named gate fails.
    expect(() => glyphGraphFromMermaid(`${kind}\nA`)).toThrow(expect.objectContaining({ code: `GLYPH_MERMAID_UNSUPPORTED_${kind.toUpperCase().replace(/[^A-Z0-9]/g, "_")}` }));
    expect(() => glyphGraphFromMermaid(`%% comment\n${kind}\nnot a flowchart [`)).toThrow(expect.objectContaining({ code: `GLYPH_MERMAID_UNSUPPORTED_${kind.toUpperCase().replace(/[^A-Z0-9]/g, "_")}` }));
  });

  it.each(["", "graph ZZ; A", "graph TD; A[unclosed", "graph TD; A -->", "graph TD; A ~~ B", "graph TD; end", "graph TD; subgraph x; A", "%%{unclosed", "graph TD; A:::; B"])("rejects malformed source %j with a syntax rule", (source) => {
    expect(() => glyphGraphFromMermaid(source)).toThrow(expect.objectContaining({ code: "GLYPH_MERMAID_SYNTAX" }));
  });
});

it("adds predeclared node references to subgraph membership", () => {
  const graph = glyphGraphFromMermaid('graph LR; A[Alpha]; B[Beta]; subgraph G[Group]; A; B; end; A --> B');
  expect(graph.groups).toEqual([{ id: "G", label: "Group", members: ["A", "B"] }]);
  expect(graph.nodes.map((node) => node.group)).toEqual(["G", "G"]);
});
