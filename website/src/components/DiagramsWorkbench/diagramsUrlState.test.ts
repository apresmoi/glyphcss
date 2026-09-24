import { describe, expect, it } from "vitest";
import { glyphGraphFromMermaid } from "@glyphcss/diagrams";
import langgraphExport from "../../../../packages/diagrams/fixtures/langgraph.mmd?raw";
import {
  GLYPH_DIAGRAM_WORKBENCH_PRESETS, createGlyphDiagramsWorkbenchState, reduceGlyphDiagramsWorkbenchState,
  type GlyphDiagramsWorkbenchState,
} from "./diagramsWorkbenchState";
import { DIAGRAMS_URL_PARAM, decodeDiagramsUrlState, diagramsUrlStateForEncode, encodeDiagramsUrlState } from "./diagramsUrlState";
import { glyphDiagramsWorkbenchRenderOptions } from "./diagramsWorkbenchState";

const presetState = (id: string): GlyphDiagramsWorkbenchState =>
  reduceGlyphDiagramsWorkbenchState(createGlyphDiagramsWorkbenchState(), { type: "apply-preset", id });

describe("diagramsUrlState — round trip", () => {
  it("round-trips the default state", async () => {
    const state = createGlyphDiagramsWorkbenchState();
    const raw = await encodeDiagramsUrlState(state);
    expect(await decodeDiagramsUrlState(raw)).toEqual(state);
  });

  it.each(GLYPH_DIAGRAM_WORKBENCH_PRESETS)("round-trips the $label tray preset", async (preset) => {
    const state = presetState(preset.id);
    const raw = await encodeDiagramsUrlState(state);
    expect(await decodeDiagramsUrlState(raw)).toEqual(state);
  });

  it("round-trips a JSON edit carrying every graph field (kind/group/shape/style/priority included)", async () => {
    let state = reduceGlyphDiagramsWorkbenchState(createGlyphDiagramsWorkbenchState(), { type: "set-editor", editor: "json" });
    const graph = JSON.parse(state.json) as { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] };
    graph.nodes.push({ id: "extra", label: "Extra node", kind: "agent", shape: "diamond" });
    graph.edges.push({ from: graph.nodes[0]!.id, to: "extra", label: "routes to", style: "dotted", priority: 3 });
    state = reduceGlyphDiagramsWorkbenchState(state, { type: "edit-source", value: JSON.stringify(graph, null, 2) });
    const raw = await encodeDiagramsUrlState(state);
    expect(await decodeDiagramsUrlState(raw)).toEqual(state);
  });

  // The Table tab is gone (every form edits text through the source editor),
  // but a link saved while it existed names `"table"` as its editor/source
  // and carries the parsed `nodes`/`edges`/`tableGraph` the tab was editing
  // — with NO up-to-date JSON text, because the text tabs only refreshed on
  // a tab switch. Append-only: that link still decodes, with the arrays
  // folded back into the JSON text so the reader's edits are what renders.
  // Mutation: drop the `sourceKind === "table"` branch of
  // `validateDiagramsWorkbenchState` -> `json` stays the link's stale text
  // and the `groups`/`LR` assertions go red.
  describe("a legacy link from the retired Table tab", () => {
    const legacyLink = () => {
      const state = presetState("subgraph"); // has groups and a non-TB direction, the two things the table's own `tableGraph` carried
      const graph = JSON.parse(state.json) as { nodes: { id: string; label: string }[]; edges: unknown[]; groups?: unknown[]; direction: string };
      const nodes = graph.nodes.map((node, i) => (i === 0 ? { ...node, label: "Edited in the table" } : node));
      return {
        state,
        graph,
        legacy: { ...state, editor: "table", sourceKind: "table", nodes, edges: graph.edges, tableGraph: { groups: graph.groups, direction: graph.direction }, json: "[]" } as unknown as GlyphDiagramsWorkbenchState,
      };
    };

    it("decodes with editor/source `json` and the table's arrays folded into the JSON text, groups and direction included", async () => {
      const { graph, legacy } = legacyLink();
      const decoded = await decodeDiagramsUrlState(await encodeDiagramsUrlState(legacy));
      expect(decoded?.editor).toBe("json");
      expect(decoded?.sourceKind).toBe("json");
      const rebuilt = JSON.parse(decoded!.json);
      expect(rebuilt.nodes[0].label).toBe("Edited in the table");
      expect(rebuilt.groups).toEqual(graph.groups);
      expect(rebuilt.direction).toBe(graph.direction);
      expect(decoded).not.toHaveProperty("nodes");
      expect(decoded).not.toHaveProperty("edges");
      expect(decoded).not.toHaveProperty("tableGraph");
    });

    it("a legacy `editor: \"table\"` on a Mermaid-authoritative link shows the Mermaid tab, never a stale JSON one", async () => {
      const { state } = legacyLink();
      const legacy = { ...state, editor: "table", sourceKind: "mermaid" } as unknown as GlyphDiagramsWorkbenchState;
      const decoded = await decodeDiagramsUrlState(await encodeDiagramsUrlState(legacy));
      expect(decoded?.editor).toBe("mermaid");
      expect(decoded?.sourceKind).toBe("mermaid");
      expect(decoded?.json).toBe(state.json);
    });

    it("malformed legacy arrays degrade to the link's own JSON text rather than rejecting the link", async () => {
      const { state, legacy } = legacyLink();
      const broken = { ...legacy, json: state.json, edges: [{ from: "a", to: "b", style: "not-a-real-style" }] } as unknown as GlyphDiagramsWorkbenchState;
      const decoded = await decodeDiagramsUrlState(await encodeDiagramsUrlState(broken));
      expect(decoded?.sourceKind).toBe("json");
      expect(decoded?.json).toBe(state.json);
    });
  });

  // Packet D5 — a remote graph never stores the graph itself in `?d=`.
  describe("a remote graph source", () => {
    const remoteState = (): GlyphDiagramsWorkbenchState => reduceGlyphDiagramsWorkbenchState(createGlyphDiagramsWorkbenchState(), {
      type: "select-remote-graph", ref: "graphs-datasets/MUTAG", rowIdx: 3, totalRows: 188,
      graph: { nodes: [{ id: "0", label: "C" }], edges: [], direction: "LR" },
      title: "MUTAG", description: "Molecules.", label: "1", simplified: false,
      source: { name: "MUTAG", url: "https://huggingface.co/datasets/graphs-datasets/MUTAG", licence: "unknown" },
      preferred3d: false,
      // P3 fix round.
      originalNodeCount: 17, logicalEdgeCount: 19, edgeDirection: "undirected",
    });

    it("round-trips the P3 count/direction readout even for an OMITTED (un-edited) remote graph", async () => {
      const state = remoteState();
      const raw = await encodeDiagramsUrlState(state);
      const decoded = await decodeDiagramsUrlState(raw);
      expect(decoded?.graphSource).toMatchObject({ originalNodeCount: 17, logicalEdgeCount: 19, edgeDirection: "undirected" });
    });

    it("an un-edited remote graph omits mermaid/json from the encoded state, and decodes with graphSource.omitted", async () => {
      const state = remoteState();
      const forEncode = diagramsUrlStateForEncode(state);
      expect(forEncode.mermaid).toBe("");
      expect(forEncode.json).toBe("[]");
      expect(forEncode.graphSource).toMatchObject({ kind: "remote", ref: "graphs-datasets/MUTAG", rowIdx: 3, omitted: true });
      const raw = await encodeDiagramsUrlState(state);
      const decoded = await decodeDiagramsUrlState(raw);
      // The whole point: the graph itself never round-trips for an
      // un-edited remote pick — only the ref/rowIdx/title snapshot does.
      expect(decoded?.mermaid).toBe("");
      expect(decoded?.json).toBe("[]");
      expect(decoded?.graphSource).toMatchObject({ kind: "remote", ref: "graphs-datasets/MUTAG", rowIdx: 3, totalRows: 188, title: "MUTAG", omitted: true });
    });

    it("a remote graph the reader has edited rides in the link in full — never silently discarded", async () => {
      let state = remoteState();
      state = reduceGlyphDiagramsWorkbenchState(state, { type: "set-editor", editor: "json" });
      const graph = JSON.parse(state.json) as { nodes: { label: string }[] };
      graph.nodes[0]!.label = "Edited by hand";
      state = reduceGlyphDiagramsWorkbenchState(state, { type: "edit-source", value: JSON.stringify(graph, null, 2) });
      expect(state.graphEdited).toBe(true);
      const raw = await encodeDiagramsUrlState(state);
      const decoded = await decodeDiagramsUrlState(raw);
      expect(decoded).toEqual(state);
      expect(JSON.parse(decoded!.json).nodes[0].label).toBe("Edited by hand");
      expect(decoded?.graphSource).toEqual(state.graphSource); // no `omitted` stamped on it
    });

    it("an old link naming no graphSource at all still decodes unchanged (append-only)", async () => {
      const state = createGlyphDiagramsWorkbenchState();
      const { graphSource: _dropped, graphEdited: _dropped2, ...withoutGraphSource } = state;
      // Simulate a link encoded before packet D5 by hand-decoding a payload
      // with no `graphSource`/`graphEdited` key at all, mirroring what
      // `HISTORICAL_DEFAULT_LINK`'s own fixed pin, below, already proves
      // for a REAL pre-existing encoded string.
      const raw = await encodeDiagramsUrlState(withoutGraphSource as GlyphDiagramsWorkbenchState);
      const decoded = await decodeDiagramsUrlState(raw);
      expect(decoded?.graphSource).toBeUndefined();
      expect(decoded?.graphEdited).toBeUndefined();
    });
  });

  // Web viewport fill (AGENTS.md's "Diagrams" "Targets and page") — mirrors
  // `chartsUrlState.test.ts`'s own identical test: an OLD link carrying an
  // explicit width/height override on `web` still decodes exactly (the
  // `?d=` envelope is unchanged by this feature), but the render itself
  // ignores it there — only a target switch reactivates it.
  it("an old link carrying width/height on web still decodes exactly, even though the web render now ignores it", async () => {
    let state = createGlyphDiagramsWorkbenchState();
    state = reduceGlyphDiagramsWorkbenchState(state, { type: "set-control", control: { type: "target", value: "web" } });
    state = reduceGlyphDiagramsWorkbenchState(state, { type: "set-control", control: { type: "width", value: 60 } });
    state = reduceGlyphDiagramsWorkbenchState(state, { type: "set-control", control: { type: "height", value: 20 } });
    const raw = await encodeDiagramsUrlState(state);
    const decoded = await decodeDiagramsUrlState(raw);
    expect(decoded).toEqual(state);
    expect(decoded!.controls.overrides.width).toBe(60);
    expect(decoded!.controls.overrides.height).toBe(20);

    const options = glyphDiagramsWorkbenchRenderOptions(decoded!);
    expect(options.width).toBe(96);
    expect(options.height).toBe(32);
    const terminalState = reduceGlyphDiagramsWorkbenchState(decoded!, { type: "set-control", control: { type: "target", value: "terminal" } });
    const terminalOptions = glyphDiagramsWorkbenchRenderOptions(terminalState);
    expect(terminalOptions.width).toBe(60);
    expect(terminalOptions.height).toBe(20);
  });

  it("round-trips unicode Mermaid source and JSON editor text", async () => {
    let state = createGlyphDiagramsWorkbenchState();
    state = reduceGlyphDiagramsWorkbenchState(state, { type: "set-editor", editor: "mermaid" });
    state = reduceGlyphDiagramsWorkbenchState(state, {
      type: "edit-source",
      value: `flowchart LR\n  a["日本語 🎉"] --> b["café — ünïcödé"]\n`,
    });
    const raw = await encodeDiagramsUrlState(state);
    expect(await decodeDiagramsUrlState(raw)).toEqual(state);
  });

  it("round-trips a 200-node/200-edge graph via the JSON editor", async () => {
    const nodes = Array.from({ length: 200 }, (_, i) => ({ id: `n${i}`, label: `Node ${i}` }));
    const edges = Array.from({ length: 199 }, (_, i) => ({ from: `n${i}`, to: `n${i + 1}` }));
    let state = reduceGlyphDiagramsWorkbenchState(createGlyphDiagramsWorkbenchState(), { type: "set-editor", editor: "json" });
    state = reduceGlyphDiagramsWorkbenchState(state, { type: "edit-source", value: JSON.stringify({ nodes, edges, direction: "TB" }) });
    const raw = await encodeDiagramsUrlState(state);
    expect(await decodeDiagramsUrlState(raw)).toEqual(state);
  });

  it("round-trips an empty graph (no nodes, no edges)", async () => {
    let state = reduceGlyphDiagramsWorkbenchState(createGlyphDiagramsWorkbenchState(), { type: "set-editor", editor: "json" });
    state = reduceGlyphDiagramsWorkbenchState(state, { type: "edit-source", value: JSON.stringify({ nodes: [], edges: [], direction: "TB" }) });
    const raw = await encodeDiagramsUrlState(state);
    expect(await decodeDiagramsUrlState(raw)).toEqual(state);
  });

  it("round-trips layout controls, a non-default target and terminal flags", async () => {
    let state = createGlyphDiagramsWorkbenchState();
    state = reduceGlyphDiagramsWorkbenchState(state, { type: "set-control", control: { type: "target", value: "terminal" } });
    state = reduceGlyphDiagramsWorkbenchState(state, { type: "set-control", control: { type: "charset", value: "box" } });
    state = reduceGlyphDiagramsWorkbenchState(state, { type: "set-layout", patch: { direction: "LR", nodesep: 12, ranksep: 8 } });
    state = reduceGlyphDiagramsWorkbenchState(state, { type: "set-diagram", patch: { title: "Renamed", detail: "faithful" } });
    state = reduceGlyphDiagramsWorkbenchState(state, { type: "set-terminal", flag: "FORCE_COLOR", value: true });
    const raw = await encodeDiagramsUrlState(state);
    expect(await decodeDiagramsUrlState(raw)).toEqual(state);
  });

  // Packet D3 — view/view3d/camera3d ride in the SAME `?d=` envelope as
  // every other field (append-only, per this file's own top-of-file rule).
  it("round-trips the 3D view, layout/seed/controlsMode and an Euler camera", async () => {
    let state = createGlyphDiagramsWorkbenchState();
    state = reduceGlyphDiagramsWorkbenchState(state, { type: "set-view", view: "3d" });
    state = reduceGlyphDiagramsWorkbenchState(state, { type: "set-view3d", patch: { layout: "force", seed: 42, controlsMode: "trackball" } });
    state = reduceGlyphDiagramsWorkbenchState(state, { type: "set-camera3d", camera: { rotX: 12.5, rotY: -30, zoom: 8.75 } });
    const raw = await encodeDiagramsUrlState(state);
    expect(await decodeDiagramsUrlState(raw)).toEqual(state);
  });

  it("round-trips a trackball (mat) camera", async () => {
    let state = createGlyphDiagramsWorkbenchState();
    state = reduceGlyphDiagramsWorkbenchState(state, { type: "set-view", view: "3d" });
    state = reduceGlyphDiagramsWorkbenchState(state, { type: "set-camera3d", camera: { zoom: 5, mat: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] } });
    const raw = await encodeDiagramsUrlState(state);
    expect(await decodeDiagramsUrlState(raw)).toEqual(state);
  });

  it("rejects a camera3d carrying both rotX and mat", async () => {
    const raw = await encodeDiagramsUrlState({
      ...createGlyphDiagramsWorkbenchState(),
      view: "3d", camera3d: { rotX: 1, zoom: 5, mat: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
    } as unknown as GlyphDiagramsWorkbenchState);
    expect(await decodeDiagramsUrlState(raw)).toBeNull();
  });

  // Fix round 1, P1-2 — `effect3d` rides the SAME `?d=` envelope, append-only.
  it("round-trips a mounted effect and node target", async () => {
    let state = createGlyphDiagramsWorkbenchState();
    state = reduceGlyphDiagramsWorkbenchState(state, { type: "set-view", view: "3d" });
    state = reduceGlyphDiagramsWorkbenchState(state, { type: "set-effect3d", patch: { effectId: "scan", targetId: "agent" } });
    const raw = await encodeDiagramsUrlState(state);
    expect(await decodeDiagramsUrlState(raw)).toEqual(state);
  });

  it("rejects an effect3d payload with an empty targetId", async () => {
    const raw = await encodeDiagramsUrlState({
      ...createGlyphDiagramsWorkbenchState(),
      effect3d: { effectId: "scan", targetId: "" },
    } as unknown as GlyphDiagramsWorkbenchState);
    expect(await decodeDiagramsUrlState(raw)).toBeNull();
  });

  it("malformed input decodes to null (page falls back to the default state)", async () => {
    expect(await decodeDiagramsUrlState(null)).toBeNull();
    expect(await decodeDiagramsUrlState("")).toBeNull();
    expect(await decodeDiagramsUrlState("garbage")).toBeNull();
    expect(await decodeDiagramsUrlState("v1.not-valid-base64url-or-deflate")).toBeNull();
  });

  it("rejects a payload whose shape is valid JSON but not a GlyphDiagramsWorkbenchState (e.g. an unknown detail level)", async () => {
    const state = createGlyphDiagramsWorkbenchState();
    const raw = await encodeDiagramsUrlState({
      ...state,
      diagram: { ...state.diagram, detail: "not-a-real-detail" },
    } as unknown as GlyphDiagramsWorkbenchState);
    expect(await decodeDiagramsUrlState(raw)).toBeNull();
  });

  it("rejects an editor kind it has never written (not even the retired Table tab's own)", async () => {
    const raw = await encodeDiagramsUrlState({ ...createGlyphDiagramsWorkbenchState(), editor: "yaml" } as unknown as GlyphDiagramsWorkbenchState);
    expect(await decodeDiagramsUrlState(raw)).toBeNull();
  });

  it("rejects an unknown-version param rather than guessing at its shape", async () => {
    const raw = await encodeDiagramsUrlState(createGlyphDiagramsWorkbenchState());
    const mutatedVersion = `v9${raw.slice(2)}`;
    expect(await decodeDiagramsUrlState(mutatedVersion)).toBeNull();
  });
});

describe("diagramsUrlState — fixed historical link (regression pin)", () => {
  // Pasted from a real `encodeDiagramsUrlState(createGlyphDiagramsWorkbenchState())`
  // call against the default state as of this feature's introduction — see
  // AGENTS.md's "## Diagrams" ("URL state"). Additive-only envelope, same
  // rule as chartsUrlState.ts's own pinned link.
  const HISTORICAL_DEFAULT_LINK = "v1.rVVda9swFP0r4o6QFJSuK2MPasnD2m0PKwuUvtUhKJbkaFOkIF-3BOP_PiR_xGnqrJS92NLVuefce66clCCFRueBwUb6DdcCKOSu8Kn8qa04CLcrBqNRqa1GRsqxMu45XXOP47BLC_8kx4yMjbaS-3FVVaNRYjPPt2vycHuV2ASXyxy5x-Vy8ni9nXW764_b2eKMMaa0zzEAeSYtTuLzLOzROZNP4vOsJpJWdDRx3ZEYXnN09GQ6nZHIddVxx1jk68fOSUNGzqezdn3VFfCCKDU8z2-lIkIqXhgkShvDPqhLdaEUDTZM11Jna2Sfzi8PEmKfET51W55q3LGLA0DooaFbqdUXlSYWKPzOnQUGZWIJScA6IfMEGHkMe0LK-hWOtAjxBDoLEqD7U8NX0pwC5Gu-lTUgRy50sUmgPq3ooFb0ZUjn-LCn4V1hhRRv0IhTGNI4PnyXRjP1YceOj0_4FV4LWg9MimxoYMq7zamJoBv0EXem1XZGn-pwL3JM0wq8YuL_FXjVv72EcIhhTP8w_w0lHHfyDhP74xPayxS1szXw4WtAVUDrDxHYYwnxF7KbINC69hexeFuAtVcFKtokxrp6Se2-TWju8D4htthLaPeDCY1_B4W1kaOyFrS-sbGz4OuLPtD1awwOhuxgXxRsMlpARHcFvgndq63B17fjlfJ7FK3GqfIWFFJn0QckKwG5zyQCg2e5AgruSXqv40zLqgpiO1dgAEqbaRsL4ZmX7ejlFthnCp7bP_W6oiA0zzzfRHaNUfuO2-xH_DdsqxISuY6TLtBBRQGl32jLTUj7NV_ezO_m98AUN7mk8H1-f_PtIFZVfwE";

  it("decodes to exactly today's default state, except the fields packet D5 (graphSource/graphEdited) added after this link was captured", async () => {
    const decoded = await decodeDiagramsUrlState(HISTORICAL_DEFAULT_LINK);
    // This link predates `graphSource`/`graphEdited` entirely — append-only
    // means it decodes with them genuinely ABSENT (`diagramsUrlState.ts`'s
    // own doc), not backfilled to today's default `{ kind: "builtin", ... }`
    // — every OTHER field still pins exactly, so a regression to any of
    // them still reddens this test.
    // The link carries the default source AS IT WAS when captured — the
    // raw LangGraph export, `<p>` tags and all. The page's own default has
    // since been cleaned of that markup (`cleanPresetMermaid`,
    // `diagramsWorkbenchState.ts`), so the two text fields are pinned to
    // the historical text here; every other field still pins to today's
    // default, and the LINK itself is untouched.
    const historicalDefault = { ...createGlyphDiagramsWorkbenchState(), mermaid: langgraphExport, json: JSON.stringify(glyphGraphFromMermaid(langgraphExport), null, 2) };
    expect(decoded).toEqual({ ...historicalDefault, graphSource: undefined, graphEdited: undefined });
  });

  it("mutation: changing the version prefix on the SAME historical link breaks the decode (proves the pin actually discriminates)", async () => {
    const mutated = `v9${HISTORICAL_DEFAULT_LINK.slice(2)}`;
    expect(await decodeDiagramsUrlState(mutated)).toBeNull();
  });

  it("mutation: truncating the SAME historical link breaks the decode", async () => {
    const mutated = HISTORICAL_DEFAULT_LINK.slice(0, Math.floor(HISTORICAL_DEFAULT_LINK.length / 2));
    expect(await decodeDiagramsUrlState(mutated)).toBeNull();
  });
});

describe("diagramsUrlState — param name", () => {
  it("uses 'd' as the query param key", () => {
    expect(DIAGRAMS_URL_PARAM).toBe("d");
  });
});
