import { ref, shallowRef, watch, onMounted, onBeforeUnmount } from "vue";
import type { Ref } from "vue";
import { createIsometricCamera } from "@polycss/core";
import type { CameraState, CameraHandle, AutoRotateOption, AutoRotateConfig } from "@polycss/core";
import { createSceneStore, type SceneStore } from "../store";

const POINTER_DRAG_SPEED = 5;

export interface UseCameraOptions {
  zoom?: number;
  pan?: number;
  tilt?: number;
  rotX?: number;
  rotY?: number;
  interactive?: boolean;
  invert?: boolean | number;
  animate?: AutoRotateOption | false;
}

export interface UseCameraResult {
  store: SceneStore;
  cameraRef: Ref<CameraHandle>;
  sceneElRef: Ref<HTMLElement | null>;
  onPointerDown: (e: PointerEvent) => void;
  onPointerMove: (e: PointerEvent) => void;
  onPointerUp: (e: PointerEvent) => void;
  onPointerCancel: (e: PointerEvent) => void;
  cursor: Ref<string>;
}

function normalizeAngle(value: number): number {
  let normalized = value % 360;
  if (normalized < 0) normalized += 360;
  return normalized;
}

function normalizeAutoRotateOption(
  option: AutoRotateOption
): { axis: "x" | "y"; speed: number; pauseOnInteraction: boolean } | null {
  if (!option) return null;
  if (option === true) return { axis: "y", speed: 0.3, pauseOnInteraction: true };
  if (typeof option === "number") {
    if (!Number.isFinite(option) || option === 0) return null;
    return { axis: "y", speed: option, pauseOnInteraction: true };
  }
  const config = option as AutoRotateConfig;
  const speed =
    typeof config.speed === "number" && Number.isFinite(config.speed) ? config.speed : 0.3;
  if (!speed) return null;
  return {
    axis: config.axis === "x" ? "x" : "y",
    speed,
    pauseOnInteraction: config.pauseOnInteraction !== false,
  };
}

export function useCamera(options: Ref<UseCameraOptions>): UseCameraResult {
  const handle = createIsometricCamera({
    zoom: options.value.zoom,
    pan: options.value.pan,
    tilt: options.value.tilt,
    rotX: options.value.rotX,
    rotY: options.value.rotY,
  });

  const cameraRef = shallowRef<CameraHandle>(handle);
  const sceneElRef = ref<HTMLElement | null>(null);
  const store = createSceneStore(handle.state);

  const isDragging = ref(false);
  let activePointerId: number | null = null;
  const pointer = { x: 0, y: 0 };
  let animationPaused = false;

  function getInvertSign(): number {
    const inv = options.value.invert;
    if (typeof inv === "number") return inv < 0 ? -1 : 1;
    return inv === true ? -1 : 1;
  }

  // Sync prop changes to camera handle — only update when values actually change
  watch(
    () => ({
      zoom: options.value.zoom,
      pan: options.value.pan,
      tilt: options.value.tilt,
      rotX: options.value.rotX,
      rotY: options.value.rotY,
    }),
    (next, prev) => {
      const partial: Partial<CameraState> = {};
      if (next.zoom !== undefined && next.zoom !== prev?.zoom) partial.zoom = next.zoom;
      if (next.pan !== undefined && next.pan !== prev?.pan) partial.pan = next.pan;
      if (next.tilt !== undefined && next.tilt !== prev?.tilt) partial.tilt = next.tilt;
      if (next.rotX !== undefined && next.rotX !== prev?.rotX) partial.rotX = next.rotX;
      if (next.rotY !== undefined && next.rotY !== prev?.rotY) partial.rotY = next.rotY;
      if (Object.keys(partial).length > 0) {
        handle.update(partial);
        applyTransformDirect();
        store.updateCameraFromRef(handle);
        store.notifyAll();
      }
    }
  );

  // Apply camera transform directly to scene element (bypasses Vue reactivity)
  function applyTransformDirect(): void {
    const el = sceneElRef.value;
    if (!el) return;
    const s = handle.state;
    const depthOffset = Number(el.dataset.polycssDepthOffset ?? 0);
    el.style.transform = `scale(${s.zoom}) translateY(${depthOffset}px) translateY(${s.tilt}px) translateX(${s.pan}px) rotateX(${s.rotX}deg) rotate(${s.rotY}deg)`;
  }

  // Auto-rotate
  let animFrameId = 0;
  let animStopped = false;

  function startAnimation(): void {
    stopAnimation();
    const animOpt = options.value.animate;
    if (!animOpt) return;
    const config = normalizeAutoRotateOption(animOpt);
    if (!config) return;

    animStopped = false;
    const tick = () => {
      if (animStopped) return;
      if (!animationPaused) {
        if (config.axis === "x") {
          handle.update({ rotX: normalizeAngle(handle.state.rotX + config.speed) });
        } else {
          handle.update({ rotY: normalizeAngle(handle.state.rotY + config.speed) });
        }
        applyTransformDirect();
        store.updateCameraFromRef(handle);
      }
      animFrameId = requestAnimationFrame(tick);
    };
    animFrameId = requestAnimationFrame(tick);
  }

  function stopAnimation(): void {
    animStopped = true;
    if (animFrameId) {
      cancelAnimationFrame(animFrameId);
      animFrameId = 0;
    }
  }

  watch(() => options.value.animate, () => {
    startAnimation();
  });

  onMounted(() => {
    startAnimation();
  });

  onBeforeUnmount(() => {
    stopAnimation();
  });

  const cursor = ref("grab");

  function onPointerDown(e: PointerEvent): void {
    if (!options.value.interactive) return;
    if (activePointerId !== null) return;
    if (e.isPrimary === false) return;

    const animConfig = options.value.animate ? normalizeAutoRotateOption(options.value.animate) : null;
    if (animConfig?.pauseOnInteraction) {
      animationPaused = true;
    }

    e.preventDefault();
    activePointerId = e.pointerId;
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    isDragging.value = true;
    cursor.value = "grabbing";
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // Ignore capture errors
    }
  }

  function onPointerMove(e: PointerEvent): void {
    if (activePointerId === null || e.pointerId !== activePointerId) return;
    e.preventDefault();
    const inv = getInvertSign();
    const dX = ((e.clientX - pointer.x) * inv) / POINTER_DRAG_SPEED;
    const dY = ((e.clientY - pointer.y) * inv) / POINTER_DRAG_SPEED;
    handle.update({
      rotX: Math.max(0, Math.min(100, handle.state.rotX - dY)),
      rotY: (handle.state.rotY - dX + 360) % 360,
    });
    applyTransformDirect();
    pointer.x = e.clientX;
    pointer.y = e.clientY;

    store.updateCameraFromRef(handle);
  }

  function onPointerUp(e: PointerEvent): void {
    if (activePointerId === null || e.pointerId !== activePointerId) return;
    activePointerId = null;
    isDragging.value = false;
    cursor.value = "grab";
    animationPaused = false;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // Ignore capture errors
    }
  }

  return {
    store,
    cameraRef,
    sceneElRef,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: onPointerUp,
    cursor,
  };
}
