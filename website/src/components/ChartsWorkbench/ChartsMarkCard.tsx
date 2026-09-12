import type { Dispatch } from "react";
import {
  CHART_CHANNELS, CHART_MARK_TYPES, CHART_TRANSFORMS, chartMarkFields,
  type ChartsWorkbenchAction, type ChartsWorkbenchMark,
} from "./chartsWorkbenchState";

export function ChartsMarkCard({ mark, index, dispatch }: { mark: ChartsWorkbenchMark; index: number; dispatch: Dispatch<ChartsWorkbenchAction> }) {
  const fields = chartMarkFields(mark);
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
        <label htmlFor={`charts-data-${mark.id}`} className="charts-mark-label">Data · JSON</label>
        <button type="button" className="gw-code-panel__action" title={`Fill sample ${mark.type} data and channels`} onClick={() => dispatch({ type: "sample-mark", id: mark.id })}>sample</button>
      </div>
      <textarea id={`charts-data-${mark.id}`} className="charts-mark-data" aria-label={`Mark ${index + 1} data`} value={mark.dataText} onChange={(event) => update({ dataText: event.target.value })} spellCheck={false} />
      {CHART_CHANNELS.map((channel) => <label className="voice-row charts-mark-row" key={channel}>
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
