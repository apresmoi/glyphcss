import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { glyphParseMermaid } from "./mermaid";
import { routeGlyphGraphEdges } from "./route";
import { renderGlyphDiagram } from "./render";
import { GLYPH_MERMAID_STATE_REGION, type GlyphMermaidStateRegion, GLYPH_MERMAID_STATE_FRAME, type GlyphMermaidStateFrame } from "./layoutHints";
import { glyphDiagramStateDividers } from "./stateFrame";
import { glyphDiagramRouteQuality } from "./routeQuality";
import { splitGlyphGraph } from "./degrade";
import { layoutGlyphGraph, glyphDiagramGroupRects } from "./pipeline";

const examples = JSON.parse(readFileSync("fixtures/mermaid-task9.json", "utf8")) as { name: string; source: string; height: number }[];
const parse = (body: string) => glyphParseMermaid(`stateDiagram-v2\n${body}`);
const kind = (body: string, name: string) => parse(body).notes.some(note => note.detail?.kind === name);

describe("state syntax completeness", () => {
  it("keeps markers independent and preserves one external edge per composite", () => {
    const { graph } = glyphParseMermaid(examples[0]!.source);
    const regions = graph.groups!.filter(group => (group as GlyphMermaidStateRegion)[GLYPH_MERMAID_STATE_REGION]);
    expect(regions.map(group => group.members)).toEqual([
      ["[*]:start:Active:region:1", "Read", "[*]:end:Active:region:1"],
      ["[*]:start:Active:region:2", "Write", "[*]:end:Active:region:2"],
    ]);
    expect(graph.edges.filter(edge => edge.from === "[*]:start")).toHaveLength(1);
    expect(graph.edges.filter(edge => edge.to === "Done")).toHaveLength(1);
    const entry = graph.edges.find(edge => edge.from === "[*]:start")! as GlyphMermaidStateFrame;
    const exit = graph.edges.find(edge => edge.to === "Done")! as GlyphMermaidStateFrame;
    expect(entry[GLYPH_MERMAID_STATE_FRAME]?.to).toEqual({ group: "Active", nodes: regions.map(group => group.members[0]) });
    expect(exit[GLYPH_MERMAID_STATE_FRAME]?.from).toEqual({ group: "Active", nodes: regions.map(group => group.members[2]) });
  });
  it("keeps a single frame edge with first/last layout representatives without markers", () => {
    const { graph } = glyphParseMermaid(examples[1]!.source);
    expect(graph.edges.filter(edge => edge.from === "Ready").map(edge => edge.to)).toEqual(["A"]);
    expect(graph.edges.filter(edge => edge.to === "Done").map(edge => edge.from)).toEqual(["B"]);
  });
  it("preserves note text and logs side-placement degradation", () => {
    const { graph, notes } = glyphParseMermaid(examples[3]!.source);
    expect(graph.nodes[0]!.label).toBe("Review\nNote: Keep all words\nand both lines.");
    expect(graph.nodes[1]!.label).toBe("B\nNote: Save the result.");
    expect(notes.some(note => note.detail?.kind === "state-note")).toBe(true);
  });
  it.each(["fork", "join"])("preserves the %s identity and branches with a ledger note", type => {
    const { graph } = parse(`state f <<${type}>>\nA --> f\nf --> B\nf --> C`);
    expect(graph.nodes.find(node => node.id === "f")).toMatchObject({ kind: `state-${type}`, shape: "rounded", label: `f\n[${type}]` });
    expect(graph.edges).toHaveLength(3);
    expect(kind(`state f <<${type}>>`, "state-fork-join")).toBe(true);
  });
  it("logs nested direction, class suffixes, directives and frontmatter", () => {
    const parsed = glyphParseMermaid(examples[6]!.source);
    expect(parsed.notes.map(note => note.detail?.kind)).toEqual(expect.arrayContaining(["frontmatter", "state-directive", "state-style"]));
    expect(parsed.graph.nodes.filter(node => node.shape === "point")).toHaveLength(2);
    expect(parsed.graph.nodes.map(node => node.id)).not.toContain("node");
    expect(kind("state P {\n direction LR\n A --> B\n}", "state-direction")).toBe(true);
  });
  it("keeps syntax-shaped note text literal, including semicolons and quotes", () => {
    const { graph } = parse('A\nnote right of A\nstate "unclosed; text\n--\n}\nend note');
    expect(graph.nodes[0]!.label).toBe('A\nNote: state "unclosed; text\n--\n}');
    expect(parse('A\nnote left of A : one; two').graph.nodes[0]!.label).toBe("A\nNote: one; two");
  });
  it("keeps a note-only state's scope and notes on a choice", () => {
    const { graph } = parse("state P {\n note right of A : scoped\n}");
    expect(graph.nodes).toEqual([{ id: "A", group: "P", label: "A\nNote: scoped", shape: "rounded" }]);
    expect(parse("state c <<choice>>\nnote left of c : choose").graph.nodes[0]!.label).toBe("◆\nNote: choose");
  });
  it("omits empty regions without synthetic state boxes", () => {
    const { graph, notes } = parse("state P {\n --\n A\n --\n}");
    expect(graph.nodes.map(node => node.id)).toEqual(["A"]);
    expect(notes.some(note => note.detail?.kind === "state-empty-region")).toBe(true);
    expect(graph.groups!.filter(group => (group as GlyphMermaidStateRegion)[GLYPH_MERMAID_STATE_REGION])).toHaveLength(1);
    expect(parse("state P {\n --\n}").graph.nodes.map(node => node.id)).toEqual(["P"]);
  });
  it("keeps a single outer frame attachment through nested concurrency", () => {
    const { graph } = parse("state P {\n state Q {\n A --> B\n --\n C --> D\n }\n --\n E --> F\n}\nReady --> P\nP --> Done");
    expect(graph.edges.filter(edge => edge.from === "Ready").map(edge => edge.to)).toEqual(["A"]);
    expect(graph.edges.filter(edge => edge.to === "Done").map(edge => edge.from)).toEqual(["B"]);
  });
  it("wraps composite notes on a real inner state instead of truncating the frame caption", () => {
    const { graph } = glyphParseMermaid(examples[7]!.source);
    expect(graph.groups![0]!.label).toBe("Parent");
    expect(graph.nodes.find(node => node.id === "A")!.label).toBe("A\nNote (Parent): Inner work");
  });
  it("gives a composite's sole marker a bordered shape when it needs a self loop", () => {
    const { graph, notes } = parse("A\nstate P {\n [*] --> A\n}\nP --> P");
    expect(graph.nodes.find(node => node.id === "[*]:start:P")).toMatchObject({ shape: "rounded", label: "[start]" });
    expect(graph.edges.some(edge => edge.from === "[*]:start:P" && edge.to === "[*]:start:P")).toBe(true);
    expect(notes.some(note => note.detail?.kind === "state-point-loop")).toBe(true);
  });
  it("preserves region visuals through the public graph-object render boundary", async () => {
    const source = examples[0]!.source;
    const options = { target: "chat" as const, width: 72, height: 32 };
    const fromSource = await renderGlyphDiagram(source, options);
    const fromGraph = await renderGlyphDiagram(glyphParseMermaid(source).graph, options);
    expect(fromGraph.text).toBe(fromSource.text);
    expect(fromGraph.text).toMatch(/╎/);
  });
  it.each(["TB", "BT", "LR", "RL"])("renders region subgroups and a dashed divider in %s", async direction => {
    const result = await renderGlyphDiagram(`stateDiagram-v2\ndirection ${direction}\nstate P {\n A --> B\n --\n C --> D\n}\nReady --> P\nP --> Done`, { target: "chat", width: 72, height: 32 });
    expect(result.text).toMatch(/[┆┊┄┈╌╎]/);
    expect(result.report.unroutable).toEqual([]);
    expect(result.report.ledger.some(note => note.detail?.kind === "state-region-divider")).toBe(false);
    const rects = glyphDiagramGroupRects(result.layout, { cols: 72, rows: 32 });
    expect(rects.size).toBe(3);
    const before = rects.get("P:region:1")!, after = rects.get("P:region:2")!;
    expect(direction === "TB" || direction === "BT" ? before.x1 < after.x0 : before.y1 < after.y0).toBe(true);
    expect(result.layout.edges.filter(edge => edge.from === "Ready")).toHaveLength(1);
    expect(result.layout.edges.filter(edge => edge.to === "Done")).toHaveLength(1);
    expect(glyphDiagramRouteQuality(result.layout, result.routes)).toMatchObject({ crossings: 0, fakeFrames: 0 });
    const outer = rects.get("P")!;
    for (const port of result.layout.ports.filter(port => (result.layout.edges.find(edge => edge.id === port.edgeId)! as GlyphMermaidStateFrame)[GLYPH_MERMAID_STATE_FRAME]?.[port.end])) {
      expect(port.anchor.x === outer.x0 || port.anchor.x === outer.x1 || port.anchor.y === outer.y0 || port.anchor.y === outer.y1).toBe(true);
      expect(result.text.split("\n")[port.anchor.y]![port.anchor.x]).toMatch(port.end === "to" ? /[▼▲◀▶]/ : /[│─]/);
    }
  });
  it.each(["chat", "web"] as const)("straightens concurrent frame exits in %s", async target => {
    for (const example of [examples[0]!, examples[1]!, examples[9]!]) {
      const result = await renderGlyphDiagram(example.source, { target, width: 72, height: example.height });
      for (const route of result.routes.filter(route => (route.edge as GlyphMermaidStateFrame)[GLYPH_MERMAID_STATE_FRAME])) {
        const ports = result.layout.ports.filter(port => port.edgeId === route.edge.id);
        expect(new Set([...route.cells, ...ports.map(port => port.anchor)].map(cell => cell[result.layout.direction === "LR" || result.layout.direction === "RL" ? "y" : "x"])).size, example.name).toBe(1);
      }
      expect(glyphDiagramRouteQuality(result.layout, result.routes)).toMatchObject({ crossings: 0, fakeFrames: 0 });
    }
  });
  it.each(["TB", "BT", "LR", "RL"])("clears concurrent frame dividers by two cells in %s", async direction => {
    const result = await renderGlyphDiagram(examples[0]!.source.replace("stateDiagram-v2", `stateDiagram-v2\ndirection ${direction}`), { target: "chat", width: 72, height: 40 });
    const rects = glyphDiagramGroupRects(result.layout, { cols: 72, rows: 40 });
    const dividers = glyphDiagramStateDividers(result.layout, rects);
    expect(dividers).toHaveLength(1);
    for (const port of result.layout.ports) {
      const frame = (result.layout.edges.find(edge => edge.id === port.edgeId)! as GlyphMermaidStateFrame)[GLYPH_MERMAID_STATE_FRAME]?.[port.end];
      if (!frame) continue;
      for (const divider of dividers.filter(divider => divider.parent === frame.group)) {
        expect(Math.abs(port.anchor[divider.vertical ? "x" : "y"] - divider.position)).toBeGreaterThanOrEqual(2);
      }
    }
  });
  it.each(["chat", "web"] as const)("uses two-row rank gaps inside concurrent regions in %s", async target => {
    for (const example of examples.slice(0, 3)) {
      const result = await renderGlyphDiagram(example.source, { target, width: 72, height: example.height });
      for (const region of result.layout.groups.filter(group => (group as GlyphMermaidStateRegion)[GLYPH_MERMAID_STATE_REGION])) {
        for (const edge of result.layout.edges.filter(edge => region.members.includes(edge.from) && region.members.includes(edge.to))) {
          const from = result.layout.nodes.find(node => node.id === edge.from)!;
          const to = result.layout.nodes.find(node => node.id === edge.to)!;
          expect(to.y0 - from.y1 - 1, `${example.name}: ${edge.from} -> ${edge.to}`).toBe(2);
        }
      }
    }
  });
  it("keeps split panels independent of absent region rank representatives", async () => {
    for (const panel of splitGlyphGraph(glyphParseMermaid(examples[0]!.source).graph)) {
      const layout = await layoutGlyphGraph(panel);
      expect(Number.isFinite(layout.width) && Number.isFinite(layout.height)).toBe(true);
      expect(layout.nodes.every(node => [node.x0, node.x1, node.y0, node.y1].every(Number.isFinite))).toBe(true);
      const pruned = await layoutGlyphGraph({ ...panel, edges: panel.edges.map(edge => {
        const frame = (edge as GlyphMermaidStateFrame)[GLYPH_MERMAID_STATE_FRAME];
        if (!frame) return edge;
        const endpoint = (end: "from" | "to") => frame[end] ? { [end]: { ...frame[end], nodes: frame[end].nodes.filter(id => panel.nodes.some(node => node.id === id)) } } : {};
        return { ...edge, [GLYPH_MERMAID_STATE_FRAME]: { ...endpoint("from"), ...endpoint("to") } };
      }) });
      expect([layout.nodes, layout.ports, layout.width, layout.height]).toEqual([pruned.nodes, pruned.ports, pruned.width, pruned.height]);
    }
  });
  it("keeps blocked region transitions out of concurrent siblings", async () => {
    const { graph } = parse("state Parallel {\n A --> B\n --\n C --> D\n}");
    const layout = await layoutGlyphGraph(graph, { ranksep: 8 });
    const bounds = { cols: layout.width + 10, rows: layout.height + 10 };
    const region = layout.groups.find(group => group.members.includes("A") && (group as GlyphMermaidStateRegion)[GLYPH_MERMAID_STATE_REGION])!;
    const rect = glyphDiagramGroupRects(layout, bounds).get(region.id)!;
    const from = layout.nodes.find(node => node.id === "A")!, to = layout.nodes.find(node => node.id === "B")!;
    const y = Math.floor((from.y1 + to.y0) / 2);
    const result = routeGlyphGraphEdges(layout, { width: bounds.cols, height: bounds.rows,
      obstacles: [{ x0: rect.x0, x1: rect.x1, y0: y, y1: y }] });
    expect(result.unroutable).toContain(layout.edges.find(edge => edge.from === "A" && edge.to === "B")!.id);
  });
  it.each(["chat", "web"] as const)("retains every t9 caption through skill fitting in %s", async target => {
    for (const example of examples) {
      const result = await renderGlyphDiagram(example.source, { target, width: 72, height: 24, autoDirection: true, detail: "faithful", overflow: "expand" });
      expect(result.canvas.cols, example.name).toBe(72);
      expect(result.pages, example.name).toHaveLength(1);
      expect(result.report.ledger.filter(note => ["label-dropped", "label-abbreviated", "word-cut", "unroutable"].includes(note.code)), example.name).toEqual([]);
      expect(glyphDiagramRouteQuality(result.layout, result.routes), example.name).toMatchObject({ crossings: 0, fakeFrames: 0 });
    }
  });
  it("renders every example in both real target defaults and writes the requested artifacts", async () => {
    const outputs: string[] = [], html: string[] = [];
    for (const example of examples) {
      outputs.push(`EXAMPLE: ${example.name}\nSOURCE:\n${example.source}`);
      for (const target of ["chat", "web"] as const) {
        const result = await renderGlyphDiagram(example.source, { target, width: 72, height: example.height });
        expect(result.report.unroutable, `${example.name}/${target}`).toEqual([]);
        expect(result.pages).toHaveLength(1);
        const rects = glyphDiagramGroupRects(result.layout, { cols: 72, rows: example.height });
        for (const parent of result.layout.groups) {
          const regions = result.layout.groups.filter(group => (group as GlyphMermaidStateRegion)[GLYPH_MERMAID_STATE_REGION]?.parent === parent.id)
            .sort((a, b) => (a as GlyphMermaidStateRegion)[GLYPH_MERMAID_STATE_REGION]!.index - (b as GlyphMermaidStateRegion)[GLYPH_MERMAID_STATE_REGION]!.index);
          for (let index = 1; index < regions.length; index++) {
            const before = rects.get(regions[index - 1]!.id)!, after = rects.get(regions[index]!.id)!;
            const horizontal = result.layout.direction === "LR" || result.layout.direction === "RL";
            expect(horizontal ? before.y1 : before.x1, `${example.name}/${target} authored region order`).toBeLessThan(horizontal ? after.y0 : after.x0);
          }
        }
        for (const edge of result.layout.edges) for (const end of ["from", "to"] as const) {
          const frame = (edge as GlyphMermaidStateFrame)[GLYPH_MERMAID_STATE_FRAME]?.[end];
          if (!frame) continue;
          const rect = rects.get(frame.group)!;
          const port = result.layout.ports.find(port => port.edgeId === edge.id && port.end === end)!;
          const vertical = port.side === "n" || port.side === "s";
          expect(vertical ? port.anchor.y : port.anchor.x, `${example.name}/${target} ${end} frame border`)
            .toBe(port.side === "n" ? rect.y0 : port.side === "s" ? rect.y1 : port.side === "w" ? rect.x0 : rect.x1);
          const route = result.routes.find(route => route.edge.id === edge.id)!;
          expect(route.cells.every(cell => cell.x <= rect.x0 || cell.x >= rect.x1 || cell.y <= rect.y0 || cell.y >= rect.y1), `${example.name}/${target} frame transit`).toBe(true);
          const border = result.text.split("\n")[port.anchor.y]![port.anchor.x];
          expect(border, `${example.name}/${target} frame connection`).toMatch(end === "to" ? /[▼▲◀▶]/ : /[│─]/);
        }
        for (const route of result.routes) {
          const ports = result.layout.ports.filter(port => port.edgeId === route.edge.id);
          for (const port of ports) {
            expect(Math.abs(port.anchor.x - port.escape.x) + Math.abs(port.anchor.y - port.escape.y)).toBe(1);
            expect(route.cells).toContainEqual(port.escape);
          }
          for (let index = 1; index < route.cells.length; index++) {
            const before = route.cells[index - 1]!, after = route.cells[index]!;
            expect(Math.abs(before.x - after.x) + Math.abs(before.y - after.y)).toBe(1);
          }
        }
        const quality = glyphDiagramRouteQuality(result.layout, result.routes);
        expect(quality.crossings, `${example.name}/${target} crossings`).toBe(0);
        expect(quality.fakeFrames, `${example.name}/${target} fake frames`).toBe(0);
        expect(result.report.ledger.filter(note => ["word-cut", "label-dropped", "label-abbreviated", "split-panel-dropped", "unroutable", "group-member-list"].includes(note.code)), `${example.name}/${target}`).toEqual([]);
        for (const page of result.pages) {
          expect(page.text.split("\n").every(line => Array.from(line).length <= 72)).toBe(true);
        }
        outputs.push(`TARGET: ${target} (${target === "chat" ? "box" : "braille"}), 72 columns\n${result.text}\nLEDGER: ${JSON.stringify(result.report.ledger)}`);
        if (target === "web") {
          const pre = document.createElement("pre");
          pre.innerHTML = result.html!;
          expect(pre.textContent).toBe(result.text);
          html.push(`<h2>${example.name}</h2><pre>${result.html}</pre>`);
        }
      }
    }
    if (process.env.GLYPH_T9_ARTIFACTS) {
      const directory = process.env.GLYPH_T9_ARTIFACTS;
      mkdirSync(directory, { recursive: true });
      writeFileSync(`${directory}/t9.txt`, outputs.join("\n\n") + "\n");
      writeFileSync(`${directory}/t9-web.html`, `<!doctype html><meta charset="utf-8"><style>body{background:#10141e;color:white}pre{font-family:monospace;line-height:1;font-size:14px}</style>${html.join("\n")}`);
    }
  }, 60_000);
});
