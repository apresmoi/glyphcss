import { useRef, useState, type Dispatch, type KeyboardEvent, type ReactNode } from "react";
import type { GlyphChartSeriesPreviewEntry } from "@glyphcss/charts";
import {
  CHART_MARK_TYPES, CHART_TRANSFORMS, CHARTS_DEFAULT_SWATCH_COLOR, chartMarkFields, chartMarkTable,
  chartRelevantChannels, nextChartTableColumnName,
  type ChartsWorkbenchAction, type ChartsWorkbenchMark,
} from "./chartsWorkbenchState";
import { ColorSwatch } from "../InstrumentWorkbench/ColorSwatch";
import { IconToggle, ToggleIcon } from "../SynthWorkbench/synthKit";

// Mark-type toggle (owner packet item 3's own idiom, extended to the mark
// card: an icon per shape reads faster than a `<select>` of eleven names,
// same `gx-toggle` markup `ChartsDock.tsx`'s target/charset/color rows
// already use). Every icon is a small inline shape at the shared
// `ToggleIcon` size (16x16, `currentColor`, stroke 1.5) that reads as the
// chart it picks, never a letter or symbol standing in for one.
const CHART_MARK_TYPE_ICONS: Record<(typeof CHART_MARK_TYPES)[number], ReactNode> = {
  line: <ToggleIcon width={16} height={16} strokeWidth={1.5}><path d="M2 12 L6 6 L9 9 L14 3" /></ToggleIcon>,
  area: <ToggleIcon width={16} height={16} strokeWidth={1.5} fill="currentColor" fillOpacity={0.35}><path d="M2 12 L6 6 L9 9 L14 3 L14 13 L2 13 Z" /></ToggleIcon>,
  bar: (
    <ToggleIcon width={16} height={16} strokeWidth={1.5} fill="currentColor" stroke="none">
      <rect x="2.4" y="8" width="2.6" height="5.6" />
      <rect x="6.7" y="4" width="2.6" height="9.6" />
      <rect x="11" y="6.5" width="2.6" height="7.1" />
    </ToggleIcon>
  ),
  dot: (
    <ToggleIcon width={16} height={16} strokeWidth={1.5} fill="currentColor" stroke="none">
      <circle cx="4" cy="10.5" r="1.3" /><circle cx="8.2" cy="5" r="1.3" /><circle cx="11.5" cy="9.5" r="1.3" /><circle cx="13.3" cy="4" r="1.3" />
    </ToggleIcon>
  ),
  arc: <ToggleIcon width={16} height={16} strokeWidth={1.5}><circle cx="8" cy="8" r="6" /><path d="M8 2 L8 8 L13 11" /></ToggleIcon>,
  rect: <ToggleIcon width={16} height={16} strokeWidth={1.5}><rect x="3" y="3" width="10" height="10" /></ToggleIcon>,
  cell: <ToggleIcon width={16} height={16} strokeWidth={1.5}><rect x="2" y="2" width="12" height="12" /><line x1="8" y1="2" x2="8" y2="14" /><line x1="2" y1="8" x2="14" y2="8" /></ToggleIcon>,
  text: <ToggleIcon width={16} height={16} strokeWidth={1.5}><line x1="4" y1="4" x2="12" y2="4" /><line x1="8" y1="4" x2="8" y2="13" /></ToggleIcon>,
  rule: <ToggleIcon width={16} height={16} strokeWidth={1.5}><line x1="2" y1="8" x2="14" y2="8" strokeDasharray="2.4 1.6" /></ToggleIcon>,
  sankey: (
    <ToggleIcon width={16} height={16} strokeWidth={1.5}>
      <line x1="3" y1="3" x2="3" y2="13" strokeWidth={2.5} />
      <line x1="13" y1="2" x2="13" y2="6" strokeWidth={2.5} />
      <line x1="13" y1="9" x2="13" y2="14" strokeWidth={2.5} />
      <path d="M3 6 C8 6, 8 4, 13 4" /><path d="M3 10 C8 10, 8 11.5, 13 11.5" />
    </ToggleIcon>
  ),
  funnel: <ToggleIcon width={16} height={16} strokeWidth={1.5}><path d="M2 3 L14 3 L10 8 L10 13 L6 13 L6 8 Z" /></ToggleIcon>,
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

const DATA_VIEWS = [{ id: "table", label: "Table" }, { id: "json", label: "JSON" }] as const;

/**
 * Packet item 1's table rebuild — one CSS-GRID (`grid-template-columns:
 * repeat(N, minmax(6ch, 1fr)) 2ch`, the last track the row-remove column),
 * so every cell lives at an exact `(row, col)` grid coordinate instead of
 * an HTML `<table>`'s row-then-cell nesting — the previous `<table>` markup
 * is what let the per-row `×` drift out of alignment with its own row once
 * a column's content width differed from its header's. Header row = column
 * names (rename inline); add-row/add-column live in one FOOTER row instead
 * of a header `<th>`, so the header row holds only real columns. Numeric
 * cells right-align via `.is-numeric`. The grid's own intrinsic width
 * (never below N x 6ch) is what makes `.charts-grid-wrap`'s `overflow-x:
 * auto` produce real horizontal scrolling for a wide table instead of
 * squeezing every column unreadably thin.
 *
 * Keeps the exact reducer API from before (`chartMarkTable`/`setCell`/
 * `addRow`/`removeRow`/`addColumn`/`removeColumn`/`renameColumn`) — this is
 * a rendering rebuild, not a state rewrite — and the exact uncommitted-
 * EDITING-STRING pattern final-gate-2 (codex #5/#6) fixed: a cell/header
 * `<input>` is CONTROLLED off local component state while focused (keyed by
 * `${row}:${column}` for a cell, the column's own INDEX for a header — an
 * index survives a rename, where the old name-keyed scheme remounted the
 * input mid-edit) and commits (parsed, for cells) to the reducer only on
 * blur or Enter, never per keystroke.
 *
 * Keyboard navigation: Tab/Shift+Tab already move through cells in the
 * grid's own DOM order (header row, then each data row, left to right) —
 * no extra wiring needed. Arrow keys and Enter move the FOCUS between
 * cells via `data-row`/`data-col` coordinates on every `<input>` (header
 * row is `data-row="-1"`), independent of Tab order so a reader can
 * navigate like a spreadsheet without leaving the keyboard.
 */
function ChartsMarkTable({ mark, index, dispatch }: { mark: ChartsWorkbenchMark; index: number; dispatch: Dispatch<ChartsWorkbenchAction> }) {
  const table = chartMarkTable(mark);
  const [editingCell, setEditingCell] = useState<{ key: string; value: string } | null>(null);
  const [editingColumn, setEditingColumn] = useState<{ index: number; value: string } | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  if (!table.ok) return <p className="charts-error" role="alert">Invalid JSON — fix it in the JSON tab.</p>;

  const commitCell = (row: number, column: string, value: string) => {
    setEditingCell(null);
    dispatch({ type: "set-cell", id: mark.id, row, column, value });
  };
  const commitColumn = (column: string, next: string) => {
    setEditingColumn(null);
    if (next !== column) dispatch({ type: "rename-column", id: mark.id, column, next });
  };

  const focusCell = (row: number, col: number) => {
    const clampedRow = Math.max(-1, Math.min(row, table.rows.length - 1));
    const clampedCol = Math.max(0, Math.min(col, table.columns.length - 1));
    gridRef.current?.querySelector<HTMLInputElement>(`input[data-row="${clampedRow}"][data-col="${clampedCol}"]`)?.focus();
  };
  const onCellKeyDown = (event: KeyboardEvent<HTMLInputElement>, row: number, col: number) => {
    switch (event.key) {
      case "ArrowDown": event.preventDefault(); focusCell(row + 1, col); return;
      case "ArrowUp": event.preventDefault(); focusCell(row - 1, col); return;
      case "ArrowRight":
        if (event.currentTarget.selectionStart !== event.currentTarget.value.length) return;
        event.preventDefault(); focusCell(row, col + 1); return;
      case "ArrowLeft":
        if (event.currentTarget.selectionStart !== 0) return;
        event.preventDefault(); focusCell(row, col - 1); return;
      case "Enter": event.currentTarget.blur(); focusCell(row + 1, col); return;
    }
  };

  // `repeat(0, …)` is invalid CSS (`repeat()` requires an integer >= 1) and
  // drops the WHOLE `grid-template-columns` declaration — a zero-column
  // table (the JSON tab holding `[{}]`) used to fall back to the browser
  // default and every cell/row lost its grid placement. `Math.max(1, …)`
  // keeps the declaration valid; there is nothing to paint in that one
  // fallback track since `table.columns` is empty.
  const gridStyle = { gridTemplateColumns: `repeat(${Math.max(1, table.columns.length)}, minmax(6ch, 1fr)) 2ch` };
  return <div className="charts-grid-wrap">
    <div className="charts-grid" role="grid" aria-label={`Mark ${index + 1} data table`} style={gridStyle} ref={gridRef}>
      {/* ARIA 1.2: `grid` must own `row`/`rowgroup`, and `columnheader`/
       *  `gridcell` must be owned by a `row` — the CSS-grid rebuild (packet
       *  item 1) dropped this when it replaced `<table><thead><tr><th>`,
       *  which carried it implicitly. `display: contents` keeps every
       *  child's own grid placement (the row element itself is not a grid
       *  item) while still giving the accessibility tree a real `row`
       *  ancestor for each header/data cell. */}
      <div className="charts-grid-row" role="row" style={{ display: "contents" }}>
        {table.columns.map((column, c) => <div className="charts-grid-header" role="columnheader" key={`h-${c}`}>
          <input className="charts-table-header" data-row={-1} data-col={c}
            value={editingColumn?.index === c ? editingColumn.value : column} aria-label={`Rename column ${column}`}
            onChange={(event) => setEditingColumn({ index: c, value: event.target.value })}
            onFocus={() => setEditingColumn({ index: c, value: column })}
            onBlur={(event) => commitColumn(column, event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") { event.currentTarget.blur(); focusCell(0, c); }
              else if (event.key === "ArrowDown") { event.preventDefault(); focusCell(0, c); }
              else if (event.key === "ArrowRight" && event.currentTarget.selectionStart === event.currentTarget.value.length) { event.preventDefault(); focusCell(-1, c + 1); }
              else if (event.key === "ArrowLeft" && event.currentTarget.selectionStart === 0) { event.preventDefault(); focusCell(-1, c - 1); }
            }} />
          <button type="button" className="charts-table-remove" title={`Remove column ${column}`} aria-label={`Remove column ${column}`}
            onClick={() => dispatch({ type: "remove-column", id: mark.id, column })}>×</button>
        </div>)}
        <div className="charts-grid-header charts-grid-header--spacer" role="columnheader" aria-hidden="true" />
      </div>

      {table.rows.map((row, r) => <div className="charts-grid-row" role="row" style={{ display: "contents" }} key={r}>
        {table.columns.map((column, c) => {
          const key = `${r}:${column}`;
          const committed = row[column] ?? "";
          const isNumeric = typeof committed === "number";
          return <div className={`charts-grid-cell${isNumeric ? " is-numeric" : ""}`} role="gridcell" key={`${r}-${column}`}>
            <input value={editingCell?.key === key ? editingCell.value : String(committed)} aria-label={`Mark ${index + 1} row ${r + 1} ${column}`}
              data-row={r} data-col={c}
              onChange={(event) => setEditingCell({ key, value: event.target.value })}
              onFocus={() => setEditingCell({ key, value: String(committed) })}
              onBlur={(event) => commitCell(r, column, event.target.value)}
              onKeyDown={(event) => onCellKeyDown(event, r, c)} />
          </div>;
        })}
        <div className="charts-grid-cell charts-grid-cell--remove" role="gridcell">
          <button type="button" className="charts-table-remove" title={`Remove row ${r + 1}`} aria-label={`Remove row ${r + 1}`}
            onClick={() => dispatch({ type: "remove-row", id: mark.id, row: r })}>×</button>
        </div>
      </div>)}

      {/* N10a: ARIA 1.2's `row` requires only `columnheader`/`gridcell`/
       *  `rowheader` children — this row held two bare `<button>`s with
       *  neither, the exact `aria-required-children` violation the
       *  original F7 finding named and this file's other two row kinds
       *  (header, data) already fixed. `display: contents` keeps each
       *  button's own grid placement (it isn't a grid item itself) while
       *  giving the accessibility tree a real `gridcell` ancestor. */}
      <div className="charts-grid-footer" role="row">
        <div role="gridcell" style={{ display: "contents" }}>
          <button type="button" className="gw-code-panel__action charts-table-add-row" onClick={() => dispatch({ type: "add-row", id: mark.id })}>+ row</button>
        </div>
        <div role="gridcell" style={{ display: "contents" }}>
          <button type="button" className="gw-code-panel__action charts-table-add" title="Add column" aria-label="Add column"
            onClick={() => dispatch({ type: "add-column", id: mark.id, column: nextChartTableColumnName(table.columns) })}>+ column</button>
        </div>
      </div>
    </div>
  </div>;
}

export function ChartsMarkCard({ mark, index, series, colorDisabled, dispatch }: {
  mark: ChartsWorkbenchMark; index: number; series: readonly GlyphChartSeriesPreviewEntry[]; colorDisabled: boolean; dispatch: Dispatch<ChartsWorkbenchAction>;
}) {
  const fields = chartMarkFields(mark);
  const [dataView, setDataView] = useState<typeof DATA_VIEWS[number]["id"]>("table");
  const update = (patch: Partial<Omit<ChartsWorkbenchMark, "id">>) => dispatch({ type: "update-mark", id: mark.id, patch });
  return <div className="voice-card charts-mark-card">
    <div className="voice-controls">
      <div className="voice-head">
        <span className="voice-title">Mark {index + 1}</span>
        <span className="voice-head-right">
          <button type="button" className="voice-remove" onClick={() => dispatch({ type: "remove-mark", id: mark.id })} title={`Remove mark ${index + 1}`} aria-label={`Remove mark ${index + 1}`}>×</button>
        </span>
      </div>
      <div className="voice-row charts-mark-row" data-row="type">
        <span>Type</span>
        <IconToggle groupTitle={`Mark ${index + 1} type`} options={CHART_MARK_TYPE_TOGGLE} value={mark.type}
          onChange={(type) => update({ type: type as ChartsWorkbenchMark["type"], options: {}, color: undefined })} />
      </div>
      <ChartsMarkColorControls mark={mark} index={index} series={series} colorDisabled={colorDisabled} dispatch={dispatch} />
      <div className="voice-head">
        <label className="charts-mark-label" id={`charts-data-label-${mark.id}`}>Data</label>
        <button type="button" className="gw-code-panel__action" title={`Fill sample ${mark.type} data and channels`} onClick={() => dispatch({ type: "sample-mark", id: mark.id })}>sample</button>
      </div>
      {/* View data disclosure: the table/JSON tabs below are real editing
       *  surfaces a reader rarely needs open, so they stay collapsed until
       *  asked for (native `<details>` — no state to wire, nothing
       *  persisted to the URL) rather than always occupying the card. */}
      <details className="charts-mark-data-details">
        <summary className="charts-mark-data-summary">View data ▸</summary>
        <div className="gx-toggle charts-data-tabs" role="tablist" aria-labelledby={`charts-data-label-${mark.id}`}>
          {DATA_VIEWS.map((view) => <button type="button" key={view.id} role="tab" id={`charts-data-${view.id}-tab-${mark.id}`}
            aria-selected={dataView === view.id} aria-controls={`charts-data-${view.id}-${mark.id}`}
            className={`gx-toggle-btn gx-toggle-text${dataView === view.id ? " is-active" : ""}`}
            onClick={() => setDataView(view.id)}>{view.label}</button>)}
        </div>
        <div role="tabpanel" id={`charts-data-table-${mark.id}`} aria-labelledby={`charts-data-table-tab-${mark.id}`} hidden={dataView !== "table"}>
          <ChartsMarkTable mark={mark} index={index} dispatch={dispatch} />
        </div>
        <div role="tabpanel" id={`charts-data-json-${mark.id}`} aria-labelledby={`charts-data-json-tab-${mark.id}`} hidden={dataView !== "json"}>
          <textarea id={`charts-data-${mark.id}`} className="charts-mark-data" aria-label={`Mark ${index + 1} data JSON`} value={mark.dataText} onChange={(event) => update({ dataText: event.target.value })} spellCheck={false} />
        </div>
      </details>
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
