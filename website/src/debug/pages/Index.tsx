import { useMemo } from "react";
import { VoxCamera, VoxScene } from "@layoutit/voxcss/react";
import type { Voxel } from "@layoutit/voxcss/react";
import { normalizeVoxels } from "@layoutit/voxcss";
import { DebugLayout, SHAPE_GENERATORS, triangleToVoxel } from "..";
import type { ShapeName } from "..";

type Vec3 = [number, number, number];

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

const PLATONIC_NAMES: ShapeName[] = [
  "tetrahedron", "cube", "octahedron",
  "dodecahedron", "icosahedron", "cuboctahedron",
];

interface Card {
  label: string;
  zoom: number;
  voxels: Voxel[];
}

/**
 * Auto-fit zoom: each voxel renders at tileSize=50px at zoom=1, and a 3D
 * rotation lets the diagonal of the bbox project onto the screen — so the
 * effective on-screen size ≈ maxDim × √3 × tile × zoom. We solve for zoom
 * to keep the shape inside ~80% of a 220px card.
 */
const CARD_PX = 220;
const TILE = 50;
const FILL = 1.1;
function autoZoom(voxels: Voxel[]): number {
  // Normalize first — triangle/polygon voxels that ship only `vertices`
  // have their bbox derived here; without this maxDim stays at 0 and
  // we'd pick a huge zoom.
  const normalized = normalizeVoxels(voxels);
  let maxX = 0, maxY = 0, maxZ = 0;
  for (const v of normalized) {
    if (v.x2 != null && v.x2 > maxX) maxX = v.x2;
    if (v.y2 != null && v.y2 > maxY) maxY = v.y2;
    if (v.z2 != null && v.z2 > maxZ) maxZ = v.z2;
  }
  const maxDim = Math.max(maxX, maxY, maxZ, 1);
  return (CARD_PX * FILL) / (maxDim * TILE * Math.sqrt(3));
}

export default function Index() {
  const cards: Card[] = useMemo(() => {
    const platonics: Card[] = PLATONIC_NAMES.map((name) => {
      const voxels = SHAPE_GENERATORS[name]().map((t) => triangleToVoxel(t, 1));
      return { label: name, zoom: autoZoom(voxels), voxels };
    });
    const sphereVoxels = buildSphereTriangles(8, 2);
    const sphere: Card = {
      label: "sphere (triangles)",
      zoom: autoZoom(sphereVoxels),
      voxels: sphereVoxels,
    };
    return [...platonics, sphere];
  }, []);

  return (
    <DebugLayout current="/debug">
      <div style={{
        flex: 1,
        padding: 24,
        overflowY: "auto",
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
        gap: 16,
        alignContent: "start",
      }}>
        {cards.map((c) => (
          <ShapeCard key={c.label} card={c} />
        ))}
      </div>
    </DebugLayout>
  );
}

function ShapeCard({ card }: { card: Card }) {
  return (
    <div style={{
      aspectRatio: "1 / 1",
      background: "#1a1a2e",
      border: "1px solid rgba(255,255,255,0.08)",
      borderRadius: 6,
      position: "relative",
      overflow: "hidden",
    }}>
      <div style={{
        position: "absolute", top: 8, left: 12, fontSize: 11,
        opacity: 0.6, fontFamily: "monospace", zIndex: 1, pointerEvents: "none",
      }}>
        {card.label} · {card.voxels.length} tri
      </div>
      <VoxCamera zoom={card.zoom} rotX={65} rotY={45} animate={0.4}>
        <VoxScene voxels={card.voxels} />
      </VoxCamera>
    </div>
  );
}
