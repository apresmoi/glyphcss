/* Pure color parsing — zero DOM dependencies.
 * Handles hex (#rgb, #rrggbb) and rgb()/rgba() string formats.
 * For CSS named colors ("red", "tomato"), use the DOM-based
 * fallback in lighting.ts (or html/colorResolver.ts after migration).
 */

export interface ParsedColor {
  rgb: [number, number, number];
  alpha: number;
}

export function parseHexColor(value: string): ParsedColor | null {
  const hex = value.replace("#", "");
  if (hex.length === 3) {
    const r = parseInt(hex[0] + hex[0], 16);
    const g = parseInt(hex[1] + hex[1], 16);
    const b = parseInt(hex[2] + hex[2], 16);
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
    return { rgb: [r, g, b], alpha: 1 };
  }
  if (hex.length === 6) {
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
    return { rgb: [r, g, b], alpha: 1 };
  }
  return null;
}

export function parseRgbColor(value: string): ParsedColor | null {
  const match = value.match(
    /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/i
  );
  if (!match) return null;
  return {
    rgb: [Number(match[1]), Number(match[2]), Number(match[3])],
    alpha: match[4] ? Number(match[4]) : 1
  };
}

/** Parse hex or rgb/rgba color strings. Pure — no DOM. */
export function parsePureColor(input: string): ParsedColor | null {
  if (!input) return null;
  const key = input.trim();
  const hex = parseHexColor(key);
  if (hex) return hex;
  return parseRgbColor(key);
}

export function clampChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

export function formatColor(color: ParsedColor): string {
  const [r, g, b] = color.rgb.map(clampChannel) as [number, number, number];
  return color.alpha < 1
    ? `rgba(${r}, ${g}, ${b}, ${color.alpha})`
    : `rgb(${r}, ${g}, ${b})`;
}
