import { DEFAULT_CAMERA_PROPS } from "./defaults";

export function resolveInvertMultiplier(value: number | boolean | undefined, fallback = 1): number {
  if (typeof value === "number") {
    if (value === 0) return fallback;
    return value < 0 ? -1 : 1;
  }
  if (typeof value === "boolean") {
    return value ? -1 : 1;
  }
  if (typeof DEFAULT_CAMERA_PROPS.invert === "number") {
    return DEFAULT_CAMERA_PROPS.invert;
  }
  return fallback;
}

export function normalizePerspectiveValue(value: number | boolean | undefined): number | false | undefined {
  if (value === false) return false;
  if (typeof value === "number") return value;
  if (value === true) return DEFAULT_CAMERA_PROPS.perspective as number;
  return undefined;
}

export function formatPerspectiveStyle(value: number | boolean | undefined, fallback = 8000): string {
  const normalized = normalizePerspectiveValue(value);
  if (normalized === false) {
    return "none";
  }
  const resolved = typeof normalized === "number" ? normalized : fallback;
  return `${resolved}px`;
}
