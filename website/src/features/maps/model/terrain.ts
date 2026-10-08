/** Slider granularity for an elevation window (the Contour card's floor/ceiling and the Terrain card's), in metres — fine enough to place a coastline or a treeline exactly, coarse enough that the whole ETOPO1 envelope is a few hundred steps. */
export const ELEVATION_WINDOW_STEP = 50;

const ELEVATION_WINDOW_FALLBACK = { min: -11000, max: 9000 } as const;

/** Rounded-out slider bounds for an elevation window, widened to contain whatever the current values are so a handle is never off its own track (a user who set a floor of 0 and then zoomed into a wholly-submarine view keeps a reachable handle). Falls back to the ETOPO1 envelope before a field resolves. */
export function elevationWindowTrack(
  fieldRange: { readonly min: number; readonly max: number } | null,
  values: readonly (number | null)[],
): { readonly min: number; readonly max: number } {
  const step = ELEVATION_WINDOW_STEP;
  const lo = fieldRange ? Math.floor(fieldRange.min / step) * step : ELEVATION_WINDOW_FALLBACK.min;
  const hi = fieldRange ? Math.ceil(fieldRange.max / step) * step : ELEVATION_WINDOW_FALLBACK.max;
  const present = values.filter((v): v is number => v !== null);
  const min = Math.min(lo, ...present);
  const max = Math.max(hi, ...present);
  // A degenerate (flat) field would otherwise give a zero-width track, which
  // renders as an unusable slider rather than an empty one.
  return max > min ? { min, max } : { min, max: min + step };
}

/**
 * The `GlyphMapContourLayer` mount options MapsWorkbench.tsx's own contour
 * effect passes to `map.addLayer`, minus `type`/`id`/`source` (which come
 * from a constant and the shared terrain provider, not page state). Pulled
 * out as a pure function — rather than left inline in the effect body —
 * purely so the omit-when-off behaviour of `minElevation`/`maxElevation`/
 * `labels` has something directly testable: `MapsWorkbench.tsx` itself can't
 * be mounted in this standalone vitest config (`mapsAtlasWiring.repro.test.tsx`'s
 * doc has the reason — `CodePanel` pulls in `@glyphcss/core`, which
 * `website/package.json` never declares). Each end/flag is OMITTED, not
 * passed as a sentinel, when unset — so an untouched control mounts exactly
 * the layer this page mounted before that control existed.
 */
/**
 * The TERRAIN layer's elevation-window options, as `addLayer` takes them.
 * Extracted for the same reason `buildContourLayerMountOptions` is: each end
 * is OMITTED, never passed as a sentinel, when unset — so an untouched
 * control mounts exactly the layer this page mounted before the control
 * existed, which is the byte-identity `@glyphcss/maps` gates on its side.
 */
export function terrainWindowOptions(
  minElevation: number | null,
  maxElevation: number | null,
): { minElevation?: number; maxElevation?: number } {
  return {
    ...(minElevation === null ? {} : { minElevation }),
    ...(maxElevation === null ? {} : { maxElevation }),
  };
}

export function buildContourLayerMountOptions(opts: {
  interval: number;
  color: string;
  density: number;
  minElevation: number | null;
  maxElevation: number | null;
  labels: boolean;
}): {
  levels: { interval: number };
  color: string;
  density: number;
  minElevation?: number;
  maxElevation?: number;
  labels?: true;
} {
  return {
    levels: { interval: opts.interval },
    color: opts.color,
    density: opts.density,
    ...(opts.minElevation === null ? {} : { minElevation: opts.minElevation }),
    ...(opts.maxElevation === null ? {} : { maxElevation: opts.maxElevation }),
    ...(opts.labels ? { labels: true } : {}),
  };
}

/**
 * Parses a TYPED contour-window end. Three outcomes, and keeping them apart
 * is the whole point of the function:
 *
 * - `""` or `"off"` (the string the readout itself prints for an unbounded
 *   end) → `null`, unbounded.
 * - any finite number, `0` INCLUDED → that elevation in metres. `0` is sea
 *   level and the single most useful floor this page offers ("floor 0 spends
 *   every line on land"); it must never be read as "off", which is exactly
 *   what a falsy check would have done.
 * - anything else → `null` return, i.e. not a value: {@link MapsReadout}
 *   reverts to what was there.
 *
 * A typed value is CLAMPED to the ETOPO envelope
 * ({@link ELEVATION_WINDOW_FALLBACK}) rather than to the slider's current
 * track, and the track then WIDENS to contain it ({@link elevationWindowTrack}
 * already folds the live values into its own bounds, so a handle is never
 * stranded). Clamping to the track instead would make a legitimate elevation
 * unreachable purely because the current view doesn't happen to hold it. The
 * envelope's own job is to stay well inside `mapsUrlState.ts`'s
 * `MAPS_CONTOUR_WINDOW_OFF` (±32,000 m), the sentinel an unbounded end
 * persists as — a typed value colliding with it would round-trip through a
 * shared link as "off".
 */
export function parseElevationWindowEnd(raw: string): { readonly value: number | null } | null {
  const text = raw.trim();
  if (text === "" || text.toLowerCase() === "off") return { value: null };
  const n = Number.parseFloat(text);
  if (!Number.isFinite(n)) return null;
  return { value: Math.min(ELEVATION_WINDOW_FALLBACK.max, Math.max(ELEVATION_WINDOW_FALLBACK.min, n)) };
}

/**
 * What each DATASETS row's density costs — the same per-TYPE split the OSM
 * card makes, because the cost is a property of the layer type and not of
 * the card.
 *
 * The `line` text differs from the OSM card's in one way that matters: this
 * card has exactly ONE stroke row, so there is no set of strokes to share a
 * number with and the advice "give the strokes one shared number" would be
 * advice about nothing. What is left is the true statement — one grid, one
 * depth pass, paid the moment the row leaves 1x.
 */
export const DATASET_DENSITY_TITLES: Record<string, (label: string) => string> = {
  line: (label) =>
    `${label} density — above 1x this row is stamped into its OWN full-viewport overlay grid with its own geometry depth pass, which is a real per-frame cost (measured at 140x63: 6.6 ms/render with no overlay, 27.4 ms with one at 2x). At 1x it stamps into the grids the scene already produces and costs nothing.`,
  fill: (label) =>
    `${label} density — free to differ. This row renders in its own pass at any value above 1x, so a number of its own costs no more than sharing one.`,
  symbol: (label) =>
    `${label} — positioned labels rather than geometry, so this row has no density: nothing in the renderer reads one for it.`,
  circle: (label) =>
    `${label} — positioned markers rather than geometry, so this row has no density: nothing in the renderer reads one for it.`,
};

/**
 * Formats a metres value adaptively — `m` below one kilometre, `km` above,
 * with a fractional km reading between 1 and 10 so a value near the low end
 * of the km range (e.g. a 1,500 m heatmap relief) doesn't collapse to a
 * misleading `"2 km"`. Shared by every metre-valued row on this page whose
 * range now crosses the metres/kilometres boundary.
 */
export function formatHeightMeters(m: number): string {
  if (m < 1_000) return `${Math.round(m)} m`;
  const km = m / 1_000;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}

/**
 * The `fill-extrusion` height row's bounds — an ABSOLUTE structure height,
 * so its ceiling must stay reachable at a hemisphere-wide view (a
 * building-scale value is genuinely sub-pixel there — relief divides by the
 * Earth's radius) while its floor reaches real landmark/building scale.
 * Exported (rather than left as inline literals in `MapsWorkbench.tsx`) so
 * `mapsKit.logHeightSlider.test.ts` asserts against the SAME numbers the
 * control is actually wired to, not a copy that can silently drift.
 */
export const EXTRUSION_HEIGHT_BOUNDS_M = { min: 20, max: 2_000_000 } as const;

/**
 * The `heatmap` height row's bounds — a relief AMPLITUDE added ON TOP of
 * real terrain (`GLYPH_MAP_HEATMAP_RELIEF_HEIGHT_M` in `widget.ts`), so its
 * ceiling relates to terrain's OWN variation (Everest-to-trench is ~19 km)
 * rather than to planetary scale — deliberately far below
 * {@link EXTRUSION_HEIGHT_BOUNDS_M}'s ceiling, since these are different
 * physical quantities even though both rows share `logHeightSliderSpec`.
 */
export const HEATMAP_RELIEF_HEIGHT_BOUNDS_M = { min: 10, max: 20_000 } as const;
