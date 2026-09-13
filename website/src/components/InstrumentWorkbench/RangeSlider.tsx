import { useState, type KeyboardEvent } from "react";

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
  /** The slider's own draggable domain — e.g. the data extent padded 20%. */
  min: number;
  max: number;
  /** Current selection, or `null` for "auto" (reverts to the full `[min, max]` domain — no explicit override). */
  value: readonly [number, number] | null;
  onChange: (value: readonly [number, number] | null) => void;
  /** Defaults to `rangeSliderStep(min, max)`. */
  step?: number;
  /** Formats a raw numeric value for the two end inputs (e.g. a date scale formats its timestamp). */
  format?: (value: number) => string;
  /** Parses a typed end-input string back to a raw numeric value; `null` rejects the edit and reverts the draft. */
  parse?: (raw: string) => number | null;
  label?: string;
  disabled?: boolean;
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
 */
export function RangeSlider({ min, max, value, onChange, step, format = String, parse, label, disabled, auto = true }: RangeSliderProps) {
  const resolvedStep = step ?? rangeSliderStep(min, max);
  const [rawLo, rawHi] = value ?? [min, max];
  const lo = Math.min(rawLo, rawHi);
  const hi = Math.max(rawLo, rawHi);
  const [loDraft, setLoDraft] = useState<string | null>(null);
  const [hiDraft, setHiDraft] = useState<string | null>(null);

  const commit = (nextLo: number, nextHi: number) => {
    let clampedLo = Math.max(min, Math.min(max, nextLo));
    let clampedHi = Math.max(min, Math.min(max, nextHi));
    if (clampedLo > clampedHi) {
      // Whichever side is UNCHANGED from the currently committed value is
      // the one the moving thumb just crossed — stop it there (both equal)
      // rather than re-sorting the pair, which would swap the moving
      // thumb's own identity instead of simply halting it at its sibling.
      if (nextHi === hi) clampedLo = clampedHi; else clampedHi = clampedLo;
    }
    onChange([clampedLo, clampedHi]);
  };
  const commitText = (raw: string, which: "lo" | "hi") => {
    const n = parse ? parse(raw) : Number(raw);
    if (n !== null && Number.isFinite(n)) commit(which === "lo" ? n : lo, which === "lo" ? hi : n);
    (which === "lo" ? setLoDraft : setHiDraft)(null);
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

  return <div className={`range-slider${disabled ? " is-disabled" : ""}`}>
    {(label || auto) && <div className="range-slider-head">
      {label && <span className="range-slider-label">{label}</span>}
      {auto && <button type="button" className={`range-slider-auto${value === null ? " is-active" : ""}`} disabled={disabled}
        aria-pressed={value === null} onClick={() => onChange(value === null ? [min, max] : null)}>auto</button>}
    </div>}
    <div className="range-slider-inputs">
      <input className="range-slider-number" inputMode="decimal" aria-label={`${label ?? "Range"} minimum`} disabled={disabled}
        value={loDraft ?? format(lo)}
        onChange={(e) => setLoDraft(e.target.value)}
        onBlur={(e) => commitText(e.target.value, "lo")}
        onKeyDown={onEndKeyDown} />
      <div className="range-slider-track">
        <div className="range-slider-fill" style={{ left: `${pct(lo, min, max)}%`, right: `${100 - pct(hi, min, max)}%` }} />
        <input type="range" className="range-slider-range range-slider-range--lo" min={min} max={max} step={resolvedStep} disabled={disabled}
          value={lo} aria-label={`${label ?? "Range"} minimum handle`} aria-valuetext={format(lo)}
          onChange={(e) => commit(Number(e.target.value), hi)}
          onKeyDown={(e) => onThumbKeyDown(e, "lo")} />
        <input type="range" className="range-slider-range range-slider-range--hi" min={min} max={max} step={resolvedStep} disabled={disabled}
          value={hi} aria-label={`${label ?? "Range"} maximum handle`} aria-valuetext={format(hi)}
          onChange={(e) => commit(lo, Number(e.target.value))}
          onKeyDown={(e) => onThumbKeyDown(e, "hi")} />
      </div>
      <input className="range-slider-number" inputMode="decimal" aria-label={`${label ?? "Range"} maximum`} disabled={disabled}
        value={hiDraft ?? format(hi)}
        onChange={(e) => setHiDraft(e.target.value)}
        onBlur={(e) => commitText(e.target.value, "hi")}
        onKeyDown={onEndKeyDown} />
    </div>
  </div>;
}
