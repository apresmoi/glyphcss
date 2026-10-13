/**
 * `axes.{x,y}.format` (AGENTS.md's "Charts" "Axes") — named presets
 * (`GLYPH_CHART_TICK_FORMAT_PRESETS`, `tickFormat.ts`), a raw TS/JS callback
 * `(value, index, ticks) => string`, and `"auto"`/absent as today's
 * byte-identical default. Applies to axis ticks ONLY — never an arc's own
 * callout percentage (`paint.ts`'s own `NN%` label) or a funnel's
 * value·percent label, both of which format independently and read no axis
 * option at all.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import Ajv2020 from "ajv/dist/2020";
import { describe, expect, it } from "vitest";
import { layoutGlyphChart } from "./layout";
import { renderGlyphChart } from "./render";
import { renderGlyphChartJson } from "./json";
import { resolveGlyphChartSpec } from "./resolve";
import { resolveGlyphChartScales } from "./scales";
import { glyphChartBar, glyphChartLine, glyphChartPlot, normalizeGlyphChartInput } from "./spec";
import { glyphChartJsonSchema } from "./schema";
import { GLYPH_CHART_VALIDATION_RULES, glyphChartRepairHint, validateGlyphChartSpec } from "./validate";
import { GLYPH_CHART_TICK_FORMAT_PRESET_NAMES } from "./tickFormat";
import { goodSpecs } from "./reviewFixtures";
import type { GlyphChartInput, GlyphChartLedgerEntry, GlyphChartSpec } from "./types";

/** Mirrors `strokeWidth.test.ts`'s own `picture()` harness — the internal
 * layout pipeline directly, for exact tick-label inspection. */
function picture(input: GlyphChartInput, width: number, height: number) {
  return pictureWithLedger(input, width, height);
}
function pictureWithLedger(input: GlyphChartInput, width: number, height: number) {
  const spec = normalizeGlyphChartInput(input);
  const marks = resolveGlyphChartSpec(spec);
  const scales = resolveGlyphChartScales(marks, spec.scales);
  const ledger: GlyphChartLedgerEntry[] = [];
  const layout = layoutGlyphChart(spec, marks, scales, width, height, "auto", ledger, "box");
  return { spec, layout, ledger };
}

// ── (1) byte-identity when `format` is absent ──────────────────────────

function fixturePath(relative: string): string {
  const testPath = expect.getState().testPath;
  if (!testPath) throw new Error("no test path available to resolve fixture from");
  return join(dirname(testPath), relative);
}
// Dumped from a real build of the parent commit (926ab7b0, before
// `axes.{x,y}.format` existed) in a throwaway worktree — every
// `reviewFixtures` `goodSpecs` entry, `renderGlyphChart(spec, { target:
// "chat", width: 60, height: 24, charset: "box", color: "none" })`. No
// `goodSpecs` entry sets `axes.*.format`, so every one of these must still
// match byte for byte.
//
// Regenerated for `series.ts`'s shade-ramp fix (CHARTS-RESEARCH
// `DIAGNOSIS-pie-contrast.md`): indices 16-21 (`sankeySample`,
// `funnelSample`, `[1000,500,100]`, the three `browserShares` arc specs)
// changed at `box` — the fix's whole point is that a multi-series
// region/arc mark's fill glyph is no longer a single density ramp. Every
// single-series entry is byte-identical.
const parentFixtures: Record<string, string> = JSON.parse(readFileSync(fixturePath("fixtures/tickFormatParentFixtures.json"), "utf8"));

describe("format absent: byte-identical to the parent build (926ab7b0, before axes.*.format existed)", () => {
  it("every reviewFixtures goodSpecs entry matches the pre-format build byte for byte", () => {
    // Mutation: make `formatAxisTicks`/`resolveGlyphChartTickFormat` run (or
    // allocate a new label array) even when `format` is absent -> at least
    // one of these 35 renders stops matching the real dist built before
    // `axes.*.format` existed.
    let compared = 0;
    for (let i = 0; i < goodSpecs.length; i++) {
      const key = String(i);
      expect(parentFixtures[key], key).toBeDefined();
      const r = renderGlyphChart(goodSpecs[i]!, { target: "chat", width: 60, height: 24, charset: "box", color: "none" });
      expect(r.text, key).toBe(parentFixtures[key]);
      compared++;
    }
    expect(compared).toBe(goodSpecs.length);
  });

  it("mutation guard: the SAME chart with an explicit format is NOT byte-identical to the default — proves the wiring is live, not a dead no-op", () => {
    // `currency`, not `si`: the default numeric ladder already SI-abbreviates
    // a large magnitude on its own (`scales.ts`'s `formatLinearTick`), so an
    // `si`-formatted axis can coincidentally render byte-identical to the
    // default for these values — `currency`'s `$`/comma/decimals never
    // appear in the default path at all, so any match here is a real bug.
    const withDefault = renderGlyphChart(glyphChartPlot({ marks: [glyphChartBar([100, 2500, 12000])] }), { target: "chat", width: 60, height: 24, color: "none" });
    const withPreset = renderGlyphChart(glyphChartPlot({ marks: [glyphChartBar([100, 2500, 12000])], axes: { y: { format: { preset: "currency" } } } }), { target: "chat", width: 60, height: 24, color: "none" });
    expect(withPreset.text).not.toBe(withDefault.text);
    expect(withPreset.text).toContain("$");
  });
});

// ── (2) every preset, exact tick strings ────────────────────────────────

describe("presets — exact tick strings on a numeric axis (glyphChartBar([100, 2500, 12000]))", () => {
  function yLabels(format: unknown) {
    const spec = glyphChartPlot({ marks: [glyphChartBar([100, 2500, 12000])], axes: { y: { format: format as never } } });
    return picture(spec, 60, 14).layout.yTicks.map((t) => t.label);
  }

  it("number: locale-free comma grouping", () => {
    expect(yLabels("number")).toEqual(["12,000", "10,000", "8,000", "6,000", "4,000", "2,000", "0"]);
  });
  it("si: d3's own ~s SI prefixes", () => {
    expect(yLabels("si")).toEqual(["12k", "10k", "8k", "6k", "4k", "2k", "0"]);
  });
  it("compact: K/M/B, relettered from d3's k/M/G", () => {
    expect(yLabels("compact")).toEqual(["12K", "10K", "8K", "6K", "4K", "2K", "0"]);
  });
  it("integer: rounded, no grouping", () => {
    expect(yLabels("integer")).toEqual(["12000", "10000", "8000", "6000", "4000", "2000", "0"]);
  });
  it("currency: default $ symbol, 2 decimals", () => {
    expect(yLabels({ preset: "currency" })).toEqual(["$12,000.00", "$10,000.00", "$8,000.00", "$6,000.00", "$4,000.00", "$2,000.00", "$0.00"]);
  });
  it("currency: custom symbol and decimals", () => {
    expect(yLabels({ preset: "currency", symbol: "€", decimals: 0 })).toEqual(["€12,000", "€10,000", "€8,000", "€6,000", "€4,000", "€2,000", "€0"]);
  });
  it("decimals: fixed places", () => {
    expect(yLabels({ preset: "decimals", places: 1 })).toEqual(["12000.0", "10000.0", "8000.0", "6000.0", "4000.0", "2000.0", "0.0"]);
  });
  it("scientific", () => {
    expect(yLabels("scientific")).toEqual(["1.20e+4", "1.00e+4", "8.00e+3", "6.00e+3", "4.00e+3", "2.00e+3", "0.00e+0"]);
  });
});

describe("percent — with and without `of`", () => {
  it("default (value 0..1)", () => {
    const spec = glyphChartPlot({ marks: [glyphChartLine([0, 0.25, 0.5, 0.75, 1])], axes: { y: { format: "percent" } } });
    expect(picture(spec, 60, 14).layout.yTicks.map((t) => t.label)).toEqual(["100%", "80%", "60%", "40%", "20%", "0%"]);
  });
  it("{ of: 100 } (value 0..100)", () => {
    const spec = glyphChartPlot({ marks: [glyphChartBar([10, 45, 80])], axes: { y: { format: { preset: "percent", of: 100 } } } });
    expect(picture(spec, 60, 14).layout.yTicks.map((t) => t.label)).toEqual(["80%", "60%", "40%", "20%", "0%"]);
  });
});

describe("template", () => {
  it("{value} substitutes the auto-formatted value", () => {
    const spec = glyphChartPlot({ marks: [glyphChartLine([0, 10, 20, 30])], axes: { y: { format: { preset: "template", pattern: "{value} °C" } } } });
    expect(picture(spec, 60, 14).layout.yTicks.map((t) => t.label)).toEqual(["30 °C", "25 °C", "20 °C", "15 °C", "10 °C", "5 °C", "0 °C"]);
  });
});

describe("presets — exact tick strings on a date axis", () => {
  const points = [{ x: "2024-01-05T08:00:00Z", y: 1 }, { x: "2024-03-12T08:00:00Z", y: 3 }, { x: "2024-06-20T08:00:00Z", y: 2 }];
  function xLabels(format: unknown) {
    const spec = glyphChartPlot({ marks: [glyphChartLine(points, { x: "x", y: "y" })], scales: { x: { type: "time" } }, axes: { x: { format: format as never, title: "" } } });
    return picture(spec, 70, 10).layout.xTicks.map((t) => t.label);
  }

  it("date: ISO YYYY-MM-DD", () => {
    expect(xLabels("date")).toEqual(["2024-02-01", "2024-03-01", "2024-04-01", "2024-05-01", "2024-06-01"]);
  });
  it("year", () => {
    expect(xLabels("year")).toEqual(["2024"]);
  });
  it("month: 'Jan 2024'", () => {
    expect(xLabels("month")).toEqual(["Feb 2024", "Mar 2024", "Apr 2024", "May 2024", "Jun 2024"]);
  });
  it("day: '12 Jan'", () => {
    expect(xLabels("day")).toEqual(["1 Feb", "1 Mar", "1 Apr", "1 May", "1 Jun"]);
  });
  it("time: '14:05'", () => {
    expect(xLabels("time")).toEqual(["00:00"]);
  });
});

// ── (3) callback ─────────────────────────────────────────────────────────

describe("callback (TS/JS only)", () => {
  it("receives (value, index, ticks) and its return is painted", () => {
    const seen: Array<{ value: unknown; index: number; ticksLength: number }> = [];
    const spec = glyphChartPlot({
      marks: [glyphChartBar([1, 2, 3])],
      axes: { y: { format: (value, index, ticks) => { seen.push({ value, index, ticksLength: ticks.length }); return `#${index}/${ticks.length}=${value}`; } } },
    });
    const labels = picture(spec, 60, 14).layout.yTicks.map((t) => t.label);
    expect(labels).toEqual(["#3/4=3", "#2/4=2", "#1/4=1", "#0/4=0"]);
    // The callback really was called with the RAW scale value (a number
    // here), its own index into the pre-thinning tick array, and that
    // array's own length — not a re-derivation from the painted label.
    expect(seen.length).toBeGreaterThan(0);
    for (const call of seen) {
      expect(typeof call.value).toBe("number");
      expect(call.ticksLength).toBeGreaterThan(0);
    }
  });

  it("a callback's output is treated as a CATEGORY label (elided with …), never the numeric drop path", () => {
    // Mutation: derive `numeric` from `typeof t.value` alone (ignore
    // `format?.isCallback`) -> a callback's long output starts DROPPING
    // (empty label, `label-dropped` "the number couldn't be abbreviated")
    // instead of eliding with `…`, since the axis is genuinely numeric
    // underneath and there is no `siFallback` for a raw callback.
    const spec = glyphChartPlot({
      marks: [glyphChartBar([1, 2, 3])],
      axes: { y: { format: (value) => `a very long callback label for the value ${value}` } },
    });
    const { layout, ledger } = pictureWithLedger(spec, 30, 14);
    expect(layout.yTicks.length).toBeGreaterThan(0);
    // The invariant under test: NEVER the numeric drop path (an empty label
    // plus a "couldn't be abbreviated" ledger entry) — a category label
    // instead truncates to a non-empty prefix (`…`-suffixed once there's
    // room for at least one content character beside it).
    for (const t of layout.yTicks) expect(t.label.length).toBeGreaterThan(0);
    expect(ledger.some((e) => e.code === "label-dropped" && e.message.includes("couldn't be abbreviated"))).toBe(false);
    // A WIDER axis has room for the ellipsis itself, not just a bare prefix.
    const wide = pictureWithLedger(spec, 60, 14).layout;
    expect(wide.yTicks.some((t) => t.label.endsWith("…"))).toBe(true);
  });

  it("renderGlyphChart renders a callback-formatted axis directly (the TS/JS path)", () => {
    const spec = glyphChartPlot({ marks: [glyphChartLine([0, 10, 20])], axes: { y: { format: (v) => `V${v}` } } });
    const r = renderGlyphChart(spec, { target: "chat", width: 40, height: 12 });
    expect(r.text).toContain("V20");
    expect(r.text).toContain("V0");
  });

  it("a callback has no JSON representation — JSON.stringify drops the key entirely, so a round-tripped spec renders with the default (auto) format rather than carrying the function", () => {
    const spec = { marks: [{ type: "line", data: [0, 10, 20], channels: {} }], axes: { y: { format: (v: number) => `V${v}` } } };
    const json = JSON.stringify(spec);
    const parsed = JSON.parse(json);
    expect(parsed.axes.y.format).toBeUndefined();
  });

  it("renderGlyphChartJson rejects a string that isn't a known preset — the JSON-only surface a caller who tried to smuggle a callback through as text would hit", () => {
    // Mutation: drop the unknown-preset check in `resolveGlyphChartTickFormat`
    // -> this silently renders with the string treated as a no-op instead
    // of rejecting with `bad-tick-format`.
    const json = JSON.stringify({ marks: [{ type: "line", data: [1, 2], channels: {} }], axes: { y: { format: "() => value" } } });
    const out = JSON.parse(renderGlyphChartJson(json));
    expect(out.code).toBe("bad-tick-format");
    expect(out.hint).toBeTruthy();
  });

  // codex P2-12's own repro: a VALID line spec with
  // `axes.y.format: { preset: "decimals", places: 101 }` used to pass
  // validation (the old check only rejected a negative/non-integer value)
  // and then crash inside `toFixed(101)` with a raw, untagged
  // `RangeError` — the JSON API surfaced `code: null`/`hint: null` instead
  // of the documented `bad-tick-format` shape.
  it("renderGlyphChartJson rejects an out-of-range decimals.places with bad-tick-format, never a raw untagged error", () => {
    const json = JSON.stringify({ marks: [{ type: "line", data: [1, 2], channels: {} }], axes: { y: { format: { preset: "decimals", places: 101 } } } });
    const out = JSON.parse(renderGlyphChartJson(json));
    expect(out.code).toBe("bad-tick-format");
    expect(out.hint).toBeTruthy();
  });
});

// ── (4) abbreviate/drop policy under a narrow axis ──────────────────────

describe("the abbreviate/drop policy still holds under a preset", () => {
  it("decimals: 4 on a super-narrow axis DROPS, never truncates into a shorter but WRONG number", () => {
    // Mutation: fall back to the generic reparsed-display-text SI attempt
    // for a preset-formatted tick (instead of ONLY that preset's own
    // `siFallback`) -> `"8.0000"` silently reprints as `"8"` (a real,
    // different, less precise number) instead of dropping — `decimals` has
    // no `siFallback` in `GLYPH_CHART_TICK_FORMAT_PRESETS`, precisely
    // because there is no honest shorter form of "4 decimal places".
    const spec = glyphChartPlot({ marks: [glyphChartLine([1.23456, 5.6789, 9.1011])], axes: { y: { format: { preset: "decimals", places: 4 } } } });
    const labels = picture(spec, 12, 14).layout.yTicks.map((t) => t.label);
    for (const label of labels) {
      expect(label).not.toMatch(/^\d+$/); // never a bare, precision-losing integer
      expect(label.length === 0 || label.includes(".")).toBe(true);
    }
  });

  it("number/currency/integer DO fall back to their own SI form when the full formatted label doesn't fit", () => {
    const spec = glyphChartPlot({ marks: [glyphChartBar([100, 2500000])], axes: { y: { format: "number" } } });
    const labels = picture(spec, 10, 14).layout.yTicks.map((t) => t.label);
    expect(labels.length).toBeGreaterThan(0);
    // A number preset's own siFallback is plain SI (`d3format("~s")`) — no
    // comma-grouped label survives at this width, but an abbreviated one can.
    for (const label of labels) expect(label).not.toContain(",");
  });
});

// ── (5) validation / schema — Ajv parity on >= 3 bad shapes ─────────────

const schema = glyphChartJsonSchema();
const ajv = new Ajv2020({ strict: false, strictNumbers: true });
const validateSchema = ajv.compile(schema);
function runtimeOk(spec: unknown): boolean {
  try { validateGlyphChartSpec(spec as GlyphChartSpec); return true; } catch { return false; }
}

describe("validation — GLYPH_CHART_TICK_FORMAT_PRESETS is the ONE table schema/validate/docs derive from", () => {
  it("bad-tick-format is a registered rule with a hint and a schema entry", () => {
    expect(GLYPH_CHART_VALIDATION_RULES).toContain("bad-tick-format");
    expect(glyphChartRepairHint("bad-tick-format")).toBeTruthy();
    expect(schema["x-glyphcss-validation-rules"]["bad-tick-format"]).toBeTruthy();
  });

  it.each([
    { label: "a non-string/non-object value", format: 123 },
    { label: "an unknown preset name", format: "not-a-real-preset" },
    { label: "a preset object missing a required param (decimals needs places)", format: { preset: "decimals" } },
    { label: "a preset object with an unknown param", format: { preset: "currency", bogus: true } },
    { label: "a param of the wrong type (percent's of must be a number)", format: { preset: "percent", of: "ten" } },
    // codex P2-12: `places`/`decimals` feed straight into
    // `Number.prototype.toFixed`, whose own spec range is 0..100 — a value
    // past it used to pass this same "non-negative integer" check and then
    // throw a raw, untagged `RangeError` at RENDER time (`code: null`,
    // `hint: null` through the JSON API) instead of rejecting here with
    // `bad-tick-format`.
    { label: "decimals.places past toFixed's own 0..100 range", format: { preset: "decimals", places: 101 } },
    { label: "currency.decimals past toFixed's own 0..100 range", format: { preset: "currency", decimals: 101 } },
  ])("$label rejects at both runtime and Ajv, with the same rule", ({ format }) => {
    // Mutation: drop `resolvePreset`'s allowed-keys/required checks, or the
    // matching `allOf`/`if`/`then` clause in `schema.ts`'s
    // `TICK_FORMAT_OBJECT_SCHEMA` -> Ajv and runtime disagree on at least
    // one of these five designed-bad shapes.
    const spec = { marks: [{ type: "line", data: [1, 2], channels: {} }], axes: { y: { format } } };
    expect(runtimeOk(spec)).toBe(false);
    expect(validateSchema(spec)).toBe(false);
    expect(() => renderGlyphChart(spec as never)).toThrow(expect.objectContaining({ code: "bad-tick-format" }));
  });

  it("every preset name in GLYPH_CHART_TICK_FORMAT_PRESETS is a valid bare-string format, and the schema's own enum agrees", () => {
    for (const name of GLYPH_CHART_TICK_FORMAT_PRESET_NAMES) {
      const spec = { marks: [{ type: "line", data: [1, 2], channels: {} }], axes: { y: { format: name } } };
      // `decimals`/`template` need required params even as a bare name is
      // never legal for them (`resolvePreset`'s own required-key check) —
      // every OTHER preset accepts the bare string.
      const requiresParams = name === "decimals" || name === "template";
      expect(runtimeOk(spec)).toBe(!requiresParams);
      expect(validateSchema(spec)).toBe(!requiresParams);
    }
  });
});

// ── (6) a 72x24 chat render exercising two presets at once ─────────────

it("a chat-target render with currency on y and month on x", () => {
  const points = [
    { month: "2024-01-01", revenue: 42000 }, { month: "2024-02-01", revenue: 58000 },
    { month: "2024-03-01", revenue: 51000 }, { month: "2024-04-01", revenue: 67000 },
  ];
  const spec = glyphChartPlot({
    marks: [glyphChartBar(points, { x: "month", y: "revenue" })],
    scales: { x: { type: "time" } },
    axes: { y: { format: { preset: "currency", symbol: "$" } }, x: { format: "month", title: "" } },
  });
  const r = renderGlyphChart(spec, { target: "chat", color: "none" });
  expect(r.build.canvas.grid.cols).toBe(72);
  expect(r.build.canvas.grid.rows).toBe(24);
  expect(r.text).toMatch(/\$[\d,]+/);
  expect(r.text).toMatch(/[A-Z][a-z]{2} 2024/);
});
