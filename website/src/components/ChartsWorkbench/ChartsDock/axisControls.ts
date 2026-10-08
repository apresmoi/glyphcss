import { type GlyphChart3dResolvedAxis } from "@glyphcss/charts/3d";
import type { GUI } from "lil-gui";
import { type Dispatch, useEffect } from "react";
import type { Charts3dAxisOverride } from "../../../features/charts/model/chartsWorkbench3d";
import {
  type ChartsWorkbenchAction,
  CHARTS_3D_AXIS_FORMAT_NAMES,
} from "../../../features/charts/model/chartsWorkbenchState";
import { useColor, useDockSlot, useFolder, useOption, useSlider, useText, useToggle } from "../../Dock";
import { AXIS_TITLE_OFFSET_DEFAULT } from "./options";

// Ticks row (owner packet item 1) — an "X ticks: auto" boolean plus an
// "X ticks" number slider, built with the SAME `useToggle`/`useSlider`
// primitives the Width/Height rows use (REVIEW-dock-addenda-opus.md P2-1/
// P2-3): real lil-gui controllers, not classes borrowed from a two-thumb
// `RangeSlider`. That gets the identical bar/field/inset for free — same
// `.controller.number`/`.controller.boolean` rules `gallery-workbench.css`
// already gives Width/Height and every other real row — and fixes the
// typed-input clamping for the same reason: lil-gui's own `NumberController`
// only rewrites the input's DISPLAYED text on `updateDisplay()`, gated on
// `!this._inputFocused`, so a value typed mid-focus is never fought by a
// controlled-React rewrite the way the old custom `<input value={shown}>`
// was — "12" commits as 12, not 22. It also gives the auto checkbox the
// theme's real focus ring (`.controller.boolean input:focus-visible`) and
// the disabled slider row the theme's real `.controller.disabled .name`
// dimming, both for free, since there is no longer a bespoke class fighting
// the theme's own `!important` rules for either (P3-4).
const CHART_TICKS_MIN = 2;

const CHART_TICKS_MAX = 40;

export function useTicksControl(
  folder: GUI | null,
  axis: "x" | "y",
  ticks: number,
  actualTicks: number | undefined,
  dispatch: Dispatch<ChartsWorkbenchAction>,
  visible = true,
): void {
  const AXIS = axis.toUpperCase();
  const auto = ticks === 0;
  // Unchecking auto seeds the slider from the axis's own last-rendered
  // tick count (`chartsWorkbenchActualTicks`'s own doc) — grounded in what
  // the reader can currently see, never a guessed flat number — clamped
  // only as the last-resort floor for the rare grid this can't read a
  // count off at all (REVIEW-dock-addenda-opus.md P2-2).
  const seed = Math.max(CHART_TICKS_MIN, Math.min(CHART_TICKS_MAX, actualTicks ?? CHART_TICKS_MIN));
  const autoCtrl = useToggle(folder, `${AXIS} ticks: auto`, auto, (checked) =>
    dispatch({ type: "set-axis", axis, patch: { ticks: checked ? 0 : seed } }),
  );
  const shown = auto ? seed : ticks;
  const sliderCtrl = useSlider(
    folder,
    `${AXIS} ticks`,
    { min: CHART_TICKS_MIN, max: CHART_TICKS_MAX, step: 1 },
    shown,
    (value) => dispatch({ type: "set-axis", axis, patch: { ticks: value } }),
  );
  useEffect(() => {
    sliderCtrl?.setEnabled(!auto);
  }, [sliderCtrl, auto]);
  // The X/Y axis subgroup's own folder is hidden/shown as a whole
  // (`ChartsDock`'s own per-axis `useFolder`/`.hide()`/`.show()` call) —
  // this per-control toggle stays too, redundant with the ancestor's own
  // `display: none` but load-bearing for jsdom, which has no layout engine
  // and so never reflects ancestor-hidden state on a DESCENDANT's own
  // `getComputedStyle().display` (`Charts3dViewport.lifecycle.test.tsx`'s
  // own visibility assertions read each control's OWN computed style).
  useEffect(() => {
    autoCtrl?.setVisible(visible);
    sliderCtrl?.setVisible(visible);
  }, [autoCtrl, sliderCtrl, visible]);
  // Clearing the number field goes back to auto — never `Number("") === 0`
  // (AGENTS.md's own rule for this page's other number fields). lil-gui's
  // own `NumberController` leaves an emptied field's `input` a no-op (it
  // parses with `parseFloat` and bails on `NaN`, never calling `onChange`)
  // and its own `blur` handler just restores the last COMMITTED number —
  // lil-gui has no "emptied means something" concept of its own, so this
  // page's own input-tracking + blur listener supplies it, watching the
  // typed text directly rather than the DOM value at blur time (lil-gui's
  // own blur listener, registered first at construction, has already
  // restored that by the time a second listener on the same element runs).
  useEffect(() => {
    const input = sliderCtrl?.raw.domElement.querySelector("input");
    if (!input) return;
    let emptied = false;
    const onInput = () => {
      emptied = input.value.trim() === "";
    };
    const onBlur = () => {
      if (emptied) {
        emptied = false;
        dispatch({ type: "set-axis", axis, patch: { ticks: 0 } });
      }
    };
    input.addEventListener("input", onInput);
    input.addEventListener("blur", onBlur);
    return () => {
      input.removeEventListener("input", onInput);
      input.removeEventListener("blur", onBlur);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sliderCtrl, axis]);
}

/**
 * Forces a per-axis subgroup folder ("X axis", "X axis (3D)", …) open and
 * keeps it that way — user feedback, verbatim: "the axes section in the
 * sidebar, I dont want them to be collapsable... maybe we could have all
 * of them opened by separated by sections and have some basic props by
 * axis, and then have a 'more v' or advanced that shows you more configs
 * for that axis". The outer "Axes" folder stays an ordinary collapsible
 * top-level folder (untouched, like Output/Chart/Scales); only the
 * per-axis SECTIONS nested inside it become inert headings.
 *
 * lil-gui's own toggle listener is bound directly to `folder.$title` in
 * its constructor (`this.$title.addEventListener('click', ...)`), so it
 * can't be removed from the outside. A CAPTURE-phase listener on the
 * folder's own ROOT element intercepts the click before it: a capture-
 * phase listener on an ANCESTOR always runs before any listener on a
 * descendant TARGET, regardless of registration order, so `stopPropagation`
 * here stops the event before it ever reaches `$title`'s own bubble-phase
 * listener. Scoped to a click that actually lands inside `.title` — the
 * folder-title-bar `[reset]` button (`useFolderTitleReset`) is a DOM
 * SIBLING of `.title`, never a descendant, so it's untouched either way.
 * `.charts-axis-section` (charts-workbench.css) strips the caret/hover/
 * cursor affordance so the title reads as a heading, not a control.
 */
export function useAxisSectionFolder(folder: GUI | null): void {
  useEffect(() => {
    if (!folder) return;
    folder.open();
    folder.domElement.classList.add("charts-axis-section");
    const onCapture = (e: MouseEvent) => {
      if (folder.$title.contains(e.target as Node)) e.stopPropagation();
    };
    folder.domElement.addEventListener("click", onCapture, true);
    return () => {
      folder.domElement.removeEventListener("click", onCapture, true);
      folder.domElement.classList.remove("charts-axis-section");
    };
  }, [folder]);
}

const CHARTS_3D_AXIS_FORMAT_OPTIONS: Record<string, string> = Object.fromEntries(
  ["auto", ...CHARTS_3D_AXIS_FORMAT_NAMES].map((v) => [v, v]),
);

/**
 * One 3D axis's full row set (packet C6, coordinator addendum; split into a
 * BASIC section plus a collapsible "More" subfolder by the "axes sidebar"
 * packet — user feedback, verbatim: "have some basic props by axis, and
 * then have a 'more v' or advanced that shows you more configs for that
 * axis"). `folder` is the axis's own always-open section (`ChartsDock`'s
 * `useAxisSectionFolder`) and gets ONLY title + ticks (auto + slider,
 * seeded off the axis's own ACTUAL resolved tick count, mirroring
 * `useTicksControl`'s idiom exactly) — the domain range slider lives there
 * too, but is built by the CALLER (`Charts3dAxisDomainRow`, a React
 * component, not a plain lil-gui row) into the `domainSlot` this function
 * returns. Every other row — the tick-format preset, four visibility
 * toggles seeded from the axis's own FULLY RESOLVED visibility
 * (`GlyphChart3dResolvedAxis.lineVisible`/etc. — already the library-
 * default-then-guide-then-axis-override chain, so the shown value is
 * always what the reader is currently looking at), the colour swatch, and
 * the title-placement pair — is ADVANCED and goes into a nested "More"
 * folder this function creates as the LAST child of `folder`, so it sits
 * below the basic rows and the domain slot. Every row's own label still
 * carries a "(3D)" suffix so it never collides with the 2D row of the same
 * name mounted alongside it in the identical outer "Axes" folder (only one
 * of the two sets is ever visible at a time, but both always exist as real
 * DOM rows), toggled `.setVisible(visible)` together regardless of which
 * of the two folders each control actually lives in — mirrors
 * `useTicksControl`'s own `visible` parameter.
 *
 * Writing a visibility toggle or colour ALWAYS sets an explicit override —
 * there is no separate "[reset] back to auto" control for these two kinds
 * of row (a documented, bounded simplification; text/ticks/format/domain
 * all keep a real "auto" path). A future increment can add one without
 * changing this function's own shape.
 */
export function use3dAxisControls(
  folder: GUI | null,
  axisLabel: "X" | "Y" | "Z",
  axisKey: "x" | "y" | "z",
  override: Charts3dAxisOverride,
  resolved: GlyphChart3dResolvedAxis | undefined,
  visible: boolean,
  colorDisabled: boolean,
  colorDisabledReason: string | undefined,
  dispatch: Dispatch<ChartsWorkbenchAction>,
): { domainSlot: HTMLDivElement | null; titleAtSlot: HTMLDivElement | null } {
  const patch = (p: Partial<Charts3dAxisOverride>) => dispatch({ type: "set-3d-axis", axis: axisKey, patch: p });

  // Basic: title, ticks, and (via the returned slot) the domain range.
  const titleCtrl = useText(folder, `${axisLabel} title (3D)`, override.title ?? "", (title) => patch({ title }));

  const ticksAuto = override.ticks === undefined;
  const ticksSeed = Math.max(CHART_TICKS_MIN, Math.min(CHART_TICKS_MAX, resolved?.ticks.length ?? 5));
  const ticksAutoCtrl = useToggle(folder, `${axisLabel} ticks: auto (3D)`, ticksAuto, (checked) =>
    patch({ ticks: checked ? undefined : ticksSeed }),
  );
  const ticksShown = ticksAuto ? ticksSeed : override.ticks!;
  const ticksCtrl = useSlider(
    folder,
    `${axisLabel} ticks (3D)`,
    { min: CHART_TICKS_MIN, max: CHART_TICKS_MAX, step: 1 },
    ticksShown,
    (value) => patch({ ticks: value }),
  );
  useEffect(() => {
    ticksCtrl?.setEnabled(!ticksAuto);
  }, [ticksCtrl, ticksAuto]);

  const domainSlot = useDockSlot(folder, { position: "bottom", className: "charts-scale-domain-slot" });

  // Advanced: everything else, in a collapsed "More" subfolder — created
  // AFTER the basic rows/slot above so it lands as the LAST child of
  // `folder` (a `useDockSlot`/controller call always appends at the
  // current end of the parent's own children, so call ORDER is visual
  // order here, same as everywhere else in this file).
  const moreFolder = useFolder(folder, "More", { open: false });

  const formatCtrl = useOption(
    moreFolder,
    `${axisLabel} format (3D)`,
    CHARTS_3D_AXIS_FORMAT_OPTIONS,
    override.format ?? "auto",
    (value) => patch({ format: value === "auto" ? undefined : value }),
  );

  const lineCtrl = useToggle(
    moreFolder,
    `${axisLabel} line (3D)`,
    override.line ?? resolved?.lineVisible ?? true,
    (line) => patch({ line }),
  );
  const tickMarksCtrl = useToggle(
    moreFolder,
    `${axisLabel} tick marks (3D)`,
    override.tickMarks ?? resolved?.tickMarksVisible ?? true,
    (tickMarks) => patch({ tickMarks }),
  );
  const tickLabelsCtrl = useToggle(
    moreFolder,
    `${axisLabel} tick labels (3D)`,
    override.tickLabels ?? resolved?.tickLabelsVisible ?? true,
    (tickLabels) => patch({ tickLabels }),
  );
  const gridCtrl = useToggle(
    moreFolder,
    `${axisLabel} grid (3D)`,
    override.grid ?? resolved?.gridVisible ?? false,
    (grid) => patch({ grid }),
  );

  const colorCtrl = useColor(
    moreFolder,
    `${axisLabel} colour (3D)`,
    override.color ?? resolved?.color ?? "#7a7f8a",
    (color) => patch({ color }),
  );
  useEffect(() => {
    colorCtrl?.setEnabled(!colorDisabled);
    colorCtrl?.raw.domElement.setAttribute("title", colorDisabled ? (colorDisabledReason ?? "") : "");
  }, [colorCtrl, colorDisabled, colorDisabledReason]);

  // Axis title placement (user feedback, verbatim: "we need to be able to
  // configure the position of the title of the axis") — `titleAt` is an
  // IconToggle rendered by the caller into the returned `titleAtSlot`
  // (mirroring `domainSlot`'s own external-slot idiom) since every 3D axis
  // shares ONE start/center/end vocabulary, unlike 2D's x/y split;
  // `titleOffset` is a plain number slider seeded from the library's own
  // default (`0.6`, `AXIS_TITLE_OFFSET_DEFAULT`) when unset, right after it.
  const titleAtSlot = useDockSlot(moreFolder, { position: "bottom", className: "dock-toggle-row-slot" });
  const titleOffsetCtrl = useSlider(
    moreFolder,
    `${axisLabel} title offset (3D)`,
    { min: 0, max: 2, step: 0.05 },
    override.titleOffset ?? AXIS_TITLE_OFFSET_DEFAULT,
    (value) => patch({ titleOffset: value }),
  );

  useEffect(() => {
    for (const ctrl of [
      titleCtrl,
      ticksAutoCtrl,
      ticksCtrl,
      formatCtrl,
      lineCtrl,
      tickMarksCtrl,
      tickLabelsCtrl,
      gridCtrl,
      colorCtrl,
      titleOffsetCtrl,
    ])
      ctrl?.setVisible(visible);
  }, [
    titleCtrl,
    ticksAutoCtrl,
    ticksCtrl,
    formatCtrl,
    lineCtrl,
    tickMarksCtrl,
    tickLabelsCtrl,
    gridCtrl,
    colorCtrl,
    titleOffsetCtrl,
    visible,
  ]);

  return { domainSlot, titleAtSlot };
}
