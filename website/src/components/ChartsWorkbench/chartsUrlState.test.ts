import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CHART_PRESETS, CHARTS_3D_DATASETS, CHARTS_CUSTOM_MAX_BYTES, CHARTS_DATASETS, createChartsWorkbenchState, reduceChartsWorkbenchState,
  type ChartsWorkbenchState,
} from "./chartsWorkbenchState";
import { buildDatasetMark, resolveChartsDataRows } from "./chartsDataSource";
import {
  CHARTS_URL_PARAM, CHARTS_URL_SIZE_WARN_BYTES, chartsUrlStateForEncode, chartsUrlStateResolveDataset, createChartsUrlWriter, decodeChartsUrlState,
  encodeChartsUrlState, encodeChartsUrlStateInfo,
} from "./chartsUrlState";

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
      patch: { transform: "stack", options: { name: "Series A", innerRadius: 0.4, axis: "x", strokeWidth: 3 } },
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

  // Density (append-only, appended after `v1` already existed): a link
  // saved with an explicit density round-trips it exactly, and a link
  // saved before this feature existed (no `density` key at all) decodes to
  // exactly the same state it always did — `createChartsWorkbenchState()`'s
  // own default `overrides: {}`, never a materialized `density: 1`.
  it("round-trips an explicit density override, on a non-web target too", async () => {
    let state = createChartsWorkbenchState();
    state = reduceChartsWorkbenchState(state, { type: "set-control", control: { type: "density", value: 2.75 } });
    state = reduceChartsWorkbenchState(state, { type: "set-control", control: { type: "target", value: "terminal" } });
    const raw = await encodeChartsUrlState(state);
    expect(await decodeChartsUrlState(raw)).toEqual(state);
  });

  // P3-11 (REVIEW-arc-density-search-opus.md): a hand-edited/hostile link
  // could carry ANY finite width/height/density — `createGlyphCanvas`
  // allocates `cols * rows` typed arrays for whatever comes out, so an
  // absurd value is an allocation-size class, not merely a display bug.
  // Clamped to the exact ranges the page's own sliders enforce.
  it("clamps an out-of-range width/height/density on decode to the Dock's own slider bounds, rather than rejecting or allocating unbounded", async () => {
    let state = createChartsWorkbenchState();
    state = reduceChartsWorkbenchState(state, { type: "set-control", control: { type: "target", value: "web" } });
    state = reduceChartsWorkbenchState(state, { type: "set-control", control: { type: "width", value: 1_000_000 } });
    const raw = await encodeChartsUrlState({ ...state, controls: { ...state.controls, overrides: { ...state.controls.overrides, height: -50, density: 999 } } });
    const decoded = await decodeChartsUrlState(raw);
    expect(decoded).not.toBeNull();
    expect(decoded!.controls.overrides.width).toBe(240); // CHARTS_WIDTH_SLIDER_MAX
    expect(decoded!.controls.overrides.height).toBe(6); // CHARTS_HEIGHT_SLIDER_MIN
    expect(decoded!.controls.overrides.density).toBeLessThanOrEqual(4); // CHARTS_DENSITY_MAX
    expect(decoded!.controls.overrides.density).toBeGreaterThanOrEqual(1); // CHARTS_DENSITY_MIN
  });

  it("decodes a pre-density link (no density key) to the default, unmaterialized overrides", async () => {
    const state = createChartsWorkbenchState();
    const raw = await encodeChartsUrlState(state);
    const decoded = await decodeChartsUrlState(raw);
    expect(decoded!.controls.overrides).not.toHaveProperty("density");
    expect(decoded).toEqual(state);
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
  // `select-dataset` always resolves with an EMPTY pipeline (no pipeline
  // editor left to have set one beforehand), but `set-pipeline` still works
  // as its own reducer action — a `?c=` link can still carry one (a
  // hand-built link, or a future caller of the action directly), and this
  // pins that it round-trips unchanged alongside a dataset-derived mark.
  it("round-trips a dataset source with pipeline steps set after selection", async () => {
    let state = createChartsWorkbenchState();
    state = reduceChartsWorkbenchState(state, { type: "select-dataset", id: "world-population-by-country" });
    state = reduceChartsWorkbenchState(state, { type: "set-pipeline", pipeline: [
      { kind: "filter", column: "country", operator: "==", value: "Germany" },
      { kind: "sort", column: "year", direction: "desc" },
      { kind: "limit", count: 10 },
    ] });
    const raw = await encodeChartsUrlState(state);
    expect(await decodeChartsUrlState(raw)).toEqual(state);
  });

  // AGENTS.md's "## Charts" — "URL state": "the mark's DATA is never in the
  // link for a stock dataset (it's re-derived from the id on decode)".
  it("round-trips every vendored dataset, carrying dataset + mark and no dataText", async () => {
    for (const dataset of CHARTS_DATASETS) {
      const state = reduceChartsWorkbenchState(createChartsWorkbenchState(), { type: "select-dataset", id: dataset.id });
      const raw = await encodeChartsUrlState(state);
      expect(await decodeChartsUrlState(raw)).toEqual(state);
    }
  });

  // P3-1 follow-up (REVIEW-arc-density-search-opus.md): `dataText` is
  // OMITTED from the wire entirely for an omitted mark now (never the
  // `"[]"` sentinel string), so a reader that doesn't understand
  // `dataOmitted` sees a genuinely missing field instead of a
  // plausible-but-wrong empty array.
  it("chartsUrlStateForEncode omits a stock-dataset mark's dataText KEY entirely, flagged by dataOmitted", async () => {
    const state = reduceChartsWorkbenchState(createChartsWorkbenchState(), { type: "select-dataset", id: "world-population-by-country" });
    const forEncode = chartsUrlStateForEncode(state);
    expect(forEncode.data.source).toEqual(state.data.source);
    expect(forEncode.marks[0]!.dataText).toBeUndefined();
    expect(Object.hasOwn(forEncode.marks[0]!, "dataText")).toBe(false);
    expect(forEncode.marks[0]!.dataOmitted).toBe(true);
    // The mark's real content never changes in the reader's own state —
    // only the copy handed to the encoder.
    expect(state.marks[0]!.dataText).not.toBe("[]");
  });

  // P2-2 (review fix, REVIEW-showcase-opus.md): the commit's headline
  // guarantee — "a shared chart link carries no rows for a stock dataset"
  // — was pinned by ONE assertion on ONE dataset; this loops over the
  // WHOLE index and checks the property the two round-trip tests above
  // never actually observe (only that decode equals encode, which holds
  // whether or not rows were omitted). Mutation check: reverting
  // `chartsUrlStateForEncode` to the identity function makes every
  // iteration's `dataText`/size assertion fail, for all 16 datasets — not
  // just the one dataset the pre-existing test happened to cover.
  it("every vendored dataset's link carries no rows: dataText is omitted and the encoded envelope stays small", async () => {
    for (const dataset of CHARTS_DATASETS) {
      const state = reduceChartsWorkbenchState(createChartsWorkbenchState(), { type: "select-dataset", id: dataset.id });
      expect(state.marks[0]!.dataText.length).toBeGreaterThan(2); // sanity: the mark really did get real rows first
      const info = await encodeChartsUrlStateInfo(state);
      expect(chartsUrlStateForEncode(state).marks[0]!.dataText, `dataset ${dataset.id}`).toBeUndefined();
      expect(info.sizeBytes, `dataset ${dataset.id}`).toBeLessThan(2048);
    }
  });

  // P3-2 (review fix, REVIEW-showcase-opus.md): a mark's `dataText` reading
  // literally `"[]"` under a `"dataset"` source is NOT by itself proof the
  // rows were omitted — the parent UI's old table editor could (and did)
  // produce a genuine empty array this same way, by design, before this
  // sentinel existed. Only `dataOmitted: true` (absent here, since this
  // link is hand-built to look exactly like that pre-existing case) may
  // trigger rehydration; without it, decode must leave the real (if empty)
  // content alone rather than silently substituting the full dataset.
  it("a mark whose dataText is genuinely \"[]\" with NO dataOmitted flag is never rehydrated to the full dataset", async () => {
    const state = reduceChartsWorkbenchState(createChartsWorkbenchState(), { type: "select-dataset", id: "iris-flowers" });
    const handBuilt = { ...state, marks: [{ ...state.marks[0]!, dataText: "[]" }] };
    const raw = await encodeChartsUrlState(handBuilt);
    const decoded = await decodeChartsUrlState(raw);
    expect(decoded!.marks[0]!.dataText).toBe("[]");
    expect(decoded!.marks[0]!.dataOmitted).toBeUndefined();
  });

  it("decoding re-derives a blanked stock-dataset mark's dataText from the dataset id + its own x channel", async () => {
    const state = reduceChartsWorkbenchState(createChartsWorkbenchState(), { type: "select-dataset", id: "world-population-by-country" });
    const raw = await encodeChartsUrlState(state);
    const decoded = await decodeChartsUrlState(raw);
    expect(decoded).toEqual(state);
    expect(decoded!.marks[0]!.dataText).toBe(state.marks[0]!.dataText);
  });

  // P3-1 follow-up: a link built by an OLDER version of this page (before
  // this fix) still writes the literal `"[]"` string ALONGSIDE
  // `dataOmitted: true` — `validateMark` must still accept that shape
  // identically to the new omitted-key one, and rehydration must still
  // fire either way.
  it("a hand-built link carrying the OLDER literal \"[]\" string plus dataOmitted:true still rehydrates (backward-compat wire shape)", async () => {
    const state = reduceChartsWorkbenchState(createChartsWorkbenchState(), { type: "select-dataset", id: "world-population-by-country" });
    const oldShaped = { ...state, marks: [{ ...state.marks[0]!, dataText: "[]", dataOmitted: true as const }] };
    const raw = await encodeChartsUrlState(oldShaped);
    const decoded = await decodeChartsUrlState(raw);
    expect(decoded!.marks[0]!.dataText).toBe(state.marks[0]!.dataText);
    expect(decoded!.marks[0]!.dataOmitted).toBeUndefined();
  });

  // A mark whose data genuinely diverges from a fresh derivation — a
  // channel changed after selection so the derivation used at encode time
  // no longer matches, or a hand-built/"legacy" link carrying real data
  // alongside a `"dataset"` source (every link written before this feature
  // existed did exactly this, unconditionally) — is real, undiscoverable
  // data and is never blanked or otherwise touched by either direction.
  it("a mark whose data diverges from the fresh derivation (legacy-shaped or hand-edited) decodes with that exact data untouched", async () => {
    let state = reduceChartsWorkbenchState(createChartsWorkbenchState(), { type: "select-dataset", id: "world-population-by-country" });
    const divergentData = JSON.stringify([{ country: "Nowhere", year: "2020-01-01", population: 1 }], null, 2);
    state = reduceChartsWorkbenchState(state, { type: "update-mark", id: state.marks[0]!.id, patch: { dataText: divergentData } });
    expect(chartsUrlStateForEncode(state).marks[0]!.dataText).toBe(divergentData);
    const raw = await encodeChartsUrlState(state);
    const decoded = await decodeChartsUrlState(raw);
    expect(decoded!.marks[0]!.dataText).toBe(divergentData);
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
    // N3: the drop decision is made on the ENCODED size, not the raw byte
    // count — a real (non-repetitive) payload, unlike a single repeated
    // character, doesn't deflate away to nothing, so this still exceeds
    // CHARTS_URL_SIZE_WARN_BYTES after compression.
    const hugeRaw = `a,b\n${Array.from({ length: 2000 }, (_, i) => `${i},${i}`).join("\n")}`;
    state = reduceChartsWorkbenchState(state, { type: "set-data-source", source: { kind: "custom", raw: hugeRaw, filename: "huge.csv" } });
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

  // Axis title placement (Dock item "Axis Title + Title at"), appended
  // after `v1` already existed exactly like the colour controls above — a
  // link saved before this feature existed carries no `axisTitlePlacement`
  // key at all and still decodes to today's default (proven by the fixed
  // historical link below), so this test's job is round-tripping a choice
  // a reader DID make.
  it("round-trips a non-default axis title placement on both axes", async () => {
    let state = createChartsWorkbenchState();
    state = reduceChartsWorkbenchState(state, { type: "set-axis-title-at", axis: "x", value: "end" });
    state = reduceChartsWorkbenchState(state, { type: "set-axis-title-at", axis: "y", value: "bottom" });
    const raw = await encodeChartsUrlState(state);
    const decoded = await decodeChartsUrlState(raw);
    expect(decoded).toEqual(state);
    expect(decoded!.style.axisTitlePlacement).toEqual({ x: "end", y: "bottom" });
  });

  it("rejects a malformed axis title placement rather than guessing", async () => {
    const base = createChartsWorkbenchState();
    const badX = await encodeChartsUrlState({ ...base, style: { ...base.style, axisTitlePlacement: { x: "sideways", y: "top" } } } as unknown as ChartsWorkbenchState);
    expect(await decodeChartsUrlState(badX)).toBeNull();
    const badY = await encodeChartsUrlState({ ...base, style: { ...base.style, axisTitlePlacement: { x: "center", y: "middle" } } } as unknown as ChartsWorkbenchState);
    expect(await decodeChartsUrlState(badY)).toBeNull();
  });

  // Textures row (DIAGNOSIS-solid-colour-fills.md): one more append-only
  // optional `style` field. Absent is auto, and `auto` is never written.
  it.each(["texture", "solid"] as const)("round-trips a Textures choice of %s", async (value) => {
    const state = reduceChartsWorkbenchState(createChartsWorkbenchState(), { type: "set-region-fill", value });
    const decoded = await decodeChartsUrlState(await encodeChartsUrlState(state));
    expect(decoded).toEqual(state);
    expect(decoded!.style.regionFill).toBe(value);
  });

  it("an untouched Textures row writes no key, and a link without one decodes to auto (absent)", async () => {
    const state = reduceChartsWorkbenchState(createChartsWorkbenchState(), { type: "set-region-fill", value: "auto" });
    expect(JSON.stringify(chartsUrlStateForEncode(state))).not.toContain("regionFill");
    const decoded = await decodeChartsUrlState(await encodeChartsUrlState(state));
    expect("regionFill" in decoded!.style).toBe(false);
    const handBuiltAuto = await encodeChartsUrlState({ ...state, style: { ...state.style, regionFill: "auto" } } as unknown as ChartsWorkbenchState);
    expect("regionFill" in (await decodeChartsUrlState(handBuiltAuto))!.style).toBe(false);
  });

  it("rejects an unknown Textures value rather than guessing", async () => {
    const base = createChartsWorkbenchState();
    const bad = await encodeChartsUrlState({ ...base, style: { ...base.style, regionFill: "stripes" } } as unknown as ChartsWorkbenchState);
    expect(await decodeChartsUrlState(bad)).toBeNull();
  });

  it("rejects a malformed axis colour mode or a non-hex mark colour rather than guessing", async () => {
    const base = createChartsWorkbenchState();
    const badMode = await encodeChartsUrlState({ ...base, style: { axisColor: { ...base.style.axisColor, mode: "rainbow" } } } as unknown as ChartsWorkbenchState);
    expect(await decodeChartsUrlState(badMode)).toBeNull();
    const badMarkColor = await encodeChartsUrlState({ ...base, marks: [{ ...base.marks[0]!, color: "not-a-hex-colour" }] } as unknown as ChartsWorkbenchState);
    expect(await decodeChartsUrlState(badMarkColor)).toBeNull();
  });

  // options.strokeWidth (AGENTS.md's "Charts" — "options.strokeWidth"):
  // append-only optional field, same rejection discipline as innerRadius/axis.
  it("rejects an out-of-vocabulary strokeWidth rather than guessing", async () => {
    const base = createChartsWorkbenchState();
    const bad = await encodeChartsUrlState({ ...base, marks: [{ ...base.marks[0]!, options: { strokeWidth: 4 } }] } as unknown as ChartsWorkbenchState);
    expect(await decodeChartsUrlState(bad)).toBeNull();
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

  // A3: the reducer's `set-data-source` cap (N2) guards every DISPATCH, but
  // a decoded `?c=` payload is fed straight to `ChartsWorkbenchInner` as
  // `initialState` and never goes through the reducer — so a HAND-BUILT
  // link (never a paste/dropdown, both of which the reducer already
  // refuses before they could be encoded) could carry an over-cap custom
  // `raw` straight through decode. The repeated character deflates hard
  // enough that the ENCODED link stays far under `CHARTS_URL_SIZE_WARN_BYTES`
  // (N3's own drop never engages), which is exactly why this needed its own
  // guard in `validateDataSource` rather than relying on N3's size drop.
  // Mutation check: removing the size check added to `validateDataSource`
  // makes this go red — the decoded source comes back with the full
  // over-cap `raw` string instead of the `omitted` marker.
  it("caps a decoded custom source at the same size a paste/dropdown could never bypass (A3)", async () => {
    const raw = "x".repeat(CHARTS_CUSTOM_MAX_BYTES + 100);
    const base = createChartsWorkbenchState();
    const state: ChartsWorkbenchState = { ...base, data: { source: { kind: "custom", raw, filename: "huge.csv" }, pipeline: [] } };
    const link = await encodeChartsUrlState(state);
    expect(new TextEncoder().encode(link).length).toBeLessThan(CHARTS_URL_SIZE_WARN_BYTES);
    const decoded = await decodeChartsUrlState(link);
    expect(decoded?.data.source).toEqual({ kind: "custom", raw: "", filename: "huge.csv", omitted: true });
  });

  // P4 (fable seat, batch-3 review): `CHARTS_CUSTOM_MAX_BYTES` capped a
  // paste/upload and a decoded `data.source.raw` (A3, above), but a mark's
  // own `dataText` — the field the CHART ACTUALLY RENDERS FROM — had no
  // cap on the decode path at all: a hand-built link with a huge `dataText`
  // decoded and rendered with no bound whatsoever. Same treatment as every
  // other malformed field in this envelope: the whole link fails to decode
  // (falls back to the page's default state) rather than accepting
  // unbounded render data. Mutation check: removing the `dataText` size
  // check from `validateMark` makes this go red — the oversized mark
  // decodes intact instead of the whole envelope coming back `null`.
  it("caps a decoded mark's dataText at the same size a paste/dropdown could never bypass (P4)", async () => {
    const hugeRows = Array.from({ length: 60_000 }, (_, i) => ({ x: i, y: i }));
    const base = createChartsWorkbenchState();
    const state: ChartsWorkbenchState = { ...base, marks: [{ ...base.marks[0]!, dataText: JSON.stringify(hugeRows), channels: { x: "x", y: "y" } }] };
    const dataTextBytes = new TextEncoder().encode(state.marks[0]!.dataText).length;
    expect(dataTextBytes).toBeGreaterThan(CHARTS_CUSTOM_MAX_BYTES);
    // Encode directly through the envelope (bypassing `encodeChartsUrlStateInfo`'s
    // own N3 drop, which only ever touches `data.source` — this pins the
    // DECODE-side cap on `dataText` itself, independent of that mechanism).
    const raw = await encodeChartsUrlState(state);
    expect(await decodeChartsUrlState(raw)).toBeNull();
  });
});

// Dataset search (glyphcss dataset-search feature): a "remote" source's
// rows are never re-derivable locally the way a stock dataset's are, so
// EVERY mark under one is blanked unconditionally on encode and never
// rehydrated on decode — the page re-fetches instead (see
// `chartsUrlState.ts`'s "Stock/remote-dataset mark data omission" doc).
describe("chartsUrlState — remote dataset", () => {
  const remoteState = (): ChartsWorkbenchState => {
    const mark = buildDatasetMark(1, "line", [{ x: 1, y: 2 }, { x: 3, y: 4 }], { x: "x", y: "y" });
    const base = createChartsWorkbenchState();
    return {
      ...base, marks: [mark], nextMarkId: 2,
      data: { source: { kind: "remote", ref: "mstz/titanic", title: "Titanic survival", description: "desc", source: { name: "Hugging Face — mstz/titanic", url: "https://huggingface.co/datasets/mstz/titanic", licence: "CC0" } }, pipeline: [] },
    };
  };

  it("blanks every mark's dataText unconditionally (no byte-match comparison, unlike a stock dataset)", () => {
    const encoded = chartsUrlStateForEncode(remoteState());
    expect(encoded.marks[0]!.dataText).toBeUndefined();
    expect(Object.hasOwn(encoded.marks[0]!, "dataText")).toBe(false);
    expect(encoded.marks[0]!.dataOmitted).toBe(true);
  });

  it("round-trips the remote source's own metadata (ref/title/description/source) through the envelope, with marks blanked and never rehydrated", async () => {
    const state = remoteState();
    const raw = await encodeChartsUrlState(state);
    expect(new TextEncoder().encode(raw).length).toBeLessThan(1024); // no rows in the link
    const decoded = await decodeChartsUrlState(raw);
    expect(decoded).not.toBeNull();
    expect(decoded!.data.source).toEqual(state.data.source);
    // Never rehydrated — a remote source has no local copy to rehydrate FROM.
    expect(decoded!.marks[0]!.dataText).toBe("[]");
  });

  it("chartsUrlStateResolveDataset reports the ref for the page to re-fetch, leaving state untouched", () => {
    const state = remoteState();
    const result = chartsUrlStateResolveDataset(state);
    expect(result.remoteRef).toBe("mstz/titanic");
    expect(result.notice).toBeUndefined();
    expect(result.state).toBe(state);
  });

  // P3-8 (REVIEW-arc-density-search-opus.md): the credit `url` is rendered
  // as `<a href>` alongside fully attacker-controlled `title`/`description`
  // — a crafted link could present arbitrary provenance while pointing
  // anywhere `javascript:`/`data:`/an attacker domain could reach. Every
  // real source this loader produces is `http(s)`, so anything else is
  // rejected outright (the whole envelope, same as every other malformed
  // field here).
  it.each(["javascript:alert(1)", "data:text/html,<script>1</script>", "ftp://example.com/x"])(
    "rejects the whole envelope when a remote source's credit url is not http(s): %s",
    async (badUrl) => {
      const state = remoteState();
      const tampered: ChartsWorkbenchState = {
        ...state,
        data: { ...state.data, source: { ...(state.data.source as Extract<typeof state.data.source, { kind: "remote" }>), source: { name: "x", url: badUrl } } },
      };
      const raw = await encodeChartsUrlState(tampered);
      expect(await decodeChartsUrlState(raw)).toBeNull();
    },
  );

  it("still accepts a plain http:// credit url (not just https)", async () => {
    const state = remoteState();
    const tampered: ChartsWorkbenchState = {
      ...state,
      data: { ...state.data, source: { ...(state.data.source as Extract<typeof state.data.source, { kind: "remote" }>), source: { name: "x", url: "http://example.com/data" } } },
    };
    const raw = await encodeChartsUrlState(tampered);
    const decoded = await decodeChartsUrlState(raw);
    expect(decoded).not.toBeNull();
    expect((decoded!.data.source as Extract<typeof state.data.source, { kind: "remote" }>).source.url).toBe("http://example.com/data");
  });
});

describe("chartsUrlState — unresolvable stock dataset id (P2-3, REVIEW-showcase-opus.md)", () => {
  it("falls back to a random vendored dataset with a notice, rather than decoding to a hard empty-data render", () => {
    const state: ChartsWorkbenchState = { ...createChartsWorkbenchState(), data: { source: { kind: "dataset", id: "not-a-real-dataset-id" }, pipeline: [] } };
    const result = chartsUrlStateResolveDataset(state);
    expect(result.notice).toContain("not-a-real-dataset-id");
    expect(result.state.data.source?.kind).toBe("dataset");
    expect(CHARTS_DATASETS.some((d) => d.id === (result.state.data.source as { id: string }).id)).toBe(true);
    expect(result.remoteRef).toBeUndefined();
  });

  it("a resolvable stock id is left completely untouched", () => {
    const state: ChartsWorkbenchState = { ...createChartsWorkbenchState(), data: { source: { kind: "dataset", id: "iris-flowers" }, pipeline: [] } };
    const result = chartsUrlStateResolveDataset(state);
    expect(result).toEqual({ state });
  });
});

// P1-6 (batch-3 review): `encodeChartsUrlStateInfo` dropped `data.source.raw`
// but left `marks[N].dataText` — a SECOND, independent JSON copy of the
// same rows `buildDatasetMark` (Apply) writes — riding in the envelope
// uncapped. A 2,000-row custom CSV, Applied, exceeded the cap even with
// `source.raw` stripped (the reviewer's own repro measured a 14,805-byte
// envelope after the old drop, over the 8,192-byte cap), and the decoded
// page contradicted itself: the Data folder said "paste it again" while
// the chart rendered fine from the still-present `dataText`.
describe("chartsUrlState — Apply'd custom data omission (P1-6)", () => {
  // `apply-data` is gone (item 1: `select-dataset` replaced it for stock
  // datasets only — a custom source has no curated mapping to apply
  // immediately from). This still needs the exact SHAPE Apply used to
  // build for a custom source, so it's built directly here from the same
  // pure pieces (`resolveChartsDataRows` + `buildDatasetMark`) rather than
  // through a reducer action.
  const bigCsvState = () => {
    const raw = `a,b\n${Array.from({ length: 2000 }, (_, i) => `${i},${i}`).join("\n")}`;
    const withSource = reduceChartsWorkbenchState(createChartsWorkbenchState(), { type: "set-data-source", source: { kind: "custom", raw } });
    const resolved = resolveChartsDataRows(withSource.data.source!, withSource.data.pipeline);
    if (!resolved.ok) throw new Error(resolved.error);
    const mark = buildDatasetMark(withSource.nextMarkId, "line", resolved.rows, { x: "a", y: "b" });
    return { ...withSource, marks: [mark], nextMarkId: withSource.nextMarkId + 1 };
  };

  // Mutation check: reverting `encodeChartsUrlStateInfo` to drop only
  // `source.raw` (never scanning `marks` for the derived `dataText` copy)
  // makes this go red — the final envelope comes back over 8,192 bytes
  // (measured ~14.8 KB in the original report) instead of at/under the cap.
  it("the FINAL envelope (source.raw AND the derived mark dataText both dropped) is at or under the cap — never a second silent copy", async () => {
    const state = bigCsvState();
    const info = await encodeChartsUrlStateInfo(state);
    expect(info.tooLarge).toBeFalsy();
    expect(info.raw.length).toBeGreaterThan(0);
    expect(new TextEncoder().encode(info.raw).length).toBeLessThanOrEqual(CHARTS_URL_SIZE_WARN_BYTES);
    expect(info.omittedCustomBytes).toBeDefined();
  });

  // The "must agree" property: decoding the link must NOT recover the
  // 2,000 rows through either copy — a link that renders the chart in full
  // while claiming the data isn't included would be the same contradiction
  // in the opposite direction.
  it("decoding the omitted link recovers neither copy of the 2,000 rows", async () => {
    const state = bigCsvState();
    const info = await encodeChartsUrlStateInfo(state);
    const decoded = await decodeChartsUrlState(info.raw);
    expect(decoded).not.toBeNull();
    expect(decoded!.data.source).toMatchObject({ kind: "custom", raw: "", omitted: true });
    expect(JSON.parse(decoded!.marks[0]!.dataText)).toEqual([]);
  });

  it("a mark that diverges from the source's own resolved rows (hand-edited) is real data with no other copy, and is left untouched", async () => {
    let state = bigCsvState();
    state = reduceChartsWorkbenchState(state, { type: "update-mark", id: state.marks[0]!.id, patch: { dataText: JSON.stringify([{ a: 1, b: 2 }]) } });
    const info = await encodeChartsUrlStateInfo(state);
    const decoded = await decodeChartsUrlState(info.raw);
    expect(decoded).not.toBeNull();
    expect(JSON.parse(decoded!.marks[0]!.dataText)).toEqual([{ a: 1, b: 2 }]);
  });

  // If even every copy dropped still leaves the envelope over the cap
  // (many/huge marks — synthesized here by adding a second large mark that
  // does NOT match the derivable source output, so it can never be
  // dropped), the encoder reports it rather than writing a broken link.
  it("reports tooLarge (raw: \"\") when the envelope is still over the cap after dropping every derivable copy", async () => {
    let state = bigCsvState();
    const extraRows = Array.from({ length: 2000 }, (_, i) => ({ x: i, y: i * 2 }));
    state = reduceChartsWorkbenchState(state, { type: "add-mark", markType: "dot" });
    state = reduceChartsWorkbenchState(state, {
      type: "update-mark", id: state.marks[1]!.id,
      patch: { dataText: JSON.stringify(extraRows), channels: { x: "x", y: "y" } },
    });
    const info = await encodeChartsUrlStateInfo(state);
    expect(info.tooLarge).toBe(true);
    expect(info.raw).toBe("");
    expect(info.sizeBytes).toBeGreaterThan(CHARTS_URL_SIZE_WARN_BYTES);
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

// Packet C3 (AGENTS.md's "Charts 3D"): `dimension`/`chart3d` ride as
// append-only optional fields — the historical link above (encoded before
// either existed) already proves an old link decodes unchanged; these pin
// the NEW field's own round trip and its two graceful-degrade paths.
describe("chartsUrlState — 3D (dimension/chart3d)", () => {
  it("round-trips a 3D-dataset state, camera included", async () => {
    let state = reduceChartsWorkbenchState(createChartsWorkbenchState(), { type: "select-3d-dataset", id: CHARTS_3D_DATASETS[0]!.id });
    state = reduceChartsWorkbenchState(state, { type: "set-3d-camera", camera: { rotX: 12, rotY: -34, zoom: 5.5 } });
    state = reduceChartsWorkbenchState(state, { type: "set-3d-view", patch: { orbitMode: "trackball", shading: "value", colorscale: "magma" } });
    const raw = await encodeChartsUrlState(state);
    expect(await decodeChartsUrlState(raw)).toEqual(state);
  });

  it("round-trips an auto-fit camera (zoom omitted) exactly — zoom stays undefined, not re-materialised to a number", async () => {
    const state = reduceChartsWorkbenchState(createChartsWorkbenchState(), { type: "select-3d-dataset", id: CHARTS_3D_DATASETS[1]!.id });
    expect(state.chart3d.camera.zoom).toBeUndefined();
    const raw = await encodeChartsUrlState(state);
    const decoded = await decodeChartsUrlState(raw);
    expect(decoded).toEqual(state);
    expect(decoded!.chart3d.camera.zoom).toBeUndefined();
  });

  // Mutation check: dropping the `sourceOmitted`/no-`rows` blanking in
  // `chartsUrlStateForEncode` would instead write the reader's own table
  // (arbitrary size) straight into `?c=` — this asserts the encoded raw
  // string never contains the distinctive row values, and that decode
  // still succeeds by gracefully falling back to 2D.
  it("an INLINE surface source (built from the reader's own table) is never written into the link, and decodes back to 2D", async () => {
    let state = createChartsWorkbenchState();
    const rows = Array.from({ length: 4 }, (_, x) => Array.from({ length: 4 }, (_, y) => ({ x, y, z: x * 97 + y }))).flat();
    state = reduceChartsWorkbenchState(state, {
      type: "update-mark", id: state.marks[0]!.id,
      patch: { dataText: JSON.stringify(rows), channels: { x: "x", y: "y" } },
    });
    state = reduceChartsWorkbenchState(state, { type: "select-3d-table" });
    expect(state.dimension).toBe("3d");
    expect(state.chart3d.source.kind).toBe("inline");
    const raw = await encodeChartsUrlState(state);
    expect(raw.includes("97")).toBe(false); // the distinctive z value never rides in the link
    const decoded = await decodeChartsUrlState(raw);
    expect(decoded).not.toBeNull();
    expect(decoded!.dimension).toBe("2d"); // no local copy to rehydrate from — graceful fallback
  });

  it("a stale/unknown 3D dataset id falls back to the 2D chart the rest of the link describes, via chartsUrlStateResolveDataset", async () => {
    const base = reduceChartsWorkbenchState(createChartsWorkbenchState(), { type: "select-3d-dataset", id: CHARTS_3D_DATASETS[0]!.id });
    const stale: ChartsWorkbenchState = { ...base, chart3d: { ...base.chart3d, source: { kind: "dataset", id: "removed-dataset" } } };
    const { state: resolved, notice } = chartsUrlStateResolveDataset(stale);
    expect(resolved.dimension).toBe("2d");
    expect(notice).toContain("removed-dataset");
    // The rest of the link (the 2D marks `createChartsWorkbenchState()`
    // ships) is untouched — never replaced by a random dataset, unlike the
    // stale-2D-dataset-id fallback below.
    expect(resolved.marks).toEqual(base.marks);
  });

  // Hand-built via the envelope's own documented plain-JSON fallback wire
  // format (`"<version>j.<base64url(JSON)>"`, `lib/jsonUrlState.ts`'s own
  // doc) — no reducer path can produce a malformed `chart3d`, so this is
  // the only way to reach `validateCharts3dViewState`'s own degrade branch.
  it("a malformed chart3d payload degrades to the 2D default rather than failing the whole decode", async () => {
    const base = createChartsWorkbenchState();
    const payload = { ...base, dimension: "3d", chart3d: { source: { kind: "dataset", id: "x" }, camera: { rotX: "not-a-number" }, orbitMode: "turntable", shading: "auto", colorscale: "viridis" } };
    const raw = `v1j.${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
    const decoded = await decodeChartsUrlState(raw);
    expect(decoded).not.toBeNull();
    expect(decoded!.dimension).toBe("2d");
    expect(decoded!.chart3d).toEqual(createChartsWorkbenchState().chart3d);
    // The REST of the payload (ordinary 2D fields) is untouched — this one
    // bad field doesn't take the whole link down.
    expect(decoded!.marks).toEqual(base.marks);
  });

  it("an invalid dimension value (neither \"2d\" nor \"3d\") is simply read as 2D, never a decode failure", async () => {
    const base = createChartsWorkbenchState();
    const payload = { ...base, dimension: "not-a-dimension" };
    const raw = `v1j.${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
    const decoded = await decodeChartsUrlState(raw);
    expect(decoded!.dimension).toBe("2d");
  });
});

describe("chartsUrlState — param name", () => {
  it("uses 'c' as the query param key", () => {
    expect(CHARTS_URL_PARAM).toBe("c");
  });
});

// A4: `createChartsUrlWriter` is a hand-copied fork of `jsonUrlState.ts`'s
// `createDebouncedJsonUrlWriter` — needed for its own encode-then-maybe-
// re-encode drop step (N3), which the generic writer's single
// `envelope.encode(state)` call has no hook for — but it had no test of its
// own; `jsonUrlState.test.ts`'s five writer tests exercised only the
// original it was copied from. Mirrored onto the real function here so a
// future edit to either can't silently diverge unnoticed.
function makeFakeWindow(startUrl: string) {
  const url = new URL(startUrl);
  const win = {
    location: {
      get search() { return url.search; },
      get pathname() { return url.pathname; },
      get hash() { return url.hash; },
    },
    history: {
      state: null as unknown,
      replaceState(state: unknown, _title: string, next: string) {
        win.history.state = state;
        const resolved = new URL(next, url.origin);
        url.pathname = resolved.pathname;
        url.search = resolved.search;
        url.hash = resolved.hash;
      },
    },
  };
  return win;
}
// Real timers (see jsonUrlState.test.ts's own note): a fake-timer version of
// these flakes on the assertions that wait for the real async deflate encode.
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const SETTLE_MS = 150 + 200;

describe("createChartsUrlWriter", () => {
  let win: ReturnType<typeof makeFakeWindow>;
  beforeEach(() => {
    win = makeFakeWindow("http://localhost/charts");
    (globalThis as { window?: unknown }).window = win;
  });
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("coalesces a burst of state changes into exactly one write, 150ms after the last one", async () => {
    const writer = createChartsUrlWriter();
    const base = createChartsWorkbenchState();
    writer({ ...base, chart: { ...base.chart, title: "one" } });
    await sleep(50);
    writer({ ...base, chart: { ...base.chart, title: "two" } });
    await sleep(50);
    writer({ ...base, chart: { ...base.chart, title: "three" } });
    expect(win.location.search).toBe(""); // still nothing written — every call so far re-armed the timer
    await sleep(SETTLE_MS);
    const raw = new URLSearchParams(win.location.search).get("c");
    expect(raw).not.toBeNull();
    expect((await decodeChartsUrlState(raw))?.chart.title).toBe("three");
  });

  it("uses history.replaceState, never pushState — the URL changes with no navigation entry created", async () => {
    let pushCount = 0;
    (win.history as { pushState?: () => void }).pushState = () => { pushCount++; };
    const writer = createChartsUrlWriter();
    writer(createChartsWorkbenchState());
    await sleep(SETTLE_MS);
    expect(pushCount).toBe(0);
    expect(new URLSearchParams(win.location.search).get("c")).not.toBeNull();
  });

  it("skips the write (no replaceState call) when the encoded value hasn't changed", async () => {
    const writer = createChartsUrlWriter();
    const state = createChartsWorkbenchState();
    writer(state);
    await sleep(SETTLE_MS);
    const before = win.location.search;
    let replaceCalls = 0;
    const originalReplace = win.history.replaceState.bind(win.history);
    win.history.replaceState = (...args: Parameters<typeof originalReplace>) => { replaceCalls++; return originalReplace(...args); };
    writer({ ...state }); // structurally identical -> same encoded string
    await sleep(SETTLE_MS);
    expect(replaceCalls).toBe(0);
    expect(win.location.search).toBe(before);
  });

  it("reports the encoded size via onEncoded even when the write itself is skipped", async () => {
    const sizes: number[] = [];
    const writer = createChartsUrlWriter(({ sizeBytes }) => sizes.push(sizeBytes));
    const state = createChartsWorkbenchState();
    writer(state);
    await sleep(SETTLE_MS);
    writer({ ...state });
    await sleep(SETTLE_MS);
    expect(sizes).toHaveLength(2);
    expect(sizes[0]).toBeGreaterThan(0);
    expect(sizes[1]).toBe(sizes[0]);
  });

  it("discards a stale encode that resolves after a newer state was already scheduled", async () => {
    const writer = createChartsUrlWriter();
    const base = createChartsWorkbenchState();
    writer({ ...base, chart: { ...base.chart, title: "first" } });
    await sleep(SETTLE_MS);
    writer({ ...base, chart: { ...base.chart, title: "final" } });
    await sleep(SETTLE_MS);
    const raw = new URLSearchParams(win.location.search).get("c");
    expect((await decodeChartsUrlState(raw))?.chart.title).toBe("final");
  });
});
