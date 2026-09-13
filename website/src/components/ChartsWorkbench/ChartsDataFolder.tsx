import { useEffect, useMemo, useState, type ChangeEvent, type Dispatch } from "react";
import { createPortal } from "react-dom";
import type { GlyphChartMarkType } from "@glyphcss/charts";
import { FILTER_OPERATORS, PIPELINE_STEP_KINDS, type PipelineStep } from "../../lib/dataPipeline";
import {
  CHARTS_CUSTOM_MAX_BYTES, CHARTS_DATASETS, profileChartsData, resolveChartsDataRows, topChartsRecommendation,
  type ChartsRecommendedChannels, type ChartsWorkbenchAction, type ChartsWorkbenchDataState,
} from "./chartsWorkbenchState";

/** P2-5: refuse a paste/file over the cap with an inline message rather
 *  than silently accepting it — a multi-megabyte accidental paste used to
 *  ride straight into `dataText`/the `?c=` envelope. */
function customSizeErrorFor(bytes: number): string | null {
  if (bytes <= CHARTS_CUSTOM_MAX_BYTES) return null;
  return `Custom data must be under ${Math.round(CHARTS_CUSTOM_MAX_BYTES / 1024)} KB (this is ${Math.ceil(bytes / 1024)} KB).`;
}

const CUSTOM_OPTION = "__custom__";

function defaultStepFor(kind: PipelineStep["kind"]): PipelineStep {
  switch (kind) {
    case "select": return { kind: "select", path: "" };
    case "flatten": return { kind: "flatten" };
    case "pivotLonger": return { kind: "pivotLonger", idColumns: [] };
    case "pivotWider": return { kind: "pivotWider", keyColumn: "", valueColumn: "" };
    case "filter": return { kind: "filter", column: "", operator: "==", value: "" };
    case "derive": return { kind: "derive", column: "", expression: "" };
    case "sort": return { kind: "sort", column: "" };
    case "limit": return { kind: "limit", count: 100 };
    case "parseDate": return { kind: "parseDate", column: "" };
  }
}

/** Per-`PipelineStep`-kind field editor — plain text/select inputs, no
 *  lil-gui (this whole folder is one portal). `patch` merges into the
 *  step at its own index; the parent owns the array. */
function PipelineStepFields({ step, patch }: { step: PipelineStep; patch: (next: Partial<PipelineStep>) => void }) {
  switch (step.kind) {
    case "select":
      return <input className="charts-pipeline-input" placeholder="path, e.g. items[*]" value={step.path} onChange={(e) => patch({ path: e.target.value })} />;
    case "flatten":
      return null;
    case "pivotLonger":
      return <>
        <input className="charts-pipeline-input" placeholder="id columns (comma-separated)" value={step.idColumns.join(",")}
          onChange={(e) => patch({ idColumns: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />
        <input className="charts-pipeline-input" placeholder="key column (default: key)" value={step.keyColumn ?? ""} onChange={(e) => patch({ keyColumn: e.target.value || undefined })} />
        <input className="charts-pipeline-input" placeholder="value column (default: value)" value={step.valueColumn ?? ""} onChange={(e) => patch({ valueColumn: e.target.value || undefined })} />
      </>;
    case "pivotWider":
      return <>
        <input className="charts-pipeline-input" placeholder="key column" value={step.keyColumn} onChange={(e) => patch({ keyColumn: e.target.value })} />
        <input className="charts-pipeline-input" placeholder="value column" value={step.valueColumn} onChange={(e) => patch({ valueColumn: e.target.value })} />
      </>;
    case "filter":
      return <>
        <input className="charts-pipeline-input" placeholder="column" value={step.column} onChange={(e) => patch({ column: e.target.value })} />
        <select className="charts-pipeline-select" value={step.operator} onChange={(e) => patch({ operator: e.target.value as typeof step.operator })}>
          {FILTER_OPERATORS.map((op) => <option key={op}>{op}</option>)}
        </select>
        <input className="charts-pipeline-input" placeholder="value" value={step.value} onChange={(e) => patch({ value: e.target.value })} />
      </>;
    case "derive":
      return <>
        <input className="charts-pipeline-input" placeholder="new column" value={step.column} onChange={(e) => patch({ column: e.target.value })} />
        <input className="charts-pipeline-input" placeholder="expression, e.g. abs(a - b)" value={step.expression} onChange={(e) => patch({ expression: e.target.value })} />
      </>;
    case "sort":
      return <>
        <input className="charts-pipeline-input" placeholder="column" value={step.column} onChange={(e) => patch({ column: e.target.value })} />
        <select className="charts-pipeline-select" value={step.direction ?? "asc"} onChange={(e) => patch({ direction: e.target.value as "asc" | "desc" })}>
          <option value="asc">asc</option><option value="desc">desc</option>
        </select>
      </>;
    case "limit":
      return <input className="charts-pipeline-input" type="number" min={0} value={step.count} onChange={(e) => patch({ count: Number(e.target.value) })} />;
    case "parseDate":
      return <>
        <input className="charts-pipeline-input" placeholder="column" value={step.column} onChange={(e) => patch({ column: e.target.value })} />
        <input className="charts-pipeline-input" placeholder="format, e.g. MM/DD/YYYY (optional)" value={step.format ?? ""} onChange={(e) => patch({ format: e.target.value || undefined })} />
      </>;
  }
}

function ChartsPipelineEditor({ pipeline, onChange }: { pipeline: readonly PipelineStep[]; onChange: (next: readonly PipelineStep[]) => void }) {
  const addStep = () => onChange([...pipeline, defaultStepFor("filter")]);
  const setStepKind = (i: number, kind: PipelineStep["kind"]) => onChange(pipeline.map((s, idx) => idx === i ? defaultStepFor(kind) : s));
  const patchStep = (i: number, patch: Partial<PipelineStep>) => onChange(pipeline.map((s, idx) => idx === i ? { ...s, ...patch } as PipelineStep : s));
  const removeStep = (i: number) => onChange(pipeline.filter((_, idx) => idx !== i));
  const moveStep = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= pipeline.length) return;
    const next = [...pipeline];
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
  };
  return <div className="charts-pipeline">
    {pipeline.map((step, i) => <div className="charts-pipeline-step" key={i}>
      <select className="charts-pipeline-select" aria-label={`Step ${i + 1} kind`} value={step.kind} onChange={(e) => setStepKind(i, e.target.value as PipelineStep["kind"])}>
        {PIPELINE_STEP_KINDS.map((kind) => <option key={kind}>{kind}</option>)}
      </select>
      <PipelineStepFields step={step} patch={(patch) => patchStep(i, patch)} />
      <span className="charts-pipeline-step-actions">
        <button type="button" className="charts-table-remove" title="Move step up" aria-label={`Move step ${i + 1} up`} disabled={i === 0} onClick={() => moveStep(i, -1)}>↑</button>
        <button type="button" className="charts-table-remove" title="Move step down" aria-label={`Move step ${i + 1} down`} disabled={i === pipeline.length - 1} onClick={() => moveStep(i, 1)}>↓</button>
        <button type="button" className="charts-table-remove" title={`Remove step ${i + 1}`} aria-label={`Remove step ${i + 1}`} onClick={() => removeStep(i)}>×</button>
      </span>
    </div>)}
    <button type="button" className="gw-code-panel__action charts-table-add-row" onClick={addStep}>+ step</button>
  </div>;
}

/**
 * The dataset card in the left rail (AGENTS.md's "Charts" — "Data layer"):
 * synth's rail is the voice/model picker, and a dataset is this page's own
 * "model" — a stock dataset (+ "Custom…" upload/paste), the transform
 * pipeline, and a ranked-recommendation readout with one-click Apply. Built
 * from real DOM structure (grids, per-kind field sets) rather than
 * individual lil-gui controls, which have no equivalent for any of it.
 *
 * The dataset `<select>` itself renders into `selectSlot` — the rail
 * header's own `action` slot (`ChartsWorkbench.tsx`), mirroring
 * `InstrumentRail`'s synth precedent of a header action beside the title —
 * via a plain `createPortal`, so this component keeps owning every piece of
 * state the picker needs (`customText`/`customHint`, the re-select-Custom…
 * size check) with no change to that logic, only to where the control
 * paints. `selectSlot` omitted/`null` (a bare `<ChartsDataFolder>` mount,
 * as this file's own direct-mount tests do) renders the select inline
 * instead, so the component stays self-contained when used standalone.
 */
export function ChartsDataFolder({ data, dispatch, selectSlot }: { data: ChartsWorkbenchDataState; dispatch: Dispatch<ChartsWorkbenchAction>; selectSlot?: HTMLElement | null }) {
  // F3: seeded from `data.source` itself, not `useState("")` — a shared
  // link decodes `data.source` (`ChartsWorkbench.tsx` gates the first
  // render on that decode) BEFORE this component ever mounts, so a lazy
  // initializer reading it is unambiguous and needs no effect for the
  // common (mount) case. The `useEffect` below covers the one remaining
  // gap: `data.source` changing WITHOUT going through this component's own
  // `applyCustomText` (there is no such path today, but a local mirror that
  // silently drifts from its source of truth is exactly this bug's shape).
  const [customText, setCustomText] = useState(() => data.source?.kind === "custom" ? data.source.raw : "");
  const [customHint, setCustomHint] = useState<{ filename?: string; mimeType?: string }>(() =>
    data.source?.kind === "custom" ? { filename: data.source.filename, mimeType: data.source.mimeType } : {});
  const [customSizeError, setCustomSizeError] = useState<string | null>(null);
  useEffect(() => {
    if (data.source?.kind !== "custom") return;
    setCustomText(data.source.raw);
    setCustomHint({ filename: data.source.filename, mimeType: data.source.mimeType });
  }, [data.source]);

  const selectValue = data.source === null ? "" : data.source.kind === "dataset" ? data.source.id : CUSTOM_OPTION;

  const onSelectDataset = (value: string) => {
    if (value === "") { dispatch({ type: "set-data-source", source: null }); return; }
    if (value === CUSTOM_OPTION) {
      // N2/A2: mirror the paste/upload handler's own size check here too —
      // the reducer (`set-data-source`) is the actual enforcement backstop
      // that makes a bypass impossible, and the header-level readout above
      // (not this panel, which stays unmounted on this path since `isCustom`
      // never flips true) is what shows the SAME refusal, so re-selecting
      // "Custom…" after a refused paste is never silent about why that
      // paste didn't come back.
      const sizeError = customSizeErrorFor(new TextEncoder().encode(customText).length);
      setCustomSizeError(sizeError);
      if (sizeError) return;
      dispatch({ type: "set-data-source", source: { kind: "custom", raw: customText, ...customHint } });
      return;
    }
    dispatch({ type: "set-data-source", source: { kind: "dataset", id: value } });
  };

  // P2-5: a paste/upload over `CHARTS_CUSTOM_MAX_BYTES` is refused with an
  // inline message rather than silently accepted — the reader still sees
  // (and can trim) what they typed/picked, but nothing is dispatched, so an
  // accidentally-huge payload never reaches `dataText` or the `?c=` link.
  const applyCustomText = (raw: string, hint: { filename?: string; mimeType?: string }) => {
    setCustomText(raw); setCustomHint(hint);
    const sizeError = customSizeErrorFor(new TextEncoder().encode(raw).length);
    setCustomSizeError(sizeError);
    if (sizeError) return;
    dispatch({ type: "set-data-source", source: { kind: "custom", raw, ...hint } });
  };
  const onFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const sizeError = customSizeErrorFor(file.size);
    if (sizeError) { setCustomSizeError(sizeError); event.target.value = ""; return; }
    const reader = new FileReader();
    reader.onload = () => applyCustomText(String(reader.result ?? ""), { filename: file.name, mimeType: file.type || undefined });
    reader.readAsText(file);
  };

  const activeDatasetSource = data.source;
  const activeDataset = activeDatasetSource?.kind === "dataset" ? CHARTS_DATASETS.find((d) => d.id === activeDatasetSource.id) : undefined;
  const isCustom = data.source?.kind === "custom";

  const resolution = useMemo(() => data.source ? resolveChartsDataRows(data.source, data.pipeline) : null, [data.source, data.pipeline]);
  const profiled = useMemo(() => resolution?.ok ? profileChartsData(resolution.rows) : null, [resolution]);

  // F1: a STOCK dataset's own curated `recommended` mapping — never the
  // profiler's top pick — is what Apply commits; a custom source (no
  // curated mapping) still falls back to the profiler's own ranking. N1:
  // the curated mapping is only trusted when it resolves against the
  // ALREADY-pipelined `profiled.profile` — a column-changing step falls
  // back to the profiler's own top pick instead (`top.fallbackNotice`).
  const top = useMemo(
    () => profiled ? topChartsRecommendation(resolution?.ok ? resolution.dataset : undefined, profiled.profile, profiled.recommendations) : null,
    [profiled, resolution],
  );
  const runnerUps = useMemo(() => {
    if (!profiled || !top) return [];
    const sameAsTop = (rec: (typeof profiled.recommendations)[number]) =>
      rec.mark === top.mark && rec.channels.x === top.channels.x && rec.channels.y === top.channels.y
      && rec.channels.fill === top.channels.fill && rec.channels.label === top.channels.label;
    return profiled.recommendations.filter((rec) => !sameAsTop(rec)).slice(0, 3);
  }, [profiled, top]);

  // A1 (N1 residue): a recommendation with no channel names at all
  // (`dataProfile.ts`'s fallback `{ mark: "bar", channels: {} }`) is an
  // honest "nothing to plot" answer, not something Apply should commit.
  const hasChannels = top ? Object.values(top.channels).some((value) => value !== undefined) : false;

  // N4: `pipeline` is the recommendation's own EXTRA reshape (present only
  // for the multi-numeric long-format rewrite) — threaded through so
  // `apply-data` runs it on top of the already-resolved rows before
  // building the mark.
  const apply = (mark: GlyphChartMarkType, channels: ChartsRecommendedChannels, pipeline?: readonly PipelineStep[]) =>
    dispatch({ type: "apply-data", mark, channels, pipeline });

  const selectField = (
    <span className="gx-select charts-dataset-select">
      <select aria-label="Dataset" value={selectValue} onChange={(e) => onSelectDataset(e.target.value)}>
        <option value="">— none —</option>
        {CHARTS_DATASETS.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
        <option value={CUSTOM_OPTION}>Custom…</option>
      </select>
    </span>
  );

  return <div className="charts-data-folder">
    {selectSlot
      ? createPortal(selectField, selectSlot)
      : <label className="voice-row charts-mark-row"><span>Dataset</span>{selectField}</label>}

    {/* A2: rendered here, OUTSIDE the `isCustom`-gated panel below, because
     *  the dropdown path (re-selecting "Custom…" while the current source
     *  is a stock dataset or none) refuses WITHOUT the source ever becoming
     *  custom — `isCustom` stays false, so a copy of this message nested
     *  inside that panel can never render for that path. The paste/upload
     *  handlers set the same state and are already custom when they fire,
     *  so one readout here covers both. */}
    {customSizeError && <p className="charts-error" role="alert">{customSizeError}</p>}

    {activeDataset && <div className="charts-data-info">
      <p className="charts-readout">{activeDataset.description}</p>
      <p className="charts-readout"><a href={activeDataset.source.url} target="_blank" rel="noreferrer">{activeDataset.source.name}</a> — {activeDataset.source.licence}</p>
    </div>}

    {isCustom && <div className="charts-data-custom">
      <input type="file" aria-label="Upload data file" accept=".csv,.tsv,.json,text/csv,text/tab-separated-values,application/json" onChange={onFile} />
      {customHint.filename && <p className="charts-readout">{customHint.filename}</p>}
      <textarea className="charts-mark-data" aria-label="Paste CSV/TSV/JSON" placeholder="Paste CSV, TSV, or JSON…"
        value={customText} onChange={(e) => applyCustomText(e.target.value, customHint)} spellCheck={false} />
    </div>}

    {data.source && <>
      <p className="charts-mark-label">Pipeline</p>
      <ChartsPipelineEditor pipeline={data.pipeline} onChange={(pipeline) => dispatch({ type: "set-pipeline", pipeline })} />
    </>}

    {/* P2-5: an omitted custom source resolves to a structured error
     *  (`resolveChartsDataRows`) that this same readout already shows —
     *  no separate UI needed for "this link's data isn't here". */}
    {resolution && !resolution.ok && <p className="charts-error" role="alert">{resolution.error}</p>}
    {top && <div className="charts-data-recommend">
      {/* N1: shown only when the curated mapping didn't survive the
       *  pipeline's own column changes — the reader gets an explanation
       *  for why the readout below isn't the dataset's usual chart,
       *  instead of a silently different (or, before this fix, silently
       *  EMPTY) recommendation. */}
      {top.fallbackNotice && <p className="charts-readout" role="status">{top.fallbackNotice}</p>}
      <p className="charts-readout">Recommended: <strong>{top.mark}</strong> — {top.reason}</p>
      {/* A1 (N1 residue): a channel-less recommendation (`channels: {}`,
       *  `dataProfile.ts`'s own "No obvious numeric or date column found"
       *  bar) is an honest ANSWER, not a chart to draw — Apply committing
       *  it painted a mark with 0 ink and no on-screen sign anything went
       *  wrong beyond the reason text already above. Disabling Apply here
       *  (rather than letting `apply-data` build an empty mark) means the
       *  reader's PREVIOUS chart, if any, stays on screen instead of being
       *  replaced with a blank one. */}
      <button type="button" className="gw-code-panel__action" disabled={!hasChannels}
        title={hasChannels ? undefined : "No chart channels to apply — the reason above explains why."}
        onClick={() => apply(top.mark, top.channels, top.pipeline)}>Apply</button>
      {runnerUps.length > 0 && <ul className="charts-data-runnerups">
        {runnerUps.map((rec, i) => <li key={i}>
          <button type="button" className="charts-data-runnerup" onClick={() => apply(rec.mark, rec.channels, rec.pipeline)}>{rec.mark}: {rec.reason}</button>
        </li>)}
      </ul>}
    </div>}
  </div>;
}
