import React, { forwardRef, useImperativeHandle } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { SceneController } from "@voxcss/controller/createSceneController";
import {
  CAMERA_HOST_CLASS,
  createCameraBindingProps,
  ensureCameraController,
  resolveCameraView,
  type CameraComponentProps,
  type CameraSlotProps
} from "@voxcss/controller/createCameraComponentCore";
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
    const view = resolveCameraView(binding.slotProps);

    useImperativeHandle(
      ref,
      () => {
        return {
          controller: ensureCameraController(view.controller),
          startAutoRotate: binding.startAutoRotate,
          stopAutoRotate: binding.stopAutoRotate
        };
      },
      [view.controller, binding.startAutoRotate, binding.stopAutoRotate]
    );

    const renderedChildren =
      view.ready && view.slotProps
        ? typeof children === "function"
          ? (children as CameraChildRender)(convertSlotProps(view.slotProps as CameraSlotProps))
          : children
        : null;

    return (
      <SceneControllerContext.Provider value={view.controller}>
        <div ref={binding.containerRef} className={className} style={{ cursor: view.cursor }}>
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
