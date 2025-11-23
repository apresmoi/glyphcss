import React, { forwardRef, useImperativeHandle, useCallback, useMemo, useRef, useState, useLayoutEffect, useEffect } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { SceneController } from "@voxcss/controller/sceneController";
import {
  ensureCameraController,
  normalizeCameraOptions,
  syncCameraOptions,
  type CameraComponentProps,
  type CameraSlotProps,
  type NormalizedCameraOptions,
  CAMERA_HOST_CLASS
} from "@voxcss/controller/cameraBindings";
import type { AutoRotateOption } from "@voxcss/core/camera";
import { createCamera, type HeadlessCameraHandle } from "@voxcss/core/headless";
import { SceneControllerContext } from "./useBindings";

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
  const handleRef = useRef<HeadlessCameraHandle | null>(null);
  const optionsRef = useRef<NormalizedCameraOptions | null>(null);
  const unsubscribersRef = useRef<Array<() => void>>([]);
  const animateRef = useRef<AutoRotateOption | false | undefined>(cameraProps.animate);
  const latestProps = useRef(cameraProps);

  const [slotProps, setSlotProps] = useState<CameraSlotProps | null>(null);
  const [cursor, setCursor] = useState("default");
  const [controller, setController] = useState<SceneController | null>(null);

  const applySnapshot = useCallback(() => {
    const handle = handleRef.current;
    if (!handle) return;
    const currentController = handle.controller;
    const nextCursor = handle.interactive ? currentController.getCursor() : "default";
    setController(currentController);
    setSlotProps({
      boxStyle: currentController.getBoxStyle(),
      cursor: nextCursor,
      walls: currentController.getWalls(),
      camera: currentController.getCameraState(),
      controller: currentController
    });
    setCursor(nextCursor);
  }, []);

  const updateOptions = useCallback(
    (next: CameraComponentProps) => {
      const handle = handleRef.current;
      const current = optionsRef.current;
      if (!handle || !current) return;
      optionsRef.current = syncCameraOptions(handle, current, next);
      applySnapshot();
    },
    [applySnapshot]
  );

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const options = latestProps.current;
    const handle = createCamera({ ...options, element });
    handleRef.current = handle;
    optionsRef.current = normalizeCameraOptions(options);
    animateRef.current = optionsRef.current.animate;
    applySnapshot();

    const currentController = handle.controller;
    const unsubscribers = [
      currentController.subscribeBoxStyle(applySnapshot),
      currentController.subscribeCamera(applySnapshot),
      currentController.subscribeWalls(applySnapshot),
      currentController.subscribeCursor(applySnapshot)
    ];
    unsubscribersRef.current = unsubscribers;

    return () => {
      unsubscribersRef.current.forEach((unsubscribe) => unsubscribe());
      unsubscribersRef.current = [];
      handle.destroy();
      handleRef.current = null;
      optionsRef.current = null;
      animateRef.current = undefined;
      setController(null);
      setSlotProps(null);
      setCursor("default");
    };
  }, [applySnapshot]);

  useEffect(() => {
    latestProps.current = cameraProps;
    animateRef.current = cameraProps.animate;
    updateOptions(cameraProps);
  }, [cameraProps, updateOptions]);

  useImperativeHandle(
    ref,
    () => ({
      controller: ensureCameraController(controller),
      startAutoRotate: (config?: AutoRotateOption) => {
        const next = config ?? animateRef.current;
        animateRef.current = next;
        updateOptions({ animate: next });
      },
      stopAutoRotate: () => {
        animateRef.current = false;
        updateOptions({ animate: false });
      }
    }),
    [controller, updateOptions]
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
