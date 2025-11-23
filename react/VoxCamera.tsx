import React, { forwardRef, useImperativeHandle, useMemo, useRef, useState, useLayoutEffect, useEffect } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { SceneController } from "@voxcss/controller/sceneController";
import { CAMERA_HOST_CLASS, type CameraComponentProps, type CameraSlotProps } from "@voxcss/controller/cameraBindings";
import type { AutoRotateOption } from "@voxcss/core/camera";
import { SceneControllerContext, useSceneControllerContext } from "./useBindings";
import { mountCameraBinding } from "@voxcss/controller/sharedCamera";

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
  const animateRef = useRef<AutoRotateOption | false | undefined>(cameraProps.animate);
  const latestProps = useRef(cameraProps);

  const [slotProps, setSlotProps] = useState<CameraSlotProps | null>(null);
  const [cursor, setCursor] = useState("default");
  const [controller, setController] = useState<SceneController | null>(null);

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const options = latestProps.current;
    const teardown = mountCameraBinding(
      element,
      options,
      (snapshot) => {
        if (!snapshot) {
          setController(null);
          setSlotProps(null);
          setCursor("default");
          return;
        }
        setController(snapshot.controller);
        setSlotProps({
          boxStyle: snapshot.boxStyle,
          cursor: snapshot.cursor,
          walls: snapshot.walls,
          camera: snapshot.camera,
          controller: snapshot.controller
        });
        setCursor(snapshot.cursor);
      },
      (nextCursor) => setCursor(nextCursor)
    );
    teardownRef.current = teardown;
    return () => {
      teardownRef.current?.destroy();
      teardownRef.current = null;
      animateRef.current = undefined;
      setController(null);
      setSlotProps(null);
      setCursor("default");
    };
  }, []);

  useEffect(() => {
    latestProps.current = cameraProps;
    animateRef.current = cameraProps.animate;
    teardownRef.current?.update(cameraProps);
  }, [cameraProps]);

  useImperativeHandle(
    ref,
    () => ({
      controller: controller ?? useSceneControllerContext(),
      startAutoRotate: (config?: AutoRotateOption) => {
        const next = config ?? animateRef.current;
        animateRef.current = next;
        teardownRef.current?.startAutoRotate(next);
      },
      stopAutoRotate: () => {
        animateRef.current = false;
        teardownRef.current?.stopAutoRotate();
      }
    }),
    [controller]
  );

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
