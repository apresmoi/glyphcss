import { findCharts3dDataset } from "../data/chart3d";
import { findChartsDataset } from "../data";
import { profileRows } from "../tabular/dataProfile";
import type { TabularRow } from "../tabular/tabularParse";
import type { ChartsWorkbenchState } from "./chartsSpec";
import {
  chartsFitTableFromRows,
  chartsSurfaceFitFromRecords,
  chartsScatter3dFitFromRecords,
  chartsBars3dFitFromRecords,
  chartsLine3dFitFromRecords,
  resolveCharts3dView,
  type Charts3dChannels,
  type Charts3dSource,
  type Charts3dViewState,
  type Charts3dFitTable,
} from "./chartsWorkbench3d";

export function charts3dTable(source: Charts3dSource) {
  if (source.kind === "inline")
    return { rows: source.rows, channels: source.channels as Charts3dChannels, markType: source.markType };
  const dataset = findCharts3dDataset(source.id);
  if (dataset?.markType !== "scatter3d" && dataset?.markType !== "bars3d") return null;
  const channels = source.channels ?? dataset.channels ?? { x: "x", y: "y", z: "z" };
  // Bundled table presets use named fields; function channels aren't editable fields.
  if (typeof channels.x !== "string" || typeof channels.y !== "string" || typeof channels.z !== "string") return null;
  return {
    rows: dataset.data as readonly TabularRow[],
    channels: channels as Charts3dChannels,
    markType: dataset.markType,
  };
}

export function charts3dSourceWithChannel(
  source: Charts3dSource,
  channel: keyof Charts3dChannels,
  value: string,
): Charts3dSource {
  const table = charts3dTable(source);
  if (!table) return source;
  const channels: { x: string; y: string; z: string; series?: string; xLabel?: string; yLabel?: string } = {
    ...table.channels,
    [channel]: value || undefined,
  };
  // Changing a numeric position must not leave the old category label attached.
  if (channel === "x") delete channels.xLabel;
  if (channel === "y") delete channels.yLabel;
  return { ...source, channels } as Charts3dSource;
}

export function charts3dFieldControls(view: Charts3dViewState) {
  const table = charts3dTable(view.source);
  if (!table) return [];
  const columns = profileRows(table.rows).columns;
  const channels: (keyof Charts3dChannels)[] = ["x", "y", "z"];
  if (table.markType === "scatter3d") channels.push("series");
  if (table.markType === "bars3d") channels.push("xLabel", "yLabel");
  return channels.map((channel) => ({
    channel,
    value: (table.channels as Charts3dChannels)[channel] ?? "",
    options: columns
      .filter((column) => !["x", "y", "z"].includes(channel) || column.type === "number" || column.type === "integer")
      .map((column) => {
        const candidate = resolveCharts3dView({
          ...view,
          source: charts3dSourceWithChannel(view.source, channel, column.name),
        });
        return { value: column.name, disabled: !candidate.ok, reason: candidate.ok ? undefined : candidate.error };
      }),
  }));
}

/** Type changes keep the current table and usable bindings, including in 3D. */
export function charts3dFitsForState(
  state: Pick<ChartsWorkbenchState, "data" | "marks" | "dimension" | "chart3d">,
): Charts3dFitTable {
  const current = state.dimension === "3d" ? charts3dTable(state.chart3d.source) : null;
  const dataset = state.data.source?.kind === "dataset" ? findChartsDataset(state.data.source.id) : undefined;
  const info = dataset ?? (state.data.source?.kind === "remote" ? state.data.source : undefined);
  let fits = chartsFitTableFromRows(state.data, state.marks);
  let title = info?.title;
  let description = info?.description;
  let attribution = info?.source;
  if (state.dimension === "3d") {
    const resolved = resolveCharts3dView(state.chart3d);
    title = resolved.ok ? resolved.resolved.title : undefined;
    description = resolved.ok ? resolved.resolved.description : undefined;
    attribution = resolved.ok ? (resolved.resolved.source ?? undefined) : undefined;
    // A gridded/parametric preset has no tabular columns; don't switch to stale 2D data.
    if (!current)
      return Object.fromEntries(
        Object.entries(fits).map(([type]) => [
          type,
          { fits: false, reason: "Choose a table dataset to use this chart type." },
        ]),
      ) as Charts3dFitTable;
    fits = {
      surface: chartsSurfaceFitFromRecords(current.rows, title ?? "Custom surface"),
      scatter3d: chartsScatter3dFitFromRecords(current.rows, title ?? "Custom scatter"),
      bars3d: chartsBars3dFitFromRecords(current.rows, title ?? "Custom columns"),
      line3d: chartsLine3dFitFromRecords(current.rows, title ?? "Custom line"),
      parametric3d: fits.parametric3d,
    };
  }
  const preferred = current?.channels ?? state.marks[0]?.channels;
  for (const type of Object.keys(fits) as (keyof Charts3dFitTable)[]) {
    const fit = fits[type];
    if (!fit.fits) continue;
    let source: Extract<Charts3dSource, { kind: "inline" }> = {
      ...fit.source,
      title: title ?? fit.source.title,
      description,
      attribution,
    };
    const numeric = profileRows(source.rows)
      .columns.filter((column) => column.type === "number" || column.type === "integer")
      .map((column) => column.name);
    let channels = { ...source.channels } as Charts3dChannels;
    for (const axis of ["x", "y", "z"] as const) {
      const field = preferred && axis in preferred ? preferred[axis as keyof typeof preferred] : undefined;
      if (typeof field === "string" && numeric.includes(field) && field !== channels[axis]) {
        channels = {
          ...channels,
          [axis]: field,
          ...(axis === "x" ? { xLabel: undefined } : axis === "y" ? { yLabel: undefined } : {}),
        };
      }
    }
    if (!current && (channels.z === channels.x || channels.z === channels.y)) {
      channels = {
        ...channels,
        z: numeric.find((field) => field !== channels.x && field !== channels.y) ?? channels.z,
      };
    }
    if (type === "scatter3d") {
      const series = current ? (current.channels as Charts3dChannels).series : state.marks[0]?.channels.fill;
      channels = { ...channels, series };
    }
    const candidate = { ...source, channels };
    if (resolveCharts3dView({ ...state.chart3d, source: candidate }).ok) source = candidate;
    fits[type] = { fits: true, source };
  }
  return fits;
}
