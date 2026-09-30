import type { GlyphChartCharset, GlyphChartColorMode, GlyphChartDetail, GlyphChartTarget } from "@glyphcss/charts";
import { type Dispatch, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import {
  type ChartsWorkbenchState,
  CHART_AXIS_COLOR_MODES,
  CHART_SCALE_TYPES,
} from "../../../features/charts/model/chartsSpec";
import type {
  Charts3dAxisOverride,
  Charts3dGuideOptions,
  Charts3dResolveResult,
} from "../../../features/charts/model/chartsWorkbench3d";
import {
  type ChartsWorkbenchAction,
  type GlyphChartsWorkbenchControlAction,
  CHART_REGION_FILLS,
  CHARTS_DENSITY_MIN,
  CHARTS_DENSITY_MIN_FONT_PX,
  CHARTS_DENSITY_STEP,
  chartsDensitySliderMax,
  chartsWorkbenchAxisTimePrecision,
  chartsWorkbenchDensity,
  chartsWorkbenchDensityLocked,
  chartsWorkbenchHasCartesianMark,
  chartsWorkbenchHasZeroAnchoredMark,
  chartsWorkbenchInferredDomains,
  chartsWorkbenchScaleTypeFits,
  chartsWorkbenchSizeLocked,
  resolveGlyphChartsWorkbenchControls,
} from "../../../features/charts/model/chartsWorkbenchState";
import {
  type ChartsWorkbenchRender,
  chartsWorkbenchActualTicks,
  chartsWorkbenchRegionFillStatus,
} from "../../../features/charts/render/chartsWorkbenchRender";
import { ColorSwatch } from "../../ColorSwatch";
import {
  useColor,
  useDockGui,
  useDockSlot,
  useFolder,
  useFolderTitleReset,
  useOption,
  useSlider,
  useText,
  useToggle,
} from "../../Dock";
import { ChoiceButton, IconToggle } from "../../IconToggle";
import { Instrument3DEffectsFolder } from "../../Instrument3DEffectsFolder";
import type { Charts3dViewportHandle } from "../Charts3dViewport";
import { use3dAxisControls, useAxisSectionFolder, useTicksControl } from "./axisControls";
import {
  AXIS_COLOR_MODE_LABEL,
  AXIS_X_TITLE_AT_TOGGLE,
  AXIS_Y_TITLE_AT_TOGGLE,
  CHARTS_3D_AXIS_TITLE_AT_TOGGLE,
  CHARTS_3D_COLORSCALE_TOGGLE,
  CHARTS_3D_EFFECT_IDS,
  CHARTS_3D_EFFECT_TARGETS,
  CHARTS_3D_GUIDE_DEFAULTS,
  CHARTS_3D_ORBIT_MODE_TOGGLE,
  CHARTS_3D_SHADING_TOGGLE,
  CHARTS_3D_STYLE_TOGGLE,
  chartsCharsetToggle,
  chartsRegionFillToggle,
  COLOR_TOGGLE,
  DETAIL_TOGGLE,
  LEGEND_TOGGLE,
  options,
  TARGET_TOGGLE,
  TITLE_ALIGN_TOGGLE,
  TITLE_POSITION_TOGGLE,
} from "./options";
import { Charts3dAxisDomainRow, ScaleDomainControl, useScaleTypeFit } from "./ScaleDomainControl";

export function ChartsDock({
  state,
  dispatch,
  rendered,
  chart3dViewportHandleRef,
  chart3dResolved,
}: {
  state: ChartsWorkbenchState;
  dispatch: Dispatch<ChartsWorkbenchAction>;
  rendered?: ChartsWorkbenchRender;
  /** The live 3D viewport's own reset-camera entry point — `undefined`/not
   *  yet mounted is a no-op button, never a crash. */
  chart3dViewportHandleRef?: { current: Charts3dViewportHandle | null };
  /** The CURRENTLY resolved 3D mark (packet C6) — the Axes folder's own
   *  per-axis rows read its `axes.{x,y,z}` for their tick-count/domain
   *  seeds, mirroring `rendered`'s own "seed from what actually rendered"
   *  role for the 2D ticks row. `undefined`/not `ok` leaves every 3D axis
   *  row at its own built-in fallback seed rather than crashing. */
  chart3dResolved?: Charts3dResolveResult;
}) {
  const gui = useDockGui();
  const controls = resolveGlyphChartsWorkbenchControls(state.controls);
  const setControl = (control: GlyphChartsWorkbenchControlAction) => dispatch({ type: "set-control", control });
  // Hoisted above every consumer (the Charset row's own dim-with-reason
  // below, AND the View folder's own show/hide gating further down) —
  // `state.dimension === "3d"` is a single cheap boolean, no reason to
  // compute it twice.
  const is3d = state.dimension === "3d";
  const charsetToggle = useMemo(() => chartsCharsetToggle(is3d), [is3d]);
  // P3-6 (REVIEW-dock-colours-sliders-opus.md): under `Color: none` the
  // library drops every colour from the render, but every swatch (axis and
  // per-mark) stayed fully live with no signal — a picked value that
  // silently paints nothing reads as broken, not as a colour the reader
  // chose to suppress. Dimmed with the reason on `title`, `/maps`'
  // `mapDirectionLocked` idiom for "disabled with its reason", not hidden —
  // the colour is still real state, just inert while `Color` is off.
  const colorDisabled = controls.color === "none";
  const colorDisabledReason = colorDisabled
    ? "Color mode is off — pick a colour mode below to see it painted."
    : undefined;
  // Ticks rows (owner packet item 1) — the seed a reader gets when
  // unchecking "auto" (`chartsWorkbenchActualTicks`'s own doc).
  const actualXTicks = rendered ? chartsWorkbenchActualTicks(rendered, "x", controls.charset) : undefined;
  const actualYTicks = rendered ? chartsWorkbenchActualTicks(rendered, "y", controls.charset) : undefined;
  const output = useFolder(gui, "Output", { open: true });
  // Folder-title-bar reset (REVIEW-dock-addenda-opus.md P3-5) — "OUTPUT
  // ═══════ [reset]" on the folder's own native title line; see
  // `InstrumentWorkbench/useFolderTitleReset`'s own doc, shared with
  // `/diagrams`.
  useFolderTitleReset(output, "Reset target, charset, color, width, height, and detail to this target's defaults", () =>
    dispatch({ type: "reset-target" }),
  );
  const targetSlot = useDockSlot(output, { position: "bottom", className: "dock-toggle-row-slot" });
  const charsetSlot = useDockSlot(output, { position: "bottom", className: "dock-toggle-row-slot" });
  const colorSlot = useDockSlot(output, { position: "bottom", className: "dock-toggle-row-slot" });
  const widthCtrl = useSlider(output, "Width", { min: 12, max: 240, step: 1 }, controls.width, (value) =>
    setControl({ type: "width", value }),
  );
  const heightCtrl = useSlider(output, "Height", { min: 6, max: 120, step: 1 }, controls.height, (value) =>
    setControl({ type: "height", value }),
  );
  // `web` fills the measured viewport instead of a fixed logical grid
  // (AGENTS.md's "Charts" "Targets and page") — the mirror image of
  // Density's own lock just below: there the row dims OFF web (a fixed
  // consuming-renderer cell size has nothing to scale), here it dims ON
  // web (the viewport, not this slider, now owns the grid). The dialed-in
  // value still survives the round trip back to terminal/chat exactly like
  // density's own does off web (`chartsWorkbenchSizeLocked`'s own doc).
  const sizeLocked = chartsWorkbenchSizeLocked(controls.target);
  useEffect(() => {
    if (!widthCtrl || !heightCtrl) return;
    widthCtrl.setEnabled(!sizeLocked);
    heightCtrl.setEnabled(!sizeLocked);
    const reason = sizeLocked ? "Web fills the viewport." : "";
    widthCtrl.raw.domElement.title = reason;
    heightCtrl.raw.domElement.title = reason;
  }, [widthCtrl, heightCtrl, sizeLocked]);
  // Density (the user's own framing: "like in the 3D renderers we have the
  // density sliders" — AGENTS.md's "Per-mesh detail layers", the same
  // multiplier-on-cells-per-unit rule, applied to the chart's own render
  // grid instead of a mesh). Web only: `terminal`/`chat` render at whatever
  // cell size the CONSUMING renderer picks (a real terminal's font, a chat
  // client's fenced-code-block font), which this page cannot resize, so the
  // row dims with a reason there rather than doing nothing silently
  // (`@glyphcss/maps`' `mapDirectionLocked` idiom, `MapsWorkbench/mapsKit.tsx`).
  const densityLocked = chartsWorkbenchDensityLocked(controls.target);
  const densityMax = useMemo(() => chartsDensitySliderMax(), []);
  const densityCtrl = useSlider(
    output,
    "Density",
    { min: CHARTS_DENSITY_MIN, max: densityMax, step: CHARTS_DENSITY_STEP },
    chartsWorkbenchDensity(state.controls),
    (value) => setControl({ type: "density", value }),
  );
  useEffect(() => {
    if (!densityCtrl) return;
    densityCtrl.setEnabled(!densityLocked);
    densityCtrl.raw.domElement.title = densityLocked
      ? "Fixed cell size on this target — density applies to web."
      : `Renders more cells for the same on-screen size (like the 3D renderers' own density), down to a ${CHARTS_DENSITY_MIN_FONT_PX}px minimum cell — capped at ${densityMax}× for that floor.`;
  }, [densityCtrl, densityLocked, densityMax]);
  const detailSlot = useDockSlot(output, { position: "bottom", className: "dock-toggle-row-slot" });

  // Dataset selection now lives in the left rail (AGENTS.md's "Charts" —
  // "Data layer" — it is this page's own "model", exactly as synth's rail
  // is the voice/model picker): `ChartsWorkbench.tsx` renders
  // `ChartsDataFolder` directly in the rail body, so this Dock carries no
  // Data folder at all.
  const chart = useFolder(gui, "Chart", { open: true });
  // Folder-title-bar reset (P2-6, REVIEW-dock-colours-sliders-opus.md;
  // REVIEW-dock-addenda-opus.md P3-3) — the Output folder's own reset is
  // scoped to output settings only (target/charset/color/width/height/
  // detail) and never touches a hand-picked axis/mark colour, a typed
  // scale domain, an axis title placement, or a tick count, all of which
  // live in THIS folder (and Scales/Axes, below it) — this is their own
  // reset, same title-bar idiom. Its scope reaches across folders on
  // purpose (axis title placement and tick counts are Axes-folder rows,
  // not Chart-folder ones) — folded honestly into ONE reset and ONE
  // tooltip naming everything it touches, rather than a second reset on
  // the Axes folder for just those two.
  useFolderTitleReset(
    chart,
    "Reset axis colour, mark colours, textures, typed scale domains, axis title placement, and tick counts to their defaults",
    () => dispatch({ type: "reset-chart-style" }),
  );
  useText(chart, "Title", state.chart.title, (title) => dispatch({ type: "set-chart", patch: { title } }));
  const titlePlacementSlot = useDockSlot(chart, { position: "bottom", className: "dock-toggle-row-slot" });
  useText(chart, "Description", state.chart.description, (description) =>
    dispatch({ type: "set-chart", patch: { description } }),
  );
  useToggle(chart, "Legend", state.chart.legend, (legend) => dispatch({ type: "set-chart", patch: { legend } }));
  const legendPlacementSlot = useDockSlot(chart, { position: "bottom", className: "dock-toggle-row-slot" });
  const regionFillSlot = useDockSlot(chart, { position: "bottom", className: "dock-toggle-row-slot" });
  const regionFillStatus = useMemo(() => chartsWorkbenchRegionFillStatus(state), [state]);
  const regionFillToggle = useMemo(() => chartsRegionFillToggle(regionFillStatus), [regionFillStatus]);

  const scales = useFolder(gui, "Scales", { open: true });
  const xTypeCtrl = useOption(scales, "X type", options(CHART_SCALE_TYPES), state.scales.x.type, (type) =>
    dispatch({ type: "set-scale", axis: "x", patch: { type } }),
  );
  const xDomainSlot = useDockSlot(scales, { position: "bottom", className: "charts-scale-domain-slot" });
  const yTypeCtrl = useOption(scales, "Y type", options(CHART_SCALE_TYPES), state.scales.y.type, (type) =>
    dispatch({ type: "set-scale", axis: "y", patch: { type } }),
  );
  const yDomainSlot = useDockSlot(scales, { position: "bottom", className: "charts-scale-domain-slot" });
  // User report, verbatim: "also the X domain is weird, why do we have one
  // in scales and another X domain in the axis?" — a real duplicate: no
  // reader of `state.scales` exists on the 3D path (`chartsWorkbench3d.ts`,
  // `chartsWorkbenchRender.ts`'s 3D half) at all, so this whole folder is
  // inert while a 3D mark is selected and its own "X domain"/"Y domain"
  // rows just sat beside the REAL one in "X axis (3D)"/"Y axis (3D)". The
  // folder hides as a whole (mirroring the View folder's own is3d gating,
  // inverted), and the two domain-slot portals below are gated the same
  // way so no inert `ScaleDomainControl` is left mounted underneath it —
  // `state.scales` itself is untouched either way, so it round-trips
  // through 3D and back exactly like the density/width/height overrides do.
  useEffect(() => {
    if (scales) is3d ? scales.hide() : scales.show();
  }, [scales, is3d]);
  useEffect(() => {
    xTypeCtrl?.setVisible(!is3d);
    yTypeCtrl?.setVisible(!is3d);
  }, [xTypeCtrl, yTypeCtrl, is3d]);
  // Recomputed off the raw mark data (never the current min/max override —
  // see `chartsWorkbenchInferredDomains`'s own doc), so a `RangeSlider`'s
  // own draggable bounds don't shrink every time a reader narrows the
  // selection. Each axis resolves independently — a failing Y never takes
  // X's own, otherwise-valid, control down with it.
  const inferredDomains = useMemo(() => chartsWorkbenchInferredDomains(state), [state]);
  const zeroAnchoredY = useMemo(() => chartsWorkbenchHasZeroAnchoredMark(state), [state]);
  const hasCartesianScale = useMemo(() => chartsWorkbenchHasCartesianMark(state), [state]);
  // Both read only the marks (twelve domain resolutions, and one pass over
  // the mark data), so a Scales/Axes/Output edit never recomputes them.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const scaleTypeFits = useMemo(() => chartsWorkbenchScaleTypeFits(state), [state.marks]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const timePrecision = useMemo(
    () => ({ x: chartsWorkbenchAxisTimePrecision(state, "x"), y: chartsWorkbenchAxisTimePrecision(state, "y") }),
    [state.marks],
  );
  useScaleTypeFit(xTypeCtrl, scaleTypeFits.x);
  useScaleTypeFit(yTypeCtrl, scaleTypeFits.y);
  const unfitOf = (axis: "x" | "y") => {
    const fit = scaleTypeFits[axis][state.scales[axis].type];
    return fit.fits ? undefined : fit;
  };

  // Axes folder (user feedback, verbatim: "this section is a mess man, can
  // we somehow do a subgrouping by axis? like all the config for this axe,
  // all this config for this other axis"): a per-axis SUBFOLDER replaces
  // the old flat wall of X/Y (and, in 3D, X/Y/Z) rows, each with its own
  // header reset clearing only that axis (`useFolderTitleReset`). What's
  // genuinely SHARED stays at this outer "Axes" level, above every
  // subgroup: the axis-colour mode toggle (2D's `axisColorSlot`, which
  // switches shared vs. per-axis swatches — not one axis's own setting)
  // and the shared 3D `axes.color` swatch every per-axis colour overrides.
  //
  // The outer folder itself stays an ORDINARY collapsible top-level folder
  // (`open: true`, matching Output/Chart/Scales) — only the per-axis
  // SECTIONS nested inside it (below) become non-collapsible headings; see
  // `useAxisSectionFolder`'s own doc for why (user feedback, verbatim:
  // "the axes section in the sidebar, I dont want them to be collapsable").
  const axes = useFolder(gui, "Axes", { open: true });
  // Axis colour (packet item 1; dock-fix bundle item 7) — MOVED here from
  // the Chart folder: this IS "the ticks/title rows" folder for an axis,
  // and a shared or per-axis swatch reads as one more axis-level control
  // beside them, not a chart-wide style choice living apart from what it
  // colours. The Chart folder's own title-bar reset above still clears it
  // (its tooltip already named "axis colour" before this moved, and still
  // does) — only the ROW moved, not which reset owns it.
  const axisColorSlot = useDockSlot(axes, { position: "top", className: "charts-axis-color-slot" });

  // 2D per-axis subgroups — both exist unconditionally (mirroring the 3D
  // subgroups below) and are hidden/shown as a WHOLE via the subfolder's
  // own `.hide()/.show()` while a 3D type is active; the per-control
  // `setVisible` calls inside `useTicksControl` stay too (jsdom has no
  // layout engine, so a descendant's own `getComputedStyle().display`
  // never reflects an ancestor folder's hidden state — see that hook's
  // own doc). Each section is now a non-collapsible heading
  // (`useAxisSectionFolder`) holding BASIC rows (title, ticks) directly,
  // with tick marks/grid/title-placement moved into a collapsed "More"
  // subfolder — the same basic/advanced split `use3dAxisControls` takes
  // for the 3D axes, below.
  const xAxisFolder = useFolder(axes, "X axis", { open: true });
  useAxisSectionFolder(xAxisFolder);
  useFolderTitleReset(xAxisFolder, "Reset the X axis to its defaults", () =>
    dispatch({ type: "reset-axis", axis: "x" }),
  );
  const xTitleCtrl = useText(xAxisFolder, "X title", state.axes.x.title, (title) =>
    dispatch({ type: "set-axis", axis: "x", patch: { title } }),
  );
  useTicksControl(xAxisFolder, "x", state.axes.x.ticks, actualXTicks, dispatch, !is3d);
  const xAxisMoreFolder = useFolder(xAxisFolder, "More", { open: false });
  const xTickMarksCtrl = useToggle(xAxisMoreFolder, "X tick marks", state.axes.x.tickMarks, (tickMarks) =>
    dispatch({ type: "set-axis", axis: "x", patch: { tickMarks } }),
  );
  const xGridCtrl = useToggle(xAxisMoreFolder, "X grid", state.axes.x.grid, (grid) =>
    dispatch({ type: "set-axis", axis: "x", patch: { grid } }),
  );
  // Axis title placement (Dock item "Axis Title + Title at") — the same
  // pair (text + placement toggle) the chart's own title row has.
  const xTitleAtSlot = useDockSlot(xAxisMoreFolder, { position: "bottom", className: "dock-toggle-row-slot" });

  const yAxisFolder = useFolder(axes, "Y axis", { open: true });
  useAxisSectionFolder(yAxisFolder);
  useFolderTitleReset(yAxisFolder, "Reset the Y axis to its defaults", () =>
    dispatch({ type: "reset-axis", axis: "y" }),
  );
  const yTitleCtrl = useText(yAxisFolder, "Y title", state.axes.y.title, (title) =>
    dispatch({ type: "set-axis", axis: "y", patch: { title } }),
  );
  useTicksControl(yAxisFolder, "y", state.axes.y.ticks, actualYTicks, dispatch, !is3d);
  const yAxisMoreFolder = useFolder(yAxisFolder, "More", { open: false });
  const yTickMarksCtrl = useToggle(yAxisMoreFolder, "Y tick marks", state.axes.y.tickMarks, (tickMarks) =>
    dispatch({ type: "set-axis", axis: "y", patch: { tickMarks } }),
  );
  const yGridCtrl = useToggle(yAxisMoreFolder, "Y grid", state.axes.y.grid, (grid) =>
    dispatch({ type: "set-axis", axis: "y", patch: { grid } }),
  );
  const yTitleAtSlot = useDockSlot(yAxisMoreFolder, { position: "bottom", className: "dock-toggle-row-slot" });
  // Packet C6 — the whole 2D Axes subgroups hide while a 3D type is active;
  // the 3D subgroups below take over the SAME outer "Axes" folder instead
  // of a second one, per the coordinator's own instruction.
  useEffect(() => {
    for (const ctrl of [xTickMarksCtrl, xGridCtrl, xTitleCtrl, yTickMarksCtrl, yGridCtrl, yTitleCtrl])
      ctrl?.setVisible(!is3d);
  }, [xTickMarksCtrl, xGridCtrl, xTitleCtrl, yTickMarksCtrl, yGridCtrl, yTitleCtrl, is3d]);
  useEffect(() => {
    if (xAxisFolder) is3d ? xAxisFolder.hide() : xAxisFolder.show();
  }, [xAxisFolder, is3d]);
  useEffect(() => {
    if (yAxisFolder) is3d ? yAxisFolder.hide() : yAxisFolder.show();
  }, [yAxisFolder, is3d]);

  // The 3D Axes subgroups (packet C6, coordinator addendum, widened to a
  // real per-axis SUBFOLDER by the "Axes folder subgrouping" packet) — x, y
  // AND z, each its own collapsed folder in the SAME outer "Axes" folder as
  // the 2D subgroups above, hidden/shown as a whole together with the 2D
  // ones flipped the other way. Colour dims (with the SAME reason the 2D
  // axis-colour swatches already use) under `Color: none`, since a 3D axis
  // colour paints nothing there either.
  const resolved3dAxes = chart3dResolved?.ok ? chart3dResolved.resolved.mark.axes : undefined;
  const axes3dColorCtrl = useColor(axes, "Axes colour (3D)", state.chart3d.axes.color ?? "#7a7f8a", (color) =>
    dispatch({ type: "set-3d-axes-color", color }),
  );
  useEffect(() => {
    axes3dColorCtrl?.setVisible(is3d);
    axes3dColorCtrl?.setEnabled(!colorDisabled);
    axes3dColorCtrl?.raw.domElement.setAttribute("title", colorDisabled ? (colorDisabledReason ?? "") : "");
  }, [axes3dColorCtrl, is3d, colorDisabled, colorDisabledReason]);

  const x3dAxisFolder = useFolder(axes, "X axis (3D)", { open: true });
  useAxisSectionFolder(x3dAxisFolder);
  useFolderTitleReset(x3dAxisFolder, "Reset the X axis (3D) to its defaults", () =>
    dispatch({ type: "reset-3d-axis", axis: "x" }),
  );
  const { domainSlot: x3dDomainSlot, titleAtSlot: x3dTitleAtSlot } = use3dAxisControls(
    x3dAxisFolder,
    "X",
    "x",
    state.chart3d.axes.x,
    resolved3dAxes?.x,
    is3d,
    colorDisabled,
    colorDisabledReason,
    dispatch,
  );

  const y3dAxisFolder = useFolder(axes, "Y axis (3D)", { open: true });
  useAxisSectionFolder(y3dAxisFolder);
  useFolderTitleReset(y3dAxisFolder, "Reset the Y axis (3D) to its defaults", () =>
    dispatch({ type: "reset-3d-axis", axis: "y" }),
  );
  const { domainSlot: y3dDomainSlot, titleAtSlot: y3dTitleAtSlot } = use3dAxisControls(
    y3dAxisFolder,
    "Y",
    "y",
    state.chart3d.axes.y,
    resolved3dAxes?.y,
    is3d,
    colorDisabled,
    colorDisabledReason,
    dispatch,
  );

  const z3dAxisFolder = useFolder(axes, "Z axis (3D)", { open: true });
  useAxisSectionFolder(z3dAxisFolder);
  useFolderTitleReset(z3dAxisFolder, "Reset the Z axis (3D) to its defaults", () =>
    dispatch({ type: "reset-3d-axis", axis: "z" }),
  );
  const { domainSlot: z3dDomainSlot, titleAtSlot: z3dTitleAtSlot } = use3dAxisControls(
    z3dAxisFolder,
    "Z",
    "z",
    state.chart3d.axes.z,
    resolved3dAxes?.z,
    is3d,
    colorDisabled,
    colorDisabledReason,
    dispatch,
  );
  useEffect(() => {
    if (x3dAxisFolder) is3d ? x3dAxisFolder.show() : x3dAxisFolder.hide();
  }, [x3dAxisFolder, is3d]);
  useEffect(() => {
    if (y3dAxisFolder) is3d ? y3dAxisFolder.show() : y3dAxisFolder.hide();
  }, [y3dAxisFolder, is3d]);
  useEffect(() => {
    if (z3dAxisFolder) is3d ? z3dAxisFolder.show() : z3dAxisFolder.hide();
  }, [z3dAxisFolder, is3d]);

  // View folder (3D only, packet C3) — hidden entirely in 2D mode, the same
  // `.hide()`/`.show()` idiom the Terminal folder below already uses for
  // its own target gating. `is3d` itself is hoisted above (the Charset
  // row's own dim-with-reason needs it too).
  const view = useFolder(gui, "View", { open: true });
  useEffect(() => {
    if (view) is3d ? view.show() : view.hide();
  }, [view, is3d]);
  const orbitModeSlot = useDockSlot(view, { position: "bottom", className: "dock-toggle-row-slot" });
  const resetCameraSlot = useDockSlot(view, { position: "bottom", className: "dock-toggle-row-slot" });
  const styleSlot = useDockSlot(view, { position: "bottom", className: "dock-toggle-row-slot" });
  const shadingSlot = useDockSlot(view, { position: "bottom", className: "dock-toggle-row-slot" });
  const colorscaleSlot = useDockSlot(view, { position: "bottom", className: "dock-toggle-row-slot" });
  // Guide toggles (packet C4, item 1) — plain `useToggle` boolean rows, the
  // same primitive the Axes folder's own "X grid"/"X tick marks" rows use.
  // `guideValue`/`setGuide` avoid retyping the `?? CHARTS_3D_GUIDE_DEFAULTS`
  // fallback and the `set-3d-guides` dispatch 8 times over.
  const guideValue = (key: keyof Charts3dGuideOptions) => state.chart3d.guides[key] ?? CHARTS_3D_GUIDE_DEFAULTS[key];
  const setGuide = (key: keyof Charts3dGuideOptions) => (value: boolean) =>
    dispatch({ type: "set-3d-guides", patch: { [key]: value } });
  useToggle(view, "Axis lines", guideValue("axisLines"), setGuide("axisLines"));
  useToggle(view, "Ticks", guideValue("ticks"), setGuide("ticks"));
  useToggle(view, "Tick labels", guideValue("tickLabels"), setGuide("tickLabels"));
  useToggle(view, "Axis titles", guideValue("titles"), setGuide("titles"));
  useToggle(view, "Wall grid", guideValue("grid"), setGuide("grid"));
  useToggle(view, "Floor grid", guideValue("floorGrid"), setGuide("floorGrid"));
  useToggle(view, "Wall outline", guideValue("walls"), setGuide("walls"));
  useToggle(view, "Box outline", guideValue("box"), setGuide("box"));

  const terminal = useFolder(gui, "Terminal", { open: true });
  useToggle(terminal, "NO_COLOR", state.terminal.NO_COLOR, (value) =>
    dispatch({ type: "set-terminal", flag: "NO_COLOR", value }),
  );
  useToggle(terminal, "FORCE_COLOR", state.terminal.FORCE_COLOR, (value) =>
    dispatch({ type: "set-terminal", flag: "FORCE_COLOR", value }),
  );
  useEffect(() => {
    if (terminal) controls.target === "terminal" ? terminal.show() : terminal.hide();
  }, [terminal, controls.target]);

  return (
    <>
      <Instrument3DEffectsFolder
        gui={gui}
        effectIds={CHARTS_3D_EFFECT_IDS}
        targets={CHARTS_3D_EFFECT_TARGETS}
        allTargetsLabel="Whole chart"
        state={{ effectId: state.effect3d.effectId, targetId: state.effect3d.targetId }}
        onChange={(patch) => dispatch({ type: "set-effect3d", patch })}
        visible={is3d}
      />
      {targetSlot &&
        createPortal(
          <div className="dock-toggle-row">
            <span className="dock-toggle-row-label">Target</span>
            <IconToggle
              groupTitle="Output target"
              options={TARGET_TOGGLE}
              value={controls.target}
              onChange={(v) => setControl({ type: "target", value: v as GlyphChartTarget })}
            />
          </div>,
          targetSlot,
        )}
      {charsetSlot &&
        createPortal(
          <div className="dock-toggle-row">
            <span className="dock-toggle-row-label">Charset</span>
            <IconToggle
              groupTitle="Character set"
              options={charsetToggle}
              value={controls.charset}
              onChange={(v) => setControl({ type: "charset", value: v as GlyphChartCharset })}
            />
          </div>,
          charsetSlot,
        )}
      {colorSlot &&
        createPortal(
          <div className="dock-toggle-row">
            <span className="dock-toggle-row-label">Color</span>
            <IconToggle
              groupTitle="Color mode — independent of target"
              options={COLOR_TOGGLE}
              value={controls.color}
              onChange={(v) => setControl({ type: "color", value: v as GlyphChartColorMode })}
            />
          </div>,
          colorSlot,
        )}
      {detailSlot &&
        createPortal(
          <div className="dock-toggle-row">
            <span className="dock-toggle-row-label">Detail</span>
            <IconToggle
              groupTitle="Layout detail"
              options={DETAIL_TOGGLE}
              value={controls.detail ?? "auto"}
              onChange={(v) => setControl({ type: "detail", value: v as GlyphChartDetail })}
            />
          </div>,
          detailSlot,
        )}
      {titlePlacementSlot &&
        createPortal(
          <div className="dock-toggle-row">
            <span className="dock-toggle-row-label">Title at</span>
            <IconToggle
              groupTitle="Title horizontal alignment"
              options={TITLE_ALIGN_TOGGLE}
              value={state.chart.titleAlign}
              onChange={(titleAlign) =>
                dispatch({
                  type: "set-chart",
                  patch: { titleAlign: titleAlign as ChartsWorkbenchState["chart"]["titleAlign"] },
                })
              }
            />
            <IconToggle
              groupTitle="Title row position"
              options={TITLE_POSITION_TOGGLE}
              value={state.chart.titlePosition}
              onChange={(titlePosition) =>
                dispatch({
                  type: "set-chart",
                  patch: { titlePosition: titlePosition as ChartsWorkbenchState["chart"]["titlePosition"] },
                })
              }
            />
          </div>,
          titlePlacementSlot,
        )}
      {legendPlacementSlot &&
        createPortal(
          <div className="dock-toggle-row">
            <span className="dock-toggle-row-label">Legend at</span>
            <IconToggle
              groupTitle="Legend placement"
              options={LEGEND_TOGGLE}
              value={state.chart.legendPlacement}
              onChange={(legendPlacement) =>
                dispatch({
                  type: "set-chart",
                  patch: { legendPlacement: legendPlacement as ChartsWorkbenchState["chart"]["legendPlacement"] },
                })
              }
            />
          </div>,
          legendPlacementSlot,
        )}
      {regionFillSlot &&
        createPortal(
          <div className="dock-toggle-row" title={regionFillStatus?.inapplicable ?? regionFillToggle[0]!.desc}>
            <span className="dock-toggle-row-label">Textures</span>
            <IconToggle
              groupTitle="Fill textures"
              options={regionFillToggle}
              value={state.style.regionFill ?? "auto"}
              onChange={(value) =>
                dispatch({ type: "set-region-fill", value: value as (typeof CHART_REGION_FILLS)[number] })
              }
            />
          </div>,
          regionFillSlot,
        )}
      {!is3d &&
        axisColorSlot &&
        createPortal(
          <div className="charts-axis-color">
            <div className="dock-toggle-row">
              <span className="dock-toggle-row-label">Axes</span>
              <ChoiceButton
                type="button"
                className={`charts-axis-color-mode${state.style.axisColor.mode === "per-axis" ? " is-active" : ""}`}
                aria-pressed={state.style.axisColor.mode === "per-axis"}
                title="Toggle between one shared axis colour and separate X/Y swatches"
                onClick={() =>
                  dispatch({
                    type: "set-axis-color-mode",
                    mode:
                      state.style.axisColor.mode === CHART_AXIS_COLOR_MODES[0]
                        ? CHART_AXIS_COLOR_MODES[1]
                        : CHART_AXIS_COLOR_MODES[0],
                  })
                }
              >
                {AXIS_COLOR_MODE_LABEL[state.style.axisColor.mode]}
              </ChoiceButton>
            </div>
            {state.style.axisColor.mode === "shared" ? (
              <ColorSwatch
                label="Colour"
                value={state.style.axisColor.shared}
                onChange={(color) => dispatch({ type: "set-axis-color", which: "shared", color })}
                disabled={colorDisabled}
                disabledReason={colorDisabledReason}
              />
            ) : (
              <>
                <ColorSwatch
                  label="X"
                  value={state.style.axisColor.x}
                  onChange={(color) => dispatch({ type: "set-axis-color", which: "x", color })}
                  disabled={colorDisabled}
                  disabledReason={colorDisabledReason}
                />
                <ColorSwatch
                  label="Y"
                  value={state.style.axisColor.y}
                  onChange={(color) => dispatch({ type: "set-axis-color", which: "y", color })}
                  disabled={colorDisabled}
                  disabledReason={colorDisabledReason}
                />
              </>
            )}
          </div>,
          axisColorSlot,
        )}
      {/* Gated on !is3d — the Scales folder itself is hidden then (user
        report: two "X domain" rows on screen, one inert), and this keeps
        no `ScaleDomainControl` mounted underneath it either. */}
      {!is3d &&
        xDomainSlot &&
        createPortal(
          <ScaleDomainControl
            axis="x"
            scale={state.scales.x}
            inferred={inferredDomains.x}
            zeroAnchored={false}
            hasCartesianScale={hasCartesianScale}
            unfit={unfitOf("x")}
            timePrecision={timePrecision.x}
            dispatch={dispatch}
          />,
          xDomainSlot,
        )}
      {!is3d &&
        yDomainSlot &&
        createPortal(
          <ScaleDomainControl
            axis="y"
            scale={state.scales.y}
            inferred={inferredDomains.y}
            zeroAnchored={zeroAnchoredY}
            hasCartesianScale={hasCartesianScale}
            unfit={unfitOf("y")}
            timePrecision={timePrecision.y}
            dispatch={dispatch}
          />,
          yDomainSlot,
        )}
      {is3d &&
        x3dDomainSlot &&
        createPortal(
          <Charts3dAxisDomainRow
            label="X"
            axis="x"
            override={state.chart3d.axes.x.domain}
            resolved={resolved3dAxes?.x}
            dispatch={dispatch}
          />,
          x3dDomainSlot,
        )}
      {is3d &&
        y3dDomainSlot &&
        createPortal(
          <Charts3dAxisDomainRow
            label="Y"
            axis="y"
            override={state.chart3d.axes.y.domain}
            resolved={resolved3dAxes?.y}
            dispatch={dispatch}
          />,
          y3dDomainSlot,
        )}
      {is3d &&
        z3dDomainSlot &&
        createPortal(
          <Charts3dAxisDomainRow
            label="Z"
            axis="z"
            override={state.chart3d.axes.z.domain}
            resolved={resolved3dAxes?.z}
            dispatch={dispatch}
          />,
          z3dDomainSlot,
        )}
      {is3d &&
        x3dTitleAtSlot &&
        createPortal(
          <div className="dock-toggle-row">
            <span className="dock-toggle-row-label">X title at (3D)</span>
            <IconToggle
              groupTitle="X axis title placement (3D)"
              options={CHARTS_3D_AXIS_TITLE_AT_TOGGLE}
              value={state.chart3d.axes.x.titleAt ?? "end"}
              onChange={(value) =>
                dispatch({
                  type: "set-3d-axis",
                  axis: "x",
                  patch: { titleAt: value as Charts3dAxisOverride["titleAt"] },
                })
              }
            />
          </div>,
          x3dTitleAtSlot,
        )}
      {is3d &&
        y3dTitleAtSlot &&
        createPortal(
          <div className="dock-toggle-row">
            <span className="dock-toggle-row-label">Y title at (3D)</span>
            <IconToggle
              groupTitle="Y axis title placement (3D)"
              options={CHARTS_3D_AXIS_TITLE_AT_TOGGLE}
              value={state.chart3d.axes.y.titleAt ?? "end"}
              onChange={(value) =>
                dispatch({
                  type: "set-3d-axis",
                  axis: "y",
                  patch: { titleAt: value as Charts3dAxisOverride["titleAt"] },
                })
              }
            />
          </div>,
          y3dTitleAtSlot,
        )}
      {is3d &&
        z3dTitleAtSlot &&
        createPortal(
          <div className="dock-toggle-row">
            <span className="dock-toggle-row-label">Z title at (3D)</span>
            <IconToggle
              groupTitle="Z axis title placement (3D)"
              options={CHARTS_3D_AXIS_TITLE_AT_TOGGLE}
              value={state.chart3d.axes.z.titleAt ?? "end"}
              onChange={(value) =>
                dispatch({
                  type: "set-3d-axis",
                  axis: "z",
                  patch: { titleAt: value as Charts3dAxisOverride["titleAt"] },
                })
              }
            />
          </div>,
          z3dTitleAtSlot,
        )}
      {!is3d &&
        xTitleAtSlot &&
        createPortal(
          <div className="dock-toggle-row">
            <span className="dock-toggle-row-label">X title at</span>
            <IconToggle
              groupTitle="X axis title placement"
              options={AXIS_X_TITLE_AT_TOGGLE}
              value={state.style.axisTitlePlacement.x}
              onChange={(value) =>
                dispatch({
                  type: "set-axis-title-at",
                  axis: "x",
                  value: value as ChartsWorkbenchState["style"]["axisTitlePlacement"]["x"],
                })
              }
            />
          </div>,
          xTitleAtSlot,
        )}
      {!is3d &&
        yTitleAtSlot &&
        createPortal(
          <div className="dock-toggle-row">
            <span className="dock-toggle-row-label">Y title at</span>
            <IconToggle
              groupTitle="Y axis title placement"
              options={AXIS_Y_TITLE_AT_TOGGLE}
              value={state.style.axisTitlePlacement.y}
              onChange={(value) =>
                dispatch({
                  type: "set-axis-title-at",
                  axis: "y",
                  value: value as ChartsWorkbenchState["style"]["axisTitlePlacement"]["y"],
                })
              }
            />
          </div>,
          yTitleAtSlot,
        )}
      {orbitModeSlot &&
        createPortal(
          <div className="dock-toggle-row">
            <span className="dock-toggle-row-label">Rotate</span>
            <IconToggle
              groupTitle="Orbit mode"
              options={CHARTS_3D_ORBIT_MODE_TOGGLE}
              value={state.chart3d.orbitMode}
              onChange={(value) =>
                dispatch({
                  type: "set-3d-view",
                  patch: { orbitMode: value as ChartsWorkbenchState["chart3d"]["orbitMode"] },
                })
              }
            />
          </div>,
          orbitModeSlot,
        )}
      {resetCameraSlot &&
        createPortal(
          <div className="dock-toggle-row">
            <span className="dock-toggle-row-label">Camera</span>
            <ChoiceButton
              type="button"
              className="gx-toggle-btn gx-toggle-text charts-3d-reset-camera"
              title="Reset the camera to the default framing"
              onClick={() => chart3dViewportHandleRef?.current?.resetCamera()}
            >
              Reset
            </ChoiceButton>
          </div>,
          resetCameraSlot,
        )}
      {styleSlot &&
        createPortal(
          <div className="dock-toggle-row">
            <span className="dock-toggle-row-label">Style</span>
            <IconToggle
              groupTitle="Render style"
              options={CHARTS_3D_STYLE_TOGGLE}
              value={state.chart3d.style}
              onChange={(value) =>
                dispatch({ type: "set-3d-view", patch: { style: value as ChartsWorkbenchState["chart3d"]["style"] } })
              }
            />
          </div>,
          styleSlot,
        )}
      {shadingSlot &&
        createPortal(
          <div className="dock-toggle-row">
            <span className="dock-toggle-row-label">Shading</span>
            <IconToggle
              groupTitle="Surface shading"
              options={CHARTS_3D_SHADING_TOGGLE}
              value={state.chart3d.shading}
              onChange={(value) =>
                dispatch({
                  type: "set-3d-view",
                  patch: { shading: value as ChartsWorkbenchState["chart3d"]["shading"] },
                })
              }
            />
          </div>,
          shadingSlot,
        )}
      {colorscaleSlot &&
        createPortal(
          <div className="dock-toggle-row">
            <span className="dock-toggle-row-label">Colorscale</span>
            <IconToggle
              groupTitle="Surface colorscale"
              options={CHARTS_3D_COLORSCALE_TOGGLE}
              value={state.chart3d.colorscale}
              onChange={(value) =>
                dispatch({
                  type: "set-3d-view",
                  patch: { colorscale: value as ChartsWorkbenchState["chart3d"]["colorscale"] },
                })
              }
            />
          </div>,
          colorscaleSlot,
        )}
    </>
  );
}
