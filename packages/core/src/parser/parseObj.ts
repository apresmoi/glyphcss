import type { InputVoxel, Vec3 } from "../types";

export interface ObjParseOptions {
  /**
   * Largest grid extent (in voxel cells). The mesh is uniformly scaled so its
   * longest bbox dimension equals this. Default: 60.
   */
  targetSize?: number;
  /**
   * Padding added to the integer bbox of every emitted voxel so they don't
   * land at CSS Grid line "0" (which the spec treats as auto-placement).
   * Default: 1. Set to 0 if you handle padding upstream.
   */
  gridShift?: number;
  /**
   * Color used for faces that have no `usemtl` in scope, or whose material
   * name doesn't resolve via `materialColors`. Default: "#888888".
   */
  defaultColor?: string;
  /**
   * Override map: material name → CSS color string. Falls back to:
   *  1. The material name interpreted as a 6-char hex (e.g. "FF9800" → "#FF9800"),
   *  2. Otherwise a slot from `palette` indexed by first-seen material order,
   *  3. Otherwise `defaultColor`.
   */
  materialColors?: Record<string, string>;
  /**
   * Palette used to assign colors to materials whose names aren't hex.
   * Each new non-hex material name takes the next palette slot.
   */
  palette?: string[];
}

export interface ObjParseResult {
  /**
   * Triangle voxels with `vertices` set and the bbox fields omitted —
   * voxcss derives x/y/z/x2/y2/z2 from the vertices when these voxels
   * enter a scene, so the parser doesn't need to compute them.
   */
  voxels: InputVoxel[];
  /** Triangle voxel count after fan-triangulation and degenerate filtering. */
  triangleCount: number;
  /** Materials encountered, in first-seen order. */
  materials: string[];
}

const HEX6 = /^[0-9A-Fa-f]{6}$/;

const DEFAULT_PALETTE = [
  "#3b82f6", "#ef4444", "#22c55e", "#eab308",
  "#a855f7", "#06b6d4", "#f97316", "#ec4899",
];

/**
 * Parse a Wavefront `.obj` file into voxcss triangle voxels. Handles:
 *
 *  - `v x y z` vertex lines (ignores `vn`, `vt`, `vp`).
 *  - `f a b c [d ...]` face lines with optional `v/vt/vn` indices. n-gons
 *    are fan-triangulated.
 *  - `usemtl <name>` material switches. Material names that look like 6-char
 *    hex are used as colors directly; otherwise they get assigned a palette
 *    slot in first-seen order. Override either via `materialColors`.
 *
 * The mesh is fit to `targetSize` cells and remapped from OBJ's +Y-up
 * convention to voxcss's +Z-up via the cyclic permutation (x,y,z) → (z,x,y),
 * which preserves handedness so triangle winding stays consistent.
 *
 * Vertex coords are kept as floats for sub-cell precision (only the bbox of
 * each triangle voxel needs to be integer for CSS Grid).
 */
export function parseObj(text: string, options?: ObjParseOptions): ObjParseResult {
  const targetSize = options?.targetSize ?? 60;
  const gridShift = options?.gridShift ?? 1;
  const defaultColor = options?.defaultColor ?? "#888888";
  const palette = options?.palette ?? DEFAULT_PALETTE;
  const materialOverrides = options?.materialColors ?? {};

  const verts: Vec3[] = [];
  const rawFaces: { idx: number[]; color: string }[] = [];
  const materialOrder: string[] = [];
  const materialColor = new Map<string, string>();
  let currentColor = defaultColor;

  const colorFor = (name: string): string => {
    if (name in materialOverrides) return materialOverrides[name];
    if (HEX6.test(name)) return `#${name}`;
    if (!materialColor.has(name)) {
      materialColor.set(name, palette[materialOrder.length % palette.length]);
      materialOrder.push(name);
    }
    return materialColor.get(name)!;
  };

  const lines = text.split("\n");
  for (const raw of lines) {
    if (raw.length === 0 || raw.charCodeAt(0) === 35) continue; // skip "" and "#"
    if (raw.startsWith("v ")) {
      const parts = raw.trim().split(/\s+/);
      verts.push([parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3])]);
    } else if (raw.startsWith("usemtl ")) {
      currentColor = colorFor(raw.trim().split(/\s+/)[1]);
    } else if (raw.startsWith("f ")) {
      const parts = raw.trim().split(/\s+/).slice(1);
      const idx = parts.map((p) => parseInt(p.split("/")[0], 10) - 1);
      rawFaces.push({ idx, color: currentColor });
    }
  }

  if (verts.length === 0 || rawFaces.length === 0) {
    return { voxels: [], triangleCount: 0, materials: materialOrder };
  }

  // Bounding box.
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const [x, y, z] of verts) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const maxDim = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
  const scale = maxDim > 0 ? targetSize / maxDim : 1;

  // Cyclic axis permutation (x,y,z) → (z,x,y) puts OBJ's +Y up axis into
  // voxel.z (voxcss's elevation axis). Single axis swaps invert handedness;
  // a cyclic shift doesn't, so triangle CCW-from-outside winding survives.
  const round = (n: number) => Math.round(n * 1000) / 1000;
  const grid: Vec3[] = verts.map(([x, y, z]) => [
    round((z - minZ) * scale + gridShift),
    round((x - minX) * scale + gridShift),
    round((y - minY) * scale + gridShift),
  ]);

  const voxels: InputVoxel[] = [];
  for (const { idx, color } of rawFaces) {
    // Fan-triangulate: (i0, i1, i2), (i0, i2, i3), ...
    for (let i = 1; i < idx.length - 1; i++) {
      const a = idx[0], b = idx[i], c = idx[i + 1];
      const v0 = grid[a], v1 = grid[b], v2 = grid[c];
      if (!v0 || !v1 || !v2) continue;
      // Skip degenerate triangles (two verts at the exact same point).
      if (
        (v0[0] === v1[0] && v0[1] === v1[1] && v0[2] === v1[2]) ||
        (v0[0] === v2[0] && v0[1] === v2[1] && v0[2] === v2[2]) ||
        (v1[0] === v2[0] && v1[1] === v2[1] && v1[2] === v2[2])
      ) continue;

      voxels.push({
        shape: "triangle",
        vertices: [v0, v1, v2],
        color,
      });
    }
  }

  return { voxels, triangleCount: voxels.length, materials: materialOrder };
}
