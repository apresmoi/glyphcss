import type { Dispatch, ReactNode } from "react";
import type { GlyphChartMarkType, GlyphChartSeriesPreviewEntry } from "@glyphcss/charts";
import {
  CHART_MARK_TYPES, CHART_TRANSFORMS, CHARTS_DEFAULT_SWATCH_COLOR, chartMarkFields, chartMarkTypeFits,
  chartRelevantChannels,
  type ChartsWorkbenchAction, type ChartsWorkbenchMark,
} from "./chartsWorkbenchState";
import { ColorSwatch } from "../InstrumentWorkbench/ColorSwatch";
import { IconToggle, ToggleIcon } from "../SynthWorkbench/synthKit";

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

export function ChartsMarkCard({ mark, index, series, colorDisabled, dispatch }: {
  mark: ChartsWorkbenchMark; index: number; series: readonly GlyphChartSeriesPreviewEntry[]; colorDisabled: boolean; dispatch: Dispatch<ChartsWorkbenchAction>;
}) {
  const fields = chartMarkFields(mark);
  const update = (patch: Partial<Omit<ChartsWorkbenchMark, "id">>) => dispatch({ type: "update-mark", id: mark.id, patch });
  // P3-6 (review fix, REVIEW-showcase-opus.md): `sankey`/`funnel` are dead
  // ends on a dataset with too few fields — disabled WITH A REASON rather
  // than left clickable into a raw ledger error. Recomputed against this
  // mark's OWN resolved fields (never a static list), so a genuinely
  // flow-shaped dataset (`energy-flow-sankey`, `ecommerce-conversion-
  // funnel`) enables them exactly like every other mark type.
  const typeOptions = CHART_MARK_TYPE_TOGGLE.map((option) => {
    const type = option.value as GlyphChartMarkType;
    if (chartMarkTypeFits(mark, type)) return option;
    const need = type === "sankey" ? "distinct source, target and value columns" : "distinct stage and value columns";
    return { ...option, disabled: true, disabledReason: `This dataset doesn't have ${need}.` };
  });
  return <div className="voice-card charts-mark-card">
    <div className="voice-controls">
      <div className="voice-head">
        <span className="voice-title">Mark {index + 1}</span>
      </div>
      <div className="voice-row charts-mark-row" data-row="type">
        <span>Type</span>
        <IconToggle groupTitle={`Mark ${index + 1} type`} options={typeOptions} value={mark.type}
          onChange={(type) => update({ type: type as ChartsWorkbenchMark["type"], options: {}, color: undefined })} />
      </div>
      <ChartsMarkColorControls mark={mark} index={index} series={series} colorDisabled={colorDisabled} dispatch={dispatch} />
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
      {mark.type === "rule" && <div className="voice-row charts-mark-row">
        <span>Axis</span><div className="gx-toggle" role="group" aria-label={`Mark ${index + 1} rule axis`}>
          {(["x", "y"] as const).map((axis) => <button key={axis} type="button" className={`gx-toggle-btn gx-toggle-text${(mark.options.axis ?? "y") === axis ? " is-active" : ""}`} aria-pressed={(mark.options.axis ?? "y") === axis} onClick={() => update({ options: { axis } })}>{axis}</button>)}
        </div>
      </div>}
    </div>
  </div>;
}
