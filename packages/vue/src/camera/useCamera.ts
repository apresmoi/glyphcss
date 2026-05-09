import { ref, shallowRef, watch } from "vue";
import type { Ref } from "vue";
import { createIsometricCamera } from "@layoutit/polycss-core";
import type { CameraState, CameraHandle } from "@layoutit/polycss-core";
import { createSceneStore, type SceneStore } from "../store";

export interface UseCameraOptions {
  zoom?: number;
  pan?: number;
  tilt?: number;
  rotX?: number;
  rotY?: number;
}

export interface UseCameraResult {
  store: SceneStore;
  cameraRef: Ref<CameraHandle>;
  sceneElRef: Ref<HTMLElement | null>;
  /**
   * Bind to the camera root element. Layered components like
   * <PolyControls> need the underlying ref to wire non-passive wheel /
   * pointer listeners (Vue's @wheel is passive by default in modern
   * versions and can't preventDefault).
   */
  cameraElRef: Ref<HTMLDivElement | null>;
  /**
   * Apply the current camera state (from cameraRef.value.state) directly
   * to sceneEl.style.transform. Exposed so layered components like
   * <PolyControls> can call it after mutating cameraRef.value.
   */
  applyTransformDirect: () => void;
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
  const cameraElRef = ref<HTMLDivElement | null>(null);
  const store = createSceneStore(handle.state);

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

  return {
    store,
    cameraRef,
    sceneElRef,
    cameraElRef,
    applyTransformDirect,
  };
}
