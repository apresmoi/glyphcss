// @vitest-environment node
//
// Packet C3 (AGENTS.md's "Charts 3D") — the state/fit/scene-option helpers
// `/charts` 3D wires into `ChartsWorkbenchState`. Each test names the
// mutation that would turn it red.
import { describe, expect, it } from "vitest";
import { GLYPH_CHART_3D_DEFAULT_CAMERA } from "@glyphcss/charts/3d";
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
    // Mutation check: if this page ever hardcodes its own rotX/rotY
    // independently of the library constant, this equality still holds by
    // coincidence — so pin against `GLYPH_CHART_3D_DEFAULT_CAMERA` itself
    // (never a literal copy here — fix round 3 dropped the page test's own
    // hardcoded `{rotX: 65, rotY: 45}`, which drifted the moment the
    // library's own default camera changed), since that is what would
    // actually catch a page-side copy drifting from the library.
    expect(view.camera.rotX).toBe(GLYPH_CHART_3D_DEFAULT_CAMERA.rotX);
    expect(view.camera.rotY).toBe(GLYPH_CHART_3D_DEFAULT_CAMERA.rotY);
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

describe("chartsWorkbench3dSceneOptions — the live viewport honours colour", () => {
  it("useColors follows color === \"none\" exactly", () => {
    for (const color of CHART_COLORS) {
      expect(chartsWorkbench3dSceneOptions(color).useColors, color).toBe(color !== "none");
    }
  });
});

// C3 fix round 2 (user feedback: the old `.charts-3d-downgrade-note` banner
// inside the viewport's own render area violated AGENTS.md's own
// "TargetPreview" rule and read as developer-speak) — the reason an
// unsupported charset can't show live now lives on the Dock's OWN dimmed
// Charset toggle, derived from the library's real `glyphChart3dCharsetDegrades`
// predicate, never a hardcoded charset list. Mutation: hardcoding
// `charset === "braille"` in `chartsCharsetToggle` instead of calling the
// predicate would still pass the first two assertions here (braille IS
// disabled today) but goes red the instant the C2 library round lands and
// makes braille a real 3D surface — `blocks` alone stays disabled and a
// hardcoded braille-only check would silently disable the WRONG charset
// forever after that.
describe("ChartsDock.chartsCharsetToggle — dims exactly what the library predicate says, in 3D only", () => {
  it("in 3D, every charset glyphChart3dCharsetDegrades flags is disabled with the plain-English reason; the rest are not", async () => {
    const { chartsCharsetToggle } = await import("./ChartsDock");
    const { glyphChart3dCharsetDegrades } = await import("@glyphcss/charts/3d");
    for (const option of chartsCharsetToggle(true)) {
      const shouldDegrade = glyphChart3dCharsetDegrades(option.value as (typeof CHART_CHARSETS)[number]);
      expect(option.disabled === true, option.value).toBe(shouldDegrade);
      if (shouldDegrade) expect(option.disabledReason).toBe("Not available for 3D surfaces yet");
    }
  });
  it("in 2D, nothing is disabled", async () => {
    const { chartsCharsetToggle } = await import("./ChartsDock");
    for (const option of chartsCharsetToggle(false)) expect(option.disabled).toBeUndefined();
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
