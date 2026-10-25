import { expect, it } from "vitest";
import type { Polygon, Vec3 } from "glyphcss";
import { createGlyphMapExtrusionTopology } from "./extrusionOutline";
import * as reference from "./test/extrusionTopology28Reference";
import type { GlyphMapExtrusionGeometry } from "./layers";

// A ring that closes on its first vertex lists that vertex twice, so a face
// reaches the vertex's face list twice. The compiled run must still name it
// once, in face order, exactly as the frozen compiler's Set did.
it("compiles each edge's incident faces once and in face order, with repeated vertices", () => {
  const a: Vec3 = [0, 0, 1], b: Vec3 = [4, 0, 1], c: Vec3 = [4, 4, 1], d: Vec3 = [0, 4, 1], e: Vec3 = [8, 2, 1];
  const closed: Polygon = { vertices: [a, b, c, d, a] };
  const neighbour: Polygon = { vertices: [b, e, c] };
  const again: Polygon = { vertices: [a, b, d, a, b] };
  const polygons = [closed, neighbour, again];
  const geometry: GlyphMapExtrusionGeometry = {
    roof: [[a, b, c, d]], base: [[a, b, c, d].map(v => [v[0], v[1], 0] as Vec3)], roofEdges: [], polygons, color: "#fff",
  };
  const actual = createGlyphMapExtrusionTopology(polygons, [geometry]);
  const expected = reference.createGlyphMapExtrusionTopology(polygons, [geometry]);
  expect(actual.edgeFaces.length).toBeGreaterThan(0);
  expect(Array.from(actual.edgeFaces)).toEqual(Array.from(expected.edgeFaces));
  expect(Array.from(actual.edgeOffsets)).toEqual(Array.from(expected.edgeOffsets));
  expect(Array.from(actual.edgeVertices)).toEqual(Array.from(expected.edgeVertices));
  // Direct queries answer from the same lists, each face once.
  expect([...actual.incidentFaces(a, b)]).toEqual([...expected.incidentFaces(a, b)]);
  expect([...actual.incidentFaces(a, b)]).toEqual([0, 2]);
});
