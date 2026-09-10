import { promises as fs } from "node:fs";
import zlib from "node:zlib";
import { parseGlyphMapAsciiGrid, type GlyphMapAsciiGridMeta } from "../asciiGrid";
import type { GlyphMapSource } from "../types";

export interface GlyphMapLoadSourceOptions extends GlyphMapAsciiGridMeta {
  readonly path: string;
  /** Force gzip decompression regardless of the `path` extension. Auto-detected from a trailing `.gz` otherwise. */
  readonly gzip?: boolean;
}

/**
 * Read an Esri/Arc-Info ASCII Grid file (optionally gzipped) into a
 * {@link GlyphMapSource}. `gdal-async` is deliberately NOT a dependency of
 * this package — the ASCII Grid reader is pure JS (`parseGlyphMapAsciiGrid`,
 * `../asciiGrid`); a GDAL-backed reader is future work behind this same
 * `/node` subpath, kept out of installs the way `website/scripts/bake-labels.mjs`
 * keeps GDAL out of the website's own install.
 */
export async function loadGlyphMapSource(opts: GlyphMapLoadSourceOptions): Promise<GlyphMapSource> {
  const raw = await fs.readFile(opts.path);
  const gzip = opts.gzip ?? opts.path.endsWith(".gz");
  const buf = gzip ? zlib.gunzipSync(raw) : raw;
  return parseGlyphMapAsciiGrid(buf.toString("utf8"), opts);
}
