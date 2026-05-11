import { useEffect, useRef } from "react";
import Stats from "stats-js/src/Stats.js";

export function StatsJsPanel() {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const stats = new Stats();
    stats.dom.className = "dn-stats-js";
    stats.dom.removeAttribute("style");

    Array.from(stats.dom.children).forEach((child) => {
      if (child instanceof HTMLElement) {
        child.style.display = "block";
      }
    });

    host.appendChild(stats.dom);

    let frameId = 0;
    const tick = () => {
      stats.update();
      frameId = requestAnimationFrame(tick);
    };
    frameId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frameId);
      stats.dom.remove();
    };
  }, []);

  return <div className="dn-stats-js-host" ref={hostRef} />;
}
