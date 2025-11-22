import { useEffect, useLayoutEffect, useRef, useState, useCallback } from "react";
import type { RefObject } from "react";
import type { SceneBindingOptions } from "@voxcss/controller/createSceneBinding";
import { createSceneBindingManager } from "@voxcss/controller/createSceneBinding";
import type { CameraBindingOptions } from "@voxcss/controller/cameraBindingView";
import type { CameraSlotProps } from "@voxcss/controller/cameraBindingView";
import type { SceneController } from "@voxcss/controller/createSceneController";
import type { AutoRotateOption } from "@voxcss/core/camera";
import {
  createCameraBindingManager,
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
  const managerRef = useRef<ReturnType<typeof createCameraBindingManager> | null>(null);
  if (!managerRef.current) {
    managerRef.current = createCameraBindingManager(props);
  }
  const bindingManager = managerRef.current;
  const [snapshot, setSnapshot] = useState<CameraBindingSnapshot>(() => bindingManager.getSnapshot());

  useLayoutEffect(() => {
    bindingManager.setElement(containerRef.current);
    return () => {
      bindingManager.setElement(null);
    };
  }, [bindingManager]);

  useEffect(() => {
    bindingManager.update(props);
  }, [bindingManager, props]);

  useEffect(() => {
    const unsubscribe = bindingManager.subscribe((next) => setSnapshot(next));
    setSnapshot(bindingManager.getSnapshot());
    return () => unsubscribe();
  }, [bindingManager]);

  useEffect(() => {
    return () => {
      bindingManager.destroy();
      managerRef.current = null;
    };
  }, [bindingManager]);

  const startAutoRotate = useCallback(
    (config?: AutoRotateOption | false) => {
      bindingManager.startAutoRotate(config);
    },
    [bindingManager]
  );

  const stopAutoRotate = useCallback(() => {
    bindingManager.stopAutoRotate();
  }, [bindingManager]);

  return {
    containerRef,
    controller: snapshot.controller,
    slotProps: snapshot.slotProps,
    startAutoRotate,
    stopAutoRotate
  };
}
