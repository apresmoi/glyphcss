import { useEffect, useRef } from "react";
import Stats from "stats-js/src/Stats.js";
import styles from "./StatsOverlay.module.css";

/** Where the readout pins itself. Defaults to the bottom-right corner it has
 *  always used; `top-left` anchors it to the top-left of the nearest positioned
 *  ancestor instead, for layouts where the bottom-right corner is occupied
 *  (e.g. /wordart's preset footer). */
export type StatsAnchor = "bottom-right" | "top-left";

export function StatsOverlay({
  anchor = "bottom-right",
  container,
}: {
  anchor?: StatsAnchor;
  /** Mount point; defaults to `document.body`. Pass the render area to anchor
   *  the readout inside it rather than to the viewport. */
  container?: HTMLElement | null;
} = {}): null {
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const host = container ?? document.body;
    const topLeft = anchor === "top-left";
    const statsContainer = document.createElement("div");
    statsContainer.className = `glyph-stats-host ${styles.root} ${topLeft ? styles.topLeft : ""} ${host !== document.body ? styles.contained : ""}`;

    const stats = [0, 1, 2].map((mode) => {
      const stat = new Stats();
      stat.setMode(mode);
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
      frameRef.current = null;
    };
  }, [anchor, container]);

  return null;
}
