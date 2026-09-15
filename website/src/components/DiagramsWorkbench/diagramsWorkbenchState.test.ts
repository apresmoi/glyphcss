import { describe, expect, it } from "vitest";
import { glyphGraphFromMermaid, renderGlyphDiagram, type GlyphDiagramRenderOptions } from "@glyphcss/diagrams";
import { GLYPH_DIAGRAM_WORKBENCH_PRESETS, buildGlyphDiagramsWorkbenchGraph, createGlyphDiagramsWorkbenchState, generateGlyphDiagramsWorkbenchSnippets, glyphDiagramsWorkbenchMermaid, reduceGlyphDiagramsWorkbenchControls, reduceGlyphDiagramsWorkbenchState, resolveGlyphDiagramsWorkbenchControls } from "./diagramsWorkbenchState";
import { renderGlyphDiagramsWorkbenchState } from "./diagramsWorkbenchRender";

describe("diagram workbench state and exports", () => {
  it.each(["subgraph", "crew"])("final-gate-2 (both P1 #4/#2): applying the '%s' preset, switching to Table, and editing one node keeps rendering — groups and direction survive the table edit", async (id) => {
    // Mutation: drop `groups`/`direction` back out of `tableGraph` in
    // `buildGlyphDiagramsWorkbenchGraph`'s table branch (the pre-fix
    // `{ nodes: state.nodes, edges: state.edges, direction: state.layout
    // .direction ?? "TB" }`) -> a node whose `group` names a real group the
    // rebuilt graph no longer declares -> `renderGlyphDiagramsWorkbenchState`
    // returns `{ ok: false, code: "unknown-group" }` -> red. LR also silently
    // resets to TB, which the direction assertion below catches too.
    const preset = GLYPH_DIAGRAM_WORKBENCH_PRESETS.find((p) => p.id === id)!;
    const sourceGraph = glyphGraphFromMermaid(preset.source);
    expect(sourceGraph.groups?.length ?? 0).toBeGreaterThan(0); // sanity: the fixture actually has a group.
    let state = reduceGlyphDiagramsWorkbenchState(createGlyphDiagramsWorkbenchState(), { type: "apply-preset", id });
    state = reduceGlyphDiagramsWorkbenchState(state, { type: "set-editor", editor: "table" });
    state = reduceGlyphDiagramsWorkbenchState(state, { type: "set-node", index: 0, patch: { label: `${state.nodes[0]!.label} (edited)` } });
    const graph = buildGlyphDiagramsWorkbenchGraph(state);
    expect(graph.groups).toEqual(sourceGraph.groups);
    expect(graph.direction).toBe(sourceGraph.direction);
    const rendered = await renderGlyphDiagramsWorkbenchState(state);
    expect(rendered.ok).toBe(true);
  });


  it.each([
    { type: "charset", value: "box" }, { type: "color", value: "none" }, { type: "width", value: 72 }, { type: "height", value: 24 },
  ] as const)("keeps explicitly choosing the old default for $type across a target change", (action) => {
    const controls = reduceGlyphDiagramsWorkbenchControls({ target: "chat", overrides: {} }, action);
    expect(resolveGlyphDiagramsWorkbenchControls(reduceGlyphDiagramsWorkbenchControls(controls, { type: "target", value: "web" }))).toEqual({ target: "web", charset: "braille", color: "css", width: 96, height: 32, [action.type]: action.value });
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

  // Mutation: the pipe span's quote-awareness fix in mermaid.ts regresses ->
  // the exporter's own `|"${label}"|` shape (it never escapes "|" itself)
  // becomes unparseable. The nasty-label test above only exercises "|pipe|"
  // as a NODE label (bracket-protected, routes around the defect); this is
  // the EDGE label the exporter's own pipe span must parse back.
  it("round-trips an edge label containing a pipe through the Mermaid exporter's own |\"...\"| shape", () => {
    const graph = { direction: "LR" as const, nodes: [{ id: "A", label: "A", shape: "rect" as const }, { id: "B", label: "B", shape: "rect" as const }], edges: [{ from: "A", to: "B", style: "solid" as const, label: "a|b" }] };
    const mermaid = glyphDiagramsWorkbenchMermaid(graph);
    expect(mermaid).toContain('|"a|b"|');
    expect(glyphGraphFromMermaid(mermaid)).toEqual(graph);
  });

  it("Mermaid export represents every supported shape, edge style, group and quoted label", () => {
    const shapes = ["rect", "rounded", "diamond", "circle", "subroutine", "asymmetric", "stadium"] as const;
    const graph = { direction: "LR" as const, nodes: shapes.map((shape, i) => ({ id: `node ${i}`, label: i === 0 ? 'A "quoted" label' : shape, shape })), edges: ["solid", "dotted", "thick", "undirected"].map((style, i) => ({ from: `node ${i}`, to: `node ${i + 1}`, label: "edge", style: style as "solid" | "dotted" | "thick" | "undirected" })), groups: [{ id: "crew", label: "Crew", members: ["node 0", "node 1"] }] };
    const converted = glyphGraphFromMermaid(glyphDiagramsWorkbenchMermaid(graph));
    expect(converted.nodes.map((node) => node.label)).toEqual(graph.nodes.map((node) => node.label));
    expect(converted.nodes.map((node) => node.shape)).toEqual(shapes);
    expect(converted.edges.map((edge) => edge.style)).toEqual(graph.edges.map((edge) => edge.style));
    expect(converted.groups?.[0]?.members).toHaveLength(2);
  });

  it("gives a generated group alias its own collision loop, so it never collides with another group's real id", () => {
    // Group 0's id is not a safe Mermaid identifier, so it needs a generated
    // "glyph_group_0" fallback -- which collides with group 1's OWN real id,
    // already exactly that string.
    const graph = {
      direction: "TB" as const,
      nodes: [{ id: "A", label: "A" }, { id: "B", label: "B" }],
      edges: [],
      groups: [
        { id: "not a safe id!", label: "First", members: ["A"] },
        { id: "glyph_group_0", label: "Second", members: ["B"] },
      ],
    };
    const mermaid = glyphDiagramsWorkbenchMermaid(graph);
    // Mutation: replace the `while (usedGroupIds.has(id)) id += "_"` loop
    // with the pre-fix `glyph_group_${index}` (no collision check) -> both
    // subgraphs are emitted as "subgraph glyph_group_0[...]", which is a
    // duplicate-id Mermaid parse error.
    const reparsed = glyphGraphFromMermaid(mermaid);
    const ids = reparsed.groups?.map((group) => group.id) ?? [];
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
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
    // `web` ignores the width/height override — it fills the measured
    // viewport instead (`diagramsWorkbenchSizeLocked`); with no viewport to
    // measure here, `glyphDiagramsWorkbenchRenderOptions` falls back to the
    // target's own default grid (96x32). Only `terminal`/`chat` still
    // honour the dialed-in 60x20 override.
    const expectedWidth = target === "web" ? 96 : 60;
    const expectedHeight = target === "web" ? 32 : 20;
    expect(capturedOptions).toMatchObject({ target, width: expectedWidth, height: expectedHeight, direction: "LR", nodesep: 5, ranksep: 5, title: "My agent", detail: "faithful" });
    const live = await renderGlyphDiagramsWorkbenchState(state);
    expect(live.ok).toBe(true);
    if (!live.ok) return;
    expect(result.text.replace(/\x1b\[[0-9;]*m/g, "")).toBe(live.text);
    if (target === "web") expect(result.html).toBe(live.display);
    expect(JSON.parse(snippets.json)).toEqual(buildGlyphDiagramsWorkbenchGraph(state));
    expect(glyphGraphFromMermaid(snippets.mermaid).direction).toBe("LR");
  });
});

describe("table editor (packet item 7 — nodes/edges tables beside Mermaid)", () => {
  it("switching to the table tab derives nodes/edges from whichever source was authoritative", () => {
    const state = reduceGlyphDiagramsWorkbenchState(createGlyphDiagramsWorkbenchState(), { type: "set-editor", editor: "table" });
    const graph = buildGlyphDiagramsWorkbenchGraph(reduceGlyphDiagramsWorkbenchState(createGlyphDiagramsWorkbenchState(), { type: "set-editor", editor: "json" }));
    expect(state.nodes).toEqual(graph.nodes);
    expect(state.edges).toEqual(graph.edges);
  });

  it("setNode edits id/label/kind and takes over authority (sourceKind: table)", () => {
    let state = reduceGlyphDiagramsWorkbenchState(createGlyphDiagramsWorkbenchState(), { type: "set-editor", editor: "table" });
    state = reduceGlyphDiagramsWorkbenchState(state, { type: "set-node", index: 0, patch: { label: "Renamed", kind: "agent" } });
    expect(state.sourceKind).toBe("table");
    expect(state.nodes[0]).toMatchObject({ label: "Renamed", kind: "agent" });
    expect(buildGlyphDiagramsWorkbenchGraph(state).nodes[0]).toMatchObject({ label: "Renamed", kind: "agent" });
  });

  it("setNode preserves the shape field it doesn't expose", () => {
    let state = reduceGlyphDiagramsWorkbenchState(createGlyphDiagramsWorkbenchState(), { type: "set-editor", editor: "json" });
    state = reduceGlyphDiagramsWorkbenchState(state, { type: "edit-source", value: JSON.stringify({ direction: "TB", nodes: [{ id: "a", label: "A", shape: "diamond" }], edges: [] }) });
    state = reduceGlyphDiagramsWorkbenchState(state, { type: "set-editor", editor: "table" });
    state = reduceGlyphDiagramsWorkbenchState(state, { type: "set-node", index: 0, patch: { label: "B" } });
    expect(state.nodes[0]).toMatchObject({ id: "a", label: "B", shape: "diamond" });
  });

  it("addNode appends a node with a fresh, non-colliding id", () => {
    let state = reduceGlyphDiagramsWorkbenchState(createGlyphDiagramsWorkbenchState(), { type: "set-editor", editor: "table" });
    const before = state.nodes.length;
    state = reduceGlyphDiagramsWorkbenchState(state, { type: "add-node" });
    expect(state.nodes).toHaveLength(before + 1);
    expect(new Set(state.nodes.map((n) => n.id)).size).toBe(state.nodes.length);
  });

  it("removeNode drops exactly the targeted node", () => {
    let state = reduceGlyphDiagramsWorkbenchState(createGlyphDiagramsWorkbenchState(), { type: "set-editor", editor: "table" });
    const target = state.nodes[0]!.id;
    state = reduceGlyphDiagramsWorkbenchState(state, { type: "remove-node", index: 0 });
    expect(state.nodes.some((n) => n.id === target)).toBe(false);
  });

  it("setEdge edits from/to/label", () => {
    let state = reduceGlyphDiagramsWorkbenchState(createGlyphDiagramsWorkbenchState(), { type: "set-editor", editor: "table" });
    state = reduceGlyphDiagramsWorkbenchState(state, { type: "set-edge", index: 0, patch: { label: "then" } });
    expect(state.edges[0]!.label).toBe("then");
  });

  it("addEdge/removeEdge add and remove one edge", () => {
    let state = reduceGlyphDiagramsWorkbenchState(createGlyphDiagramsWorkbenchState(), { type: "set-editor", editor: "table" });
    const before = state.edges.length;
    state = reduceGlyphDiagramsWorkbenchState(state, { type: "add-edge" });
    expect(state.edges).toHaveLength(before + 1);
    state = reduceGlyphDiagramsWorkbenchState(state, { type: "remove-edge", index: before });
    expect(state.edges).toHaveLength(before);
  });

  it("a table edit round-trips through Mermaid and back to JSON, keeping the edit", () => {
    let state = reduceGlyphDiagramsWorkbenchState(createGlyphDiagramsWorkbenchState(), { type: "set-editor", editor: "table" });
    state = reduceGlyphDiagramsWorkbenchState(state, { type: "set-node", index: 0, patch: { label: "Edited label" } });
    state = reduceGlyphDiagramsWorkbenchState(state, { type: "set-editor", editor: "mermaid" });
    expect(state.mermaid).toContain("Edited label");
    state = reduceGlyphDiagramsWorkbenchState(state, { type: "set-editor", editor: "json" });
    expect(JSON.parse(state.json).nodes[0].label).toBe("Edited label");
  });

  // Packet D5 — graph dataset search.
  describe("select-remote-graph", () => {
    const remoteGraph = { nodes: [{ id: "0", label: "C" }, { id: "1", label: "N" }], edges: [{ from: "0", to: "1" }], direction: "LR" as const };
    const basePayload = {
      type: "select-remote-graph" as const, graph: remoteGraph, ref: "graphs-datasets/MUTAG", rowIdx: 3, totalRows: 188,
      title: "MUTAG", description: "Molecules.", label: "1", simplified: false,
      source: { name: "MUTAG", url: "https://huggingface.co/datasets/graphs-datasets/MUTAG", licence: "unknown" },
      // P3 fix round.
      originalNodeCount: 17, logicalEdgeCount: 19, edgeDirection: "undirected" as const,
    };

    it("loads the graph into nodes/edges/mermaid/json and records graphSource, including the P3 count/direction readout", () => {
      const state = reduceGlyphDiagramsWorkbenchState(createGlyphDiagramsWorkbenchState(), { ...basePayload, preferred3d: false });
      expect(state.nodes).toEqual(remoteGraph.nodes);
      expect(state.edges).toEqual(remoteGraph.edges);
      expect(JSON.parse(state.json).nodes).toEqual(remoteGraph.nodes);
      expect(state.mermaid).toContain("C");
      expect(state.graphSource).toEqual({
        kind: "remote", ref: "graphs-datasets/MUTAG", rowIdx: 3, totalRows: 188,
        title: "MUTAG", description: "Molecules.", label: "1", simplified: false,
        source: { name: "MUTAG", url: "https://huggingface.co/datasets/graphs-datasets/MUTAG", licence: "unknown" },
        originalNodeCount: 17, logicalEdgeCount: 19, edgeDirection: "undirected",
      });
      expect(state.graphEdited).toBe(false);
      expect(state.view).toBe("2d");
    });

    it("defaults a molecule dataset to the 3D layered view (measured: layered reads cleanly, force does not — see docs/design/diagrams.md's D5 section)", () => {
      const state = reduceGlyphDiagramsWorkbenchState(createGlyphDiagramsWorkbenchState(), { ...basePayload, preferred3d: true });
      expect(state.view).toBe("3d");
      expect(state.view3d.layout).toBe("layered");
    });

    it("a subsequent table edit marks the graph edited, and edited state survives a further edit", () => {
      let state = reduceGlyphDiagramsWorkbenchState(createGlyphDiagramsWorkbenchState(), { ...basePayload, preferred3d: false });
      expect(state.graphEdited).toBe(false);
      state = reduceGlyphDiagramsWorkbenchState(state, { type: "set-editor", editor: "table" });
      state = reduceGlyphDiagramsWorkbenchState(state, { type: "set-node", index: 0, patch: { label: "Edited" } });
      expect(state.graphEdited).toBe(true);
      expect(state.graphSource?.kind).toBe("remote"); // provenance stays visible even once edited
    });

    it("applying a tray preset afterward resets graphSource to the preset and graphEdited to false", () => {
      let state = reduceGlyphDiagramsWorkbenchState(createGlyphDiagramsWorkbenchState(), { ...basePayload, preferred3d: true });
      state = reduceGlyphDiagramsWorkbenchState(state, { type: "apply-preset", id: "chain" });
      expect(state.graphSource).toEqual({ kind: "builtin", presetId: "chain" });
      expect(state.graphEdited).toBe(false);
    });
  });
});
