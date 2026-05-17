/**
 * GlyphcssOrthographicCamera — configures an orthographic ASCII camera on the
 * parent GlyphcssScene.
 */
import { memo, useEffect, useMemo, useRef } from "react";
import type { ReactNode } from "react";
import type { GlyphcssCamera, GlyphcssOrthographicCameraOptions } from "glyphcss";
import { createGlyphcssOrthographicCamera } from "glyphcss";
import { useGlyphcssSceneContext } from "../scene/context";
import { GlyphcssCameraContext } from "./context";

export interface GlyphcssOrthographicCameraProps {
  rotX?: number;
  rotY?: number;
  /** Orthographic zoom (fraction of min(cols, rows)). Default 0.4. */
  zoom?: number;
  /** Center of projection in normalized grid coords. Default [0.5, 0.5]. */
  center?: [number, number];
  children?: ReactNode;
}

function GlyphcssOrthographicCameraInner({
  rotX,
  rotY,
  zoom,
  center,
  children,
}: GlyphcssOrthographicCameraProps) {
  const { sceneRef } = useGlyphcssSceneContext();
  const cameraRef = useRef<GlyphcssCamera | null>(null);

  if (!cameraRef.current) {
    const opts: GlyphcssOrthographicCameraOptions = {};
    if (rotX !== undefined) opts.rotX = rotX;
    if (rotY !== undefined) opts.rotY = rotY;
    if (zoom !== undefined) opts.zoom = zoom;
    if (center !== undefined) opts.center = center;
    cameraRef.current = createGlyphcssOrthographicCamera(opts);
  }

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !cameraRef.current) return;
    scene.setOptions({ camera: cameraRef.current });
    scene.rerender();
  }, [sceneRef]);

  useEffect(() => {
    const camera = cameraRef.current;
    if (!camera) return;
    let dirty = false;
    if (rotX !== undefined && camera.rotX !== rotX) { camera.rotX = rotX; dirty = true; }
    if (rotY !== undefined && camera.rotY !== rotY) { camera.rotY = rotY; dirty = true; }
    if (zoom !== undefined && camera.scale !== zoom) { camera.scale = zoom; dirty = true; }
    if (dirty) sceneRef.current?.rerender();
  });

  const rerender = () => sceneRef.current?.rerender();
  const ctxValue = useMemo(() => ({ cameraRef, rerender }), [cameraRef]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <GlyphcssCameraContext.Provider value={ctxValue}>
      {children}
    </GlyphcssCameraContext.Provider>
  );
}

export const GlyphcssOrthographicCamera = memo(GlyphcssOrthographicCameraInner);
