/**
 * GlyphcssPerspectiveCamera — configures a perspective ASCII camera on the
 * parent GlyphcssScene. Mirrors PolyPerspectiveCamera's prop surface, adapted
 * for the ASCII rasterizer (no CSS perspective value; uses GlyphcssCamera
 * distance/scale/stretch instead).
 *
 * Must be placed inside <GlyphcssScene>.
 */
import { memo, useEffect, useMemo, useRef } from "react";
import type { ReactNode } from "react";
import type { GlyphcssCamera, GlyphcssPerspectiveCameraOptions } from "glyphcss";
import { createGlyphcssPerspectiveCamera } from "glyphcss";
import { useGlyphcssSceneContext } from "../scene/context";
import { GlyphcssCameraContext } from "./context";

export interface GlyphcssPerspectiveCameraProps {
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

function GlyphcssPerspectiveCameraInner({
  rotX,
  rotY,
  distance,
  zoom,
  stretch,
  center,
  children,
}: GlyphcssPerspectiveCameraProps) {
  const { sceneRef } = useGlyphcssSceneContext();
  const cameraRef = useRef<GlyphcssCamera | null>(null);

  if (!cameraRef.current) {
    const opts: GlyphcssPerspectiveCameraOptions = {};
    if (rotX !== undefined) opts.rotX = rotX;
    if (rotY !== undefined) opts.rotY = rotY;
    if (distance !== undefined) opts.distance = distance;
    if (zoom !== undefined) opts.zoom = zoom;
    if (stretch !== undefined) opts.stretch = stretch;
    if (center !== undefined) opts.center = center;
    cameraRef.current = createGlyphcssPerspectiveCamera(opts);
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
    <GlyphcssCameraContext.Provider value={ctxValue}>
      {children}
    </GlyphcssCameraContext.Provider>
  );
}

export const GlyphcssPerspectiveCamera = memo(GlyphcssPerspectiveCameraInner);
