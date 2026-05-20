import { useEffect, useRef } from "react";
import Stats from "stats-js/src/Stats.js";

// Terminal aesthetic override for stats-js panels.
// stats-js injects its own inline styles; we have to beat them with !important.
const STATS_STYLE = `
  .glyph-stats-host {
    position: fixed;
    right: 12px;
    bottom: 12px;
    z-index: 30;
    top: auto;
    left: auto;
    display: flex;
    align-items: flex-end;
    gap: 4px;
    font-family: ui-monospace, "JetBrains Mono", "SF Mono", "Menlo", monospace !important;
  }
  .glyph-stats-host > div {
    border: 1px solid rgba(255, 232, 184, 0.18) !important;
    background: #0b0d10 !important;
    border-radius: 0 !important;
    overflow: hidden !important;
  }
  /* No display override here — stats-js sets display: none on inactive
     canvases (each panel has 3 canvases for FPS/MS/MB modes), and forcing
     display: block makes all three render at once, triplicating each panel. */
  .glyph-stats-host canvas {
    filter: hue-rotate(180deg) saturate(0.6) brightness(0.75) !important;
  }
  .glyph-stats-host > div > div:first-child {
    background: #0b0d10 !important;
    color: rgba(255, 232, 184, 0.94) !important;
    font-family: ui-monospace, "JetBrains Mono", "SF Mono", "Menlo", monospace !important;
    font-size: 10px !important;
    font-weight: 400 !important;
    letter-spacing: 0.06em !important;
  }
`;

export function StatsOverlay(): null {
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    // Inject terminal style for stats panels
    const styleEl = document.createElement("style");
    styleEl.setAttribute("data-glyph-stats", "");
    styleEl.textContent = STATS_STYLE;
    document.head.appendChild(styleEl);

    const statsContainer = document.createElement("div");
    statsContainer.className = "glyph-stats-host";
    statsContainer.style.position = "fixed";
    statsContainer.style.right = "12px";
    statsContainer.style.bottom = "12px";
    statsContainer.style.zIndex = "30";
    statsContainer.style.top = "auto";
    statsContainer.style.left = "auto";
    statsContainer.style.display = "flex";
    statsContainer.style.alignItems = "flex-end";

    const stats = [0, 1, 2].map((mode) => {
      const stat = new Stats();
      stat.setMode(mode);
      stat.dom.style.position = "static";
      stat.dom.style.pointerEvents = "none";
      statsContainer.appendChild(stat.dom);
      return stat;
    });

    document.body.appendChild(statsContainer);

    const tick = () => {
      for (const stat of stats) {
        stat.update();
      }
      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);

    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
      }
      statsContainer.remove();
      styleEl.remove();
      frameRef.current = null;
    };
  }, []);

  return null;
}
