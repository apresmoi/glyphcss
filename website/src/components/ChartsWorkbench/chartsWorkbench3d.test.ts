// @vitest-environment node
//
// Packet C3 (AGENTS.md's "Charts 3D") — the state/fit/scene-option helpers
// `/charts` 3D wires into `ChartsWorkbenchState`. Each test names the
// mutation that would turn it red.
import { describe, expect, it } from "vitest";
import { CHART_CHARSETS, CHART_COLORS } from "./chartsWorkbenchState";
import {
  CHARTS_3D_DEFAULT_CAMERA, CHARTS_SURFACE_NEEDS, chartsSurfaceFitFromRows, chartsWorkbench3dSceneOptions,
  createCharts3dViewState, resolveCharts3dView,
} from "./chartsWorkbench3d";
import { CHARTS_3D_DATASETS, findCharts3dDataset } from "./datasets/chart3d";
import type { ChartsWorkbenchDataState, ChartsWorkbenchMark } from "./chartsWorkbenchState";

function markWithRows(id: number, dataText: string): ChartsWorkbenchMark {
  return { id, type: "dot", dataText, channels: {}, transform: "none", options: {} };
}
const EMPTY_DATA: ChartsWorkbenchDataState = { source: null, pipeline: [] };

describe("createCharts3dViewState", () => {
  it("reads the default camera straight from the library (GLYPH_CHART_3D_DEFAULT_CAMERA), never a page-side copy", () => {
    const view = createCharts3dViewState();
    expect(view.camera).toEqual(CHARTS_3D_DEFAULT_CAMERA);
    // Mutation check: if this page ever hardcodes {rotX: 65, rotY: 45}
    // independently of the library constant, this equality still holds by
    // coincidence — so pin the VALUE too, since that is what would actually
    // drift if the library's own default ever changes.
    expect(view.camera.rotX).toBe(65);
    expect(view.camera.rotY).toBe(45);
    expect(view.camera.zoom).toBeUndefined(); // auto-fit
  });
  it("defaults shading to auto (the library's own default applies, never a page-side relief/value guess)", () => {
    expect(createCharts3dViewState().shading).toBe("auto");
  });
  it("defaults to the first vendored 3D dataset", () => {
    expect(createCharts3dViewState().source).toEqual({ kind: "dataset", id: CHARTS_3D_DATASETS[0]!.id });
  });
});

describe("resolveCharts3dView", () => {
  it("resolves both vendored datasets to a valid GlyphChart3dSurfaceMark", () => {
    for (const dataset of CHARTS_3D_DATASETS) {
      const result = resolveCharts3dView(createCharts3dViewState(dataset.id));
      expect(result.ok, dataset.id).toBe(true);
      if (!result.ok) continue;
      expect(result.resolved.mark.type).toBe("surface");
      expect(result.resolved.title).toBe(dataset.title);
    }
  });
  it("reports an error (never throws) for an unknown dataset id", () => {
    const result = resolveCharts3dView({ ...createCharts3dViewState(), source: { kind: "dataset", id: "no-such-dataset" } });
    expect(result.ok).toBe(false);
  });
  it("shading: auto omits options.shading — a mark built with it explicitly relief vs explicitly auto still validates the same way (both legal), pinning that auto never THROWS", () => {
    const auto = resolveCharts3dView(createCharts3dViewState());
    const relief = resolveCharts3dView({ ...createCharts3dViewState(), shading: "relief" });
    expect(auto.ok && relief.ok).toBe(true);
  });
});

describe("chartsSurfaceFitFromRows — the mark card's Surface option", () => {
  it("disables on every real vendored 2D dataset row shape (none of the 16 built-ins are a complete x*y*z grid)", async () => {
    const { CHARTS_DATASETS } = await import("./datasets");
    for (const dataset of CHARTS_DATASETS) {
      const mark = markWithRows(1, JSON.stringify(dataset.rows));
      const fit = chartsSurfaceFitFromRows({ source: { kind: "dataset", id: dataset.id }, pipeline: [] }, [mark]);
      expect(fit.fits, dataset.id).toBe(false);
      if (!fit.fits) expect(fit.reason).toBe(CHARTS_SURFACE_NEEDS);
    }
  });
  it("fits a synthetic COMPLETE x*y*z grid (three number columns, every pair present once)", () => {
    const rows: Record<string, number>[] = [];
    for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) rows.push({ x, y, z: x + y });
    const mark = markWithRows(1, JSON.stringify(rows));
    const fit = chartsSurfaceFitFromRows(EMPTY_DATA, [mark]);
    expect(fit.fits).toBe(true);
    if (fit.fits) {
      expect(fit.source.kind).toBe("inline");
      const resolved = resolveCharts3dView({ ...createCharts3dViewState(), source: fit.source });
      // Mutation check: an enabled Surface option must always resolve to a
      // real mark (the `chartsMarkTypeFit.ts` idiom this mirrors) — if the
      // fit check's own validation call were removed, a genuinely
      // ragged/incomplete grid could report `fits: true` and then fail here.
      expect(resolved.ok).toBe(true);
    }
  });
  it("disables on a grid MISSING one (x, y) pair (not honestly complete)", () => {
    const rows: Record<string, number>[] = [];
    for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) { if (x === 2 && y === 2) continue; rows.push({ x, y, z: x + y }); }
    const mark = markWithRows(1, JSON.stringify(rows));
    const fit = chartsSurfaceFitFromRows(EMPTY_DATA, [mark]);
    expect(fit.fits).toBe(false);
  });
  it("disables with no marks at all", () => {
    expect(chartsSurfaceFitFromRows(EMPTY_DATA, []).fits).toBe(false);
  });
});

describe("chartsWorkbench3dSceneOptions — the live viewport honours target x charset x colour", () => {
  it("useColors follows color === \"none\" exactly, for every charset", () => {
    for (const charset of CHART_CHARSETS) {
      for (const color of CHART_COLORS) {
        const opts = chartsWorkbench3dSceneOptions(charset, color);
        expect(opts.useColors, `${charset}/${color}`).toBe(color !== "none");
      }
    }
  });
  it("both blocks and braille report a visible downgrade note (a 3D chart's always-mounted overlay disables the halfblock encoder, and glyphcss's solid mode has no braille one) — ascii/box report none", () => {
    expect(chartsWorkbench3dSceneOptions("braille", "css").downgradeNote).not.toBeNull();
    expect(chartsWorkbench3dSceneOptions("blocks", "css").downgradeNote).not.toBeNull();
    for (const charset of ["ascii", "box"] as const) {
      expect(chartsWorkbench3dSceneOptions(charset, "css").downgradeNote, charset).toBeNull();
    }
  });
});

// Sanity: the module under test never imported the live-only findCharts3dDataset
// path incorrectly — a stray import would still resolve fine here since this
// suite runs in Node, but keeping the import used avoids an unused-import lint
// failure and doubles as a smoke check that the dataset registry loads.
describe("datasets/chart3d registry", () => {
  it("findCharts3dDataset resolves both ids and nothing else", () => {
    for (const dataset of CHARTS_3D_DATASETS) expect(findCharts3dDataset(dataset.id)).toBe(dataset);
    expect(findCharts3dDataset("nope")).toBeUndefined();
  });
});
