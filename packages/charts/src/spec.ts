/**
 * Mark constructors and `glyphChartPlot` — see `types.ts` for the shapes and
 * Observable Plot's grammar (marks-as-values, composed by
 * `plot({ marks: [...] })`) rather than a `type: "line"` config object: marks
 * compose and share scales, and a spec stays plain JSON-shaped data.
 */

import type {
  GlyphChartChannelValue,
  GlyphChartChannels,
  GlyphChartInput,
  GlyphChartMark,
  GlyphChartMarkOptions,
  GlyphChartSpec,
} from "./types";

function mark(
  type: GlyphChartMark["type"],
  data: GlyphChartMark["data"],
  channels: GlyphChartChannels = {},
  options?: GlyphChartMarkOptions,
): GlyphChartMark {
  return { type, data, channels, options };
}

export function glyphChartLine(data: GlyphChartMark["data"], channels?: GlyphChartChannels, options?: GlyphChartMarkOptions): GlyphChartMark {
  return mark("line", data, channels, options);
}

export function glyphChartArea(data: GlyphChartMark["data"], channels?: GlyphChartChannels, options?: GlyphChartMarkOptions): GlyphChartMark {
  return mark("area", data, channels, options);
}

export function glyphChartBar(data: GlyphChartMark["data"], channels?: GlyphChartChannels, options?: GlyphChartMarkOptions): GlyphChartMark {
  return mark("bar", data, channels, options);
}

export function glyphChartDot(data: GlyphChartMark["data"], channels?: GlyphChartChannels, options?: GlyphChartMarkOptions): GlyphChartMark {
  return mark("dot", data, channels, options);
}

export function glyphChartArc(data: GlyphChartMark["data"], channels?: GlyphChartChannels, options?: GlyphChartMarkOptions): GlyphChartMark {
  return mark("arc", data, channels, options);
}

export function glyphChartCell(data: GlyphChartMark["data"], channels?: GlyphChartChannels, options?: GlyphChartMarkOptions): GlyphChartMark {
  return mark("cell", data, channels, options);
}

export function glyphChartText(data: GlyphChartMark["data"], channels?: GlyphChartChannels, options?: GlyphChartMarkOptions): GlyphChartMark {
  return mark("text", data, channels, options);
}

/**
 * A rule mark takes raw axis positions directly (à la Plot's `ruleY`/`ruleX`)
 * rather than a channel — `glyphChartRule([0])` draws one horizontal rule at
 * `y = 0`; `{ axis: "x" }` draws vertical rules instead. Takes the full
 * `GlyphChartMarkOptions` (not a private `{ axis? }` shape) so `name` reaches
 * the legend exactly like every other mark constructor — final-gate-2
 * review (codex #11): `glyphChartRule([1], { name: "Target" })` used to
 * discard `name` at the constructor, so the equivalent hand-authored JSON
 * mark (which passes `options` straight through) kept its name while the
 * constructor's own result silently lost it.
 */
export function glyphChartRule(values: readonly number[], options: GlyphChartMarkOptions = {}): GlyphChartMark {
  return mark("rule", values, {}, { ...options, axis: options.axis ?? "y" });
}

export interface GlyphChartSankeyChannels {
  readonly source: GlyphChartChannelValue;
  readonly target: GlyphChartChannelValue;
  readonly value: GlyphChartChannelValue;
  /** Same idiom as every other constructor's `options.name` — accepted here directly since a sankey has no other place for a caller-facing series label. */
  readonly name?: string;
  /** Folds into `mark.options.color` like `name` does — per SOURCE NODE, in series order (AGENTS.md's "Charts" "Colours"). */
  readonly color?: string | readonly string[];
}

/**
 * A sankey mark is non-cartesian, like `arc` — see `AGENTS.md`'s "Charts"
 * section. `{ source, target, value }` are channel names/accessors/arrays
 * exactly like every other channel; `name`/`color` fold into
 * `mark.options.{name,color}` like `glyphChartRule`'s own `name` does, so a
 * hand-authored JSON mark (which sets `options` directly) and this
 * constructor agree byte for byte.
 */
export function glyphChartSankey(data: GlyphChartMark["data"], channels: GlyphChartSankeyChannels): GlyphChartMark {
  const { source, target, value, name, color } = channels;
  const options = name !== undefined || color !== undefined ? { ...(name !== undefined && { name }), ...(color !== undefined && { color }) } : undefined;
  return mark("sankey", data, { source, target, value }, options);
}

export interface GlyphChartFunnelChannels {
  /** Omitted with a bare `number[]` `data`: the stage name defaults to the row index. */
  readonly stage?: GlyphChartChannelValue;
  /** Omitted with a bare `number[]` `data`: the value defaults to the array element itself. */
  readonly value?: GlyphChartChannelValue;
  readonly name?: string;
  /** Folds into `mark.options.color` like `name` does — per STAGE, in declared order (AGENTS.md's "Charts" "Colours"). */
  readonly color?: string | readonly string[];
}

/**
 * A funnel mark is non-cartesian, like `arc`/`sankey`. `data` may be a plain
 * `number[]` (stage = index, value = the element) or records addressed by
 * `{ stage, value }` channels.
 */
export function glyphChartFunnel(data: GlyphChartMark["data"], channels: GlyphChartFunnelChannels = {}): GlyphChartMark {
  const { stage, value, name, color } = channels;
  const options = name !== undefined || color !== undefined ? { ...(name !== undefined && { name }), ...(color !== undefined && { color }) } : undefined;
  return mark("funnel", data, { stage, value }, options);
}

export interface GlyphChartPlotOptions {
  readonly marks: readonly GlyphChartMark[];
  readonly scales?: GlyphChartSpec["scales"];
  readonly axes?: GlyphChartSpec["axes"];
  readonly title?: GlyphChartSpec["title"];
  readonly description?: string;
  readonly legend?: GlyphChartSpec["legend"];
}

export function glyphChartPlot(opts: GlyphChartPlotOptions): GlyphChartSpec {
  return { marks: opts.marks, scales: opts.scales, axes: opts.axes, title: opts.title, description: opts.description, legend: opts.legend };
}

function isMark(v: unknown): v is GlyphChartMark {
  return typeof v === "object" && v !== null && "type" in v && "data" in v && "channels" in v;
}

function isSpec(v: unknown): v is GlyphChartSpec {
  return typeof v === "object" && v !== null && "marks" in v && Array.isArray((v as GlyphChartSpec).marks);
}

/**
 * Every public entry's own front door — `renderGlyphChart`, `glyphChartScaleDomains`,
 * `glyphChartSeriesPreview` — accepts a bare number array (sugar for a
 * one-mark line chart, matching the constructors' own shorthand), a lone
 * mark, an array of marks, or a full spec, and always returns a spec.
 *
 * The rejection is TAGGED (`code: "bad-chart-input"`), like every other
 * validation failure, and names no specific caller — this guard runs BEFORE
 * any of them knows which one invoked it, so a hardcoded function name here
 * used to be wrong for every caller except the one it happened to be
 * written for (review finding NEW-7, REVIEW-dock-colours-sliders-opus-round2.md).
 */
export function normalizeGlyphChartInput(input: GlyphChartInput): GlyphChartSpec {
  if (isSpec(input)) return input;
  if (isMark(input)) return glyphChartPlot({ marks: [input] });
  if (Array.isArray(input)) {
    if (input.length > 0 && isMark(input[0])) return glyphChartPlot({ marks: input as GlyphChartMark[] });
    return glyphChartPlot({ marks: [glyphChartLine(input as readonly number[])] });
  }
  throw Object.assign(
    new TypeError("glyphcss: bad-chart-input: input must be a spec, a mark, an array of marks, or a number array."),
    { code: "bad-chart-input" },
  );
}
