import { useEffect, useLayoutEffect, useRef, useState, useCallback } from "react";
import type { RefObject } from "react";
import {
  createSceneBinding,
  type SceneBindingHandle,
  type SceneBindingOptions
} from "@voxcss/controller/createSceneBinding";
import {
  createCameraBinding,
  type CameraBindingHandle,
  type CameraBindingOptions,
  type CameraRenderSnapshot
} from "@voxcss/controller/createCameraBinding";
import type { SceneController } from "@voxcss/controller/createSceneController";
import type { AutoRotateOption } from "@voxcss/core/camera";

export type SceneBindingProps = Omit<SceneBindingOptions, "element">;
export type CameraBindingProps = Omit<CameraBindingOptions, "element">;

export function useSceneBinding(props: SceneBindingProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const bindingRef = useRef<SceneBindingHandle | null>(null);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const binding = createSceneBinding({ ...props, element });
    binding.mount();
    bindingRef.current = binding;
    return () => {
      binding.destroy();
      bindingRef.current = null;
    };
  }, [props.controller]);

  useEffect(() => {
    bindingRef.current?.update({
      voxels: props.voxels,
      rows: props.rows,
      cols: props.cols,
      depth: props.depth,
      showWalls: props.showWalls,
      showFloor: props.showFloor,
      projection: props.projection
    });
  }, [props.voxels, props.rows, props.cols, props.depth, props.showWalls, props.showFloor, props.projection]);

  return containerRef;
}

export interface CameraBindingHookResult {
  containerRef: RefObject<HTMLDivElement>;
  controller: SceneController | null;
  snapshot: CameraRenderSnapshot | null;
  startAutoRotate(config?: AutoRotateOption | false): void;
  stopAutoRotate(): void;
}

export function useCameraBinding(props: CameraBindingProps): CameraBindingHookResult {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const bindingRef = useRef<CameraBindingHandle | null>(null);
  const animateRef = useRef<AutoRotateOption | false | undefined>(props.animate);
  const [controller, setController] = useState<SceneController | null>(null);
  const [snapshot, setSnapshot] = useState<CameraRenderSnapshot | null>(null);

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const binding = createCameraBinding({ ...props, element });
    bindingRef.current = binding;
    setController(binding.controller);
    setSnapshot(binding.getSnapshot());
    const unsubscribe = binding.subscribe((next) => setSnapshot(next));
    return () => {
      unsubscribe();
      binding.destroy();
      bindingRef.current = null;
      setController(null);
      setSnapshot(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    animateRef.current = props.animate;
    bindingRef.current?.setOptions({
      zoom: props.zoom,
      pan: props.pan,
      tilt: props.tilt,
      rotX: props.rotX,
      rotY: props.rotY,
      invert: props.invert,
      interactive: props.interactive,
      perspective: props.perspective,
      animate: props.animate
    });
  }, [props.zoom, props.pan, props.tilt, props.rotX, props.rotY, props.invert, props.interactive, props.perspective, props.animate]);

  const startAutoRotate = useCallback((config?: AutoRotateOption | false) => {
    const option = config ?? animateRef.current;
    animateRef.current = option;
    bindingRef.current?.setAnimate(option);
  }, []);

  const stopAutoRotate = useCallback(() => {
    animateRef.current = false;
    bindingRef.current?.setAnimate(false);
  }, []);

  return {
    containerRef,
    controller,
    snapshot,
    startAutoRotate,
    stopAutoRotate
  };
}
