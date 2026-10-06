import { describe, expect, it } from "vitest";
import { glyphGraphFromMermaid, renderGlyphDiagram, type GlyphDiagramRenderOptions } from "@glyphcss/diagrams";
import {
  GLYPH_DIAGRAM_WORKBENCH_PRESETS,
  buildGlyphDiagramsWorkbenchGraph,
  cleanPresetMermaid,
  createGlyphDiagramsWorkbenchState,
  generateGlyphDiagramsWorkbenchSnippets,
  glyphDiagramsWorkbenchMermaid,
  reduceGlyphDiagramsWorkbenchControls,
  reduceGlyphDiagramsWorkbenchState,
  resolveGlyphDiagramsWorkbenchControls,
} from "./diagramsWorkbenchState";
import langgraphExport from "../../../../../packages/diagrams/fixtures/langgraph.mmd?raw";
import { renderGlyphDiagramsWorkbenchState } from "../render/diagramsWorkbenchRender";

describe("diagram workbench state and exports", () => {
  it.each(["subgraph", "crew"])(
    "applying the '%s' preset, switching to JSON, and editing one node keeps rendering — groups and direction survive the round trip",
    async (id) => {
      const preset = GLYPH_DIAGRAM_WORKBENCH_PRESETS.find((p) => p.id === id)!;
      const sourceGraph = glyphGraphFromMermaid(preset.source);
      expect(sourceGraph.groups?.length ?? 0).toBeGreaterThan(0); // sanity: the fixture actually has a group.
      let state = reduceGlyphDiagramsWorkbenchState(createGlyphDiagramsWorkbenchState(), { type: "apply-preset", id });
      state = reduceGlyphDiagramsWorkbenchState(state, { type: "set-editor", editor: "json" });
      const edited = JSON.parse(state.json) as { nodes: { label: string }[] };
      edited.nodes[0]!.label = `${edited.nodes[0]!.label} (edited)`;
      state = reduceGlyphDiagramsWorkbenchState(state, { type: "edit-source", value: JSON.stringify(edited, null, 2) });
      const graph = buildGlyphDiagramsWorkbenchGraph(state);
      expect(graph.groups).toEqual(sourceGraph.groups);
      expect(graph.direction).toBe(sourceGraph.direction);
      const rendered = await renderGlyphDiagramsWorkbenchState(state);
      expect(rendered.ok).toBe(true);
    },
  );

  it("a malformed JSON draft fails with the library's own tagged GLYPH_DIAGRAM_BAD_JSON, never a bare SyntaxError", async () => {
    // Mutation: put `JSON.parse` back in `buildGlyphDiagramsWorkbenchGraph`
    // -> `code` is undefined and the editor's error strip loses both its
    // rule code and its repair hint.
    let state = reduceGlyphDiagramsWorkbenchState(createGlyphDiagramsWorkbenchState(), {
      type: "set-editor",
      editor: "json",
    });
    state = reduceGlyphDiagramsWorkbenchState(state, { type: "edit-source", value: "{" });
    const rendered = await renderGlyphDiagramsWorkbenchState(state);
    expect(rendered).toMatchObject({ ok: false, code: "GLYPH_DIAGRAM_BAD_JSON" });
  });

  it.each([
    { type: "charset", value: "box" },
    { type: "color", value: "none" },
    { type: "width", value: 72 },
    { type: "height", value: 24 },
  ] as const)("keeps explicitly choosing the old default for $type across a target change", (action) => {
    const controls = reduceGlyphDiagramsWorkbenchControls({ target: "chat", overrides: {} }, action);
    expect(
      resolveGlyphDiagramsWorkbenchControls(
        reduceGlyphDiagramsWorkbenchControls(controls, { type: "target", value: "web" }),
      ),
    ).toEqual({ target: "web", charset: "braille", color: "css", width: 96, height: 32, [action.type]: action.value });
  });

  it("switching editor tabs preserves JSON-only metadata until the source is edited", () => {
    let state = reduceGlyphDiagramsWorkbenchState(createGlyphDiagramsWorkbenchState(), {
      type: "set-editor",
      editor: "json",
    });
    const graph = buildGlyphDiagramsWorkbenchGraph(state);
    const authored = {
      ...graph,
      nodes: graph.nodes.map((node) => ({ ...node, kind: "agent" })),
      edges: graph.edges.map((edge) => ({ ...edge, priority: 8 })),
    };
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
    let state = reduceGlyphDiagramsWorkbenchState(createGlyphDiagramsWorkbenchState(), {
      type: "set-editor",
      editor: "json",
    });
    const graph = buildGlyphDiagramsWorkbenchGraph(state);
    const authored = {
      ...graph,
      nodes: graph.nodes.map((node, i) => (i === 0 ? { ...node, label: 'a\\\\server\\share "quoted"' } : node)),
    };
    state = reduceGlyphDiagramsWorkbenchState(state, { type: "edit-source", value: JSON.stringify(authored) });
    state = reduceGlyphDiagramsWorkbenchState(state, { type: "set-editor", editor: "mermaid" });
    state = reduceGlyphDiagramsWorkbenchState(state, { type: "edit-source", value: state.mermaid });
    // Mutation: decode HTML entities and Mermaid quote-escapes as two
    // sequential whole-string passes instead of one combined scan -> the
    // entity-produced backslashes in this label get eaten and this fails.
    expect(buildGlyphDiagramsWorkbenchGraph(state).nodes.map((n) => n.label)).toEqual(
      authored.nodes.map((n) => n.label),
    );
    state = reduceGlyphDiagramsWorkbenchState(state, { type: "set-editor", editor: "json" });
    expect(JSON.parse(state.json).nodes.map((n: { label: string }) => n.label)).toEqual(
      authored.nodes.map((n) => n.label),
    );
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
  it('round-trips an edge label containing a pipe through the Mermaid exporter\'s own |"..."| shape', () => {
    const graph = {
      direction: "LR" as const,
      nodes: [
        { id: "A", label: "A", shape: "rect" as const },
        { id: "B", label: "B", shape: "rect" as const },
      ],
      edges: [{ from: "A", to: "B", style: "solid" as const, label: "a|b" }],
    };
    const mermaid = glyphDiagramsWorkbenchMermaid(graph);
    expect(mermaid).toContain('|"a|b"|');
    expect(glyphGraphFromMermaid(mermaid)).toEqual(graph);
  });

  it("Mermaid export represents every supported shape, edge style, group and quoted label", () => {
    const shapes = ["rect", "rounded", "diamond", "circle", "subroutine", "asymmetric", "stadium"] as const;
    const graph = {
      direction: "LR" as const,
      nodes: shapes.map((shape, i) => ({ id: `node ${i}`, label: i === 0 ? 'A "quoted" label' : shape, shape })),
      edges: ["solid", "dotted", "thick", "undirected"].map((style, i) => ({
        from: `node ${i}`,
        to: `node ${i + 1}`,
        label: "edge",
        style: style as "solid" | "dotted" | "thick" | "undirected",
      })),
      groups: [{ id: "crew", label: "Crew", members: ["node 0", "node 1"] }],
    };
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
      nodes: [
        { id: "A", label: "A" },
        { id: "B", label: "B" },
      ],
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

  it.each(["chat", "terminal", "web"] as const)(
    "executes the exported %s TypeScript call and matches the live render",
    async (target) => {
      let state = createGlyphDiagramsWorkbenchState();
      state = {
        ...state,
        controls: {
          target,
          overrides: {
            width: 60,
            height: 20,
            charset: "ascii",
            color: target === "terminal" ? "ansi16" : target === "web" ? "css" : "none",
          },
        },
        layout: { direction: "LR", engine: "dagre", nodesep: 5, ranksep: 5 },
        diagram: { title: "My agent", detail: "faithful" },
        terminal: { NO_COLOR: true, FORCE_COLOR: true },
      };
      const snippets = generateGlyphDiagramsWorkbenchSnippets(state);
      let capturedOptions: GlyphDiagramRenderOptions | undefined;
      const execute = new Function(
        "renderGlyphDiagram",
        `return (async () => {${snippets.typescript.replace(/^import[^\n]+\n/, "")} return diagram;})();`,
      );
      const result = await execute(
        async (input: Parameters<typeof renderGlyphDiagram>[0], options: GlyphDiagramRenderOptions) => {
          capturedOptions = options;
          return renderGlyphDiagram(input, options);
        },
      );
      // `web` ignores the width/height override — it fills the measured
      // viewport instead (`diagramsWorkbenchSizeLocked`); with no viewport to
      // measure here, `glyphDiagramsWorkbenchRenderOptions` falls back to the
      // target's own default grid (96x32). Only `terminal`/`chat` still
      // honour the dialed-in 60x20 override.
      const expectedWidth = target === "web" ? 96 : 60;
      const expectedHeight = target === "web" ? 32 : 20;
      expect(capturedOptions).toMatchObject({
        target,
        width: expectedWidth,
        height: expectedHeight,
        direction: "LR",
        nodesep: 5,
        ranksep: 5,
        detail: "faithful",
      });
      // No `title` reaches the render — USER FEEDBACK, verbatim: "why do we
      // have the titles of the diagrams in the rendering areas? we should only
      // have the diagrams, not titles". The snippet must reproduce exactly
      // what the page shows, so it must not carry one either.
      expect(capturedOptions).not.toHaveProperty("title");
      const live = await renderGlyphDiagramsWorkbenchState(state);
      expect(live.ok).toBe(true);
      if (!live.ok) return;
      expect(result.text.replace(/\x1b\[[0-9;]*m/g, "")).toBe(live.text);
      if (target === "web") expect(result.html).toBe(live.display);
      expect(JSON.parse(snippets.json)).toEqual(buildGlyphDiagramsWorkbenchGraph(state));
      expect(glyphGraphFromMermaid(snippets.mermaid).direction).toBe("LR");
    },
  );

  // The export snippet is the reader's OWN source, readable as such — a
  // template literal carrying the real line breaks, never a one-line
  // `"sequenceDiagram\n  participant…"` string that reads as hardcoded.
  it("the TypeScript snippet carries the current Mermaid source verbatim in a template literal and the options the page actually rendered with", async () => {
    let state = reduceGlyphDiagramsWorkbenchState(createGlyphDiagramsWorkbenchState(), {
      type: "apply-preset",
      id: "chain",
    });
    const source = "flowchart LR\n  a[Alpha] --> b[`tick` and ${not} a template]\n";
    state = reduceGlyphDiagramsWorkbenchState(state, { type: "edit-source", value: source });
    // chat + an explicit braille override: the page renders `box` (a chat
    // font has no braille), so the snippet must print `box` too. Mutation:
    // drop `glyphDiagramsWorkbenchChatCharset` from the snippet path -> the
    // printed charset is `braille` -> red.
    state = reduceGlyphDiagramsWorkbenchState(state, {
      type: "set-control",
      control: { type: "target", value: "chat" },
    });
    state = reduceGlyphDiagramsWorkbenchState(state, {
      type: "set-control",
      control: { type: "charset", value: "braille" },
    });
    const snippets = generateGlyphDiagramsWorkbenchSnippets(state);
    expect(snippets.typescript).toContain(
      "const source = `flowchart LR\n  a[Alpha] --> b[\\`tick\\` and \\${not} a template]\n`;",
    );
    expect(snippets.typescript).not.toContain("\\n  a[Alpha]");
    let captured: GlyphDiagramRenderOptions | undefined;
    const execute = new Function(
      "renderGlyphDiagram",
      `return (async () => {${snippets.typescript.replace(/^import[^\n]+\n/, "")} return diagram;})();`,
    );
    const result = await execute(async (input: string, options: GlyphDiagramRenderOptions) => {
      captured = options;
      return renderGlyphDiagram(input, options);
    });
    expect(captured).toMatchObject({ target: "chat", charset: "box" });
    expect(glyphGraphFromMermaid(source).nodes[1]!.label).toBe("`tick` and ${not} a template");
    const live = await renderGlyphDiagramsWorkbenchState(state);
    expect(live.ok && result.text === live.text).toBe(true);
  });
});

describe("cleanPresetMermaid — the page's LangGraph copy carries no HTML and renders exactly like the fixture", () => {
  it("strips <p> wrappers (and turns <br> into a space) without changing the parsed graph", async () => {
    // Mutation: return `source` unchanged -> `<p>` survives -> red.
    const cleaned = cleanPresetMermaid(langgraphExport);
    expect(cleaned).not.toMatch(/<\/?p>/);
    expect(langgraphExport).toMatch(/<p>__start__<\/p>/); // the fixture itself stays the real export
    expect(glyphGraphFromMermaid(cleaned)).toEqual(glyphGraphFromMermaid(langgraphExport));
    expect(cleanPresetMermaid("flowchart TB\n  a[<b>Bold</b><br/>two]")).toBe("flowchart TB\n  a[Bold two]");
    const preset = GLYPH_DIAGRAM_WORKBENCH_PRESETS.find((p) => p.id === "langgraph")!;
    expect(preset.source).toBe(cleaned);
    expect(createGlyphDiagramsWorkbenchState().mermaid).toBe(cleaned);
    const fixture = await renderGlyphDiagram(langgraphExport, { target: "web", width: 96, height: 32, color: "none" });
    const page = await renderGlyphDiagram(cleaned, { target: "web", width: 96, height: 32, color: "none" });
    expect(page.text).toBe(fixture.text);
  });
});

describe("source editing (Mermaid and JSON tabs over the one source editor)", () => {
  it("a JSON edit round-trips through Mermaid and back to JSON, keeping the edit", () => {
    let state = reduceGlyphDiagramsWorkbenchState(createGlyphDiagramsWorkbenchState(), {
      type: "set-editor",
      editor: "json",
    });
    const edited = JSON.parse(state.json) as { nodes: { label: string }[] };
    edited.nodes[0]!.label = "Edited label";
    state = reduceGlyphDiagramsWorkbenchState(state, { type: "edit-source", value: JSON.stringify(edited) });
    expect(state.sourceKind).toBe("json");
    state = reduceGlyphDiagramsWorkbenchState(state, { type: "set-editor", editor: "mermaid" });
    expect(state.mermaid).toContain("Edited label");
    state = reduceGlyphDiagramsWorkbenchState(state, { type: "set-editor", editor: "json" });
    expect(JSON.parse(state.json).nodes[0].label).toBe("Edited label");
  });

  it("switching tabs off an unparseable draft moves authority to the shown tab rather than throwing", () => {
    let state = reduceGlyphDiagramsWorkbenchState(createGlyphDiagramsWorkbenchState(), {
      type: "edit-source",
      value: "flowchart LR\n  a[Broken",
    });
    state = reduceGlyphDiagramsWorkbenchState(state, { type: "set-editor", editor: "json" });
    expect(state.editor).toBe("json");
    expect(state.sourceKind).toBe("json");
  });

  // Packet D5 — graph dataset search.
  describe("select-remote-graph", () => {
    const remoteGraph = {
      nodes: [
        { id: "0", label: "C" },
        { id: "1", label: "N" },
      ],
      edges: [{ from: "0", to: "1" }],
      direction: "LR" as const,
    };
    const basePayload = {
      type: "select-remote-graph" as const,
      graph: remoteGraph,
      ref: "graphs-datasets/MUTAG",
      rowIdx: 3,
      totalRows: 188,
      title: "MUTAG",
      description: "Molecules.",
      label: "1",
      simplified: false,
      source: { name: "MUTAG", url: "https://huggingface.co/datasets/graphs-datasets/MUTAG", licence: "unknown" },
      // P3 fix round.
      originalNodeCount: 17,
      logicalEdgeCount: 19,
      edgeDirection: "undirected" as const,
    };

    it("loads the graph into mermaid/json and records graphSource, including the P3 count/direction readout", () => {
      const state = reduceGlyphDiagramsWorkbenchState(createGlyphDiagramsWorkbenchState(), { ...basePayload });
      expect(state.sourceKind).toBe("json");
      expect(JSON.parse(state.json).nodes).toEqual(remoteGraph.nodes);
      expect(JSON.parse(state.json).edges).toEqual(remoteGraph.edges);
      expect(state.mermaid).toContain("C");
      expect(state.graphSource).toEqual({
        kind: "remote",
        ref: "graphs-datasets/MUTAG",
        rowIdx: 3,
        totalRows: 188,
        title: "MUTAG",
        description: "Molecules.",
        label: "1",
        simplified: false,
        source: { name: "MUTAG", url: "https://huggingface.co/datasets/graphs-datasets/MUTAG", licence: "unknown" },
        originalNodeCount: 17,
        logicalEdgeCount: 19,
        edgeDirection: "undirected",
      });
      expect(state.graphEdited).toBe(false);
    });

    it("a subsequent source edit marks the graph edited, and edited state survives a further edit", () => {
      let state = reduceGlyphDiagramsWorkbenchState(createGlyphDiagramsWorkbenchState(), { ...basePayload });
      expect(state.graphEdited).toBe(false);
      state = reduceGlyphDiagramsWorkbenchState(state, { type: "set-editor", editor: "json" });
      state = reduceGlyphDiagramsWorkbenchState(state, {
        type: "edit-source",
        value: state.json.replace('"C"', '"Edited"'),
      });
      expect(state.graphEdited).toBe(true);
      expect(state.graphSource?.kind).toBe("remote"); // provenance stays visible even once edited
    });

    it("applying a tray preset afterward resets graphSource to the preset and graphEdited to false", () => {
      let state = reduceGlyphDiagramsWorkbenchState(createGlyphDiagramsWorkbenchState(), { ...basePayload });
      state = reduceGlyphDiagramsWorkbenchState(state, { type: "apply-preset", id: "chain" });
      expect(state.graphSource).toEqual({ kind: "builtin", presetId: "chain" });
      expect(state.graphEdited).toBe(false);
    });
  });
});

describe("automatic graph direction state", () => {
  it("defaults fresh state to Auto and disables it when choosing a direction", () => {
    let state = createGlyphDiagramsWorkbenchState();
    expect(state.layout.autoDirection).toBe(true);
    state = reduceGlyphDiagramsWorkbenchState(state, { type: "set-layout", patch: { nodesep: 8 } });
    expect(state.layout.autoDirection).toBe(true);
    state = reduceGlyphDiagramsWorkbenchState(state, { type: "set-layout", patch: { direction: "LR" } });
    expect(state.layout.autoDirection).toBe(false);
    expect(state.layout.direction).toBe("LR");
    state = reduceGlyphDiagramsWorkbenchState(state, {
      type: "set-layout",
      patch: { direction: "TB", autoDirection: true },
    });
    expect(state.layout.autoDirection).toBe(true);
  });

  it("exports graph integrations with native render options from the current state", () => {
    const state = reduceGlyphDiagramsWorkbenchState(createGlyphDiagramsWorkbenchState(), {
      type: "set-layout",
      patch: { direction: "RL", nodesep: 9 },
    });
    const snippets = generateGlyphDiagramsWorkbenchSnippets(state);
    for (const format of ["html", "typescript", "react", "vue"]) {
      expect(snippets[format]).toContain('"direction": "RL"');
      expect(snippets[format]).toContain('"nodesep": 9');
      expect(snippets[format]).toContain('"autoDirection": false');
      expect(snippets[format]).toContain('"overflow": "expand"');
    }
  });
});
