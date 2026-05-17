import { describe, it, expect } from "vitest";
import { trianglesToFeatureEdges } from "./featureEdges";
import type { TextureTriangle } from "../types";

// Two triangles sharing edge (0,0,0)-(1,0,0) with a 90° dihedral angle.
//   T1: (0,0,0), (1,0,0), (0,1,0) — lies in XY plane, face normal = (0,0,1)
//   T2: (0,0,0), (1,0,0), (0,0,1) — lies in XZ plane, face normal = (0,-1,0)
// Unique edges: 5 (three from T1, three from T2, minus the one shared edge).
const triangles: TextureTriangle[] = [
  {
    vertices: [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
    ],
    uvs: [
      [0, 0],
      [1, 0],
      [0, 1],
    ],
  },
  {
    vertices: [
      [0, 0, 0],
      [1, 0, 0],
      [0, 0, 1],
    ],
    uvs: [
      [0, 0],
      [1, 0],
      [0, 1],
    ],
  },
];

describe("trianglesToFeatureEdges — featureAngleDeg = 0 (all edges)", () => {
  it("returns all 5 unique edges", () => {
    const edges = trianglesToFeatureEdges(triangles, 0);
    expect(edges).toHaveLength(5);
  });

  it("all edges have weight 2", () => {
    const edges = trianglesToFeatureEdges(triangles, 0);
    expect(edges.every((e) => e.weight === 2)).toBe(true);
  });
});

describe("trianglesToFeatureEdges — featureAngleDeg = 90", () => {
  // The shared edge has a 90° dihedral angle (dot of perpendicular normals ≈ 0,
  // which is less than cos(90°) ≈ 0), so it is classified as a feature edge.
  // All 4 boundary edges are always kept, plus the shared feature edge = 5.
  it("returns 5 edges (4 boundary + 1 feature shared edge)", () => {
    const edges = trianglesToFeatureEdges(triangles, 90);
    expect(edges).toHaveLength(5);
  });
});

describe("trianglesToFeatureEdges — featureAngleDeg = 91", () => {
  // At 91°, cos(91°) ≈ -0.0175. The shared edge's normals are perpendicular
  // (dot = 0), which is NOT less than cos(91°), so the shared edge is suppressed.
  // Only the 4 boundary edges remain.
  it("returns 4 edges (only boundary edges, shared edge suppressed)", () => {
    const edges = trianglesToFeatureEdges(triangles, 91);
    expect(edges).toHaveLength(4);
  });
});

describe("trianglesToFeatureEdges — empty input", () => {
  it("returns empty array for no triangles", () => {
    expect(trianglesToFeatureEdges([])).toHaveLength(0);
  });
});

describe("trianglesToFeatureEdges — color propagation", () => {
  it("propagates triangle color to emitted edges", () => {
    const colored: TextureTriangle[] = [
      {
        vertices: [
          [0, 0, 0],
          [1, 0, 0],
          [0, 1, 0],
        ],
        uvs: [
          [0, 0],
          [1, 0],
          [0, 1],
        ],
        color: "#ff0000",
      },
    ];
    const edges = trianglesToFeatureEdges(colored, 0);
    expect(edges).toHaveLength(3);
    expect(edges.every((e) => e.color === "#ff0000")).toBe(true);
  });
});
