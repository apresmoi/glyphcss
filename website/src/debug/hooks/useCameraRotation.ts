import { useEffect, useState } from "react";
import type { RefObject } from "react";

const DEFAULT = { rotX: 65, rotY: 45 };

/**
 * Polls the live `transform` of the closest `.voxcss-scene` inside `ref` and
 * extracts the current rotateX / rotate values. Drag-rotation bypasses React,
 * so we read the inline style every 200ms and only push state when the angles
 * actually change beyond a small threshold (avoids re-render churn).
 */
export function useCameraRotation(ref: RefObject<HTMLElement | null>): { rotX: number; rotY: number } {
  const [rot, setRot] = useState(DEFAULT);
  useEffect(() => {
    const id = setInterval(() => {
      const root = ref.current;
      if (!root) return;
      const sceneEl = root.querySelector(".voxcss-scene") as HTMLElement | null;
      if (!sceneEl) return;
      const t = sceneEl.style.transform;
      const xMatch = t.match(/rotateX\(([-\d.]+)deg\)/);
      const yMatch = t.match(/rotate\(([-\d.]+)deg\)/);
      const rotX = xMatch ? parseFloat(xMatch[1]) : DEFAULT.rotX;
      const rotY = yMatch ? parseFloat(yMatch[1]) : DEFAULT.rotY;
      setRot((prev) =>
        Math.abs(prev.rotX - rotX) < 0.5 && Math.abs(prev.rotY - rotY) < 0.5
          ? prev
          : { rotX, rotY }
      );
    }, 200);
    return () => clearInterval(id);
  }, [ref]);
  return rot;
}
