import { useEffect, useLayoutEffect, useRef, useState, useCallback } from "react";
import type { RefObject } from "react";
import type { SceneBindingOptions } from "@voxcss/controller/sceneBindings";
import { createSceneBinding, type SceneBindingHandle } from "@voxcss/controller/sceneBindings";
import type { CameraBindingOptions } from "@voxcss/controller/cameraBindings";
import type { CameraSlotProps } from "@voxcss/controller/cameraBindings";
import type { SceneController } from "@voxcss/controller/sceneController";
import type { AutoRotateOption } from "@voxcss/core/camera";
import {
  buildCameraSlotProps,
  createCameraBinding,
  type CameraBindingHandle,
  type CameraRenderSnapshot
} from "@voxcss/controller/cameraBindings";

export type SceneBindingProps = Omit<SceneBindingOptions, "element">;
export type CameraBindingProps = Omit<CameraBindingOptions, "element">;

export function useSceneBinding(props: SceneBindingProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const bindingRef = useRef<SceneBindingHandle | null>(null);
  const latestProps = useRef(props);

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const binding = createSceneBinding({ ...latestProps.current, element });
    bindingRef.current = binding;
    return () => {
      binding.destroy();
      bindingRef.current = null;
    };
  }, []);

  useEffect(() => {
    latestProps.current = props;
    bindingRef.current?.update(props);
  }, [props]);

  return containerRef;
}

export interface CameraBindingHookResult {
  containerRef: RefObject<HTMLDivElement>;
  controller: SceneController | null;
  slotProps: CameraSlotProps | null;
  cursor: string;
  startAutoRotate(config?: AutoRotateOption | false): void;
  stopAutoRotate(): void;
}

export function useCameraBinding(props: CameraBindingProps): CameraBindingHookResult {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const bindingRef = useRef<CameraBindingHandle | null>(null);
  const animateRef = useRef<AutoRotateOption | false | undefined>(props.animate);
  const latestProps = useRef(props);
  const [state, setState] = useState<{
    controller: SceneController | null;
    slotProps: CameraSlotProps | null;
    cursor: string;
  }>({
    controller: null,
    slotProps: null,
    cursor: "default"
  });

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const options = latestProps.current;
    const handle = createCameraBinding({ ...options, element });
    bindingRef.current = handle;

    const applySnapshot = (snapshot: CameraRenderSnapshot) => {
      setState({
        controller: handle.controller,
        slotProps: buildCameraSlotProps(handle.controller, snapshot),
        cursor: snapshot.cursor ?? "default"
      });
    };

    if (animateRef.current !== undefined && animateRef.current !== options.animate) {
      handle.setAnimate(animateRef.current);
    }

    applySnapshot(handle.getSnapshot());
    const unsubscribe = handle.subscribe(applySnapshot);

    return () => {
      unsubscribe();
      handle.destroy();
      bindingRef.current = null;
      setState({
        controller: null,
        slotProps: null,
        cursor: "default"
      });
    };
  }, []);

  useEffect(() => {
    latestProps.current = props;
    animateRef.current = props.animate;
    bindingRef.current?.setOptions(props);
  }, [props]);

  const startAutoRotate = useCallback((config?: AutoRotateOption | false) => {
    const handle = bindingRef.current;
    if (!handle) return;
    const next = config ?? animateRef.current;
    animateRef.current = next;
    handle.setAnimate(next);
  }, []);

  const stopAutoRotate = useCallback(() => {
    animateRef.current = false;
    bindingRef.current?.setAnimate(false);
  }, []);

  return {
    containerRef,
    controller: state.controller,
    slotProps: state.slotProps,
    cursor: state.cursor,
    startAutoRotate,
    stopAutoRotate
  };
}
