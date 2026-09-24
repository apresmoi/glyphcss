// /charts' whole workbench configuration in one shareable `?c=` query param
// — see website/src/lib/jsonUrlState.ts's file header for why this is a JSON envelope rather than
// urlState.ts's flat packed-field schema: a chart's marks are an
// open-ended array, each with its own data/channels/options, not a
// statically-known field set.
//
// Envelope is append-only per version: `v1` covers every field
// `ChartsWorkbenchState` has today. A future field is added to the `v1`
// validator as an optional, defaulted key (never by bumping the version for
// an additive change) so an old `v1` link a reader saved before the field
// existed still decodes to today's shape; only an incompatible reshaping of
// an EXISTING field bumps to `v2`, at which point `decodeChartsUrlState`
// gains a second branch the way synthUrlState.ts's `outerCodecFor` does.
import { GLYPH_CHART_3D_COLORSCALE_NAMES } from "@glyphcss/charts/3d";
import {
  CHART_AXIS_COLOR_MODES, CHART_CHANNELS, CHART_CHARSETS, CHART_COLORS, CHART_DETAILS, CHART_LEGEND_PLACEMENTS, CHART_MARK_TYPES, CHART_REGION_FILLS,
  CHART_SCALE_TYPES, CHART_TARGETS, CHART_TITLE_ALIGNS, CHART_TITLE_POSITIONS, CHART_TRANSFORMS, CHART_X_AXIS_TITLE_ATS, CHARTS_CUSTOM_MAX_BYTES,
  CHARTS_DENSITY_MIN, chartsDensitySliderMax,
  CHARTS_WORKBENCH_DEFAULT_EFFECT3D,
  CHARTS_3D_AXIS_FORMAT_NAMES,
  createChartsWorkbenchState, findChartsDataset, findCharts3dDataset, randomChartsDatasetId, reduceChartsWorkbenchState, createCharts3dViewState,
  type ChartsDataSource, type ChartsWorkbenchAxis, type ChartsWorkbenchAxisColorState, type ChartsWorkbenchAxisTitlePlacementState,
  type ChartsWorkbenchDataState,
  type ChartsWorkbenchMark, type ChartsWorkbenchScale, type ChartsWorkbenchState, type ChartsWorkbenchStyleState,
  type GlyphChartsWorkbenchControls,
  type Charts3dAxesOverride, type Charts3dAxisOverride, type Charts3dCamera, type Charts3dGuideOptions,
  type Charts3dSource, type Charts3dViewState, type Instrument3DEffectsState,
} from "./chartsWorkbenchState";
import { CHARTS_AXIS_DEFAULT_COLOR } from "./chartsAxisDefaultColor";
import { resolveChartsDataRows, xChannelIsDate } from "./chartsDataSource";
import { FILTER_OPERATORS, normaliseDateColumn, PIPELINE_STEP_KINDS, type PipelineStep } from "../../lib/dataPipeline";
import { profileRows } from "../../lib/dataProfile";
import type { TabularRow } from "../../lib/tabularParse";
import { createJsonUrlEnvelope } from "../../lib/jsonUrlState";
import { writeUrlParam } from "../../lib/urlState";

export const CHARTS_URL_PARAM = "c";
const VERSION = "v1";
/** Past this, the page shows a one-line "link is N KB" notice next to the
 *  Copy buttons — the link is still written in full, this is advisory only. */
export const CHARTS_URL_SIZE_WARN_BYTES = 8192;

// P3-11: the exact bounds `ChartsDock.tsx`'s own Width/Height `useSlider`
// calls enforce (`{ min: 12, max: 240 }` / `{ min: 6, max: 120 }`) — kept
// here, not imported, since the Dock is a page component this state/codec
// layer has no business depending on.
const CHARTS_WIDTH_SLIDER_MIN = 12;
const CHARTS_WIDTH_SLIDER_MAX = 240;
const CHARTS_HEIGHT_SLIDER_MIN = 6;
const CHARTS_HEIGHT_SLIDER_MAX = 120;
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function oneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}
/** The only hex shape the app ever writes into state — `ChartsColorSwatch`
 *  and a native `<input type="color">`'s own `onChange` both always yield
 *  canonical lowercase `#rrggbb`, so a payload carrying anything else
 *  (including the momentarily-uppercase/3-digit forms the SWATCH itself
 *  tolerates while typing) is malformed, not merely non-canonical. */
function isChartsHex(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/.test(value);
}
function validateMarkColor(value: unknown): string | readonly string[] | null | undefined {
  if (value === undefined) return undefined;
  if (isChartsHex(value)) return value;
  if (Array.isArray(value) && value.every(isChartsHex)) return value as string[];
  return null;
}

function validateMark(value: unknown): ChartsWorkbenchMark | null {
  if (!isRecord(value)) return null;
  const { id, type, dataText: rawDataText, channels, transform, options, color: rawColor, dataOmitted } = value;
  if (typeof id !== "number" || !Number.isFinite(id)) return null;
  if (!oneOf(type, CHART_MARK_TYPES)) return null;
  // P3-1/P3-2 (review fix): a NEW field, never a reinterpretation of
  // `dataText`'s own value space — see `ChartsWorkbenchMark.dataOmitted`'s
  // own doc. Absent on every link written before this flag existed, so
  // such a link's `dataText` (including a genuine `"[]"` a reader's own
  // edit produced, pre-showcase) is never mistaken for the omission
  // sentinel. Checked before `dataText` below because it changes what
  // shape `dataText` is even allowed to be.
  if (dataOmitted !== undefined && dataOmitted !== true) return null;
  let dataText: string;
  if (dataOmitted === true && rawDataText === undefined) {
    // P3-1 follow-up (REVIEW-arc-density-search-opus.md): `dataText` is now
    // OMITTED from the wire entirely for a data-omitted mark (never the
    // `"[]"` sentinel string) — `chartsUrlStateForEncode`'s own doc. A link
    // built by an OLDER version of this page still writes the literal
    // `"[]"` string, which the branch below still accepts identically
    // (`typeof rawDataText === "string"`), so this is additive: it widens
    // what decodes, never narrows it. Materialized back to `"[]"` here so
    // every downstream reader of `ChartsWorkbenchMark.dataText` (a required
    // string) still gets one — `chartsUrlStateRehydrated` immediately
    // overwrites it with the real rows for a "dataset" source, and the
    // page's own remote re-fetch does the same for a "remote" one; if
    // NEITHER re-derivation succeeds (a removed dataset, an unreachable
    // remote ref), the mark legitimately has no data left and correctly
    // falls back to an empty-data render rather than a stale one.
    dataText = "[]";
  } else {
    if (typeof rawDataText !== "string") return null;
    // A hand-built link (never one this page's own
    // `encodeChartsUrlStateInfo` wrote — see its own doc) can carry a
    // `dataText` of any size at all; the reducer-level
    // `CHARTS_CUSTOM_MAX_BYTES` cap on a paste/upload never applies to a
    // decoded payload, and this field is the mark's actual render data
    // (unlike `data.source.raw`, which is only a re-editable copy) —
    // 233 KB decoded and rendered with no cap at all. Same cap, same
    // treatment as every other malformed field here: the whole envelope
    // fails to decode and the page falls back to its default state, rather
    // than accepting a payload with no bound.
    if (new TextEncoder().encode(rawDataText).length > CHARTS_CUSTOM_MAX_BYTES) return null;
    dataText = rawDataText;
  }
  if (!isRecord(channels)) return null;
  const cleanChannels: Partial<Record<typeof CHART_CHANNELS[number], string>> = {};
  for (const key of CHART_CHANNELS) {
    const field = channels[key];
    if (field === undefined) continue;
    if (typeof field !== "string") return null;
    cleanChannels[key] = field;
  }
  if (transform !== "none" && !oneOf(transform, CHART_TRANSFORMS)) return null;
  const cleanOptions: ChartsWorkbenchMark["options"] = {};
  if (options !== undefined) {
    if (!isRecord(options)) return null;
    if (options.innerRadius !== undefined) {
      if (typeof options.innerRadius !== "number" || !Number.isFinite(options.innerRadius)) return null;
      cleanOptions.innerRadius = options.innerRadius;
    }
    if (options.axis !== undefined) {
      if (options.axis !== "x" && options.axis !== "y") return null;
      cleanOptions.axis = options.axis;
    }
    // Append-only optional field (AGENTS.md's "Charts" — "options.strokeWidth"
    // landed in the library after this envelope; `v1` still covers it since
    // it's optional and defaulted absent). Mirrors `innerRadius`'s own shape.
    if (options.strokeWidth !== undefined) {
      if (options.strokeWidth !== 1 && options.strokeWidth !== 2 && options.strokeWidth !== 3) return null;
      cleanOptions.strokeWidth = options.strokeWidth;
    }
    // Append-only optional field (AGENTS.md's "Charts" — "Arc shape and
    // callouts"): the arc mark card's own "Labels" toggle, mirroring
    // `strokeWidth`'s own shape — optional, defaulted absent, so an old
    // link with no `labels` key decodes exactly as before this row
    // existed.
    if (options.labels !== undefined) {
      if (options.labels !== "callout" && options.labels !== "legend-only") return null;
      cleanOptions.labels = options.labels;
    }
    if (options.name !== undefined) {
      if (typeof options.name !== "string") return null;
      cleanOptions.name = options.name;
    }
  }
  // Colour controls (this packet), appended after `v1` already existed —
  // an old link carries no `color` key at all, and `validateMarkColor`'s
  // own `undefined` case keeps that mark's `color` unset, exactly
  // `editableMark`'s default.
  const color = validateMarkColor(rawColor);
  if (color === null) return null;
  return { id, type, dataText, channels: cleanChannels, transform: transform as ChartsWorkbenchMark["transform"], options: cleanOptions, ...(color !== undefined ? { color } : {}), ...(dataOmitted === true ? { dataOmitted: true as const } : {}) };
}

function validateScale(value: unknown): ChartsWorkbenchScale | null {
  if (!isRecord(value)) return null;
  const { type, min, max } = value;
  if (!oneOf(type, CHART_SCALE_TYPES)) return null;
  if (typeof min !== "string" || typeof max !== "string") return null;
  return { type, min, max };
}

function validateAxis(value: unknown): ChartsWorkbenchAxis | null {
  if (!isRecord(value)) return null;
  const { ticks, tickMarks, title, grid } = value;
  if (typeof ticks !== "number" || !Number.isFinite(ticks)) return null;
  if (typeof tickMarks !== "boolean") return null;
  if (typeof title !== "string") return null;
  if (typeof grid !== "boolean") return null;
  return { ticks, tickMarks, title, grid };
}

function validateControls(value: unknown): GlyphChartsWorkbenchControls | null {
  if (!isRecord(value)) return null;
  const { target, overrides } = value;
  if (!oneOf(target, CHART_TARGETS)) return null;
  if (!isRecord(overrides)) return null;
  const clean: GlyphChartsWorkbenchControls["overrides"] = {};
  if (overrides.charset !== undefined) {
    if (!oneOf(overrides.charset, CHART_CHARSETS)) return null;
    clean.charset = overrides.charset;
  }
  if (overrides.color !== undefined) {
    if (!oneOf(overrides.color, CHART_COLORS)) return null;
    clean.color = overrides.color;
  }
  // P3-11 (REVIEW-arc-density-search-opus.md): `width`/`height`/`density`
  // used to accept ANY finite number — a hand-edited or hostile link could
  // multiply the render grid arbitrarily (`chartsWorkbenchRenderOptions`
  // computes `round(width * density)`, and `createGlyphCanvas` allocates
  // `cols * rows` typed arrays for whatever comes out). Clamped, not
  // rejected, to the exact ranges the Dock's own sliders already enforce
  // (`ChartsDock.tsx`'s Width/Height/Density `useSlider` calls) — a value
  // outside them is honest INTENT (a reader wants it bigger/smaller than
  // the slider allows) that degrades to the nearest reachable value,
  // exactly like every other slider-backed control already does when a
  // link's number falls outside what the UI itself can produce.
  if (overrides.width !== undefined) {
    if (typeof overrides.width !== "number" || !Number.isFinite(overrides.width)) return null;
    clean.width = clamp(overrides.width, CHARTS_WIDTH_SLIDER_MIN, CHARTS_WIDTH_SLIDER_MAX);
  }
  if (overrides.height !== undefined) {
    if (typeof overrides.height !== "number" || !Number.isFinite(overrides.height)) return null;
    clean.height = clamp(overrides.height, CHARTS_HEIGHT_SLIDER_MIN, CHARTS_HEIGHT_SLIDER_MAX);
  }
  if (overrides.detail !== undefined) {
    if (!oneOf(overrides.detail, CHART_DETAILS)) return null;
    clean.detail = overrides.detail;
  }
  // Density (append-only, appended after `v1` already existed) — absent on
  // every link saved before this feature existed, decoding to
  // `chartsWorkbenchDensity`'s own `CHARTS_DEFAULT_DENSITY` default exactly
  // like a `width`/`height` never typed decodes to the target's own default.
  if (overrides.density !== undefined) {
    if (typeof overrides.density !== "number" || !Number.isFinite(overrides.density)) return null;
    clean.density = clamp(overrides.density, CHARTS_DENSITY_MIN, chartsDensitySliderMax());
  }
  return { target, overrides: clean };
}

// Data folder (AGENTS.md's "Charts" — "Data layer"), appended after the
// original `v1` fields ever existed — an old link with no `data` key at all
// decodes to `{ source: null, pipeline: [] }` (`state.data` at
// `createChartsWorkbenchState()`), exactly the "Data folder untouched"
// state, so nothing about a pre-existing link changes.
function validateDataSource(value: unknown): ChartsDataSource | null {
  if (value === null) return null;
  if (!isRecord(value)) return null;
  if (value.kind === "dataset") {
    return typeof value.id === "string" ? { kind: "dataset", id: value.id } : null;
  }
  if (value.kind === "remote") {
    if (typeof value.ref !== "string" || typeof value.title !== "string" || typeof value.description !== "string") return null;
    if (!isRecord(value.source)) return null;
    const { name, url, licence } = value.source;
    if (typeof name !== "string" || typeof url !== "string") return null;
    // P3-8 (REVIEW-arc-density-search-opus.md): this `url` becomes the
    // dataset card's credit `<a href>`, rendered with an attacker-controlled
    // `name`/`title`/`description` right beside it — a crafted `?c=` link
    // could otherwise present arbitrary provenance ("Hugging Face — World
    // Bank Data") while linking anywhere. The loader itself only ever
    // produces `https://huggingface.co/…` or the pasted raw URL (both
    // `http(s)`), so anything else is not a shape this page's own encoder
    // could have written — rejected here (the whole source, same as every
    // other malformed field in this file) rather than rendered.
    if (!/^https?:\/\//i.test(url)) return null;
    if (licence !== undefined && typeof licence !== "string") return null;
    return { kind: "remote", ref: value.ref, title: value.title, description: value.description, source: { name, url, ...(licence !== undefined ? { licence } : {}) } };
  }
  if (value.kind === "custom") {
    if (typeof value.raw !== "string") return null;
    const source: { kind: "custom"; raw: string; filename?: string; mimeType?: string; omitted?: true } = { kind: "custom", raw: value.raw };
    if (value.filename !== undefined) { if (typeof value.filename !== "string") return null; source.filename = value.filename; }
    if (value.mimeType !== undefined) { if (typeof value.mimeType !== "string") return null; source.mimeType = value.mimeType; }
    // P2-5, appended after `v1` already existed: absent on every link saved
    // before the cap existed, so an old link decodes exactly as before.
    if (value.omitted !== undefined) { if (value.omitted !== true) return null; source.omitted = true; }
    // A3 (round 3): the reducer's `set-data-source` cap (N2) guards every
    // DISPATCH, but a decoded `?c=` payload is fed straight to
    // `ChartsWorkbenchInner` as `initialState` and never goes through the
    // reducer at all — an ordinary paste/dropdown can't produce an
    // over-cap custom `raw` here (the reducer already refuses it before it
    // could be encoded), but a hand-built link can carry one directly. It
    // decodes to the SAME `omitted` marker a genuinely dropped payload
    // uses (`resolveChartsDataRows` already turns that into the "paste it
    // again" error this readout shows), rather than installing the full
    // payload with no size check at all.
    if (!source.omitted && new TextEncoder().encode(source.raw).length > CHARTS_CUSTOM_MAX_BYTES) {
      source.raw = "";
      source.omitted = true;
    }
    return source;
  }
  return null;
}

function validatePipelineStep(value: unknown): PipelineStep | null {
  if (!isRecord(value)) return null;
  if (!oneOf(value.kind, PIPELINE_STEP_KINDS)) return null;
  switch (value.kind) {
    case "select":
      return typeof value.path === "string" ? { kind: "select", path: value.path } : null;
    case "flatten":
      return { kind: "flatten" };
    case "pivotLonger": {
      if (!Array.isArray(value.idColumns) || value.idColumns.some((c) => typeof c !== "string")) return null;
      if (value.keyColumn !== undefined && typeof value.keyColumn !== "string") return null;
      if (value.valueColumn !== undefined && typeof value.valueColumn !== "string") return null;
      return { kind: "pivotLonger", idColumns: value.idColumns as string[], keyColumn: value.keyColumn, valueColumn: value.valueColumn };
    }
    case "pivotWider":
      return typeof value.keyColumn === "string" && typeof value.valueColumn === "string"
        ? { kind: "pivotWider", keyColumn: value.keyColumn, valueColumn: value.valueColumn } : null;
    case "filter":
      return typeof value.column === "string" && oneOf(value.operator, FILTER_OPERATORS) && typeof value.value === "string"
        ? { kind: "filter", column: value.column, operator: value.operator, value: value.value } : null;
    case "derive":
      return typeof value.column === "string" && typeof value.expression === "string"
        ? { kind: "derive", column: value.column, expression: value.expression } : null;
    case "sort": {
      if (typeof value.column !== "string") return null;
      if (value.direction !== undefined && value.direction !== "asc" && value.direction !== "desc") return null;
      return { kind: "sort", column: value.column, direction: value.direction };
    }
    case "limit":
      return typeof value.count === "number" && Number.isFinite(value.count) ? { kind: "limit", count: value.count } : null;
    case "parseDate": {
      if (typeof value.column !== "string") return null;
      if (value.format !== undefined && typeof value.format !== "string") return null;
      return { kind: "parseDate", column: value.column, format: value.format };
    }
    default:
      return null;
  }
}

// Colour controls (this packet), appended after `v1` already existed — an
// old link carries no `style` key at all, and `validateStyleState`'s own
// `value === undefined` branch defaults it to exactly `createChartsWorkbenchState()`'s
// own default axis-colour state (proven by the fixed historical link).
function validateAxisColorState(value: unknown): ChartsWorkbenchAxisColorState | null {
  if (!isRecord(value)) return null;
  const { mode, shared, x, y } = value;
  if (!oneOf(mode, CHART_AXIS_COLOR_MODES)) return null;
  if (!isChartsHex(shared) || !isChartsHex(x) || !isChartsHex(y)) return null;
  return { mode, shared, x, y };
}
// Axis title placement (Dock item "Axis Title + Title at"), appended after
// `v1` already existed — a link with no `axisTitlePlacement` key at all
// (every link saved before this feature existed, `style` present or not)
// decodes to the library's own default (`"center"`/`"top"`), exactly
// `createChartsWorkbenchState()`'s own default.
function validateAxisTitlePlacement(value: unknown): ChartsWorkbenchAxisTitlePlacementState | null {
  if (value === undefined) return { x: "center", y: "top" };
  if (!isRecord(value)) return null;
  const { x, y } = value;
  if (!oneOf(x, CHART_X_AXIS_TITLE_ATS)) return null;
  if (!oneOf(y, CHART_TITLE_POSITIONS)) return null;
  return { x, y };
}
function validateStyleState(value: unknown): ChartsWorkbenchStyleState | null {
  if (value === undefined) {
    return {
      axisColor: { mode: "shared", shared: CHARTS_AXIS_DEFAULT_COLOR, x: CHARTS_AXIS_DEFAULT_COLOR, y: CHARTS_AXIS_DEFAULT_COLOR },
      axisTitlePlacement: { x: "center", y: "top" },
    };
  }
  if (!isRecord(value)) return null;
  const axisColor = validateAxisColorState(value.axisColor);
  if (!axisColor) return null;
  const axisTitlePlacement = validateAxisTitlePlacement(value.axisTitlePlacement);
  if (!axisTitlePlacement) return null;
  // Textures row, appended after `v1` existed: absent is `auto`, and `auto`
  // itself is never written (the reducer drops the key), so an explicit
  // `"auto"` in a hand-built link decodes to the same absent key.
  if (value.regionFill !== undefined && !oneOf(value.regionFill, CHART_REGION_FILLS)) return null;
  return { axisColor, axisTitlePlacement, ...(value.regionFill !== undefined && value.regionFill !== "auto" ? { regionFill: value.regionFill } : {}) };
}

function validateDataState(value: unknown): ChartsWorkbenchDataState | null {
  if (value === undefined) return { source: null, pipeline: [] };
  if (!isRecord(value)) return null;
  const source = validateDataSource(value.source ?? null);
  if (value.source !== undefined && value.source !== null && source === null) return null;
  if (!Array.isArray(value.pipeline)) return null;
  const pipeline: PipelineStep[] = [];
  for (const raw of value.pipeline) {
    const step = validatePipelineStep(raw);
    if (!step) return null;
    pipeline.push(step);
  }
  return { source, pipeline };
}

// ── 3D (packet C3, AGENTS.md's "Charts 3D") ────────────────────────────
// `dimension`/`chart3d` are BOTH append-only optional `v1` fields (a link
// saved before 3D existed carries neither) — absent decodes to `"2d"` /
// `createCharts3dViewState()`, byte-identical to before this feature
// existed. Unlike a 2D mark's `dataText`, a MALFORMED `chart3d` never fails
// the whole decode: it degrades LOCALLY to the same default (and forces
// `dimension: "2d"`, since a 3D viewport with no valid mark to show would
// be worse than falling back to whatever 2D marks the rest of the link
// carries) — the same "never let one field's corruption take down an
// otherwise-good link" posture `chartsUrlStateResolveDataset` already
// applies to a stale dataset id, just resolved at validation time instead
// of a later page-level step.
const CHARTS_3D_ORBIT_MODES = ["turntable", "trackball"] as const;
const CHARTS_3D_SHADINGS = ["auto", "relief", "value"] as const;
// Packet C4 (codex review addition) — `Charts3dStyleOption`'s own
// vocabulary, append-only: an old link (saved before this field existed)
// carries no `style` key and decodes to `"auto"`, byte-identical to before.
const CHARTS_3D_STYLES = ["auto", "solid", "wireframe", "ink"] as const;

/** `mat` is glyphcss's own 9-element row-major 3x3 rotation matrix
 *  (`GlyphCamera.mat`'s own doc, `createGlyphCamera.ts`) — a trackball
 *  orbit's real orientation, distinct from `rotX`/`rotY`. */
const CHARTS_3D_CAMERA_MAT_LENGTH = 9;
function validateCharts3dCameraMat(value: unknown): readonly number[] | null {
  if (!Array.isArray(value) || value.length !== CHARTS_3D_CAMERA_MAT_LENGTH) return null;
  return value.every((n) => typeof n === "number" && Number.isFinite(n)) ? (value as number[]) : null;
}

/** `pan` is `Charts3dCamera.pan`'s own 3-element world-space target
 *  (`createGlyphOrbitControls`'s `getTarget()`/`setTarget()`) — append-only,
 *  a malformed value degrades to ABSENT (the fitted centre) rather than
 *  rejecting the whole camera, mirroring `validateCharts3dCameraMat`'s own
 *  "a bad field is just absent" rule. */
const CHARTS_3D_CAMERA_PAN_LENGTH = 3;
function validateCharts3dCameraPan(value: unknown): readonly [number, number, number] | null {
  if (!Array.isArray(value) || value.length !== CHARTS_3D_CAMERA_PAN_LENGTH) return null;
  return value.every((n) => typeof n === "number" && Number.isFinite(n)) ? (value as [number, number, number]) : null;
}

/**
 * P1-1 fix round 1 (codex review): `mat`/`useMat` are append-only optional
 * fields, round-tripped alongside `rotX`/`rotY` — a TRACKBALL orbit's real
 * orientation lives in `mat` (`Charts3dCamera.mat`'s own doc: `rotX`/`rotY`
 * ride along as the last TURNTABLE pose, not what a trackball view actually
 * renders from), so dropping it on decode silently replaced a rolled
 * trackball pose with a stale Euler one on every shared link. A malformed
 * `mat` (wrong length, non-finite entry) is treated as ABSENT — never a
 * rejected `chart3d`, since `rotX`/`rotY`/`zoom` are still a perfectly
 * valid (if turntable) camera on their own.
 */
function validateCharts3dCamera(value: unknown): Charts3dCamera | null {
  if (!isRecord(value)) return null;
  const { rotX, rotY, zoom, mat, useMat } = value;
  if (typeof rotX !== "number" || !Number.isFinite(rotX)) return null;
  if (typeof rotY !== "number" || !Number.isFinite(rotY)) return null;
  if (zoom !== undefined && (typeof zoom !== "number" || !Number.isFinite(zoom) || zoom <= 0)) return null;
  const cleanMat = mat !== undefined ? validateCharts3dCameraMat(mat) : null;
  const cleanUseMat = cleanMat !== null && useMat === true;
  const pan = value.pan !== undefined ? validateCharts3dCameraPan(value.pan) : null;
  return {
    rotX, rotY,
    ...(zoom !== undefined ? { zoom } : {}),
    ...(cleanMat !== null ? { mat: cleanMat, useMat: cleanUseMat } : {}),
    ...(pan !== null ? { pan } : {}),
  };
}

/**
 * An INLINE source (the mark card's Type toggle, built from the reader's
 * own currently-loaded table or a freshly loaded Hugging Face one) is
 * NEVER carried in the link — `chartsUrlStateForEncode` blanks its `rows`
 * unconditionally, mirroring a `"remote"` 2D dataset's own "no local copy
 * to compare against" rule (this file's own doc, above) — so a decoded
 * `sourceOmitted: true` (or a missing `rows` array) always returns `null`
 * here, which the caller reads as "3D is unavailable on this link" and
 * falls back to the 2D default. One branch per `markType` (packet C6,
 * generalizing C3's surface-only version) — `parametric3d` has no inline
 * variant at all (`Charts3dSource`'s own doc: preset-only), so an inline
 * payload naming it is simply unrecognised and returns `null` like any
 * other malformed source.
 */
function validateCharts3dSource(value: unknown): Charts3dSource | null {
  if (!isRecord(value)) return null;
  if (value.kind === "dataset") {
    return typeof value.id === "string" ? { kind: "dataset", id: value.id } : null;
  }
  if (value.kind !== "inline") return null;
  if (value.sourceOmitted === true || !Array.isArray(value.rows)) return null;
  if (typeof value.title !== "string" || !isRecord(value.channels)) return null;
  const rows = value.rows as readonly TabularRow[];
  const title = value.title;
  const channels = value.channels; // narrowed to Record<string, unknown> by the isRecord check above
  switch (value.markType) {
    case "surface": {
      const { x, y, z } = channels;
      if (typeof x !== "string" || typeof y !== "string" || typeof z !== "string") return null;
      return { kind: "inline", markType: "surface", title, rows, channels: { x, y, z } };
    }
    case "scatter3d": {
      const { x, y, z, series } = channels;
      if (typeof x !== "string" || typeof y !== "string" || typeof z !== "string") return null;
      if (series !== undefined && typeof series !== "string") return null;
      return { kind: "inline", markType: "scatter3d", title, rows, channels: { x, y, z, ...(series !== undefined ? { series } : {}) } };
    }
    case "bars3d": {
      const { x, y, z, xLabel, yLabel } = channels;
      if (typeof x !== "string" || typeof y !== "string" || typeof z !== "string") return null;
      if (xLabel !== undefined && typeof xLabel !== "string") return null;
      if (yLabel !== undefined && typeof yLabel !== "string") return null;
      return { kind: "inline", markType: "bars3d", title, rows, channels: { x, y, z, ...(xLabel !== undefined ? { xLabel } : {}), ...(yLabel !== undefined ? { yLabel } : {}) } };
    }
    case "line3d": {
      const { x, y, z } = channels;
      if (typeof x !== "string" || typeof y !== "string" || typeof z !== "string") return null;
      return { kind: "inline", markType: "line3d", title, rows, channels: { x, y, z } };
    }
    default:
      return null;
  }
}

// Packet C4, item 1 — every `GlyphChart3dGuideOptions` field, read off
// `packages/charts/src/3d/types.ts` directly (never invented): `axisLines`,
// `ticks`, `tickLabels`, `titles`, `grid`, `floorGrid`, `walls`, `box`.
// Append-only (item's own contract: "ride in `?c=` as append-only optional
// fields, and an old link decodes unchanged") — a link saved before this
// packet carries no `guides` key at all and decodes to `{}` (every field
// follows the library's own default), byte-identical to before this feature
// existed; an unrecognised/malformed boolean for one field is treated as
// ABSENT for that field alone (mirrors `validateCharts3dCameraMat`'s own
// "a bad field degrades to absent, never rejects the whole payload" rule),
// never a rejected `chart3d`.
const CHARTS_3D_GUIDE_KEYS = ["axisLines", "ticks", "tickLabels", "titles", "grid", "floorGrid", "walls", "box"] as const;
function validateCharts3dGuides(value: unknown): Charts3dGuideOptions {
  if (!isRecord(value)) return {};
  const clean: Record<string, boolean> = {};
  for (const key of CHARTS_3D_GUIDE_KEYS) {
    const v = value[key];
    if (typeof v === "boolean") clean[key] = v;
  }
  return clean as Charts3dGuideOptions;
}

/** Packet C6, coordinator addendum ("you cannot configure the z axis in
 *  the /charts sidebar"), widened to every C7 field by the coordinator's
 *  own follow-up — one override per axis, the same "a bad field degrades
 *  to absent, never rejects the whole payload" rule `validateCharts3dGuides`
 *  already follows: EACH field is checked independently and a bad one is
 *  simply omitted rather than invalidating its siblings or the whole
 *  `chart3d` payload. Append-only: an old link carries no `axes` key at all
 *  and decodes to `{x:{},y:{},z:{}}` (every axis follows the library's own
 *  default), byte-identical to before this field existed; a link written
 *  before C7's own fields existed carries none of them and decodes exactly
 *  as it did then. `format` accepts only a bare preset NAME already in
 *  `CHARTS_3D_AXIS_FORMAT_NAMES` (this Dock's own safe subset) — never an
 *  arbitrary string, which could name a preset requiring a param this row
 *  has no field for, or no preset at all. */
const CHARTS_3D_AXIS_TITLE_ATS = ["start", "center", "end"] as const;
function validateCharts3dAxisOverride(value: unknown): Charts3dAxisOverride {
  if (!isRecord(value)) return {};
  const title = typeof value.title === "string" ? value.title : undefined;
  const ticks = typeof value.ticks === "number" && Number.isFinite(value.ticks) && value.ticks > 0 ? value.ticks : undefined;
  const format = typeof value.format === "string" && CHARTS_3D_AXIS_FORMAT_NAMES.includes(value.format) ? value.format : undefined;
  const line = typeof value.line === "boolean" ? value.line : undefined;
  const tickMarks = typeof value.tickMarks === "boolean" ? value.tickMarks : undefined;
  const tickLabels = typeof value.tickLabels === "boolean" ? value.tickLabels : undefined;
  const grid = typeof value.grid === "boolean" ? value.grid : undefined;
  const color = isChartsHex(value.color) ? value.color : undefined;
  const domain = Array.isArray(value.domain) && value.domain.length === 2
    && typeof value.domain[0] === "number" && Number.isFinite(value.domain[0])
    && typeof value.domain[1] === "number" && Number.isFinite(value.domain[1]) && value.domain[0] < value.domain[1]
    ? (value.domain as [number, number]) : undefined;
  // Axis title position — append-only, mirroring every other field's own
  // "a bad value degrades to absent" rule rather than rejecting the axis.
  const titleAt = oneOf(value.titleAt, CHARTS_3D_AXIS_TITLE_ATS) ? value.titleAt : undefined;
  const titleOffset = typeof value.titleOffset === "number" && Number.isFinite(value.titleOffset) ? value.titleOffset : undefined;
  return {
    ...(title !== undefined ? { title } : {}), ...(ticks !== undefined ? { ticks } : {}), ...(format !== undefined ? { format } : {}),
    ...(line !== undefined ? { line } : {}), ...(tickMarks !== undefined ? { tickMarks } : {}), ...(tickLabels !== undefined ? { tickLabels } : {}),
    ...(grid !== undefined ? { grid } : {}), ...(color !== undefined ? { color } : {}), ...(domain !== undefined ? { domain } : {}),
    ...(titleAt !== undefined ? { titleAt } : {}), ...(titleOffset !== undefined ? { titleOffset } : {}),
  };
}
function validateCharts3dAxes(value: unknown): Charts3dAxesOverride {
  const record = isRecord(value) ? value : {};
  const color = isChartsHex(record.color) ? record.color : undefined;
  return {
    x: validateCharts3dAxisOverride(record.x), y: validateCharts3dAxisOverride(record.y), z: validateCharts3dAxisOverride(record.z),
    ...(color !== undefined ? { color } : {}),
  };
}

function validateCharts3dViewState(value: unknown): Charts3dViewState | null {
  if (!isRecord(value)) return null;
  const { source, camera, orbitMode, shading, colorscale, style, guides, axes } = value;
  const cleanSource = validateCharts3dSource(source);
  if (!cleanSource) return null;
  const cleanCamera = validateCharts3dCamera(camera);
  if (!cleanCamera) return null;
  if (!oneOf(orbitMode, CHARTS_3D_ORBIT_MODES)) return null;
  if (!oneOf(shading, CHARTS_3D_SHADINGS)) return null;
  if (!oneOf(colorscale, GLYPH_CHART_3D_COLORSCALE_NAMES)) return null;
  // Append-only (this field's own C4 addition): absent decodes to "auto",
  // never rejecting an otherwise-good `chart3d` payload written before it
  // existed.
  const cleanStyle = style === undefined ? "auto" : oneOf(style, CHARTS_3D_STYLES) ? style : null;
  if (cleanStyle === null) return null;
  return { source: cleanSource, camera: cleanCamera, orbitMode, shading, colorscale, style: cleanStyle, guides: validateCharts3dGuides(guides), axes: validateCharts3dAxes(axes) };
}

// Packet C4, item 3 — the shared `Instrument3DEffectsFolder`'s own state
// shape, mirroring `/diagrams`' own `validateEffect3d` exactly: `effectId`
// is any non-empty string (a stock `@glyphcss/effects` id, or `"none"` for
// no layer — a future added effect id needs no urlState change), `targetId`
// likewise (`INSTRUMENT_3D_EFFECT_ALL_TARGET` or `"surface"` — a stale value
// from a future library change degrades to "matches no mesh" at mount,
// `Charts3dViewport.tsx`'s own `resolveEffectTarget` doc, never a decode
// rejection). Append-only: an old link carries no `effect3d` at all and
// decodes to `CHARTS_WORKBENCH_DEFAULT_EFFECT3D` (no layer), byte-identical
// to before this packet existed.
function validateChartsEffect3d(value: unknown): Instrument3DEffectsState | null {
  if (!isRecord(value)) return null;
  const { effectId, targetId } = value;
  if (typeof effectId !== "string" || effectId.length === 0) return null;
  if (typeof targetId !== "string" || targetId.length === 0) return null;
  return { effectId, targetId };
}

function validateChartsWorkbenchState(value: unknown): ChartsWorkbenchState | null {
  if (!isRecord(value)) return null;
  const { marks, nextMarkId, controls, scales, axes, chart, terminal, data, style } = value;

  if (!Array.isArray(marks)) return null;
  const cleanMarks: ChartsWorkbenchMark[] = [];
  for (const rawMark of marks) {
    const mark = validateMark(rawMark);
    if (!mark) return null;
    cleanMarks.push(mark);
  }
  if (typeof nextMarkId !== "number" || !Number.isFinite(nextMarkId)) return null;

  const cleanControls = validateControls(controls);
  if (!cleanControls) return null;

  if (!isRecord(scales)) return null;
  const scaleX = validateScale(scales.x);
  const scaleY = validateScale(scales.y);
  if (!scaleX || !scaleY) return null;

  if (!isRecord(axes)) return null;
  const axisX = validateAxis(axes.x);
  const axisY = validateAxis(axes.y);
  if (!axisX || !axisY) return null;

  if (!isRecord(chart)) return null;
  if (typeof chart.title !== "string" || typeof chart.description !== "string" || typeof chart.legend !== "boolean") return null;
  // Append-only additions (owner packet items 1/2/3): a `v1` link saved
  // before legend/title placement existed carries none of these three keys
  // at all — optional and defaulted here, never bumping the envelope
  // version, so that old link keeps decoding to today's shape exactly as
  // AGENTS.md's "URL state" section requires.
  if (chart.legendPlacement !== undefined && !oneOf(chart.legendPlacement, CHART_LEGEND_PLACEMENTS)) return null;
  if (chart.titleAlign !== undefined && !oneOf(chart.titleAlign, CHART_TITLE_ALIGNS)) return null;
  if (chart.titlePosition !== undefined && !oneOf(chart.titlePosition, CHART_TITLE_POSITIONS)) return null;

  if (!isRecord(terminal)) return null;
  if (typeof terminal.NO_COLOR !== "boolean" || typeof terminal.FORCE_COLOR !== "boolean") return null;

  const cleanData = validateDataState(data);
  if (!cleanData) return null;

  const cleanStyle = validateStyleState(style);
  if (!cleanStyle) return null;

  // See this pair's own doc, above: a malformed/unavailable `chart3d`
  // degrades to the default and forces 2D, rather than failing the whole
  // decode.
  const rawChart3d = validateCharts3dViewState(value.chart3d);
  const cleanChart3d = rawChart3d ?? createCharts3dViewState();
  const dimension = value.dimension === "3d" && rawChart3d !== null ? "3d" : "2d";

  // Packet C4, item 3 — append-only, same posture as `chart3d`/`guides`
  // above: absent or malformed decodes to the default (no effect layer)
  // rather than failing the whole envelope.
  const cleanEffect3d = validateChartsEffect3d(value.effect3d) ?? CHARTS_WORKBENCH_DEFAULT_EFFECT3D;

  return {
    marks: cleanMarks,
    nextMarkId,
    controls: cleanControls,
    scales: { x: scaleX, y: scaleY },
    axes: { x: axisX, y: axisY },
    chart: {
      title: chart.title, description: chart.description, legend: chart.legend,
      legendPlacement: chart.legendPlacement ?? "bottom",
      titleAlign: chart.titleAlign ?? "center",
      titlePosition: chart.titlePosition ?? "top",
    },
    terminal: { NO_COLOR: terminal.NO_COLOR, FORCE_COLOR: terminal.FORCE_COLOR },
    data: cleanData,
    dimension,
    chart3d: cleanChart3d,
    effect3d: cleanEffect3d,
    style: cleanStyle,
  };
}

const chartsUrlEnvelope = createJsonUrlEnvelope<ChartsWorkbenchState>(VERSION, validateChartsWorkbenchState);

// ── Stock/remote-dataset mark data omission (the mark's data is never in
// the link for a stock OR remote dataset) ──────────────────────────────
//
// `select-dataset` (`chartsWorkbenchState.ts`) builds a mark's `dataText`
// straight from the vendored dataset's own rows, so writing it into `?c=`
// duplicates data this package already ships — a ~200-row dataset can be
// tens of KB before compression, entirely avoidable since any reader who
// opens the link has the same vendored rows locally. `chartsDatasetDerivedDataText`
// re-runs the exact same derivation `select-dataset` used (dataset id + the
// mark's OWN x channel, for the date-normalize decision — see its doc); a
// mark whose `dataText` matches it byte for byte is safe to blank, because
// decode reconstructs the identical string from the same inputs. A REMOTE
// source has no such local copy to re-derive from at all — its marks are
// blanked unconditionally, and a decode instead triggers a fresh network
// re-fetch (`chartsUrlStateResolveDataset`'s own doc; the page, not this
// module, owns that fetch).
//
// P3-1/P3-2 (REVIEW-showcase-opus.md): the blank is the sentinel `"[]"`
// PLUS the mark's own `dataOmitted: true` flag — a NEW `v1`-append-only
// field, not a reinterpretation of `dataText`'s existing value space. Before
// this flag existed, `"[]"` alone was read as "omitted", which could not
// tell that apart from a genuine empty array a reader's own (pre-showcase)
// table edit produced under a `"dataset"` source — decode silently
// discarded that real (if empty) edit and rehydrated the full dataset in
// its place. `dataOmitted` makes the two cases syntactically distinct: only
// a mark carrying the flag is ever rehydrated.

/** `null` when the dataset id doesn't resolve (never true for a real
 *  vendored id, but this is also called from decode on a value the URL
 *  handed us) — the caller then treats the mark's `dataText` as real,
 *  undiscoverable data rather than gambling on a blank. */
function chartsDatasetDerivedDataText(datasetId: string, xChannel: string | undefined): string | null {
  const resolved = resolveChartsDataRows({ kind: "dataset", id: datasetId }, []);
  if (!resolved.ok) return null;
  const isDate = xChannel !== undefined && xChannelIsDate(profileRows(resolved.rows), xChannel);
  const rows = isDate
    ? resolved.rows.map((row) => ({ ...row, [xChannel]: normaliseDateColumn(Object.hasOwn(row, xChannel) ? row[xChannel] ?? null : null) }))
    : resolved.rows;
  return JSON.stringify(rows, null, 2);
}

/**
 * A mark carrying `dataOmitted: true` with NO `dataText` KEY at all — P3-1
 * follow-up (REVIEW-arc-density-search-opus.md): the field used to be
 * OVERWRITTEN with the sentinel string `"[]"`, which meant a link written
 * by THIS build still decoded, byte for byte, as if the chart genuinely
 * had zero rows on any reader that doesn't specifically know to rehydrate
 * `dataOmitted` (an older shipped build, or a moment before this page's
 * own rehydration effect runs). Omitting the key outright — `JSON.
 * stringify` drops an `undefined`-valued property on its own, so this
 * needs no envelope-format change — means a reader that doesn't understand
 * `dataOmitted` sees a genuinely MISSING field rather than a plausible-but-
 * wrong empty array, and `validateMark` materializes it back to `"[]"`
 * only for its own internal bookkeeping (immediately overwritten by
 * rehydration when that succeeds). The runtime `ChartsWorkbenchMark.
 * dataText` is a required `string` — this is a stringify-time cast, valid
 * only because `chartsUrlEnvelope.encode` JSON-serializes the object and
 * never reads this field back as a real mark afterward. */
function markWithDataOmitted(mark: ChartsWorkbenchMark): ChartsWorkbenchMark {
  const { dataText: _dataText, ...rest } = mark;
  return { ...rest, dataOmitted: true as const } as ChartsWorkbenchMark;
}
function markIsDataOmitted(mark: ChartsWorkbenchMark): boolean {
  return mark.dataOmitted === true && !Object.hasOwn(mark, "dataText");
}

/**
 * Exported for its own direct test: the state actually handed to the JSON
 * envelope for encoding. A `"remote"` source blanks EVERY mark
 * unconditionally (there is no local copy to compare against — decode
 * always re-fetches instead of rehydrating). A `"dataset"` source blanks
 * only a mark whose `dataText` matches `chartsDatasetDerivedDataText` for
 * that mark's own x channel; a mark that diverges (a channel changed after
 * selection so the derivation no longer matches, or a hand-built/historical
 * link with genuinely different data) is real data with no other copy and
 * rides in full — never guessed at, never dropped silently. Any other
 * source (`null`, or the backward-compat `"custom"` shape) returns `state`
 * untouched; `encodeChartsUrlStateInfo`'s own oversized-custom-payload drop
 * runs after this and is unaffected.
 */
export function chartsUrlStateForEncode(state: ChartsWorkbenchState): ChartsWorkbenchState {
  let next = state;
  const source = state.data.source;
  if (source?.kind === "remote") {
    const marks = state.marks.map((mark) => markIsDataOmitted(mark) ? mark : markWithDataOmitted(mark));
    if (marks.some((mark, i) => mark !== state.marks[i])) next = { ...next, marks };
  } else if (source?.kind === "dataset") {
    let changed = false;
    const marks = state.marks.map((mark) => {
      const derived = chartsDatasetDerivedDataText(source.id, mark.channels.x);
      if (derived === null || derived !== mark.dataText) return mark;
      changed = true;
      return markWithDataOmitted(mark);
    });
    if (changed) next = { ...next, marks };
  }
  // An INLINE 3D mark (the mark card's Type toggle, or a freshly loaded
  // Hugging Face table, built from real rows kept only in memory) is never
  // written into the link — mirrors a remote 2D dataset's own "no local
  // copy to compare against" rule (`validateCharts3dSource`'s own doc), for
  // every `markType` alike (packet C6). Cast for the same reason
  // `markWithDataOmitted` casts: `rows` is stringify-time-only missing here,
  // never read back as real state afterward.
  if (next.chart3d.source.kind === "inline") {
    const { rows: _rows, ...restSource } = next.chart3d.source;
    next = { ...next, chart3d: { ...next.chart3d, source: { ...restSource, sourceOmitted: true as const } as unknown as Charts3dSource } };
  }
  return next;
}

/**
 * The inverse, run on every decode: a mark carrying `dataOmitted: true`
 * under a `"dataset"` source is re-derived fresh from the dataset id +
 * that mark's own x channel — the same derivation `chartsUrlStateForEncode`
 * compared against, so this is exact. A link encoded before this flag
 * existed (or one whose `dataText` happens to be `"[]"` for an honest
 * reason, pre-showcase) carries no `dataOmitted` at all and is never
 * touched here — its content decodes exactly as saved, sentinel or not.
 * A `"remote"` source is left alone too: there is nothing local to
 * rehydrate from, and `chartsUrlStateResolveDataset` (run separately, by
 * the page) is what turns its still-blank mark into a fresh network fetch.
 */
function chartsUrlStateRehydrated(state: ChartsWorkbenchState): ChartsWorkbenchState {
  const source = state.data.source;
  if (source?.kind !== "dataset") return state;
  let changed = false;
  const marks = state.marks.map((mark) => {
    if (mark.dataOmitted !== true) return mark;
    const derived = chartsDatasetDerivedDataText(source.id, mark.channels.x);
    if (derived === null) return mark;
    changed = true;
    const { dataOmitted: _dataOmitted, ...rest } = mark;
    return { ...rest, dataText: derived };
  });
  return changed ? { ...state, marks } : state;
}

/**
 * P2-3 (review fix, REVIEW-showcase-opus.md): a decoded envelope's
 * `data.source` may legitimately name a `"dataset"` id `findChartsDataset`
 * (aliases included — `datasets/index.ts`) can no longer resolve, or a
 * `"remote"` source that still needs its rows fetched (never rehydrated —
 * see `chartsUrlStateRehydrated`'s own doc). Before this, both reached the
 * page as-is: an unresolvable STOCK id rendered a hard `empty-data` ledger
 * error (`findChartsDataset` → `undefined` → the mark's own `dataText`
 * stays `"[]"`) — the exact failure mode a CORRUPT envelope already
 * degrades gracefully from (`decodeChartsUrlState` returning `null` falls
 * back to a random dataset). This closes that gap: an unresolvable stock
 * id degrades to a random vendored dataset, with `notice` naming what
 * happened so the page can tell the reader (`ChartsWorkbench.tsx`'s
 * existing `feedback` banner). Deliberately NOT folded into
 * `decodeChartsUrlState` itself (whose `ChartsWorkbenchState | null`
 * signature ~45 existing tests depend on) — a separate pure step the page
 * runs on the decoded result, so every prior decode test is untouched. A
 * `"remote"` source is reported the SAME way but with no fallback DATASET
 * attached — `ref` is what the caller re-fetches; only a fetch FAILURE
 * (the page's own concern, `lib/datasetLoad.ts`) falls back to random.
 */
export function chartsUrlStateResolveDataset(state: ChartsWorkbenchState): { readonly state: ChartsWorkbenchState; readonly notice?: string; readonly remoteRef?: string } {
  // The 3D counterpart of the stale-2D-dataset-id fallback below: `?c=`
  // stores only the vendored dataset ID for a `"dataset"`-sourced 3D chart
  // (never the grid itself), so a removed/renamed id must degrade the same
  // way — here it falls back to the 2D chart the REST of the link already
  // describes (never a random 2D dataset, unlike the 2D case: there's no
  // reason to discard a perfectly good 2D chart just because its OWN
  // dimension was 3D).
  if (state.dimension === "3d" && state.chart3d.source.kind === "dataset" && !findCharts3dDataset(state.chart3d.source.id)) {
    return { state: { ...state, dimension: "2d" }, notice: `3D dataset "${state.chart3d.source.id}" is no longer available — showing the 2D chart instead.` };
  }
  const source = state.data.source;
  if (source?.kind === "remote") return { state, remoteRef: source.ref };
  if (source?.kind !== "dataset" || findChartsDataset(source.id)) return { state };
  const fallback = reduceChartsWorkbenchState(createChartsWorkbenchState(), { type: "select-dataset", id: randomChartsDatasetId() });
  return { state: fallback, notice: `Dataset "${source.id}" is no longer available — showing a random dataset instead.` };
}

export interface ChartsUrlEncodeResult {
  readonly raw: string;
  readonly sizeBytes: number;
  /** N3: set — to the PRE-drop raw payload size, in bytes — when a custom
   *  source was dropped from THIS encoding because including it in full
   *  would have made the encoded link exceed `CHARTS_URL_SIZE_WARN_BYTES`.
   *  Absent whenever nothing was dropped, so a caller's "this link doesn't
   *  carry your data" notice can fire on the size the sharer's OWN paste
   *  was, not on the (already-shrunk) size of the link that resulted. */
  readonly omittedCustomBytes?: number;
  /** Set when even every serialized copy of the custom payload (both
   *  `data.source.raw` AND the marks `buildDatasetMark` derived from it —
   *  see this function's own doc) was dropped and the envelope STILL
   *  exceeds `CHARTS_URL_SIZE_WARN_BYTES`. `raw` is `""` in this case — the
   *  caller must not write it — and `sizeBytes` reports the still-oversized
   *  size so a "link too large to share" notice can name it. */
  readonly tooLarge?: boolean;
}

/** P2-5, second half, rewritten for N3: a custom paste/upload's raw text
 *  rides in `?c=` in full by default, so an 8 KB CSV becomes an 8 KB-plus
 *  query string and a large one a query string past what a plain static
 *  host's request line tolerates (a 414 on reload — see F8's repro).
 *
 *  Two things N3 found wrong with the first cut, both fixed here together
 *  because they're the same decision made twice. (a) The THRESHOLD was
 *  measured against the RAW payload, but `CHARTS_URL_SIZE_WARN_BYTES` is
 *  sized for the ENCODED query string — deflate compresses real CSV/TSV
 *  text roughly 1.6:1, so a raw payload comfortably over 8 KB could still
 *  produce an encoded link comfortably under it, and got dropped anyway
 *  for no reason. Fixed by encoding once WITH the payload in full and only
 *  falling back to the dropped form when THAT actual encoded size is over
 *  the threshold. (b) The sharer was never told: dropping the payload
 *  shrinks the encoded link back under the threshold, so the page's own
 *  "link is N KB" notice — the only signal that existed — never fires for
 *  exactly the case it most needs to. `omittedCustomBytes` (the PRE-drop
 *  raw size) is what lets a caller show that notice instead.
 *
 *  Either way the reader's own state object is never mutated — only the
 *  value handed to the encoder — and `resolveChartsDataRows` still turns a
 *  dropped `omitted: true` back into a clear "paste or upload it again"
 *  error on decode. A dataset source, an under-threshold custom one, or a
 *  custom source already marked `omitted` is untouched (one encode, same
 *  as before this fix), so every existing round-trip test stays
 *  byte-identical.
 *
 *  `data.source.raw` is not the ONLY serialized copy of a custom payload:
 *  `chartsDataSource.ts`'s `buildDatasetMark` (what Apply runs) writes the
 *  SAME resolved rows into `marks[N].dataText` as its own independent JSON
 *  copy, typically ~3x the raw text's size — dropping only `source.raw`
 *  left that copy riding in full, so the link stayed over the cap AND the
 *  "isn't in this link" notice became FALSE (the chart still rendered from
 *  `dataText` with no re-paste needed at all). Every mark whose `dataText`
 *  IS that derived output (re-resolved here, compared verbatim — never a
 *  heuristic) is blanked to `"[]"` alongside `source.raw`, so decoding
 *  drops the data everywhere the notice says it does; a mark that diverges
 *  (hand-edited, or built from something else entirely) is real data with
 *  no other copy and is left untouched. If the envelope is STILL over the
 *  cap after dropping every copy (many/huge marks), `raw` comes back `""`
 *  and `tooLarge: true` — writing an oversized link anyway is exactly the
 *  414-on-reload risk this whole mechanism exists to avoid (F8's repro). */
export async function encodeChartsUrlStateInfo(state: ChartsWorkbenchState): Promise<ChartsUrlEncodeResult> {
  // Stock-dataset marks never carry their own data (see this file's own
  // "Stock-dataset mark data omission" doc, above) — done BEFORE the
  // envelope ever sees `state`, so it applies unconditionally, not only
  // once the link is already over the size-warn threshold the custom-drop
  // branch below is gated on.
  const full = await chartsUrlEnvelope.encode(chartsUrlStateForEncode(state));
  const fullSize = new TextEncoder().encode(full).length;
  const source = state.data.source;
  if (fullSize <= CHARTS_URL_SIZE_WARN_BYTES || source?.kind !== "custom" || source.omitted) {
    return { raw: full, sizeBytes: fullSize };
  }
  const omittedCustomBytes = new TextEncoder().encode(source.raw).length;
  const resolved = resolveChartsDataRows(source, state.data.pipeline);
  const derivedDataText = resolved.ok ? JSON.stringify(resolved.rows, null, 2) : null;
  const droppedMarks = derivedDataText === null ? state.marks
    : state.marks.map((mark) => mark.dataText === derivedDataText ? { ...mark, dataText: "[]" } : mark);
  const dropped: ChartsWorkbenchState = {
    ...state,
    marks: droppedMarks,
    data: { ...state.data, source: { kind: "custom", raw: "", omitted: true, ...(source.filename !== undefined ? { filename: source.filename } : {}) } },
  };
  const raw = await chartsUrlEnvelope.encode(dropped);
  const sizeBytes = new TextEncoder().encode(raw).length;
  if (sizeBytes > CHARTS_URL_SIZE_WARN_BYTES) {
    return { raw: "", sizeBytes, omittedCustomBytes, tooLarge: true };
  }
  return { raw, sizeBytes, omittedCustomBytes };
}

export async function encodeChartsUrlState(state: ChartsWorkbenchState): Promise<string> {
  return (await encodeChartsUrlStateInfo(state)).raw;
}
export async function decodeChartsUrlState(raw: string | null | undefined): Promise<ChartsWorkbenchState | null> {
  const decoded = await chartsUrlEnvelope.decode(raw);
  return decoded ? chartsUrlStateRehydrated(decoded) : null;
}

/** One writer per mounted page (see ChartsWorkbench.tsx) — 150ms debounced,
 *  `history.replaceState`-only, skips the write when the encoded string is
 *  unchanged. `onEncoded` drives the page's "link is N KB" readout AND (N3)
 *  its "custom data isn't included in this link" one, via
 *  `omittedCustomBytes`. Implemented directly (rather than through
 *  `jsonUrlState.ts`'s generic `createDebouncedJsonUrlWriter`) because the
 *  size-based drop decision above needs its OWN encode-then-maybe-re-encode
 *  step, which that generic helper's single `envelope.encode(state)` call
 *  has no hook for. */
export function createChartsUrlWriter(onEncoded?: (info: ChartsUrlEncodeResult) => void): (state: ChartsWorkbenchState) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastWritten: string | null = null;
  let generation = 0;
  return (state: ChartsWorkbenchState) => {
    if (typeof window === "undefined") return;
    const generationAtSchedule = ++generation;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void encodeChartsUrlStateInfo(state).then((info) => {
        if (generationAtSchedule !== generation) return; // superseded by a later state change
        onEncoded?.(info);
        if (info.raw === lastWritten) return;
        lastWritten = info.raw;
        writeUrlParam(CHARTS_URL_PARAM, info.raw || null);
      });
    }, 150);
  };
}
