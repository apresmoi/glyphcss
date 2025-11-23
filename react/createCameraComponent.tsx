import React, { forwardRef, useImperativeHandle } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { SceneController } from "@voxcss/controller/sceneController";
import {
  CAMERA_HOST_CLASS,
  createCameraBindingProps,
  ensureCameraController,
  type CameraComponentProps,
  type CameraSlotProps
} from "@voxcss/controller/cameraBindings";
import type { AutoRotateOption } from "@voxcss/core/camera";
import { SceneControllerContext } from "./context";
import type { CameraBindingHookResult } from "./useBindings";

export interface CameraChildRender {
  (context: CameraRenderContext): ReactNode;
}

export interface CameraRenderContext extends Omit<CameraSlotProps, "boxStyle"> {
  boxStyle: CSSProperties;
}

export interface VoxCameraHandle {
  controller: SceneController;
  startAutoRotate(config?: AutoRotateOption): void;
  stopAutoRotate(): void;
}

export interface ReactCameraComponentFactoryConfig {
  useBinding(props: CameraComponentProps): CameraBindingHookResult;
  className?: string;
}

export type ReactCameraComponentProps = CameraComponentProps & {
  children?: ReactNode | CameraChildRender;
};

export function createCameraComponent({
  useBinding,
  className = CAMERA_HOST_CLASS
}: ReactCameraComponentFactoryConfig) {
  return forwardRef<VoxCameraHandle, ReactCameraComponentProps>(function VoxCameraFactory(props, ref) {
    const { children, ...rest } = props;
    const binding = useBinding(createCameraBindingProps(rest));
    const slotProps = binding.slotProps;

    useImperativeHandle(
      ref,
      () => ({
        controller: ensureCameraController(binding.controller),
        startAutoRotate: binding.startAutoRotate,
        stopAutoRotate: binding.stopAutoRotate
      }),
      [binding.controller, binding.startAutoRotate, binding.stopAutoRotate]
    );

    const renderedChildren =
      slotProps && binding.controller
        ? typeof children === "function"
          ? (children as CameraChildRender)(convertSlotProps(slotProps))
          : children
        : null;

    return (
      <SceneControllerContext.Provider value={binding.controller}>
        <div ref={binding.containerRef} className={className} style={{ cursor: binding.cursor }}>
          {renderedChildren}
        </div>
      </SceneControllerContext.Provider>
    );
  });
}

function convertSlotProps(slotProps: CameraSlotProps): CameraRenderContext {
  return {
    ...slotProps,
    boxStyle: slotProps.boxStyle as CSSProperties
  };
}
