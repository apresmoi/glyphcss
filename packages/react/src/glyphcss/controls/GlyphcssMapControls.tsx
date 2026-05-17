/**
 * GlyphcssMapControls — map/pan-mode controls for an ASCII GlyphcssScene.
 * Left-drag pans; right-drag or Shift+left orbits. Wheel zooms.
 */
import { useEffect, useRef } from "react";
import type { GlyphcssMapControlsHandle, GlyphcssMapControlsOptions } from "glyphcss";
import { createGlyphcssMapControls } from "glyphcss";
import { useGlyphcssSceneContext } from "../scene/context";

export interface GlyphcssMapControlsProps {
  drag?: boolean;
  wheel?: boolean;
  invert?: boolean | number;
  animate?: false | { speed?: number; axis?: "x" | "y"; pauseOnInteraction?: boolean };
}

export function GlyphcssMapControls({
  drag = true,
  wheel = true,
  invert = false,
  animate = false,
}: GlyphcssMapControlsProps): null {
  const { sceneRef } = useGlyphcssSceneContext();
  const controlsRef = useRef<GlyphcssMapControlsHandle | null>(null);
  const propsRef = useRef({ drag, wheel, invert, animate });
  propsRef.current = { drag, wheel, invert, animate };

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const opts: GlyphcssMapControlsOptions = {
      drag: propsRef.current.drag,
      wheel: propsRef.current.wheel,
      invert: propsRef.current.invert,
      animate: propsRef.current.animate === false ? false : propsRef.current.animate,
    };
    const controls = createGlyphcssMapControls(scene, opts);
    controlsRef.current = controls;
    return () => {
      controls.destroy();
      controlsRef.current = null;
    };
  }, [sceneRef]);

  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    controls.update({ drag, wheel, invert, animate: animate === false ? false : animate });
  });

  return null;
}
