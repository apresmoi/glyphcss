import { useEffect, useLayoutEffect, useRef, useState, useCallback } from "react";
import type { RefObject } from "react";
import type { SceneBindingOptions } from "@voxcss/controller/createSceneBinding";
import { createSceneBindingManager } from "@voxcss/controller/createSceneBindingAdapter";
import type { CameraBindingOptions } from "@voxcss/controller/createCameraBinding";
import type { CameraSlotProps } from "@voxcss/controller/createCameraComponentCore";
import type { SceneController } from "@voxcss/controller/createSceneController";
import type { AutoRotateOption } from "@voxcss/core/camera";
import {
  createCameraBindingView,
  type CameraBindingSnapshot
} from "@voxcss/controller/cameraBindingView";

export type SceneBindingProps = Omit<SceneBindingOptions, "element">;
export type CameraBindingProps = Omit<CameraBindingOptions, "element">;

export function useSceneBinding(props: SceneBindingProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const managerRef = useRef<ReturnType<typeof createSceneBindingManager<SceneBindingProps>> | null>(null);

  if (!managerRef.current) {
    managerRef.current = createSceneBindingManager<SceneBindingProps>({
      getElement: () => containerRef.current,
      getOptions: () => props
    });
  }

  const manager = managerRef.current;

  useLayoutEffect(() => {
    if (!containerRef.current) return;
    manager.mount(containerRef.current);
    return () => {
      manager.destroy();
      managerRef.current = null;
    };
  }, [manager]);

  useLayoutEffect(() => {
    manager.update(props);
  }, [manager, props]);

  return containerRef;
}

export interface CameraBindingHookResult {
  containerRef: RefObject<HTMLDivElement>;
  controller: SceneController | null;
  slotProps: CameraSlotProps | null;
  startAutoRotate(config?: AutoRotateOption | false): void;
  stopAutoRotate(): void;
}

export function useCameraBinding(props: CameraBindingProps): CameraBindingHookResult {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<ReturnType<typeof createCameraBindingView> | null>(null);
  if (!viewRef.current) {
    viewRef.current = createCameraBindingView(props);
  }
  const bindingView = viewRef.current;
  const [snapshot, setSnapshot] = useState<CameraBindingSnapshot>(() => bindingView.getSnapshot());

  useLayoutEffect(() => {
    bindingView.setElement(containerRef.current);
    return () => {
      bindingView.setElement(null);
    };
  }, [bindingView]);

  useEffect(() => {
    bindingView.setOptions(props);
  }, [bindingView, props]);

  useEffect(() => {
    const unsubscribe = bindingView.subscribe((next) => setSnapshot(next));
    return () => unsubscribe();
  }, [bindingView]);

  useEffect(() => {
    return () => {
      bindingView.destroy();
      viewRef.current = null;
    };
  }, [bindingView]);

  const startAutoRotate = useCallback(
    (config?: AutoRotateOption | false) => {
      bindingView.startAutoRotate(config);
    },
    [bindingView]
  );

  const stopAutoRotate = useCallback(() => {
    bindingView.stopAutoRotate();
  }, [bindingView]);

  return {
    containerRef,
    controller: snapshot.controller,
    slotProps: snapshot.slotProps,
    startAutoRotate,
    stopAutoRotate
  };
}
