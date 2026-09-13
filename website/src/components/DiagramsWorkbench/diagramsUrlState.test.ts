import { describe, expect, it } from "vitest";
import {
  GLYPH_DIAGRAM_WORKBENCH_PRESETS, createGlyphDiagramsWorkbenchState, reduceGlyphDiagramsWorkbenchState,
  type GlyphDiagramsWorkbenchState,
} from "./diagramsWorkbenchState";
import { DIAGRAMS_URL_PARAM, decodeDiagramsUrlState, encodeDiagramsUrlState } from "./diagramsUrlState";

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

  it("round-trips the table editor with edited nodes/edges (kind/group/shape/style/priority included)", async () => {
    let state = reduceGlyphDiagramsWorkbenchState(createGlyphDiagramsWorkbenchState(), { type: "set-editor", editor: "table" });
    state = reduceGlyphDiagramsWorkbenchState(state, { type: "add-node" });
    state = reduceGlyphDiagramsWorkbenchState(state, { type: "set-node", index: state.nodes.length - 1, patch: { id: "extra", label: "Extra node", kind: "agent" } });
    state = reduceGlyphDiagramsWorkbenchState(state, { type: "add-edge" });
    state = reduceGlyphDiagramsWorkbenchState(state, { type: "set-edge", index: state.edges.length - 1, patch: { from: state.nodes[0]!.id, to: "extra", label: "routes to" } });
    const raw = await encodeDiagramsUrlState(state);
    expect(await decodeDiagramsUrlState(raw)).toEqual(state);
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
    let state = reduceGlyphDiagramsWorkbenchState(createGlyphDiagramsWorkbenchState(), { type: "set-editor", editor: "table" });
    for (const edge of [...state.edges].keys()) void edge; // no-op placeholder for symmetry with node removal below
    while (state.edges.length > 0) state = reduceGlyphDiagramsWorkbenchState(state, { type: "remove-edge", index: 0 });
    while (state.nodes.length > 0) state = reduceGlyphDiagramsWorkbenchState(state, { type: "remove-node", index: 0 });
    expect(state.nodes).toHaveLength(0);
    expect(state.edges).toHaveLength(0);
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

  it("malformed input decodes to null (page falls back to the default state)", async () => {
    expect(await decodeDiagramsUrlState(null)).toBeNull();
    expect(await decodeDiagramsUrlState("")).toBeNull();
    expect(await decodeDiagramsUrlState("garbage")).toBeNull();
    expect(await decodeDiagramsUrlState("v1.not-valid-base64url-or-deflate")).toBeNull();
  });

  it("rejects a payload whose shape is valid JSON but not a GlyphDiagramsWorkbenchState (e.g. an unknown edge style)", async () => {
    const raw = await encodeDiagramsUrlState({
      ...createGlyphDiagramsWorkbenchState(),
      edges: [{ from: "a", to: "b", style: "not-a-real-style" }],
    } as unknown as GlyphDiagramsWorkbenchState);
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

  it("decodes to exactly today's default state", async () => {
    const decoded = await decodeDiagramsUrlState(HISTORICAL_DEFAULT_LINK);
    expect(decoded).toEqual(createGlyphDiagramsWorkbenchState());
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
