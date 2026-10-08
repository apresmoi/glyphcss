export type ExampleQueryValue = string | number | boolean;

type NumberParamOptions = {
  min?: number;
  max?: number;
  step?: number;
};

function clamp(value: number, min = -Infinity, max = Infinity): number {
  return Math.max(min, Math.min(max, value));
}

export function readQueryNumber(
  params: URLSearchParams,
  key: string,
  fallback: number,
  options: NumberParamOptions = {},
): number {
  const raw = params.get(key);
  const parsed = raw === null || raw.trim() === "" ? NaN : Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  let value = clamp(parsed, options.min, options.max);
  if (options.step && options.step > 0) {
    const base = options.min ?? 0;
    value = base + Math.round((value - base) / options.step) * options.step;
    value = clamp(Number(value.toFixed(10)), options.min, options.max);
  }
  return value;
}

export function readQueryBoolean(params: URLSearchParams, key: string, fallback: boolean): boolean {
  const raw = params.get(key)?.toLowerCase();
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") return true;
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false;
  return fallback;
}

export function readQueryEnum<T extends string>(
  params: URLSearchParams,
  key: string,
  fallback: T,
  values: readonly T[],
): T {
  const raw = params.get(key);
  return raw !== null && values.includes(raw as T) ? (raw as T) : fallback;
}

export function readQueryString(
  params: URLSearchParams,
  key: string,
  fallback: string,
  validate: (value: string) => boolean = () => true,
): string {
  const raw = params.get(key);
  return raw !== null && validate(raw) ? raw : fallback;
}
