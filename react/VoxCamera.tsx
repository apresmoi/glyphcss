import React, { useEffect, useLayoutEffect, useState, useRef, useImperativeHandle, forwardRef } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { SceneController } from "@voxcss/controller/createSceneController";
import { createCameraBinding, type CameraBindingHandle, type CameraRenderSnapshot } from "@voxcss/controller/createCameraBinding";
import type { WallsMask } from "@voxcss/core";
import type { AutoRotateOption } from "@voxcss/core/camera";
import { resolveInvertMultiplier } from "@voxcss/controller/cameraUtils";
import { DEFAULT_CAMERA_PROPS } from "@voxcss/controller/defaults";
import { SceneControllerContext } from "./context";

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
    zoom = DEFAULT_CAMERA_PROPS.zoom,
    pan = DEFAULT_CAMERA_PROPS.pan,
    tilt = DEFAULT_CAMERA_PROPS.tilt,
    rotX = DEFAULT_CAMERA_PROPS.rotX,
    rotY = DEFAULT_CAMERA_PROPS.rotY,
    invert = DEFAULT_CAMERA_PROPS.invert,
    perspective = DEFAULT_CAMERA_PROPS.perspective,
    interactive = DEFAULT_CAMERA_PROPS.interactive,
    animate = DEFAULT_CAMERA_PROPS.animate,
    children
  },
  ref
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cameraBindingRef = useRef<CameraBindingHandle | null>(null);
  const animateOptionRef = useRef<AutoRotateOption | undefined>(animate);
  const [controller, setController] = useState<SceneController | null>(null);
  const [snapshot, setSnapshot] = useState<CameraRenderSnapshot | null>(null);

  useLayoutEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const binding = createCameraBinding({
      element: node,
      interactive,
      perspective,
      zoom,
      pan,
      tilt,
      rotX,
      rotY,
      invert,
      animate
    });
    cameraBindingRef.current = binding;
    setController(binding.controller);
    setSnapshot(binding.getSnapshot());
    const unsubscribe = binding.subscribe((next) => setSnapshot(next));
    return () => {
      unsubscribe();
      binding.destroy();
      cameraBindingRef.current = null;
      setController(null);
      setSnapshot(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    cameraBindingRef.current?.updateCamera({ zoom, pan, tilt, rotX, rotY });
  }, [zoom, pan, tilt, rotX, rotY]);

  useEffect(() => {
    cameraBindingRef.current?.setControls({ invert: resolveInvertMultiplier(invert) });
  }, [invert]);

  useEffect(() => {
    cameraBindingRef.current?.setInteractive(interactive);
  }, [interactive]);

  useEffect(() => {
    cameraBindingRef.current?.setPerspective(perspective);
  }, [perspective]);

  useEffect(() => {
    animateOptionRef.current = animate;
    cameraBindingRef.current?.setAnimate(animate);
  }, [animate]);

  useImperativeHandle(
    ref,
    () => ({
      controller: controller as SceneController,
      startAutoRotate(config?: AutoRotateOption) {
        const option = config ?? animateOptionRef.current;
        animateOptionRef.current = option;
        cameraBindingRef.current?.setAnimate(option);
      },
      stopAutoRotate() {
        cameraBindingRef.current?.setAnimate(false);
      }
    }),
    [controller]
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
