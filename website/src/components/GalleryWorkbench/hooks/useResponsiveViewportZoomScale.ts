import { type RefObject, useEffect, useState } from "react";
import { initialResponsiveZoomScale, responsiveZoomScaleForViewport } from "../controllerHelpers";

export function useResponsiveViewportZoomScale(viewportRef: RefObject<HTMLDivElement | null>): number {
  const [scale, setScale] = useState(initialResponsiveZoomScale);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const updateScale = (width: number, height: number): void => {
      const next = responsiveZoomScaleForViewport(width, height);
      setScale((current) => (Math.abs(current - next) < 0.005 ? current : next));
    };
    const readScale = (): void => {
      const rect = viewport.getBoundingClientRect();
      updateScale(rect.width, rect.height);
    };

    readScale();
    window.addEventListener("resize", readScale);

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver((entries) => {
        const rect = entries[0]?.contentRect;
        if (rect) updateScale(rect.width, rect.height);
        else readScale();
      });
      observer.observe(viewport);
    }

    return () => {
      window.removeEventListener("resize", readScale);
      observer?.disconnect();
    };
  }, [viewportRef]);

  return scale;
}
