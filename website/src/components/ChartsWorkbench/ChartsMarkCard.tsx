import { Fragment, useRef, useState, type Dispatch, type KeyboardEvent } from "react";
import {
  CHART_MARK_TYPES, CHART_TRANSFORMS, chartMarkFields, chartMarkTable, chartRelevantChannels, nextChartTableColumnName,
  type ChartsWorkbenchAction, type ChartsWorkbenchMark,
} from "./chartsWorkbenchState";

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

  const gridStyle = { gridTemplateColumns: `repeat(${table.columns.length}, minmax(6ch, 1fr)) 2ch` };
  return <div className="charts-grid-wrap">
    <div className="charts-grid" role="grid" aria-label={`Mark ${index + 1} data table`} style={gridStyle} ref={gridRef}>
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

      {table.rows.map((row, r) => <Fragment key={r}>
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
      </Fragment>)}

      <div className="charts-grid-footer" role="row">
        <button type="button" className="gw-code-panel__action charts-table-add-row" onClick={() => dispatch({ type: "add-row", id: mark.id })}>+ row</button>
        <button type="button" className="gw-code-panel__action charts-table-add" title="Add column" aria-label="Add column"
          onClick={() => dispatch({ type: "add-column", id: mark.id, column: nextChartTableColumnName(table.columns) })}>+ column</button>
      </div>
    </div>
  </div>;
}

export function ChartsMarkCard({ mark, index, dispatch }: { mark: ChartsWorkbenchMark; index: number; dispatch: Dispatch<ChartsWorkbenchAction> }) {
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
      <label className="voice-row charts-mark-row">
        <span>Type</span><span className="gx-select"><select aria-label={`Mark ${index + 1} type`} value={mark.type} onChange={(event) => update({ type: event.target.value as ChartsWorkbenchMark["type"], options: {} })}>
          {CHART_MARK_TYPES.map((type) => <option key={type}>{type}</option>)}
        </select></span>
      </label>
      <div className="voice-head">
        <label className="charts-mark-label" id={`charts-data-label-${mark.id}`}>Data</label>
        <button type="button" className="gw-code-panel__action" title={`Fill sample ${mark.type} data and channels`} onClick={() => dispatch({ type: "sample-mark", id: mark.id })}>sample</button>
      </div>
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
      {chartRelevantChannels(mark.type).map((channel) => <label className="voice-row charts-mark-row" key={channel}>
        <span>{channel}</span><span className="gx-select"><select aria-label={`Mark ${index + 1} ${channel}`} disabled={mark.type === "rule"} title={mark.type === "rule" ? "Rules use the numeric data as axis positions." : `${channel} channel`} value={mark.channels[channel] ?? ""} onChange={(event) => update({ channels: { ...mark.channels, [channel]: event.target.value } })}>
          <option value="">auto</option>
          {mark.channels[channel] && !fields.includes(mark.channels[channel]!) && <option value={mark.channels[channel]}>{mark.channels[channel]} (missing)</option>}
          {fields.map((field) => <option key={field}>{field}</option>)}
        </select></span>
      </label>)}
      <label className="voice-row charts-mark-row">
        <span>Transform</span><span className="gx-select"><select aria-label={`Mark ${index + 1} transform`} value={mark.transform} disabled={mark.type === "rule"} onChange={(event) => update({ transform: event.target.value as ChartsWorkbenchMark["transform"] })}>
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
