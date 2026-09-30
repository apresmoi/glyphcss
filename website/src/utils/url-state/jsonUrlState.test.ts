import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDebouncedJsonUrlWriter } from "../../services/url-state/jsonWriter";
import { createJsonUrlEnvelope } from "./jsonEnvelope";

interface Demo {
  readonly label: string;
  readonly count: number;
  readonly items: readonly { readonly id: number; readonly name: string }[];
}

function validateDemo(value: unknown): Demo | null {
  if (typeof value !== "object" || value === null) return null;
  const { label, count, items } = value as Record<string, unknown>;
  if (typeof label !== "string" || typeof count !== "number" || !Array.isArray(items)) return null;
  const cleanItems: Demo["items"][number][] = [];
  for (const item of items) {
    if (typeof item !== "object" || item === null) return null;
    const { id, name } = item as Record<string, unknown>;
    if (typeof id !== "number" || typeof name !== "string") return null;
    cleanItems.push({ id, name });
  }
  return { label, count, items: cleanItems };
}

const codec = createJsonUrlEnvelope<Demo>("v1", validateDemo);
const sample: Demo = { label: "sample", count: 3, items: [{ id: 1, name: "a" }, { id: 2, name: "b" }] };

describe("createJsonUrlEnvelope", () => {
  it("round-trips through the compressed ('v1.') form when CompressionStream is available", async () => {
    const raw = await codec.encode(sample);
    expect(raw.startsWith("v1.")).toBe(true);
    expect(await codec.decode(raw)).toEqual(sample);
  });

  it("round-trips unicode labels and a 200-row item array", async () => {
    const big: Demo = {
      label: "héllo 世界 🎉 — café",
      count: 200,
      items: Array.from({ length: 200 }, (_, i) => ({ id: i, name: `row ☂ ${i}` })),
    };
    const raw = await codec.encode(big);
    expect(await codec.decode(raw)).toEqual(big);
  });

  it("round-trips an empty-array edge case", async () => {
    const empty: Demo = { label: "", count: 0, items: [] };
    const raw = await codec.encode(empty);
    expect(await codec.decode(raw)).toEqual(empty);
  });

  it("falls back to the plain-JSON ('v1j.') form when CompressionStream/DecompressionStream are unavailable, and still round-trips", async () => {
    const realCS = globalThis.CompressionStream;
    const realDS = globalThis.DecompressionStream;
    // @ts-expect-error simulating a browser with no Compression Streams support
    delete globalThis.CompressionStream;
    // @ts-expect-error same
    delete globalThis.DecompressionStream;
    try {
      const raw = await codec.encode(sample);
      expect(raw.startsWith("v1j.")).toBe(true);
      expect(await codec.decode(raw)).toEqual(sample);
    } finally {
      globalThis.CompressionStream = realCS;
      globalThis.DecompressionStream = realDS;
    }
  });

  it("decodes a 'v1j.' payload even when CompressionStream IS available (the fallback format never depends on the decoder's own environment)", async () => {
    const realCS = globalThis.CompressionStream;
    const realDS = globalThis.DecompressionStream;
    // @ts-expect-error force the fallback form to be written
    delete globalThis.CompressionStream;
    // @ts-expect-error same
    delete globalThis.DecompressionStream;
    let raw: string;
    try {
      raw = await codec.encode(sample);
    } finally {
      globalThis.CompressionStream = realCS;
      globalThis.DecompressionStream = realDS;
    }
    expect(raw.startsWith("v1j.")).toBe(true);
    expect(await codec.decode(raw)).toEqual(sample);
  });

  it("never throws and returns null for an absent, empty, or garbage param", async () => {
    expect(await codec.decode(null)).toBeNull();
    expect(await codec.decode(undefined)).toBeNull();
    expect(await codec.decode("")).toBeNull();
    expect(await codec.decode("not-a-real-payload")).toBeNull();
    expect(await codec.decode("v1.###not-base64url###")).toBeNull();
    expect(await codec.decode("v1j.###not-base64url###")).toBeNull();
  });

  it("returns null for an unrecognized version prefix rather than guessing", async () => {
    const raw = await codec.encode(sample);
    const mutatedVersion = `v2${raw.slice(2)}`;
    expect(await codec.decode(mutatedVersion)).toBeNull();
  });

  it("returns null when the decoded JSON fails the caller's own validation (e.g. a field with the wrong type)", async () => {
    const badRaw = await codec.encode({ ...sample, count: "not a number" } as unknown as Demo);
    expect(await codec.decode(badRaw)).toBeNull();
  });

  it("truncating a real compressed payload fails to decode rather than throwing or silently succeeding", async () => {
    const raw = await codec.encode(sample);
    const truncated = raw.slice(0, Math.floor(raw.length / 2));
    expect(await codec.decode(truncated)).toBeNull();
  });
});

function makeFakeWindow(startUrl: string) {
  const url = new URL(startUrl);
  const win = {
    location: {
      get search() { return url.search; },
      get pathname() { return url.pathname; },
      get hash() { return url.hash; },
    },
    history: {
      state: null as unknown,
      replaceState(state: unknown, _title: string, next: string) {
        win.history.state = state;
        const resolved = new URL(next, url.origin);
        url.pathname = resolved.pathname;
        url.search = resolved.search;
        url.hash = resolved.hash;
      },
    },
  };
  return win;
}

// Real timers throughout: `deflateRaw`/`inflateRaw` go through the real
// Streams API backed by Node's native zlib binding, which settles on the
// libuv thread pool — fake timers can fast-forward `setTimeout` callbacks
// but can't fast-forward that real async work, so a fake-timer version of
// these tests flakes on exactly the assertions that wait for an encode to
// finish. A short real 150ms debounce plus a small settle margin is cheap
// enough to just wait out for real.
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const SETTLE_MS = 150 + 200;

describe("createDebouncedJsonUrlWriter", () => {
  let win: ReturnType<typeof makeFakeWindow>;
  beforeEach(() => {
    win = makeFakeWindow("http://localhost/demo");
    (globalThis as { window?: unknown }).window = win;
  });
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("coalesces a burst of state changes into exactly one write, 150ms after the last one", async () => {
    const writer = createDebouncedJsonUrlWriter(codec, "x", 150);
    writer({ ...sample, count: 1 });
    await sleep(50);
    writer({ ...sample, count: 2 });
    await sleep(50);
    writer({ ...sample, count: 3 });
    expect(win.location.search).toBe(""); // still nothing written — every call so far re-armed the timer
    await sleep(SETTLE_MS);
    const raw = new URLSearchParams(win.location.search).get("x");
    expect(raw).not.toBeNull();
    expect(await codec.decode(raw)).toEqual({ ...sample, count: 3 });
  });

  it("uses history.replaceState, never pushState — the URL changes with no navigation entry created", async () => {
    let pushCount = 0;
    (win.history as { pushState?: () => void }).pushState = () => { pushCount++; };
    const writer = createDebouncedJsonUrlWriter(codec, "x", 150);
    writer(sample);
    await sleep(SETTLE_MS);
    expect(pushCount).toBe(0);
    expect(new URLSearchParams(win.location.search).get("x")).not.toBeNull();
  });

  it("skips the write (no replaceState call) when the encoded value hasn't changed", async () => {
    const writer = createDebouncedJsonUrlWriter(codec, "x", 150);
    writer(sample);
    await sleep(SETTLE_MS);
    const before = win.location.search;
    let replaceCalls = 0;
    const originalReplace = win.history.replaceState.bind(win.history);
    win.history.replaceState = (...args: Parameters<typeof originalReplace>) => { replaceCalls++; return originalReplace(...args); };
    writer({ ...sample }); // structurally identical -> same encoded string
    await sleep(SETTLE_MS);
    expect(replaceCalls).toBe(0);
    expect(win.location.search).toBe(before);
  });

  it("reports the encoded size via onEncoded even when the write itself is skipped", async () => {
    const sizes: number[] = [];
    const writer = createDebouncedJsonUrlWriter(codec, "x", 150, ({ sizeBytes }) => sizes.push(sizeBytes));
    writer(sample);
    await sleep(SETTLE_MS);
    writer({ ...sample });
    await sleep(SETTLE_MS);
    expect(sizes).toHaveLength(2);
    expect(sizes[0]).toBeGreaterThan(0);
    expect(sizes[1]).toBe(sizes[0]);
  });

  it("discards a stale encode that resolves after a newer state was already scheduled", async () => {
    const writer = createDebouncedJsonUrlWriter(codec, "x", 150);
    writer({ ...sample, count: 1 });
    await sleep(SETTLE_MS);
    writer({ ...sample, count: 999 });
    await sleep(SETTLE_MS);
    const raw = new URLSearchParams(win.location.search).get("x");
    expect(await codec.decode(raw)).toEqual({ ...sample, count: 999 });
  });
});
