import { memo, useMemo } from "react";
import type { ReactNode } from "react";
import type { Vec3 } from "@layoutit/polycss-core";
import { PolyCameraContext } from "./context";
import { usePolyCamera } from "./useCamera";

export interface PolyOrthographicCameraProps {
  zoom?: number;
  target?: Vec3;
  rotX?: number;
  rotY?: number;
  /** Camera pull-back in CSS pixels (dolly). Default 0. */
  distance?: number;
  children?: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

function PolyOrthographicCameraInner({
  zoom,
  target,
  rotX,
  rotY,
  distance,
  children,
  className,
  style,
}: PolyOrthographicCameraProps) {
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

  const cameraStyle: React.CSSProperties = {
    ...style,
    perspective: "none",
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

export const PolyOrthographicCamera = memo(PolyOrthographicCameraInner);
