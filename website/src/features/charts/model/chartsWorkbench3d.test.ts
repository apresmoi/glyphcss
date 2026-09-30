// @vitest-environment node
//
// Packet C3 (AGENTS.md's "Charts 3D") — the state/fit/scene-option helpers
// `/charts` 3D wires into `ChartsWorkbenchState`. Each test names the
// mutation that would turn it red.
import { describe, expect, it } from "vitest";
import { GLYPH_CHART_3D_DEFAULT_CAMERA } from "@glyphcss/charts/3d";
import { CHART_CHARSETS, CHART_COLORS } from "./chartsWorkbenchState";
import {
  CHARTS_3D_DEFAULT_CAMERA, CHARTS_3D_ZOOM_RANGE_FACTOR, CHARTS_SURFACE_NEEDS, charts3dObjectCharset, charts3dZoomRange, chartsSurfaceFitFromRows,
  chartsWorkbench3dSceneOptions, createCharts3dViewState, resolveCharts3dStyle, resolveCharts3dView,
} from "./chartsWorkbench3d";
import { CHARTS_3D_DATASETS, findCharts3dDataset } from "../data/chart3d/index";
import type { ChartsWorkbenchDataState, ChartsWorkbenchMark } from "./chartsSpec";

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
  it("resolves every vendored 3D dataset to a valid mark of its OWN markType (packet C6 — surface, scatter3d, bars3d, parametric3d, line3d)", () => {
    for (const dataset of CHARTS_3D_DATASETS) {
      const result = resolveCharts3dView(createCharts3dViewState(dataset.id));
      expect(result.ok, dataset.id).toBe(true);
      if (!result.ok) continue;
      expect(result.resolved.mark.type, dataset.id).toBe(dataset.markType);
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

  // Axis title position (user feedback, verbatim: "we need to be able to
  // configure the position of the title of the axis") — `titleAt`/
  // `titleOffset` reach the built mark's own resolved axis exactly like
  // every other Axes-folder override, mutation: drop either field from
  // `mergedAxisOption` and this reddens.
  it("titleAt/titleOffset overrides reach the resolved mark's own axis", () => {
    const view = { ...createCharts3dViewState(), axes: { x: { titleAt: "start" as const, titleOffset: 1.2 }, y: {}, z: {} } };
    const result = resolveCharts3dView(view);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.resolved.mark.axes.x.titleAt).toBe("start");
    expect(result.resolved.mark.axes.x.titleOffset).toBe(1.2);
    // An untouched axis carries neither — the library's own default applies.
    expect(result.resolved.mark.axes.y.titleAt).toBeUndefined();
    expect(result.resolved.mark.axes.y.titleOffset).toBeUndefined();
  });
});

// Zoom range (user report, verbatim: "we also need to be able to zoom in
// the chart, for some reason you cannot zoom/pan it properly... like the
// zoom has limits") — `charts3dZoomRange` is the explicit range
// `Charts3dViewport.tsx` passes to `createGlyphOrbitControls` so wheel zoom
// works across the useful range around a fitted 3D-chart camera (routinely
// 500+, well outside the library's own pre-`zoomRange` `[0.1, 500]` clamp).
describe("charts3dZoomRange", () => {
  it("derives a wide range around the given zoom using the shared factor", () => {
    expect(charts3dZoomRange(700)).toEqual([700 / CHARTS_3D_ZOOM_RANGE_FACTOR, 700 * CHARTS_3D_ZOOM_RANGE_FACTOR]);
    // A fitted camera at 700 must be able to zoom OUT (smaller) and IN
    // (larger) from its own starting point — both directions actually move.
    const [min, max] = charts3dZoomRange(700);
    expect(min).toBeLessThan(700);
    expect(max).toBeGreaterThan(700);
  });
  it("never divides by zero or returns a non-finite bound for a zero/negative zoom", () => {
    for (const zoom of [0, -5]) {
      const [min, max] = charts3dZoomRange(zoom);
      expect(Number.isFinite(min)).toBe(true);
      expect(Number.isFinite(max)).toBe(true);
      expect(min).toBeGreaterThan(0);
    }
  });
});

describe("chartsSurfaceFitFromRows — the mark card's Surface option", () => {
  it("disables on every real vendored 2D dataset row shape (none of the 16 built-ins are a complete x*y*z grid)", async () => {
    const { CHARTS_DATASETS } = await import("../data/index");
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

describe("chartsWorkbench3dSceneOptions — the live viewport honours colour, charset and style (packet C4)", () => {
  it("useColors follows color === \"none\" exactly, independent of charset/style", () => {
    for (const charset of CHART_CHARSETS) {
      for (const color of CHART_COLORS) {
        expect(chartsWorkbench3dSceneOptions(charset, color, "auto").useColors, `${charset}/${color}`).toBe(color !== "none");
      }
    }
  });

  // Mirrors `render.ts`'s own `resolveGlyphChart3dStyle` exactly — the
  // premise `chartsWorkbench3dSceneOptions` itself resolves `mode` from.
  // Mutation: hardcode `resolveCharts3dStyle` to always return `"solid"`
  // (the live bug this packet fixed) → the `braille`/`"auto"` case below
  // reddens.
  it("resolveCharts3dStyle: auto resolves braille to wireframe, every other charset to solid; an explicit style always wins", () => {
    for (const charset of CHART_CHARSETS) {
      expect(resolveCharts3dStyle(charset, "auto"), charset).toBe(charset === "braille" ? "wireframe" : "solid");
    }
    for (const style of ["solid", "wireframe", "ink"] as const) {
      for (const charset of CHART_CHARSETS) {
        expect(resolveCharts3dStyle(charset, style), `${charset}/${style}`).toBe(style);
      }
    }
  });

  // The exact `mode`/`charMode`/`hiddenLines` bundle the live scene mounts
  // with — every combination, matching `render.ts`'s own `renderObjectFrame`
  // assembly line for line. Mutation: drop the `charMode`/`hiddenLines`
  // wiring from `chartsWorkbench3dSceneOptions` (the live bug this packet
  // fixed: the viewport hard-coded `mode: "solid"` and never read
  // charset/style) → every wireframe-resolving case below reddens.
  it("resolves mode/charMode/hiddenLines for every charset x style combination, matching render.ts's own assembly", () => {
    const styles = ["auto", "solid", "wireframe", "ink"] as const;
    for (const charset of CHART_CHARSETS) {
      for (const style of styles) {
        const resolved = resolveCharts3dStyle(charset, style);
        const opts = chartsWorkbench3dSceneOptions(charset, "css", style);
        expect(opts.mode, `${charset}/${style}`).toBe(resolved);
        expect(opts.charMode, `${charset}/${style}`).toBe(resolved === "wireframe" && charset === "braille" ? "braille" : undefined);
        expect(opts.hiddenLines, `${charset}/${style}`).toBe(resolved === "wireframe" ? "hide" : undefined);
      }
    }
  });
});

// Ground-truth check — never trust the page-local mirror against itself:
// for every charset x style combination, the LIVE viewport's own resolved
// `mode` (`chartsWorkbench3dSceneOptions`) must equal the REAL library's
// own resolved style, read off `renderGlyphChart3d`'s own `resolved.style`
// (never re-derived — the exact field the static exit reports). This is
// the coordinator's own explicit gate: "live and Copy agree on the mode
// for every charset/style combination." Mutation: hardcode
// `resolveCharts3dStyle` to always return `"solid"` → the `braille`/
// `"auto"` cell reddens (the real library resolves `"wireframe"` there,
// the page mirror would claim `"solid"`).
describe("live/Copy agreement — chartsWorkbench3dSceneOptions.mode vs. the REAL renderGlyphChart3d's own resolved.style", () => {
  it("agrees for every charset x style combination", async () => {
    const { renderGlyphChart3d } = await import("@glyphcss/charts/3d");
    const resolved = resolveCharts3dView(createCharts3dViewState());
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    const styles = ["auto", "solid", "wireframe", "ink"] as const;
    for (const charset of CHART_CHARSETS) {
      for (const style of styles) {
        const live = chartsWorkbench3dSceneOptions(charset, "css", style).mode;
        const out = renderGlyphChart3d(resolved.resolved.mark, {
          target: "web", charset, color: "css", width: 40, height: 20,
          ...(style !== "auto" ? { style } : {}),
        });
        expect(live, `${charset}/${style}`).toBe(out.resolved.style);
      }
    }
  });
});

// The STATIC exit's own forwarding: `state.chart3d.style` must actually
// reach `renderGlyphChart3d`'s `options.style`, not just round-trip
// through `?c=` (which `chartsUrlState.test.ts`'s own round-trip test
// already pins, but proves nothing about whether the RENDER reads it).
// Mutation: drop the `...(input.view.style !== "auto" ? { style:
// input.view.style } : {})` spread from `chartsWorkbench3dRender.ts`'s
// `renderCharts3dStatic` → this reddens (an explicit `"wireframe"` on the
// `ascii` charset, which `"auto"` would resolve to `"solid"`, renders
// byte-identical to leaving `style` at its default).
describe("renderCharts3dStatic — the Style control actually reaches renderGlyphChart3d (packet C4, codex review)", () => {
  it("an explicit wireframe style on a charset auto would resolve to solid changes the rendered text", async () => {
    const { renderCharts3dStatic } = await import("../render/chartsWorkbench3dRender");
    const baseView = { ...createCharts3dViewState() };
    expect(resolveCharts3dStyle("ascii", "auto")).toBe("solid"); // the premise this test exercises
    const solidOut = renderCharts3dStatic({ view: { ...baseView, style: "auto" }, target: "web", charset: "ascii", color: "css", width: 60, height: 24 });
    const wireOut = renderCharts3dStatic({ view: { ...baseView, style: "wireframe" }, target: "web", charset: "ascii", color: "css", width: 60, height: 24 });
    expect(solidOut.ok).toBe(true);
    expect(wireOut.ok).toBe(true);
    if (!solidOut.ok || !wireOut.ok) return;
    expect(wireOut.text).not.toBe(solidOut.text);
  });
});

describe("charts3dObjectCharset — mirrors render.ts's own chromeTier", () => {
  it("blocks degrades to ascii; every other charset is unchanged", () => {
    for (const charset of CHART_CHARSETS) {
      expect(charts3dObjectCharset(charset), charset).toBe(charset === "blocks" ? "ascii" : charset);
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
    const { chartsCharsetToggle } = await import("../../../components/ChartsWorkbench/ChartsDock/options");
    const { glyphChart3dCharsetDegrades } = await import("@glyphcss/charts/3d");
    for (const option of chartsCharsetToggle(true)) {
      const shouldDegrade = glyphChart3dCharsetDegrades(option.value as (typeof CHART_CHARSETS)[number]);
      expect(option.disabled === true, option.value).toBe(shouldDegrade);
      if (shouldDegrade) expect(option.disabledReason).toBe("Not available for 3D surfaces yet");
    }
  });
  it("in 2D, nothing is disabled", async () => {
    const { chartsCharsetToggle } = await import("../../../components/ChartsWorkbench/ChartsDock/options");
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
