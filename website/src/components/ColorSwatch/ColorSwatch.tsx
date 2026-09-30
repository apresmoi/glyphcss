import { useState } from "react";
import { parseHex } from "../../utils/color/colorHex";
import { SliderTrack } from "../SliderRow";
import styles from "./ColorSwatch.module.css";

/**
 * A native `<input type="color">` swatch bar plus an editable hex field,
 * styled like the Dock's own `.controller.color` row (`.voice-slider-track`
 * for the bracketed `[ ]` bar, reused from the shared instrument
 * stylesheet so this reads as one control family with the sliders) — the
 * same shape `@glyphcss/maps`' `ColorRow` (`MapsWorkbench/mapsKit.tsx`)
 * already established for `/maps`. The hex field is an uncommitted draft
 * string while focused (same pattern as the mark table's cell inputs) so a
 * half-typed value doesn't fight the picker's own live updates.
 *
 * `disabled`/`disabledReason` dim the whole row with a reason on its title
 * (`@glyphcss/maps`' `mapDirectionLocked` idiom) — for `Color: none`, where
 * the picked value is real but nothing paints it, so leaving the row fully
 * live with no signal reads as broken rather than inert.
 *
 * Lives here, not under `ChartsWorkbench/`, as the shared colour control
 * (P3-1, REVIEW-dock-colours-sliders-opus-round2.md) — `/charts` is its
 * only consumer today, but `@glyphcss/maps`' own `ColorRow`
 * (`MapsWorkbench/mapsKit.tsx`) duplicates this exact markup and is the
 * next one to fold in. Its `charts-color-*` class names (`charts-workbench.css`)
 * stay as they are for now — renaming them is its own change, not part of
 * this move.
 */
export function ColorSwatch({
  label,
  value,
  onChange,
  title,
  disabled,
  disabledReason,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  title?: string;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (raw: string) => {
    const hex = parseHex(raw);
    if (hex) onChange(hex);
    setDraft(null);
  };
  const resolvedTitle =
    disabled && disabledReason ? disabledReason : (title ?? `${label} — click the bar to pick, or type a hex value`);
  return (
    <label className={`${styles.root} charts-color-row${disabled ? " is-disabled" : ""}`} title={resolvedTitle}>
      <span>{label}</span>
      <SliderTrack className="voice-slider-track charts-color-swatch">
        <input
          type="color"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          aria-label={`${label} colour`}
        />
      </SliderTrack>
      <input
        className="charts-color-hex"
        value={draft ?? value}
        spellCheck={false}
        disabled={disabled}
        aria-label={`${label} hex value`}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
      />
    </label>
  );
}
