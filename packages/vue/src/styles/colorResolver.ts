/**
 * DOM-based CSS color resolver for named colors ("red", "tomato", etc).
 * Uses getComputedStyle on a hidden probe element to resolve any CSS color string.
 */
import { parsePureColor, type ParsedColor } from "@polycss/core";

let probeEl: HTMLElement | null = null;
const resolvedCache = new Map<string, ParsedColor | null>();

function ensureProbe(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  if (probeEl && probeEl.ownerDocument) return probeEl;
  probeEl = document.createElement("div");
  document.head.appendChild(probeEl);
  return probeEl;
}

/**
 * Resolve a CSS color string using the browser's CSS engine.
 * Handles named colors like "red", "tomato", "rebeccapurple", etc.
 * Returns null if the color cannot be resolved.
 */
export function resolveColor(input: string): ParsedColor | null {
  if (!input) return null;
  const key = input.trim();

  // Try pure parsing first (hex, rgb, rgba)
  const pure = parsePureColor(key);
  if (pure) return pure;

  // Check cache
  const cached = resolvedCache.get(key);
  if (cached !== undefined) return cached;

  // Use DOM probe for named colors
  const probe = ensureProbe();
  if (!probe) {
    resolvedCache.set(key, null);
    return null;
  }

  probe.style.color = "";
  probe.style.color = key;
  const computed = getComputedStyle(probe);
  const value = computed.color;

  if (!value || value === "rgba(0, 0, 0, 0)" || value === "transparent") {
    resolvedCache.set(key, null);
    return null;
  }

  const parsed = parsePureColor(value);
  resolvedCache.set(key, parsed);
  return parsed;
}
