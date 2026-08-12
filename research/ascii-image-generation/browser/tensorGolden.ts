const hash = (character: string) => character.repeat(64);

export const tensorGoldenNormalization = {
  depth: { near: -2, far: 10 },
  world: { min: [-4, -3, -2] as [number, number, number], max: [4, 5, 6] as [number, number, number] },
};

export function createTensorGoldenFrame() {
  return {
    visibleAscii: "X ", semanticAscii: "A ",
    visibleColor: new Uint32Array([0xffffffff, 0]), semanticColor: new Uint32Array([0xff102030, 0]),
    targetRgb: new Uint32Array([0xffffffff, 0]),
    albedoRgb: new Uint32Array([0xffffffff, 0]),
    coverage: new Uint8Array([1, 0]), winnerPolygon: new Int32Array([0, -1]), classId: new Int32Array([1, -1]), instanceId: new Int32Array([0, -1]), surfaceId: new Int32Array([0, -1]), instanceLookup: ["instance/a"], surfaceLookup: ["surface/a"],
    depth: new Float64Array([5.25, Number.NaN]), shade: new Float32Array([0.25, Number.NaN]), normal: new Float32Array([0, 1, -1, Number.NaN, Number.NaN, Number.NaN]), worldPosition: new Float32Array([0.25, 1.5, 5.75, Number.NaN, Number.NaN, Number.NaN]), surfaceUv: new Float32Array([0.5, 0.75, Number.NaN, Number.NaN]),
    metadata: {
      scene: { schemaVersion: "control-scene/v1", id: "scene/a", dictionaryId: "dictionary/a", dictionarySha256: hash("d"), geometrySha256: hash("e"), polygonOrderSha256: hash("f"), contentSha256: hash("b"), instances: [{ id: "instance/a", classId: 1 }], surfaces: [{ id: "surface/a", instanceId: "instance/a" }], polygonSurfaceIds: ["surface/a"] },
      dictionary: { schemaVersion: "glyph-object-dictionary/v2", id: "dictionary/a", contentSha256: hash("d"), font: { id: "font/a", version: "1", sha256: hash("a") } },
      camera: { kind: "orthographic" as const, rotX: 0, rotY: 0, center: [0, 0] as [number, number], mat: null, useMat: false, distance: 0, perspective: 0, zoom: 1, stretch: 1, fovScale: 1, target: [0, 0, 0] as [number, number, number], eyeMode: false }, cols: 2, rows: 1, cellAspect: 2, supersample: 1,
    },
  };
}

export function createTensorGoldenTemporal() {
  return { warpRgb: new Float32Array([0.1, 0, 1, 0.2, 0, 1]), reprojectionValid: new Float32Array([1, 0]), disocclusion: new Float32Array([0, 1]), atlasConfidence: new Float32Array([0.5, 0]) };
}
