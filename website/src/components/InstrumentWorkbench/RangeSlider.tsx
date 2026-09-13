import { useState, type KeyboardEvent, type PointerEvent } from "react";

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
   *  reverts to (its own per-end "no override" fallback) and what the
   *  `auto` button materialises when going from auto TO explicit, so that
   *  one click never changes the render (AGENTS.md's own rule for this
   *  control). Defaults to `[min, max]` when omitted. */
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
  /** The absolute floor for BOTH ends' commits — a log scale pins this to
   *  a small positive value derived from the domain's own extent, so no
   *  commit on EITHER thumb (a keyboard nudge's silent clamp, or a TYPED
   *  value refused via `capReason`) can ever push it to zero or negative,
   *  which trips the library's own `log-domain` rule (NEW-1, REVIEW-dock-
   *  colours-sliders-opus-round2.md — a log domain must keep one sign on
   *  BOTH ends, not just the minimum). Never a native `min` HTML
   *  attribute, unlike `loCeiling`/`hiFloor` below — `min` (the outer
   *  padded bound) already sits comfortably above zero for a legal log
   *  domain, so DRAG never needed an extra floor on either thumb; adding
   *  one there would only pull that thumb's browser-computed position away
   *  from the visual fill bar's, which shares `min`/`max`, not `loFloor`. */
  loFloor?: number;
  /** The HIGH thumb's OWN reachable floor (never lower, whatever `min`
   *  allows) — a bar/area/rect y-domain pins this to `0` so no thumb
   *  position can ever push the domain's maximum below zero. Also narrows
   *  the high thumb's own native `min` HTML attribute (mirroring
   *  `loCeiling`'s effect on the low thumb's `max`), which is exactly why
   *  a log scale uses the mark-agnostic `loFloor` above instead of this —
   *  a log domain's floor is many orders of magnitude below `min`, and
   *  narrowing the native attribute that far would visibly detach the
   *  thumb from `.range-slider-fill`. */
  hiFloor?: number;
  /** Defaults to `rangeSliderStep(min, max)`. */
  step?: number;
  /** Formats a raw numeric value for the two end inputs (e.g. a date scale formats its timestamp). */
  format?: (value: number) => string;
  /** Parses a typed end-input string back to a raw numeric value; `null` rejects the edit and reverts the draft. */
  parse?: (raw: string) => number | null;
  label?: string;
  /** Disables every control in the slider (both thumbs, both number
   *  fields, and the auto toggle) — e.g. a log scale whose data can't
   *  produce a legal domain at all. `disabledReason` is surfaced as the
   *  control's own `title`/`aria-label` suffix, the same "disabled with a
   *  reason" idiom `@glyphcss/maps`' `mapDirectionLocked` uses. */
  disabled?: boolean;
  disabledReason?: string;
  /** Shown as a structured inline message (`role="alert"`, NEW-1/NEW-4)
   *  when a TYPED end value would need `loFloor`/`loCeiling`/`hiFloor` to
   *  clamp it — the commit is refused outright (the field reverts to the
   *  last committed value) instead of silently substituting the capped
   *  number, which used to read as "your number was accepted" with no
   *  signal that it wasn't the one typed. A thumb DRAG or a Shift+arrow
   *  keyboard nudge still clamps silently at the same caps — a continuous
   *  gesture settling AT a boundary needs no interruption, only a discrete
   *  typed value that silently became a different number does. Omit this
   *  (the caller has no cap on this axis) and a typed value is never
   *  refused for exceeding a cap, matching the component's behaviour
   *  before this option existed. */
  capReason?: string;
}

function pct(v: number, min: number, max: number): number {
  return max > min ? Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100)) : 0;
}

/**
 * A two-thumb range slider for a scale's domain min/max (Chart folder's
 * Scales rows). Built from TWO overlapping native `<input type="range">`
 * elements sharing one track (`range-slider-track` in
 * `instrument-workbench.css` gives each input `pointer-events: none` except
 * its own thumb) rather than a from-scratch pointer/keyboard implementation
 * — this is what gives pointer drag, arrow-key stepping, and Home/End their
 * OWN browser-native behaviour for free; only the Shift-is-10x-step
 * modifier (native ranges have no such concept) and the never-cross clamp
 * (native ranges have no notion of a sibling thumb) are this component's
 * own code. Numeric text inputs at both ends mirror the mark table's own
 * uncommitted-draft-string pattern (`ChartsMarkCard.tsx`) — a half-typed
 * value never fights the slider's live position.
 *
 * `loCeiling`/`loFloor`/`hiFloor` cap what value EVER reaches `onChange` —
 * enforced on every path via `commit`'s own clamp, since a native range
 * input has no notion of ANOTHER input's cap. `loCeiling`/`hiFloor`
 * additionally narrow their OWN thumb's native `min`/`max` HTML attribute
 * (drag can't even ASK for an out-of-range value); `loFloor` does NOT
 * touch either thumb's native attribute, and applies to BOTH ends' commits
 * — see its own doc for why. A TYPED value that would need any of these to clamp it is instead
 * REFUSED with `capReason` (or, with no `capReason` supplied, falls back
 * to the same silent clamp `commit` already applies) — never bypassable by
 * typing past the visible bound, which is exactly how a bar/area/rect
 * y-domain slider used to be able to exclude zero from the committed
 * domain, and a log scale's own min field to reach zero or negative and
 * blank the chart (NEW-1, REVIEW-dock-colours-sliders-opus-round2.md).
 * `min`/`max` (the outer padded bounds) are enforced only for the THUMBS
 * (the native input's own range) — a typed number may freely exceed them,
 * and the caller is expected to widen `min`/`max` on its next render to
 * include it (P2-1).
 *
 * Every commit writes ONLY the end it came from — the sibling end's own
 * `value` entry (`null` when it was auto) rides through UNTOUCHED, so a
 * single thumb nudge or typed edit never silently pins the other end to a
 * concrete number it was never asked to change (NEW-2, REVIEW-dock-
 * colours-sliders-opus-round2.md) — a later data change still re-infers
 * that untouched end on its own next render. The `auto` button is the one
 * exception, by design: going from fully-auto to explicit MATERIALISES
 * both ends at once, at the exact values already on screen, so the one
 * click that turns the toggle on never itself changes the render.
 */
export function RangeSlider({
  min, max, domain, value, onChange, loCeiling, loFloor, hiFloor, step, format = String, parse, label, disabled, disabledReason, capReason,
}: RangeSliderProps) {
  const resolvedStep = step ?? rangeSliderStep(min, max);
  const [domainLo, domainHi] = domain ?? [min, max];
  const [rawLo, rawHi] = value ?? [null, null];
  const lo = rawLo ?? domainLo;
  const hi = rawHi ?? domainHi;
  const loMax = loCeiling ?? max;
  const hiMin = hiFloor ?? min;
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
    setCapError(null);
    let next = raw;
    if (next !== null) {
      if (loFloor !== undefined) next = Math.max(next, loFloor); // both ends — see `loFloor`'s own doc
      if (which === "lo" && loCeiling !== undefined) next = Math.min(next, loCeiling);
      if (which === "hi" && hiFloor !== undefined) next = Math.max(next, hiFloor);
    }
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
  const violatesCap = (which: "lo" | "hi", n: number): boolean => {
    if (loFloor !== undefined && n < loFloor) return true; // both ends
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
    commit(which, (which === "lo" ? lo : hi) + delta);
  };

  const title = disabled && disabledReason ? disabledReason : undefined;
  return <div className={`range-slider${disabled ? " is-disabled" : ""}`} title={title}>
    <div className="range-slider-head">
      {label && <span className="range-slider-label">{label}</span>}
      <button type="button" className={`range-slider-auto${value === null ? " is-active" : ""}`} disabled={disabled}
        aria-pressed={value === null} title={title} aria-label={title ? `${label ?? "Range"} auto — ${title}` : undefined}
        onClick={() => onChange(value === null ? [domainLo, domainHi] : null)}>auto</button>
    </div>
    <div className="range-slider-inputs">
      <input className="range-slider-number" inputMode="decimal" aria-label={`${label ?? "Range"} minimum`} disabled={disabled} title={title}
        value={loDraft ?? format(lo)}
        onChange={(e) => { setLoDraft(e.target.value); if (capError === "lo") setCapError(null); }}
        onBlur={(e) => commitText(e.target.value, "lo")}
        onKeyDown={onEndKeyDown} />
      <div className="range-slider-track" onPointerDown={onTrackPointerPosition} onPointerMove={onTrackPointerPosition}>
        <div className="range-slider-fill" style={{ left: `${pct(lo, min, max)}%`, right: `${100 - pct(hi, min, max)}%` }} />
        <input type="range" className={`range-slider-range range-slider-range--lo${frontThumb === "lo" ? " is-front" : ""}`} min={min} max={loMax} step={resolvedStep} disabled={disabled}
          value={lo} aria-label={`${label ?? "Range"} minimum handle`} aria-valuetext={format(lo)} title={title}
          onChange={(e) => commit("lo", Number(e.target.value))}
          onKeyDown={(e) => onThumbKeyDown(e, "lo")} />
        <input type="range" className={`range-slider-range range-slider-range--hi${frontThumb === "hi" ? " is-front" : ""}`} min={hiMin} max={max} step={resolvedStep} disabled={disabled}
          value={hi} aria-label={`${label ?? "Range"} maximum handle`} aria-valuetext={format(hi)} title={title}
          onChange={(e) => commit("hi", Number(e.target.value))}
          onKeyDown={(e) => onThumbKeyDown(e, "hi")} />
      </div>
      <input className="range-slider-number" inputMode="decimal" aria-label={`${label ?? "Range"} maximum`} disabled={disabled} title={title}
        value={hiDraft ?? format(hi)}
        onChange={(e) => { setHiDraft(e.target.value); if (capError === "hi") setCapError(null); }}
        onBlur={(e) => commitText(e.target.value, "hi")}
        onKeyDown={onEndKeyDown} />
    </div>
    {capError && capReason && <p className="range-slider-error" role="alert">{capReason}</p>}
  </div>;
}
