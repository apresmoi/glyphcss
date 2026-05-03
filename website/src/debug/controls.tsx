import type { ReactNode } from "react";

/**
 * Reusable sidebar control primitives. Each maps onto one CSS rule in
 * debug.css and stays presentational — pages compose them.
 */

/** A label + content row. Use as the immediate child of DebugSection. */
export function Row({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div className="debug-row">
      {label !== undefined && <span>{label}</span>}
      {children}
    </div>
  );
}

interface SliderProps {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  /** Format the value displayed on the right; defaults to `String(value)`. */
  format?: (v: number) => string;
}

/** −/range/+/value cluster. Designed to live inside a Row. */
export function Slider({ value, onChange, min, max, step = 1, format }: SliderProps) {
  const display = format ? format(value) : String(value);
  const clamp = (v: number) => Math.max(min, Math.min(max, v));
  return (
    <>
      <button className="debug-btn" onClick={() => onChange(clamp(value - step))}>−</button>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <button className="debug-btn" onClick={() => onChange(clamp(value + step))}>+</button>
      <span style={{ minWidth: 38, textAlign: "right", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
        {display}
      </span>
    </>
  );
}

type PillOption<T> = T extends string | number | boolean
  ? T | { value: T; label: ReactNode }
  : { value: T; label: ReactNode };

interface PillsProps<T> {
  value: T;
  onChange: (v: T) => void;
  options: PillOption<T>[];
}

/** Mutually-exclusive button group. Use inside a Row. */
export function Pills<T>({ value, onChange, options }: PillsProps<T>) {
  return (
    <>
      {options.map((raw, i) => {
        const opt = isOption<T>(raw) ? raw : { value: raw as T, label: String(raw) as ReactNode };
        const active = opt.value === value;
        return (
          <button
            key={i}
            className={`debug-btn${active ? " active" : ""}`}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </button>
        );
      })}
    </>
  );
}
function isOption<T>(x: unknown): x is { value: T; label: ReactNode } {
  return typeof x === "object" && x !== null && "value" in x;
}

interface SelectProps<T extends string> {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}

/** Native <select> styled to match the dark sidebar. Use inside a Row. */
export function Select<T extends string>({ value, onChange, options }: SelectProps<T>) {
  return (
    <select
      className="debug-select"
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

interface CheckboxProps {
  label: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  color?: string;
}

/** Standalone labeled checkbox. Doesn't need a Row. */
export function Checkbox({ label, checked, onChange, color }: CheckboxProps) {
  return (
    <label className="debug-checkbox">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span style={color ? { color } : undefined}>{label}</span>
    </label>
  );
}
