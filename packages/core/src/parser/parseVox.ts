/**
 * MagicaVoxel `.vox` parser. Returns the unified `ParseResult` shape.
 *
 * Handles:
 *  - Header: "VOX " magic + uint32 version (typically 150).
 *  - MAIN chunk nesting: SIZE, XYZI, RGBA (all optional PACK chunk handled).
 *  - SIZE: voxel grid dimensions (sx, sy, sz).
 *  - XYZI: per-voxel (x, y, z, colorIndex) — colorIndex is 1-based.
 *    Files may contain multiple SIZE/XYZI model chunks; coordinates are
 *    flattened into one occupancy grid, matching current voxcss behavior.
 *  - RGBA: 256×4 bytes custom palette (r, g, b, a). Falls back to the
 *    built-in default palette when this chunk is absent.
 *
 * Face culling: for each voxel, each of its 6 neighbours is checked. When a
 * neighbour cell is empty (or out of grid bounds) the shared face is visible
 * and emitted as a quad polygon.
 * Winding follows CCW-from-outside convention, consistent with polycss's
 * backface culling.
 *
 * Coordinate system: MagicaVoxel is Z-up — same as polycss — so no axis
 * permutation is needed (unlike OBJ/glTF which are Y-up and need a cyclic
 * swap). Voxel coordinates are always non-negative (origin at 0), so no
 * shift is required by default.
 *
 * Output mesh is uniformly scaled to fit `targetSize` units along the
 * longest bbox axis.
 */
import type { Polygon, Vec3 } from "../types";
import type { ParseResult } from "./types";

export interface VoxParseOptions {
  /**
   * Largest mesh extent (in scene-space units). The mesh is uniformly
   * scaled so its longest bbox dimension equals this. Default: 60.
   */
  targetSize?: number;
  /**
   * Per-coordinate offset added after scaling. Keeps coordinates away from
   * zero (matching OBJ/glTF parsers). Default: 0 — vox already starts at
   * non-negative integers so zero makes sensible default.
   */
  gridShift?: number;
}

// ── Default MagicaVoxel palette ──────────────────────────────────────────────
// Full 256-entry table from:
// https://github.com/ephtracy/voxel-model/blob/master/MagicaVoxel-file-format-vox.txt
// Stored as 0xAABBGGRR uint32 LE values (alpha, blue, green, red from MSB to
// LSB when stored in memory). We decode (r, g, b) directly from the bytes.
//
// NOTE: the spec stores them as RGBA in file order (byte 0 = R, 1 = G, 2 = B,
// 3 = A) for the RGBA chunk. The default table below is pre-decoded to
// [r, g, b] triples to avoid confusion.
// Index 0 is unused (colorIndex in XYZI is 1-based → palette[colorIndex - 1]).

const DEFAULT_PALETTE_RGBA: number[] = [
  // 256 entries × 4 bytes (R, G, B, A), index 0 is a dummy (never used)
  // from the MagicaVoxel spec default palette (0xAABBGGRR uint32 little-endian)
  0x00000000, 0xffffffff, 0xffccffff, 0xff99ffff, 0xff66ffff, 0xff33ffff, 0xff00ffff, 0xffffccff,
  0xffccccff, 0xff99ccff, 0xff66ccff, 0xff33ccff, 0xff00ccff, 0xffff99ff, 0xffcc99ff, 0xff9999ff,
  0xff6699ff, 0xff3399ff, 0xff0099ff, 0xffff66ff, 0xffcc66ff, 0xff9966ff, 0xff6666ff, 0xff3366ff,
  0xff0066ff, 0xffff33ff, 0xffcc33ff, 0xff9933ff, 0xff6633ff, 0xff3333ff, 0xff0033ff, 0xffff00ff,
  0xffcc00ff, 0xff9900ff, 0xff6600ff, 0xff3300ff, 0xff0000ff, 0xffffffcc, 0xffccffcc, 0xff99ffcc,
  0xff66ffcc, 0xff33ffcc, 0xff00ffcc, 0xffffcccc, 0xffcccccc, 0xff99cccc, 0xff66cccc, 0xff33cccc,
  0xff00cccc, 0xffff99cc, 0xffcc99cc, 0xff9999cc, 0xff6699cc, 0xff3399cc, 0xff0099cc, 0xffff66cc,
  0xffcc66cc, 0xff9966cc, 0xff6666cc, 0xff3366cc, 0xff0066cc, 0xffff33cc, 0xffcc33cc, 0xff9933cc,
  0xff6633cc, 0xff3333cc, 0xff0033cc, 0xffff00cc, 0xffcc00cc, 0xff9900cc, 0xff6600cc, 0xff3300cc,
  0xff0000cc, 0xffffff99, 0xffccff99, 0xff99ff99, 0xff66ff99, 0xff33ff99, 0xff00ff99, 0xffffcc99,
  0xffcccc99, 0xff99cc99, 0xff66cc99, 0xff33cc99, 0xff00cc99, 0xffff9999, 0xffcc9999, 0xff999999,
  0xff669999, 0xff339999, 0xff009999, 0xffff6699, 0xffcc6699, 0xff996699, 0xff666699, 0xff336699,
  0xff006699, 0xffff3399, 0xffcc3399, 0xff993399, 0xff663399, 0xff333399, 0xff003399, 0xffff0099,
  0xffcc0099, 0xff990099, 0xff660099, 0xff330099, 0xff000099, 0xffffff66, 0xffccff66, 0xff99ff66,
  0xff66ff66, 0xff33ff66, 0xff00ff66, 0xffffcc66, 0xffcccc66, 0xff99cc66, 0xff66cc66, 0xff33cc66,
  0xff00cc66, 0xffff9966, 0xffcc9966, 0xff999966, 0xff669966, 0xff339966, 0xff009966, 0xffff6666,
  0xffcc6666, 0xff996666, 0xff666666, 0xff336666, 0xff006666, 0xffff3366, 0xffcc3366, 0xff993366,
  0xff663366, 0xff333366, 0xff003366, 0xffff0066, 0xffcc0066, 0xff990066, 0xff660066, 0xff330066,
  0xff000066, 0xffffff33, 0xffccff33, 0xff99ff33, 0xff66ff33, 0xff33ff33, 0xff00ff33, 0xffffcc33,
  0xffcccc33, 0xff99cc33, 0xff66cc33, 0xff33cc33, 0xff00cc33, 0xffff9933, 0xffcc9933, 0xff999933,
  0xff669933, 0xff339933, 0xff009933, 0xffff6633, 0xffcc6633, 0xff996633, 0xff666633, 0xff336633,
  0xff006633, 0xffff3333, 0xffcc3333, 0xff993333, 0xff663333, 0xff333333, 0xff003333, 0xffff0033,
  0xffcc0033, 0xff990033, 0xff660033, 0xff330033, 0xff000033, 0xffffff00, 0xffccff00, 0xff99ff00,
  0xff66ff00, 0xff33ff00, 0xff00ff00, 0xffffcc00, 0xffcccc00, 0xff99cc00, 0xff66cc00, 0xff33cc00,
  0xff00cc00, 0xffff9900, 0xffcc9900, 0xff999900, 0xff669900, 0xff339900, 0xff009900, 0xffff6600,
  0xffcc6600, 0xff996600, 0xff666600, 0xff336600, 0xff006600, 0xffff3300, 0xffcc3300, 0xff993300,
  0xff663300, 0xff333300, 0xff003300, 0xffff0000, 0xffcc0000, 0xff990000, 0xff660000, 0xff330000,
  0xff0000ee, 0xff0000dd, 0xff0000bb, 0xff0000aa, 0xff000088, 0xff000077, 0xff000055, 0xff000044,
  0xff000022, 0xff000011, 0xff00ee00, 0xff00dd00, 0xff00bb00, 0xff00aa00, 0xff008800, 0xff007700,
  0xff005500, 0xff004400, 0xff002200, 0xff001100, 0xffee0000, 0xffdd0000, 0xffbb0000, 0xffaa0000,
  0xff880000, 0xff770000, 0xff550000, 0xff440000, 0xff220000, 0xff110000, 0xffeeeeee, 0xffdddddd,
  0xffbbbbbb, 0xffaaaaaa, 0xff888888, 0xff777777, 0xff555555, 0xff444444, 0xff222222, 0xff111111,
];

// ── Internal helpers ─────────────────────────────────────────────────────────

/** Extract r, g, b from a packed 0xAABBGGRR value (same order as the default palette above). */
function rgbFromPacked(v: number): [number, number, number] {
  // Values in the default table are in 0xAABBGGRR format where LSB = R.
  const r = (v >> 0) & 0xff;
  const g = (v >> 8) & 0xff;
  const b = (v >> 16) & 0xff;
  return [r, g, b];
}

function toHex2(n: number): string {
  return (n & 0xff).toString(16).padStart(2, "0");
}

function colorFromRgb(r: number, g: number, b: number): string {
  return `#${toHex2(r)}${toHex2(g)}${toHex2(b)}`;
}

const VOX_MAGIC = 0x20584f56; // "VOX " as little-endian uint32

// ── Face winding quads ───────────────────────────────────────────────────────
// CCW-from-outside winding for each of the 6 cube faces.
// Parameters: (x, y, z) = voxel origin, (x2, y2, z2) = far corner (x+1, y+1, z+1).

type Quad = [Vec3, Vec3, Vec3, Vec3];

function faceQuads(x: number, y: number, z: number): {
  px: Quad; nx: Quad; py: Quad; ny: Quad; pz: Quad; nz: Quad;
} {
  const x2 = x + 1, y2 = y + 1, z2 = z + 1;
  return {
    // +X (right face): CCW viewed from +X side
    px: [[x2, y, z], [x2, y2, z], [x2, y2, z2], [x2, y, z2]],
    // -X (left face): CCW viewed from -X side
    nx: [[x, y2, z], [x, y, z], [x, y, z2], [x, y2, z2]],
    // +Y (back face): CCW viewed from +Y side
    py: [[x, y2, z], [x, y2, z2], [x2, y2, z2], [x2, y2, z]],
    // -Y (front face): CCW viewed from -Y side
    ny: [[x2, y, z], [x2, y, z2], [x, y, z2], [x, y, z]],
    // +Z (top face): CCW viewed from +Z side
    pz: [[x, y, z2], [x2, y, z2], [x2, y2, z2], [x, y2, z2]],
    // -Z (bottom face): CCW viewed from -Z side
    nz: [[x, y2, z], [x2, y2, z], [x2, y, z], [x, y, z]],
  };
}


// ── Main parser ──────────────────────────────────────────────────────────────

export function parseVox(buffer: ArrayBuffer, options?: VoxParseOptions): ParseResult {
  const targetSize = options?.targetSize ?? 60;
  const gridShift = options?.gridShift ?? 0;
  const sourceBytes = buffer.byteLength;

  // Handle zero-length / obviously truncated input.
  if (buffer.byteLength < 8) {
    return makeEmptyResult(sourceBytes, ["parseVox: buffer too small to be a valid .vox file"]);
  }

  const dv = new DataView(buffer);

  // 1. Validate magic "VOX " and version.
  const magic = dv.getUint32(0, true);
  if (magic !== VOX_MAGIC) {
    return makeEmptyResult(sourceBytes, ["parseVox: not a .vox file (bad magic)"]);
  }
  // Version field at offset 4. Spec says 150; we accept anything.
  // const _version = dv.getUint32(4, true);

  // 2. MAIN chunk starts at offset 8.
  if (buffer.byteLength < 20) {
    return makeEmptyResult(sourceBytes, ["parseVox: buffer too small for MAIN chunk"]);
  }

  // We'll collect SIZE + XYZI + RGBA by scanning the chunk tree.
  // The spec has MAIN's children immediately after the MAIN header;
  // MAIN's contentSize should be 0 (its own content is empty).
  const mainChunkId = readChunkId(dv, 8);
  if (mainChunkId !== "MAIN") {
    return makeEmptyResult(sourceBytes, ["parseVox: expected MAIN chunk at offset 8"]);
  }
  const mainContentSize = dv.getUint32(12, true);
  // Children start immediately after MAIN's header (12 bytes) + any MAIN content.
  let offset = 8 + 12 + mainContentSize;
  const mainChildrenEnd = offset + dv.getUint32(16, true);

  // Parse chunk tree within MAIN children.
  interface SizeChunk { sx: number; sy: number; sz: number }
  interface VoxelEntry { x: number; y: number; z: number; colorIndex: number }

  const sizeChunks: SizeChunk[] = [];
  const xyziChunks: VoxelEntry[][] = [];
  let customPalette: string[] | null = null;

  while (offset < mainChildrenEnd && offset + 12 <= buffer.byteLength) {
    const chunkId = readChunkId(dv, offset);
    const contentSize = dv.getUint32(offset + 4, true);
    const childrenSize = dv.getUint32(offset + 8, true);
    const contentStart = offset + 12;
    const chunkEnd = contentStart + contentSize + childrenSize;

    if (chunkId === "SIZE") {
      if (contentSize >= 12 && contentStart + 12 <= buffer.byteLength) {
        const sx = dv.getUint32(contentStart, true);
        const sy = dv.getUint32(contentStart + 4, true);
        const sz = dv.getUint32(contentStart + 8, true);
        sizeChunks.push({ sx, sy, sz });
      }
    } else if (chunkId === "XYZI") {
      if (contentSize >= 4 && contentStart + 4 <= buffer.byteLength) {
        const count = dv.getUint32(contentStart, true);
        const voxels: VoxelEntry[] = [];
        const maxI = Math.min(count, Math.floor((contentSize - 4) / 4));
        for (let i = 0; i < maxI; i++) {
          const base = contentStart + 4 + i * 4;
          voxels.push({
            x: dv.getUint8(base),
            y: dv.getUint8(base + 1),
            z: dv.getUint8(base + 2),
            colorIndex: dv.getUint8(base + 3),
          });
        }
        xyziChunks.push(voxels);
      }
    } else if (chunkId === "RGBA") {
      // 256 × 4 bytes: r, g, b, a in file order.
      if (contentSize >= 1024 && contentStart + 1024 <= buffer.byteLength) {
        customPalette = [];
        for (let i = 0; i < 256; i++) {
          const base = contentStart + i * 4;
          const r = dv.getUint8(base);
          const g = dv.getUint8(base + 1);
          const b = dv.getUint8(base + 2);
          // a = dv.getUint8(base + 3); — ignored for now (CSS colors are opaque)
          customPalette.push(colorFromRgb(r, g, b));
        }
      }
    }
    // Skip PACK and any unknown chunks.

    offset = chunkEnd;
  }

  // Flatten all XYZI chunks. Multi-model VOX files can carry several
  // SIZE/XYZI pairs; without scene-graph transform support the least
  // surprising behavior is the same flattened occupancy grid voxcss uses.
  // If chunks overlap, keep the first voxel/color at that coordinate.
  const voxels: VoxelEntry[] = [];
  const occupied = new Set<string>();
  for (const chunk of xyziChunks) {
    for (const voxel of chunk) {
      if (voxel.colorIndex === 0) continue;
      const key = `${voxel.x},${voxel.y},${voxel.z}`;
      if (occupied.has(key)) continue;
      occupied.add(key);
      voxels.push(voxel);
    }
  }

  if (voxels.length === 0) {
    return makeEmptyResult(sourceBytes, []);
  }

  // 3. Build color lookup.
  // colorIndex in XYZI is 1-based → palette[colorIndex - 1].
  // Custom RGBA palette: entry[0] is palette[0] (for colorIndex 1), etc.
  // Default palette: index 0 is unused dummy, index 1 = first real color.
  const resolveColor = (colorIndex: number): string => {
    const idx = colorIndex - 1; // 0-based
    if (customPalette !== null) {
      return customPalette[idx] ?? "#888888";
    }
    // Default palette is a uint32 array; entry 0 unused.
    const packed = DEFAULT_PALETTE_RGBA[colorIndex] ?? 0;
    const [r, g, b] = rgbFromPacked(packed);
    return colorFromRgb(r, g, b);
  };

  // 4. Use the deduped occupancy set for face-culling.
  const hasNeighbor = (x: number, y: number, z: number): boolean =>
    occupied.has(`${x},${y},${z}`);

  // 5. Collect visible faces grouped by (direction, plane offset, color).
  // Greedy meshing per group emits one quad per maximal axis-aligned
  // rectangle — provably optimal for axis-aligned grids, where the generic
  // edge-based mergePolygons gets stuck at a non-optimal tiling (greedy
  // local merges produce L-shape candidates that fail the convex check).
  // Six face directions, indexed 0..5: +X, -X, +Y, -Y, +Z, -Z.
  // For each, in-plane axes (u, v) and the constant axis are:
  //   +X / -X: plane = x, in-plane = (y, z)
  //   +Y / -Y: plane = y, in-plane = (x, z)
  //   +Z / -Z: plane = z, in-plane = (x, y)
  type GroupKey = string; // `${dir}:${plane}:${color}`
  const groups = new Map<GroupKey, Set<string>>(); // key → set of "u,v" cells

  const addCell = (dir: number, plane: number, u: number, v: number, color: string): void => {
    const key = `${dir}:${plane}:${color}`;
    let cells = groups.get(key);
    if (!cells) { cells = new Set(); groups.set(key, cells); }
    cells.add(`${u},${v}`);
  };

  for (const v of voxels) {
    const { x, y, z } = v;
    const color = resolveColor(v.colorIndex);

    if (!hasNeighbor(x + 1, y, z)) addCell(0, x + 1, y, z, color); // +X
    if (!hasNeighbor(x - 1, y, z)) addCell(1, x,     y, z, color); // -X
    if (!hasNeighbor(x, y + 1, z)) addCell(2, y + 1, x, z, color); // +Y
    if (!hasNeighbor(x, y - 1, z)) addCell(3, y,     x, z, color); // -Y
    if (!hasNeighbor(x, y, z + 1)) addCell(4, z + 1, x, y, color); // +Z
    if (!hasNeighbor(x, y, z - 1)) addCell(5, z,     x, y, color); // -Z
  }

  // Greedy-mesh a 2D occupancy set into maximal axis-aligned rectangles.
  // Standard algorithm: scan in (v, u) order; for each unvisited cell,
  // extend right (u++) until a gap, then extend down (v++) while the
  // entire row matches. Mark all covered cells visited. Optimal for
  // axis-aligned material grids — same algorithm Minecraft / voxel
  // engines use for their chunk meshing pass.
  function greedyMesh(cells: Set<string>): Array<{ u: number; v: number; w: number; h: number }> {
    const visited = new Set<string>();
    const rects: Array<{ u: number; v: number; w: number; h: number }> = [];
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const k of cells) {
      const [us, vs] = k.split(",");
      const u = +us, vv = +vs;
      if (u < minU) minU = u; if (u > maxU) maxU = u;
      if (vv < minV) minV = vv; if (vv > maxV) maxV = vv;
    }
    for (let vv = minV; vv <= maxV; vv++) {
      for (let u = minU; u <= maxU; u++) {
        const k0 = `${u},${vv}`;
        if (!cells.has(k0) || visited.has(k0)) continue;
        // Extend width.
        let w = 1;
        while (u + w <= maxU) {
          const k = `${u + w},${vv}`;
          if (!cells.has(k) || visited.has(k)) break;
          w++;
        }
        // Extend height while the entire row [u, u+w) is filled and unvisited.
        let h = 1;
        rowLoop: while (vv + h <= maxV) {
          for (let i = 0; i < w; i++) {
            const k = `${u + i},${vv + h}`;
            if (!cells.has(k) || visited.has(k)) break rowLoop;
          }
          h++;
        }
        for (let dh = 0; dh < h; dh++) for (let dw = 0; dw < w; dw++) {
          visited.add(`${u + dw},${vv + dh}`);
        }
        rects.push({ u, v: vv, w, h });
      }
    }
    return rects;
  }

  // Quad winding per face direction (CCW from outside, matches faceQuads()
  // when w=h=1). u,v are the in-plane lower-left corner; w,h are the
  // rectangle extent in the in-plane axes.
  const rectToQuad = (dir: number, plane: number, u: number, v: number, w: number, h: number): Vec3[] => {
    const u2 = u + w, v2 = v + h;
    switch (dir) {
      case 0: // +X face at x=plane, in-plane (y, z)
        return [[plane, u, v], [plane, u2, v], [plane, u2, v2], [plane, u, v2]];
      case 1: // -X face at x=plane, in-plane (y, z), reverse
        return [[plane, u2, v], [plane, u, v], [plane, u, v2], [plane, u2, v2]];
      case 2: // +Y face at y=plane, in-plane (x, z)
        return [[u, plane, v], [u, plane, v2], [u2, plane, v2], [u2, plane, v]];
      case 3: // -Y face at y=plane, in-plane (x, z), reverse
        return [[u2, plane, v], [u2, plane, v2], [u, plane, v2], [u, plane, v]];
      case 4: // +Z face at z=plane, in-plane (x, y)
        return [[u, v, plane], [u2, v, plane], [u2, v2, plane], [u, v2, plane]];
      default: // 5, -Z face at z=plane, in-plane (x, y), reverse
        return [[u, v2, plane], [u2, v2, plane], [u2, v, plane], [u, v, plane]];
    }
  };

  interface RawPolygon { vertices: Vec3[]; color: string }
  const rawPolygons: RawPolygon[] = [];

  for (const [key, cells] of groups) {
    const sep1 = key.indexOf(":");
    const sep2 = key.indexOf(":", sep1 + 1);
    const dir = +key.slice(0, sep1);
    const plane = +key.slice(sep1 + 1, sep2);
    const color = key.slice(sep2 + 1);
    for (const { u, v, w, h } of greedyMesh(cells)) {
      rawPolygons.push({ vertices: rectToQuad(dir, plane, u, v, w, h), color });
    }
  }

  if (rawPolygons.length === 0) {
    return makeEmptyResult(sourceBytes, []);
  }

  // 6. Compute bbox from raw voxel coords and scale.
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const p of rawPolygons) {
    for (const v of p.vertices) {
      if (v[0] < minX) minX = v[0]; if (v[0] > maxX) maxX = v[0];
      if (v[1] < minY) minY = v[1]; if (v[1] > maxY) maxY = v[1];
      if (v[2] < minZ) minZ = v[2]; if (v[2] > maxZ) maxZ = v[2];
    }
  }
  const maxDim = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
  const scale = maxDim > 0 ? targetSize / maxDim : 1;

  const round = (n: number): number => Math.round(n * 1000) / 1000;
  const project = (v: Vec3): Vec3 => [
    round((v[0] - minX) * scale + gridShift),
    round((v[1] - minY) * scale + gridShift),
    round((v[2] - minZ) * scale + gridShift),
  ];

  const polygons: Polygon[] = rawPolygons.map(({ vertices, color }) => ({
    vertices: vertices.map(project),
    color,
  }));

  return {
    polygons,
    objectUrls: [],
    dispose: () => { /* no-op: parseVox has no minted blob URLs */ },
    warnings: [],
    metadata: {
      triangleCount: polygons.length,
      sourceBytes,
      // voxelCount is a vox-specific extension to the base metadata shape.
      // Cast as any to avoid the structural type mismatch — we keep it in
      // metadata so callers can access it without polluting the ParseResult type.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      voxelCount: voxels.length,
    } as ParseResult["metadata"],
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function readChunkId(dv: DataView, offset: number): string {
  return (
    String.fromCharCode(dv.getUint8(offset)) +
    String.fromCharCode(dv.getUint8(offset + 1)) +
    String.fromCharCode(dv.getUint8(offset + 2)) +
    String.fromCharCode(dv.getUint8(offset + 3))
  );
}

function makeEmptyResult(
  sourceBytes: number,
  warnings: string[],
): ParseResult {
  return {
    polygons: [],
    objectUrls: [],
    dispose: () => { /* no-op */ },
    warnings,
    metadata: { triangleCount: 0, sourceBytes },
  };
}
