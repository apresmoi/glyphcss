import type { GlyphMapArtifact, GlyphMapBands } from "./types";

/**
 * Build the single-artifact bake format (MAPS.md §13): bounds, grid, bands,
 * and the `source`/`classifier`/`sampler` ids a tile is later an instance
 * of (§10 — without them a legitimate source upgrade reads as drift).
 * `sampler` is the caller's own id (see `glyphMapSamplerId`, `sample.ts`) —
 * `GlyphMapBands` doesn't carry it, since it isn't resolved by the
 * sample/classify pipeline itself and the caller (who chose it) already
 * knows it.
 */
export function buildGlyphMapArtifact(bands: GlyphMapBands, meta: { source: string; sampler: string }): GlyphMapArtifact {
  return {
    version: 1,
    bounds: bands.field.bounds,
    cols: bands.cols,
    rows: bands.rows,
    bands: Array.from(bands.bands),
    noData: Array.from(bands.noData),
    units: bands.field.units,
    source: meta.source,
    classifier: bands.classifier,
    sampler: meta.sampler,
  };
}
