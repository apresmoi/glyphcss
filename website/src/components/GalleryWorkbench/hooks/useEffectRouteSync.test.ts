// @vitest-environment happy-dom
//
// happy-dom (rather than the file-default `node` environment) is needed for
// the legacy-link regression block below, which exercises the REAL
// entry-point functions (`routeInitialEffectState`/`setRouteEffectState`)
// through an actual `window.location`. Every other test in this file is a
// pure `effectCodec` call with no `window` dependency, so the environment
// switch doesn't change their behavior.
import { describe, expect, it } from "vitest";
import {
  createUrlCodec,
  decodeEffectParamsPacked,
  encodeEffectParamsPacked,
  encodeEffectParamsPackedLegacy,
  readUrlParam,
  writeUrlParam,
  type UrlField,
} from "../../../lib/urlState";
import { effectCodec, routeInitialEffectState } from "./useEffectRouteSync";
import { GALLERY_EFFECT_CATALOG, galleryEffectDefaultParams } from "../effects";

describe("gallery effect route codec", () => {
  it("omits the field when there is no active effect", () => {
    expect(effectCodec.encode({ effectId: "", effectVersion: 0, blend: "replace", paused: false, timeScale: 1, params: "" })).toBe("p2");
  });

  it("round-trips a real stock effect + its parameter overrides", () => {
    const definition = GALLERY_EFFECT_CATALOG.find((d) => d.id === "matrix-rain") ?? GALLERY_EFFECT_CATALOG[0]!;
    const defaults = galleryEffectDefaultParams(definition);
    // Pick a value that's guaranteed valid for each spec kind: enum ->
    // the schema's own next allowed value, number -> default+1, boolean ->
    // flipped, free string -> mutated text.
    const schema = definition.parameterSchema;
    const overrideEntries = Object.entries(defaults).filter(([k]) => k !== "time").slice(0, 3);
    const overrides = Object.fromEntries(overrideEntries.map(([k, v]) => {
      const spec = schema[k]!;
      if (spec.kind === "number") return [k, (v as number) + 1];
      if (spec.kind === "boolean") return [k, !v];
      if (spec.kind === "string" && "values" in spec && spec.values) {
        const alt = spec.values.find((candidate) => candidate !== v) ?? (v as string);
        return [k, alt];
      }
      return [k, `${v}-changed`];
    }));
    const packedParams = encodeEffectParamsPacked(definition.parameterSchema, defaults, overrides);

    const encoded = effectCodec.encode({
      effectId: definition.id,
      effectVersion: definition.version,
      blend: definition.defaultBlend === "over" ? "replace" : "over",
      paused: true,
      timeScale: 2.25,
      params: packedParams,
    });
    expect(encoded).not.toBe("p1");

    const decoded = effectCodec.decode(encoded);
    expect(decoded.effectId).toBe(definition.id);
    expect(decoded.effectVersion).toBe(definition.version);
    expect(decoded.blend).toBe(definition.defaultBlend === "over" ? "replace" : "over");
    expect(decoded.paused).toBe(true);
    expect(decoded.timeScale).toBe(2.25);

    const decodedParams = decodeEffectParamsPacked(definition.parameterSchema, decoded.params);
    expect(decodedParams).toEqual(overrides);
  });

  it("falls back to defaults ({}) for garbage, truncated, or future-version input", () => {
    for (const garbage of ["", "garbage", "p1Zxxxxx", "p9somethingfromthefuture", "z1notreallydeflated"]) {
      expect(() => effectCodec.decode(garbage)).not.toThrow();
    }
    expect(effectCodec.decode("not-valid")).toEqual({});
    expect(effectCodec.decode("p9futureversion")).toEqual({});
  });
});

// ── Compact codec rewrite: EFFECT_SCHEMA_VERSION 1 -> 2 (website/src/lib/
//    urlState.ts's run/list token grammar, same shared change as /synth's
//    v4 -> v5 and /wordart's v1 -> v2) ─────────────────────────────────────
// Every other field is unchanged; only the nested `params` field's wire
// format changed, so a "1"-tagged `?fx=` link's `params` must decode
// through the LEGACY pair (`decodeEffectParamsPackedLegacy`) even though
// its outer field list is identical — see `useEffectRouteSync.ts`'s
// `decodeEffectState`'s `raw[1] === "1"` dispatch.
describe("gallery effect route codec — v1 legacy decode (compact codec rewrite)", () => {
  const GALLERY_PARAM = "fx";

  function overridesFor(effectId: string) {
    const definition = GALLERY_EFFECT_CATALOG.find((d) => d.id === effectId) ?? GALLERY_EFFECT_CATALOG[0]!;
    const defaults = galleryEffectDefaultParams(definition);
    const overrideEntries = Object.entries(defaults).filter(([k]) => k !== "time").slice(0, 3);
    const overrides = Object.fromEntries(overrideEntries.map(([k, v]) => {
      const spec = definition.parameterSchema[k]!;
      if (spec.kind === "number") return [k, (v as number) + 1];
      if (spec.kind === "boolean") return [k, !v];
      if (spec.kind === "string" && "values" in spec && spec.values) {
        const alt = spec.values.find((candidate) => candidate !== v) ?? (v as string);
        return [k, alt];
      }
      return [k, `${v}-changed`];
    }));
    return { definition, defaults, overrides };
  }

  it("a genuinely v1-tagged link decodes identically to the equivalent v2 link", () => {
    const { definition, defaults, overrides } = overridesFor("matrix-rain");
    const legacyFields = effectCodec.fields as readonly UrlField<Record<string, unknown>>[];
    const legacyCodec = createUrlCodec<Record<string, unknown>>("1", legacyFields);
    const legacyParams = encodeEffectParamsPackedLegacy(definition.parameterSchema, defaults, overrides);
    const legacyPacked = legacyCodec.encode({
      effectId: definition.id, effectVersion: definition.version, blend: "over", paused: true, timeScale: 2.25, params: legacyParams,
    });
    expect(legacyPacked[1]).toBe("1");

    const currentParams = encodeEffectParamsPacked(definition.parameterSchema, defaults, overrides);
    const currentPacked = effectCodec.encode({
      effectId: definition.id, effectVersion: definition.version, blend: "over", paused: true, timeScale: 2.25, params: currentParams,
    });

    writeUrlParam(GALLERY_PARAM, legacyPacked);
    const decodedLegacy = routeInitialEffectState();
    writeUrlParam(GALLERY_PARAM, currentPacked);
    const decodedCurrent = routeInitialEffectState();
    expect(decodedLegacy).toEqual(decodedCurrent);
  });

  // Captured from THIS repo's code BEFORE the v2 compact-codec change landed
  // (a real `effectCodec.encode(...)` output on the then-current v1 codec,
  // built the same way `useEffectRouteSync.test.ts`'s own round-trip test
  // above builds one, not hand-typed) — the strongest available proof that
  // an already-shared /gallery `?fx=` link keeps decoding to exactly the
  // state it always did.
  const REAL_V1_LINK = "p1i0v11b1p1s3hd0xj.1c.HOLA-changed2130";

  it("decodes the real captured v1 link to exactly its pre-change state", () => {
    expect(REAL_V1_LINK[1]).toBe("1");
    writeUrlParam(GALLERY_PARAM, REAL_V1_LINK);
    const decoded = routeInitialEffectState();
    expect(decoded.effectId).toBe("matrix-rain");
    expect(decoded.blend).toBe("over");
    expect(decoded.paused).toBe(true);
    expect(decoded.timeScale).toBeCloseTo(2.25, 5);
    // `routeInitialEffectState` returns the FULL sanitized param object
    // (overrides merged over schema defaults, not the raw override diff),
    // so only the 3 actually-overridden keys are asserted here.
    expect(decoded.params.glyphs).toBe("HOLA-changed");
    expect(decoded.params.direction).toBe("up");
    expect(decoded.params.space).toBe("auto");
  });

  it("shows the real win on a richer applied effect (field-synth, a shipped preset's full override set)", async () => {
    // matrix-rain's small schema (above) is a worst case for these levers —
    // field-synth's 208-key schema and its typically-repeated per-voice
    // values is the realistic case they're aimed at (a user picking a
    // richer effect on /gallery, not just a small stock effect).
    const { GlyphCssGraphicsMengerPreset, GlyphFieldSynthEffect: fieldSynthEffect, defaultGlyphEffectParams: defaultParams } = await import("@glyphcss/effects");
    const defaults = defaultParams(fieldSynthEffect) as Record<string, unknown>;
    const overrides = GlyphCssGraphicsMengerPreset.params as Record<string, unknown>;
    const legacyEffectParams = encodeEffectParamsPackedLegacy(fieldSynthEffect.parameterSchema, defaults, overrides);
    const newEffectParams = encodeEffectParamsPacked(fieldSynthEffect.parameterSchema, defaults, overrides);
    const legacyFields = effectCodec.fields as readonly UrlField<Record<string, unknown>>[];
    const legacyCodec = createUrlCodec<Record<string, unknown>>("1", legacyFields);
    const legacyPacked = legacyCodec.encode({ effectId: fieldSynthEffect.id, effectVersion: fieldSynthEffect.version, blend: "over", paused: false, timeScale: 1, params: legacyEffectParams });
    const newPacked = effectCodec.encode({ effectId: fieldSynthEffect.id, effectVersion: fieldSynthEffect.version, blend: "over", paused: false, timeScale: 1, params: newEffectParams });
    expect(newPacked.length).toBeLessThan(legacyPacked.length);
    // eslint-disable-next-line no-console
    console.log(`gallery ?fx= (field-synth, Menger cssGraphics overrides): v1 ${legacyPacked.length} chars -> v2 ${newPacked.length} chars`);
  });

  it("re-encodes the same state at least as short as the captured v1 length", () => {
    const { definition, defaults, overrides } = overridesFor("matrix-rain");
    const params = encodeEffectParamsPacked(definition.parameterSchema, defaults, overrides);
    const packed = effectCodec.encode({ effectId: definition.id, effectVersion: definition.version, blend: "over", paused: true, timeScale: 2.25, params });
    expect(packed[1]).toBe("2");
    expect(packed.length).toBeLessThanOrEqual(REAL_V1_LINK.length);
    // eslint-disable-next-line no-console
    console.log(`gallery fx (matrix-rain, 3 overrides): v1 ${REAL_V1_LINK.length} chars -> v2 ${packed.length} chars`);
  });
});
