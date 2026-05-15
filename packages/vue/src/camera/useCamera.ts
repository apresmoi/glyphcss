import { ref, shallowRef, watch } from "vue";
import type { Ref } from "vue";
import { createIsometricCamera, BASE_TILE } from "@layoutit/polycss-core";
import type { CameraState, CameraHandle, Vec3 } from "@layoutit/polycss-core";
import { createSceneStore, type SceneStore } from "../store";

export interface UseCameraOptions {
  zoom?: number;
  target?: Vec3;
  rotX?: number;
  rotY?: number;
  distance?: number;
}

export interface UseCameraResult {
  store: SceneStore;
  cameraRef: Ref<CameraHandle>;
  sceneElRef: Ref<HTMLElement | null>;
  /**
   * Bind to the camera root element. Layered components like
   * <PolyOrbitControls> need the underlying ref to wire non-passive wheel /
   * pointer listeners (Vue's @wheel is passive by default in modern
   * versions and can't preventDefault).
   */
  cameraElRef: Ref<HTMLDivElement | null>;
  /**
   * Bbox-center of all centerable meshes in world coords. Written by
   * <PolyScene> when autoCenter is enabled. Read by applyTransformDirect
   * to fold the offset into the scene transform without a DOM wrapper.
   */
  autoCenterOffset: Ref<Vec3>;
  /**
   * Apply the current camera state (from cameraRef.value.state) directly
   * to sceneEl.style.transform. Exposed so layered components like
   * <PolyOrbitControls> can call it after mutating cameraRef.value.
   */
  applyTransformDirect: () => void;
}

export function usePolyCamera(options: Ref<UseCameraOptions>): UseCameraResult {
  const handle = createIsometricCamera({
    zoom: options.value.zoom,
    target: options.value.target,
    rotX: options.value.rotX,
    rotY: options.value.rotY,
    distance: options.value.distance,
  });

  const cameraRef = shallowRef<CameraHandle>(handle);
  const sceneElRef = ref<HTMLElement | null>(null);
  const cameraElRef = ref<HTMLDivElement | null>(null);
  const autoCenterOffset = ref<Vec3>([0, 0, 0]);
  const store = createSceneStore(handle.state);

  // Sync prop changes to camera handle — only update when values actually change
  watch(
    () => ({
      zoom: options.value.zoom,
      target: options.value.target,
      rotX: options.value.rotX,
      rotY: options.value.rotY,
      distance: options.value.distance,
    }),
    (next, prev) => {
      const partial: Partial<CameraState> = {};
      if (next.zoom !== undefined && next.zoom !== prev?.zoom) partial.zoom = next.zoom;
      if (next.target !== undefined && next.target !== prev?.target) partial.target = next.target;
      if (next.rotX !== undefined && next.rotX !== prev?.rotX) partial.rotX = next.rotX;
      if (next.rotY !== undefined && next.rotY !== prev?.rotY) partial.rotY = next.rotY;
      if (next.distance !== undefined && next.distance !== prev?.distance) partial.distance = next.distance;
      if (Object.keys(partial).length > 0) {
        handle.update(partial);
        applyTransformDirect();
        store.updateCameraFromRef(handle);
        store.notifyAll();
      }
    }
  );

  // Apply camera transform directly to scene element (bypasses Vue reactivity).
  // Folds autoCenterOffset (bbox-center of centerable meshes) into the
  // innermost translate3d alongside `target`, matching vanilla buildSceneTransform.
  // Kept separate from `target` so user pan survives mesh add/remove.
  function applyTransformDirect(): void {
    const el = sceneElRef.value;
    if (!el) return;
    const s = handle.state;
    const tileSize = BASE_TILE;
    const offset = autoCenterOffset.value;
    // world→CSS axis swap: world[0]→CSS Y, world[1]→CSS X, world[2]→CSS Z
    const wx = s.target[0] + offset[0];
    const wy = s.target[1] + offset[1];
    const wz = s.target[2] + offset[2];
    const cssX = wy * tileSize;
    const cssY = wx * tileSize;
    const cssZ = wz * tileSize;
    const distancePart = s.distance !== 0 ? `translateZ(${-s.distance}px) ` : "";
    el.style.transform = `${distancePart}scale(${s.zoom}) rotateX(${s.rotX}deg) rotate(${s.rotY}deg) translate3d(${-cssX}px, ${-cssY}px, ${-cssZ}px)`;
  }

  return {
    store,
    cameraRef,
    sceneElRef,
    cameraElRef,
    autoCenterOffset,
    applyTransformDirect,
  };
}
