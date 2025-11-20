import { useEffect, useLayoutEffect, useRef, useState, useCallback } from "react";
import type { RefObject } from "react";
import type { SceneBindingOptions } from "@voxcss/controller/createSceneBinding";
import { createSceneBindingAdapter } from "@voxcss/controller/createSceneBindingAdapter";
import type { CameraBindingOptions } from "@voxcss/controller/createCameraBinding";
import type { CameraSlotProps } from "@voxcss/controller/createCameraComponentCore";
import type { SceneController } from "@voxcss/controller/createSceneController";
import type { AutoRotateOption } from "@voxcss/core/camera";
import {
  createBindingLifecycle,
  type BindingLifecycle,
  type BindingLifecycleAdapterHooks
} from "@voxcss/controller/bindingLifecycle";
import {
  createCameraBindingState,
  type CameraBindingSnapshot
} from "@voxcss/controller/cameraBindingState";

export type SceneBindingProps = Omit<SceneBindingOptions, "element">;
export type CameraBindingProps = Omit<CameraBindingOptions, "element">;

function useBindingAdapter<TAdapter extends { sync(): void; destroy(): void }, TOptions>(
  initAdapter: (hooks: BindingLifecycleAdapterHooks<TOptions | null>) => TAdapter,
  options: TOptions
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const lifecycleRef = useRef<BindingLifecycle<TAdapter, TOptions> | null>(null);

  if (!lifecycleRef.current) {
    lifecycleRef.current = createBindingLifecycle(initAdapter);
  }

  const lifecycle = lifecycleRef.current;

  useLayoutEffect(() => {
    lifecycle.setElement(containerRef.current);
    return () => {
      lifecycle.setElement(null);
    };
  }, [lifecycle]);

  useLayoutEffect(() => {
    lifecycle.setOptions(options);
  }, [lifecycle, options]);

  useEffect(() => {
    return () => {
      lifecycle.destroy();
      lifecycleRef.current = null;
    };
  }, [lifecycle]);

  return {
    ref: containerRef
  };
}

export function useSceneBinding(props: SceneBindingProps) {
  const { ref } = useBindingAdapter(
    (hooks) =>
      createSceneBindingAdapter({
        getElement: () => hooks.getElement(),
        getOptions: () => hooks.getOptions()
      }),
    props
  );
  return ref;
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
  const stateRef = useRef<ReturnType<typeof createCameraBindingState> | null>(null);
  if (!stateRef.current) {
    stateRef.current = createCameraBindingState(props);
  }
  const bindingState = stateRef.current;
  const [snapshot, setSnapshot] = useState<CameraBindingSnapshot>(() => bindingState.getSnapshot());

  useLayoutEffect(() => {
    bindingState.setElement(containerRef.current);
    return () => {
      bindingState.setElement(null);
    };
  }, [bindingState]);

  useEffect(() => {
    bindingState.setOptions(props);
  }, [bindingState, props]);

  useEffect(() => {
    const unsubscribe = bindingState.subscribe((next) => setSnapshot(next));
    return () => unsubscribe();
  }, [bindingState]);

  useEffect(() => {
    return () => {
      bindingState.destroy();
      stateRef.current = null;
    };
  }, [bindingState]);

  const startAutoRotate = useCallback(
    (config?: AutoRotateOption | false) => {
      bindingState.startAutoRotate(config);
    },
    [bindingState]
  );

  const stopAutoRotate = useCallback(() => {
    bindingState.stopAutoRotate();
  }, [bindingState]);

  return {
    containerRef,
    controller: snapshot.controller,
    slotProps: snapshot.slotProps,
    startAutoRotate,
    stopAutoRotate
  };
}
