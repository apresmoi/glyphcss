// The `sequence` form's own state/reducer/URL-state tests — mirrors the
// graph pipeline's own coverage in `diagramsWorkbenchState.test.ts` and
// `diagramsUrlState.test.ts`, one level down. No DOM here (see
// `DiagramsWorkbench.sequence.test.tsx` for the mounted-page assertions);
// this file is the fast, non-DOM half.
import { describe, expect, it } from "vitest";
import { glyphSequenceFromMermaid } from "@glyphcss/diagrams/sequence";
import {
  GLYPH_DIAGRAMS_FORMS, GLYPH_SEQUENCE_WORKBENCH_PRESETS, buildGlyphDiagramsWorkbenchSequence,
  createGlyphDiagramsWorkbenchState, glyphDiagramsWorkbenchSequenceMermaid, reduceGlyphDiagramsWorkbenchState,
  resolveGlyphDiagramsWorkbenchControls,
} from "./diagramsWorkbenchState";
import { decodeDiagramsUrlState, encodeDiagramsUrlState } from "./diagramsUrlState";

const applyPreset = (id: string) => reduceGlyphDiagramsWorkbenchState(createGlyphDiagramsWorkbenchState(), { type: "apply-sequence-preset", id });

describe("diagramsWorkbenchState — form descriptor table", () => {
  it("is a table (data), not a chain of conditionals: `graph` supports 3D, `sequence` does not", () => {
    expect(GLYPH_DIAGRAMS_FORMS).toEqual([
      { id: "graph", label: "Graph", supports3d: true },
      { id: "sequence", label: "Sequence", supports3d: false },
      { id: "lanes", label: "Lanes", supports3d: false },
    ]);
  });
});

describe("diagramsWorkbenchState — apply-sequence-preset", () => {
  it.each(GLYPH_SEQUENCE_WORKBENCH_PRESETS)("applying '$label' switches the form to sequence, resets view to 2d, and parses a real sequence with at least one message", (preset) => {
    const state = applyPreset(preset.id);
    expect(state.form).toBe("sequence");
    expect(state.view).toBe("2d");
    expect(state.sequence.presetId).toBe(preset.id);
    const sequence = buildGlyphDiagramsWorkbenchSequence(state);
    expect(sequence.participants.length).toBeGreaterThan(0);
    expect(sequence.messages.length).toBeGreaterThan(0);
  });

  // Mutation-check #1 — if `set-form`'s `supports3d` gate were removed (or
  // inverted), a reader stranded in 3D before switching form would stay
  // there on a form that can't render it; this must always land on "2d".
  it("mutation: switching form to sequence while the view is 3d forces it back to 2d and clears camera3d", () => {
    let state = createGlyphDiagramsWorkbenchState();
    state = reduceGlyphDiagramsWorkbenchState(state, { type: "set-view", view: "3d" });
    expect(state.view).toBe("3d");
    state = reduceGlyphDiagramsWorkbenchState(state, { type: "set-form", form: "sequence" });
    expect(state.view).toBe("2d");
    expect(state.camera3d).toBeUndefined();
  });

  it("does not touch the graph fields — switching to sequence and back finds the graph exactly as it was left", () => {
    let state = createGlyphDiagramsWorkbenchState();
    const graphBefore = { mermaid: state.mermaid, json: state.json, sourceKind: state.sourceKind };
    state = reduceGlyphDiagramsWorkbenchState(state, { type: "apply-sequence-preset", id: "login" });
    state = reduceGlyphDiagramsWorkbenchState(state, { type: "set-form", form: "graph" });
    expect(state.mermaid).toBe(graphBefore.mermaid);
    expect(state.json).toBe(graphBefore.json);
    expect(state.sourceKind).toBe(graphBefore.sourceKind);
  });
});

describe("diagramsWorkbenchState — sequence editor tab refresh", () => {
  it("set-sequence-editor refreshes JSON from the Mermaid-authoritative source, never stealing authority", () => {
    const state = reduceGlyphDiagramsWorkbenchState(applyPreset("login"), { type: "set-sequence-editor", editor: "json" });
    expect(state.sequence.sourceKind).toBe("mermaid"); // unchanged — a tab switch is a refresh, not an edit
    expect(JSON.parse(state.sequence.json)).toEqual(glyphSequenceFromMermaid(GLYPH_SEQUENCE_WORKBENCH_PRESETS[0].source));
  });

  it("edit-sequence-source makes the edited tab authoritative and clears the preset id", () => {
    const state = reduceGlyphDiagramsWorkbenchState(applyPreset("login"), { type: "edit-sequence-source", value: "sequenceDiagram\n  participant A\n" });
    expect(state.sequence.sourceKind).toBe("mermaid");
    expect(state.sequence.presetId).toBeUndefined();
  });

  // Mutation-check #2 — this is the property the Mermaid<->JSON tab pair
  // depends on: a JSON-authoritative sequence must still produce VALID,
  // round-trippable Mermaid when the reader switches to that tab. Breaking
  // `glyphDiagramsWorkbenchSequenceMermaid`'s alt/else chain detection (the
  // one non-trivial piece of that serializer) reddens this for the one
  // preset that actually has an alt/else pair.
  it.each(GLYPH_SEQUENCE_WORKBENCH_PRESETS)("'$label' round-trips through Mermaid -> IR -> Mermaid -> IR with an identical IR", (preset) => {
    const original = glyphSequenceFromMermaid(preset.source);
    const regenerated = glyphDiagramsWorkbenchSequenceMermaid(original);
    const roundTripped = glyphSequenceFromMermaid(regenerated);
    expect(roundTripped).toEqual(original);
  });

  it("a JSON-authoritative sequence switched to the Mermaid tab produces mermaid that re-parses to the same IR (login preset's alt/else)", () => {
    let state = applyPreset("login");
    state = reduceGlyphDiagramsWorkbenchState(state, { type: "set-sequence-editor", editor: "json" });
    // Now JSON is on screen but Mermaid stays authoritative until an edit;
    // force JSON to become authoritative the same way a reader's keystroke
    // would (edit-sequence-source on the currently shown tab).
    state = reduceGlyphDiagramsWorkbenchState(state, { type: "edit-sequence-source", value: state.sequence.json });
    expect(state.sequence.sourceKind).toBe("json");
    const backToMermaid = reduceGlyphDiagramsWorkbenchState(state, { type: "set-sequence-editor", editor: "mermaid" });
    expect(backToMermaid.sequence.mermaid).toContain("alt credentials valid");
    expect(backToMermaid.sequence.mermaid).toContain("else invalid credentials");
    expect(glyphSequenceFromMermaid(backToMermaid.sequence.mermaid)).toEqual(buildGlyphDiagramsWorkbenchSequence(state));
  });
});

describe("diagramsWorkbenchState — per-form target defaults", () => {
  it("resolves the sequence pipeline's own GLYPH_SEQUENCE_TARGET_DEFAULTS, not the graph pipeline's table", () => {
    const controls = { target: "chat" as const, overrides: {} };
    expect(resolveGlyphDiagramsWorkbenchControls(controls, "sequence")).toEqual({ target: "chat", width: 72, height: 24, charset: "box", color: "none" });
  });

  it("an omitted form argument still resolves exactly as before (graph) — no behaviour change for every pre-existing call site", () => {
    const controls = { target: "web" as const, overrides: {} };
    expect(resolveGlyphDiagramsWorkbenchControls(controls)).toEqual(resolveGlyphDiagramsWorkbenchControls(controls, "graph"));
  });
});

describe("diagramsUrlState — sequence form round trip", () => {
  it.each(GLYPH_SEQUENCE_WORKBENCH_PRESETS)("round-trips the sequence preset '$label'", async (preset) => {
    const state = applyPreset(preset.id);
    const raw = await encodeDiagramsUrlState(state);
    expect(await decodeDiagramsUrlState(raw)).toEqual(state);
  });

  it("round-trips a hand-edited sequence (JSON-authoritative, no presetId)", async () => {
    let state = applyPreset("login");
    const json = state.sequence.json;
    state = reduceGlyphDiagramsWorkbenchState(state, { type: "set-sequence-editor", editor: "json" });
    state = reduceGlyphDiagramsWorkbenchState(state, { type: "edit-sequence-source", value: json });
    const raw = await encodeDiagramsUrlState(state);
    expect(await decodeDiagramsUrlState(raw)).toEqual(state);
  });

  it("an old link with no form/sequence fields at all decodes to today's default form and sequence", async () => {
    const raw = await encodeDiagramsUrlState(createGlyphDiagramsWorkbenchState());
    const decoded = await decodeDiagramsUrlState(raw);
    expect(decoded?.form).toBe("graph");
    expect(decoded?.sequence).toEqual(createGlyphDiagramsWorkbenchState().sequence);
  });

  it("rejects a sequence slice with an unknown editor kind rather than guessing at its shape", async () => {
    const state = applyPreset("login");
    const corrupted = { ...state, sequence: { ...state.sequence, editor: "yaml" } } as unknown as Parameters<typeof encodeDiagramsUrlState>[0];
    const raw = await encodeDiagramsUrlState(corrupted);
    expect(await decodeDiagramsUrlState(raw)).toBeNull();
  });
});
