import { useState, type Dispatch } from "react";
import {
  CHART_MARK_TYPES, CHART_TRANSFORMS, chartMarkFields, chartMarkTable, chartRelevantChannels, nextChartTableColumnName,
  type ChartsWorkbenchAction, type ChartsWorkbenchMark,
} from "./chartsWorkbenchState";

const DATA_VIEWS = [{ id: "table", label: "Table" }, { id: "json", label: "JSON" }] as const;

/**
 * Packet item 7's table editor — the PRIMARY data view (default tab), one
 * `<input>` per cell dispatching straight to the reducer's own `setCell`/
 * `addRow`/`removeRow`/`addColumn`/`removeColumn`/`renameColumn` actions
 * (`chartsWorkbenchState.ts`), so the table and the JSON textarea below are
 * exactly one piece of state (`mark.dataText`) viewed two ways.
 *
 * Final-gate-2 review (codex #5/#6): a cell/header `<input>` used to be
 * CONTROLLED straight off the committed, already-PARSED value and dispatch
 * on every keystroke — so typing "3." parsed to the number `3`, redisplayed
 * as "3", and the next keystroke "5" landed after that "3" ("35", not
 * "3.5"); and a column-rename input was keyed by the column's OWN NAME,
 * which the same immediate dispatch changed on every keystroke, remounting
 * the input (and its focus) out from under the person still typing. Both
 * are fixed the same way: an uncommitted EDITING STRING lives in local
 * component state, keyed by `${row}:${column}` (cells) or the column's
 * INDEX (header, stable across a rename), shown instead of the committed
 * value while it exists, and committed to the reducer (parsed, for cells)
 * only on blur or Enter — never per keystroke.
 */
function ChartsMarkTable({ mark, index, dispatch }: { mark: ChartsWorkbenchMark; index: number; dispatch: Dispatch<ChartsWorkbenchAction> }) {
  const table = chartMarkTable(mark);
  const [editingCell, setEditingCell] = useState<{ key: string; value: string } | null>(null);
  const [editingColumn, setEditingColumn] = useState<{ index: number; value: string } | null>(null);
  if (!table.ok) return <p className="charts-error" role="alert">Invalid JSON — fix it in the JSON tab.</p>;
  const commitCell = (row: number, column: string, value: string) => {
    setEditingCell(null);
    dispatch({ type: "set-cell", id: mark.id, row, column, value });
  };
  const commitColumn = (column: string, next: string) => {
    setEditingColumn(null);
    if (next !== column) dispatch({ type: "rename-column", id: mark.id, column, next });
  };
  return <div className="charts-table-wrap">
    <table className="charts-table">
      <thead>
        <tr>
          {table.columns.map((column, c) => <th key={c}>
            <input className="charts-table-header" value={editingColumn?.index === c ? editingColumn.value : column} aria-label={`Rename column ${column}`}
              onChange={(event) => setEditingColumn({ index: c, value: event.target.value })}
              onFocus={() => setEditingColumn({ index: c, value: column })}
              onBlur={(event) => commitColumn(column, event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />
            <button type="button" className="charts-table-remove" title={`Remove column ${column}`} aria-label={`Remove column ${column}`}
              onClick={() => dispatch({ type: "remove-column", id: mark.id, column })}>×</button>
          </th>)}
          <th><button type="button" className="charts-table-add" title="Add column" aria-label="Add column"
            onClick={() => dispatch({ type: "add-column", id: mark.id, column: nextChartTableColumnName(table.columns) })}>+</button></th>
        </tr>
      </thead>
      <tbody>
        {table.rows.map((row, r) => <tr key={r}>
          {table.columns.map((column) => {
            const key = `${r}:${column}`;
            const committed = String(row[column] ?? "");
            return <td key={column}>
              <input value={editingCell?.key === key ? editingCell.value : committed} aria-label={`Mark ${index + 1} row ${r + 1} ${column}`}
                onChange={(event) => setEditingCell({ key, value: event.target.value })}
                onFocus={() => setEditingCell({ key, value: committed })}
                onBlur={(event) => commitCell(r, column, event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />
            </td>;
          })}
          <td><button type="button" className="charts-table-remove" title={`Remove row ${r + 1}`} aria-label={`Remove row ${r + 1}`}
            onClick={() => dispatch({ type: "remove-row", id: mark.id, row: r })}>×</button></td>
        </tr>)}
      </tbody>
    </table>
    <button type="button" className="gw-code-panel__action charts-table-add-row" onClick={() => dispatch({ type: "add-row", id: mark.id })}>+ row</button>
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
