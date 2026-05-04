import { useEffect, useState } from "react";

/**
 * Returns the current FPS, updated once per second. Same logic as the
 * VoxDemo.astro perf demo — count rAF callbacks per 1000ms window.
 */
export function useFps(): number {
  const [fps, setFps] = useState(0);
  useEffect(() => {
    let frameId = 0;
    let frames = 0;
    let sampleStart = 0;
    const tick = (now: number) => {
      if (!sampleStart) sampleStart = now;
      frames += 1;
      const elapsed = now - sampleStart;
      if (elapsed >= 1000) {
        setFps(Math.round((frames * 1000) / elapsed));
        frames = 0;
        sampleStart = now;
      }
      frameId = requestAnimationFrame(tick);
    };
    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, []);
  return fps;
}
