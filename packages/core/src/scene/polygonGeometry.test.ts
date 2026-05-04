import { describe, it, expect } from "vitest";
import { polygonFaces } from "./polygonGeometry";
import type { Polygon } from "../types";

describe("polygonFaces", () => {
  const tri: Polygon = {
    vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
    color: "#ff0000",
  };

  it("returns an array with exactly 1 face for a valid triangle", () => {
    const faces = polygonFaces(tri);
    expect(faces).toHaveLength(1);
  });

  it("face.v mirrors the polygon vertices", () => {
    const faces = polygonFaces(tri);
    expect(faces[0].v).toEqual([[0, 0, 0], [1, 0, 0], [0, 1, 0]]);
  });

  it("face.color mirrors the polygon color", () => {
    const faces = polygonFaces(tri);
    expect(faces[0].color).toBe("#ff0000");
  });

  it("face.v is a deep copy (mutation doesn't affect original)", () => {
    const faces = polygonFaces(tri);
    faces[0].v[0][0] = 99;
    // original polygon is unchanged
    expect(tri.vertices[0][0]).toBe(0);
  });

  it("returns empty array for polygon with 2 vertices (degenerate)", () => {
    const p: Polygon = { vertices: [[0, 0, 0], [1, 0, 0]] };
    expect(polygonFaces(p)).toHaveLength(0);
  });

  it("returns empty array for polygon with 0 vertices", () => {
    const p: Polygon = { vertices: [] };
    expect(polygonFaces(p)).toHaveLength(0);
  });

  it("returns empty array when vertices is undefined-like", () => {
    // Defensive — some callers may pass a partially-built polygon
    const p = { vertices: null } as unknown as Polygon;
    expect(polygonFaces(p)).toHaveLength(0);
  });

  it("works for a quad (4 vertices) — returns single face with 4 vertices", () => {
    const quad: Polygon = {
      vertices: [[0,0,0],[1,0,0],[1,1,0],[0,1,0]],
      color: "#0000ff",
    };
    const faces = polygonFaces(quad);
    expect(faces).toHaveLength(1);
    expect(faces[0].v).toHaveLength(4);
  });

  it("color is undefined when polygon has no color", () => {
    const p: Polygon = { vertices: [[0,0,0],[1,0,0],[0,1,0]] };
    const faces = polygonFaces(p);
    expect(faces[0].color).toBeUndefined();
  });
});
