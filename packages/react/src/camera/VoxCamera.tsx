import { memo, useMemo } from "react";
import type { ReactNode } from "react";
import type { AutoRotateOption } from "@layoutit/voxcss-core";
import { VoxCameraContext } from "./context";
import { useCamera } from "./useCamera";

export interface VoxCameraProps {
  zoom?: number;
  pan?: number;
  tilt?: number;
  rotX?: number;
  rotY?: number;
  interactive?: boolean;
  invert?: boolean | number;
  animate?: AutoRotateOption | false;
  perspective?: number | boolean;
  children?: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

const DEFAULT_PERSPECTIVE = 8000;

function VoxCameraInner({
  zoom,
  pan,
  tilt,
  rotX,
  rotY,
  interactive,
  invert,
  animate,
  perspective,
  children,
  className,
  style,
}: VoxCameraProps) {
  const {
    store,
    cameraRef,
    sceneElRef,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    cursor,
  } = useCamera({ zoom, pan, tilt, rotX, rotY, interactive, invert, animate });

  // Context is stable — store/cameraRef/sceneElRef never change identity
  const contextValue = useMemo(
    () => ({ store, cameraRef, sceneElRef }),
    [store, cameraRef, sceneElRef]
  );

  const perspectiveValue =
    perspective === false
      ? "none"
      : `${typeof perspective === "number" ? perspective : DEFAULT_PERSPECTIVE}px`;

  const cameraStyle: React.CSSProperties = {
    ...style,
    perspective: perspectiveValue,
    cursor: interactive ? cursor : undefined,
    touchAction: interactive ? "none" : undefined,
    userSelect: interactive ? "none" : undefined,
  };

  return (
    <VoxCameraContext.Provider value={contextValue}>
      <div
        className={`voxcss-camera${className ? ` ${className}` : ""}`}
        style={cameraStyle}
        onPointerDown={interactive ? onPointerDown : undefined}
        onPointerMove={interactive ? onPointerMove : undefined}
        onPointerUp={interactive ? onPointerUp : undefined}
        onPointerCancel={interactive ? onPointerCancel : undefined}
      >
        {children}
      </div>
    </VoxCameraContext.Provider>
  );
}

export const VoxCamera = memo(VoxCameraInner);
