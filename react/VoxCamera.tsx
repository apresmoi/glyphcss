import React, { useMemo, useEffect, useState, useCallback } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { createSceneController } from "@voxcss/controller/createSceneController";
import type { SceneController } from "@voxcss/controller/createSceneController";
import type { WallsMask } from "@voxcss/core";
import { SceneControllerContext } from "./context";

const DEFAULTS = {
  zoom: 0.65,
  pan: 0,
  tilt: 0,
  rotX: 65,
  rotY: 45,
  invert: false
};
const DEFAULT_INVERT_MULTIPLIER = 1;
const DEFAULT_PERSPECTIVE = 8000;

type InvertControlValue = boolean | number | undefined;
type PerspectiveValue = number | boolean | undefined;

function resolveInvertMultiplier(value: InvertControlValue): number {
  if (typeof value === "number") {
    return value < 0 ? -1 : 1;
  }
  return value ? -1 : 1;
}

function resolvePerspective(value: PerspectiveValue): string {
  if (value === false) return "none";
  const numeric = typeof value === "number" ? value : DEFAULT_PERSPECTIVE;
  return `${numeric}px`;
}

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
  children?: ReactNode | ((context: CameraRenderContext) => ReactNode);
}

export function VoxCamera({
  zoom = DEFAULTS.zoom,
  pan = DEFAULTS.pan,
  tilt = DEFAULTS.tilt,
  rotX = DEFAULTS.rotX,
  rotY = DEFAULTS.rotY,
  invert = DEFAULTS.invert,
  perspective = DEFAULT_PERSPECTIVE,
  interactive = false,
  children
}: VoxCameraProps) {
  const controller = useMemo(() => {
    return createSceneController({
      camera: {
        zoom: DEFAULTS.zoom,
        pan: DEFAULTS.pan,
        tilt: DEFAULTS.tilt,
        rotX: DEFAULTS.rotX,
        rotY: DEFAULTS.rotY
      },
      controls: { invert: DEFAULT_INVERT_MULTIPLIER }
    });
  }, []);

  const [boxStyle, setBoxStyle] = useState(() => controller.getBoxStyle());

  useEffect(() => controller.subscribeBoxStyle((style) => setBoxStyle(style)), [controller]);

  useEffect(() => {
    controller.updateCamera({ zoom, pan, tilt, rotX, rotY });
  }, [controller, zoom, pan, tilt, rotX, rotY]);

  useEffect(() => {
    controller.setControls({ invert: resolveInvertMultiplier(invert) });
  }, [controller, invert]);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      controller.handlePointerDown(event.nativeEvent as unknown as PointerEvent);
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    [controller]
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      controller.handlePointerMove(event.nativeEvent as unknown as PointerEvent);
    },
    [controller]
  );

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      controller.handlePointerUp();
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    },
    [controller]
  );

  const cursor = interactive ? controller.getCursor() : "default";

  const context: CameraRenderContext = {
    boxStyle,
    cursor,
    walls: controller.getWalls(),
    controller,
    camera: controller.getCameraState()
  };

  const renderedChildren =
    typeof children === "function" ? (children as (ctx: CameraRenderContext) => ReactNode)(context) : children;

  const pointerHandlers = interactive
    ? {
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: handlePointerUp,
      onPointerLeave: handlePointerUp
    }
    : {};

  return (
    <SceneControllerContext.Provider value={controller}>
      <div className="voxcss-scene" style={{ cursor, perspective: resolvePerspective(perspective) }} {...pointerHandlers}>
        {renderedChildren}
      </div>
    </SceneControllerContext.Provider>
  );
}
