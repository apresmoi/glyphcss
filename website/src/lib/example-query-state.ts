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

export function readQueryBoolean(
  params: URLSearchParams,
  key: string,
  fallback: boolean,
): boolean {
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
  return raw !== null && values.includes(raw as T) ? raw as T : fallback;
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

function formatQueryNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return Number(value.toFixed(6)).toString();
}

export function replaceExampleQuery(values: Record<string, ExampleQueryValue>): void {
  const url = new URL(window.location.href);
  for (const key of Object.keys(values)) url.searchParams.delete(key);
  for (const [key, value] of Object.entries(values)) {
    const serialized = typeof value === "boolean"
      ? value ? "1" : "0"
      : typeof value === "number"
        ? formatQueryNumber(value)
        : value;
    url.searchParams.set(key, serialized);
  }
  const next = `${url.pathname}${url.search}${url.hash}`;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (next !== current) window.history.replaceState(window.history.state, "", next);
}

export function createExampleQuerySync(
  readValues: () => Record<string, ExampleQueryValue>,
): { schedule(): void; write(): void } {
  let queued = false;
  const write = () => {
    queued = false;
    replaceExampleQuery(readValues());
  };
  return {
    schedule() {
      if (queued) return;
      queued = true;
      queueMicrotask(write);
    },
    write,
  };
}
