import type { SceneController } from "../controller/sceneController";
import type { AutoRotateOption } from "./camera";

export interface InteractiveControllerOptions {
  element: HTMLElement;
  controller: SceneController;
  interactive?: boolean;
  animate?: AutoRotateOption | false;
}

export interface InteractiveControllerHandle {
  element: HTMLElement;
  controller: SceneController;
  interactive: boolean;
  setInteractive(value: boolean): void;
  setAnimate(option: AutoRotateOption | false | undefined): void;
  destroy(): void;
}

interface AutoRotateHandle {
  start(): void;
  stop(): void;
  notifyInteraction(): void;
}

export function createInteractiveController(
  options: InteractiveControllerOptions
): InteractiveControllerHandle {
  const { element, controller } = options;
  let interactive = !!options.interactive;
  let autoRotate = createAutoRotateHandle(controller, options.animate);
  let detachPointer = interactive
    ? attachPointerEvents(element, controller, () => autoRotate?.notifyInteraction())
    : null;
  autoRotate?.start();

  const handle: InteractiveControllerHandle = {
    element,
    controller,
    interactive,
    setInteractive(value) {
      if (interactive === value) return;
      interactive = value;
      handle.interactive = interactive;
      if (interactive) {
        if (!detachPointer) {
          detachPointer = attachPointerEvents(element, controller, () => autoRotate?.notifyInteraction());
        }
      } else {
        detachPointer?.();
        detachPointer = null;
        element.style.cursor = "default";
      }
    },
    setAnimate(option) {
      autoRotate?.stop();
      autoRotate = option === false ? null : createAutoRotateHandle(controller, option);
      autoRotate?.start();
    },
    destroy() {
      detachPointer?.();
      detachPointer = null;
      autoRotate?.stop();
      autoRotate = null;
    }
  };

  return handle;
}

function attachPointerEvents(
  element: HTMLElement,
  controller: SceneController,
  onInteraction?: () => void
): () => void {
  const handlePointerDown = (event: PointerEvent) => {
    onInteraction?.();
    controller.handlePointerDown(event);
    element.setPointerCapture?.(event.pointerId);
  };
  const handlePointerMove = (event: PointerEvent) => controller.handlePointerMove(event);
  const handlePointerUp = (event: PointerEvent) => {
    controller.handlePointerUp();
    element.releasePointerCapture?.(event.pointerId);
  };
  element.addEventListener("pointerdown", handlePointerDown);
  element.addEventListener("pointermove", handlePointerMove);
  element.addEventListener("pointerup", handlePointerUp);
  element.addEventListener("pointerleave", handlePointerUp);
  return () => {
    element.removeEventListener("pointerdown", handlePointerDown);
    element.removeEventListener("pointermove", handlePointerMove);
    element.removeEventListener("pointerup", handlePointerUp);
    element.removeEventListener("pointerleave", handlePointerUp);
  };
}

interface NormalizedAutoRotateConfig {
  axis: "x" | "y";
  speed: number;
  pauseOnInteraction: boolean;
}

const DEFAULT_AUTO_ROTATE_SPEED = 0.3;

const AUTO_ROTATE_SCOPE: typeof globalThis | undefined =
  typeof window !== "undefined"
    ? window
    : typeof globalThis !== "undefined"
      ? globalThis
      : undefined;

const REQUEST_FRAME =
  typeof AUTO_ROTATE_SCOPE?.requestAnimationFrame === "function"
    ? AUTO_ROTATE_SCOPE.requestAnimationFrame.bind(AUTO_ROTATE_SCOPE)
    : null;

const CANCEL_FRAME =
  typeof AUTO_ROTATE_SCOPE?.cancelAnimationFrame === "function"
    ? AUTO_ROTATE_SCOPE.cancelAnimationFrame.bind(AUTO_ROTATE_SCOPE)
    : null;

function createAutoRotateHandle(
  controller: SceneController,
  option?: AutoRotateOption
): AutoRotateHandle | null {
  const config = normalizeAutoRotateOption(option);
  if (!config || !REQUEST_FRAME || !CANCEL_FRAME) {
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
    frameId = REQUEST_FRAME(tick);
    if (!disabledByInteraction) {
      applyRotation();
    }
  };

  return {
    start() {
      if (frameId !== null || disabledByInteraction) return;
      frameId = REQUEST_FRAME(tick);
    },
    stop() {
      if (frameId === null) return;
      CANCEL_FRAME(frameId);
      frameId = null;
    },
    notifyInteraction() {
      if (!config.pauseOnInteraction || disabledByInteraction) return;
      disabledByInteraction = true;
      if (frameId !== null) {
        CANCEL_FRAME(frameId);
        frameId = null;
      }
    }
  };
}

function normalizeAutoRotateOption(option?: AutoRotateOption): NormalizedAutoRotateConfig | null {
  if (!option) return null;
  if (option === true) {
    return { axis: "y", speed: DEFAULT_AUTO_ROTATE_SPEED, pauseOnInteraction: true };
  }
  if (typeof option === "number") {
    if (!Number.isFinite(option) || option === 0) return null;
    return { axis: "y", speed: option, pauseOnInteraction: true };
  }
  const speedValue =
    typeof option.speed === "number" && Number.isFinite(option.speed)
      ? option.speed
      : DEFAULT_AUTO_ROTATE_SPEED;
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
