// /charts' whole workbench configuration in one shareable `?c=` query param
// — see AGENTS.md's "## Charts" ("URL state") and website/src/lib/
// jsonUrlState.ts's file header for why this is a JSON envelope rather than
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
import {
  CHART_AXIS_COLOR_MODES, CHART_CHANNELS, CHART_CHARSETS, CHART_COLORS, CHART_DETAILS, CHART_LEGEND_PLACEMENTS, CHART_MARK_TYPES,
  CHART_SCALE_TYPES, CHART_TARGETS, CHART_TITLE_ALIGNS, CHART_TITLE_POSITIONS, CHART_TRANSFORMS, CHARTS_CUSTOM_MAX_BYTES,
  type ChartsDataSource, type ChartsWorkbenchAxis, type ChartsWorkbenchAxisColorState, type ChartsWorkbenchDataState,
  type ChartsWorkbenchMark, type ChartsWorkbenchScale, type ChartsWorkbenchState, type ChartsWorkbenchStyleState,
  type GlyphChartsWorkbenchControls,
} from "./chartsWorkbenchState";
import { CHARTS_AXIS_DEFAULT_COLOR } from "./chartsAxisDefaultColor";
import { FILTER_OPERATORS, PIPELINE_STEP_KINDS, type PipelineStep } from "../../lib/dataPipeline";
import { createJsonUrlEnvelope } from "../../lib/jsonUrlState";
import { writeUrlParam } from "../../lib/urlState";

export const CHARTS_URL_PARAM = "c";
const VERSION = "v1";
/** Past this, the page shows a one-line "link is N KB" notice next to the
 *  Copy buttons — the link is still written in full, this is advisory only. */
export const CHARTS_URL_SIZE_WARN_BYTES = 8192;

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
  const { id, type, dataText, channels, transform, options, color: rawColor } = value;
  if (typeof id !== "number" || !Number.isFinite(id)) return null;
  if (!oneOf(type, CHART_MARK_TYPES)) return null;
  if (typeof dataText !== "string") return null;
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
  return { id, type, dataText, channels: cleanChannels, transform: transform as ChartsWorkbenchMark["transform"], options: cleanOptions, ...(color !== undefined ? { color } : {}) };
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
  if (overrides.width !== undefined) {
    if (typeof overrides.width !== "number" || !Number.isFinite(overrides.width)) return null;
    clean.width = overrides.width;
  }
  if (overrides.height !== undefined) {
    if (typeof overrides.height !== "number" || !Number.isFinite(overrides.height)) return null;
    clean.height = overrides.height;
  }
  if (overrides.detail !== undefined) {
    if (!oneOf(overrides.detail, CHART_DETAILS)) return null;
    clean.detail = overrides.detail;
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
function validateStyleState(value: unknown): ChartsWorkbenchStyleState | null {
  if (value === undefined) return { axisColor: { mode: "shared", shared: CHARTS_AXIS_DEFAULT_COLOR, x: CHARTS_AXIS_DEFAULT_COLOR, y: CHARTS_AXIS_DEFAULT_COLOR } };
  if (!isRecord(value)) return null;
  const axisColor = validateAxisColorState(value.axisColor);
  if (!axisColor) return null;
  return { axisColor };
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
    style: cleanStyle,
  };
}

const chartsUrlEnvelope = createJsonUrlEnvelope<ChartsWorkbenchState>(VERSION, validateChartsWorkbenchState);

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
 *  byte-identical. */
export async function encodeChartsUrlStateInfo(state: ChartsWorkbenchState): Promise<ChartsUrlEncodeResult> {
  const full = await chartsUrlEnvelope.encode(state);
  const fullSize = new TextEncoder().encode(full).length;
  const source = state.data.source;
  if (fullSize <= CHARTS_URL_SIZE_WARN_BYTES || source?.kind !== "custom" || source.omitted) {
    return { raw: full, sizeBytes: fullSize };
  }
  const omittedCustomBytes = new TextEncoder().encode(source.raw).length;
  const dropped: ChartsWorkbenchState = {
    ...state,
    data: { ...state.data, source: { kind: "custom", raw: "", omitted: true, ...(source.filename !== undefined ? { filename: source.filename } : {}) } },
  };
  const raw = await chartsUrlEnvelope.encode(dropped);
  return { raw, sizeBytes: new TextEncoder().encode(raw).length, omittedCustomBytes };
}

export async function encodeChartsUrlState(state: ChartsWorkbenchState): Promise<string> {
  return (await encodeChartsUrlStateInfo(state)).raw;
}
export function decodeChartsUrlState(raw: string | null | undefined): Promise<ChartsWorkbenchState | null> {
  return chartsUrlEnvelope.decode(raw);
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
