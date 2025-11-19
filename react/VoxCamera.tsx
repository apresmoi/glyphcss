import React, { useMemo, useEffect, useState, useCallback, useRef, useImperativeHandle, forwardRef } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { createSceneController } from "@voxcss/controller/createSceneController";
import type { SceneController } from "@voxcss/controller/createSceneController";
import { createAutoRotateHandle, type AutoRotateHandle } from "@voxcss/controller/autoRotate";
import type { WallsMask } from "@voxcss/core";
import type { AutoRotateOption } from "@voxcss/core/camera";
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
  const initialCameraRef = useRef({
    zoom,
    pan,
    tilt,
    rotX,
    rotY
  });
  const initialControlsRef = useRef({
    invert: resolveInvertMultiplier(invert ?? DEFAULTS.invert ?? DEFAULT_INVERT_MULTIPLIER)
  });
  const controller = useMemo(() => {
    return createSceneController({
      camera: initialCameraRef.current,
      controls: { invert: initialControlsRef.current.invert ?? DEFAULT_INVERT_MULTIPLIER }
    });
  }, []);

  const [boxStyle, setBoxStyle] = useState(() => controller.getBoxStyle());
  const autoRotateRef = useRef<AutoRotateHandle | null>(null);
  const animateOptionRef = useRef<AutoRotateOption | undefined>(animate);

  useEffect(() => {
    const unsubscribe = controller.subscribeBoxStyle((style) => setBoxStyle(style));
    return () => unsubscribe();
  }, [controller]);

  useEffect(() => {
    controller.updateCamera({ zoom, pan, tilt, rotX, rotY });
  }, [controller, zoom, pan, tilt, rotX, rotY]);

  useEffect(() => {
    controller.setControls({ invert: resolveInvertMultiplier(invert) });
  }, [controller, invert]);

  useEffect(() => {
    animateOptionRef.current = animate;
    const handle = createAutoRotateHandle(controller, animate);
    handle?.start();
    autoRotateRef.current = handle;
    return () => {
      handle?.stop();
      if (autoRotateRef.current === handle) {
        autoRotateRef.current = null;
      }
    };
  }, [controller, animate]);

  useImperativeHandle(
    ref,
    () => ({
      controller,
      startAutoRotate(config?: AutoRotateOption) {
        autoRotateRef.current?.stop();
        const option = config ?? animateOptionRef.current;
        const handle = createAutoRotateHandle(controller, option);
        handle?.start();
        autoRotateRef.current = handle;
      },
      stopAutoRotate() {
        autoRotateRef.current?.stop();
      }
    }),
    [controller]
  );

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      autoRotateRef.current?.notifyInteraction();
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
      <div className="voxcss-camera" style={{ cursor, perspective: resolvePerspective(perspective) }} {...pointerHandlers}>
        {renderedChildren}
      </div>
    </SceneControllerContext.Provider>
  );
});
