import { useState } from "react";

/**
 * `#rgb`/`#rrggbb`, with or without the leading `#`, normalised to the
 * canonical `#rrggbb` an `<input type="color">` requires. `null` for
 * anything else, so a half-typed hex value reverts instead of committing an
 * invalid one — same rule `@glyphcss/maps`' `parseMapsHex` uses.
 */
export function parseChartsHex(raw: string): string | null {
  const m = /^\s*#?([0-9a-f]{3}|[0-9a-f]{6})\s*$/i.exec(raw);
  if (!m) return null;
  const hex = m[1]!.toLowerCase();
  return `#${hex.length === 3 ? hex.replace(/./g, (c) => c + c) : hex}`;
}

/**
 * A native `<input type="color">` swatch bar plus an editable hex field,
 * styled like the Dock's own `.controller.color` row (`.voice-slider-track`
 * for the bracketed `[ ]` bar, reused from the shared instrument
 * stylesheet so this reads as one control family with the sliders) — the
 * same shape `@glyphcss/maps`' `ColorRow` (`MapsWorkbench/mapsKit.tsx`)
 * already established for `/maps`. The hex field is an uncommitted draft
 * string while focused (same pattern as the mark table's cell inputs) so a
 * half-typed value doesn't fight the picker's own live updates.
 */
export function ChartsColorSwatch({ label, value, onChange, title }: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  title?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (raw: string) => {
    const hex = parseChartsHex(raw);
    if (hex) onChange(hex);
    setDraft(null);
  };
  return <label className="charts-color-row" title={title ?? `${label} — click the bar to pick, or type a hex value`}>
    <span>{label}</span>
    <span className="voice-slider-track charts-color-swatch">
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} aria-label={`${label} colour`} />
    </span>
    <input className="charts-color-hex" value={draft ?? value} spellCheck={false} aria-label={`${label} hex value`}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
  </label>;
}
