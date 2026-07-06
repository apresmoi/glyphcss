/**
 * GlyphOrthographicCamera — outer wrapper that creates an orthographic camera
 * handle and provides it via GlyphCameraContext. <GlyphScene> must be placed
 * inside this component.
 */
import { memo, useEffect, useMemo, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { GlyphCamera, GlyphOrthographicCameraOptions } from "glyphcss";
import { createGlyphOrthographicCamera } from "glyphcss";
import { GlyphCameraContext } from "./context";

export interface GlyphOrthographicCameraProps {
  rotX?: number;
  rotY?: number;
  /** Orthographic zoom in CSS pixels per world unit. Default 0.65. */
  zoom?: number;
  /** Center of projection in normalized grid coords. Default [0.5, 0.5]. */
  center?: [number, number];
  /**
   * 9-element row-major 3×3 rotation matrix (same layout as `gc_opts.mat`).
   * Set together with `useMat=true` to use the quaternion/matrix camera path
   * instead of the 2-Euler turntable, eliminating pole singularity.
   */
  mat?: number[];
  /**
   * When `true` and `mat` is provided, use `mat` for projection instead of
   * Euler `rotX`/`rotY`.  Default `false` (Euler, backward compatible).
   */
  useMat?: boolean;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

function GlyphOrthographicCameraInner({
  rotX,
  rotY,
  zoom,
  center,
  mat,
  useMat,
  className,
  style,
  children,
}: GlyphOrthographicCameraProps) {
  const cameraRef = useRef<GlyphCamera | null>(null);
  const sceneRerenderRef = useRef<(() => void) | null>(null);

  if (!cameraRef.current) {
    const opts: GlyphOrthographicCameraOptions = {};
    if (rotX !== undefined) opts.rotX = rotX;
    if (rotY !== undefined) opts.rotY = rotY;
    if (zoom !== undefined) opts.zoom = zoom;
    if (center !== undefined) opts.center = center;
    cameraRef.current = createGlyphOrthographicCamera(opts);
  }

  // Sync prop changes to the camera handle and trigger scene rerender
  useEffect(() => {
    const camera = cameraRef.current;
    if (!camera) return;
    let dirty = false;
    if (rotX !== undefined && camera.rotX !== rotX) { camera.rotX = rotX; dirty = true; }
    if (rotY !== undefined && camera.rotY !== rotY) { camera.rotY = rotY; dirty = true; }
    if (zoom !== undefined && camera.zoom !== zoom) { camera.zoom = zoom; dirty = true; }
    // Matrix / quaternion path sync.
    if (mat !== undefined && camera.mat !== mat) { camera.mat = mat; dirty = true; }
    const nextUseMat = useMat ?? false;
    if (camera.useMat !== nextUseMat) { camera.useMat = nextUseMat; dirty = true; }
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

export const GlyphOrthographicCamera = memo(GlyphOrthographicCameraInner);
