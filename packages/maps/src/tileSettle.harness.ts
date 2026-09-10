/**
 * NOT SHIPPED — a test-only helper, imported by `widget.*.test.ts`.
 *
 * A widget test that needs the SETTLED frame has to wait for the tile sweep,
 * and the sweep has no completion signal of its own: `scheduleTileUpdate`
 * debounces, the provider's promises resolve in their own microtasks, and a
 * mount can schedule the next sweep. So these tests waited a fixed slice of
 * wall clock instead — 250 ms here, 600 ms there — and a fixed sleep is not a
 * settle condition. It is a FLOOR under the test's own budget that buys
 * nothing when the work finishes early, and a CEILING it silently blows
 * through when the machine is slow: three of them timed out in CI at 5,000 ms
 * (and one at 30,000) while passing in 1.7-2.8 s on the author's machine.
 *
 * What is observable is the traffic itself, and the test owns the provider.
 * {@link countTiles} wraps one so every request is counted, and
 * {@link settleTiles} waits until nothing is in flight AND nothing has started
 * for a full debounce window — quiescence has to outlive one gate, or a sweep
 * that a mount just scheduled reads as "done". Adaptive in both directions:
 * it returns as soon as the widget is finished, and it keeps waiting when the
 * machine is loaded rather than asserting on a half-built frame.
 */
import type { GlyphMapProvider } from "./provider";
import type { GlyphMapVectorProvider } from "./vector/types";

/** `createGlyphMap`'s own `scheduleTileUpdate` debounce. */
export const GLYPH_MAP_TILE_DEBOUNCE_MS = 180;

/** One debounce window plus a margin for a late timer — the quiet period a settled sweep must survive. */
const QUIET_MS = GLYPH_MAP_TILE_DEBOUNCE_MS + 40;

/** How often the settle loop looks; short enough that the wait is the widget's, not the poll's. */
const POLL_MS = 10;

export interface GlyphMapTileTraffic {
  /** Requests issued. */
  starts: number;
  /** Requests settled, resolved or rejected. */
  done: number;
  /** `Date.now()` of the most recent request. */
  lastStart: number;
}

function trackedLoad<T>(
  traffic: GlyphMapTileTraffic,
  load: (z: number, x: number, y: number) => Promise<T>,
): (z: number, x: number, y: number) => Promise<T> {
  return (z, x, y) => {
    traffic.starts++;
    traffic.lastStart = Date.now();
    const settle = () => { traffic.done++; };
    return load(z, x, y).then((value) => { settle(); return value; }, (error) => { settle(); throw error; });
  };
}

/**
 * The same provider with its `loadTile` counted. Identity is preserved
 * everywhere else — the widget's cache, LOD ladder and `resolveTile`
 * capability all see the original object's own fields.
 */
export function countTiles<P extends GlyphMapProvider | GlyphMapVectorProvider>(
  provider: P,
): { readonly provider: P; readonly traffic: GlyphMapTileTraffic } {
  const traffic: GlyphMapTileTraffic = { starts: 0, done: 0, lastStart: 0 };
  return {
    traffic,
    provider: { ...provider, loadTile: trackedLoad(traffic, provider.loadTile.bind(provider)) } as P,
  };
}

/**
 * Resolve once the sweep is quiescent: nothing in flight, and nothing started
 * for {@link QUIET_MS}. Throws rather than resolving on a half-built frame if
 * the widget never goes quiet, so a real hang stays a failure.
 *
 * The quiet window is measured from the LATER of the last request and this
 * call, which is what makes it safe to call straight after the `setView` or
 * `setProjection` that provokes the sweep: the widget's debounce means the
 * next request has not been issued yet, so a window measured from the
 * PREVIOUS sweep's last request would already be over and the settle would
 * return before the new sweep started at all.
 *
 * `traffic` of `null` means no provider is mounted — nothing streams, so
 * there is no sweep to wait for.
 */
export async function settleTiles(traffic: GlyphMapTileTraffic | null, timeoutMs = 20_000): Promise<void> {
  const called = Date.now();
  const deadline = called + timeoutMs;
  for (;;) {
    const now = Date.now();
    const idle = traffic !== null && traffic.starts === traffic.done;
    const quietSince = traffic === null ? 0 : (idle ? Math.max(traffic.lastStart, called) : now);
    if (now - quietSince > QUIET_MS) return;
    if (now > deadline) {
      throw new Error(`tile sweep never settled within ${timeoutMs}ms (starts=${traffic?.starts}, done=${traffic?.done})`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}
