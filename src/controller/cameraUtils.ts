import { DEFAULT_CAMERA_PROPS } from "./defaults";

export function resolveInvertMultiplier(value: number | boolean | undefined): number | undefined {
  if (typeof value === "number") {
    if (value === 0) return undefined;
    return value < 0 ? -1 : 1;
  }
  if (typeof value === "boolean") {
    return value ? -1 : 1;
  }
  return undefined;
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
