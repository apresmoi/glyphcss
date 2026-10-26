// The 60 → 30 fps fallback. A fluid that keeps missing vsyncs at 60 looks worse than a
// steady 30 (uneven motion, input lag that swings by a frame), so after a window of
// drawn frames with too many misses the cap drops to 30 for the rest of the session.
// A worker stall shows up here as a long gap before the next drawn frame.
// One-way on purpose: work done at 30 says nothing about whether 60 would now fit, so a
// recovery rule would oscillate.

export interface GlyphFluidFpsGovernor {
  readonly fps: 60 | 30;
  /** A frame was drawn at `now` (ms). */
  drawn(now: number): void;
}

const WINDOW = 60;
const MISS_RATE = 0.2;
/** Gaps longer than this are a hidden tab or a paused clock, not a slow frame. */
const IDLE_GAP_MS = 250;

export function createGlyphFluidFpsGovernor(initial: 60 | 30, fallback: boolean): GlyphFluidFpsGovernor {
  let fps = initial;
  let last = 0;
  let seen = 0;
  let missed = 0;
  const note = (miss: boolean) => {
    if (!fallback || fps !== 60) return;
    seen++;
    if (miss) missed++;
    if (seen < WINDOW) return;
    if (missed > WINDOW * MISS_RATE) fps = 30;
    seen = missed = 0;
  };
  return {
    get fps() {
      return fps;
    },
    drawn(now) {
      const gap = now - last;
      const counted = last > 0 && gap < IDLE_GAP_MS;
      last = now;
      if (counted) note(gap > (1000 / 60) * 1.5);
    },
  };
}
