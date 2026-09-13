import { describe, expect, it } from "vitest";
import {
  CHART_PRESETS, createChartsWorkbenchState, reduceChartsWorkbenchState,
  type ChartsWorkbenchState,
} from "./chartsWorkbenchState";
import { CHARTS_URL_PARAM, decodeChartsUrlState, encodeChartsUrlState } from "./chartsUrlState";

const presetState = (id: string): ChartsWorkbenchState =>
  reduceChartsWorkbenchState(createChartsWorkbenchState(), { type: "apply-preset", id });

describe("chartsUrlState — round trip", () => {
  it("round-trips the default state", async () => {
    const state = createChartsWorkbenchState();
    const raw = await encodeChartsUrlState(state);
    expect(await decodeChartsUrlState(raw)).toEqual(state);
  });

  it.each(CHART_PRESETS)("round-trips the $label tray preset", async (preset) => {
    const state = presetState(preset.id);
    const raw = await encodeChartsUrlState(state);
    expect(await decodeChartsUrlState(raw)).toEqual(state);
  });

  it("round-trips every mark type added via 'add-mark', with edited channels/transform/options", async () => {
    let state = createChartsWorkbenchState();
    for (const type of ["line", "area", "bar", "dot", "arc", "rect", "cell", "text", "rule"] as const) {
      state = reduceChartsWorkbenchState(state, { type: "add-mark", markType: type });
    }
    state = reduceChartsWorkbenchState(state, {
      type: "update-mark",
      id: state.marks[1]!.id,
      patch: { transform: "stack", options: { name: "Series A", innerRadius: 0.4, axis: "x" } },
    });
    const raw = await encodeChartsUrlState(state);
    expect(await decodeChartsUrlState(raw)).toEqual(state);
  });

  it("round-trips unicode labels/titles and a 200-row mark", async () => {
    let state = createChartsWorkbenchState();
    state = reduceChartsWorkbenchState(state, { type: "set-chart", patch: { title: "月間売上 — café 🎉", description: "Ünïcödé desc\nwith a newline" } });
    const bigData = JSON.stringify(Array.from({ length: 200 }, (_, i) => ({ month: `月${i}`, value: i, region: i % 2 === 0 ? "北" : "南" })));
    state = reduceChartsWorkbenchState(state, {
      type: "update-mark", id: state.marks[0]!.id,
      patch: { dataText: bigData, channels: { x: "month", y: "value", fill: "region" } },
    });
    const raw = await encodeChartsUrlState(state);
    expect(await decodeChartsUrlState(raw)).toEqual(state);
  });

  it("round-trips an empty-marks state", async () => {
    let state = createChartsWorkbenchState();
    for (const mark of [...state.marks]) state = reduceChartsWorkbenchState(state, { type: "remove-mark", id: mark.id });
    expect(state.marks).toHaveLength(0);
    const raw = await encodeChartsUrlState(state);
    expect(await decodeChartsUrlState(raw)).toEqual(state);
  });

  it("round-trips scale/axis/terminal overrides and a non-default target", async () => {
    let state = createChartsWorkbenchState();
    state = reduceChartsWorkbenchState(state, { type: "set-control", control: { type: "target", value: "terminal" } });
    state = reduceChartsWorkbenchState(state, { type: "set-control", control: { type: "charset", value: "braille" } });
    state = reduceChartsWorkbenchState(state, { type: "set-control", control: { type: "width", value: 57 } });
    state = reduceChartsWorkbenchState(state, { type: "set-scale", axis: "x", patch: { type: "log", min: "1", max: "100" } });
    state = reduceChartsWorkbenchState(state, { type: "set-axis", axis: "y", patch: { ticks: 4, tickMarks: false, title: "Value", grid: true } });
    state = reduceChartsWorkbenchState(state, { type: "set-terminal", flag: "NO_COLOR", value: true });
    const raw = await encodeChartsUrlState(state);
    expect(await decodeChartsUrlState(raw)).toEqual(state);
  });

  it("malformed input decodes to null (page falls back to the default state)", async () => {
    expect(await decodeChartsUrlState(null)).toBeNull();
    expect(await decodeChartsUrlState("")).toBeNull();
    expect(await decodeChartsUrlState("garbage")).toBeNull();
    expect(await decodeChartsUrlState("v1.not-valid-base64url-or-deflate")).toBeNull();
  });

  it("rejects a payload whose shape is valid JSON but not a ChartsWorkbenchState (e.g. an unknown mark type)", async () => {
    const raw = await encodeChartsUrlState({ ...createChartsWorkbenchState(), marks: [{ id: 1, type: "not-a-real-type", dataText: "[]", channels: {}, transform: "none", options: {} }] } as unknown as ChartsWorkbenchState);
    expect(await decodeChartsUrlState(raw)).toBeNull();
  });

  it("rejects an unknown-version param rather than guessing at its shape", async () => {
    const raw = await encodeChartsUrlState(createChartsWorkbenchState());
    const mutatedVersion = `v9${raw.slice(2)}`;
    expect(await decodeChartsUrlState(mutatedVersion)).toBeNull();
  });
});

describe("chartsUrlState — fixed historical link (regression pin)", () => {
  // Pasted from a real `encodeChartsUrlState(createChartsWorkbenchState())`
  // call against the default state as of this feature's introduction — see
  // AGENTS.md's "## Charts" ("URL state"). A future wire-format change is
  // additive-only (new optional fields), so this EXACT string must keep
  // decoding to EXACTLY today's default state forever; only an incompatible
  // reshape bumps the version prefix and starts a new pinned string here.
  const HISTORICAL_DEFAULT_LINK = "v1.lVHLasMwEPyVMGcd2vRBq2tooZDUEHpLQtnYm1REXgdZTh2M_r1Ickp7ay_DstqZHc0OqMkdWujVAFNBXyv485GhYY0wFCry9Ma9h8ZqLZPJjYp4l3Ca8CHhfcLHhLdr2UCh_CARti30gB4aRiruoXCGxolsF-V3xlpoQMHSllMZFLwjaXeNq6EhTfLRHL1pJGkJ1dHgkk8sHSOEjYJw7xfkDi8V9FShbMS7Jq_25PYc_X_yNgqd2DlTcXwLQaEtyfLF43D5PXW-gUJtJLurqR-9nf8wFRSo_ylqypjxlUrVIifuXcex4S1n9t7FC-zItvy959_EkHJ3PrPzyHw8JbelMynHMXLes1RZMKbOrjZCNlJfi_dZMS-Wo6zCc7GcPf3qhfAF";

  it("decodes to exactly today's default state", async () => {
    const decoded = await decodeChartsUrlState(HISTORICAL_DEFAULT_LINK);
    expect(decoded).toEqual(createChartsWorkbenchState());
  });

  it("mutation: changing the version prefix on the SAME historical link breaks the decode (proves the pin actually discriminates)", async () => {
    const mutated = `v9${HISTORICAL_DEFAULT_LINK.slice(2)}`;
    expect(await decodeChartsUrlState(mutated)).toBeNull();
  });

  it("mutation: truncating the SAME historical link breaks the decode", async () => {
    const mutated = HISTORICAL_DEFAULT_LINK.slice(0, Math.floor(HISTORICAL_DEFAULT_LINK.length / 2));
    expect(await decodeChartsUrlState(mutated)).toBeNull();
  });
});

describe("chartsUrlState — param name", () => {
  it("uses 'c' as the query param key", () => {
    expect(CHARTS_URL_PARAM).toBe("c");
  });
});
