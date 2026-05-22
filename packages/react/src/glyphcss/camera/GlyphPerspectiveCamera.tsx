/**
 * GlyphPerspectiveCamera — outer wrapper that creates a perspective camera
 * handle and provides it via GlyphCameraContext. <GlyphScene> must be placed
 * inside this component.
 */
import { memo, useEffect, useMemo, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { GlyphCamera, GlyphPerspectiveCameraOptions } from "glyphcss";
import { createGlyphPerspectiveCamera } from "glyphcss";
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
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

function GlyphPerspectiveCameraInner({
  rotX,
  rotY,
  distance,
  zoom,
  stretch,
  center,
  className,
  style,
  children,
}: GlyphPerspectiveCameraProps) {
  const cameraRef = useRef<GlyphCamera | null>(null);
  const sceneRerenderRef = useRef<(() => void) | null>(null);

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

  // Sync prop changes to the camera handle and trigger scene rerender
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
      sceneRerenderRef.current?.();
    }
  });

  const rerender = useMemo(() => () => sceneRerenderRef.current?.(), []); // eslint-disable-line react-hooks/exhaustive-deps
  const ctxValue = useMemo(() => ({ cameraRef, rerender, sceneRerenderRef }), [cameraRef, rerender]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <GlyphCameraContext.Provider value={ctxValue}>
      <div className={className} style={style}>{children}</div>
    </GlyphCameraContext.Provider>
  );
}

export const GlyphPerspectiveCamera = memo(GlyphPerspectiveCameraInner);
