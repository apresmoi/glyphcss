import type { GlyphMapSource } from "./types";

export interface GlyphMapAsciiGridMeta {
  /** Recorded as the `source` id on a bake artifact (MAPS.md §10). Required — a silently-defaulted id would let a renamed/replaced file read as an unrecorded source change. */
  readonly id: string;
  readonly kind?: "continuous" | "categorical";
  readonly units?: string;
  /** Overrides the grid's own `NODATA_value` header, if it has one. */
  readonly noDataValue?: number;
}

/**
 * Parse an Esri/Arc-Info ASCII Grid (`.asc`/`.grd`) into a {@link GlyphMapSource}.
 * Pure JS, no native modules — this is the reader `gdal-async` is deliberately
 * kept out of this slice for (a GDAL reader is a later, Node-subpath-only
 * addition; see `AGENTS.md`). Row 0 of the file's data section is the
 * NORTHERNMOST row, matching {@link GlyphMapSource}'s row-major/row-0-north
 * convention directly — no flip needed.
 */
export function parseGlyphMapAsciiGrid(text: string, meta: GlyphMapAsciiGridMeta): GlyphMapSource {
  const lines = text.split(/\r?\n/);
  const header: Record<string, number> = {};
  let dataStart = 0;
  const HEADER_KEYS = new Set(["ncols", "nrows", "xllcorner", "yllcorner", "xllcenter", "yllcenter", "cellsize", "nodata_value"]);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.length === 0) continue;
    const sp = line.indexOf(" ");
    const tabIdx = line.indexOf("\t");
    const cut = sp === -1 ? tabIdx : tabIdx === -1 ? sp : Math.min(sp, tabIdx);
    if (cut === -1) { dataStart = i; break; }
    const key = line.slice(0, cut).toLowerCase();
    if (!HEADER_KEYS.has(key)) { dataStart = i; break; }
    header[key] = Number(line.slice(cut).trim());
    dataStart = i + 1;
  }

  const cols = header.ncols;
  const rows = header.nrows;
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols <= 0 || rows <= 0) {
    throw new TypeError("glyphcss/maps: parseGlyphMapAsciiGrid: missing/invalid ncols or nrows header.");
  }
  const cellsize = header.cellsize;
  if (!(cellsize > 0)) {
    throw new TypeError("glyphcss/maps: parseGlyphMapAsciiGrid: missing/invalid cellsize header.");
  }
  const west = header.xllcorner !== undefined ? header.xllcorner : header.xllcenter - cellsize / 2;
  const south = header.yllcorner !== undefined ? header.yllcorner : header.yllcenter - cellsize / 2;
  if (!Number.isFinite(west) || !Number.isFinite(south)) {
    throw new TypeError("glyphcss/maps: parseGlyphMapAsciiGrid: missing xllcorner/xllcenter or yllcorner/yllcenter header.");
  }
  const bounds = { west, south, east: west + cols * cellsize, north: south + rows * cellsize };

  const values = new Float32Array(cols * rows);
  let write = 0;
  for (let i = dataStart; i < lines.length && write < values.length; i++) {
    const line = lines[i].trim();
    if (line.length === 0) continue;
    for (const tok of line.split(/\s+/)) {
      values[write++] = Number(tok);
    }
  }
  if (write !== values.length) {
    throw new TypeError(`glyphcss/maps: parseGlyphMapAsciiGrid: expected ${values.length} data values, found ${write}.`);
  }

  const noDataValue = meta.noDataValue ?? (header.nodata_value !== undefined ? header.nodata_value : undefined);

  return {
    id: meta.id,
    kind: meta.kind ?? "continuous",
    bounds,
    cols,
    rows,
    values,
    units: meta.units,
    noDataValue,
  };
}
