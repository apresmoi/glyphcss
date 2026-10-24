import { afterEach, expect, it, vi } from "vitest";
import { createViewSyncThrottle } from "./viewSyncThrottle";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it("syncs at most once per interval and always once after the last request", () => {
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 16));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
  let view = 0;
  const seen: number[] = [];
  const throttle = createViewSyncThrottle(() => seen.push(view), 200);
  // A drag: one request per 16 ms frame for one second.
  for (let i = 1; i <= 60; i++) { view = i; throttle.request(); vi.advanceTimersByTime(16); }
  vi.advanceTimersByTime(1000);
  expect(seen.length).toBeLessThanOrEqual(7);
  expect(seen.at(-1)).toBe(60);
});

it("cancel drops a pending sync", () => {
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 16));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
  const sync = vi.fn();
  const throttle = createViewSyncThrottle(sync, 200);
  throttle.request(); throttle.cancel();
  vi.advanceTimersByTime(1000);
  expect(sync).not.toHaveBeenCalled();
});
