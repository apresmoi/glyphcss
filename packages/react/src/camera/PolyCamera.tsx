import { memo, useMemo } from "react";
import type { ReactNode } from "react";
import { PolyCameraContext } from "./context";
import { useCamera } from "./useCamera";

export interface PolyCameraProps {
  zoom?: number;
  pan?: number;
  tilt?: number;
  rotX?: number;
  rotY?: number;
  perspective?: number | boolean;
  children?: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

const DEFAULT_PERSPECTIVE = 8000;

function PolyCameraInner({
  zoom,
  pan,
  tilt,
  rotX,
  rotY,
  perspective,
  children,
  className,
  style,
}: PolyCameraProps) {
  const {
    store,
    cameraRef,
    sceneElRef,
    cameraElRef,
    applyTransformDirect,
  } = useCamera({ zoom, pan, tilt, rotX, rotY });

  // Context is stable — refs never change identity, applyTransformDirect
  // is memoized in useCamera.
  const contextValue = useMemo(
    () => ({ store, cameraRef, sceneElRef, cameraElRef, applyTransformDirect }),
    [store, cameraRef, sceneElRef, cameraElRef, applyTransformDirect]
  );

  const perspectiveValue =
    perspective === false
      ? "none"
      : `${typeof perspective === "number" ? perspective : DEFAULT_PERSPECTIVE}px`;

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

export const PolyCamera = memo(PolyCameraInner);
