import { describe, expect, it } from "vitest";
import { computeGlyphControlContentSha256, type GlyphControlFrame } from "./controlFrame";
import { GLYPH_CONTROL_TENSOR_CONTRACT, packGlyphControlTensor, validateGlyphControlTensorSpec } from "./controlTensor";

const hash = (character: string) => character.repeat(64);
const frame: GlyphControlFrame = {
  visibleAscii: "X ", semanticAscii: "A ", visibleColor: new Uint32Array([0xffffffff, 0]), semanticColor: new Uint32Array([0xff102030, 0]), coverage: new Uint8Array([1, 0]), winnerPolygon: new Int32Array([0, -1]), classId: new Int32Array([1, -1]), instanceId: new Int32Array([0, -1]), surfaceId: new Int32Array([0, -1]), instanceLookup: ["instance/a"], surfaceLookup: ["surface/a"], depth: new Float64Array([5, NaN]), shade: new Float32Array([.25, NaN]), normal: new Float32Array([0, 1, -1, NaN, NaN, NaN]), worldPosition: new Float32Array([0, 5, 10, NaN, NaN, NaN]), surfaceUv: new Float32Array([.5, 1, NaN, NaN]),
  metadata: { scene: { schemaVersion: "control-scene/v1", id: "scene/a", dictionaryId: "dictionary/a", dictionarySha256: hash("d"), geometrySha256: hash("e"), polygonOrderSha256: hash("f"), contentSha256: hash("b"), instances: [{ id: "instance/a", classId: 1 }], surfaces: [{ id: "surface/a", instanceId: "instance/a" }], polygonSurfaceIds: ["surface/a"] }, dictionary: { schemaVersion: "glyph-object-dictionary/v2", id: "dictionary/a", contentSha256: hash("d"), font: { id: "font/a", version: "1", sha256: hash("a") } }, camera: { kind: "orthographic", rotX: 0, rotY: 0, center: [0, 0], mat: null, useMat: false, distance: 0, perspective: 0, zoom: 1, stretch: 1, fovScale: 1, target: [0, 0, 0], eyeMode: false }, cols: 2, rows: 1, cellAspect: 2, supersample: 1 },
};
const normalization = { depth: { near: 0, far: 10 }, world: { min: [-10, 0, 0] as [number, number, number], max: [10, 10, 20] as [number, number, number] } };

describe("packGlyphControlTensor", () => {
  it("packs frozen 17/23-channel NCHW tensors with normalized geometry and zero empties", () => {
    const result = packGlyphControlTensor(frame, normalization, { warpRgb: new Float32Array([.1, 0, 1, .2, 0, 1]), reprojectionValid: new Float32Array([1, 0]), disocclusion: new Float32Array([0, 1]), atlasConfidence: new Float32Array([.5, 0]) });
    expect(result.keyframe.length).toBe(17 * 2); expect(result.temporal?.length).toBe(23 * 2);
    expect(Array.from(result.keyframe).every((value) => value >= 0 && value <= 1)).toBe(true);
    expect(result.keyframe[1]).toBe(0); // empty visible-glyph plane
    expect(result.keyframe[5 * 2]).toBe(.5); // normalized depth
    expect(result.keyframe[9 * 2]).toBe(.5); // normalized world x
    expect(result.spec.contract.keyframeChannels.map((channel) => channel.id)).toEqual(["visible-glyph", "semantic-glyph", "semantic-control-color", "camera-depth", "geometric-normal", "world-position", "surface-uv", "surface-uv-valid", "coverage", "lambert-shade"]);
    expect(result.spec.instance.normalization).toEqual(normalization);
    expect(result.spec.instance.scene.sha256).toBe(frame.metadata.scene.contentSha256);
    expect(Object.isFrozen(result.spec)).toBe(true);
    expect(Object.isFrozen(result.spec.contract.keyframeChannels)).toBe(true);
    expect(Object.isFrozen(result.spec.contract.keyframeChannels[0]!.clamp)).toBe(true);
    expect(() => { (result.spec.contract.keyframeChannels as GlyphControlFrame[] as unknown as { push: (x: unknown) => void }).push({}); }).toThrow();
    expect(() => { (result.spec.contract.keyframeChannels[0]!.clamp as number[])[0] = 9; }).toThrow();
    expect(() => { (result.spec.instance.normalization.depth as { near: number }).near = 9; }).toThrow();
    expect(GLYPH_CONTROL_TENSOR_CONTRACT.keyframeChannels[0]!.clamp).toEqual([0, 1]);
  });

  it("fails closed for reordered/scaled/sentinel/raw-ID/hash/dependency contracts", () => {
    const spec = packGlyphControlTensor(frame, normalization).spec;
    const reseal = (value: object) => ({ ...value, contentSha256: computeGlyphControlContentSha256(value) });
    const resealSpec = (value: Omit<typeof spec, "contentSha256">) => reseal(value) as typeof spec;
    const changedContract = (contract: object) => resealSpec({ ...spec, contract: reseal(contract) as typeof spec.contract });
    expect(() => validateGlyphControlTensorSpec(changedContract({ ...spec.contract, keyframeChannels: [...spec.contract.keyframeChannels].reverse() }))).toThrow(/frozen B32/);
    expect(() => validateGlyphControlTensorSpec(changedContract({ ...spec.contract, keyframeChannels: [{ ...spec.contract.keyframeChannels[0]!, scaling: "raw" }, ...spec.contract.keyframeChannels.slice(1)] }))).toThrow(/frozen B32/);
    expect(() => validateGlyphControlTensorSpec(changedContract({ ...spec.contract, keyframeChannels: [{ ...spec.contract.keyframeChannels[0]!, emptySentinel: -1 }, ...spec.contract.keyframeChannels.slice(1)] }))).toThrow(/frozen B32/);
    expect(() => validateGlyphControlTensorSpec(changedContract({ ...spec.contract, keyframeChannels: [{ ...spec.contract.keyframeChannels[0]!, source: "surfaceId" as never }, ...spec.contract.keyframeChannels.slice(1)] }))).toThrow(/frozen B32/);
    expect(() => validateGlyphControlTensorSpec({ ...spec, contentSha256: hash("0") })).toThrow(/contentSha256 mismatch/);
    const badInstance = reseal({ ...spec.instance, font: { ...spec.instance.font, id: "font/wrong" } });
    expect(() => validateGlyphControlTensorSpec(resealSpec({ ...spec, instance: badInstance as typeof spec.instance }), frame)).toThrow(/dependency mismatch/);
    const normalizationInstance = reseal({ ...spec.instance, normalization: { ...spec.instance.normalization, depth: { near: 1, far: 10 } } });
    expect(() => validateGlyphControlTensorSpec(resealSpec({ ...spec, instance: normalizationInstance as typeof spec.instance }), frame, normalization)).toThrow(/normalization dependency mismatch/);
  });

  it("rejects unnormalized depth/world bounds and malformed temporal inputs", () => {
    expect(() => packGlyphControlTensor(frame, { ...normalization, depth: { near: 1, far: 1 } })).toThrow(/far > near/);
    expect(() => packGlyphControlTensor(frame, { ...normalization, world: { ...normalization.world, max: [-10, 10, 20] } })).toThrow(/max > min/);
    expect(() => packGlyphControlTensor(frame, normalization, { warpRgb: new Float32Array(1), reprojectionValid: new Float32Array(2), disocclusion: new Float32Array(2), atlasConfidence: new Float32Array(2) })).toThrow(/warpRgb/);
    expect(() => packGlyphControlTensor(frame, normalization, { warpRgb: new Float32Array([NaN, 0, 0, 0, 0, 0]), reprojectionValid: new Float32Array([1, 0]), disocclusion: new Float32Array([0, 1]), atlasConfidence: new Float32Array([0, 0]) })).toThrow(/warpRgb/);
    expect(() => packGlyphControlTensor(frame, normalization, { warpRgb: new Float32Array(6), reprojectionValid: new Float32Array([.5, 0]), disocclusion: new Float32Array([0, 1]), atlasConfidence: new Float32Array(2) })).toThrow(/reprojectionValid/);
    expect(() => packGlyphControlTensor({ ...frame, visibleAscii: "☃ " }, normalization)).toThrow(/ascii-printable-v1/);
    expect(() => packGlyphControlTensor({ ...frame, coverage: new Uint8Array([2, 0]) }, normalization)).toThrow(/coverage must be binary/);
  });

  it("packs unavailable authored UVs on covered cells as the frozen zero sentinel", () => {
    const unavailableUv = { ...frame, surfaceUv: new Float32Array([NaN, NaN, NaN, NaN]) };
    const result = packGlyphControlTensor(unavailableUv, normalization);
    const cells = frame.metadata.cols * frame.metadata.rows;
    expect(Array.from(result.keyframe.slice(12 * cells, 14 * cells))).toEqual([0, 0, 0, 0]);
    expect(Array.from(result.keyframe.slice(14 * cells, 15 * cells))).toEqual([0, 0]);
    expect(Number.isNaN(unavailableUv.surfaceUv[0])).toBe(true);
  });
});
