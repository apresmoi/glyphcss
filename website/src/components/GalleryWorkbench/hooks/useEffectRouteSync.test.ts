import { describe, expect, it } from "vitest";
import { encodeEffectParamsPacked, decodeEffectParamsPacked } from "../../../lib/urlState";
import { effectCodec } from "./useEffectRouteSync";
import { GALLERY_EFFECT_CATALOG, galleryEffectDefaultParams } from "../effects";

describe("gallery effect route codec", () => {
  it("omits the field when there is no active effect", () => {
    expect(effectCodec.encode({ effectId: "", effectVersion: 0, blend: "replace", paused: false, timeScale: 1, params: "" })).toBe("p1");
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
