import { useMemo, useState } from "react";
import type { Polygon } from "@layoutit/polycss-react";
import {
  DebugLayout, DebugSection, DebugStats, DebugScene,
  Row, Slider,
} from "..";

type Vec3 = [number, number, number];

function buildSphereTriangles(radius: number, subdivisions: number, color = "#3b82f6"): Polygon[] {
  const r = Math.max(1, Math.floor(radius));
  const phi = (1 + Math.sqrt(5)) / 2;

  const initialVerts: Vec3[] = [
    [-1, phi, 0], [1, phi, 0], [-1, -phi, 0], [1, -phi, 0],
    [0, -1, phi], [0, 1, phi], [0, -1, -phi], [0, 1, -phi],
    [phi, 0, -1], [phi, 0, 1], [-phi, 0, -1], [-phi, 0, 1],
  ].map(([x, y, z]) => {
    const l = Math.hypot(x, y, z);
    return [x / l, y / l, z / l] as Vec3;
  });
  const initialFaces: [number, number, number][] = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];

  let verts: Vec3[] = initialVerts;
  let faces: [number, number, number][] = initialFaces;
  for (let s = 0; s < subdivisions; s++) {
    const newVerts: Vec3[] = [...verts];
    const newFaces: [number, number, number][] = [];
    const midCache = new Map<string, number>();
    const midpoint = (i: number, j: number): number => {
      const key = i < j ? `${i}-${j}` : `${j}-${i}`;
      const cached = midCache.get(key);
      if (cached !== undefined) return cached;
      const a = verts[i], b = verts[j];
      let mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, mz = (a[2] + b[2]) / 2;
      const l = Math.hypot(mx, my, mz);
      mx /= l; my /= l; mz /= l;
      const idx = newVerts.length;
      newVerts.push([mx, my, mz]);
      midCache.set(key, idx);
      return idx;
    };
    for (const [a, b, c] of faces) {
      const ab = midpoint(a, b);
      const bc = midpoint(b, c);
      const ca = midpoint(c, a);
      newFaces.push([a, ab, ca]);
      newFaces.push([b, bc, ab]);
      newFaces.push([c, ca, bc]);
      newFaces.push([ab, bc, ca]);
    }
    verts = newVerts;
    faces = newFaces;
  }

  const grid: Vec3[] = verts.map(([x, y, z]) => [
    Math.round(r * x),
    Math.round(r * y),
    Math.round(r * z),
  ]);
  const out: Polygon[] = [];
  for (const [i, j, k] of faces) {
    out.push({
      vertices: [grid[i], grid[j], grid[k]],
      color,
    });
  }
  return out;
}

export default function Sphere() {
  const [radius, setRadius] = useState(8);
  const [subdivisions, setSubdivisions] = useState(2);

  const voxels = useMemo(
    () => buildSphereTriangles(radius, subdivisions),
    [radius, subdivisions]
  );

  const origin: Vec3 = [0, 0, 0];

  return (
    <DebugLayout current="/debug/sphere">
      <DebugSection title="Sphere">
        <Row label="Radius">
          <Slider value={radius} onChange={setRadius} min={1} max={32} />
        </Row>
        <Row label="Subdiv">
          <Slider value={subdivisions} onChange={setSubdivisions} min={0} max={5} />
        </Row>
      </DebugSection>

      <DebugStats voxelCount={voxels.length} extra={{ radius, subdivisions }} />
      <DebugScene
        voxels={voxels}
        origin={origin}
      />
    </DebugLayout>
  );
}
