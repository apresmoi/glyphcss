import { describe, expect, it } from "vitest";
import { glyphGraphFromMermaid, glyphParseMermaid } from "./mermaid";
import { renderGlyphDiagram } from "./render";
import { GLYPH_MERMAID_BLOCK, type GlyphMermaidBlockGraph } from "./mermaidStructured";
import { glyphDiagramGroupRects } from "./pipeline";
import { glyphDiagramRepairHint } from "./validate";

const kinds = (source: string) => glyphParseMermaid(source).notes.map(n => n.detail?.kind);

describe("Mermaid block grids", () => {
  it.each(["block", "block-beta"])("accepts %s columns, spans, spaces and auto columns", async header => {
    const graph = glyphGraphFromMermaid(`${header}\ncolumns 3\na[First]:2 space\nb c:2`) as GlyphMermaidBlockGraph;
    expect(graph.nodes.map(n => n.id)).toEqual(["a", "b", "c"]);
    expect(graph[GLYPH_MERMAID_BLOCK]).toEqual({ columns: 3, cells: [{ id: "a", span: 2 }, { span: 1 }, { id: "b", span: 1 }, { id: "c", span: 2 }] });
    const r = await renderGlyphDiagram(graph, { target: "chat", width: 72 });
    const [a, b, c] = ["a", "b", "c"].map(id => r.layout.nodes.find(n => n.id === id)!);
    expect(a!.y0).toBeLessThan(b!.y0); expect(b!.y0).toBe(c!.y0);
    expect(a!.width).toBe(c!.width); expect(a!.width).toBeGreaterThan(b!.width);
    expect(r.report.ledger.some(n => n.detail?.kind === "block-layout")).toBe(false);
    const auto = await renderGlyphDiagram("block\ncolumns auto\na b c", { target: "chat" });
    expect(new Set(auto.layout.nodes.map(n => n.y0)).size).toBe(1);
  });
  it("keeps spaces empty and nested grids separate, including anonymous composites", async () => {
    const source = 'block\ncolumns 3\na space:1 b\nblock:inside:2\ncolumns 2\nc d\nend\ne';
    const result = await renderGlyphDiagram(source, { target: "chat", width: 72 });
    const node = (id: string) => result.layout.nodes.find(n => n.id === id)!;
    expect(node("a").y0).toBe(node("b").y0);
    expect(node("b").x0 - node("a").x1).toBeGreaterThan(node("a").width);
    expect(node("c").y0).toBe(node("d").y0);
    expect(result.meta.groups[0]).toMatchObject({ id: "inside", members: ["c", "d"] });
    expect(glyphGraphFromMermaid("block\nblock\nX\nend").groups?.[0]?.members).toEqual(["X"]);
  });
  it.each(["chat", "web"] as const)("keeps unequal-label spans on equal columns in %s", async target => {
    const result = await renderGlyphDiagram("block-beta\ncolumns 3\na[Alpha]:2 space\nb[Beta] c[Gamma]:2", { target, width: 72 });
    const node = (id: string) => result.layout.nodes.find(n => n.id === id)!;
    const [a, b, c] = [node("a"), node("b"), node("c")];
    const gap = c.x0 - b.x1 - 1;
    expect(b.width).toBe(8);
    expect(gap).toBe(3);
    expect(a.width).toBe(2 * b.width + gap);
    expect(c.width).toBe(a.width);
    expect(a.x0).toBe(b.x0);
    expect(result.report.ledger).toEqual([]);
  });
  it.each(["chat", "web"] as const)("keeps nested frames within their allocated span bounds in %s", async target => {
    const result = await renderGlyphDiagram("block\ncolumns 2\nblock:Group:2\ncolumns 2\na[One] b[Two]\nend\nc[Three] d[Four]", { target, width: 72 });
    const node = (id: string) => result.layout.nodes.find(n => n.id === id)!;
    const frame = glyphDiagramGroupRects(result.layout, { cols: 72, rows: result.canvas.rows }).get("Group")!;
    expect(frame.x0).toBe(node("c").x0);
    expect(frame.x1).toBe(node("d").x1);
    expect(node("c").width).toBe(node("d").width);
    for (const id of ["a", "b"]) {
      expect(node(id).x0).toBeGreaterThan(frame.x0);
      expect(node(id).x1).toBeLessThan(frame.x1);
      expect(node(id).y0).toBeGreaterThan(frame.y0);
      expect(node(id).y1).toBeLessThan(frame.y1);
    }
    expect(node("a").y0 - frame.y0).toBe(2);
    expect(frame.y1 - node("a").y1).toBe(2);
    const rows = result.text.split("\n");
    expect(rows[frame.y0]![frame.x0]).toBe("·");
    expect(rows[frame.y0]![frame.x1]).toBe("·");
    expect(result.report.ledger).toEqual([]);
  });
  it.each(["chat", "web"] as const)("keeps recursive spans, rows and frame insets at default %s height", async target => {
    const result = await renderGlyphDiagram("block\ncolumns 2\nblock:Outer:2\ncolumns 2\nblock:Inner:2\ncolumns 2\na[One] b[Two]\nend\nc[Three] d[Four]\nend\ne[Five] f[Six]", { target, width: 72 });
    const frames = glyphDiagramGroupRects(result.layout, { cols: 72, rows: result.canvas.rows });
    const outer = frames.get("Outer")!, inner = frames.get("Inner")!;
    const node = (id: string) => result.layout.nodes.find(n => n.id === id)!;
    expect([outer.x0, outer.x1]).toEqual([node("e").x0, node("f").x1]);
    expect([inner.x0, inner.x1]).toEqual([node("c").x0, node("d").x1]);
    for (const [left, right] of [["a", "b"], ["c", "d"], ["e", "f"]]) {
      expect(node(left!).y0).toBe(node(right!).y0);
      expect(node(left!).width).toBe(node(right!).width);
    }
    expect(node("c").y0).toBe(inner.y1 + 2);
    expect(node("e").y0).toBe(outer.y1 + 2);
    // One blank cell separates every nested border; padding cannot force chat into graph fallback.
    expect(inner.x0 - outer.x0).toBe(2);
    expect(outer.x1 - inner.x1).toBe(2);
    expect(inner.y0 - outer.y0).toBe(2);
    expect(outer.y1 - node("c").y1).toBe(2);
    expect(node("a").x0 - inner.x0).toBe(2);
    expect(inner.x1 - node("b").x1).toBe(2);
    expect(node("a").y0 - inner.y0).toBe(2);
    expect(inner.y1 - node("a").y1).toBe(2);
    const rows = result.text.split("\n");
    for (const frame of [outer, inner]) for (const y of [frame.y0, frame.y1]) {
      expect(rows[y]![frame.x0]).toBe("·");
      expect(rows[y]![frame.x1]).toBe("·");
    }
    expect(result.pages).toHaveLength(1);
    expect(result.canvas.rows).toBe(target === "chat" ? 24 : 32);
    expect(result.report.ledger).toEqual([]);
  });
  it.each(["chat", "web"] as const)("uses each nested grid's own column count in %s", async target => {
    const result = await renderGlyphDiagram("block\ncolumns 2\nblock:Outer:2\ncolumns 3\nblock:Inner:3\ncolumns 2\na[One] b[Two]\nend\nc[Three] d[Four] g[Seven]\nend\ne[Five] f[Six]", { target, width: 72 });
    const frames = glyphDiagramGroupRects(result.layout, { cols: 72, rows: result.canvas.rows });
    const outer = frames.get("Outer")!, inner = frames.get("Inner")!;
    const node = (id: string) => result.layout.nodes.find(n => n.id === id)!;
    expect([outer.x0, outer.x1]).toEqual([node("e").x0, node("f").x1]);
    expect([inner.x0, inner.x1]).toEqual([node("c").x0, node("g").x1]);
    expect(node("a").y0).toBe(node("b").y0);
    expect(node("c").y0).toBe(node("d").y0);
    expect(node("c").y0).toBe(node("g").y0);
    expect(new Set(["c", "d", "g"].map(id => node(id).width)).size).toBe(1);
    expect(node("c").y0).toBe(inner.y1 + 2);
    expect(node("e").y0).toBe(outer.y1 + 2);
    expect(result.report.ledger).toEqual([]);
  });
  it("wraps whole label words before reducing the authored column count", async () => {
    const result = await renderGlyphDiagram("block\ncolumns 4\na[Alpha beta gamma] b[B] c[C] d[D]", { target: "chat", width: 72 });
    expect(new Set(result.layout.nodes.map(node => node.y0)).size).toBe(1);
    expect(new Set(result.layout.nodes.map(node => node.width)).size).toBe(1);
    expect(result.layout.nodes.find(node => node.id === "a")!.lines).toEqual(["Alpha beta", "gamma"]);
    expect(result.report.ledger.some(n => ["block-row-wrap", "block-layout"].includes(String(n.detail?.kind)) || n.code === "word-cut")).toBe(false);
  });
  it.each(["block", "block\nspace:3", "block-beta\ncolumns 3\nspace:3"])("renders empty block %s without fake nodes", async source => {
    expect(glyphGraphFromMermaid(source).nodes).toEqual([]);
    for (const target of ["chat", "web"] as const) for (const title of [undefined, "Empty grid"]) {
      const options = { target, title, width: 72, detail: "simplified" as const };
      const result = await renderGlyphDiagram(source, options);
      expect(result.text.trim()).toBe(title ?? "");
      expect(result.text.split("\n").every(row => row.length === 72)).toBe(true);
      expect(result.meta.nodes).toEqual([]); expect(result.layout.nodes).toEqual([]);
      expect(result.routes).toEqual([]); expect(result.report.unroutable).toEqual([]);
      expect(result.report.ledger).toContainEqual(expect.objectContaining({ code: "mermaid-degraded", detail: { kind: "block-empty" } }));
      expect((await renderGlyphDiagram(glyphGraphFromMermaid(source), options)).text).toBe(result.text);
      if (target === "web") {
        expect(result.html).toBeDefined();
        expect(result.html!.replace(/<[^>]*>/g, "").trim()).toBe(title ?? "");
      }
    }
    await expect(renderGlyphDiagram({ nodes: [], edges: [], direction: "TB" })).rejects.toMatchObject({ code: "empty-nodes" });
  });
  it.each([["[Rect]", "rect"], ["(Round)", "rounded"], ["([Stadium])", "stadium"], ["[[Sub]]", "subroutine"], ["[(Db)]", "cylinder"], ["((Circle))", "circle"], [">Flag]", "asymmetric"], ["{Choice}", "diamond"], ["{{Hex}}", "rect"], ["[/Lean/]", "rect"], ["[\\Lean\\]", "rect"], ["[/Trap\\]", "rect"], ["[\\Trap/]", "rect"], ["(((Double)))", "circle"]])("retains block shape %s as %s", (shape, expected) => {
    const g = glyphGraphFromMermaid(`block\na${shape}\nb`);
    expect(g.nodes[0]?.shape).toBe(expected); expect(g.nodes[1]?.id).toBe("b");
  });
  it.each(["right", "left", "up", "down", "x", "y", "x, down"])("retains block arrow %s as an approved outline with a direction tag", direction => {
    const g = glyphGraphFromMermaid(`block\na<["Go; now"]>(${direction}):2 b`);
    expect(g.nodes[0]).toMatchObject({ id: "a", label: `Go; now\n[${direction}]`, shape: "asymmetric" });
    expect(g.nodes[1]?.id).toBe("b");
    expect((g as GlyphMermaidBlockGraph)[GLYPH_MERMAID_BLOCK]?.cells[0]?.span).toBe(2);
    expect(kinds(`block\na<["Go"]>(${direction})`)).toContain("block-arrow");
  });
  it("accepts anonymous arrows and preserves arrowheads, dotted/thick links and labels", () => {
    const g = glyphGraphFromMermaid('block\n<["Turn"]>(down)\na b c d\na -- "hi; there" --> b\nb -.-> c\nc ==> d\nd --- a');
    expect(g.nodes[0]?.label).toBe("Turn\n[down]");
    expect(g.edges).toMatchObject([{ from: "a", to: "b", label: "hi; there" }, { style: "dotted" }, { style: "thick" }, { style: "undirected" }]);
  });
  it("wraps overwide rows before cutting words and logs the actual loss", async () => {
    const result = await renderGlyphDiagram('block\ncolumns 8\na[Alpha] b[Beta] c[Gamma] d[Delta] e[Epsilon] f[Zeta] g[Eta] h[Theta]', { target: "chat", width: 72 });
    expect(new Set(result.layout.nodes.map(n => n.y0)).size).toBeGreaterThan(1);
    expect(result.report.ledger.some(n => n.detail?.kind === "block-row-wrap")).toBe(true);
    expect(result.report.ledger.some(n => n.code === "word-cut")).toBe(false);
    for (const name of ["Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta", "Eta", "Theta"]) expect(result.text).toContain(name);
  });
});

describe("Mermaid architecture", () => {
  it.each(["architecture", "architecture-beta"])("parses %s groups/icons/services/junctions, side ports and group edges", header => {
    const source = `${header}\ngroup outer(cloud)[Cloud]\ngroup inner(server)[API] in outer\nservice a(database)[Store] in inner\nservice b(logos:aws)[Worker] in outer\njunction j in inner\na{group}:R <--> L:b\na:B -- T:j`;
    const { graph, notes } = glyphParseMermaid(source);
    expect(graph.nodes[0]).toMatchObject({ label: "[db] Store", shape: "cylinder", group: "inner" });
    expect(graph.nodes[1]?.label).toBe("[logos:aws] Worker");
    expect(graph.nodes[2]).toMatchObject({ label: "+", shape: "point" });
    expect(graph.groups).toMatchObject([{ id: "outer", members: ["a", "b", "j"] }, { id: "inner", parent: "outer", members: ["a", "j"] }]);
    expect(graph.edges).toEqual([{ from: "a", to: "b", style: "solid", startHead: "arrow", endHead: "arrow" }, { from: "a", to: "j", style: "solid", startHead: "none", endHead: "none" }]);
    expect(notes.map(n => n.detail?.kind)).toEqual(expect.arrayContaining(["architecture-icon", "architecture-ports", "architecture-group-edge"]));
  });
  it.each([["L", "RL"], ["R", "LR"], ["T", "BT"], ["B", "TB"]])("uses the first %s port for global %s orientation and preserves reverse heads", (port, direction) => {
    const g = glyphGraphFromMermaid(`architecture-beta\nservice a[A]\nservice b[B]\na:${port} <-- R:b`);
    expect(g.direction).toBe(direction); expect(g.edges[0]).toMatchObject({ startHead: "arrow", endHead: "none" });
  });
  it("accepts alignment as a logged approximation and junction self loops without throwing", async () => {
    const r = await renderGlyphDiagram('architecture-beta\njunction j\nj:R --> L:j\nalign row j j', { target: "chat" });
    expect(r.meta.nodes[0]?.shape).toBe("rounded");
    expect(r.report.ledger.map(n => n.detail?.kind)).toEqual(expect.arrayContaining(["architecture-align", "architecture-junction-loop"]));
    expect(r.report.unroutable).toEqual([]);
  });
});

const requirementTypes = ["requirement", "functionalRequirement", "interfaceRequirement", "performanceRequirement", "physicalRequirement", "designConstraint"];
describe("Mermaid requirements", () => {
  it.each(requirementTypes)("retains %s fields in measured compartments", type => {
    const g = glyphGraphFromMermaid(`requirementDiagram\n${type} "A requirement" {\nid: R1\ntext: "**Never** lose a; word or %% comment"\nrisk: High\nverifymethod: Test\n}\nelement test {\ntype: suite\ndocref: "https://example.test/a;b"\n}`);
    expect(g.nodes[0]).toEqual({ id: "A requirement", label: `A requirement\n<<${type}>>`, shape: "compartment", kind: type, compartments: [["id: R1", "text: Never lose a; word or %% comment", "risk: High", "verifymethod: Test"]] });
    expect(g.nodes[1]?.compartments).toEqual([["type: suite", "docref: https://example.test/a;b"]]);
  });
  it.each(["contains", "copies", "derives", "satisfies", "verifies", "refines", "traces"])("retains %s in either arrow orientation", label => {
    const nodes = 'requirement a {\nid: 1\n}\nelement b {\ntype: test\n}';
    for (const relation of [`a - ${label} -> b`, `b <- ${label} - a`]) {
      expect(glyphGraphFromMermaid(`requirementDiagram\n${nodes}\n${relation}`).edges[0]).toMatchObject({ from: "a", to: "b", label });
    }
  });
  it.each(["TB", "BT", "LR", "RL"])("accepts direction %s, risks/methods and inert styles", direction => {
    const s = `requirementDiagram\ndirection ${direction}\nrequirement a:::blue {\nrisk: Medium\nverifymethod: Demonstration\n}\nstyle a fill:red\nclassDef blue fill:blue\nclass a blue`;
    expect(glyphGraphFromMermaid(s).direction).toBe(direction);
    expect(kinds(s)).toContain("styling");
    for (const method of ["Analysis", "Inspection", "Test", "Demonstration"]) for (const risk of ["Low", "Medium", "High"]) expect(glyphGraphFromMermaid(`requirementDiagram\nrequirement a {\nrisk: ${risk}\nverifymethod: ${method}\n}`).nodes[0]?.compartments?.[0]).toEqual([`risk: ${risk}`, `verifymethod: ${method}`]);
  });
});

describe("Mermaid C4", () => {
  it.each(["C4Context", "C4Container", "C4Component", "C4Dynamic", "C4Deployment"])("accepts %s elements, nested boundaries and optional named parameters", kind => {
    const source = `${kind}\nEnterprise_Boundary(org,"Org") {\nSystem_Boundary(sys,"Suite") {\nPerson(p,"Reader",$descr="Reads, safely",$link="javascript:alert(1)")\nContainerDb_Ext(db,"Store",$descr="Records",$techn="SQL")\n}\n}\nBiRel(p,db,"Reads",$techn="HTTPS")\nUpdateLayoutConfig($c4ShapeInRow="1")`;
    const g = glyphGraphFromMermaid(source);
    expect(g.nodes[0]).toMatchObject({ label: "Reader\n[person]\nReads, safely", shape: "rounded", group: "sys" });
    expect(g.nodes[1]).toMatchObject({ label: "Store\n[container db, external]\nSQL\nRecords", shape: "cylinder" });
    expect(g.groups).toMatchObject([{ id: "org", members: ["p", "db"] }, { id: "sys", members: ["p", "db"], parent: "org" }]);
    expect(g.edges[0]).toMatchObject({ from: "p", to: "db", startHead: "arrow", label: `${kind === "C4Dynamic" ? "1: " : ""}Reads [HTTPS]` });
    expect(kinds(source)).toEqual(expect.arrayContaining(["c4-assets", "c4-external", "c4-configuration"]));
  });
  const elements = ["Person", "System", "Container", "Component"].flatMap(base => [base, `${base}_Ext`, ...(base === "Person" ? [] : [`${base}Db`, `${base}Db_Ext`, `${base}Queue`, `${base}Queue_Ext`])]);
  it.each(elements)("maps %s to the approved family and retains its stereotype", name => {
    const n = glyphGraphFromMermaid(`C4Context\n${name}(id,"Label")`).nodes[0]!;
    expect(n.kind).toBe(name); expect(n.label).toContain(name.startsWith("Person") ? "[person" : name.startsWith("System") ? "[system" : name.startsWith("Container") ? "[container" : "[component");
    expect(n.shape).toBe(name.includes("Db") ? "cylinder" : name.startsWith("Person") ? "rounded" : "rect");
    expect(n.label.includes("external")).toBe(name.endsWith("_Ext"));
    expect(n.label.includes("queue")).toBe(name.includes("Queue"));
  });
  it.each(["Boundary", "Enterprise_Boundary", "System_Boundary", "Container_Boundary", "Deployment_Node", "Node", "Node_L", "Node_R"])("maps %s to a group and retains empty nodes", name => {
    const g = glyphGraphFromMermaid(`C4Deployment\n${name}(n,"Host") {\nContainer(app,"App","JS")\n}`);
    expect(g.groups?.[0]).toMatchObject({ id: "n", label: "Host", members: ["app"] });
    expect(glyphGraphFromMermaid(`C4Deployment\n${name}(n,"Host")`).nodes[0]?.label).toContain("Host");
  });
  it.each(["Rel", "BiRel", "Rel_U", "Rel_Up", "Rel_D", "Rel_Down", "Rel_L", "Rel_Left", "Rel_R", "Rel_Right", "Rel_Back"])("keeps %s semantic direction and technology", name => {
    const g = glyphGraphFromMermaid(`C4Context\nSystem(a,A)\nSystem(b,B)\n${name}(a,b,Read,"TCP")`);
    expect(g.edges[0]).toMatchObject({ from: name === "Rel_Back" ? "b" : "a", to: name === "Rel_Back" ? "a" : "b", label: "Read [TCP]" });
    expect(g.edges[0]?.startHead).toBe(name === "BiRel" ? "arrow" : undefined);
  });
  it("numbers dynamic edges in author order, never following explicit RelIndex numbers", () => {
    const g = glyphGraphFromMermaid('C4Dynamic\nComponent(a,A)\nComponent(b,B)\nRelIndex(99,a,b,"First")\nRel(b,a,"Next","RPC")');
    expect(g.edges.map(e => e.label)).toEqual(["1: First", "2: Next [RPC]"]);
  });
  it("keeps directives inert, including nested shape functions and URLs", () => {
    const source = 'C4Context\nPerson(a,"A; %% B", "<script>alert(1)</script>")\nUpdateElementStyle(a,$shape=RoundedBoxShape(),$fontColor="red")\nUpdateRelStyle(a,a,$offsetX="200")\nAddElementTag("tag",$shape=EightSidedShape())';
    expect(glyphGraphFromMermaid(source).nodes[0]?.label).toContain("A; %% B");
    expect(kinds(source)).toContain("c4-configuration");
  });
});

it.each([["block\ncolumns 0", "BLOCK"], ["architecture-beta\nwhat", "ARCHITECTURE"], ["requirementDiagram\nrequirement a {", "REQUIREMENT"], ["C4Context\nSystem(a, A", "C4"]])("tags malformed source with a repairable error: %s", (source, family) => {
  const code = `GLYPH_MERMAID_${family}_SYNTAX`;
  expect(() => glyphGraphFromMermaid(source!)).toThrow(expect.objectContaining({ code }));
  expect(glyphDiagramRepairHint(code)).not.toContain("Unknown");
});

it("protects frontmatter, entity semicolons, quoted comments and inert configuration in every family", () => {
  for (const body of ['block\na["A &amp; B; %% C"]', 'architecture-beta\nservice a(server)["A &amp; B; %% C"]', 'requirementDiagram\nrequirement a {\ntext: "A &amp; B; %% C"\n}', 'C4Context\nSystem(a,"A &amp; B; %% C")']) {
    const source = `---\nconfig:\n  theme: dark\n---\n%%{init: {}}%%\n${body}\n%% trailing`;
    const parsed = glyphParseMermaid(source);
    expect(parsed.notes.map(n => n.detail?.kind)).toEqual(expect.arrayContaining(["frontmatter", "configuration"]));
    expect(JSON.stringify(parsed.graph.nodes)).toContain("A & B; %% C");
  }
});

it("does not invoke colour callbacks during rejected block-grid probes", async () => {
  let nodes = 0, edges = 0;
  const result = await renderGlyphDiagram('block\ncolumns 2\na[Alpha] b[Beta]\na -- "lengthy caption" --> b', { target: "web", width: 72, nodeColor: () => { nodes++; return "#ff0000"; }, edgeColor: () => { edges++; return "#0000ff"; } });
  expect(result.text).toContain("lengthy caption");
  expect(nodes).toBe(2); expect(edges).toBe(1);
  expect(result.report.ledger.some(n => n.detail?.kind === "block-layout")).toBe(true);
});

it("keeps unquoted multiword requirement names and strips only their markdown presentation", () => {
  const graph = glyphGraphFromMermaid('requirementDiagram\nrequirement reader safety {\ntext: _Keep_ records\n}\nelement test suite {\n}\ntest suite - verifies -> reader safety');
  expect(graph.nodes.map(n => n.id)).toEqual(["reader safety", "test suite"]);
  expect(graph.nodes[0]?.compartments).toEqual([["text: Keep records"]]);
  expect(graph.edges[0]).toMatchObject({ from: "test suite", to: "reader safety" });
});

it("retains block label updates at declared edge endpoints", () => {
  const g = glyphGraphFromMermaid('block\na b[Old]\na --> b[New]');
  expect(g.nodes).toEqual([{ id: "a", label: "a" }, { id: "b", label: "New", shape: "rect" }]);
});

it("keeps shared block render option validation, simplified detail and height expansion", async () => {
  const source = 'block\ncolumns 1\na(Alpha) b(Beta) c(Gamma)';
  await expect(renderGlyphDiagram(source, { engine: "elk" })).rejects.toMatchObject({ code: "GLYPH_DIAGRAM_ELK_NOT_INSTALLED" });
  await expect(renderGlyphDiagram(source, { labelWidth: 0 })).rejects.toMatchObject({ code: "bad-options" });
  const expanded = await renderGlyphDiagram(source, { target: "chat", width: 72, height: 8, overflow: "expand" });
  expect(expanded.canvas.rows).toBeGreaterThan(8);
  expect(new Set(expanded.layout.nodes.map(n => n.x0)).size).toBe(1);
  expect(expanded.report.ledger.some(n => n.code === "layout-expanded")).toBe(true);
  const simple = await renderGlyphDiagram(source, { target: "chat", detail: "simplified" });
  expect(simple.layout.nodes.every(n => n.shape === undefined)).toBe(true);
});
