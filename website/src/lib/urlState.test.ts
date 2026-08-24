import { describe, expect, it } from "vitest";
import {
  createUrlCodec,
  decodeEffectParamsPacked,
  encodeEffectParamsPacked,
  type EffectParamSchemaLike,
  type EffectParamSpecLike,
  type UrlField,
  type UrlFieldKind,
} from "./urlState";

interface DemoState {
  text: string;
  count: number;
  ratio: number;
  active: boolean;
  color: string;
  mode: "a" | "b" | "c";
  point: number[];
}

const demoDefaults: DemoState = {
  text: "hello",
  count: 3,
  ratio: 1.5,
  active: false,
  color: "#ff0000",
  mode: "a",
  point: [0, 0, 0],
};

const demoFields: readonly UrlField<DemoState>[] = [
  { key: "text", token: "t", type: { kind: "string" }, default: demoDefaults.text },
  { key: "count", token: "c", type: { kind: "int" }, default: demoDefaults.count },
  { key: "ratio", token: "r", type: { kind: "float", step: 0.01 }, default: demoDefaults.ratio },
  { key: "active", token: "a", type: { kind: "bool" }, default: demoDefaults.active },
  { key: "color", token: "k", type: { kind: "color" }, default: demoDefaults.color },
  { key: "mode", token: "m", type: { kind: "enum", values: ["a", "b", "c"] }, default: demoDefaults.mode },
  { key: "point", token: "p", type: { kind: "floatTuple", length: 3, step: 0.001 }, default: demoDefaults.point },
];

const demoCodec = createUrlCodec<DemoState>("1", demoFields);

describe("createUrlCodec", () => {
  it("omits fields equal to their default", () => {
    expect(demoCodec.encode(demoDefaults)).toBe("p1");
  });

  it("round-trips a representative state exactly", () => {
    const state: DemoState = {
      text: "Glyph CSS",
      count: 42,
      ratio: 7.7,
      active: true,
      color: "#7df9ff",
      mode: "b",
      point: [1.234, -5, 0.5],
    };
    const encoded = demoCodec.encode(state);
    const decoded = demoCodec.decode(encoded);
    expect({ ...demoDefaults, ...decoded }).toEqual(state);
  });

  it("round-trips unicode text", () => {
    const state = { ...demoDefaults, text: "héllo 世界 🎉~._-" };
    const decoded = demoCodec.decode(demoCodec.encode(state));
    expect(decoded.text).toBe(state.text);
  });

  it("round-trips extreme/edge numeric values", () => {
    const state: DemoState = {
      ...demoDefaults,
      count: -999999,
      ratio: -12.34,
      point: [0, 0, 0.001],
    };
    const decoded = demoCodec.decode(demoCodec.encode(state));
    expect({ ...demoDefaults, ...decoded }).toEqual(state);
  });

  it("rounds floats to the declared step precision", () => {
    const encoded = demoCodec.encode({ ...demoDefaults, ratio: 1.23456789 });
    const decoded = demoCodec.decode(encoded);
    expect(decoded.ratio).toBe(1.23);
  });

  it("encode(decode(x)) === x for a non-default packed string", () => {
    const state = { ...demoDefaults, count: 7, active: true };
    const packed = demoCodec.encode(state);
    const roundTripped = demoCodec.encode({ ...demoDefaults, ...demoCodec.decode(packed) });
    expect(roundTripped).toBe(packed);
  });

  it("never throws on garbage input and falls back to defaults", () => {
    for (const garbage of ["", "not-a-valid-payload", "p1xxxxxxxxxxxxxxxxxxxx", "🎉🎉🎉", null, undefined]) {
      expect(() => demoCodec.decode(garbage as string | null)).not.toThrow();
      expect(demoCodec.decode(garbage as string | null)).toEqual({});
    }
  });

  it("never throws on truncated input (cut mid-field)", () => {
    const full = demoCodec.encode({ ...demoDefaults, text: "truncate-me", count: 123 });
    for (let i = 1; i < full.length; i++) {
      const truncated = full.slice(0, i);
      expect(() => demoCodec.decode(truncated)).not.toThrow();
    }
  });

  it("falls back to defaults for an unknown/future version", () => {
    const future = demoCodec.encode({ ...demoDefaults, count: 9 }).replace(/^p1/, "p9");
    expect(demoCodec.decode(future)).toEqual({});
  });

  it("ignores unknown trailing tokens instead of throwing", () => {
    const withJunkToken = `${demoCodec.encode({ ...demoDefaults, count: 5 })}Z_this_is_garbage`;
    const decoded = demoCodec.decode(withJunkToken);
    expect(decoded.count).toBe(5);
  });

  it("rejects a non-'p' format synchronously (defaults, no throw)", () => {
    expect(demoCodec.decode("z1somecompresseddata")).toEqual({});
  });
});

// Found by /synth's real preset round-trip test (synthUrlState.e2e.test.ts):
// the field-synth "Moiré rings" preset authors its color in CSS 3-digit
// shorthand (`#9df`). Before this normalization, `encodePackedColor`
// required exactly 6 hex digits and returned `undefined` for anything else
// — `encodeFieldValue`/`encodeSpecValue` treat `undefined` as "drop this
// field", so a shorthand color silently vanished from EVERY link (not just
// a 'z'-compacted one) and always reloaded as the schema default instead.
describe("color field kind — CSS 3-digit shorthand hex", () => {
  it("round-trips a 3-digit shorthand color to its expanded 6-digit equivalent", () => {
    const encoded = demoCodec.encode({ ...demoDefaults, color: "#9df" });
    expect(demoCodec.decode(encoded).color).toBe("#99ddff");
  });

  it("does not silently drop the field the way it did before normalization", () => {
    // A dropped field encodes to the same string as "field equals default"
    // — this pins that the shorthand color actually appears in the packed
    // output, not just that decode happens to produce something.
    const withShorthand = demoCodec.encode({ ...demoDefaults, color: "#9df" });
    const omitted = demoCodec.encode(demoDefaults);
    expect(withShorthand).not.toBe(omitted);
  });

  it("still rejects genuinely invalid color strings", () => {
    expect(encodeEffectParamsPacked(demoEffectSchema, demoEffectDefaults, { color: "not-a-color" })).toBe("");
  });
});

describe("floatOrFalse field kind", () => {
  interface PState { p: number | false }
  const fields: readonly UrlField<PState>[] = [
    { key: "p", token: "p", type: { kind: "floatOrFalse", step: 0.1 } as UrlFieldKind, default: 0 },
  ];
  const codec = createUrlCodec<PState>("1", fields);

  it("round-trips false", () => {
    expect(codec.decode(codec.encode({ p: false }))).toEqual({ p: false });
  });
  it("round-trips a number", () => {
    expect(codec.decode(codec.encode({ p: 12.3 }))).toEqual({ p: 12.3 });
  });
  it("omits the field when equal to default", () => {
    expect(codec.encode({ p: 0 })).toBe("p1");
  });
});

describe("createUrlCodec size", () => {
  it("packs smaller than an equivalent verbose query string", () => {
    const state: DemoState = {
      text: "hello world",
      count: 42,
      ratio: 3.14,
      active: true,
      color: "#abcdef",
      mode: "c",
      point: [1.5, 2.5, 3.5],
    };
    const verbose = new URLSearchParams({
      text: state.text,
      count: String(state.count),
      ratio: String(state.ratio),
      active: "1",
      color: `#${state.color.slice(1)}`,
      mode: state.mode,
      point: state.point.join(","),
    }).toString();
    const packed = demoCodec.encode(state);
    expect(packed.length).toBeLessThan(verbose.length);
  });
});

// ── Generic effect-params codec (shared by gallery/wordart overrides and the
//    synth's own field-synth params) ────────────────────────────────────────
const demoEffectSchema: EffectParamSchemaLike = {
  time: { kind: "number", default: 0, step: 0.01 },
  speed: { kind: "number", default: 1, step: 0.05 },
  glyphs: { kind: "string", default: " .:-=+*#%@" },
  direction: { kind: "string", default: "down", values: ["down", "up", "left", "right"] },
  color: { kind: "color", default: "#7df9ff" },
  monochrome: { kind: "boolean", default: false },
};
const demoEffectDefaults = { time: 0, speed: 1, glyphs: " .:-=+*#%@", direction: "down", color: "#7df9ff", monochrome: false };

describe("encodeEffectParamsPacked / decodeEffectParamsPacked", () => {
  it("round-trips overrides against a schema, excluding `time`", () => {
    const overrides = { time: 99, speed: 2.5, direction: "up", color: "#ff0000", monochrome: true };
    const packed = encodeEffectParamsPacked(demoEffectSchema, demoEffectDefaults, overrides);
    expect(packed).not.toContain("time");
    const decoded = decodeEffectParamsPacked(demoEffectSchema, packed);
    expect(decoded).toEqual({ speed: 2.5, direction: "up", color: "#ff0000", monochrome: true });
  });

  it("returns empty string/object for no overrides", () => {
    expect(encodeEffectParamsPacked(demoEffectSchema, demoEffectDefaults, demoEffectDefaults)).toBe("");
    expect(decodeEffectParamsPacked(demoEffectSchema, "")).toEqual({});
    expect(decodeEffectParamsPacked(demoEffectSchema, undefined)).toEqual({});
  });

  it("never throws on garbage packed params", () => {
    for (const garbage of ["!!!", "zzzzzzzzz", " ", undefined]) {
      expect(() => decodeEffectParamsPacked(demoEffectSchema, garbage)).not.toThrow();
    }
  });

  it("round-trips a free (non-enum) string param with special characters", () => {
    const overrides = { glyphs: "a~b.c-d_e f" };
    const packed = encodeEffectParamsPacked(demoEffectSchema, demoEffectDefaults, overrides);
    expect(decodeEffectParamsPacked(demoEffectSchema, packed)).toEqual(overrides);
  });
});

// ── Multi-char index escape (schemas past 58 direct-range keys) ────────────
// The compact codec's direct range is indices 0..58 (one BASE62 char); index
// 59+ escapes to a 2-char form using BASE62's own top 3 chars ('X'/'Y'/'Z')
// as the hi digit — see urlState.ts's "Compact effect-params codec" section
// doc for why the cutoff sits at 58, not 61. Built here as a synthetic
// 70-key schema so the test doesn't depend on @glyphcss/effects' actual key
// count/order.
function bigSchema(size: number): EffectParamSchemaLike {
  const schema: Record<string, EffectParamSpecLike> = {};
  for (let i = 0; i < size; i++) schema[`k${i}`] = { kind: "number", default: 0, step: 1 };
  return schema;
}

describe("encodeEffectParamsPacked index escape (indices >= 59)", () => {
  it("round-trips a param whose schema index is past the single-char cap", () => {
    const schema = bigSchema(70);
    const defaults = Object.fromEntries(Object.keys(schema).map((k) => [k, 0]));
    const overrides = { k65: 42, k69: 7 };
    const packed = encodeEffectParamsPacked(schema, defaults, overrides);
    expect(decodeEffectParamsPacked(schema, packed)).toEqual(overrides);
  });

  it("round-trips a mix of sub-59 and >=59 indices in one packed string", () => {
    const schema = bigSchema(70);
    const defaults = Object.fromEntries(Object.keys(schema).map((k) => [k, 0]));
    const overrides = { k3: 1, k58: 2, k59: 3, k68: 4 };
    const packed = encodeEffectParamsPacked(schema, defaults, overrides);
    expect(decodeEffectParamsPacked(schema, packed)).toEqual(overrides);
  });

  it("never throws on truncated escaped input", () => {
    const schema = bigSchema(70);
    const defaults = Object.fromEntries(Object.keys(schema).map((k) => [k, 0]));
    const full = encodeEffectParamsPacked(schema, defaults, { k65: 42 });
    for (let i = 1; i < full.length; i++) {
      expect(() => decodeEffectParamsPacked(schema, full.slice(0, i))).not.toThrow();
    }
  });

  it("exercises the exact direct/escape boundary (58 direct, 59 escaped)", () => {
    const schema = bigSchema(70);
    const defaults = Object.fromEntries(Object.keys(schema).map((k) => [k, 0]));
    const overrides = { k0: 5, k10: -3, k58: 99, k59: 100 };
    const packed = encodeEffectParamsPacked(schema, defaults, overrides);
    expect(decodeEffectParamsPacked(schema, packed)).toEqual(overrides);
  });

  it("throws at ENCODE time (loudly, not a silent wraparound) for a schema index past the compact codec's representable range", () => {
    // 59 direct + 3 escape chars x 62 = 245 representable indices (0..244).
    // A schema past that needs another version bump, not a corrupted link —
    // see `encodeCompactIndex`'s doc.
    const schema = bigSchema(250);
    const defaults = Object.fromEntries(Object.keys(schema).map((k) => [k, 0]));
    expect(() => encodeEffectParamsPacked(schema, defaults, { k249: 1 })).toThrow();
  });
});

// ── Run tokens (RUN_MARKER "_"): identical values at CONSECUTIVE indices ───
describe("encodeEffectParamsPacked run tokens", () => {
  it("collapses a consecutive-index run sharing one value into a single run token", () => {
    const schema = bigSchema(20);
    const defaults = Object.fromEntries(Object.keys(schema).map((k) => [k, 0]));
    const overrides = { k2: 7, k3: 7, k4: 7, k5: 7 };
    const packed = encodeEffectParamsPacked(schema, defaults, overrides);
    expect(packed).toContain("_");
    // 4 individual tokens would cost 4 * (1 index char + up to 2 value
    // chars) = up to 12 chars; the run token is markedly shorter.
    expect(packed.length).toBeLessThan(10);
    expect(decodeEffectParamsPacked(schema, packed)).toEqual(overrides);
  });

  it("does NOT merge a run across a value change (breaks the run at the differing member)", () => {
    const schema = bigSchema(20);
    const defaults = Object.fromEntries(Object.keys(schema).map((k) => [k, 0]));
    const overrides = { k2: 7, k3: 7, k4: 9, k5: 7 };
    const packed = encodeEffectParamsPacked(schema, defaults, overrides);
    expect(decodeEffectParamsPacked(schema, packed)).toEqual(overrides);
  });

  it("does NOT merge two keys of a DIFFERENT kind/step even at consecutive indices with a coincidentally-equal encoded value", () => {
    // The exact bug class caught during design: a schema where consecutive
    // keys have different `step`s can encode the SAME raw digit string for
    // DIFFERENT real numbers. Grouping by encoded string alone (ignoring
    // step) would silently swap a decoded value's real magnitude.
    const schema: EffectParamSchemaLike = {
      a: { kind: "number", default: 0, step: 0.1 },
      b: { kind: "number", default: 0, step: 0.05 },
    };
    const defaults = { a: 0, b: 0 };
    // Both round to the same base36 digit string for their own step (units
    // 20 -> digits "k"), but a's real value (2.0) != b's real value (1.0).
    const overrides = { a: 2.0, b: 1.0 };
    const packed = encodeEffectParamsPacked(schema, defaults, overrides);
    const decoded = decodeEffectParamsPacked(schema, packed);
    expect(decoded.a).toBeCloseTo(2.0, 5);
    expect(decoded.b).toBeCloseTo(1.0, 5);
  });

  it("splits a run longer than the single-char count field's max (61) into multiple run tokens", () => {
    const schema = bigSchema(80);
    const defaults = Object.fromEntries(Object.keys(schema).map((k) => [k, 0]));
    const overrides = Object.fromEntries(Array.from({ length: 70 }, (_, i) => [`k${i}`, 3]));
    const packed = encodeEffectParamsPacked(schema, defaults, overrides);
    expect(decodeEffectParamsPacked(schema, packed)).toEqual(overrides);
  });

  it("never throws on truncated run-token input", () => {
    const schema = bigSchema(20);
    const defaults = Object.fromEntries(Object.keys(schema).map((k) => [k, 0]));
    const full = encodeEffectParamsPacked(schema, defaults, { k2: 7, k3: 7, k4: 7 });
    for (let i = 1; i < full.length; i++) {
      expect(() => decodeEffectParamsPacked(schema, full.slice(0, i))).not.toThrow();
    }
  });
});

// ── List tokens (LIST_MARKER "*"): identical values at SCATTERED indices ───
describe("encodeEffectParamsPacked list tokens", () => {
  it("collapses a scattered-index group sharing one value into a single list token when it's cheaper", () => {
    const schema = bigSchema(20);
    const defaults = Object.fromEntries(Object.keys(schema).map((k) => [k, 0]));
    // step 1 -> encoded value "1k" is 2 chars; (n-1)*2 - 2 > 0 for n >= 3.
    const overrides = { k1: 20, k7: 20, k13: 20, k19: 20 };
    const packed = encodeEffectParamsPacked(schema, defaults, overrides);
    expect(packed).toContain("*");
    expect(decodeEffectParamsPacked(schema, packed)).toEqual(overrides);
  });

  it("does NOT list-group a 2-member/1-char-value pair that would cost MORE as a list (falls back to individual tokens)", () => {
    const schema = bigSchema(20);
    const defaults = Object.fromEntries(Object.keys(schema).map((k) => [k, 0]));
    const overrides = { k1: 3, k7: 3 }; // value "3" is 1 char; (2-1)*1 - 2 < 0
    const packed = encodeEffectParamsPacked(schema, defaults, overrides);
    expect(packed).not.toContain("*");
    expect(decodeEffectParamsPacked(schema, packed)).toEqual(overrides);
  });

  it("does NOT merge two keys of a DIFFERENT kind/step sharing a coincidentally-equal encoded value into one list", () => {
    const schema: EffectParamSchemaLike = {
      a: { kind: "number", default: 0, step: 0.1 },
      b: { kind: "number", default: 0, step: 0.05 },
      c: { kind: "number", default: 0, step: 0.1 },
      d: { kind: "number", default: 0, step: 0.1 },
    };
    const defaults = { a: 0, b: 0, c: 0, d: 0 };
    const overrides = { a: 2.0, b: 1.0, c: 2.0, d: 2.0 }; // a/c/d share step 0.1, b doesn't
    const packed = encodeEffectParamsPacked(schema, defaults, overrides);
    const decoded = decodeEffectParamsPacked(schema, packed);
    expect(decoded).toEqual(overrides);
  });

  it("never throws on truncated list-token input", () => {
    const schema = bigSchema(20);
    const defaults = Object.fromEntries(Object.keys(schema).map((k) => [k, 0]));
    const full = encodeEffectParamsPacked(schema, defaults, { k1: 20, k7: 20, k13: 20 });
    for (let i = 1; i < full.length; i++) {
      expect(() => decodeEffectParamsPacked(schema, full.slice(0, i))).not.toThrow();
    }
  });
});

// ── Adversarial delimiters: RUN_MARKER "_" / LIST_MARKER "*" inside a free
//    string VALUE, alongside real run/list tokens in the SAME packed string
//    — proving the length-prefixed string value never gets misread as a
//    fresh marker, and a real marker never bleeds into adjacent content. ──
describe("compact codec — adversarial delimiter round-trips", () => {
  it("a free string value containing literal '_' and '*' round-trips unambiguously, even sitting next to a real run token", () => {
    const schema: EffectParamSchemaLike = {
      text: { kind: "string", default: "" },
      r1: { kind: "number", default: 0, step: 1 },
      r2: { kind: "number", default: 0, step: 1 },
      r3: { kind: "number", default: 0, step: 1 },
    };
    const defaults = { text: "", r1: 0, r2: 0, r3: 0 };
    // The string's own content is a plausible-looking (but fake) run/list
    // token — "_XY5" / "*3..." — that must be consumed as opaque length-
    // prefixed content, never re-parsed as a marker.
    const overrides = { text: "a_XY5*3bb_hi*there_", r1: 9, r2: 9, r3: 9 };
    const packed = encodeEffectParamsPacked(schema, defaults, overrides);
    expect(packed).toContain("_"); // the REAL run token for r1/r2/r3
    expect(decodeEffectParamsPacked(schema, packed)).toEqual(overrides);
  });

  it("a free string value ending in digits round-trips correctly when immediately followed by another token", () => {
    const schema: EffectParamSchemaLike = {
      text: { kind: "string", default: "" },
      n: { kind: "number", default: 0, step: 1 },
    };
    const defaults = { text: "", n: 0 };
    const overrides = { text: "ends-with-9", n: 42 };
    const packed = encodeEffectParamsPacked(schema, defaults, overrides);
    expect(decodeEffectParamsPacked(schema, packed)).toEqual(overrides);
  });

  it("an empty string value round-trips", () => {
    const schema: EffectParamSchemaLike = { text: { kind: "string", default: "x" } };
    const packed = encodeEffectParamsPacked(schema, { text: "x" }, { text: "" });
    expect(decodeEffectParamsPacked(schema, packed)).toEqual({ text: "" });
  });
});

// ── Fuzz: hundreds of randomized patches, encode -> decode -> deep-equal ───
describe("compact codec — round-trip fuzz", () => {
  const FUZZ_ENUM = ["alpha", "beta", "gamma", "delta"] as const;
  const fuzzSchema: EffectParamSchemaLike = {
    time: { kind: "number", default: 0, step: 0.01 },
    // A 9-member family sharing kind+step, mirroring field-synth's per-voice
    // layout — the shape run/list tokens are aimed at.
    ...Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`freq${i + 1}`, { kind: "number", default: 1, step: 0.1 } as EffectParamSpecLike])),
    ...Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`amp${i + 1}`, { kind: "number", default: 0, step: 0.05 } as EffectParamSpecLike])),
    ...Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`on${i + 1}`, { kind: "boolean", default: false } as EffectParamSpecLike])),
    mode: { kind: "string", default: "alpha", values: FUZZ_ENUM },
    label: { kind: "string", default: "" },
    tint: { kind: "color", default: "#000000" },
    // Push well past the direct-index range (>= 59) to exercise the escape.
    ...Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`pad${i}`, { kind: "number", default: 0, step: 1 } as EffectParamSpecLike])),
  };
  const fuzzKeys = Object.keys(fuzzSchema).filter((k) => k !== "time");
  const fuzzDefaults = Object.fromEntries(Object.entries(fuzzSchema).map(([k, spec]) => [k, spec.default]));

  function randomValueFor(spec: EffectParamSpecLike, rng: () => number): unknown {
    if (spec.kind === "boolean") return rng() < 0.5;
    if (spec.kind === "color") return `#${Math.floor(rng() * 0xffffff).toString(16).padStart(6, "0")}`;
    if (spec.kind === "string" && spec.values) return spec.values[Math.floor(rng() * spec.values.length)];
    if (spec.kind === "string") {
      const pool = ["", "x", "hello world", "a_b*c", "unicode 世界 🎉", "  spaced  ", "-1", "0.5"];
      return pool[Math.floor(rng() * pool.length)];
    }
    // number: mix of edge cases and random fractional/negative values.
    const edgeCases = [0, -1, 1, -999999, 999999, 0.0001, -0.0001];
    if (rng() < 0.2) return edgeCases[Math.floor(rng() * edgeCases.length)];
    return Math.round((rng() * 2000 - 1000) / (spec.step ?? 1)) * (spec.step ?? 1);
  }

  // Deterministic mulberry32 PRNG — reproducible failures, no external dep.
  function mulberry32(seed: number): () => number {
    let a = seed;
    return () => {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  it("round-trips 500 randomized patches (partial overrides, mixed kinds)", () => {
    const rng = mulberry32(20260215);
    for (let trial = 0; trial < 500; trial++) {
      const overrideCount = Math.floor(rng() * (fuzzKeys.length + 1));
      const shuffled = [...fuzzKeys].sort(() => rng() - 0.5);
      const chosen = shuffled.slice(0, overrideCount);
      const overrides: Record<string, unknown> = {};
      for (const key of chosen) overrides[key] = randomValueFor(fuzzSchema[key]!, rng);
      const packed = encodeEffectParamsPacked(fuzzSchema, fuzzDefaults, overrides);
      const decoded = decodeEffectParamsPacked(fuzzSchema, packed);
      for (const key of chosen) {
        const spec = fuzzSchema[key]!;
        if (sameSpecValueForTest(spec, overrides[key], fuzzDefaults[key])) {
          // Genuinely equal to default (possible after step-rounding an
          // edge-case value) — legitimately omitted, nothing to assert.
          continue;
        }
        if (spec.kind === "number") {
          expect(decoded[key], `trial ${trial} key ${key}`).toBeCloseTo(quantizeForTest(spec, overrides[key] as number), 5);
        } else if (spec.kind === "color") {
          expect(String(decoded[key]).toLowerCase(), `trial ${trial} key ${key}`).toBe(String(overrides[key]).toLowerCase());
        } else {
          expect(decoded[key], `trial ${trial} key ${key}`).toBe(overrides[key]);
        }
      }
    }
  });

  it("round-trips the all-defaults patch to an empty payload", () => {
    expect(encodeEffectParamsPacked(fuzzSchema, fuzzDefaults, fuzzDefaults)).toBe("");
  });

  it("round-trips the all-non-default patch (every key touched at once)", () => {
    const rng = mulberry32(1);
    const overrides: Record<string, unknown> = {};
    for (const key of fuzzKeys) {
      let value = randomValueFor(fuzzSchema[key]!, rng);
      // Force genuinely non-default for number/boolean/color (string enum
      // already differs by construction below).
      while (sameSpecValueForTest(fuzzSchema[key]!, value, fuzzDefaults[key])) value = randomValueFor(fuzzSchema[key]!, rng);
      overrides[key] = value;
    }
    const packed = encodeEffectParamsPacked(fuzzSchema, fuzzDefaults, overrides);
    const decoded = decodeEffectParamsPacked(fuzzSchema, packed);
    for (const key of fuzzKeys) {
      const spec = fuzzSchema[key]!;
      if (spec.kind === "number") expect(decoded[key], key).toBeCloseTo(quantizeForTest(spec, overrides[key] as number), 5);
      else if (spec.kind === "color") expect(String(decoded[key]).toLowerCase(), key).toBe(String(overrides[key]).toLowerCase());
      else expect(decoded[key], key).toBe(overrides[key]);
    }
  });

  it("hits every enum value at least once across a scan of all mode values", () => {
    for (const value of FUZZ_ENUM) {
      const packed = encodeEffectParamsPacked(fuzzSchema, fuzzDefaults, { mode: value });
      expect(decodeEffectParamsPacked(fuzzSchema, packed).mode).toBe(value === fuzzDefaults.mode ? undefined : value);
    }
  });

  it("never throws across truncation of 20 randomized full patches", () => {
    const rng = mulberry32(7);
    for (let trial = 0; trial < 20; trial++) {
      const overrides: Record<string, unknown> = {};
      for (const key of fuzzKeys) if (rng() < 0.6) overrides[key] = randomValueFor(fuzzSchema[key]!, rng);
      const full = encodeEffectParamsPacked(fuzzSchema, fuzzDefaults, overrides);
      for (let i = 0; i < full.length; i += 3) {
        expect(() => decodeEffectParamsPacked(fuzzSchema, full.slice(0, i)), `trial ${trial} cut ${i}`).not.toThrow();
      }
    }
  });
});

function quantizeForTest(spec: EffectParamSpecLike, value: number): number {
  const step = spec.step && spec.step > 0 ? spec.step : 0.0001;
  return Math.round(value / step) * step;
}

function sameSpecValueForTest(spec: EffectParamSpecLike, a: unknown, b: unknown): boolean {
  if (spec.kind === "number" && typeof a === "number" && typeof b === "number") {
    const step = spec.step && spec.step > 0 ? spec.step : 0.0001;
    return Math.round(a / step) === Math.round(b / step);
  }
  if (spec.kind === "color" && typeof a === "string" && typeof b === "string") {
    return a.toLowerCase() === b.toLowerCase();
  }
  return a === b;
}
