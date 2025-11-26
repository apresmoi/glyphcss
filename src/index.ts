export {
  sceneController,
  type SceneController,
  type SceneControllerOptions
} from "./controller/sceneController";

export {
  mountScene,
  normalizeSceneState,
  SCENE_HOST_CLASS,
  type SceneState,
  type SceneComponentProps
} from "./controller/sceneBindings";

export {
  mountCameraBinding,
  CAMERA_HOST_CLASS,
  type CameraComponentProps,
  type CameraSlotProps,
  type CameraBindingSnapshot
} from "./controller/domBindings";

export {
  createCamera,
  createScene,
  renderScene,
  type HeadlessCameraOptions,
  type HeadlessCameraHandle,
  type HeadlessSceneOptions,
  type HeadlessRenderOptions,
  type HeadlessRenderHandle
} from "./core/headless";

export { type AutoRotateOption } from "./core/camera";
export type { ProjectionMode, VoxelGrid } from "./core/types";
