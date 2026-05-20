/**
 * GlyphPerspectiveCamera — configures a perspective ASCII camera on the
 * parent GlyphScene. Mirrors PolyPerspectiveCamera's prop surface, adapted
 * for the ASCII rasterizer (no CSS perspective value; uses GlyphCamera
 * distance/scale/stretch instead).
 *
 * Must be placed inside <GlyphScene>.
 */
import { memo, useEffect, useMemo, useRef } from "react";
import type { ReactNode } from "react";
import type { GlyphCamera, GlyphPerspectiveCameraOptions } from "glyphcss";
import { createGlyphPerspectiveCamera } from "glyphcss";
import { useGlyphSceneContext } from "../scene/context";
import { GlyphCameraContext } from "./context";

export interface GlyphPerspectiveCameraProps {
  rotX?: number;
  rotY?: number;
  /** Perspective distance. Default 3. */
  distance?: number;
  /** Camera zoom — mesh fraction of min(cols, rows). Default 0.4. */
  zoom?: number;
  /** Extra horizontal stretch on top of cellAspect. Default 1.0. */
  stretch?: number;
  /** Center of projection in normalized grid coords. Default [0.5, 0.5]. */
  center?: [number, number];
  children?: ReactNode;
}

function GlyphPerspectiveCameraInner({
  rotX,
  rotY,
  distance,
  zoom,
  stretch,
  center,
  children,
}: GlyphPerspectiveCameraProps) {
  const { sceneRef } = useGlyphSceneContext();
  const cameraRef = useRef<GlyphCamera | null>(null);

  if (!cameraRef.current) {
    const opts: GlyphPerspectiveCameraOptions = {};
    if (rotX !== undefined) opts.rotX = rotX;
    if (rotY !== undefined) opts.rotY = rotY;
    if (distance !== undefined) opts.distance = distance;
    if (zoom !== undefined) opts.zoom = zoom;
    if (stretch !== undefined) opts.stretch = stretch;
    if (center !== undefined) opts.center = center;
    cameraRef.current = createGlyphPerspectiveCamera(opts);
  }

  // Register camera with the scene on mount
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !cameraRef.current) return;
    scene.setOptions({ camera: cameraRef.current });
    scene.rerender();
  }, [sceneRef]);

  // Sync prop changes
  useEffect(() => {
    const camera = cameraRef.current;
    if (!camera) return;
    let dirty = false;
    if (rotX !== undefined && camera.rotX !== rotX) { camera.rotX = rotX; dirty = true; }
    if (rotY !== undefined && camera.rotY !== rotY) { camera.rotY = rotY; dirty = true; }
    if (distance !== undefined && camera.distance !== distance) { camera.distance = distance; dirty = true; }
    if (zoom !== undefined && camera.zoom !== zoom) { camera.zoom = zoom; dirty = true; }
    if (stretch !== undefined && camera.stretch !== stretch) { camera.stretch = stretch; dirty = true; }
    if (dirty) {
      sceneRef.current?.rerender();
    }
  });

  const rerender = () => sceneRef.current?.rerender();
  const ctxValue = useMemo(() => ({ cameraRef, rerender }), [cameraRef]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <GlyphCameraContext.Provider value={ctxValue}>
      {children}
    </GlyphCameraContext.Provider>
  );
}

export const GlyphPerspectiveCamera = memo(GlyphPerspectiveCameraInner);
