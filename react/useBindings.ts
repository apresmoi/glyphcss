import { useEffect, useLayoutEffect, useRef, useState, useCallback } from "react";
import type { RefObject } from "react";
import type { SceneBindingOptions } from "@voxcss/controller/createSceneBinding";
import { createSceneBindingAdapter, type SceneBindingAdapter } from "@voxcss/controller/createSceneBindingAdapter";
import type { CameraBindingOptions, CameraRenderSnapshot } from "@voxcss/controller/createCameraBinding";
import { createCameraBindingAdapter, type CameraBindingAdapter } from "@voxcss/controller/createCameraBindingAdapter";
import type { SceneController } from "@voxcss/controller/createSceneController";
import type { AutoRotateOption } from "@voxcss/core/camera";

export type SceneBindingProps = Omit<SceneBindingOptions, "element">;
export type CameraBindingProps = Omit<CameraBindingOptions, "element">;

export function useSceneBinding(props: SceneBindingProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const optionsRef = useRef(props);
  optionsRef.current = props;
  const adapterRef = useRef<SceneBindingAdapter | null>(null);

  if (!adapterRef.current) {
    adapterRef.current = createSceneBindingAdapter({
      getElement: () => containerRef.current,
      getOptions: () => optionsRef.current
    });
  }

  useLayoutEffect(() => {
    adapterRef.current?.sync();
  });

  useEffect(() => {
    return () => {
      adapterRef.current?.destroy();
    };
  }, []);

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
  const optionsRef = useRef(props);
  optionsRef.current = props;
  const animateRef = useRef<AutoRotateOption | false | undefined>(props.animate);
  const adapterRef = useRef<CameraBindingAdapter | null>(null);
  const [controller, setController] = useState<SceneController | null>(null);
  const [snapshot, setSnapshot] = useState<CameraRenderSnapshot | null>(null);

  if (!adapterRef.current) {
    adapterRef.current = createCameraBindingAdapter({
      getElement: () => containerRef.current,
      getOptions: () => optionsRef.current,
      onController: (next) => setController(next),
      onSnapshot: (next) => setSnapshot(next),
      onDestroy: () => setSnapshot(null)
    });
  }

  useLayoutEffect(() => {
    adapterRef.current?.sync();
  });

  useEffect(() => {
    return () => {
      adapterRef.current?.destroy();
      adapterRef.current = null;
      setController(null);
      setSnapshot(null);
    };
  }, []);

  useEffect(() => {
    animateRef.current = props.animate;
  }, [props.animate]);

  const startAutoRotate = useCallback((config?: AutoRotateOption | false) => {
    const option = config ?? animateRef.current;
    animateRef.current = option;
    adapterRef.current?.setAnimate(option);
  }, []);

  const stopAutoRotate = useCallback(() => {
    animateRef.current = false;
    adapterRef.current?.setAnimate(false);
  }, []);

  return {
    containerRef,
    controller,
    snapshot,
    startAutoRotate,
    stopAutoRotate
  };
}
