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
  CHART_CHANNELS, CHART_CHARSETS, CHART_COLORS, CHART_DETAILS, CHART_MARK_TYPES,
  CHART_SCALE_TYPES, CHART_TARGETS, CHART_TRANSFORMS,
  type ChartsWorkbenchAxis, type ChartsWorkbenchMark, type ChartsWorkbenchScale, type ChartsWorkbenchState,
  type GlyphChartsWorkbenchControls,
} from "./chartsWorkbenchState";
import { createDebouncedJsonUrlWriter, createJsonUrlEnvelope } from "../../lib/jsonUrlState";

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

function validateMark(value: unknown): ChartsWorkbenchMark | null {
  if (!isRecord(value)) return null;
  const { id, type, dataText, channels, transform, options } = value;
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
  return { id, type, dataText, channels: cleanChannels, transform: transform as ChartsWorkbenchMark["transform"], options: cleanOptions };
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

function validateChartsWorkbenchState(value: unknown): ChartsWorkbenchState | null {
  if (!isRecord(value)) return null;
  const { marks, nextMarkId, controls, scales, axes, chart, terminal } = value;

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

  if (!isRecord(terminal)) return null;
  if (typeof terminal.NO_COLOR !== "boolean" || typeof terminal.FORCE_COLOR !== "boolean") return null;

  return {
    marks: cleanMarks,
    nextMarkId,
    controls: cleanControls,
    scales: { x: scaleX, y: scaleY },
    axes: { x: axisX, y: axisY },
    chart: { title: chart.title, description: chart.description, legend: chart.legend },
    terminal: { NO_COLOR: terminal.NO_COLOR, FORCE_COLOR: terminal.FORCE_COLOR },
  };
}

const chartsUrlEnvelope = createJsonUrlEnvelope<ChartsWorkbenchState>(VERSION, validateChartsWorkbenchState);

export function encodeChartsUrlState(state: ChartsWorkbenchState): Promise<string> {
  return chartsUrlEnvelope.encode(state);
}
export function decodeChartsUrlState(raw: string | null | undefined): Promise<ChartsWorkbenchState | null> {
  return chartsUrlEnvelope.decode(raw);
}

/** One writer per mounted page (see ChartsWorkbench.tsx) — 150ms debounced,
 *  `history.replaceState`-only, skips the write when the encoded string is
 *  unchanged. `onEncoded` drives the page's "link is N KB" readout. */
export function createChartsUrlWriter(onEncoded?: (info: { raw: string; sizeBytes: number }) => void): (state: ChartsWorkbenchState) => void {
  return createDebouncedJsonUrlWriter(chartsUrlEnvelope, CHARTS_URL_PARAM, 150, onEncoded);
}
