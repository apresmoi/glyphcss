import type { CSSProperties, Dispatch, ReactNode } from "react";
import type { GlyphChartMarkType, GlyphChartSeriesPreviewEntry } from "@glyphcss/charts";
import {
  CHART_MARK_TYPES, CHART_TRANSFORMS, CHARTS_DEFAULT_SWATCH_COLOR, chartMarkFields,
  chartRelevantChannels,
  type ChartsWorkbenchAction, type ChartsWorkbenchMark,
} from "./chartsWorkbenchState";
import type { ChartsMarkTypeFitTable } from "./chartsMarkTypeFit";
import { ColorSwatch } from "../InstrumentWorkbench/ColorSwatch";
import { EditableReadout, IconToggle, ToggleIcon } from "../SynthWorkbench/synthKit";

// Mark-type toggle (owner packet item 3's own idiom, extended to the mark
// card: an icon per shape reads faster than a `<select>` of eleven names,
// same `gx-toggle` markup `ChartsDock.tsx`'s target/charset/color rows
// already use). Every icon is a small inline shape at `ToggleIcon`'s own
// shared default size (15x15, `currentColor`, stroke 1.6 — `WAVE_ICONS`/
// `FIELD_ICONS`/`SUBCELL_ICONS` and every other icon set in synthKit.tsx
// take it unmodified; F6's review finding caught this file alone
// overriding to 16x16/1.5, a 1px-larger, marginally thinner render with no
// stated reason) that reads as the chart it picks, never a letter or
// symbol standing in for one.
const CHART_MARK_TYPE_ICONS: Record<(typeof CHART_MARK_TYPES)[number], ReactNode> = {
  line: <ToggleIcon><path d="M2 12 L6 6 L9 9 L14 3" /></ToggleIcon>,
  area: <ToggleIcon fill="currentColor" fillOpacity={0.35}><path d="M2 12 L6 6 L9 9 L14 3 L14 13 L2 13 Z" /></ToggleIcon>,
  bar: (
    <ToggleIcon fill="currentColor" stroke="none">
      <rect x="2.4" y="8" width="2.6" height="5.6" />
      <rect x="6.7" y="4" width="2.6" height="9.6" />
      <rect x="11" y="6.5" width="2.6" height="7.1" />
    </ToggleIcon>
  ),
  dot: (
    <ToggleIcon fill="currentColor" stroke="none">
      <circle cx="4" cy="10.5" r="1.3" /><circle cx="8.2" cy="5" r="1.3" /><circle cx="11.5" cy="9.5" r="1.3" /><circle cx="13.3" cy="4" r="1.3" />
    </ToggleIcon>
  ),
  arc: <ToggleIcon><circle cx="8" cy="8" r="6" /><path d="M8 2 L8 8 L13 11" /></ToggleIcon>,
  rect: <ToggleIcon><rect x="3" y="3" width="10" height="10" /></ToggleIcon>,
  cell: <ToggleIcon><rect x="2" y="2" width="12" height="12" /><line x1="8" y1="2" x2="8" y2="14" /><line x1="2" y1="8" x2="14" y2="8" /></ToggleIcon>,
  text: <ToggleIcon><line x1="4" y1="4" x2="12" y2="4" /><line x1="8" y1="4" x2="8" y2="13" /></ToggleIcon>,
  rule: <ToggleIcon><line x1="2" y1="8" x2="14" y2="8" strokeDasharray="2.4 1.6" /></ToggleIcon>,
  sankey: (
    <ToggleIcon>
      <line x1="3" y1="3" x2="3" y2="13" strokeWidth={2.5} />
      <line x1="13" y1="2" x2="13" y2="6" strokeWidth={2.5} />
      <line x1="13" y1="9" x2="13" y2="14" strokeWidth={2.5} />
      <path d="M3 6 C8 6, 8 4, 13 4" /><path d="M3 10 C8 10, 8 11.5, 13 11.5" />
    </ToggleIcon>
  ),
  funnel: <ToggleIcon><path d="M2 3 L14 3 L10 8 L10 13 L6 13 L6 8 Z" /></ToggleIcon>,
};
const CHART_MARK_TYPE_DESCRIPTIONS: Record<(typeof CHART_MARK_TYPES)[number], string> = {
  line: "connected points along a continuous axis",
  area: "a line with the region below it filled",
  bar: "categorical values as bar length from a zero baseline",
  dot: "scattered points, one per record",
  arc: "a pie/donut slice sized by share of a total",
  rect: "a filled rectangle spanning explicit x/y ranges",
  cell: "a heatmap cell shaded by value",
  text: "a text label placed at a data point",
  rule: "a single reference line across the plot",
  sankey: "flow volume between named source/target nodes",
  funnel: "stage-by-stage narrowing of a single measure",
};
/** One entry per `CHART_MARK_TYPES`, in the same order — exported so a
 *  small unit test can pin "one per mark type, no duplicates" without
 *  mounting the card. */
export const CHART_MARK_TYPE_TOGGLE = CHART_MARK_TYPES.map((type) => ({
  value: type as string, icon: CHART_MARK_TYPE_ICONS[type], label: type, desc: CHART_MARK_TYPE_DESCRIPTIONS[type],
}));

// Stroke width (`options.strokeWidth`, `@glyphcss/charts` — landed with a
// canvas `line({ width })` option, AGENTS.md's "Charts" own
// "options.strokeWidth" paragraph): a per-mark override, same storage shape
// as `innerRadius`/`axis` above (`mark.options`, forwarded verbatim by
// `buildMark` — never `applyChartStyle`, which exists only for `color`'s own
// cross-mark series resolution and has no reason to own this). A `.voice-
// slider` (`instrument-workbench.css`) rather than three icon buttons — the
// SAME lil-gui-style number row the Dock's Width/Height rows use, reached
// for here through the plain (non-lil-gui) `voice-slider` markup the rest
// of this card already uses (`voice-card`/`voice-row`, the SynthWorkbench
// voice-card idiom), since a mark card is not itself a lil-gui folder.
// Range 1..3 step 1, an ORDERED quantity a slider reads faster than three
// same-shaped buttons for.
const STROKE_WIDTH_MIN = 1;
const STROKE_WIDTH_MAX = 3;
function chartMarkStrokeSliderFill(value: number): CSSProperties {
  return { ["--fill" as string]: `${((value - STROKE_WIDTH_MIN) / (STROKE_WIDTH_MAX - STROKE_WIDTH_MIN)) * 100}%` } as CSSProperties;
}
/** Only `line`, `area` (its own boundary) and `rule` marks paint a stroke
 *  (`packages/charts/src/paint.ts`'s own `resolveStrokeWidth` callers) — the
 *  row stays visible so a reader always sees it exists, but dims with a
 *  reason on any other mark type. */
function chartMarkHasStroke(type: ChartsWorkbenchMark["type"]): boolean {
  return type === "line" || type === "area" || type === "rule";
}

// Arc "Labels" (`options.labels`, `@glyphcss/charts` — AGENTS.md's "Charts"
// own "Arc shape and callouts" paragraph): `"callout"` (the library
// default) draws leader lines out to a `name · NN%` label beside the disc;
// `"legend-only"` paints just the disc, leaving the legend row (unaffected
// either way) to carry the names. Arc-only — hidden for every other mark
// type, since no other mark reads this option.
const ARC_LABELS_TOGGLE = [
  {
    value: "callout",
    icon: <ToggleIcon><circle cx="6" cy="9" r="4" /><path d="M9.3 6.3 L13 3" /><line x1="13" y1="3" x2="14.5" y2="3" /></ToggleIcon>,
    label: "Callout",
    desc: "leader lines + name · percent beside the disc",
  },
  {
    value: "legend-only",
    icon: <ToggleIcon><circle cx="8" cy="6" r="4" /><rect x="4" y="12" width="8" height="1.6" fill="currentColor" stroke="none" /></ToggleIcon>,
    label: "Off",
    desc: "plain disc — the legend still names each slice",
  },
];

/**
 * Per-mark/per-series colour swatches (packet item 2), next to the mark's
 * own Type row. `series` is `@glyphcss/charts`' own `glyphChartSeriesPreview`
 * output for the WHOLE spec (`ChartsWorkbench.tsx`, computed on the same
 * styled spec a real render uses), filtered to this mark's own entries — so
 * every swatch's prefill and displayed colour is the exact one the render
 * paints, through the SAME `chartSeries`/`resolveSeriesColor` pipeline
 * (cross-mark `styleIndex`, a numeric `fill` resolving to one series, a
 * short colour array's cycled entry — see REVIEW-dock-colours-sliders-opus.md
 * P2-3/P2-4/P2-5). A single-series mark gets ONE swatch; a mark that splits
 * into series (categorical fill/stroke, arc slices, sankey source nodes,
 * funnel stages) gets one swatch PER SERIES, in the library's own order.
 * Editing any one series swatch materialises the WHOLE array (every other
 * series keeps its current — prefilled or overridden — colour) rather than
 * leaving a sparse array, so a later series's default never silently shifts
 * under an earlier edit.
 *
 * `s.color` is `null` under `Color: none` (`glyphChartSeriesPreview`'s own
 * `options.color`, NEW-8) — `swatchValue` below is the ONLY place that
 * falls back to `CHARTS_DEFAULT_SWATCH_COLOR` for display, so the
 * `<input type="color">` never receives `null`.
 *
 * NEW-5 (REVIEW-dock-colours-sliders-opus-round2.md): a series NAME an
 * EARLIER mark already used keeps that mark's colour — the library's own
 * name-keyed "first wins" pooling (`series.ts`'s `chartSeries`). Editing
 * such a swatch is honest (it never shows a colour the render doesn't
 * paint) but was previously unexplained: it snaps straight back with no
 * visible reason. Disabled with the reason on its title, the same idiom
 * `colorDisabled` already uses for `Color: none`.
 */
function ChartsMarkColorControls({ mark, index, series, colorDisabled, dispatch }: {
  mark: ChartsWorkbenchMark; index: number; series: readonly GlyphChartSeriesPreviewEntry[]; colorDisabled: boolean; dispatch: Dispatch<ChartsWorkbenchAction>;
}) {
  const markSeries = series.filter((s) => s.markIndex === index);
  const setColor = (color: string | readonly string[] | undefined) => dispatch({ type: "set-mark-color", id: mark.id, color });
  const swatchValue = (s: GlyphChartSeriesPreviewEntry | undefined) => s?.color ?? CHARTS_DEFAULT_SWATCH_COLOR;
  // The mark index of the EARLIEST series (across the whole chart, not
  // just this one) that already carries this name — `undefined` when this
  // mark's own occurrence is the first (or only) one.
  const earlierOwnerOf = (s: GlyphChartSeriesPreviewEntry) => series.find((other) => other.name === s.name && other.markIndex < index)?.markIndex;
  const reasonFor = (s: GlyphChartSeriesPreviewEntry | undefined): string | undefined => {
    if (colorDisabled) return "Color mode is off — pick a colour mode in the Output folder to see it painted.";
    const owner = s !== undefined ? earlierOwnerOf(s) : undefined;
    return owner !== undefined ? `Coloured by mark ${owner + 1} — this name's colour already comes from there.` : undefined;
  };
  if (markSeries.length <= 1) {
    const s = markSeries[0];
    const reason = reasonFor(s);
    return <div className="charts-mark-colors"><ColorSwatch label="Colour" value={swatchValue(s)} onChange={setColor} disabled={colorDisabled || reason !== undefined} disabledReason={reason} /></div>;
  }
  const current = Array.isArray(mark.color) ? mark.color : undefined;
  const paletteFor = (i: number) => current?.[i] ?? swatchValue(markSeries[i]);
  const setSeriesColor = (i: number, color: string) => setColor(markSeries.map((_, idx) => idx === i ? color : paletteFor(idx)));
  return <div className="charts-mark-colors">
    {markSeries.map((s, i) => {
      const reason = reasonFor(s);
      return <ColorSwatch key={s.name} label={s.name} value={paletteFor(i)} onChange={(color) => setSeriesColor(i, color)} disabled={colorDisabled || reason !== undefined} disabledReason={reason} />;
    })}
  </div>;
}

export function ChartsMarkCard({ mark, index, typeFits, series, colorDisabled, dispatch }: {
  mark: ChartsWorkbenchMark; index: number; typeFits: ChartsMarkTypeFitTable; series: readonly GlyphChartSeriesPreviewEntry[]; colorDisabled: boolean; dispatch: Dispatch<ChartsWorkbenchAction>;
}) {
  const fields = chartMarkFields(mark);
  const update = (patch: Partial<Omit<ChartsWorkbenchMark, "id">>) => dispatch({ type: "update-mark", id: mark.id, patch });
  // A type the data can't draw is disabled with its reason
  // (`chartsMarkTypeFit.ts`, the `mapDirectionLocked` idiom). The CURRENT
  // type always stays enabled, even when the table calls it unfit (a tray
  // sample, a hand-built link), so a card is never stranded on a disabled
  // button.
  const typeOptions = CHART_MARK_TYPE_TOGGLE.map((option) => {
    const fit = typeFits[option.value as GlyphChartMarkType];
    return fit.fits || option.value === mark.type ? option : { ...option, disabled: true, disabledReason: fit.reason };
  });
  return <div className="voice-card charts-mark-card">
    <div className="voice-controls">
      <div className="voice-head">
        <span className="voice-title">Mark {index + 1}</span>
      </div>
      <div className="voice-row charts-mark-row" data-row="type">
        <IconToggle groupTitle={`Mark ${index + 1} type`} options={typeOptions} value={mark.type}
          onChange={(type) => dispatch({ type: "set-mark-type", id: mark.id, markType: type as GlyphChartMarkType })} />
      </div>
      <ChartsMarkColorControls mark={mark} index={index} series={series} colorDisabled={colorDisabled} dispatch={dispatch} />
      {(() => {
        const hasStroke = chartMarkHasStroke(mark.type);
        const strokeWidth = mark.options.strokeWidth ?? 1;
        const setStrokeWidth = (next: number) => update({ options: { ...mark.options, strokeWidth: next as 1 | 2 | 3 } });
        return <label className={`voice-slider charts-mark-row${hasStroke ? "" : " is-disabled"}`} data-row="strokeWidth"
          title={hasStroke ? "Stroke width in cells." : "Only line, area, and rule marks have a stroke."}>
          <span>Stroke</span>
          <span className="voice-slider-track">
            <input type="range" min={STROKE_WIDTH_MIN} max={STROKE_WIDTH_MAX} step={1} disabled={!hasStroke}
              value={strokeWidth} style={chartMarkStrokeSliderFill(strokeWidth)}
              aria-label={`Mark ${index + 1} stroke width`}
              onChange={(e) => setStrokeWidth(Number(e.target.value))} />
          </span>
          <EditableReadout value={strokeWidth} min={STROKE_WIDTH_MIN} max={STROKE_WIDTH_MAX} integer disabled={!hasStroke}
            format={(v) => String(v)} onCommit={setStrokeWidth} />
        </label>;
      })()}
      {chartRelevantChannels(mark.type).map((channel) => <label className="voice-row charts-mark-row" key={channel}>
        <span>{channel}</span><span className="gx-select"><select aria-label={`Mark ${index + 1} ${channel}`} disabled={mark.type === "rule"} title={mark.type === "rule" ? "Rules use the numeric data as axis positions." : `${channel} channel`} value={mark.channels[channel] ?? ""} onChange={(event) => update({ channels: { ...mark.channels, [channel]: event.target.value } })}>
          <option value="">auto</option>
          {mark.channels[channel] && !fields.includes(mark.channels[channel]!) && <option value={mark.channels[channel]}>{mark.channels[channel]} (missing)</option>}
          {fields.map((field) => <option key={field}>{field}</option>)}
        </select></span>
      </label>)}
      <label className="voice-row charts-mark-row">
        <span>Transform</span><span className="gx-select"><select aria-label={`Mark ${index + 1} transform`} value={mark.transform} disabled={mark.type === "rule" || mark.type === "sankey" || mark.type === "funnel"} title={mark.type === "sankey" || mark.type === "funnel" ? "Sankey and funnel have no x/y scale to bin/stack/group against." : undefined} onChange={(event) => update({ transform: event.target.value as ChartsWorkbenchMark["transform"] })}>
          {CHART_TRANSFORMS.map((transform) => <option key={transform}>{transform}</option>)}
        </select></span>
      </label>
      {mark.type === "arc" && <div className="voice-row charts-mark-row">
        <span>Shape</span><div className="gx-toggle" role="group" aria-label={`Mark ${index + 1} arc shape`}>
          {[{ label: "Pie", radius: 0 }, { label: "Donut", radius: 0.5 }].map(({ label, radius }) => <button key={label} type="button" className={`gx-toggle-btn gx-toggle-text${(mark.options.innerRadius ?? 0) === radius ? " is-active" : ""}`} aria-pressed={(mark.options.innerRadius ?? 0) === radius} onClick={() => update({ options: { ...mark.options, innerRadius: radius } })}>{label}</button>)}
        </div>
      </div>}
      {mark.type === "arc" && <div className="voice-row charts-mark-row" data-row="labels">
        <span>Labels</span>
        <IconToggle groupTitle={`Mark ${index + 1} labels`} options={ARC_LABELS_TOGGLE} value={mark.options.labels ?? "callout"}
          onChange={(value) => update({ options: { ...mark.options, labels: value as "callout" | "legend-only" } })} />
      </div>}
      {mark.type === "rule" && <div className="voice-row charts-mark-row">
        <span>Axis</span><div className="gx-toggle" role="group" aria-label={`Mark ${index + 1} rule axis`}>
          {(["x", "y"] as const).map((axis) => <button key={axis} type="button" className={`gx-toggle-btn gx-toggle-text${(mark.options.axis ?? "y") === axis ? " is-active" : ""}`} aria-pressed={(mark.options.axis ?? "y") === axis} onClick={() => update({ options: { axis } })}>{axis}</button>)}
        </div>
      </div>}
    </div>
  </div>;
}
