/**
 * Runs `sync` on an animation frame at most once per `intervalMs`, and always
 * once more after the last request, so a burst of requests ends on an exact
 * final sync.
 */
export function createViewSyncThrottle(sync: () => void, intervalMs: number) {
  let frame: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let last = -Infinity;
  function request(): void {
    if (frame !== null || timer !== null) return;
    const wait = last + intervalMs - performance.now();
    if (wait > 0) {
      timer = setTimeout(() => {
        timer = null;
        request();
      }, wait);
      return;
    }
    frame = requestAnimationFrame(() => {
      frame = null;
      last = performance.now();
      sync();
    });
  }
  function cancel(): void {
    if (frame !== null) cancelAnimationFrame(frame);
    if (timer !== null) clearTimeout(timer);
    frame = timer = null;
  }
  return { request, cancel };
}
