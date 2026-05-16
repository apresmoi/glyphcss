import { useEffect, useMemo, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { Polygon } from "@layoutit/polycss-react";
import type { LoadedModel } from "../types";

export interface UseAnimationFramesOptions {
  loaded: LoadedModel | null;
  activeAnimation: { index: number; name: string; duration: number } | null;
  renderer: "react" | "vanilla";
  animationPaused: boolean;
  animationTimeScale: number;
}

export interface UseAnimationFramesResult {
  reactAnimatedPolygons: Polygon[] | null;
  setReactAnimatedPolygons: Dispatch<SetStateAction<Polygon[] | null>>;
  vanillaAnimationFrameFactory: ((timeSeconds: number) => Polygon[]) | undefined;
  animationPausedRef: RefObject<boolean>;
  animationTimeScaleRef: RefObject<number>;
}

export function useAnimationFrames({
  loaded,
  activeAnimation,
  renderer,
  animationPaused,
  animationTimeScale,
}: UseAnimationFramesOptions): UseAnimationFramesResult {
  const [reactAnimatedPolygons, setReactAnimatedPolygons] = useState<Polygon[] | null>(null);
  const animationPausedRef = useRef(animationPaused);
  animationPausedRef.current = animationPaused;
  const animationTimeScaleRef = useRef(animationTimeScale);
  animationTimeScaleRef.current = animationTimeScale;

  useEffect(() => {
    setReactAnimatedPolygons(null);
    if (!loaded?.animation || !activeAnimation || renderer !== "react") return;
    let raf = 0;
    let last = performance.now();
    let elapsedSeconds = 0;
    let sampledSeconds: number | null = null;

    const tick = (now: number) => {
      const deltaSeconds = Math.max(0, (now - last) / 1000);
      last = now;
      if (!animationPausedRef.current) {
        elapsedSeconds += deltaSeconds * animationTimeScaleRef.current;
      }
      if (sampledSeconds !== elapsedSeconds) {
        sampledSeconds = elapsedSeconds;
        setReactAnimatedPolygons(loaded.animation!.sample(activeAnimation.index, elapsedSeconds));
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [loaded, activeAnimation, renderer]);

  const vanillaAnimationFrameFactory = useMemo(() => {
    if (!loaded?.animation || !activeAnimation || renderer !== "vanilla") return undefined;
    return (timeSeconds: number) => {
      return loaded.animation!.sample(activeAnimation.index, timeSeconds);
    };
  }, [
    loaded,
    activeAnimation,
    renderer,
  ]);

  return {
    reactAnimatedPolygons,
    setReactAnimatedPolygons,
    vanillaAnimationFrameFactory,
    animationPausedRef,
    animationTimeScaleRef,
  };
}
