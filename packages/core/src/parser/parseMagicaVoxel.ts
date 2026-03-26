import type { Voxel, VoxelGrid } from "../types";

export interface MagicaVoxelParseResult {
  voxels: VoxelGrid;
  cols: number;
  rows: number;
  depth: number;
}

const DEFAULT_PALETTE = buildDefaultPalette();
const MAX_DIMENSION = 512;

export function parseMagicaVoxel(input: ArrayBuffer | Uint8Array): MagicaVoxelParseResult {
  const buffer = normalizeBuffer(input);
  const view = new DataView(buffer);
  let offset = 0;

  const readUint8 = () => view.getUint8(offset++);
  const readInt = () => {
    const value = view.getInt32(offset, true);
    offset += 4;
    return value;
  };
  const readString = (len: number) => {
    let out = "";
    for (let i = 0; i < len; i++) {
      out += String.fromCharCode(readUint8());
    }
    return out;
  };

  const magic = readString(4);
  if (magic !== "VOX ") {
    throw new Error("voxcss: not a MagicaVoxel file (missing VOX header)");
  }

  readInt(); // version, unused

  const rootChunkId = readString(4);
  const rootContentSize = readInt();
  /* const rootChildrenSize = */ readInt();
  if (rootChunkId !== "MAIN") {
    throw new Error("voxcss: VOX file missing MAIN chunk");
  }

  // MAIN chunk should have no content; skip content if present.
  offset += rootContentSize;
  const fileEnd = buffer.byteLength;

  let sizeX = 0;
  let sizeY = 0;
  let sizeZ = 0;
  let palette = DEFAULT_PALETTE;
  const rawVoxels: Array<{ x: number; y: number; z: number; colorIndex: number }> = [];
  let observedMaxX = 0;
  let observedMaxY = 0;
  let observedMaxZ = 0;

  while (offset < fileEnd) {
    const chunkId = readString(4);
    const chunkSize = readInt();
    /* const childSize = */ readInt();
    const chunkStart = offset;

    if (chunkId === "SIZE") {
      sizeX = readInt();
      sizeY = readInt();
      sizeZ = readInt();
      if (sizeX <= 0 || sizeY <= 0 || sizeZ <= 0) {
        throw new Error("voxcss: VOX SIZE chunk has zero or negative dimensions");
      }
      if (sizeX > MAX_DIMENSION || sizeY > MAX_DIMENSION || sizeZ > MAX_DIMENSION) {
        throw new Error("voxcss: VOX SIZE chunk dimensions are too large");
      }
    } else if (chunkId === "XYZI") {
      const numVoxels = readInt();
      for (let i = 0; i < numVoxels; i++) {
        const x = readUint8();
        const y = readUint8();
        const z = readUint8();
        const colorIndex = readUint8();
        if (colorIndex === 0) continue;
        observedMaxX = Math.max(observedMaxX, x + 1);
        observedMaxY = Math.max(observedMaxY, y + 1);
        observedMaxZ = Math.max(observedMaxZ, z + 1);
        if (sizeX && sizeY && sizeZ) {
          if (x >= sizeX || y >= sizeY || z >= sizeZ) continue;
        }
        rawVoxels.push({ x, y, z, colorIndex });
      }
    } else if (chunkId === "RGBA") {
      palette = [];
      for (let i = 0; i < 256; i++) {
        const r = readUint8();
        const g = readUint8();
        const b = readUint8();
        readUint8(); // alpha, ignored
        palette.push(`#${toHex(r)}${toHex(g)}${toHex(b)}`);
      }
    } else {
      offset += chunkSize;
    }

    // Ensure we advance past the chunk content if the handler did not consume it fully.
    const consumed = offset - chunkStart;
    if (consumed < chunkSize) {
      offset = chunkStart + chunkSize;
    }
  }

  const cols = sizeY || observedMaxY || 0;
  const rows = sizeX || observedMaxX || 0;
  const depth = sizeZ || observedMaxZ || 0;

  if (cols <= 0 || rows <= 0 || depth <= 0) {
    throw new Error("voxcss: VOX file has no SIZE or voxel data");
  }
  if (cols > MAX_DIMENSION || rows > MAX_DIMENSION || depth > MAX_DIMENSION) {
    throw new Error("voxcss: VOX dimensions are too large");
  }

  const dedupe = new Set<string>();
  const voxels: VoxelGrid = [];
  for (const entry of rawVoxels) {
    const paletteIndex = entry.colorIndex - 1;
    const color = palette[paletteIndex] ?? "#000000";
    const key = `${entry.x}:${entry.y}:${entry.z}`;
    if (dedupe.has(key)) continue;
    dedupe.add(key);
    const x = entry.x + 1;
    const y = entry.y + 1;
    voxels.push({
      x,
      y,
      z: entry.z,
      x2: x + 1,
      y2: y + 1,
      color,
      shape: "cube"
    });
  }

  voxels.sort((a, b) => a.z - b.z || a.x - b.x || a.y - b.y);

  return { voxels, cols, rows, depth };
}

function normalizeBuffer(input: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (input instanceof ArrayBuffer) return input;
  const view = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  const copy = new Uint8Array(view.length);
  copy.set(view);
  return copy.buffer;
}

function toHex(value: number): string {
  return value.toString(16).padStart(2, "0");
}

function buildDefaultPalette(): string[] {
  // Canonical MagicaVoxel fallback palette (from official VOX spec).
  return [
    "#000000", "#ffffff", "#ffffcc", "#ffff99", "#ffff66", "#ffff33", "#ffff00", "#ffccff",
    "#ffcccc", "#ffcc99", "#ffcc66", "#ffcc33", "#ffcc00", "#ff99ff", "#ff99cc", "#ff9999",
    "#ff9966", "#ff9933", "#ff9900", "#ff66ff", "#ff66cc", "#ff6699", "#ff6666", "#ff6633",
    "#ff6600", "#ff33ff", "#ff33cc", "#ff3399", "#ff3366", "#ff3333", "#ff3300", "#ff00ff",
    "#ff00cc", "#ff0099", "#ff0066", "#ff0033", "#ff0000", "#ccffff", "#ccffcc", "#ccff99",
    "#ccff66", "#ccff33", "#ccff00", "#ccccff", "#cccccc", "#cccc99", "#cccc66", "#cccc33",
    "#cccc00", "#cc99ff", "#cc99cc", "#cc9999", "#cc9966", "#cc9933", "#cc9900", "#cc66ff",
    "#cc66cc", "#cc6699", "#cc6666", "#cc6633", "#cc6600", "#cc33ff", "#cc33cc", "#cc3399",
    "#cc3366", "#cc3333", "#cc3300", "#cc00ff", "#cc00cc", "#cc0099", "#cc0066", "#cc0033",
    "#cc0000", "#99ffff", "#99ffcc", "#99ff99", "#99ff66", "#99ff33", "#99ff00", "#99ccff",
    "#99cccc", "#99cc99", "#99cc66", "#99cc33", "#99cc00", "#9999ff", "#9999cc", "#999999",
    "#999966", "#999933", "#999900", "#9966ff", "#9966cc", "#996699", "#996666", "#996633",
    "#996600", "#9933ff", "#9933cc", "#993399", "#993366", "#993333", "#993300", "#9900ff",
    "#9900cc", "#990099", "#990066", "#990033", "#990000", "#66ffff", "#66ffcc", "#66ff99",
    "#66ff66", "#66ff33", "#66ff00", "#66ccff", "#66cccc", "#66cc99", "#66cc66", "#66cc33",
    "#66cc00", "#6699ff", "#6699cc", "#669999", "#669966", "#669933", "#669900", "#6666ff",
    "#6666cc", "#666699", "#666666", "#666633", "#666600", "#6633ff", "#6633cc", "#663399",
    "#663366", "#663333", "#663300", "#6600ff", "#6600cc", "#660099", "#660066", "#660033",
    "#660000", "#33ffff", "#33ffcc", "#33ff99", "#33ff66", "#33ff33", "#33ff00", "#33ccff",
    "#33cccc", "#33cc99", "#33cc66", "#33cc33", "#33cc00", "#3399ff", "#3399cc", "#339999",
    "#339966", "#339933", "#339900", "#3366ff", "#3366cc", "#336699", "#336666", "#336633",
    "#336600", "#3333ff", "#3333cc", "#333399", "#333366", "#333333", "#333300", "#3300ff",
    "#3300cc", "#330099", "#330066", "#330033", "#330000", "#00ffff", "#00ffcc", "#00ff99",
    "#00ff66", "#00ff33", "#00ff00", "#00ccff", "#00cccc", "#00cc99", "#00cc66", "#00cc33",
    "#00cc00", "#0099ff", "#0099cc", "#009999", "#009966", "#009933", "#009900", "#0066ff",
    "#0066cc", "#006699", "#006666", "#006633", "#006600", "#0033ff", "#0033cc", "#003399",
    "#003366", "#003333", "#003300", "#0000ff", "#0000cc", "#000099", "#000066", "#000033",
    "#ee0000", "#dd0000", "#bb0000", "#aa0000", "#880000", "#770000", "#550000", "#440000",
    "#220000", "#110000", "#00ee00", "#00dd00", "#00bb00", "#00aa00", "#008800", "#007700",
    "#005500", "#004400", "#002200", "#001100", "#0000ee", "#0000dd", "#0000bb", "#0000aa",
    "#000088", "#000077", "#000055", "#000044", "#000022", "#000011", "#eeeeee", "#dddddd",
    "#bbbbbb", "#aaaaaa", "#888888", "#777777", "#555555", "#444444", "#222222", "#111111"
  ];
}
