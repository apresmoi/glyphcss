import { describe, expect, it } from "vitest";
import { charts3dFieldControls, charts3dFitsForState, charts3dTable } from "./charts3dFields";
import { createChartsWorkbenchState, type ChartsWorkbenchState } from "./chartsSpec";
import { reduceChartsWorkbenchState as reduce } from "./chartsWorkbenchState";
import { resolveCharts3dView } from "./chartsWorkbench3d";
import { findChartsDataset } from "../data";
import { decodeChartsUrlState, encodeChartsUrlState } from "../services/chartsUrlState";

const iris = () => reduce(createChartsWorkbenchState(), { type: "select-dataset", id: "iris-flowers" });
const scatter = () => reduce(iris(), { type: "select-3d-table", markType: "scatter3d" });

it("keeps manually selected 2D columns when changing chart shape", () => {
  let state = reduce(createChartsWorkbenchState(), { type: "select-dataset", id: "olympics-2024-medals" });
  const mark = state.marks[0]!;
  state = reduce(state, { type: "update-mark", id: mark.id, patch: { channels: { ...mark.channels, y: "bronze" } } });
  for (const markType of ["dot", "bar"] as const) {
    state = reduce(state, { type: "set-mark-type", id: mark.id, markType });
    expect(state.marks[0]!.type).toBe(markType);
    expect(state.marks[0]!.channels).toMatchObject({ x: "country", y: "bronze" });
    expect(state.data.source).toEqual({ kind: "dataset", id: "olympics-2024-medals" });
  }
});

describe("3D table controls", () => {
  it("keeps the dataset title, About, source and existing x/y bindings on entering 3D", () => {
    const before = iris();
    const state = scatter();
    const result = resolveCharts3dView(state.chart3d);
    expect(result.ok).toBe(true);
    if (!result.ok) throw Error(result.error);
    const dataset = findChartsDataset("iris-flowers")!;
    expect(result.resolved).toMatchObject({ title: dataset.title, description: dataset.description, source: dataset.source });
    expect(charts3dTable(state.chart3d.source)?.channels).toMatchObject({ x: before.marks[0]!.channels.x, y: before.marks[0]!.channels.y, series: "species" });
    expect(charts3dFieldControls(state.chart3d).map((control) => control.channel)).toEqual(["x", "y", "z", "series"]);
  });

  it("edits XYZ and series using real fields and preserves axes, guides, style and camera", () => {
    let state = scatter();
    state = reduce(state, { type: "set-3d-axis", axis: "z", patch: { title: "Width", ticks: 3, domain: [0, 10] } });
    state = reduce(state, { type: "set-3d-guides", patch: { floorGrid: false, box: true } });
    state = reduce(state, { type: "set-3d-view", patch: { style: "wireframe", colorscale: "plasma" } });
    state = reduce(state, { type: "set-3d-camera", camera: { rotX: 12, rotY: 23, zoom: 30 } });
    const settings = state.chart3d;
    for (const [channel, value] of [["x", "sepal_width_cm"], ["y", "sepal_length_cm"], ["z", "petal_width_cm"], ["series", ""]] as const) {
      state = reduce(state, { type: "set-3d-channel", channel, value });
      expect(charts3dTable(state.chart3d.source)?.channels[channel]).toBe(value || undefined);
      expect(resolveCharts3dView(state.chart3d).ok).toBe(true);
    }
    const channels = charts3dTable(state.chart3d.source)!.channels;
    state = reduce(state, { type: "select-3d-table", markType: "line3d" });
    expect(charts3dTable(state.chart3d.source)?.channels).toMatchObject({ x: channels.x, y: channels.y, z: channels.z });
    for (const key of ["axes", "guides", "style", "colorscale", "camera"] as const) expect(state.chart3d[key]).toEqual(settings[key]);
    const resolved = resolveCharts3dView(state.chart3d);
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.resolved.mark.type).toBe("line3d");
      expect(resolved.resolved.mark.axes.z.title).toBe("Width");
      expect(resolved.resolved.description).toContain("Iris");
    }
    expect(reduce(state, { type: "select-3d-table", markType: "line3d" })).toBe(state);
  });

  it("edits preset table fields and retains them in shared URLs", async () => {
    let state = reduce(createChartsWorkbenchState(), { type: "select-3d-dataset", id: "iris-scatter-3d" });
    expect(charts3dFieldControls(state.chart3d).find((c) => c.channel === "z")?.options.map((o) => o.value)).toContain("sepal_width_cm");
    state = reduce(state, { type: "set-3d-channel", channel: "z", value: "sepal_width_cm" });
    expect(charts3dTable(state.chart3d.source)?.channels.z).toBe("sepal_width_cm");
    expect(resolveCharts3dView(state.chart3d)).toMatchObject({ ok: true, resolved: { mark: { axes: { z: { title: "sepal_width_cm" } } } } });
    const restored = await decodeChartsUrlState(await encodeChartsUrlState(state));
    expect(restored?.chart3d.source).toEqual(state.chart3d.source);
    expect(restored?.dimension).toBe("3d");
  });

  it("never replaces a 3D preset's table with the unrelated 2D dataset on type change", () => {
    const state = reduce(iris(), { type: "select-3d-dataset", id: "olympics-2024-columns-3d" });
    const next = reduce(state, { type: "select-3d-table", markType: "scatter3d" });
    expect(next.dimension).toBe("3d");
    expect(charts3dTable(next.chart3d.source)?.rows[0]).toHaveProperty("country");
    expect(resolveCharts3dView(next.chart3d)).toMatchObject({ ok: true, resolved: { title: expect.stringContaining("Olympic") } });
  });

  it("keeps fixed-grid presets on their own data and refuses invalid surface field edits", () => {
    const preset = createChartsWorkbenchState();
    const grid: ChartsWorkbenchState = { ...preset, dimension: "3d" };
    expect(charts3dFieldControls(grid.chart3d)).toEqual([]);
    expect(Object.values(charts3dFitsForState(grid)).every((fit) => !fit.fits)).toBe(true);
    const surface: ChartsWorkbenchState = { ...grid, chart3d: { ...grid.chart3d, source: { kind: "inline", markType: "surface", title: "Grid", rows: [{ x: 0, y: 0, z: 1 }, { x: 1, y: 0, z: 2 }, { x: 0, y: 1, z: 3 }, { x: 1, y: 1, z: 4 }], channels: { x: "x", y: "y", z: "z" } } } };
    const x = charts3dFieldControls(surface.chart3d).find((field) => field.channel === "x")!;
    expect(x.options.find((option) => option.value === "y")?.disabled).toBe(true);
    expect(reduce(surface, { type: "set-3d-channel", channel: "x", value: "y" })).toBe(surface);
  });
});
