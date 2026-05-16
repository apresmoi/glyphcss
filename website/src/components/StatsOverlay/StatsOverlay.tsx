import { useEffect, useRef } from "react";
import Stats from "stats-js/src/Stats.js";

export function StatsOverlay(): null {
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const statsContainer = document.createElement("div");
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
      frameRef.current = null;
    };
  }, []);

  return null;
}
