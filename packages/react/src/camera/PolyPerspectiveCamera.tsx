import { memo, useMemo } from "react";
import type { ReactNode } from "react";
import type { Vec3 } from "@layoutit/polycss-core";
import { PolyCameraContext } from "./context";
import { usePolyCamera } from "./useCamera";

export interface PolyPerspectiveCameraProps {
  zoom?: number;
  target?: Vec3;
  rotX?: number;
  rotY?: number;
  /** Camera pull-back in CSS pixels (dolly). Default 0. */
  distance?: number;
  /** CSS perspective distance in pixels. Defaults to 8000. */
  perspective?: number;
  children?: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

const DEFAULT_PERSPECTIVE = 8000;

function PolyPerspectiveCameraInner({
  zoom,
  target,
  rotX,
  rotY,
  distance,
  perspective,
  children,
  className,
  style,
}: PolyPerspectiveCameraProps) {
  const {
    store,
    cameraRef,
    sceneElRef,
    cameraElRef,
    applyTransformDirect,
  } = usePolyCamera({ zoom, target, rotX, rotY, distance });

  const contextValue = useMemo(
    () => ({ store, cameraRef, sceneElRef, cameraElRef, applyTransformDirect }),
    [store, cameraRef, sceneElRef, cameraElRef, applyTransformDirect]
  );

  const perspectiveValue = `${typeof perspective === "number" ? perspective : DEFAULT_PERSPECTIVE}px`;

  const cameraStyle: React.CSSProperties = {
    ...style,
    perspective: perspectiveValue,
  };

  return (
    <PolyCameraContext.Provider value={contextValue}>
      <div
        ref={cameraElRef}
        className={`polycss-camera${className ? ` ${className}` : ""}`}
        style={cameraStyle}
      >
        {children}
      </div>
    </PolyCameraContext.Provider>
  );
}

export const PolyPerspectiveCamera = memo(PolyPerspectiveCameraInner);
