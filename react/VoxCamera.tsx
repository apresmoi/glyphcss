import React, { useImperativeHandle, forwardRef } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { SceneController } from "@voxcss/controller/createSceneController";
import type { WallsMask } from "@voxcss/core";
import type { AutoRotateOption } from "@voxcss/core/camera";
import { SceneControllerContext } from "./context";
import { useCameraBinding } from "./useBindings";

export interface CameraRenderContext {
  boxStyle: CSSProperties;
  cursor: string;
  walls: WallsMask;
  controller: SceneController;
  camera: ReturnType<SceneController["getCameraState"]>;
}

export interface VoxCameraProps {
  zoom?: number;
  pan?: number;
  tilt?: number;
  rotX?: number;
  rotY?: number;
  invert?: boolean | number;
  perspective?: number | boolean;
  interactive?: boolean;
  animate?: AutoRotateOption | false;
  children?: ReactNode | ((context: CameraRenderContext) => ReactNode);
}

export interface VoxCameraHandle {
  controller: SceneController;
  startAutoRotate(config?: AutoRotateOption): void;
  stopAutoRotate(): void;
}

export const VoxCamera = forwardRef<VoxCameraHandle, VoxCameraProps>(function VoxCamera(
  { zoom, pan, tilt, rotX, rotY, invert, perspective, interactive, animate, children },
  ref
) {
  const {
    containerRef,
    controller,
    snapshot,
    startAutoRotate: startAutoRotateBinding,
    stopAutoRotate: stopAutoRotateBinding
  } = useCameraBinding({
    zoom,
    pan,
    tilt,
    rotX,
    rotY,
    invert,
    perspective,
    interactive,
    animate
  });

  useImperativeHandle(
    ref,
    () => ({
      controller: controller as SceneController,
      startAutoRotate(config?: AutoRotateOption) {
        startAutoRotateBinding(config);
      },
      stopAutoRotate() {
        stopAutoRotateBinding();
      }
    }),
    [controller, startAutoRotateBinding, stopAutoRotateBinding]
  );

  const context: CameraRenderContext | null =
    controller && snapshot
      ? {
          boxStyle: snapshot.boxStyle as CSSProperties,
          cursor: snapshot.cursor,
          walls: snapshot.walls,
          controller,
          camera: snapshot.camera
        }
      : null;

  const renderedChildren =
    controller && context
      ? typeof children === "function"
        ? (children as (ctx: CameraRenderContext) => ReactNode)(context)
        : children
      : null;

  return (
    <SceneControllerContext.Provider value={controller}>
      <div ref={containerRef} className="voxcss-camera" style={{ cursor: snapshot?.cursor ?? "default" }}>
        {renderedChildren}
      </div>
    </SceneControllerContext.Provider>
  );
});
