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
  /** The HIGH thumb's own reachable floor, mirroring `loCeiling`. */
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
  /** Shows the "auto" toggle. Default `true`. */
  auto?: boolean;
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
 * `loCeiling`/`hiFloor` are enforced on EVERY commit path (thumb drag via
 * each range input's own per-thumb `min`/`max` attribute, AND a typed
 * number) — never bypassable by typing past the visible bound, which is
 * exactly how a bar/area/rect y-domain slider used to be able to exclude
 * zero from the committed domain and blank the chart. `min`/`max` (the
 * outer padded bounds) are enforced only for the THUMBS (the native input's
 * own range) — a typed number may freely exceed them, and the caller is
 * expected to widen `min`/`max` on its next render to include it (P2-1).
 */
export function RangeSlider({
  min, max, domain, value, onChange, loCeiling, hiFloor, step, format = String, parse, label, disabled, disabledReason, auto = true,
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
  // Coincident-thumb grab: while `lo === hi`, both native inputs occupy the
  // exact same pixel and only the higher base z-index (`--hi`) can ever
  // receive a click — the low thumb becomes permanently unreachable by
  // pointer once a drag lands the two on top of each other. Tracked on the
  // shared track (which, unlike the inputs, has no `pointer-events: none`)
  // rather than on either input, since whichever input is CURRENTLY on top
  // is exactly the one that would otherwise keep winning every future
  // pointerdown regardless of where the cursor approaches from.
  const [frontThumb, setFrontThumb] = useState<"lo" | "hi" | null>(null);
  const onTrackPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (lo !== hi) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0.5;
    const pointerValue = min + frac * (max - min);
    setFrontThumb(pointerValue < lo ? "lo" : "hi");
  };

  const commit = (nextLo: number | null, nextHi: number | null) => {
    let clampedLo = nextLo === null ? null : (loCeiling !== undefined ? Math.min(nextLo, loCeiling) : nextLo);
    let clampedHi = nextHi === null ? null : (hiFloor !== undefined ? Math.max(nextHi, hiFloor) : nextHi);
    if (clampedLo !== null && clampedHi !== null && clampedLo > clampedHi) {
      // Whichever side is UNCHANGED from the currently committed value is
      // the one the moving thumb just crossed — stop it there (both equal)
      // rather than re-sorting the pair, which would swap the moving
      // thumb's own identity instead of simply halting it at its sibling.
      if (nextHi === hi) clampedLo = clampedHi; else clampedHi = clampedLo;
    }
    onChange([clampedLo, clampedHi]);
  };
  const commitText = (raw: string, which: "lo" | "hi") => {
    (which === "lo" ? setLoDraft : setHiDraft)(null);
    const current = which === "lo" ? lo : hi;
    if (raw === format(current)) return; // no genuine edit — commit nothing (focus+blur alone must not materialise a domain)
    if (raw.trim() === "") { commit(which === "lo" ? null : lo, which === "lo" ? hi : null); return; } // clears this end back to auto — never Number("") === 0
    const n = parse ? parse(raw) : Number(raw);
    if (n === null || !Number.isFinite(n)) return; // reject — revert to the last committed value (draft already cleared above)
    commit(which === "lo" ? n : lo, which === "lo" ? hi : n);
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
    commit(which === "lo" ? lo + delta : lo, which === "lo" ? hi : hi + delta);
  };

  const title = disabled && disabledReason ? disabledReason : undefined;
  return <div className={`range-slider${disabled ? " is-disabled" : ""}`} title={title}>
    {(label || auto) && <div className="range-slider-head">
      {label && <span className="range-slider-label">{label}</span>}
      {auto && <button type="button" className={`range-slider-auto${value === null ? " is-active" : ""}`} disabled={disabled}
        aria-pressed={value === null} title={title} aria-label={title ? `${label ?? "Range"} auto — ${title}` : undefined}
        onClick={() => onChange(value === null ? [domainLo, domainHi] : null)}>auto</button>}
    </div>}
    <div className="range-slider-inputs">
      <input className="range-slider-number" inputMode="decimal" aria-label={`${label ?? "Range"} minimum`} disabled={disabled} title={title}
        value={loDraft ?? format(lo)}
        onChange={(e) => setLoDraft(e.target.value)}
        onBlur={(e) => commitText(e.target.value, "lo")}
        onKeyDown={onEndKeyDown} />
      <div className="range-slider-track" onPointerMove={onTrackPointerMove}>
        <div className="range-slider-fill" style={{ left: `${pct(lo, min, max)}%`, right: `${100 - pct(hi, min, max)}%` }} />
        <input type="range" className={`range-slider-range range-slider-range--lo${frontThumb === "lo" ? " is-front" : ""}`} min={min} max={loMax} step={resolvedStep} disabled={disabled}
          value={lo} aria-label={`${label ?? "Range"} minimum handle`} aria-valuetext={format(lo)} title={title}
          onChange={(e) => commit(Number(e.target.value), hi)}
          onKeyDown={(e) => onThumbKeyDown(e, "lo")} />
        <input type="range" className={`range-slider-range range-slider-range--hi${frontThumb === "hi" ? " is-front" : ""}`} min={hiMin} max={max} step={resolvedStep} disabled={disabled}
          value={hi} aria-label={`${label ?? "Range"} maximum handle`} aria-valuetext={format(hi)} title={title}
          onChange={(e) => commit(lo, Number(e.target.value))}
          onKeyDown={(e) => onThumbKeyDown(e, "hi")} />
      </div>
      <input className="range-slider-number" inputMode="decimal" aria-label={`${label ?? "Range"} maximum`} disabled={disabled} title={title}
        value={hiDraft ?? format(hi)}
        onChange={(e) => setHiDraft(e.target.value)}
        onBlur={(e) => commitText(e.target.value, "hi")}
        onKeyDown={onEndKeyDown} />
    </div>
  </div>;
}
