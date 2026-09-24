// The `lanes` form's own state/reducer/URL-state tests — mirrors the
// sequence pipeline's own coverage in `diagramsSequenceForm.test.ts`, one
// level down. No DOM here (see `DiagramsWorkbench.lanes.test.tsx` for the
// mounted-page assertions, including the footer tray); this file is the
// fast, non-DOM half.
import { describe, expect, it } from "vitest";
import { glyphLaneDagFromGitLog, validateGlyphLaneDag } from "@glyphcss/diagrams/lanes";
import {
  GLYPH_LANES_WORKBENCH_PRESETS, buildGlyphDiagramsWorkbenchLanes, createGlyphDiagramsWorkbenchState,
  glyphDiagramsWorkbenchLanesGitLog, reduceGlyphDiagramsWorkbenchState, resolveGlyphDiagramsWorkbenchControls,
} from "./diagramsWorkbenchState";
import { decodeDiagramsUrlState, encodeDiagramsUrlState } from "./diagramsUrlState";

const applyPreset = (id: string) => reduceGlyphDiagramsWorkbenchState(createGlyphDiagramsWorkbenchState(), { type: "apply-lanes-preset", id });

describe("diagramsWorkbenchState — presets are not all git (domain-agnostic IR)", () => {
  it("at least one lane preset carries no git vocabulary (JSON-sourced)", () => {
    expect(GLYPH_LANES_WORKBENCH_PRESETS.some((p) => p.sourceKind === "json")).toBe(true);
    expect(GLYPH_LANES_WORKBENCH_PRESETS.some((p) => p.sourceKind === "gitlog")).toBe(true);
  });
});

describe("diagramsWorkbenchState — apply-lanes-preset", () => {
  it.each(GLYPH_LANES_WORKBENCH_PRESETS)("applying '$label' switches the form to lanes, resets view to 2d, and parses a real DAG with at least one node", (preset) => {
    const state = applyPreset(preset.id);
    expect(state.form).toBe("lanes");
    expect(state.view).toBe("2d");
    expect(state.lanes.presetId).toBe(preset.id);
    const dag = buildGlyphDiagramsWorkbenchLanes(state);
    expect(dag.nodes.length).toBeGreaterThan(0);
  });

  // Mutation-check #1 — if `set-form`'s `supports3d` gate were removed (or
  // the lanes row's own `supports3d: false` flipped), a reader stranded in
  // 3D before switching form would stay there on a form that can't render
  // it; this must always land on "2d".
  it("mutation: switching form to lanes while the view is 3d forces it back to 2d and clears camera3d", () => {
    let state = createGlyphDiagramsWorkbenchState();
    state = reduceGlyphDiagramsWorkbenchState(state, { type: "set-view", view: "3d" });
    expect(state.view).toBe("3d");
    state = reduceGlyphDiagramsWorkbenchState(state, { type: "set-form", form: "lanes" });
    expect(state.view).toBe("2d");
    expect(state.camera3d).toBeUndefined();
  });

  it("does not touch the graph or sequence fields — switching to lanes and back finds them exactly as left", () => {
    let state = createGlyphDiagramsWorkbenchState();
    const graphBefore = { mermaid: state.mermaid, json: state.json, sourceKind: state.sourceKind };
    const sequenceBefore = state.sequence;
    state = reduceGlyphDiagramsWorkbenchState(state, { type: "apply-lanes-preset", id: "ci-pipeline" });
    state = reduceGlyphDiagramsWorkbenchState(state, { type: "set-form", form: "graph" });
    expect(state.mermaid).toBe(graphBefore.mermaid);
    expect(state.json).toBe(graphBefore.json);
    expect(state.sourceKind).toBe(graphBefore.sourceKind);
    expect(state.sequence).toEqual(sequenceBefore);
  });
});

describe("diagramsWorkbenchState — lanes editor tab refresh", () => {
  it("set-lanes-editor refreshes JSON from the git-log-authoritative source, never stealing authority", () => {
    const state = reduceGlyphDiagramsWorkbenchState(applyPreset("release-train"), { type: "set-lanes-editor", editor: "json" });
    expect(state.lanes.sourceKind).toBe("gitlog"); // unchanged — a tab switch is a refresh, not an edit
    expect(JSON.parse(state.lanes.json)).toEqual(glyphLaneDagFromGitLog(GLYPH_LANES_WORKBENCH_PRESETS[0]!.source));
  });

  it("edit-lanes-source makes the edited tab authoritative and clears the preset id", () => {
    const state = reduceGlyphDiagramsWorkbenchState(applyPreset("release-train"), { type: "edit-lanes-source", value: "a|||A commit" });
    expect(state.lanes.sourceKind).toBe("gitlog");
    expect(state.lanes.presetId).toBeUndefined();
  });

  // Mutation-check #2 — this is the property the git-log<->JSON tab pair
  // depends on: a JSON-authoritative DAG must still produce VALID,
  // round-trippable git-log text when the reader switches to that tab.
  // Breaking `glyphDiagramsWorkbenchLanesGitLog`'s decoration/parent
  // serialization reddens this for every preset, including the merge/branch
  // shapes.
  it.each(GLYPH_LANES_WORKBENCH_PRESETS)("'$label' round-trips through git-log -> IR -> git-log -> IR with an identical IR", (preset) => {
    const original = preset.sourceKind === "gitlog" ? glyphLaneDagFromGitLog(preset.source) : validateGlyphLaneDag(JSON.parse(preset.source));
    const regenerated = glyphDiagramsWorkbenchLanesGitLog(original);
    const roundTripped = glyphLaneDagFromGitLog(regenerated);
    expect(roundTripped).toEqual(original);
  });
});

describe("diagramsWorkbenchState — lanes JSON edits", () => {
  it("a JSON edit makes the JSON tab authoritative, clears the preset id, and builds through buildGlyphDiagramsWorkbenchLanes", () => {
    let state = reduceGlyphDiagramsWorkbenchState(applyPreset("data-lineage"), { type: "set-lanes-editor", editor: "json" });
    const dag = JSON.parse(state.lanes.json) as { nodes: { label: string }[] };
    dag.nodes[0]!.label = "Edited label";
    state = reduceGlyphDiagramsWorkbenchState(state, { type: "edit-lanes-source", value: JSON.stringify(dag) });
    expect(state.lanes.sourceKind).toBe("json");
    expect(state.lanes.presetId).toBeUndefined();
    expect(buildGlyphDiagramsWorkbenchLanes(state).nodes[0]!.label).toBe("Edited label");
  });

  it("a malformed JSON draft fails with the library's own tagged GLYPH_LANE_BAD_JSON code", () => {
    const state = reduceGlyphDiagramsWorkbenchState(reduceGlyphDiagramsWorkbenchState(applyPreset("data-lineage"), { type: "set-lanes-editor", editor: "json" }), { type: "edit-lanes-source", value: "{ nodes: [" });
    expect(() => buildGlyphDiagramsWorkbenchLanes(state)).toThrow(expect.objectContaining({ code: "GLYPH_LANE_BAD_JSON" }));
  });
});

describe("diagramsWorkbenchState — per-form target defaults", () => {
  it("resolves the lanes pipeline's own GLYPH_LANE_TARGET_DEFAULTS, not the graph pipeline's table", () => {
    const controls = { target: "terminal" as const, overrides: {} };
    expect(resolveGlyphDiagramsWorkbenchControls(controls, "lanes")).toEqual({ target: "terminal", width: 80, height: 24, charset: "braille", color: "truecolor" });
  });
});

describe("diagramsUrlState — lanes form round trip", () => {
  it.each(GLYPH_LANES_WORKBENCH_PRESETS)("round-trips the lanes preset '$label'", async (preset) => {
    const state = applyPreset(preset.id);
    const raw = await encodeDiagramsUrlState(state);
    expect(await decodeDiagramsUrlState(raw)).toEqual(state);
  });

  it("round-trips a hand-edited lanes DAG (JSON-authoritative, no presetId)", async () => {
    let state = reduceGlyphDiagramsWorkbenchState(applyPreset("ci-pipeline"), { type: "set-lanes-editor", editor: "json" });
    state = reduceGlyphDiagramsWorkbenchState(state, { type: "edit-lanes-source", value: JSON.stringify({ nodes: [{ id: "a", label: "A", parents: [] }] }) });
    expect(state.lanes.presetId).toBeUndefined();
    const raw = await encodeDiagramsUrlState(state);
    expect(await decodeDiagramsUrlState(raw)).toEqual(state);
  });

  // The Table tab is gone, but a link saved while it existed still names
  // `"table"` and carries the parsed `nodes` array it edited. Append-only:
  // that link decodes with the array folded into the JSON text. Mutation:
  // drop the `sourceKind === "table"` branch of `validateLanesState` -> the
  // decoded JSON is the link's stale text and `nodes[0].label` is wrong.
  it("a legacy link whose lanes source was the retired Table tab decodes with its nodes folded into the JSON text", async () => {
    const state = applyPreset("ci-pipeline");
    const legacyNodes = [{ id: "only", label: "Edited in the table", parents: [] }];
    const legacy = { ...state, lanes: { ...state.lanes, editor: "table", sourceKind: "table", nodes: legacyNodes } } as unknown as Parameters<typeof encodeDiagramsUrlState>[0];
    const decoded = await decodeDiagramsUrlState(await encodeDiagramsUrlState(legacy));
    expect(decoded?.lanes.editor).toBe("json");
    expect(decoded?.lanes.sourceKind).toBe("json");
    expect(JSON.parse(decoded!.lanes.json)).toEqual({ nodes: legacyNodes });
    expect(buildGlyphDiagramsWorkbenchLanes(decoded!).nodes[0]!.label).toBe("Edited in the table");
    expect(decoded).not.toHaveProperty("lanes.nodes");
  });

  it("a legacy Table link whose nodes array is malformed degrades to the link's own JSON text rather than rejecting the link", async () => {
    const state = reduceGlyphDiagramsWorkbenchState(applyPreset("ci-pipeline"), { type: "set-lanes-editor", editor: "json" });
    const legacy = { ...state, lanes: { ...state.lanes, editor: "table", sourceKind: "table", nodes: [{ id: "a", label: "A", parents: [1, 2] }] } } as unknown as Parameters<typeof encodeDiagramsUrlState>[0];
    const decoded = await decodeDiagramsUrlState(await encodeDiagramsUrlState(legacy));
    expect(decoded?.lanes).toEqual({ ...state.lanes, editor: "json", sourceKind: "json" });
  });

  it("an old link with no form/lanes fields at all decodes to today's default form and lanes", async () => {
    const raw = await encodeDiagramsUrlState(createGlyphDiagramsWorkbenchState());
    const decoded = await decodeDiagramsUrlState(raw);
    expect(decoded?.form).toBe("graph");
    expect(decoded?.lanes).toEqual(createGlyphDiagramsWorkbenchState().lanes);
  });

  it("rejects a lanes slice with an unknown editor kind rather than guessing at its shape", async () => {
    const state = applyPreset("release-train");
    const corrupted = { ...state, lanes: { ...state.lanes, editor: "yaml" } } as unknown as Parameters<typeof encodeDiagramsUrlState>[0];
    const raw = await encodeDiagramsUrlState(corrupted);
    expect(await decodeDiagramsUrlState(raw)).toBeNull();
  });

  it("rejects a lanes slice whose git-log text is not a string", async () => {
    const state = applyPreset("release-train");
    const corrupted = { ...state, lanes: { ...state.lanes, gitlog: 42 } } as unknown as Parameters<typeof encodeDiagramsUrlState>[0];
    const raw = await encodeDiagramsUrlState(corrupted);
    expect(await decodeDiagramsUrlState(raw)).toBeNull();
  });
});
