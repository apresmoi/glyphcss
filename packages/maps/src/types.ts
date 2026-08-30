/**
 * Everything public speaks lat/lng (MAPS.md §3b). Grid/cell coordinates are an
 * internal implementation detail of the sample/classify/compile pipeline —
 * they never appear in a public parameter or return value on their own.
 */

/** A geographic window in degrees. */
export interface GlyphMapBounds {
  readonly west: number;
  readonly east: number;
  readonly south: number;
  readonly north: number;
}

/**
 * WHERE you are looking — never how it flattens (MAPS.md §3b). `span` is
 * degrees across; height is derived from `(cols/rows)` (the aspect lock) so a
 * pan/zoom widget never shears terrain.
 *
 * {@link glyphMapBounds} is a convenience constructor for the *static bake*
 * case: it carries an explicit `bounds` box instead of deriving one from
 * `span`+aspect, because a one-shot bake wants the exact box it was asked
 * for, not a re-derived approximation. `sampleGlyphMapField` prefers that
 * exact box when present and only falls back to the aspect-locked derivation
 * (see `viewBounds` in `sample.ts`) for a plain center+span view.
 */
export interface GlyphMapView {
  readonly center: readonly [lon: number, lat: number];
  readonly span: number;
  readonly cols: number;
  readonly rows: number;
  /** Present only on a view built by {@link glyphMapBounds}. */
  readonly bounds?: GlyphMapBounds;
}

/** A fully materialized georeferenced grid of scalar values — a sampling source. */
export interface GlyphMapSource {
  /** Recorded as the `source` id on a bake artifact (MAPS.md §10). */
  readonly id: string;
  readonly kind: "continuous" | "categorical";
  readonly bounds: GlyphMapBounds;
  /** Native pixel grid width/height. */
  readonly cols: number;
  readonly rows: number;
  readonly units?: string;
  /** Row-major, row 0 = north, length `cols * rows`. */
  readonly values: Float32Array;
  /** A sentinel value in `values` meaning "no data", if the source declares one. */
  readonly noDataValue?: number;
}

/** The result of sampling a {@link GlyphMapSource} against a {@link GlyphMapView}. */
export interface GlyphMapField {
  readonly bounds: GlyphMapBounds;
  readonly cols: number;
  readonly rows: number;
  /** Row-major, row 0 = north, length `cols * rows`. */
  readonly values: Float32Array;
  readonly noData: Uint8Array;
  readonly kind: "continuous" | "categorical";
  readonly units?: string;
  readonly min: number;
  readonly max: number;
}

/** Context handed to a sampler callback for the one output cell it is aggregating. */
export interface GlyphMapCellContext {
  readonly col: number;
  readonly row: number;
  /** This cell's own geographic box. */
  readonly bounds: GlyphMapBounds;
  /** Valid (non-noData) source sample count landing in this cell. `0` under magnification. */
  readonly count: number;
}

export type GlyphMapNamedSampler = "mean" | "max" | "min" | "nearest" | "majority";

export type GlyphMapSamplerFn = (samples: Float32Array, cell: GlyphMapCellContext) => number;

export type GlyphMapSampler = GlyphMapNamedSampler | GlyphMapSamplerFn;

/** How a cell with ZERO landing source pixels (view outresolves the source) is filled. */
export type GlyphMapUpsample = "bilinear" | "nearest";

/** How a cell with some invalid (noData) samples is scored as noData. Default: all samples invalid. */
export type GlyphMapNoDataRule = "strict";

export interface GlyphMapSampleOptions {
  sampler?: GlyphMapSampler;
  upsample?: GlyphMapUpsample;
  noData?: GlyphMapNoDataRule;
}

/**
 * A classifier is a value with an id, not a flag (MAPS.md §5) — quantile-
 * classified maps are non-comparable to each other, and that property has to
 * be visible in the type, not just documented.
 */
export interface GlyphMapClassifier {
  readonly id: string;
  /**
   * True only for rank/percentile-derived classifiers (quantile, log) —
   * meaningless on categorical class codes. `classifyGlyphMapField` throws
   * rather than coercing when this is true and the field is categorical.
   */
  readonly orderStatistic: boolean;
  /**
   * Scalar classify, independent of any one field's distribution. Present on
   * every classifier except quantile, whose breaks are relative to the field
   * it was fit against and so has no fixed scalar mapping.
   */
  readonly classifyValue?: (value: number) => number;
  /** Classify every cell of a field, honoring its `noData` buffer. */
  classify(field: GlyphMapField): Uint8Array;
}

/** Bands → glyphs is its own frozen-id step (MAPS.md §5): what a reader actually sees. */
export interface GlyphMapPresentation {
  /** Glyph per band, indexed by band value. A string is indexed by character. */
  readonly ramp: string | readonly string[];
  /** Colour per band, indexed by band value. Omit for plain (uncoloured) output. */
  readonly colors?: readonly string[];
  /** Band 0 (water, by classifier convention) treatment. `null` = blank. Defaults to `ramp[0]`. */
  readonly water?: string | null;
  /** noData cell treatment. `null`/default = blank. */
  readonly noData?: string | null;
  /** Raster-space slope-difference shading. FLAT path only — see AGENTS.md "Presentation". */
  readonly hillshade?: { readonly azimuth: number; readonly altitude: number; readonly zFactor: number };
}

export interface GlyphMapCompileOptions {
  readonly preClass?: string;
  readonly mode?: "inline" | "classes" | "grid";
}

/** Classified bands over a field. `field` is RETAINED — a later slice's relief mesh needs elevation values, not indices. */
export interface GlyphMapBands {
  readonly cols: number;
  readonly rows: number;
  /** Classified band index per cell. */
  readonly bands: Uint8Array;
  readonly noData: Uint8Array;
  readonly field: GlyphMapField;
  readonly classifier: string;
}

/**
 * The single-artifact bake format (MAPS.md §13): bounds, grid, bands, and the
 * `source`/`classifier`/`sampler` ids a tile is later an instance of. Distinct
 * from {@link GlyphMapBands} because `source`/`sampler` are not resolved by
 * the sample/classify pipeline itself — the caller already knows both (it
 * chose them), so `buildGlyphMapArtifact` takes them explicitly rather than
 * threading extra fields through every intermediate type.
 */
export interface GlyphMapArtifact {
  readonly version: 1;
  readonly bounds: GlyphMapBounds;
  readonly cols: number;
  readonly rows: number;
  readonly bands: readonly number[];
  readonly noData: readonly number[];
  readonly units?: string;
  readonly source: string;
  readonly classifier: string;
  readonly sampler: string;
}
