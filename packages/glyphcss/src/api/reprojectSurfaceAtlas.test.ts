import { describe, expect, it } from "vitest";
import { reprojectGlyphSurfaceAtlas, resampleGlyphTemporalInputs } from "./reprojectSurfaceAtlas";
import { packGlyphControlTensor } from "./controlTensor";
import type { GlyphControlFrame } from "./controlFrame";

const hash = (character: string) => character.repeat(64);
function frame(surfaces: readonly (string | null)[], uvs: readonly (readonly [number, number])[] = surfaces.map((_, index) => [index / Math.max(1, surfaces.length - 1), .5])): GlyphControlFrame {
  const n = surfaces.length, ids = [...new Set(surfaces.filter((value): value is string => value !== null))].sort();
  return {
    visibleAscii: surfaces.map((value) => value ? "X" : " ").join(""), semanticAscii: surfaces.map((value) => value ? "A" : " ").join(""),
    visibleColor: new Uint32Array(n), semanticColor: new Uint32Array(n), coverage: new Uint8Array(surfaces.map((value) => value ? 1 : 0)), winnerPolygon: new Int32Array(surfaces.map((value, index) => value ? index : -1)), classId: new Int32Array(surfaces.map((value) => value ? 1 : -1)), instanceId: new Int32Array(surfaces.map((value) => value ? 0 : -1)), surfaceId: new Int32Array(surfaces.map((value) => value ? ids.indexOf(value) : -1)), instanceLookup: ["instance/a"], surfaceLookup: ids,
    depth: new Float64Array(surfaces.map((value) => value ? 1 : Number.NaN)), shade: new Float32Array(surfaces.map((value) => value ? 1 : Number.NaN)), normal: new Float32Array(Array.from({ length: n * 3 }, (_, index) => surfaces[Math.floor(index / 3)] ? 0 : Number.NaN)), worldPosition: new Float32Array(Array.from({ length: n * 3 }, (_, index) => surfaces[Math.floor(index / 3)] ? index : Number.NaN)), surfaceUv: new Float32Array(uvs.flatMap(([u, v], index) => surfaces[index] ? [u, v] : [Number.NaN, Number.NaN])),
    metadata: { scene: { schemaVersion: "control-scene/v1", id: "scene/a", dictionaryId: "dictionary/a", dictionarySha256: hash("d"), geometrySha256: hash("e"), polygonOrderSha256: hash("f"), contentSha256: hash("b"), instances: [{ id: "instance/a", classId: 1 }], surfaces: ids.map((id) => ({ id, instanceId: "instance/a" })), polygonSurfaceIds: surfaces.map((value) => value ?? "surface/a") }, dictionary: { schemaVersion: "glyph-object-dictionary/v2", id: "dictionary/a", contentSha256: hash("d"), font: { id: "font/a", version: "1", sha256: hash("a") } }, camera: { kind: "orthographic", rotX: 0, rotY: 0, center: [0, 0], mat: null, useMat: false, distance: 0, perspective: 0, zoom: 1, stretch: 1, fovScale: 1, target: [0, 0, 0], eyeMode: false }, cols: n, rows: 1, cellAspect: 2, supersample: 1 },
  };
}

describe("reprojectGlyphSurfaceAtlas", () => {
  it("reproduces exact checker texels and only samples the target winning surface", () => {
    const source = frame(["surface/a", "surface/a"], [[.1, .1], [.9, .9]]);
    const target = frame(["surface/a", "surface/a"], [[.1, .1], [.9, .9]]);
    const result = reprojectGlyphSurfaceAtlas({ state: null, sourceFrame: source, sourceRgb: new Float32Array([1, 0, 0, 0, 1, 0]), sourceStateVersion: 0, targetFrame: target, targetStateVersion: 1, atlasSize: 8 });
    expect(Array.from(result.warpRgb)).toEqual([1, 0, 0, 1, 0, 0]); expect(Array.from(result.reprojectionValid)).toEqual([1, 1]); expect(Array.from(result.disocclusion)).toEqual([0, 0]);
    expect(Object.isFrozen(result.state)).toBe(true); expect(result.state.provenance.sourceStateVersion).toBe(0);
  });

  it("does not leak colors across an occlusion swap or a newly revealed UV", () => {
    const source = frame(["surface/a", "surface/b"], [[.5, .5], [.5, .5]]);
    const first = reprojectGlyphSurfaceAtlas({ state: null, sourceFrame: source, sourceRgb: new Float32Array([1, 0, 0, 0, 1, 0]), sourceStateVersion: 0, targetFrame: source, targetStateVersion: 1, atlasSize: 4 });
    const swapped = frame(["surface/b", "surface/a"], [[.5, .5], [.9, .1]]);
    const next = reprojectGlyphSurfaceAtlas({ state: first.state, sourceFrame: source, sourceRgb: new Float32Array([1, 0, 0, 0, 1, 0]), sourceStateVersion: 1, targetFrame: swapped, targetStateVersion: 2 });
    expect(next.warpRgb[0]).toBe(0); expect(next.warpRgb[2]).toBe(1); expect(next.reprojectionValid[1]).toBe(0); expect(next.disocclusion[1]).toBe(1);
  });

  it("marks off-screen returns and large reveals as holes, while reset clears stale history", () => {
    const source = frame(["surface/a", null], [[.1, .1], [.9, .9]]);
    const first = reprojectGlyphSurfaceAtlas({ state: null, sourceFrame: source, sourceRgb: new Float32Array([.2, .3, .4, 0, 0, 0]), sourceStateVersion: 0, targetFrame: source, targetStateVersion: 1, atlasSize: 8 });
    const returnFrame = frame(["surface/a", "surface/a"], [[.1, .1], [.9, .9]]);
    const returned = reprojectGlyphSurfaceAtlas({ state: first.state, sourceFrame: source, sourceRgb: new Float32Array([.2, .3, .4, 0, 0, 0]), sourceStateVersion: 1, targetFrame: returnFrame, targetStateVersion: 2 });
    expect(Array.from(returned.reprojectionValid)).toEqual([1, 0]); expect(Array.from(returned.disocclusion)).toEqual([0, 1]);
    const reset = reprojectGlyphSurfaceAtlas({ state: returned.state, reset: true, sourceFrame: frame([null, null]), sourceRgb: new Float32Array(6), sourceStateVersion: 2, targetFrame: returnFrame, targetStateVersion: 3 });
    expect(Array.from(reset.reprojectionValid)).toEqual([0, 0]); expect(Array.from(reset.disocclusion)).toEqual([1, 1]);
  });

  it("keeps surface history through a camera jump but never invents a revealed texel", () => {
    const source = frame(["surface/a", null], [[.2, .2], [.8, .8]]);
    const first = reprojectGlyphSurfaceAtlas({ state: null, sourceFrame: source, sourceRgb: new Float32Array([.8, .1, .2, 0, 0, 0]), sourceStateVersion: 0, targetFrame: source, targetStateVersion: 1, atlasSize: 8 });
    const jumped = frame(["surface/a", "surface/a"], [[.2, .2], [.8, .8]]);
    (jumped.metadata.camera as { rotX: number; zoom: number }).rotX = 73; (jumped.metadata.camera as { rotX: number; zoom: number }).zoom = 9;
    const result = reprojectGlyphSurfaceAtlas({ state: first.state, sourceFrame: source, sourceRgb: new Float32Array([.8, .1, .2, 0, 0, 0]), sourceStateVersion: 1, targetFrame: jumped, targetStateVersion: 2 });
    expect(result.warpRgb[0]).toBeCloseTo(.8); expect(result.warpRgb[2]).toBeCloseTo(.1); expect(result.warpRgb[4]).toBeCloseTo(.2); expect(Array.from(result.reprojectionValid)).toEqual([1, 0]); expect(Array.from(result.disocclusion)).toEqual([0, 1]);
  });

  it("rejects stale/skipped state and mismatched provenance", () => {
    const current = frame(["surface/a"]);
    const first = reprojectGlyphSurfaceAtlas({ state: null, sourceFrame: current, sourceRgb: new Float32Array([1, 0, 0]), sourceStateVersion: 0, targetFrame: current, targetStateVersion: 1 });
    expect(() => reprojectGlyphSurfaceAtlas({ state: first.state, sourceFrame: current, sourceRgb: new Float32Array([1, 0, 0]), sourceStateVersion: 0, targetFrame: current, targetStateVersion: 2 })).toThrow(/exactly/);
    expect(() => reprojectGlyphSurfaceAtlas({ state: first.state, sourceFrame: current, sourceRgb: new Float32Array([1, 0, 0]), sourceStateVersion: 3, targetFrame: current, targetStateVersion: 4 })).toThrow(/skipped/);
    first.state.surfaces[0]!.rgb[0] = .5;
    expect(() => reprojectGlyphSurfaceAtlas({ state: first.state, sourceFrame: current, sourceRgb: new Float32Array([1, 0, 0]), sourceStateVersion: 1, targetFrame: current, targetStateVersion: 2 })).toThrow(/content hash mismatch/);
    expect(() => reprojectGlyphSurfaceAtlas({ state: null, sourceFrame: current, sourceRgb: new Float32Array([2, 0, 0]), sourceStateVersion: 0, targetFrame: current, targetStateVersion: 1 })).toThrow(/normalized/);
    expect(() => reprojectGlyphSurfaceAtlas({ state: null, sourceFrame: { ...current, surfaceLookup: ["surface/missing"] }, sourceRgb: new Float32Array([1, 0, 0]), sourceStateVersion: 0, targetFrame: current, targetStateVersion: 1 })).toThrow(/surfaceLookup/);
    expect(() => reprojectGlyphSurfaceAtlas({ state: null, sourceFrame: { ...current, surfaceId: new Int32Array([8]) }, sourceRgb: new Float32Array([1, 0, 0]), sourceStateVersion: 0, targetFrame: current, targetStateVersion: 1 })).toThrow(/out of range/);
    expect(() => reprojectGlyphSurfaceAtlas({ state: null, sourceFrame: { ...current, winnerPolygon: new Int32Array([-1]) }, sourceRgb: new Float32Array([1, 0, 0]), sourceStateVersion: 0, targetFrame: current, targetStateVersion: 1 })).toThrow(/out of range/);
    expect(() => reprojectGlyphSurfaceAtlas({ state: null, sourceFrame: current, sourceRgb: new Float32Array([1, 0, 0]), sourceStateVersion: 0, targetFrame: current, targetStateVersion: 3 })).toThrow(/exactly/);
  });

  it("uses deterministic nearest resampling for B32 temporal planes", () => {
    const output = resampleGlyphTemporalInputs({ warpRgb: new Float32Array([1, 0, 0, 0, 1, 0]), reprojectionValid: new Float32Array([1, 0]), disocclusion: new Float32Array([0, 1]), atlasConfidence: new Float32Array([1, 0]) }, 2, 1, 4, 1);
    expect(Array.from(output.reprojectionValid)).toEqual([1, 1, 0, 0]); expect(Array.from(output.disocclusion)).toEqual([0, 0, 1, 1]); expect(output.warpRgb).toEqual(new Float32Array([1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0]));
  });

  it("feeds B32's temporal NCHW prefix without RGB plane scrambling", () => {
    const current = frame(["surface/a", "surface/a"]);
    const reprojection = reprojectGlyphSurfaceAtlas({ state: null, sourceFrame: current, sourceRgb: new Float32Array([.1, .2, .3, .4, .5, .6]), sourceStateVersion: 0, targetFrame: current, targetStateVersion: 1, atlasSize: 8 });
    const packed = packGlyphControlTensor(current, { depth: { near: 0, far: 2 }, world: { min: [0, 0, 0], max: [10, 10, 10] } }, reprojection.temporal);
    expect(packed.temporal!.slice(0, 6)).toEqual(new Float32Array([.1, .4, .2, .5, .3, .6]));
  });
});
