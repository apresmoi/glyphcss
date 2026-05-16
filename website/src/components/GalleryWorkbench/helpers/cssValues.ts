import { parsePureColor } from "@layoutit/polycss-react";

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

export function colorLuminance(color: string | undefined): number | null {
  if (!color) return null;
  const parsed = parsePureColor(color);
  if (!parsed) return null;
  const [r, g, b] = parsed.rgb;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

export function roundToStep(value: number, step: number): number {
  return Number((Math.round(value / step) * step).toFixed(4));
}

export function getInlineStyleDeclaration(styleAttr: string, property: string): string | null {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = styleAttr.match(new RegExp(`(?:^|;)\\s*${escaped}\\s*:\\s*([^;]*)`, "i"));
  return match?.[1]?.trim() ?? null;
}

export function cssColorAlpha(value: string | null | undefined): number | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (trimmed.toLowerCase() === "transparent") return 0;
  const parsed = parsePureColor(trimmed);
  if (parsed) return parsed.alpha;
  const slashAlpha = trimmed.match(/\/\s*([\d.]+%?)\s*\)?$/);
  if (!slashAlpha) return null;
  const raw = slashAlpha[1];
  const valueAsNumber = raw.endsWith("%")
    ? Number(raw.slice(0, -1)) / 100
    : Number(raw);
  return Number.isFinite(valueAsNumber) ? clamp(valueAsNumber, 0, 1) : null;
}

export function inlineStyleValue(element: HTMLElement, property: string): string | null {
  const styleAttr = element.getAttribute("style") ?? "";
  return getInlineStyleDeclaration(styleAttr, property)
    ?? element.style.getPropertyValue(property).trim()
    ?? null;
}

export function resolvedStyleValue(element: HTMLElement, property: string): string | null {
  const inline = inlineStyleValue(element, property);
  if (inline) return inline;
  const view = element.ownerDocument.defaultView;
  return view?.getComputedStyle(element).getPropertyValue(property).trim() ?? null;
}

export function cssPxValue(value: string | null | undefined): number | null {
  const match = value?.trim().match(/^(-?\d*\.?\d+)/);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? Math.abs(parsed) : null;
}

export function cssNumberValue(value: string | null | undefined): number | null {
  const parsed = Number.parseFloat(value?.trim() ?? "");
  return Number.isFinite(parsed) ? parsed : null;
}

export function cssUrlValue(value: string | null | undefined): string | null {
  const match = value?.match(/url\((?:"([^"]+)"|'([^']+)'|([^)]*?))\)/i);
  const raw = match?.[1] ?? match?.[2] ?? match?.[3];
  const trimmed = raw?.trim();
  if (!trimmed || trimmed === "none") return null;
  return trimmed;
}

export function cssPaintAlpha(element: HTMLElement, properties: string[]): number {
  for (const property of properties) {
    const alpha = cssColorAlpha(resolvedStyleValue(element, property));
    if (alpha !== null) return alpha;
  }
  return 1;
}

export function localElementSize(element: HTMLElement): { width: number; height: number } {
  if (element.tagName === "U") {
    const left = cssPxValue(resolvedStyleValue(element, "border-left-width")) ?? 0;
    const right = cssPxValue(resolvedStyleValue(element, "border-right-width")) ?? 0;
    const bottom = cssPxValue(resolvedStyleValue(element, "border-bottom-width")) ?? 0;
    return {
      width: Math.max(1, left + right),
      height: Math.max(1, bottom),
    };
  }

  return {
    width: Math.max(1, cssPxValue(resolvedStyleValue(element, "width")) ?? element.offsetWidth),
    height: Math.max(1, cssPxValue(resolvedStyleValue(element, "height")) ?? element.offsetHeight),
  };
}
