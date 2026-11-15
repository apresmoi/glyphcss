/**
 * GlyphMapControls — map/pan-mode controls for an ASCII GlyphScene.
 * Left-drag pans; right-drag or Shift+left orbits. Wheel zooms.
 */
import { useEffect, useRef } from "react";
import type { GlyphMapControlsHandle, GlyphMapControlsOptions } from "glyphcss";
import { createGlyphMapControls } from "glyphcss";
import { useGlyphSceneContext } from "../scene/context";

export interface GlyphMapControlsProps {
  drag?: boolean;
  wheel?: boolean;
  invert?: boolean | number;
  animate?: false | { speed?: number; axis?: "x" | "y"; pauseOnInteraction?: boolean };
  /**
   * Slide the picture with a CSS transform while panning instead of
   * re-rendering every move (orthographic cameras). Default false. See
   * `createGlyphMapControls`'s own doc.
   */
  compositorPan?: boolean;
}

export function GlyphMapControls({
  drag = true,
  wheel = true,
  invert = false,
  animate = false,
  compositorPan = false,
}: GlyphMapControlsProps): null {
  const { sceneRef } = useGlyphSceneContext();
  const controlsRef = useRef<GlyphMapControlsHandle | null>(null);
  const propsRef = useRef({ drag, wheel, invert, animate, compositorPan });
  propsRef.current = { drag, wheel, invert, animate, compositorPan };

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const opts: GlyphMapControlsOptions = {
      drag: propsRef.current.drag,
      wheel: propsRef.current.wheel,
      invert: propsRef.current.invert,
      animate: propsRef.current.animate === false ? false : propsRef.current.animate,
      compositorPan: propsRef.current.compositorPan,
    };
    const controls = createGlyphMapControls(scene, opts);
    controlsRef.current = controls;
    return () => {
      controls.destroy();
      controlsRef.current = null;
    };
  }, [sceneRef]);

  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    controls.update({ drag, wheel, invert, animate: animate === false ? false : animate, compositorPan });
  });

  return null;
}
