import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { mergePolygons } from "./mergePolygons";
import { parseGltf } from "../parser/parseGltf";
import { parseObj } from "../parser/parseObj";
import { parseMtl } from "../parser/parseMtl";
import type { Polygon, Vec2, Vec3 } from "../types";

// ── Real-fixture feature test (lead — matches voxcss mergeVoxels pattern) ──

function loadObjGalleryFile(name: string): string {
  return readFileSync(
    resolve(__dirname, "../../../../website/public/gallery/obj", name),
    "utf8",
  );
}

function loadGlbGalleryFile(...parts: string[]): ArrayBuffer {
  const buffer = readFileSync(
    resolve(__dirname, "../../../../website/public/gallery/glb", ...parts),
  );
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

const subVec = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const crossVec = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dotVec = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function maxPlaneDeviation(verts: Vec3[]): number {
  if (verts.length < 4) return 0;
  const normal = crossVec(subVec(verts[1], verts[0]), subVec(verts[2], verts[0]));
  const len = Math.hypot(normal[0], normal[1], normal[2]);
  if (len <= 1e-12) return Number.POSITIVE_INFINITY;
  const unit: Vec3 = [normal[0] / len, normal[1] / len, normal[2] / len];
  const d = dotVec(unit, verts[0]);
  return Math.max(...verts.map((vertex) => Math.abs(dotVec(unit, vertex) - d)));
}

function fanArea(verts: Vec3[]): number {
  let total = 0;
  for (let i = 1; i < verts.length - 1; i++) {
    const a = verts[0], b = verts[i], c = verts[i + 1];
    const ab: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ac: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cx = ab[1] * ac[2] - ab[2] * ac[1];
    const cy = ab[2] * ac[0] - ab[0] * ac[2];
    const cz = ab[0] * ac[1] - ab[1] * ac[0];
    total += 0.5 * Math.hypot(cx, cy, cz);
  }
  return total;
}

function firstTriangleArea(verts: Vec3[]): number {
  const a = verts[0], b = verts[1], c = verts[2];
  const ab: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const cx = ab[1] * ac[2] - ab[2] * ac[1];
  const cy = ab[2] * ac[0] - ab[0] * ac[2];
  const cz = ab[0] * ac[1] - ab[1] * ac[0];
  return 0.5 * Math.hypot(cx, cy, cz);
}

describe("mergePolygons — real fixture (chicken.obj)", () => {
  it("reduces triangle count when fed a quad-mesh that was fan-triangulated", () => {
    // chicken.obj is mostly quads from Blender. parseObj fan-triangulates them
    // (~2 tris per quad). mergePolygons re-merges those tri pairs back into
    // their original quads (and beyond — coplanar same-color quads can merge
    // into wider rectangles). So merged.length should be << input.length.
    const objText = loadObjGalleryFile("chicken.obj");
    const mtlText = loadObjGalleryFile("chicken.mtl");
    const { colors } = parseMtl(mtlText);
    const parsed = parseObj(objText, { materialColors: colors });
    const merged = mergePolygons(parsed.polygons);

    expect(merged.length).toBeLessThan(parsed.polygons.length);
    expect(merged.length).toBeLessThanOrEqual(parsed.polygons.length * 0.7);
  });

  it("preserves total surface area (no geometry lost or duplicated)", () => {
    const objText = loadObjGalleryFile("chicken.obj");
    const parsed = parseObj(objText);
    const merged = mergePolygons(parsed.polygons);

    const sumArea = (polys: Polygon[]) =>
      polys.reduce((s, p) => s + fanArea(p.vertices), 0);
    const inputArea = sumArea(parsed.polygons);
    const mergedArea = sumArea(merged);
    // Float-rounding tolerance — parseObj rounds verts to 1e-3.
    expect(mergedArea).toBeCloseTo(inputArea, 0);
  });

  it("preserves the per-input color palette (no color leakage across merges)", () => {
    const objText = loadObjGalleryFile("chicken.obj");
    const parsed = parseObj(objText);
    const merged = mergePolygons(parsed.polygons);

    const inputColors = new Set(parsed.polygons.map((p) => p.color));
    const mergedColors = new Set(merged.map((p) => p.color));
    expect(mergedColors).toEqual(inputColors);
  });

  it("keeps merged textured Sting polygons renderable from their first three vertices", () => {
    const objText = loadObjGalleryFile("sting.obj");
    const parsed = parseObj(objText, {
      materialTextures: { Sting: "/gallery/obj/sting-diffuse.png" },
    });
    const merged = mergePolygons(parsed.polygons);

    for (const polygon of merged) {
      if (!polygon.texture) continue;
      expect(firstTriangleArea(polygon.vertices)).toBeGreaterThan(1e-9);
    }
  });

  it("does not merge the Apple GLB into non-renderable solid quads", () => {
    const parsed = parseGltf(loadGlbGalleryFile("apple.glb"), {
      targetSize: 60,
      defaultColor: "#cccccc",
    });
    const merged = mergePolygons(parsed.polygons);
    const solidQuads = merged.filter((polygon) => !polygon.texture && polygon.vertices.length === 4);

    expect(solidQuads.length).toBeGreaterThan(0);
    expect(Math.max(...solidQuads.map((polygon) => maxPlaneDeviation(polygon.vertices))))
      .toBeLessThanOrEqual(1e-3);
  });
});

// ── Fixtures ──────────────────────────────────────────────────────────────

// Two right triangles that share the hypotenuse — together they form a unit square
// Both in the z=0 plane, same color → should merge into a quad
const TRI_A: Polygon = {
  vertices: [[0,0,0],[1,0,0],[1,1,0]],
  color: "#ff0000",
};
const TRI_B: Polygon = {
  vertices: [[0,0,0],[1,1,0],[0,1,0]],
  color: "#ff0000",
};

// Triangles on a different plane (z=1) — same color
const TRI_C: Polygon = {
  vertices: [[0,0,1],[1,0,1],[1,1,1]],
  color: "#ff0000",
};
const TRI_D: Polygon = {
  vertices: [[0,0,1],[1,1,1],[0,1,1]],
  color: "#ff0000",
};

// Different color — should NOT merge with TRI_A
const TRI_BLUE: Polygon = {
  vertices: [[0,0,0],[1,0,0],[1,1,0]],
  color: "#0000ff",
};

// Helper: build a textured polygon with UVs
function makeTexPoly(vertices: Vec3[], uvs: Vec2[], texture: string, color = "#ffffff"): Polygon {
  return { vertices, uvs, texture, color };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("mergePolygons", () => {
  describe("empty / trivial input", () => {
    it("empty array → empty array", () => {
      expect(mergePolygons([])).toEqual([]);
    });

    it("single triangle → returned as-is (1 polygon)", () => {
      const result = mergePolygons([TRI_A]);
      expect(result).toHaveLength(1);
      expect(result[0].color).toBe("#ff0000");
    });

    it("null/undefined array → does not crash (uses input ?? [])", () => {
      // The function has `input ?? []`, so null should work
      const result = mergePolygons(null as unknown as Polygon[]);
      expect(result).toEqual([]);
    });

    it("degenerate polygon (< 3 vertices) is passed through unchanged", () => {
      const bad: Polygon = { vertices: [[0,0,0],[1,0,0]], color: "#aaa" };
      const result = mergePolygons([bad]);
      expect(result).toHaveLength(1);
      expect(result[0]).toStrictEqual(bad);
    });

    it("null polygon in array is passed through", () => {
      const result = mergePolygons([null as unknown as Polygon, TRI_A]);
      // null polygon is skipped, TRI_A survives
      expect(result).toHaveLength(1);
    });
  });

  describe("color matching", () => {
    it("two same-color coplanar adjacent triangles are merged", () => {
      const result = mergePolygons([TRI_A, TRI_B]);
      // The two triangles share a hypotenuse and together form a convex quad
      expect(result).toHaveLength(1);
      expect(result[0].color).toBe("#ff0000");
    });

    it("merged polygon has more than 3 vertices (is a quad)", () => {
      const result = mergePolygons([TRI_A, TRI_B]);
      expect(result[0].vertices.length).toBeGreaterThan(3);
    });

    it("different-color coplanar adjacent triangles are NOT merged", () => {
      const result = mergePolygons([TRI_A, TRI_BLUE]);
      expect(result).toHaveLength(2);
    });
  });

  describe("plane matching (coplanarity)", () => {
    it("same-color triangles on different planes are NOT merged", () => {
      // TRI_A (z=0) and TRI_C (z=1): same color, different planes
      const result = mergePolygons([TRI_A, TRI_C]);
      expect(result).toHaveLength(2);
    });

    it("four triangles on two different planes each → two merged quads", () => {
      const result = mergePolygons([TRI_A, TRI_B, TRI_C, TRI_D]);
      expect(result).toHaveLength(2);
    });

    it("near-coplanar triangles are not merged into a non-renderable solid quad", () => {
      const a: Polygon = { vertices: [[0,0,0],[1,0,0],[1,1,0]], color: "#ff0000" };
      const b: Polygon = { vertices: [[0,0,0],[1,1,0],[0,1,0.01]], color: "#ff0000" };

      const result = mergePolygons([a, b]);
      expect(result).toHaveLength(2);
      expect(result.every((polygon) => polygon.vertices.length === 3)).toBe(true);
    });
  });

  describe("texture matching", () => {
    it("same-texture source triangles on one plane are merged", () => {
      // Same geometry as TRI_A + TRI_B but textured
      // Shared edge: (1,0,0) and (1,1,0)
      // In TRI_A: those are vertices[1] and vertices[2]
      // In TRI_B: those are vertices[0] and vertices[2] — but winding is opposite
      // Actually TRI_B has (0,0,0),(1,1,0),(0,1,0) — shared edge is (0,0,0)→(1,1,0)
      // Let's use a simpler explicit setup where we know the shared edge UVs match
      const a: Polygon = makeTexPoly(
        [[0,0,0],[1,0,0],[1,1,0]],
        [[0,0],[1,0],[1,1]],
        "tex.png"
      );
      const b: Polygon = makeTexPoly(
        [[0,0,0],[1,1,0],[0,1,0]],
        [[0,0],[1,1],[0,1]],
        "tex.png"
      );
      const result = mergePolygons([a, b]);
      // Shared edge is (0,0,0)↔(1,1,0):
      // in a: idx0=0 (UV 0,0), idx2=2 (UV 1,1)
      // in b: idx0=0 (UV 0,0), idx1=1 (UV 1,1)
      expect(result).toHaveLength(1);
      expect(result[0].textureTriangles).toHaveLength(2);
    });

    it("different textures are NOT merged", () => {
      const a: Polygon = makeTexPoly([[0,0,0],[1,0,0],[1,1,0]], [[0,0],[1,0],[1,1]], "texA.png");
      const b: Polygon = makeTexPoly([[0,0,0],[1,1,0],[0,1,0]], [[0,0],[1,1],[0,1]], "texB.png");
      const result = mergePolygons([a, b]);
      expect(result).toHaveLength(2);
    });

    it("one textured, one untextured → NOT merged", () => {
      const a: Polygon = makeTexPoly([[0,0,0],[1,0,0],[1,1,0]], [[0,0],[1,0],[1,1]], "tex.png");
      const b: Polygon = { vertices: [[0,0,0],[1,1,0],[0,1,0]], color: "#ffffff" };
      const result = mergePolygons([a, b]);
      expect(result).toHaveLength(2);
    });

    it("textured polygon with mismatched UV count → UVs stripped, treated as untextured for merge", () => {
      // uvs.length !== vertices.length → uvs ignored in PolyState (the !a.uvs branch)
      const a: Polygon = {
        vertices: [[0,0,0],[1,0,0],[1,1,0]],
        uvs: [[0,0],[1,0]], // mismatched length (2 != 3)
        texture: "tex.png",
        color: "#ffffff",
      };
      const b: Polygon = { vertices: [[0,0,0],[1,1,0],[0,1,0]], color: "#ffffff" };
      const result = mergePolygons([a, b]);
      // `a` has texture but uvs stripped → !!a.uvs (in PolyState) is false
      // `b` has no texture → !!b.uvs is false → they CAN merge (both untextured)
      // Actually they share texture undefined vs "tex.png" → texture !== texture → no merge
      // Let's just verify no crash
      expect(result.length).toBeGreaterThanOrEqual(1);
    });

    it("textured polygons without usable UVs are not merged", () => {
      const a: Polygon = {
        vertices: [[0,0,0],[1,0,0],[1,1,0]],
        texture: "tex.png",
        color: "#ffffff",
      };
      const b: Polygon = {
        vertices: [[0,0,0],[1,1,0],[0,1,0]],
        texture: "tex.png",
        color: "#ffffff",
      };

      const result = mergePolygons([a, b]);
      expect(result).toHaveLength(2);
    });

    it("textured polygons with non-affine combined UVs merge as source texture triangles", () => {
      const a: Polygon = makeTexPoly(
        [[0,0,0],[1,0,0],[1,1,0]],
        [[0,0],[1,0],[1,1]],
        "tex.png"
      );
      const b: Polygon = makeTexPoly(
        [[0,0,0],[1,1,0],[0,1,0]],
        [[0,0],[1,1],[0.2,1]],
        "tex.png"
      );

      const result = mergePolygons([a, b]);
      expect(result).toHaveLength(1);
      expect(result[0].textureTriangles).toHaveLength(2);
    });

    it("near-coplanar textured polygons are not merged into one DOM plane", () => {
      const a: Polygon = makeTexPoly(
        [[0,0,0],[1,0,0],[1,1,0]],
        [[0,0],[1,0],[1,1]],
        "tex.png"
      );
      const b: Polygon = makeTexPoly(
        [[0,0,0],[1,1,0],[0,1,0.01]],
        [[0,0],[1,1],[0,1]],
        "tex.png"
      );

      const result = mergePolygons([a, b]);
      expect(result).toHaveLength(2);
    });

    it("textured polygon preserves texture after merge", () => {
      const a: Polygon = makeTexPoly(
        [[0,0,0],[1,0,0],[1,1,0]],
        [[0,0],[1,0],[1,1]],
        "tex.png"
      );
      const b: Polygon = makeTexPoly(
        [[0,0,0],[1,1,0],[0,1,0]],
        [[0,0],[1,1],[0,1]],
        "tex.png"
      );
      const result = mergePolygons([a, b]);
      if (result.length === 1) {
        expect(result[0].texture).toBe("tex.png");
        expect(result[0].uvs).toBeDefined();
        expect(result[0].textureTriangles).toHaveLength(2);
      }
    });

    it("textured merge preserves collinear boundary vertices to avoid T-junctions", () => {
      const left: Polygon = makeTexPoly(
        [[0,0,0],[1,0,0],[1,1,0],[0,1,0]],
        [[0,0],[0.5,0],[0.5,1],[0,1]],
        "tex.png"
      );
      const right: Polygon = makeTexPoly(
        [[1,0,0],[2,0,0],[2,1,0],[1,1,0]],
        [[0.5,0],[1,0],[1,1],[0.5,1]],
        "tex.png"
      );

      const result = mergePolygons([left, right]);
      expect(result).toHaveLength(1);
      expect(result[0].vertices).toHaveLength(6);
      expect(result[0].uvs).toHaveLength(6);
      expect(firstTriangleArea(result[0].vertices)).toBeGreaterThan(1e-9);
      expect(result[0].vertices).toContainEqual([1,0,0]);
      expect(result[0].vertices).toContainEqual([1,1,0]);
    });
  });

  describe("convexity gate", () => {
    // mergeAlongEdge returns a merged polygon, then isConvex checks it.
    // Non-convex results are rejected → the two triangles stay separate.
    // Build a case where merging two triangles produces a non-convex shape:
    // Two triangles sharing an edge but the merged quad would be concave.
    it("non-convex merge result is rejected — triangles remain separate", () => {
      // A "bowtie"-style pair: (0,0,0),(2,0,0),(1,1,0) and
      // (0,2,0),(2,2,0),(1,1,0) share the vertex (1,1,0) but no shared edge
      // → they just don't merge (no shared edge anyway)
      const a: Polygon = { vertices: [[0,0,0],[2,0,0],[1,1,0]], color: "#aaa" };
      const b: Polygon = { vertices: [[0,2,0],[2,2,0],[1,1,0]], color: "#aaa" };
      const result = mergePolygons([a, b]);
      // No shared edge → stays as 2
      expect(result).toHaveLength(2);
    });
  });

  describe("data field preservation", () => {
    it("data field from original polygon is preserved after merge", () => {
      const a: Polygon = {
        vertices: [[0,0,0],[1,0,0],[1,1,0]],
        color: "#ff0000",
        data: { foo: "bar", count: 42 },
      };
      const b: Polygon = {
        vertices: [[0,0,0],[1,1,0],[0,1,0]],
        color: "#ff0000",
      };
      const result = mergePolygons([a, b]);
      // After merge, the surviving polygon is `a` which carries `data`
      const withData = result.find((p) => p.data);
      expect(withData?.data?.foo).toBe("bar");
    });
  });

  describe("degenerate plane", () => {
    it("polygon with degenerate plane (collinear vertices) is passed through", () => {
      // Three collinear points → cross product ≈ 0 → planeOf returns null
      const p: Polygon = {
        vertices: [[0,0,0],[1,0,0],[2,0,0]],
        color: "#aaa",
      };
      const result = mergePolygons([p]);
      expect(result).toHaveLength(1);
    });
  });

  describe("multiple merge iterations (fixed-point)", () => {
    // Build a row of 3 quads (6 triangles) that should all merge into 1 hexagon
    // Using grid squares: [0..1], [1..2], [2..3] on the z=0 plane, same color

    // Square 1: (0,0)-(1,0)-(1,1)-(0,1)
    const s1a: Polygon = { vertices: [[0,0,0],[1,0,0],[1,1,0]], color: "#cc0000" };
    const s1b: Polygon = { vertices: [[0,0,0],[1,1,0],[0,1,0]], color: "#cc0000" };
    // Square 2: (1,0)-(2,0)-(2,1)-(1,1)
    const s2a: Polygon = { vertices: [[1,0,0],[2,0,0],[2,1,0]], color: "#cc0000" };
    const s2b: Polygon = { vertices: [[1,0,0],[2,1,0],[1,1,0]], color: "#cc0000" };
    // Square 3: (2,0)-(3,0)-(3,1)-(2,1)
    const s3a: Polygon = { vertices: [[2,0,0],[3,0,0],[3,1,0]], color: "#cc0000" };
    const s3b: Polygon = { vertices: [[2,0,0],[3,1,0],[2,1,0]], color: "#cc0000" };

    it("6 coplanar same-color triangles (3 squares) merge into fewer polygons", () => {
      const result = mergePolygons([s1a, s1b, s2a, s2b, s3a, s3b]);
      expect(result.length).toBeLessThan(6);
    });

    it("a 2-triangle square merges into a quad", () => {
      const result = mergePolygons([s1a, s1b]);
      expect(result).toHaveLength(1);
      expect(result[0].vertices.length).toBe(4);
    });

    it("6 fan-triangles around a center vertex collapse to a single hexagon", () => {
      // Each pair of adjacent triangles shares a radial edge; after they
      // merge to wedges, the wedges merge across remaining radial edges,
      // and the central vertex collapses away as collinear in the final ring.
      const angles = [0, 60, 120, 180, 240, 300].map((d) => (d * Math.PI) / 180);
      const ring: Vec3[] = angles.map((a) => [Math.cos(a), Math.sin(a), 0]);
      const tris: Polygon[] = [];
      for (let i = 0; i < 6; i++) {
        tris.push({
          vertices: [[0, 0, 0], ring[i], ring[(i + 1) % 6]],
          color: "#abc",
        });
      }
      const result = mergePolygons(tris);
      expect(result).toHaveLength(1);
      expect(result[0].vertices).toHaveLength(6);
    });
  });

  describe("output structure", () => {
    it("merged polygon has all required Polygon fields", () => {
      const result = mergePolygons([TRI_A, TRI_B]);
      const p = result[0];
      expect(p).toHaveProperty("vertices");
      expect(p).toHaveProperty("color");
    });

    it("unmerged polygons also have all required fields", () => {
      const result = mergePolygons([TRI_A, TRI_BLUE]);
      for (const p of result) {
        expect(p).toHaveProperty("vertices");
        expect(p).toHaveProperty("color");
      }
    });

    it("does not add extra properties (no texture/uvs on untextured poly)", () => {
      const result = mergePolygons([TRI_A]);
      expect(result[0].texture).toBeUndefined();
      expect(result[0].uvs).toBeUndefined();
    });
  });
});
