/**
 * `#rgb`/`#rrggbb`, with or without the leading `#`, normalised to the
 * canonical `#rrggbb` an `<input type="color">` requires. `null` for
 * anything else, so a half-typed hex value reverts instead of committing an
 * invalid one. Shared by `/charts`' `ChartsColorSwatch` and `/maps`'
 * `ColorRow` (`parseMapsHex`) — the two were byte-for-byte copies with no
 * drift gate (P3-1, REVIEW-dock-colours-sliders-opus.md).
 */
export function parseHex(raw: string): string | null {
  const m = /^\s*#?([0-9a-f]{3}|[0-9a-f]{6})\s*$/i.exec(raw);
  if (!m) return null;
  const hex = m[1]!.toLowerCase();
  return `#${hex.length === 3 ? hex.replace(/./g, (c) => c + c) : hex}`;
}
