import { createCamera, type HeadlessCameraHandle } from "../core/headless";
import {
  normalizeCameraOptions,
  syncCameraOptions,
  type CameraComponentProps,
  type NormalizedCameraOptions
} from "./cameraBindings";
import type { SceneController } from "./sceneController";
import type { AutoRotateOption } from "../core/camera";

export interface CameraBindingState {
  handle: HeadlessCameraHandle | null;
  options: NormalizedCameraOptions | null;
  animate: AutoRotateOption | false | undefined;
}

export interface CameraBindingSnapshot {
  controller: SceneController;
  cursor: string;
  boxStyle: Record<string, string>;
  walls: ReturnType<SceneController["getWalls"]>;
  camera: ReturnType<SceneController["getCameraState"]>;
}

export function mountCameraBinding(
  element: HTMLElement,
  props: CameraComponentProps,
  onSnapshot: (snapshot: CameraBindingSnapshot | null) => void,
  onCursor?: (cursor: string) => void
): {
  destroy(): void;
  update(next: CameraComponentProps): void;
  startAutoRotate(config?: AutoRotateOption): void;
  stopAutoRotate(): void;
} {
  const handle = createCamera({ ...props, element });
  let options = normalizeCameraOptions(props);
  let animate = options.animate;

  const applySnapshot = () => {
    const controller = handle.controller;
    const cursor = handle.interactive ? controller.getCursor() : "default";
    onSnapshot({
      controller,
      cursor,
      boxStyle: controller.getBoxStyle(),
      walls: controller.getWalls(),
      camera: controller.getCameraState()
    });
    onCursor?.(cursor);
  };

  const unsubscribers = [
    handle.controller.subscribeBoxStyle(applySnapshot),
    handle.controller.subscribeCamera(applySnapshot),
    handle.controller.subscribeWalls(applySnapshot),
    handle.controller.subscribeCursor(applySnapshot)
  ];

  applySnapshot();

  const update = (next: CameraComponentProps) => {
    options = syncCameraOptions(handle, options, next);
    animate = options.animate;
    applySnapshot();
  };

  const startAutoRotate = (config?: AutoRotateOption) => {
    const next = config ?? animate;
    update({ animate: next });
  };

  const stopAutoRotate = () => {
    update({ animate: false });
  };

  const destroy = () => {
    unsubscribers.forEach((dispose) => dispose());
    onSnapshot(null);
    onCursor?.("default");
    handle.destroy();
  };

  return {
    destroy,
    update,
    startAutoRotate,
    stopAutoRotate
  };
}
