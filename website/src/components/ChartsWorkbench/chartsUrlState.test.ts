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

  // Owner packet item 1/2/3 — legend/title placement additions. Append-only:
  // `validateChartsWorkbenchState` defaults these three to "bottom"/"center"/
  // "top" when absent (see the fixed historical link below, encoded before
  // this feature existed, which still decodes correctly for that reason),
  // so this test's own job is the OTHER half — a link saved WITH an explicit
  // non-default choice must round-trip that choice exactly, not silently
  // fall back to the default on decode.
  it("round-trips non-default legend placement and title align/position", async () => {
    let state = createChartsWorkbenchState();
    state = reduceChartsWorkbenchState(state, { type: "set-chart", patch: { legendPlacement: "top-right", titleAlign: "left", titlePosition: "bottom" } });
    const raw = await encodeChartsUrlState(state);
    const decoded = await decodeChartsUrlState(raw);
    expect(decoded).toEqual(state);
    expect(decoded!.chart.legendPlacement).toBe("top-right");
    expect(decoded!.chart.titleAlign).toBe("left");
    expect(decoded!.chart.titlePosition).toBe("bottom");
  });

  it("rejects an out-of-vocabulary legendPlacement/titleAlign/titlePosition rather than guessing", async () => {
    const base = createChartsWorkbenchState();
    for (const patch of [{ legendPlacement: "middle" }, { titleAlign: "diagonal" }, { titlePosition: "middle" }]) {
      const raw = await encodeChartsUrlState({ ...base, chart: { ...base.chart, ...patch } } as unknown as ChartsWorkbenchState);
      expect(await decodeChartsUrlState(raw)).toBeNull();
    }
  });

  // Data folder (AGENTS.md's "Charts" — "Data layer"), appended after `v1`
  // already existed: an old link with no `data` key at all still decodes to
  // today's default `{ source: null, pipeline: [] }` (proven by the fixed
  // historical link below, encoded before this field existed), so this
  // test's own job is round-tripping a source/pipeline a reader DID set.
  it("round-trips a dataset source with pipeline steps", async () => {
    let state = createChartsWorkbenchState();
    state = reduceChartsWorkbenchState(state, { type: "set-data-source", source: { kind: "dataset", id: "world-population-by-country" } });
    state = reduceChartsWorkbenchState(state, { type: "set-pipeline", pipeline: [
      { kind: "filter", column: "country", operator: "==", value: "Germany" },
      { kind: "sort", column: "year", direction: "desc" },
      { kind: "limit", count: 10 },
    ] });
    state = reduceChartsWorkbenchState(state, { type: "apply-data", mark: "line", channels: { x: "year", y: "population" } });
    const raw = await encodeChartsUrlState(state);
    expect(await decodeChartsUrlState(raw)).toEqual(state);
  });

  it("round-trips a custom pasted source with a select/flatten/derive pipeline", async () => {
    let state = createChartsWorkbenchState();
    state = reduceChartsWorkbenchState(state, { type: "set-data-source", source: { kind: "custom", raw: '{"items":[{"id":1,"meta":{"n":"a"}}]}', filename: "data.json" } });
    state = reduceChartsWorkbenchState(state, { type: "set-pipeline", pipeline: [
      { kind: "select", path: "items[*]" }, { kind: "flatten" }, { kind: "derive", column: "double", expression: "id * 2" },
    ] });
    const raw = await encodeChartsUrlState(state);
    expect(await decodeChartsUrlState(raw)).toEqual(state);
  });

  // ── P2-5 — a custom payload over the size-warn threshold never rides in
  // the `?c=` envelope; a link saved before this cap existed still
  // round-trips exactly ──────────────────────────────────────────────────
  it("keeps an under-threshold custom source in the envelope untouched (byte-identical to before P2-5)", async () => {
    let state = createChartsWorkbenchState();
    state = reduceChartsWorkbenchState(state, { type: "set-data-source", source: { kind: "custom", raw: "a,b\n1,2", filename: "small.csv" } });
    const raw = await encodeChartsUrlState(state);
    expect(await decodeChartsUrlState(raw)).toEqual(state);
    const decoded = await decodeChartsUrlState(raw);
    expect(decoded!.data.source).toEqual({ kind: "custom", raw: "a,b\n1,2", filename: "small.csv" });
  });

  it("drops an over-threshold custom source's raw payload from the encoded link, keeping the filename and every OTHER setting", async () => {
    let state = createChartsWorkbenchState();
    const hugeRaw = `a,b\n${Array.from({ length: 2000 }, (_, i) => `${i},${i}`).join("\n")}`;
    expect(new TextEncoder().encode(hugeRaw).length).toBeGreaterThan(8192);
    state = reduceChartsWorkbenchState(state, { type: "set-data-source", source: { kind: "custom", raw: hugeRaw, filename: "huge.csv" } });
    state = reduceChartsWorkbenchState(state, { type: "set-chart", patch: { title: "Kept setting" } });
    const raw = await encodeChartsUrlState(state);
    const decoded = await decodeChartsUrlState(raw);
    expect(decoded).not.toBeNull();
    // The reader's own in-memory state is untouched — only the encoded copy differs.
    expect(state.data.source).toEqual({ kind: "custom", raw: hugeRaw, filename: "huge.csv" });
    expect(decoded!.data.source).toEqual({ kind: "custom", raw: "", omitted: true, filename: "huge.csv" });
    expect(decoded!.chart.title).toBe("Kept setting");
    // Mutation check: an un-omitted encode of the same state would carry
    // the whole 20KB+ payload — the encoded link itself must be small.
    expect(raw.length).toBeLessThan(2000);
  });

  it("a decoded omitted custom source resolves to a clear 'paste it again' error, not silent empty rows", async () => {
    const { resolveChartsDataRows } = await import("./chartsDataSource");
    let state = createChartsWorkbenchState();
    state = reduceChartsWorkbenchState(state, { type: "set-data-source", source: { kind: "custom", raw: "x".repeat(20000), filename: "huge.csv" } });
    const raw = await encodeChartsUrlState(state);
    const decoded = await decodeChartsUrlState(raw);
    const resolved = resolveChartsDataRows(decoded!.data.source!, decoded!.data.pipeline);
    expect(resolved).toEqual({ ok: false, error: "Custom data isn't in this link — paste or upload it again." });
  });

  it("accepts a payload-carrying custom source with an explicit omitted:false the same as one with the key absent", async () => {
    const raw = await encodeChartsUrlState(reduceChartsWorkbenchState(createChartsWorkbenchState(), {
      type: "set-data-source", source: { kind: "custom", raw: "a,b\n1,2" },
    }));
    expect(await decodeChartsUrlState(raw)).not.toBeNull();
  });

  it("rejects a malformed omitted flag (not exactly true) rather than guessing", async () => {
    const base = createChartsWorkbenchState();
    const withBadFlag = { ...base, data: { source: { kind: "custom", raw: "a", omitted: "yes" }, pipeline: [] } };
    const raw = await encodeChartsUrlState(withBadFlag as unknown as ChartsWorkbenchState);
    expect(await decodeChartsUrlState(raw)).toBeNull();
  });

  // Colour controls (this packet), appended after `v1` already existed —
  // the fixed historical link below (encoded before this feature existed,
  // carrying no `style` key and no mark `color` key at all) still decodes
  // to today's default `style` and every mark's `color` left unset, so
  // this test's own job is the OTHER half: a link saved WITH a customised
  // axis colour and per-series mark colours round-trips them exactly.
  it("round-trips a per-axis colour choice and a per-series mark colour array", async () => {
    let state = createChartsWorkbenchState();
    state = reduceChartsWorkbenchState(state, { type: "set-axis-color-mode", mode: "per-axis" });
    state = reduceChartsWorkbenchState(state, { type: "set-axis-color", which: "x", color: "#ff0000" });
    state = reduceChartsWorkbenchState(state, { type: "set-axis-color", which: "y", color: "#00ff00" });
    state = reduceChartsWorkbenchState(state, { type: "set-mark-color", id: state.marks[0]!.id, color: ["#3b82f6", "#f97316"] });
    const raw = await encodeChartsUrlState(state);
    const decoded = await decodeChartsUrlState(raw);
    expect(decoded).toEqual(state);
    expect(decoded!.style.axisColor).toEqual({ mode: "per-axis", shared: expect.any(String), x: "#ff0000", y: "#00ff00" });
    expect(decoded!.marks[0]!.color).toEqual(["#3b82f6", "#f97316"]);
  });

  it("rejects a malformed axis colour mode or a non-hex mark colour rather than guessing", async () => {
    const base = createChartsWorkbenchState();
    const badMode = await encodeChartsUrlState({ ...base, style: { axisColor: { ...base.style.axisColor, mode: "rainbow" } } } as unknown as ChartsWorkbenchState);
    expect(await decodeChartsUrlState(badMode)).toBeNull();
    const badMarkColor = await encodeChartsUrlState({ ...base, marks: [{ ...base.marks[0]!, color: "not-a-hex-colour" }] } as unknown as ChartsWorkbenchState);
    expect(await decodeChartsUrlState(badMarkColor)).toBeNull();
  });

  it("rejects a pipeline step with an out-of-vocabulary operator/kind", async () => {
    const base = createChartsWorkbenchState();
    const withBadStep = { ...base, data: { source: null, pipeline: [{ kind: "filter", column: "a", operator: "~=", value: "1" }] } };
    const raw = await encodeChartsUrlState(withBadStep as unknown as ChartsWorkbenchState);
    expect(await decodeChartsUrlState(raw)).toBeNull();
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
