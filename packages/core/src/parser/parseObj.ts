/**
 * Wavefront `.obj` parser. Returns the unified `ParseResult` shape — a flat
 * polygon list with optional `metadata` for per-format diagnostics.
 *
 * Handles:
 *  - `v x y z` vertex lines (ignores `vn`, `vp`).
 *  - `vt u v` texture-coordinate lines (kept for `f` entries that reference them).
 *  - `f a b c [d ...]` face lines with optional `v/vt/vn` indices. n-gons are
 *    fan-triangulated. Per-face vt indices become per-triangle `uvs` on the
 *    output polygon — needed by the renderer's UV-mapped texture path.
 *  - `usemtl <name>` material switches. Material names that look like 6-char
 *    hex are used as colors directly; otherwise they get assigned a palette
 *    slot in first-seen order. Override either via `materialColors`.
 *  - `o <name>` object groupings — for filtering via `includeObjects` /
 *    `excludeObjects`. Useful when an OBJ ships scenery (e.g. a ground
 *    `Plane` next to the actual model) that shouldn't render.
 *
 * The mesh is fit to `targetSize` units and remapped from OBJ's +Y-up
 * convention to glyphcss's +Z-up via the cyclic permutation (x,y,z) → (z,x,y),
 * which preserves handedness so triangle winding stays consistent.
 *
 * Vertex coords are kept as floats; bbox is NOT computed per-polygon
 * (glyphcss has no per-polygon bbox; the scene container derives the overall
 * mesh bbox from all polygons in `buildSceneContext`).
 */
import type { Polygon, Vec2, Vec3 } from "../types";
import type { ParseResult } from "./types";

export interface ObjParseOptions {
  /**
   * Largest mesh extent (in scene-space units). The mesh is uniformly
   * scaled so its longest bbox dimension equals this. Default: 60.
   */
  targetSize?: number;
  /**
   * Padding added to the bbox of every emitted polygon so they don't land
   * at coordinate "0". Default: 1.
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
   * Optional map: material name → texture URL. When set, every triangle
   * emitted under that material gets `texture` populated. The renderer
   * stamps the image across the triangle's local 2D plane.
   */
  materialTextures?: Record<string, string>;
  /**
   * Palette used to assign colors to materials whose names aren't hex.
   * Each new non-hex material name takes the next palette slot.
   */
  palette?: string[];
  /**
   * Names of `o <name>` objects to KEEP. When set, faces outside these
   * objects are dropped.
   */
  includeObjects?: string[];
  /**
   * Names of `o <name>` objects to DROP. Applied after `includeObjects`.
   * Faces with no enclosing `o` line are kept unless `includeObjects` is set.
   */
  excludeObjects?: string[];
}

const HEX6 = /^[0-9A-Fa-f]{6}$/;

const DEFAULT_PALETTE = [
  "#3b82f6", "#ef4444", "#22c55e", "#eab308",
  "#a855f7", "#06b6d4", "#f97316", "#ec4899",
];

export function parseObj(text: string, options?: ObjParseOptions): ParseResult {
  const targetSize = options?.targetSize ?? 60;
  const gridShift = options?.gridShift ?? 1;
  const defaultColor = options?.defaultColor ?? "#888888";
  const palette = options?.palette ?? DEFAULT_PALETTE;
  const materialOverrides = options?.materialColors ?? {};
  const materialTextures = options?.materialTextures ?? {};

  const verts: Vec3[] = [];
  const uvs: Vec2[] = [];
  const rawFaces: { idx: number[]; uvIdx: (number | null)[]; color: string; texture: string | undefined }[] = [];
  const materialOrder: string[] = [];
  const materialColor = new Map<string, string>();
  let currentColor = defaultColor;
  let currentTexture: string | undefined = undefined;

  const includeSet = options?.includeObjects ? new Set(options.includeObjects) : null;
  const excludeSet = options?.excludeObjects ? new Set(options.excludeObjects) : null;
  let currentObject: string | null = null;
  const objectAllowed = (): boolean => {
    if (currentObject === null) return includeSet === null;
    if (includeSet && !includeSet.has(currentObject)) return false;
    if (excludeSet && excludeSet.has(currentObject)) return false;
    return true;
  };

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
    } else if (raw.startsWith("vt ")) {
      const parts = raw.trim().split(/\s+/);
      uvs.push([parseFloat(parts[1]), parseFloat(parts[2])]);
    } else if (raw.startsWith("o ")) {
      currentObject = raw.trim().slice(2).trim();
    } else if (raw.startsWith("usemtl ")) {
      const matName = raw.trim().split(/\s+/)[1];
      currentColor = colorFor(matName);
      currentTexture = materialTextures[matName];
    } else if (raw.startsWith("f ")) {
      if (!objectAllowed()) continue;
      const parts = raw.trim().split(/\s+/).slice(1);
      const idx: number[] = [];
      const uvIdx: (number | null)[] = [];
      for (const p of parts) {
        const slash = p.split("/");
        idx.push(parseInt(slash[0], 10) - 1);
        const vtRaw = slash[1];
        if (vtRaw && vtRaw.length > 0) {
          const v = parseInt(vtRaw, 10) - 1;
          uvIdx.push(Number.isFinite(v) ? v : null);
        } else {
          uvIdx.push(null);
        }
      }
      rawFaces.push({ idx, uvIdx, color: currentColor, texture: currentTexture });
    }
  }

  if (verts.length === 0 || rawFaces.length === 0) {
    return makeEmptyResult(materialOrder, text.length);
  }

  // Bounding box — only count vertices actually referenced by surviving
  // faces. Otherwise scenery-object verts (e.g. a giant ground plane the
  // user filtered out via excludeObjects) would inflate the bbox and the
  // real model gets shrunk to fit the empty space.
  const usedIdx = new Set<number>();
  for (const f of rawFaces) for (const i of f.idx) usedIdx.add(i);
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const i of usedIdx) {
    const v = verts[i];
    if (!v) continue;
    if (v[0] < minX) minX = v[0]; if (v[0] > maxX) maxX = v[0];
    if (v[1] < minY) minY = v[1]; if (v[1] > maxY) maxY = v[1];
    if (v[2] < minZ) minZ = v[2]; if (v[2] > maxZ) maxZ = v[2];
  }
  const maxDim = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
  const scale = maxDim > 0 ? targetSize / maxDim : 1;

  // Cyclic axis permutation (x,y,z) → (z,x,y) puts OBJ's +Y up axis into
  // glyphcss's +Z (elevation). Single axis swaps invert handedness; a cyclic
  // shift doesn't, so triangle CCW-from-outside winding survives.
  const round = (n: number) => Math.round(n * 1000) / 1000;
  const grid: Vec3[] = verts.map(([x, y, z]) => [
    round((z - minZ) * scale + gridShift),
    round((x - minX) * scale + gridShift),
    round((y - minY) * scale + gridShift),
  ]);

  const polygons: Polygon[] = [];
  for (const { idx, uvIdx, color, texture } of rawFaces) {
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

      let triUvs: Vec2[] | undefined = undefined;
      if (texture) {
        const uA = uvIdx[0], uB = uvIdx[i], uC = uvIdx[i + 1];
        if (uA != null && uB != null && uC != null) {
          const ua = uvs[uA], ub = uvs[uB], uc = uvs[uC];
          if (ua && ub && uc) triUvs = [ua, ub, uc];
        }
      }

      const polygon: Polygon = {
        vertices: [v0, v1, v2],
        color,
      };
      if (texture) polygon.texture = texture;
      if (triUvs) polygon.uvs = triUvs;
      polygons.push(polygon);
    }
  }

  return {
    polygons,
    objectUrls: [],
    dispose: () => { /* no-op: parseObj has no minted blob URLs */ },
    warnings: [],
    metadata: {
      triangleCount: polygons.length,
      materials: materialOrder,
      sourceBytes: text.length,
    },
  };
}

function makeEmptyResult(materials: string[], sourceBytes: number): ParseResult {
  return {
    polygons: [],
    objectUrls: [],
    dispose: () => { /* no-op */ },
    warnings: [],
    metadata: {
      triangleCount: 0,
      materials,
      sourceBytes,
    },
  };
}
