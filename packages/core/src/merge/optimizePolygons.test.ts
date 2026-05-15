import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import type { Polygon } from "../types";
import { parseObj } from "../parser/parseObj";
import { optimizeMeshPolygons } from "./optimizePolygons";

function rect(x0: number, y0: number, x1: number, y1: number): Polygon[] {
  return [
    { vertices: [[x0, y0, 0], [x1, y0, 0], [x1, y1, 0]], color: "#f00" },
    { vertices: [[x0, y0, 0], [x1, y1, 0], [x0, y1, 0]], color: "#f00" },
  ];
}

function edgeKey(a: Polygon["vertices"][number], b: Polygon["vertices"][number]): string {
  const ak = a.join(",");
  const bk = b.join(",");
  return ak < bk ? `${ak}|${bk}` : `${bk}|${ak}`;
}

function sharedEdgeCount(polygons: Polygon[]): number {
  const counts = new Map<string, number>();
  for (const polygon of polygons) {
    for (let i = 0; i < polygon.vertices.length; i++) {
      const key = edgeKey(polygon.vertices[i], polygon.vertices[(i + 1) % polygon.vertices.length]);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return [...counts.values()].filter((count) => count > 1).length;
}

function textureTrianglePlaneDistance(polygon: Polygon): number {
  const [a, b, c] = polygon.vertices;
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const normal = [
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0],
  ];
  const length = Math.hypot(normal[0], normal[1], normal[2]) || 1;
  const unit = [normal[0] / length, normal[1] / length, normal[2] / length];
  let max = 0;
  for (const triangle of polygon.textureTriangles ?? []) {
    for (const vertex of triangle.vertices) {
      max = Math.max(
        max,
        Math.abs(
          (vertex[0] - a[0]) * unit[0] +
            (vertex[1] - a[1]) * unit[1] +
            (vertex[2] - a[2]) * unit[2],
        ),
      );
    }
  }
  return max;
}

function loadObjGalleryFile(name: string): string {
  return readFileSync(
    resolve(__dirname, "../../../../website/public/gallery/obj", name),
    "utf8",
  );
}

describe("optimizeMeshPolygons", () => {
  it("uses exact planar cover candidates for lossless resolution", () => {
    const input = [
      ...rect(0, 0, 1, 1),
      ...rect(1, 0, 2, 1),
      ...rect(2, 0, 3, 1),
    ];

    const result = optimizeMeshPolygons(input, { meshResolution: "lossless" });

    expect(result).toHaveLength(1);
    expect(result[0].vertices).toHaveLength(4);
  });

  it("allows approximate merge candidates only for lossy resolution", () => {
    const input: Polygon[] = [
      { vertices: [[0, 0, 0], [1, 0, 0], [1, 1, 0]], color: "#f00" },
      { vertices: [[0, 0, 0], [1, 1, 0], [0, 1, 0.08]], color: "#f00" },
    ];

    const lossless = optimizeMeshPolygons(input, { meshResolution: "lossless" });
    const lossy = optimizeMeshPolygons(input, { meshResolution: "lossy" });

    expect(lossless).toHaveLength(2);
    expect(lossy).toHaveLength(1);
  });

  it("defaults to lossy resolution", () => {
    const input: Polygon[] = [
      { vertices: [[0, 0, 0], [1, 0, 0], [1, 1, 0]], color: "#f00" },
      { vertices: [[0, 0, 0], [1, 1, 0], [0, 1, 0.08]], color: "#f00" },
    ];

    expect(optimizeMeshPolygons(input)).toHaveLength(1);
  });

  it("allows lossy approximate merge for same-texture UV polygons", () => {
    const input: Polygon[] = [
      {
        vertices: [[0, 0, 0], [1, 0, 0], [1, 1, 0]],
        color: "#fff",
        texture: "texture.png",
        uvs: [[0, 0], [1, 0], [1, 1]],
      },
      {
        vertices: [[0, 0, 0], [1, 1, 0], [0, 1, 0.04]],
        color: "#fff",
        texture: "texture.png",
        uvs: [[0, 0], [1, 1], [0, 1]],
      },
    ];

    const lossless = optimizeMeshPolygons(input, { meshResolution: "lossless" });
    const lossy = optimizeMeshPolygons(input, { meshResolution: "lossy" });

    expect(lossless).toHaveLength(2);
    expect(lossy).toHaveLength(1);
    expect(lossy[0].texture).toBe("texture.png");
    expect(lossy[0].uvs).toHaveLength(4);
    expect(lossy[0].textureTriangles).toHaveLength(2);
    expect(textureTrianglePlaneDistance(lossy[0])).toBeLessThan(1e-8);
  });

  it("does not lossy-merge textured polygons across mismatched UV seams", () => {
    const input: Polygon[] = [
      {
        vertices: [[0, 0, 0], [1, 0, 0], [1, 1, 0]],
        color: "#fff",
        texture: "texture.png",
        uvs: [[0, 0], [1, 0], [1, 1]],
      },
      {
        vertices: [[0, 0, 0], [1, 1, 0], [0, 1, 0.04]],
        color: "#fff",
        texture: "texture.png",
        uvs: [[0.1, 0], [1, 1], [0, 1]],
      },
    ];

    const lossy = optimizeMeshPolygons(input, { meshResolution: "lossy" });

    expect(lossy).toHaveLength(2);
  });

  it("auto-selects the best lossy approximation strategy", () => {
    const input: Polygon[] = [
      { vertices: [[0, 0, 0], [1, 0, 0], [0.5, 0.5, 0.01]], color: "#f00" },
      { vertices: [[1, 0, 0], [1, 1, 0], [0.5, 0.5, 0.01]], color: "#f00" },
      { vertices: [[1, 1, 0], [0, 1, 0], [0.5, 0.5, 0.01]], color: "#f00" },
      { vertices: [[0, 1, 0], [0, 0, 0], [0.5, 0.5, 0.01]], color: "#f00" },
    ];

    const pairs = optimizeMeshPolygons(input, {
      meshResolution: "lossy",
      approximateMerge: {
        maxAngleDeg: 15,
        maxPlaneDisplacement: 0.35,
        maxBoundaryDisplacement: 0.075,
        isolatedPairs: true,
      },
    });
    const groups = optimizeMeshPolygons(input, {
      meshResolution: "lossy",
      approximateMerge: {
        maxAngleDeg: 15,
        maxPlaneDisplacement: 0.35,
        maxBoundaryDisplacement: 0.075,
        isolatedPairs: false,
      },
    });
    const auto = optimizeMeshPolygons(input, { meshResolution: "lossy" });

    expect(auto.length).toBeLessThanOrEqual(pairs.length);
    expect(auto).toHaveLength(groups.length);
  });

  it("uses wider angle candidates without widening the historical boundary budget", () => {
    const input: Polygon[] = [
      { vertices: [[0, 0, 0], [1, 0, 0], [1, 1, 0]], color: "#f00" },
      { vertices: [[0, 0, 0], [1, 1, 0], [0, 1, 0.2]], color: "#f00" },
    ];

    const previousLossy = optimizeMeshPolygons(input, {
      meshResolution: "lossy",
      approximateMerge: {
        maxAngleDeg: 15,
        maxPlaneDisplacement: 0.35,
        maxBoundaryDisplacement: 0.075,
        isolatedPairs: true,
      },
    });
    const auto = optimizeMeshPolygons(input, { meshResolution: "lossy" });

    expect(previousLossy).toHaveLength(2);
    expect(auto).toHaveLength(1);
  });

  it("uses tiny lossy color snapping to unlock exact merges without moving geometry", () => {
    const palette = [
      "#fcca48",
      "#fdca48",
      "#feca48",
      "#fccb48",
      "#fdcb48",
      "#fecb48",
      "#fccc49",
      "#fdcc4a",
    ];
    const input: Polygon[] = [];
    for (let x = 0; x < 12; x++) {
      const color = palette[x % palette.length];
      input.push(...rect(x, 0, x + 1, 1).map((polygon) => ({ ...polygon, color })));
    }

    const lossless = optimizeMeshPolygons(input, { meshResolution: "lossless" });
    const lossy = optimizeMeshPolygons(input, { meshResolution: "lossy" });

    expect(lossless).toHaveLength(12);
    expect(lossy).toHaveLength(1);
    expect(new Set(lossy[0].vertices.map((vertex) => vertex.join(",")))).toEqual(new Set([
      "0,0,0",
      "12,0,0",
      "12,1,0",
      "0,1,0",
    ]));
  });

  it("keeps lossy pair-merge neighbor seams on shared geometry", () => {
    const input: Polygon[] = [
      { vertices: [[0, 0, 0.02], [1, 0, 0], [1, 1, 0.11]], color: "#f00" },
      { vertices: [[0, 0, 0.02], [1, 1, 0.11], [0, 1, -0.03]], color: "#f00" },
      { vertices: [[1, 0, 0], [2, 0, 0.04], [2, 1, -0.02]], color: "#0f0" },
      { vertices: [[1, 0, 0], [2, 1, -0.02], [1, 1, 0.11]], color: "#0f0" },
    ];

    const baseOptions = {
      meshResolution: "lossy",
      rectCover: false,
      approximateMerge: {
        maxAngleDeg: 45,
        maxPlaneDisplacement: 1,
        maxBoundaryDisplacement: 0.2,
        isolatedPairs: true,
      },
    } as const;
    const lossy = optimizeMeshPolygons(input, baseOptions);

    expect(lossy).toHaveLength(2);
    expect(sharedEdgeCount(lossy)).toBe(1);
  });

  it("keeps finding guarded lossy wins on the coliseum fixture after triangle pairs are exhausted", () => {
    const raw = parseObj(loadObjGalleryFile("coliseum.obj"), {
      targetSize: 80,
      palette: ["#c9a876", "#a78760", "#8b6f47", "#6b5538"],
    }).polygons;

    const lossless = optimizeMeshPolygons(raw, { meshResolution: "lossless" });
    const lossy = optimizeMeshPolygons(raw, { meshResolution: "lossy" });

    expect(lossless.length - lossy.length).toBeGreaterThanOrEqual(484);
  });
});
