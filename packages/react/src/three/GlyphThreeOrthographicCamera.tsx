import { memo, useEffect, useMemo, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { GlyphCamera } from "glyphcss";
import { OrthographicCamera } from "@glyphcss/core/three";
import type { Vector3Tuple } from "@glyphcss/core/three";
import { GlyphCameraContext } from "../glyphcss/camera/context";

export interface GlyphThreeOrthographicCameraProps {
  left?: number;
  right?: number;
  top?: number;
  bottom?: number;
  near?: number;
  far?: number;
  zoom?: number;
  center?: [number, number];
  position?: Vector3Tuple;
  lookAt?: Vector3Tuple;
  up?: Vector3Tuple;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

function GlyphThreeOrthographicCameraInner({
  left = -1,
  right = 1,
  top = 1,
  bottom = -1,
  near = 0.1,
  far = 2000,
  zoom,
  center,
  position,
  lookAt,
  up,
  className,
  style,
  children,
}: GlyphThreeOrthographicCameraProps) {
  const cameraRef = useRef<GlyphCamera | null>(null);
  const sceneRerenderRef = useRef<(() => void) | null>(null);

  if (!cameraRef.current) {
    cameraRef.current = new OrthographicCamera(left, right, top, bottom, near, far);
  }

  useEffect(() => {
    const camera = cameraRef.current as OrthographicCamera | null;
    if (!camera) return;
    camera.left = left;
    camera.right = right;
    camera.top = top;
    camera.bottom = bottom;
    camera.near = near;
    camera.far = far;
    if (zoom !== undefined) camera.zoom = zoom;
    if (center !== undefined) camera.center = center;
    if (position !== undefined) camera.position.set(position[0], position[1], position[2]);
    if (up !== undefined) camera.up.set(up[0], up[1], up[2]);
    if (lookAt !== undefined) camera.lookAt(lookAt[0], lookAt[1], lookAt[2]);
    sceneRerenderRef.current?.();
  });

  const rerender = useMemo(() => () => sceneRerenderRef.current?.(), []);
  const ctxValue = useMemo(() => ({ cameraRef, rerender, sceneRerenderRef }), [rerender]);

  return (
    <GlyphCameraContext.Provider value={ctxValue}>
      <div className={className} style={style}>{children}</div>
    </GlyphCameraContext.Provider>
  );
}

export const GlyphThreeOrthographicCamera = memo(GlyphThreeOrthographicCameraInner);
