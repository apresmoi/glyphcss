import { useMemo, useState } from "react";
import type { Voxel } from "@layoutit/voxcss/react";
import {
  DebugLayout, DebugSection, DebugStats, DebugScene,
  Row, Slider, Pills,
} from "..";

type Vec3 = [number, number, number];

function buildSphereCubes(radius: number, color = "#3b82f6"): Voxel[] {
  const r = Math.max(1, Math.floor(radius));
  const r2 = r * r;
  const PAD = 1;
  const span = r * 2 + PAD * 2;
  const out: Voxel[] = [];
  for (let x = 0; x < span; x++) {
    for (let y = 0; y < span; y++) {
      for (let z = 0; z < span; z++) {
        const dx = x - PAD - r + 0.5;
        const dy = y - PAD - r + 0.5;
        const dz = z - PAD - r + 0.5;
        if (dx * dx + dy * dy + dz * dz <= r2) {
          out.push({ x, y, z, color });
        }
      }
    }
  }
  return out;
}

function buildSphereTriangles(radius: number, subdivisions: number, color = "#3b82f6"): Voxel[] {
  const r = Math.max(1, Math.floor(radius));
  const PAD = 1;
  const cx = PAD + r, cy = PAD + r, cz = PAD + r;
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
    Math.round(cx + r * x),
    Math.round(cy + r * y),
    Math.round(cz + r * z),
  ]);
  const out: Voxel[] = [];
  for (const [i, j, k] of faces) {
    const v0 = grid[i], v1 = grid[j], v2 = grid[k];
    const xs = [v0[0], v1[0], v2[0]];
    const ys = [v0[1], v1[1], v2[1]];
    const zs = [v0[2], v1[2], v2[2]];
    out.push({
      x: Math.min(...xs), y: Math.min(...ys), z: Math.min(...zs),
      x2: Math.max(...xs), y2: Math.max(...ys), z2: Math.max(...zs),
      shape: "triangle",
      vertices: [v0, v1, v2],
      color,
    });
  }
  return out;
}

type SphereMode = "cubes" | "triangles";

export default function Sphere() {
  const [mode, setMode] = useState<SphereMode>("cubes");
  const [radius, setRadius] = useState(8);
  const [subdivisions, setSubdivisions] = useState(2);
  const [merge, setMerge] = useState<false | "2d" | "3d" | "poly">(false);

  const voxels = useMemo(
    () => (mode === "cubes" ? buildSphereCubes(radius) : buildSphereTriangles(radius, subdivisions)),
    [radius, mode, subdivisions]
  );

  const origin: Vec3 = [radius + 1.5, radius + 1.5, radius + 1.5];

  return (
    <DebugLayout current="/debug/sphere">
      <DebugSection title="Sphere">
        <Row label="Radius">
          <Slider value={radius} onChange={setRadius} min={1} max={32} />
        </Row>
        <Row label="Mode">
          <Pills value={mode} onChange={setMode} options={["cubes", "triangles"]} />
        </Row>
        {mode === "triangles" && (
          <Row label="Subdiv">
            <Slider value={subdivisions} onChange={setSubdivisions} min={0} max={5} />
          </Row>
        )}
        {mode === "cubes" && (
          <Row label="Merge">
            <Pills
              value={merge}
              onChange={setMerge}
              options={[
                { value: false, label: "off" },
                { value: "2d", label: "2d" },
                { value: "3d", label: "3d" },
              ]}
            />
          </Row>
        )}
        {mode === "triangles" && (
          <Row label="Merge">
            <Pills
              value={merge}
              onChange={setMerge}
              options={[
                { value: false, label: "off" },
                { value: "poly", label: "poly" },
              ]}
            />
          </Row>
        )}
      </DebugSection>

      <DebugStats voxelCount={voxels.length} extra={{ mode, merge: merge || "off" }} />
      <DebugScene
        voxels={voxels}
        origin={origin}
        defaultShowFloor
        voxScene={{ mergeVoxels: merge }}
      />
    </DebugLayout>
  );
}
