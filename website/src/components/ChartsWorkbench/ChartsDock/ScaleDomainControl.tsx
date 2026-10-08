import { type GlyphChart3dResolvedAxis } from "@glyphcss/charts/3d";
import { useEffect, type Dispatch } from "react";
import { CHART_SCALE_TYPES, type ChartsWorkbenchScale } from "../../../features/charts/model/chartsSpec";
import {
  CHARTS_NO_SCALE_REASON,
  CHARTS_TIME_UNIT_MS,
  chartsDomainNumberDisplay,
  chartsIsoDateStamp,
  chartsNumberToScaleBound,
  chartsScaleBoundToNumber,
  chartsScaleSliderBounds,
  chartsTimeBoundDisplay,
  chartsTimeBoundFromDisplay,
  chartsTimeBoundSnap,
  chartsTimeDisplayPrecision,
  chartsTimePrecisionOf,
  type ChartsScaleTypeFitTable,
  type ChartsTimePrecision,
  type ChartsWorkbenchAction,
  type ChartsWorkbenchAxisDomain,
} from "../../../features/charts/model/chartsWorkbenchState";
import { type DockOptionController } from "../../Dock";
import { RangeCategorySelect, RangeSlider, rangeSliderStep, RangeUnavailable } from "../../RangeSlider";

/**
 * The Type select's own fit idiom (the mark card's Type toggle, `/maps`'
 * `mapDirectionLocked`): a scale type this axis's data can't carry is a
 * DISABLED option whose label carries the short reason and whose title
 * carries the full one (`chartsWorkbenchScaleTypeFits`). lil-gui builds the
 * `<option>`s itself and reads the choice by `selectedIndex` into its own
 * value list, drawing the closed display from its own name list — so
 * relabelling an option here changes only what the open list shows, never
 * the value lil-gui commits or displays. Options are in `CHART_SCALE_TYPES`
 * order because `useOption` built them from that same list.
 */
export function useScaleTypeFit(ctrl: DockOptionController<string> | null, fits: ChartsScaleTypeFitTable): void {
  useEffect(() => {
    const row = ctrl?.raw.domElement;
    const select = row?.querySelector("select");
    if (!row || !select) return;
    const unavailable: string[] = [];
    CHART_SCALE_TYPES.forEach((type, index) => {
      const option = select.options[index];
      if (!option) return;
      const fit = fits[type];
      option.disabled = !fit.fits;
      option.textContent = fit.fits ? type : `${type} — ${fit.short}`;
      option.title = fit.fits ? "" : fit.reason;
      if (!fit.fits) unavailable.push(`${type}: ${fit.reason}`);
    });
    row.title = unavailable.length ? `Not available for this data — ${unavailable.join(" ")}` : "";
  }, [ctrl, fits]);
}

/**
 * One axis's Scales domain control — always ONE lil-gui-shaped row: `.name`
 * "X domain" with its `[reset]`, then `.widget` (CHARTS-RESEARCH
 * `DIAGNOSIS-scale-rows-mark-card.md`). Its widget is:
 *
 * - numeric or time: a `RangeSlider` over the data extent;
 * - band: two compact category selects (`RangeCategorySelect`);
 * - nothing usable: `RangeUnavailable`, the short reason in the widget and
 *   the full one on its title, and no inputs at all. The Type select already
 *   disables a type the data can't carry (`unfit`), so only a legacy `?c=`
 *   link, bad mark data, or a chart with no x/y scale ever lands here.
 *
 * `scale.min`/`.max` stay the same strings `buildScale` reads; this control
 * only translates them to and from the slider's numeric domain.
 *
 * Slider BOUNDS come from `chartsScaleSliderBounds` (P1: never a flat pad
 * that can hand a bar/area/rect y-domain or a log domain an illegal
 * position — REVIEW-dock-colours-sliders-opus.md), widened past their own
 * padded range to include any already-typed override (P2-1: the two number
 * fields may exceed the visible bounds, and the slider re-derives around
 * them on the next render). A time axis additionally snaps its bounds OUT to
 * one calendar unit — the coarser of its data's and its span's
 * (`chartsTimeDisplayPrecision`) — and steps by it, so every thumb position
 * is a whole year (month, day) and the fields read "1980", not "1980-01-01"
 * cut to "198".
 */
export function ScaleDomainControl({
  axis,
  scale,
  inferred,
  zeroAnchored,
  hasCartesianScale,
  unfit,
  timePrecision = "day",
  dispatch,
}: {
  axis: "x" | "y";
  scale: ChartsWorkbenchScale;
  inferred: ChartsWorkbenchAxisDomain | undefined;
  zeroAnchored: boolean;
  hasCartesianScale: boolean;
  /** This axis's CURRENT type ruled out by `chartsWorkbenchScaleTypeFits`. */
  unfit?: { readonly short: string; readonly reason: string };
  /** The calendar unit every date on this axis sits on (`chartsWorkbenchAxisTimePrecision`). */
  timePrecision?: ChartsTimePrecision;
  dispatch: Dispatch<ChartsWorkbenchAction>;
}) {
  const label = `${axis.toUpperCase()} domain`;
  if (!hasCartesianScale)
    return <RangeUnavailable label={label} short="no x/y scale" reason={CHARTS_NO_SCALE_REASON} />;
  if (unfit) return <RangeUnavailable label={label} short={unfit.short} reason={unfit.reason} />;
  const resolvedType = scale.type === "auto" ? inferred?.type : scale.type;
  if (!inferred || resolvedType === undefined) {
    return <RangeUnavailable label={label} short="unreadable" reason="This axis's data can't be read as a scale." />;
  }
  if (inferred.domain.length < 2) {
    return <RangeUnavailable label={label} short="one value" reason="A single value has nothing to narrow." />;
  }
  if (resolvedType === "band") {
    // `buildScale`'s band branch throws on any bound that isn't a category
    // in data order, or on a pair that doesn't name at least two of them
    // (DIAGNOSIS-scale-domain.md P3-5). A `<select>` can only commit one of
    // its own options, and `RangeCategorySelect` disables every option that
    // would cross the other end — so neither failure is reachable from here.
    const categories = inferred.domain.map(String);
    const stamps = categories.map(chartsIsoDateStamp);
    const dates = stamps.every((stamp): stamp is number => stamp !== null) ? stamps : null;
    const datePrecision = dates ? chartsTimePrecisionOf(dates) : undefined;
    const display =
      dates && datePrecision
        ? (category: string) => chartsTimeBoundDisplay(dates[categories.indexOf(category)]!, datePrecision)
        : undefined;
    return (
      <RangeCategorySelect
        label={label}
        categories={categories}
        display={display}
        value={[scale.min.trim() || null, scale.max.trim() || null]}
        onSelect={(end, category) =>
          dispatch({ type: "set-scale", axis, patch: end === "lo" ? { min: category } : { max: category } })
        }
        onReset={() => dispatch({ type: "set-scale", axis, patch: { min: "", max: "" } })}
      />
    );
  }
  const type = resolvedType as "linear" | "log" | "sqrt" | "time";
  const toNumber = (v: number | string | Date) => (v instanceof Date ? v.getTime() : Number(v));
  const domainMin = toNumber(inferred.domain[0]!);
  const domainMax = toNumber(inferred.domain.at(-1)!);
  const bounds = chartsScaleSliderBounds(type, domainMin, domainMax, zeroAnchored);
  const explicitLo = scale.min.trim() ? chartsScaleBoundToNumber(type, scale.min) : null;
  const explicitHi = scale.max.trim() ? chartsScaleBoundToNumber(type, scale.max) : null;
  let min = explicitLo !== null ? Math.min(bounds.min, explicitLo) : bounds.min;
  let max = explicitHi !== null ? Math.max(bounds.max, explicitHi) : bounds.max;
  // A time row shows, steps and snaps at ONE unit (`chartsTimeDisplayPrecision`),
  // so a thumb can never sit between two values its fields can show.
  const shown = type === "time" ? chartsTimeDisplayPrecision(timePrecision, domainMax - domainMin) : undefined;
  const unit = shown && shown !== "time" ? CHARTS_TIME_UNIT_MS[shown] : undefined;
  if (shown && unit !== undefined) {
    min = chartsTimeBoundSnap(min, shown, "floor");
    max = chartsTimeBoundSnap(max, shown, "ceil");
  }
  const step = unit ?? rangeSliderStep(min, max);
  const format = (n: number) => (shown ? chartsTimeBoundDisplay(n, shown) : chartsDomainNumberDisplay(n, step));
  const describe = type === "time" ? (n: number) => chartsTimeBoundDisplay(n, timePrecision) : undefined;
  const parse = (raw: string) =>
    type === "time" ? chartsTimeBoundFromDisplay(raw) : Number.isFinite(Number(raw)) ? Number(raw) : null;
  const snap = shown && unit !== undefined ? (n: number) => chartsTimeBoundSnap(n, shown) : undefined;
  const value: readonly [number | null, number | null] | null =
    scale.min.trim() || scale.max.trim() ? [explicitLo, explicitHi] : null;
  // NEW-1/NEW-4 (REVIEW-dock-colours-sliders-opus-round2.md): a TYPED value
  // that would need `loFloor`/`loCeiling`/`hiFloor` to clamp it is refused
  // outright, with this reason shown inline, rather than silently
  // substituted — the log rule (`bounds.loFloor`, this axis's own sign/
  // zero-exclusion cap) and the zero-anchored rule (`bounds.loCeiling`/
  // `hiFloor`) are the only two ways this control ever caps a thumb, so one
  // reason string per axis covers both (they're mutually exclusive — see
  // `chartsScaleSliderBounds`).
  const capReason =
    type === "log"
      ? "A log domain must have one sign and exclude zero."
      : zeroAnchored
        ? "A bar, area, or rect chart's Y domain must include zero."
        : undefined;
  return (
    <RangeSlider
      label={label}
      min={min}
      max={max}
      step={step}
      domain={[domainMin, domainMax]}
      loFloor={bounds.loFloor}
      loCeiling={bounds.loCeiling}
      hiFloor={bounds.hiFloor}
      capReason={capReason}
      value={value}
      format={format}
      parse={parse}
      describe={describe}
      snap={snap}
      onChange={(next) =>
        dispatch({
          type: "set-scale",
          axis,
          patch:
            next === null
              ? { min: "", max: "" }
              : {
                  min: next[0] === null ? "" : chartsNumberToScaleBound(type, next[0]),
                  max: next[1] === null ? "" : chartsNumberToScaleBound(type, next[1]),
                },
        })
      }
    />
  );
}

/**
 * A 3D axis's own domain row (packet C6, coordinator addendum) — MUCH
 * simpler than the 2D `ScaleDomainControl` above: a 3D axis domain is
 * ALWAYS plain finite linear numbers (`GlyphChart3dResolvedAxis.domain`),
 * never log/time/zero-anchored, so none of that control's own
 * `loFloor`/`loCeiling`/`capReason` machinery applies. Bounds are the
 * resolved axis's own NICE domain padded +/-20%, mirroring 2D's own
 * padding convention (`chartsScaleSliderBounds`'s ordinary-scale case).
 * Either end left `null` (cleared) reverts BOTH ends to auto — the
 * library's own `GlyphChart3dAxisOptions.domain` is one atomic `[min, max]`
 * tuple with no partial-override shape, unlike 2D's independently-nullable
 * min/max (a documented, bounded simplification). `resolved === undefined`
 * (no 3D mark currently resolved, e.g. mid-error) disables the row rather
 * than guessing bounds.
 */
export function Charts3dAxisDomainRow({
  label,
  override,
  resolved,
  dispatch,
  axis,
}: {
  label: string;
  axis: "x" | "y" | "z";
  override: readonly [number, number] | undefined;
  resolved: GlyphChart3dResolvedAxis | undefined;
  dispatch: Dispatch<ChartsWorkbenchAction>;
}) {
  if (!resolved)
    return (
      <RangeUnavailable label={`${label} domain`} short="unresolved" reason="No 3D chart is currently resolved." />
    );
  const [dataMin, dataMax] = resolved.domain;
  const span = dataMax - dataMin || 1;
  const min = dataMin - span * 0.2;
  const max = dataMax + span * 0.2;
  const step = rangeSliderStep(min, max);
  const value: readonly [number | null, number | null] = override ? [override[0], override[1]] : [null, null];
  return (
    <RangeSlider
      label={`${label} domain`}
      min={min}
      max={max}
      step={step}
      domain={[dataMin, dataMax]}
      value={value}
      format={(n) => chartsDomainNumberDisplay(n, step)}
      onChange={(next) =>
        dispatch({
          type: "set-3d-axis",
          axis,
          // `RangeSlider` commits ONE end per gesture (each end independently
          // nullable, `ScaleDomainControl`'s own contract), while the library's
          // `GlyphChart3dAxisOptions.domain` is one atomic `[min, max]` tuple.
          // Dragging a single thumb therefore used to arrive as `[n, null]` and
          // resolve to `undefined` — the domain silently never applied (reported:
          // "the domains of the 3d axes cannot be modified"). Fill the untouched
          // end from the axis's own resolved domain instead; BOTH ends cleared
          // still reverts to auto.
          patch: {
            domain:
              !next || (next[0] === null && next[1] === null)
                ? undefined
                : [next[0] ?? override?.[0] ?? dataMin, next[1] ?? override?.[1] ?? dataMax],
          },
        })
      }
    />
  );
}
