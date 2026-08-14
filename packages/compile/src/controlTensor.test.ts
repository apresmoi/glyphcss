import { describe, expect, it } from "vitest";
import { packGlyphControlTensor, type GlyphControlFrame } from "glyphcss";
import { packGlyphControlTensorForNode } from "./controlTensor";

describe("packGlyphControlTensorForNode", () => {
  it("produces byte-identical tensor planes and spec hashes for a control-frame golden", () => {
    const hash = (char: string) => char.repeat(64);
    const frame = { visibleAscii: "X", semanticAscii: "A", visibleColor: new Uint32Array([0xffffffff]), semanticColor: new Uint32Array([0xff102030]), coverage: new Uint8Array([1]), winnerPolygon: new Int32Array([0]), classId: new Int32Array([1]), instanceId: new Int32Array([0]), surfaceId: new Int32Array([0]), instanceLookup: ["instance/a"], surfaceLookup: ["surface/a"], depth: new Float64Array([5]), shade: new Float32Array([.5]), normal: new Float32Array([0, 0, 1]), worldPosition: new Float32Array([0, 0, 0]), surfaceUv: new Float32Array([.5, .5]), metadata: { scene: { schemaVersion: "control-scene/v1", id: "scene/a", dictionaryId: "dictionary/a", dictionarySha256: hash("d"), geometrySha256: hash("e"), polygonOrderSha256: hash("f"), contentSha256: hash("b"), instances: [{ id: "instance/a", classId: 1 }], surfaces: [{ id: "surface/a", instanceId: "instance/a" }], polygonSurfaceIds: ["surface/a"] }, dictionary: { schemaVersion: "glyph-object-dictionary/v2", id: "dictionary/a", contentSha256: hash("d"), font: { id: "font/a", version: "1", sha256: hash("a") } }, camera: { kind: "orthographic", rotX: 0, rotY: 0, center: [0, 0], mat: null, useMat: false, distance: 0, perspective: 0, zoom: 1, stretch: 1, fovScale: 1, target: [0, 0, 0], eyeMode: false }, cols: 1, rows: 1, cellAspect: 2, supersample: 1 } } as GlyphControlFrame;
    const normalization = { depth: { near: 0, far: 10 }, world: { min: [-1, -1, -1] as [number, number, number], max: [1, 1, 1] as [number, number, number] } };
    const browser = packGlyphControlTensor(frame, normalization);
    const node = packGlyphControlTensorForNode(frame, normalization);
    expect(new Uint8Array(node.keyframe.buffer)).toEqual(new Uint8Array(browser.keyframe.buffer));
    expect(node.spec.contentSha256).toBe(browser.spec.contentSha256);
  });
});
