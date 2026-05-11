/**
 * Shared attribute-parsing helpers for polycss custom elements.
 * Used by PolyOrbitControlsElement, PolyMapControlsElement,
 * PolyPerspectiveCameraElement, and PolyOrthographicCameraElement.
 */

export function parseNumber(value: string | null): number | undefined {
  if (value == null) return undefined;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : undefined;
}

export function parseVec3(value: string | null): [number, number, number] | undefined {
  if (!value) return undefined;
  const parts = value.split(",").map((p) => parseFloat(p.trim()));
  if (parts.length !== 3 || parts.some((p) => !Number.isFinite(p))) return undefined;
  return [parts[0], parts[1], parts[2]];
}

export function parseBoolAttr(value: string | null): boolean | undefined {
  if (value === null) return undefined;
  if (value === "false" || value === "0") return false;
  return true;
}

export function parseInvert(value: string | null): boolean | number | undefined {
  if (value === null) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  const n = parseFloat(value);
  if (Number.isFinite(n)) return n;
  return true;
}

export function parseAxis(value: string | null): "x" | "y" | undefined {
  if (value === "x" || value === "y") return value;
  return undefined;
}
