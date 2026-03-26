import React, { forwardRef, useImperativeHandle, useMemo, useRef, useState, useLayoutEffect, useEffect } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { SceneController } from "@layoutit/voxcss-core";
import {
  CAMERA_HOST_CLASS,
  type CameraComponentProps,
  type CameraSlotProps
} from "@layoutit/voxcss-html";
import type { AutoRotateOption } from "@layoutit/voxcss-core";
import { SceneControllerContext, useSceneControllerContext } from "./useBindings";
import { mountCameraBinding } from "@layoutit/voxcss-html";

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

export type VoxCameraProps = CameraComponentProps & {
  children?: ReactNode | CameraChildRender;
};

export const VoxCamera = forwardRef<VoxCameraHandle, VoxCameraProps>(function VoxCamera(props, ref) {
  const { children, zoom, pan, tilt, rotX, rotY, invert, perspective, interactive, animate } = props;
  const cameraProps = useMemo(() => ({ zoom, pan, tilt, rotX, rotY, invert, perspective, interactive, animate }), [
    zoom,
    pan,
    tilt,
    rotX,
    rotY,
    invert,
    perspective,
    interactive,
    animate
  ]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const teardownRef = useRef<ReturnType<typeof mountCameraBinding> | null>(null);
  const latestProps = useRef(cameraProps);

  const [slotProps, setSlotProps] = useState<CameraSlotProps | null>(null);
  const [cursor, setCursor] = useState("default");

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const options = latestProps.current;
    teardownRef.current = mountCameraBinding(
      element,
      options,
      (snapshot) => {
        setSlotProps(snapshot);
        setCursor(snapshot?.cursor ?? "default");
      },
      (nextCursor) => setCursor(nextCursor)
    );
    return () => {
      teardownRef.current?.destroy();
      teardownRef.current = null;
      setSlotProps(null);
      setCursor("default");
    };
  }, []);

  useEffect(() => {
    latestProps.current = cameraProps;
    teardownRef.current?.update(cameraProps);
  }, [cameraProps]);

  useImperativeHandle(
    ref,
    () => ({
      controller: controller ?? useSceneControllerContext(),
      startAutoRotate: (config?: AutoRotateOption) => {
        teardownRef.current?.startAutoRotate(config);
      },
      stopAutoRotate: () => {
        teardownRef.current?.stopAutoRotate();
      }
    }),
    [slotProps?.controller]
  );

  const controller = slotProps?.controller ?? null;

  const renderedChildren =
    slotProps && controller
      ? typeof children === "function"
        ? (children as CameraChildRender)(convertSlotProps(slotProps))
        : children
      : null;

  return (
    <SceneControllerContext.Provider value={controller}>
      <div ref={containerRef} className={CAMERA_HOST_CLASS} style={{ cursor }}>
        {renderedChildren}
      </div>
    </SceneControllerContext.Provider>
  );
});

function convertSlotProps(slotProps: CameraSlotProps): CameraRenderContext {
  return {
    ...slotProps,
    boxStyle: slotProps.boxStyle as CSSProperties
  };
}
