import { useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import "./instrument-workbench.css";

/** A "nice" step (1/2/5 x a power of ten) sized so ~100 steps span the range —
 *  the same rounding family d3's own `scale.ticks` uses for tick spacing. */
export function rangeSliderStep(min: number, max: number): number {
  const span = max - min;
  if (!Number.isFinite(span) || span <= 0) return 1;
  const raw = span / 100;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  const nice = n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10;
  return nice * pow;
}

export interface RangeSliderProps {
  /** The slider's own draggable/display BOUNDS — e.g. the data extent
   *  padded 20% and (for a zero-anchored bar/area/rect y-domain or a log
   *  scale) already narrowed to a set every thumb position keeps LEGAL. A
   *  caller committing a value outside these bounds (the two number fields
   *  accept any finite value — see P2-1) is expected to WIDEN `min`/`max`
   *  on its own next render so the slider re-derives its bounds around it. */
  min: number;
  max: number;
  /** The actual current/inferred domain, unpadded — what an emptied end
   *  reverts to (its own per-end "no override" fallback). Defaults to
   *  `[min, max]` when omitted. */
  domain?: readonly [number, number];
  /** Current selection: `null` = fully auto (both ends inferred); otherwise
   *  a pair where either end may itself be `null` — "this end is inferred,
   *  the other is explicit" — or a concrete number. */
  value: readonly [number | null, number | null] | null;
  onChange: (value: readonly [number | null, number | null] | null) => void;
  /** The LOW thumb's own reachable ceiling (never higher, whatever `max`
   *  allows) — a bar/area/rect y-domain pins this to `0` so no thumb
   *  position can ever push the domain's minimum above zero. */
  loCeiling?: number;
  /** The sign-exclusion cap for BOTH ends' commits — a log scale pins this
   *  to a small value, DERIVED FROM THE DOMAIN'S OWN SIGN, so no commit on
   *  EITHER thumb (a keyboard nudge's silent clamp, or a TYPED value
   *  refused via `capReason`) can ever cross zero, which trips the
   *  library's own `log-domain` rule (NEW-1, REVIEW-dock-colours-sliders-
   *  opus-round2.md — a log domain must keep one sign on BOTH ends, not
   *  just the minimum). A POSITIVE value is a FLOOR (`Math.max`, as for an
   *  ordinary positive-domain log scale); a NEGATIVE value is a CEILING
   *  (`Math.min`) for a domain that is entirely negative — a positive
   *  `Math.max` floor there would push every negative value UP to a
   *  positive one instead of merely keeping it away from zero (the
   *  reported `[null, 5e-324]` corruption of a typed negative bound).
   *  Never a native `min`/`max` HTML attribute, unlike `loCeiling`/
   *  `hiFloor` below — the outer padded `min`/`max` already sit
   *  comfortably on the legal side of zero for a legal log domain, so DRAG
   *  never needed an extra cap on either thumb; adding one there would
   *  only pull that thumb's browser-computed position away from the
   *  visual fill bar's, which shares `min`/`max`, not `loFloor`. */
  loFloor?: number;
  /** The HIGH thumb's OWN reachable floor (never lower, whatever `min`
   *  allows) — a bar/area/rect y-domain pins this to `0` so no thumb
   *  position can ever push the domain's maximum below zero. */
  hiFloor?: number;
  /** Defaults to `rangeSliderStep(min, max)`. */
  step?: number;
  /** Formats a raw numeric value for the two end inputs (e.g. a date scale formats its timestamp). */
  format?: (value: number) => string;
  /** Parses a typed end-input string back to a raw numeric value; `null` rejects the edit and reverts the draft. */
  parse?: (raw: string) => number | null;
  /** The value at its full precision, for the end fields' `title` and the
   *  thumbs' `aria-valuetext`, when `format` shows it coarser (a daily time
   *  axis displayed by month). Defaults to `format`. */
  describe?: (value: number) => string;
  /** Pulls a THUMB-driven value (drag, arrow, Shift+arrow) onto the data's
   *  own grid before it is committed — a yearly time axis lands on Jan 1. A
   *  TYPED value is never snapped: the reader typed exactly what they meant. */
  snap?: (value: number) => number;
  label?: string;
  /** Disables every control in the slider (both thumbs, both number
   *  fields, and the reset). `disabledReason` is surfaced as the control's
   *  own `title`/`aria-label` suffix, the same "disabled with a reason"
   *  idiom `@glyphcss/maps`' `mapDirectionLocked` uses. */
  disabled?: boolean;
  disabledReason?: string;
  /** Shown as a structured inline message (`role="alert"`, NEW-1/NEW-4)
   *  when a TYPED end value would need `loFloor`/`loCeiling`/`hiFloor` to
   *  clamp it — the commit is refused outright (the field reverts to the
   *  last committed value) instead of silently substituting the capped
   *  number, which used to read as "your number was accepted" with no
   *  signal that it wasn't the one typed. A thumb DRAG or a Shift+arrow
   *  keyboard nudge still WRITES the clamped value with no interruption —
   *  a continuous gesture settling AT a boundary needs none — but shows
   *  this SAME message for as long as it stays pinned there (`commit`'s
   *  own `capped` tracking), clearing the instant it moves off the cap:
   *  a zero-anchored Y domain's low thumb used to snap back to `0` with no
   *  signal at all (P3, DIAGNOSIS-scale-domain.md), which read as the drag
   *  doing nothing. Omit this (the caller has no cap on this axis) and
   *  neither path is ever refused or flashed for exceeding a cap, matching
   *  the component's behaviour before this option existed. */
  capReason?: string;
}

function pct(v: number, min: number, max: number): number {
  return max > min ? Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100)) : 0;
}

/**
 * The `.name` cell every domain row shares — the label plus a tiny
 * `[reset]` back to the data's own domain (`/maps`' Tilt/Bearing idiom,
 * the shared `.instrument-row-reset`), disabled when there is nothing to
 * undo. One component for all three rows (`RangeSlider`,
 * `RangeCategorySelect`, `RangeUnavailable`) so they can never drift apart.
 */
function RangeRowName({ label, resettable, disabled, title, onReset }: {
  label: string; resettable: boolean; disabled?: boolean; title?: string; onReset: () => void;
}) {
  return <div className="name range-slider-label">{label}
    <button type="button" className="range-slider-reset instrument-row-reset" disabled={disabled || !resettable}
      title={title ?? (resettable ? "Reset to the data's own domain" : "Already fitted to the data")}
      aria-label={`${label} reset${title ? ` — ${title}` : ""}`}
      onClick={onReset}>[reset]</button></div>;
}

/**
 * A two-thumb range slider for a scale's domain min/max (Chart folder's
 * Scales rows) — one ROW, styled to be indistinguishable from a lil-gui
 * number controller's own row (the Output folder's Width/Height sliders):
 * `.name` label column (carrying a tiny `[reset]` back to the auto domain,
 * `/maps`' own Tilt/Bearing idiom), then in the `.widget` column left to right
 * `[min] [slider] [max]` — the min number field, the bracketed `[ ─█──── ]`
 * bar (bare track background outside the selection, ONE cyan gradient fill
 * band between the two thumbs' own positions, no third visual element), and
 * the max number field. Pixel values are copied from `.dn-floating-controls
 * .lil-gui .controller.number` in `gallery-workbench.css` (the Dock's real
 * lil-gui theme) into this component's own rules in
 * `instrument-workbench.css`, the same "measured, not cascaded" mirror
 * `.voice-slider` already uses for the single-handle case — this component
 * imports that stylesheet directly so its look does not depend on whatever
 * else a consuming workbench happens to import.
 *
 * The two end fields are sized to the longest string they will show (both
 * bounds and both ends, in `ch` of their own monospace font): a fixed 27px
 * showed "1980-01-01" as "198" and "175604.63" as "175" (CHARTS-RESEARCH
 * `DIAGNOSIS-scale-rows-mark-card.md`). They may still shrink before the
 * track does, so an overlong string truncates rather than pushing the row
 * off the panel.
 *
 * Built from TWO overlapping native `<input type="range">` elements
 * sharing one track (`.range-slider-track` gives each input
 * `pointer-events: none` except its own thumb) rather than a
 * from-scratch pointer/keyboard implementation — this is what gives
 * pointer drag, arrow-key stepping, and Home/End their OWN browser-native
 * behaviour for free; only the Shift-is-10x-step modifier (native ranges
 * have no such concept) and the never-cross clamp (native ranges have no
 * notion of a sibling thumb) are this component's own code. The native
 * thumbs are themselves invisible (`::-webkit-slider-thumb`/
 * `::-moz-range-thumb` painted transparent) — the two VISIBLE knobs are
 * the fill band's own left/right edges (`border-left`/`border-right` +
 * matching glow), the same cap style the single-handle `.voice-slider`
 * already draws at its one fill edge, doubled onto both ends of the band.
 * Numeric text inputs at both ends keep an uncommitted draft string, so a
 * half-typed value never fights the slider's live position.
 *
 * `loCeiling`/`loFloor`/`hiFloor` cap what value EVER reaches `onChange` —
 * enforced on every path via `commit`'s own clamp, since a native range
 * input has no notion of ANOTHER input's cap. Both thumbs keep the full
 * outer `min`/`max` as their native attributes, so both thumbs and the fill
 * read one coordinate system. A TYPED value that would need any cap to
 * clamp it is instead REFUSED with `capReason` (or, with no `capReason`
 * supplied, falls back to the same silent clamp `commit` already applies) —
 * never bypassable by typing past the visible bound, which is exactly how a
 * bar/area/rect y-domain slider used to be able to exclude zero from the
 * committed domain, and a log scale's own min field to reach zero or
 * negative and blank the chart (NEW-1, REVIEW-dock-colours-sliders-opus-
 * round2.md). `min`/`max` (the outer padded bounds) are enforced only for
 * the THUMBS (the native input's own range) — a typed number may freely
 * exceed them, and the caller is expected to widen `min`/`max` on its next
 * render to include it (P2-1).
 *
 * Every commit writes ONLY the end it came from — the sibling end's own
 * `value` entry (`null` when it was auto) rides through UNTOUCHED, so a
 * single thumb nudge or typed edit never silently pins the other end to a
 * concrete number it was never asked to change (NEW-2, REVIEW-dock-
 * colours-sliders-opus-round2.md) — a later data change still re-infers
 * that untouched end on its own next render. `[reset]` clears BOTH ends
 * back to auto at once, and is disabled while the domain is already auto.
 */
export function RangeSlider({
  min, max, domain, value, onChange, loCeiling, loFloor, hiFloor, step, format = String, parse, describe, snap, label, disabled, disabledReason, capReason,
}: RangeSliderProps) {
  const resolvedStep = step ?? rangeSliderStep(min, max);
  const [domainLo, domainHi] = domain ?? [min, max];
  const [rawLo, rawHi] = value ?? [null, null];
  const lo = rawLo ?? domainLo;
  const hi = rawHi ?? domainHi;
  const [loDraft, setLoDraft] = useState<string | null>(null);
  const [hiDraft, setHiDraft] = useState<string | null>(null);
  // A structured inline message (NEW-1/NEW-4) for the END a typed commit
  // was just refused on — `capReason` supplies the TEXT (the same reason
  // for either end, since a control only ever caps for one rule at a
  // time), this only tracks WHETHER one is currently showing.
  const [capError, setCapError] = useState<"lo" | "hi" | null>(null);
  // Coincident-thumb grab: while `lo === hi`, both native inputs occupy the
  // exact same pixel and only the higher base z-index (`--hi`) can ever
  // receive a click — the low thumb becomes permanently unreachable by
  // pointer once a drag lands the two on top of each other. Tracked on the
  // shared track (which, unlike the inputs, has no `pointer-events: none`)
  // rather than on either input, since whichever input is CURRENTLY on top
  // is exactly the one that would otherwise keep winning every future
  // pointerdown regardless of where the cursor approaches from. Run on
  // `pointerdown` too, not only `pointermove` (NEW-6) — a touch stroke's
  // very first event IS the pointerdown, so a hover-only rule left the low
  // thumb permanently ungrabbable by touch once it coincided with the high
  // one.
  const [frontThumb, setFrontThumb] = useState<"lo" | "hi" | null>(null);
  const onTrackPointerPosition = (e: PointerEvent<HTMLDivElement>) => {
    if (lo !== hi) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0.5;
    const pointerValue = min + frac * (max - min);
    setFrontThumb(pointerValue < lo ? "lo" : "hi");
  };

  const commit = (which: "lo" | "hi", raw: number | null) => {
    let next = raw;
    // Tracks whether a `loFloor`/`loCeiling`/`hiFloor` cap actually MOVED
    // this value (never the "never cross the sibling" clamp below, which
    // is a different rule with no `capReason` of its own) — a drag or
    // Shift+arrow nudge has no typed-refusal gate in front of it, so this
    // is the ONLY point that ever sees such a value land on a cap. `commit`
    // still WRITES the clamped value (a continuous gesture settles at the
    // boundary with no interruption, AGENTS.md's own rule for this
    // control) — this only decides whether the same inline message
    // `capReason`'s typed-refusal path shows also flashes here, so the
    // snap is never silent (P3, DIAGNOSIS-scale-domain.md).
    let capped = false;
    if (next !== null) {
      // both ends — see `loFloor`'s own doc for the sign split.
      if (loFloor !== undefined) {
        const floored = loFloor >= 0 ? Math.max(next, loFloor) : Math.min(next, loFloor);
        if (floored !== next) capped = true;
        next = floored;
      }
      if (which === "lo" && loCeiling !== undefined) {
        const ceiled = Math.min(next, loCeiling);
        if (ceiled !== next) capped = true;
        next = ceiled;
      }
      if (which === "hi" && hiFloor !== undefined) {
        const floored = Math.max(next, hiFloor);
        if (floored !== next) capped = true;
        next = floored;
      }
    }
    setCapError(capped && capReason !== undefined ? which : null);
    const otherRaw = which === "lo" ? rawHi : rawLo;
    const otherResolved = which === "lo" ? hi : lo;
    if (next !== null) {
      // Never cross the sibling thumb — stop AT its own resolved value
      // (concrete, even when the sibling itself is auto/`null`) rather
      // than re-sorting the pair, which would swap the moving thumb's own
      // identity instead of simply halting it at its sibling.
      if (which === "lo" && next > otherResolved) next = otherResolved;
      if (which === "hi" && next < otherResolved) next = otherResolved;
    }
    onChange(which === "lo" ? [next, otherRaw] : [otherRaw, next]);
  };
  const thumb = (n: number) => snap ? snap(n) : n;
  const violatesCap = (which: "lo" | "hi", n: number): boolean => {
    // both ends — see `loFloor`'s own doc for the sign split.
    if (loFloor !== undefined && (loFloor >= 0 ? n < loFloor : n > loFloor)) return true;
    if (which === "lo") return loCeiling !== undefined && n > loCeiling;
    return hiFloor !== undefined && n < hiFloor;
  };
  const commitText = (raw: string, which: "lo" | "hi") => {
    (which === "lo" ? setLoDraft : setHiDraft)(null);
    setCapError(null);
    const current = which === "lo" ? lo : hi;
    if (raw === format(current)) return; // no genuine edit — commit nothing (focus+blur alone must not materialise a domain)
    if (raw.trim() === "") { commit(which, null); return; } // clears this end back to auto — never Number("") === 0
    const n = parse ? parse(raw) : Number(raw);
    if (n === null || !Number.isFinite(n)) return; // reject — revert to the last committed value (draft already cleared above)
    if (capReason !== undefined && violatesCap(which, n)) { setCapError(which); return; } // refuse — see `capReason`'s own doc
    commit(which, n);
  };
  const onEndKeyDown = (e: KeyboardEvent<HTMLInputElement>) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); };
  // Shift+arrow = 10x step; a plain arrow/Home/End is left to the native
  // `<input type="range">`'s own keyboard handling (which already fires the
  // matching `onChange` below).
  const onThumbKeyDown = (e: KeyboardEvent<HTMLInputElement>, which: "lo" | "hi") => {
    if (!e.shiftKey) return;
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
    e.preventDefault();
    const dir = e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : -1;
    const delta = dir * resolvedStep * 10;
    commit(which, thumb((which === "lo" ? lo : hi) + delta));
  };

  const title = disabled && disabledReason ? disabledReason : undefined;
  const full = describe ?? format;
  const loPct = pct(lo, min, max);
  const hiPct = pct(hi, min, max);
  const numberCh = Math.min(10, Math.max(2, ...[min, max, lo, hi].map((v) => format(v).length)));
  const style = { ["--range-slider-number-ch" as string]: String(numberCh) } as CSSProperties;
  // Same outer hooks a real lil-gui number row carries (`.controller`,
  // `.number`, `.hasSlider` — this control always has one) so it reads as
  // one family with the Width/Height rows above it in the same folder;
  // `.range-row`/`.range-slider`/`.is-disabled` are this component's own.
  return <div className={`controller number hasSlider range-row range-slider${disabled ? " disabled is-disabled" : ""}`} title={title} style={style}>
    {label && <RangeRowName label={label} resettable={value !== null} disabled={disabled} title={title} onReset={() => onChange(null)} />}
    <div className="widget range-slider-widget">
      <input className="range-slider-number" inputMode="decimal" aria-label={`${label ?? "Range"} minimum`} disabled={disabled}
        title={title ?? (describe ? describe(lo) : undefined)}
        value={loDraft ?? format(lo)}
        onChange={(e) => { setLoDraft(e.target.value); if (capError === "lo") setCapError(null); }}
        onBlur={(e) => commitText(e.target.value, "lo")}
        onKeyDown={onEndKeyDown} />
      <div className="slider range-slider-track" onPointerDown={onTrackPointerPosition} onPointerMove={onTrackPointerPosition}>
        <div className="fill range-slider-fill" style={{ left: `${loPct}%`, width: `${hiPct - loPct}%` }} />
        <input type="range" className={`range-slider-range range-slider-range--lo${frontThumb === "lo" ? " is-front" : ""}`} min={min} max={max} step={resolvedStep} disabled={disabled}
          value={lo} aria-label={`${label ?? "Range"} minimum handle`} aria-valuetext={full(lo)} title={title}
          onChange={(e) => commit("lo", thumb(Number(e.target.value)))}
          onKeyDown={(e) => onThumbKeyDown(e, "lo")} />
        <input type="range" className={`range-slider-range range-slider-range--hi${frontThumb === "hi" ? " is-front" : ""}`} min={min} max={max} step={resolvedStep} disabled={disabled}
          value={hi} aria-label={`${label ?? "Range"} maximum handle`} aria-valuetext={full(hi)} title={title}
          onChange={(e) => commit("hi", thumb(Number(e.target.value)))}
          onKeyDown={(e) => onThumbKeyDown(e, "hi")} />
      </div>
      <input className="range-slider-number" inputMode="decimal" aria-label={`${label ?? "Range"} maximum`} disabled={disabled}
        title={title ?? (describe ? describe(hi) : undefined)}
        value={hiDraft ?? format(hi)}
        onChange={(e) => { setHiDraft(e.target.value); if (capError === "hi") setCapError(null); }}
        onBlur={(e) => commitText(e.target.value, "hi")}
        onKeyDown={onEndKeyDown} />
    </div>
    {capError && capReason && <p className="range-slider-error" role="alert">{capReason}</p>}
  </div>;
}

export interface RangeCategorySelectProps {
  label: string;
  /** In data order — the only values either select can ever commit. */
  categories: readonly string[];
  /** The current ends; `null` = that end follows the data (first/last category). */
  value: readonly [string | null, string | null];
  onSelect: (end: "lo" | "hi", category: string) => void;
  onReset: () => void;
  /** An option's label (an ISO-date category shown as its year, say); the
   *  value committed is always the category itself. */
  display?: (category: string) => string;
}

/**
 * A band scale's domain row: the same `.name` cell as `RangeSlider`, then
 * two compact selects `[min] – [max]` sharing the `.widget` column, so a
 * band axis is ONE Dock row on the same grid as every other row instead of
 * two full-width card rows that started 80px left of the widget column and
 * ran past the panel (CHARTS-RESEARCH `DIAGNOSIS-scale-rows-mark-card.md`).
 * Both selects always show a REAL category (the data's own first/last while
 * an end is auto), and every option that would put the minimum at or after
 * the maximum is disabled, so no pick can name fewer than two categories.
 */
export function RangeCategorySelect({ label, categories, value, onSelect, onReset, display = String }: RangeCategorySelectProps) {
  const [rawLo, rawHi] = value;
  const loIndex = rawLo !== null && categories.includes(rawLo) ? categories.indexOf(rawLo) : 0;
  const hiIndex = rawHi !== null && categories.includes(rawHi) ? categories.indexOf(rawHi) : categories.length - 1;
  const lo = categories[loIndex]!;
  const hi = categories[hiIndex]!;
  return <div className="controller range-row range-select">
    <RangeRowName label={label} resettable={rawLo !== null || rawHi !== null} onReset={onReset} />
    <div className="widget range-select-widget">
      <select className="range-select-input" aria-label={`${label} minimum`} value={lo} title={display(lo)}
        onChange={(e) => onSelect("lo", e.target.value)}>
        {categories.map((c, i) => <option key={c} value={c} disabled={i >= hiIndex}>{display(c)}</option>)}
      </select>
      <span className="range-select-dash" aria-hidden="true">–</span>
      <select className="range-select-input" aria-label={`${label} maximum`} value={hi} title={display(hi)}
        onChange={(e) => onSelect("hi", e.target.value)}>
        {categories.map((c, i) => <option key={c} value={c} disabled={i <= loIndex}>{display(c)}</option>)}
      </select>
    </div>
  </div>;
}

/**
 * A domain row with nothing to control: the same `.name` cell (its `[reset]`
 * disabled), then the SHORT reason in the widget and the full one on the
 * row's title — never a slider over a fabricated domain, never free-text
 * fields. `/charts` reaches it only from a chart with no x/y scale, bad
 * mark data, or a legacy link naming a scale type the data can't carry.
 */
export function RangeUnavailable({ label, short, reason }: { label: string; short: string; reason: string }) {
  return <div className="controller range-row range-unavailable disabled is-disabled" title={reason}>
    <RangeRowName label={label} resettable={false} disabled title={reason} onReset={() => {}} />
    <div className="widget range-unavailable-widget"><span className="range-unavailable-reason" aria-label={reason}>{short}</span></div>
  </div>;
}
