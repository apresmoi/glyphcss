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
  /* The bottom-right corner is taken over by the mobile gallery tab bar. */
  @media (max-width: 760px) {
    .glyph-stats-host { display: none !important; }
  }
`;

/** Where the readout pins itself. Defaults to the bottom-right corner it has
 *  always used; `top-left` anchors it to the top-left of the nearest positioned
 *  ancestor instead, for layouts where the bottom-right corner is occupied
 *  (e.g. /wordart's preset footer). */
export type StatsAnchor = "bottom-right" | "top-left";

export function StatsOverlay({ anchor = "bottom-right", container }: {
  anchor?: StatsAnchor;
  /** Mount point; defaults to `document.body`. Pass the render area to anchor
   *  the readout inside it rather than to the viewport. */
  container?: HTMLElement | null;
} = {}): null {
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    // Inject terminal style for stats panels
    const styleEl = document.createElement("style");
    styleEl.setAttribute("data-glyph-stats", "");
    styleEl.textContent = STATS_STYLE;
    document.head.appendChild(styleEl);

    const host = container ?? document.body;
    const topLeft = anchor === "top-left";
    const statsContainer = document.createElement("div");
    statsContainer.className = "glyph-stats-host";
    statsContainer.style.position = host === document.body ? "fixed" : "absolute";
    statsContainer.style.zIndex = "30";
    statsContainer.style.right = topLeft ? "auto" : "12px";
    statsContainer.style.bottom = topLeft ? "auto" : "12px";
    statsContainer.style.top = topLeft ? "12px" : "auto";
    statsContainer.style.left = topLeft ? "12px" : "auto";
    statsContainer.style.display = "flex";
    statsContainer.style.alignItems = topLeft ? "flex-start" : "flex-end";

    const stats = [0, 1, 2].map((mode) => {
      const stat = new Stats();
      stat.setMode(mode);
      stat.dom.style.position = "static";
      stat.dom.style.pointerEvents = "none";
      statsContainer.appendChild(stat.dom);
      return stat;
    });

    host.appendChild(statsContainer);

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
  }, [anchor, container]);

  return null;
}
