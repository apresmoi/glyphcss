import React, { useEffect, useLayoutEffect, useState, useRef, useImperativeHandle, forwardRef } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { SceneController } from "@voxcss/controller/createSceneController";
import { createCamera } from "@voxcss/core";
import type { WallsMask } from "@voxcss/core";
import type { AutoRotateOption } from "@voxcss/core/camera";
import type { HeadlessCameraHandle } from "@voxcss/core/headless";
import { resolveInvertMultiplier, normalizePerspectiveValue } from "@voxcss/controller/utils";
import { SceneControllerContext } from "./context";

const DEFAULTS = {
  zoom: 0.65,
  pan: 0,
  tilt: 0,
  rotX: 65,
  rotY: 45,
  invert: false
};
const DEFAULT_PERSPECTIVE = 8000;

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
  animate?: AutoRotateOption;
  children?: ReactNode | ((context: CameraRenderContext) => ReactNode);
}

export interface VoxCameraHandle {
  controller: SceneController;
  startAutoRotate(config?: AutoRotateOption): void;
  stopAutoRotate(): void;
}

export const VoxCamera = forwardRef<VoxCameraHandle, VoxCameraProps>(function VoxCamera(
  {
    zoom = DEFAULTS.zoom,
    pan = DEFAULTS.pan,
    tilt = DEFAULTS.tilt,
    rotX = DEFAULTS.rotX,
    rotY = DEFAULTS.rotY,
    invert = DEFAULTS.invert,
    perspective = DEFAULT_PERSPECTIVE,
    interactive = false,
    animate,
    children
  },
  ref
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cameraHandleRef = useRef<HeadlessCameraHandle | null>(null);
  const animateOptionRef = useRef<AutoRotateOption | undefined>(animate);
  const [controller, setController] = useState<SceneController | null>(null);
  const [boxStyle, setBoxStyle] = useState<Record<string, string>>({});
  const [cameraState, setCameraState] = useState(() => controller?.getCameraState());
  const [walls, setWalls] = useState(() => controller?.getWalls());
  const [cursor, setCursor] = useState("default");

  useLayoutEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const handle = createCamera({
      element: node,
      interactive,
      perspective: normalizePerspectiveValue(perspective),
      zoom,
      pan,
      tilt,
      rotX,
      rotY,
      invert,
      animate
    });
    cameraHandleRef.current = handle;
    setController(handle.controller);
    return () => {
      handle.destroy();
      cameraHandleRef.current = null;
      setController(null);
      setBoxStyle({});
      setCameraState(undefined);
      setWalls(undefined);
      setCursor("default");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handle = cameraHandleRef.current;
    if (!handle) return;
    handle.controller.updateCamera({ zoom, pan, tilt, rotX, rotY });
  }, [zoom, pan, tilt, rotX, rotY]);

  useEffect(() => {
    if (!controller) return;
    controller.setControls({ invert: resolveInvertMultiplier(invert) });
  }, [controller, invert]);

  useEffect(() => {
    cameraHandleRef.current?.setInteractive(interactive);
  }, [interactive]);

  useEffect(() => {
    cameraHandleRef.current?.setPerspective(normalizePerspectiveValue(perspective));
  }, [perspective]);

  useEffect(() => {
    animateOptionRef.current = animate;
    cameraHandleRef.current?.setAnimate(animate);
  }, [animate]);

  useEffect(() => {
    if (!controller) return;
    setBoxStyle(controller.getBoxStyle());
    setCameraState(controller.getCameraState());
    setWalls(controller.getWalls());
    setCursor(interactive ? controller.getCursor() : "default");
    const unsubscribeBox = controller.subscribeBoxStyle((style) => setBoxStyle(style));
    const unsubscribeCamera = controller.subscribeCamera((state) => {
      setCameraState(state);
      setWalls(controller.getWalls());
      setCursor(interactive ? controller.getCursor() : "default");
    });
    return () => {
      unsubscribeBox();
      unsubscribeCamera();
    };
  }, [controller, interactive]);

  useImperativeHandle(
    ref,
    () => ({
      controller: controller as SceneController,
      startAutoRotate(config?: AutoRotateOption) {
        const option = config ?? animateOptionRef.current;
        animateOptionRef.current = option;
        cameraHandleRef.current?.setAnimate(option);
      },
      stopAutoRotate() {
        cameraHandleRef.current?.setAnimate(false);
      }
    }),
    [controller]
  );

  const context: CameraRenderContext | null = controller
    ? {
        boxStyle,
        cursor,
        walls: walls ?? controller.getWalls(),
        controller,
        camera: cameraState ?? controller.getCameraState()
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
      <div ref={containerRef} className="voxcss-camera" style={{ cursor }}>
        {renderedChildren}
      </div>
    </SceneControllerContext.Provider>
  );
});
