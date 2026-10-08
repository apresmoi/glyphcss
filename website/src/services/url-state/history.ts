import { type UrlCodec, LARGE_STATE_THRESHOLD } from "../../utils/url-state/codec";

// ── Single-query-param glue (read/write, replaceState — never pushes a new
//    history entry, matching the existing gallery/synth/wordart behavior) ──

export function readUrlParam(param: string): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(param);
}

// P2 "a3" fix. WebKit throws `SecurityError` past ~100 `history.replaceState`
// calls in a rolling 30-second window — with no error boundary around a page
// like `/maps` (verified: no `componentDidCatch`/error-boundary anywhere in
// `website/src`), that throw unmounts the whole React root, not just the map.
// One trackpad flick alone is >100 wheel events, each triggering a "zoom"
// view-change that reaches here. This is a SLIDING-WINDOW RATE LIMIT, not an
// unconditional debounce: below the safety margin every call still commits
// `history.replaceState` immediately and synchronously — the same behavior
// every existing caller (gallery/synth/wordart's own "write then read back
// the same tick" tests included) already depends on — and only sustained,
// genuinely high-frequency bursts (a wheel flick, never a handful of
// ordinary state changes) get coalesced to the latest value per param and
// flushed once the window has room again.
const HISTORY_WRITE_WINDOW_MS = 30_000;

// Comfortably under WebKit's ~100 cap so normal (non-bursty) traffic never
// gets close enough to risk crossing it while this margin is still open.
const HISTORY_WRITE_SAFE_LIMIT = 80;

let historyWriteTimestamps: number[] = [];

const pendingUrlWrites = new Map<string, string | null>();

let pendingUrlWriteTimer: ReturnType<typeof setTimeout> | null = null;

function pruneHistoryWriteTimestamps(now: number): void {
  while (historyWriteTimestamps.length > 0 && now - historyWriteTimestamps[0]! >= HISTORY_WRITE_WINDOW_MS) {
    historyWriteTimestamps.shift();
  }
}

function commitUrlParam(param: string, value: string | null): void {
  const params = new URLSearchParams(window.location.search);
  if (value) params.set(param, value);
  else params.delete(param);
  const search = params.toString();
  const next = `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (next !== current) window.history.replaceState(window.history.state, "", next);
  historyWriteTimestamps.push(Date.now());
}

function scheduleUrlWriteFlush(): void {
  if (pendingUrlWriteTimer !== null) return;
  const now = Date.now();
  const oldest = historyWriteTimestamps[0] ?? now;
  const waitMs = Math.max(16, HISTORY_WRITE_WINDOW_MS - (now - oldest) + 1);
  pendingUrlWriteTimer = setTimeout(() => {
    pendingUrlWriteTimer = null;
    const now2 = Date.now();
    pruneHistoryWriteTimestamps(now2);
    for (const [param, value] of [...pendingUrlWrites]) {
      if (historyWriteTimestamps.length >= HISTORY_WRITE_SAFE_LIMIT) break;
      pendingUrlWrites.delete(param);
      commitUrlParam(param, value);
    }
    if (pendingUrlWrites.size > 0) scheduleUrlWriteFlush();
  }, waitMs);
}

export function writeUrlParam(param: string, value: string | null): void {
  if (typeof window === "undefined") return;
  const now = Date.now();
  pruneHistoryWriteTimestamps(now);
  if (pendingUrlWrites.size === 0 && historyWriteTimestamps.length < HISTORY_WRITE_SAFE_LIMIT) {
    commitUrlParam(param, value);
    return;
  }
  // Over the safety margin (or a coalesced write is already queued, which
  // preserves ordering): remember only the LATEST value per param — an
  // intermediate value during a burst is never observably different from
  // going straight to the final one — and flush once the window permits.
  pendingUrlWrites.set(param, value);
  scheduleUrlWriteFlush();
}

/** Writes the synchronous packed form immediately, then (only above the size
 *  threshold, only when supported) asynchronously swaps in a smaller deflated
 *  form once ready. Safe to call on every state change — the async upgrade is
 *  a no-op below the threshold. */
export function scheduleCompactedUrlWrite<S extends object>(codec: UrlCodec<S>, param: string, state: S): void {
  const packed = codec.encode(state);
  writeUrlParam(param, packed || null);
  if (packed.length <= LARGE_STATE_THRESHOLD) return;
  void codec.compact(state).then((compacted) => {
    if (compacted !== packed && readUrlParam(param) === packed) {
      writeUrlParam(param, compacted || null);
    }
  });
}
