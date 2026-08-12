import { createTensorGoldenFrame } from "./tensorGolden";

/** Small deterministic surface-routing trace shared by Node and Chromium B24 parity. */
export function createReprojectionFrame(surfaces: readonly ("surface/a" | "surface/b" | null)[], uvs: readonly (readonly [number, number])[]) {
  const base = createTensorGoldenFrame(); const ids = ["surface/a", "surface/b"]; const n = surfaces.length;
  return {
    ...base, visibleAscii: surfaces.map((value) => value ? "X" : " ").join(""), semanticAscii: surfaces.map((value) => value ? "A" : " ").join(""), visibleColor: new Uint32Array(n), semanticColor: new Uint32Array(n), targetRgb: new Uint32Array(n), albedoRgb: new Uint32Array(n), coverage: new Uint8Array(surfaces.map((value) => value ? 1 : 0)), winnerPolygon: new Int32Array(surfaces.map((value, index) => value ? index : -1)), classId: new Int32Array(surfaces.map((value) => value ? 1 : -1)), instanceId: new Int32Array(surfaces.map((value) => value ? 0 : -1)), surfaceId: new Int32Array(surfaces.map((value) => value ? ids.indexOf(value) : -1)), instanceLookup: ["instance/a"], surfaceLookup: ids,
    depth: new Float64Array(surfaces.map((value) => value ? 1 : Number.NaN)), shade: new Float32Array(surfaces.map((value) => value ? 1 : Number.NaN)), normal: new Float32Array(Array.from({ length: n * 3 }, (_, index) => surfaces[Math.floor(index / 3)] ? 0 : Number.NaN)), worldPosition: new Float32Array(Array.from({ length: n * 3 }, (_, index) => surfaces[Math.floor(index / 3)] ? index : Number.NaN)), surfaceUv: new Float32Array(uvs.flatMap(([u, v], index) => surfaces[index] ? [u, v] : [Number.NaN, Number.NaN])),
    metadata: { ...base.metadata, cols: n, rows: 1, scene: { ...base.metadata.scene, surfaces: ids.map((id) => ({ id, instanceId: "instance/a" })), polygonSurfaceIds: surfaces.map((value) => value ?? "surface/a") } },
  };
}
