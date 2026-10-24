import { expect } from "vitest";
import type { createGlyphMapExtrusionTopology } from "../extrusionOutline";

type Topology = ReturnType<typeof createGlyphMapExtrusionTopology>;

/**
 * The culling tree's SHAPE is free (see the compiler's comment); what the
 * render relies on is that it partitions the faces and every box holds its
 * own. A NaN bound never culls, so it holds anything. Returns the face ids in
 * leaf order.
 */
export function expectConservativeTree(topology: Topology): number[] {
  const seen: number[] = [], escaped: string[] = [];
  let oversized = 0;
  const walk = (node: Topology["root"]): number[] => {
    const lo = node.corners[0]!, hi = node.corners[7]!;
    const faces = node.faces ? [...node.faces] : [...walk(node.children![0]), ...walk(node.children![1])];
    if (node.faces) { if (faces.length > 32) oversized++; seen.push(...faces); }
    for (const face of faces) for (const v of topology.polygons[face]!.vertices) for (let d = 0; d < 3; d++) {
      if (v[d]! < lo[d]! || v[d]! > hi[d]!) escaped.push(`face ${face} axis ${d}: ${v[d]} outside [${lo[d]}, ${hi[d]}]`);
    }
    return faces;
  };
  walk(topology.root);
  expect(escaped.slice(0, 5)).toEqual([]);
  expect(oversized).toBe(0);
  expect(Int32Array.from(seen).sort()).toEqual(Int32Array.from(topology.polygons, (_, i) => i));
  return seen;
}
