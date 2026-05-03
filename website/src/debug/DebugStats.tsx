import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useDebug } from "./DebugLayout";
import { useFps } from "./hooks/useFps";
import { useCameraRotation } from "./hooks/useCameraRotation";

interface DebugStatsProps {
  voxelCount: number;
  /** Optional extra stat pairs to render. */
  extra?: Record<string, string | number>;
}

/**
 * Portals FPS / voxel / DOM / camera stats into the debug top bar. Reads DOM
 * count and live camera rotation off the voxcss scene element registered by
 * DebugScene.
 */
export function DebugStats({ voxelCount, extra }: DebugStatsProps) {
  const { statsHost, voxSceneRef } = useDebug();
  const fps = useFps();
  const { rotX, rotY } = useCameraRotation(voxSceneRef);
  const [domCount, setDomCount] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      const root = voxSceneRef.current;
      if (!root) return;
      // Count every descendant — gives a real picture of how heavy the
      // voxcss render is for this scene.
      setDomCount(root.querySelectorAll("*").length);
    }, 500);
    return () => clearInterval(id);
  }, [voxSceneRef, voxelCount]);

  if (!statsHost) return null;
  return createPortal(
    <>
      <span>FPS: <b>{fps}</b></span>
      <span>Voxels: <b>{voxelCount.toLocaleString()}</b></span>
      <span>DOM: <b>{domCount.toLocaleString()}</b></span>
      <span>rotX: <b>{rotX.toFixed(1)}°</b></span>
      <span>rotY: <b>{rotY.toFixed(1)}°</b></span>
      {extra && Object.entries(extra).map(([k, v]) => (
        <span key={k}>{k}: <b>{v}</b></span>
      ))}
    </>,
    statsHost
  );
}
