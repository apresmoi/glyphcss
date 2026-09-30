import { type ExampleQueryValue } from "../model/queryValues";

function formatQueryNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return Number(value.toFixed(6)).toString();
}

export function replaceExampleQuery(values: Record<string, ExampleQueryValue>): void {
  const url = new URL(window.location.href);
  for (const key of Object.keys(values)) url.searchParams.delete(key);
  for (const [key, value] of Object.entries(values)) {
    const serialized =
      typeof value === "boolean" ? (value ? "1" : "0") : typeof value === "number" ? formatQueryNumber(value) : value;
    url.searchParams.set(key, serialized);
  }
  const next = `${url.pathname}${url.search}${url.hash}`;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (next !== current) window.history.replaceState(window.history.state, "", next);
}

export function createExampleQuerySync(readValues: () => Record<string, ExampleQueryValue>): {
  schedule(): void;
  write(): void;
} {
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
