import type { SceneController } from "./createSceneController";
import type { AutoRotateOption } from "../core/camera";

export interface AutoRotateHandle {
  start(): void;
  stop(): void;
  notifyInteraction(): void;
}

interface NormalizedAutoRotateConfig {
  axis: "x" | "y";
  speed: number;
  pauseOnInteraction: boolean;
}

const DEFAULT_SPEED = 0.3;

const globalScope: typeof globalThis | undefined =
  typeof window !== "undefined"
    ? window
    : typeof globalThis !== "undefined"
      ? globalThis
      : undefined;

const requestFrame =
  typeof globalScope?.requestAnimationFrame === "function"
    ? globalScope.requestAnimationFrame.bind(globalScope)
    : null;

const cancelFrame =
  typeof globalScope?.cancelAnimationFrame === "function"
    ? globalScope.cancelAnimationFrame.bind(globalScope)
    : null;

export function createAutoRotateHandle(
  controller: SceneController,
  option?: AutoRotateOption
): AutoRotateHandle | null {
  const config = normalizeAutoRotateOption(option);
  if (!config || !requestFrame || !cancelFrame) {
    return null;
  }

  let frameId: number | null = null;
  let disabledByInteraction = false;

  const applyRotation = () => {
    const state = controller.getCameraState();
    if (config.axis === "x") {
      const nextRotX = normalizeAngle(state.rotX + config.speed);
      controller.updateCamera({ rotX: nextRotX });
    } else {
      const nextRotY = normalizeAngle(state.rotY + config.speed);
      controller.updateCamera({ rotY: nextRotY });
    }
  };

  const tick = () => {
    frameId = requestFrame(tick);
    if (!disabledByInteraction) {
      applyRotation();
    }
  };

  return {
    start() {
      if (frameId !== null || disabledByInteraction) return;
      frameId = requestFrame(tick);
    },
    stop() {
      if (frameId === null) return;
      cancelFrame(frameId);
      frameId = null;
    },
    notifyInteraction() {
      if (!config.pauseOnInteraction || disabledByInteraction) return;
      disabledByInteraction = true;
      if (frameId !== null) {
        cancelFrame(frameId);
        frameId = null;
      }
    }
  };
}

function normalizeAutoRotateOption(option?: AutoRotateOption): NormalizedAutoRotateConfig | null {
  if (!option) return null;
  if (option === true) {
    return { axis: "y", speed: DEFAULT_SPEED, pauseOnInteraction: true };
  }
  if (typeof option === "number") {
    if (!Number.isFinite(option) || option === 0) return null;
    return { axis: "y", speed: option, pauseOnInteraction: true };
  }
  const speedValue =
    typeof option.speed === "number" && Number.isFinite(option.speed)
      ? option.speed
      : DEFAULT_SPEED;
  if (!speedValue) return null;
  const axis = option.axis === "x" ? "x" : "y";
  const pauseOnInteraction = option.pauseOnInteraction !== false;
  return { axis, speed: speedValue, pauseOnInteraction };
}

function normalizeAngle(value: number): number {
  let normalized = value % 360;
  if (normalized < 0) normalized += 360;
  return normalized;
}
