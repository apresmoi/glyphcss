import type { CameraBindingHandle, CameraBindingOptions, CameraRenderSnapshot } from "./createCameraBinding";
import { createCameraBindingAdapter, type CameraBindingAdapter } from "./createCameraBindingAdapter";
import { resolveCameraSlotProps, type CameraSlotProps } from "./createCameraComponentCore";
import type { SceneController } from "./createSceneController";

export interface CameraHostAdapterHooks {
  getElement(): HTMLElement | null;
  getOptions(): Omit<CameraBindingOptions, "element">;
  onSlotProps?(props: CameraSlotProps | null): void;
  onController?(controller: SceneController | null): void;
  onSnapshot?(snapshot: CameraRenderSnapshot | null): void;
  onHandle?(handle: CameraBindingHandle | null): void;
  onDestroy?(): void;
}

export interface CameraHostAdapter extends CameraBindingAdapter {
  getSlotProps(): CameraSlotProps | null;
}

export function createCameraHostAdapter(hooks: CameraHostAdapterHooks): CameraHostAdapter {
  let currentController: SceneController | null = null;
  let currentSnapshot: CameraRenderSnapshot | null = null;
  let slotProps: CameraSlotProps | null = null;

  const emitSlotProps = () => {
    slotProps = resolveCameraSlotProps(currentController, currentSnapshot);
    hooks.onSlotProps?.(slotProps);
  };

  const adapter = createCameraBindingAdapter({
    getElement: hooks.getElement,
    getOptions: hooks.getOptions,
    onController(next) {
      currentController = next;
      hooks.onController?.(next);
      emitSlotProps();
    },
    onSnapshot(next) {
      currentSnapshot = next;
      hooks.onSnapshot?.(next);
      emitSlotProps();
    },
    onHandle: hooks.onHandle,
    onDestroy() {
      slotProps = null;
      currentController = null;
      currentSnapshot = null;
      hooks.onSlotProps?.(null);
      hooks.onDestroy?.();
    }
  });

  return {
    ...adapter,
    getSlotProps: () => slotProps
  };
}
