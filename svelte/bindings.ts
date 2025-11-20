import { createSceneBinding, type SceneBindingHandle, type SceneBindingOptions } from "@voxcss/controller/createSceneBinding";
import {
  createCameraBinding,
  type CameraBindingHandle,
  type CameraBindingOptions,
  type CameraRenderSnapshot
} from "@voxcss/controller/createCameraBinding";
import type { SceneController } from "@voxcss/controller/createSceneController";

export type SceneBindingActionOptions = Omit<SceneBindingOptions, "element">;

export interface CameraBindingActionOptions extends Omit<CameraBindingOptions, "element"> {
  onSnapshot?(snapshot: CameraRenderSnapshot): void;
  onController?(controller: SceneController | null): void;
  onHandle?(handle: CameraBindingHandle | null): void;
}

function applySceneBinding(node: HTMLElement, options: SceneBindingActionOptions): SceneBindingHandle {
  const binding = createSceneBinding({ ...options, element: node });
  binding.mount();
  return binding;
}

export function sceneBinding(node: HTMLElement, options: SceneBindingActionOptions) {
  let binding = applySceneBinding(node, options);

  return {
    update(next: SceneBindingActionOptions) {
      if (next.controller !== options.controller) {
        binding.destroy();
        binding = applySceneBinding(node, next);
      } else {
        binding.update({
          voxels: next.voxels,
          rows: next.rows,
          cols: next.cols,
          depth: next.depth,
          showWalls: next.showWalls,
          showFloor: next.showFloor,
          projection: next.projection
        });
      }
      options = next;
    },
    destroy() {
      binding.destroy();
    }
  };
}

function mountCameraBinding(node: HTMLElement, options: CameraBindingActionOptions) {
  const binding = createCameraBinding({ ...options, element: node });
  options.onHandle?.(binding);
  options.onController?.(binding.controller);
  let unsubscribe = binding.subscribe((snapshot) => options.onSnapshot?.(snapshot));
  options.onSnapshot?.(binding.getSnapshot());

  return {
    binding,
    teardown() {
      unsubscribe?.();
      binding.destroy();
      options.onHandle?.(null);
      options.onController?.(null);
    },
    updateCallbacks(next: CameraBindingActionOptions) {
      options = next;
    }
  };
}

export function cameraBinding(node: HTMLElement, options: CameraBindingActionOptions) {
  let mounted = mountCameraBinding(node, options);

  return {
    update(next: CameraBindingActionOptions) {
      if (next !== options && next.controller !== options.controller) {
        mounted.teardown();
        mounted = mountCameraBinding(node, next);
      } else {
        mounted.binding.setOptions({
          zoom: next.zoom,
          pan: next.pan,
          tilt: next.tilt,
          rotX: next.rotX,
          rotY: next.rotY,
          invert: next.invert,
          interactive: next.interactive,
          perspective: next.perspective,
          animate: next.animate
        });
        mounted.updateCallbacks(next);
      }
      options = next;
    },
    destroy() {
      mounted.teardown();
    }
  };
}
