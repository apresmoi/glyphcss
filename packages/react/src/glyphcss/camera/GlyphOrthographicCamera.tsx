/**
 * GlyphOrthographicCamera — configures an orthographic ASCII camera on the
 * parent GlyphScene.
 */
import { memo, useEffect, useMemo, useRef } from "react";
import type { ReactNode } from "react";
import type { GlyphCamera, GlyphOrthographicCameraOptions } from "glyphcss";
import { createGlyphOrthographicCamera } from "glyphcss";
import { useGlyphSceneContext } from "../scene/context";
import { GlyphCameraContext } from "./context";

export interface GlyphOrthographicCameraProps {
  rotX?: number;
  rotY?: number;
  /** Orthographic zoom (fraction of min(cols, rows)). Default 0.4. */
  zoom?: number;
  /** Center of projection in normalized grid coords. Default [0.5, 0.5]. */
  center?: [number, number];
  children?: ReactNode;
}

function GlyphOrthographicCameraInner({
  rotX,
  rotY,
  zoom,
  center,
  children,
}: GlyphOrthographicCameraProps) {
  const { sceneRef } = useGlyphSceneContext();
  const cameraRef = useRef<GlyphCamera | null>(null);

  if (!cameraRef.current) {
    const opts: GlyphOrthographicCameraOptions = {};
    if (rotX !== undefined) opts.rotX = rotX;
    if (rotY !== undefined) opts.rotY = rotY;
    if (zoom !== undefined) opts.zoom = zoom;
    if (center !== undefined) opts.center = center;
    cameraRef.current = createGlyphOrthographicCamera(opts);
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
    if (zoom !== undefined && camera.zoom !== zoom) { camera.zoom = zoom; dirty = true; }
    if (dirty) sceneRef.current?.rerender();
  });

  const rerender = () => sceneRef.current?.rerender();
  const ctxValue = useMemo(() => ({ cameraRef, rerender }), [cameraRef]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <GlyphCameraContext.Provider value={ctxValue}>
      {children}
    </GlyphCameraContext.Provider>
  );
}

export const GlyphOrthographicCamera = memo(GlyphOrthographicCameraInner);
