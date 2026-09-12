import { describe, expect, it } from "vitest";
import { glyphGraphFromMermaid, renderGlyphDiagram, type GlyphDiagramRenderOptions } from "@glyphcss/diagrams";
import { buildGlyphDiagramsWorkbenchGraph, createGlyphDiagramsWorkbenchState, generateGlyphDiagramsWorkbenchSnippets, glyphDiagramsWorkbenchMermaid, reduceGlyphDiagramsWorkbenchControls, reduceGlyphDiagramsWorkbenchState, resolveGlyphDiagramsWorkbenchControls } from "./diagramsWorkbenchState";
import { renderGlyphDiagramsWorkbenchState } from "./diagramsWorkbenchRender";

describe("diagram workbench state and exports", () => {
  it.each([
    { type: "charset", value: "box" }, { type: "color", value: "none" }, { type: "width", value: 72 }, { type: "height", value: 24 },
  ] as const)("keeps explicitly choosing the old default for $type across a target change", (action) => {
    const controls = reduceGlyphDiagramsWorkbenchControls({ target: "chat", overrides: {} }, action);
    expect(resolveGlyphDiagramsWorkbenchControls(reduceGlyphDiagramsWorkbenchControls(controls, { type: "target", value: "web" }))).toEqual({ target: "web", charset: "blocks", color: "css", width: 96, height: 32, [action.type]: action.value });
  });

  it("switching editor tabs preserves JSON-only metadata until the source is edited", () => {
    let state = reduceGlyphDiagramsWorkbenchState(createGlyphDiagramsWorkbenchState(), { type: "set-editor", editor: "json" });
    const graph = buildGlyphDiagramsWorkbenchGraph(state);
    const authored = { ...graph, nodes: graph.nodes.map((node) => ({ ...node, kind: "agent" })), edges: graph.edges.map((edge) => ({ ...edge, priority: 8 })) };
    state = reduceGlyphDiagramsWorkbenchState(state, { type: "edit-source", value: JSON.stringify(authored) });
    state = reduceGlyphDiagramsWorkbenchState(state, { type: "set-editor", editor: "mermaid" });
    expect(buildGlyphDiagramsWorkbenchGraph(state)).toEqual(authored);
    state = reduceGlyphDiagramsWorkbenchState(state, { type: "set-editor", editor: "json" });
    expect(JSON.parse(state.json)).toEqual(authored);
  });

  it("an edit made after the Mermaid export round-trips a nasty label, not just echoes the untouched JSON back", () => {
    // Unlike the test above, this commits to the exported Mermaid source (via
    // "edit-source" while editor === "mermaid", which flips sourceKind) so
    // buildGlyphDiagramsWorkbenchGraph actually reparses the export instead
    // of reading the still-pristine JSON string back unedited.
    let state = reduceGlyphDiagramsWorkbenchState(createGlyphDiagramsWorkbenchState(), { type: "set-editor", editor: "json" });
    const graph = buildGlyphDiagramsWorkbenchGraph(state);
    const authored = { ...graph, nodes: graph.nodes.map((node, i) => (i === 0 ? { ...node, label: 'a\\\\server\\share "quoted"' } : node)) };
    state = reduceGlyphDiagramsWorkbenchState(state, { type: "edit-source", value: JSON.stringify(authored) });
    state = reduceGlyphDiagramsWorkbenchState(state, { type: "set-editor", editor: "mermaid" });
    state = reduceGlyphDiagramsWorkbenchState(state, { type: "edit-source", value: state.mermaid });
    // Mutation: decode HTML entities and Mermaid quote-escapes as two
    // sequential whole-string passes instead of one combined scan -> the
    // entity-produced backslashes in this label get eaten and this fails.
    expect(buildGlyphDiagramsWorkbenchGraph(state).nodes.map((n) => n.label)).toEqual(authored.nodes.map((n) => n.label));
    state = reduceGlyphDiagramsWorkbenchState(state, { type: "set-editor", editor: "json" });
    expect(JSON.parse(state.json).nodes.map((n: { label: string }) => n.label)).toEqual(authored.nodes.map((n) => n.label));
  });

  it.each(["\\\\server\\share", 'a"b', "x (y)", "<p>", "&", "|pipe|", ";"])(
    "round-trips the nasty label %j through the Mermaid exporter byte-for-byte",
    (label) => {
      const graph = { direction: "TB" as const, nodes: [{ id: "A", label, shape: "rect" as const }], edges: [] };
      const reparsed = glyphGraphFromMermaid(glyphDiagramsWorkbenchMermaid(graph));
      // Mutation: decode HTML entities and Mermaid quote-escapes as two
      // sequential whole-string passes instead of one combined scan -> an
      // entity-produced backslash gets eaten by the escape pass and this fails.
      expect(reparsed).toEqual(graph);
    },
  );

  it("Mermaid export represents every supported shape, edge style, group and quoted label", () => {
    const shapes = ["rect", "rounded", "diamond", "circle", "subroutine", "asymmetric", "stadium"] as const;
    const graph = { direction: "LR" as const, nodes: shapes.map((shape, i) => ({ id: `node ${i}`, label: i === 0 ? 'A "quoted" label' : shape, shape })), edges: ["solid", "dotted", "thick", "undirected"].map((style, i) => ({ from: `node ${i}`, to: `node ${i + 1}`, label: "edge", style: style as "solid" | "dotted" | "thick" | "undirected" })), groups: [{ id: "crew", label: "Crew", members: ["node 0", "node 1"] }] };
    const converted = glyphGraphFromMermaid(glyphDiagramsWorkbenchMermaid(graph));
    expect(converted.nodes.map((node) => node.label)).toEqual(graph.nodes.map((node) => node.label));
    expect(converted.nodes.map((node) => node.shape)).toEqual(shapes);
    expect(converted.edges.map((edge) => edge.style)).toEqual(graph.edges.map((edge) => edge.style));
    expect(converted.groups?.[0]?.members).toHaveLength(2);
  });

  it.each(["chat", "terminal", "web"] as const)("executes the exported %s TypeScript call and matches the live render", async (target) => {
    let state = createGlyphDiagramsWorkbenchState();
    state = { ...state, controls: { target, overrides: { width: 60, height: 20, charset: "ascii", color: target === "terminal" ? "ansi16" : target === "web" ? "css" : "none" } }, layout: { direction: "LR", engine: "dagre", nodesep: 5, ranksep: 5 }, diagram: { title: "My agent", detail: "faithful" }, terminal: { NO_COLOR: true, FORCE_COLOR: true } };
    const snippets = generateGlyphDiagramsWorkbenchSnippets(state);
    let capturedOptions: GlyphDiagramRenderOptions | undefined;
    const execute = new Function("renderGlyphDiagram", `return (async () => {${snippets.typescript.replace(/^import[^\n]+\n/, "")} return diagram;})();`);
    const result = await execute(async (input: Parameters<typeof renderGlyphDiagram>[0], options: GlyphDiagramRenderOptions) => {
      capturedOptions = options;
      return renderGlyphDiagram(input, options);
    });
    expect(capturedOptions).toMatchObject({ target, width: 60, height: 20, direction: "LR", nodesep: 5, ranksep: 5, title: "My agent", detail: "faithful" });
    const live = await renderGlyphDiagramsWorkbenchState(state);
    expect(live.ok).toBe(true);
    if (!live.ok) return;
    expect(result.text.replace(/\x1b\[[0-9;]*m/g, "")).toBe(live.text);
    if (target === "web") expect(result.html).toBe(live.display);
    expect(JSON.parse(snippets.json)).toEqual(buildGlyphDiagramsWorkbenchGraph(state));
    expect(glyphGraphFromMermaid(snippets.mermaid).direction).toBe("LR");
  });
});
