/**
 * GlyphcssOrbitControls — orbit controls for an ASCII GlyphcssScene.
 *
 * Mirrors PolyOrbitControls's props; wraps createGlyphcssOrbitControls from
 * the glyphcss package. Must be placed inside a <GlyphcssScene>.
 */
import { useEffect, useRef } from "react";
import type { GlyphcssOrbitControlsHandle, GlyphcssOrbitControlsOptions } from "glyphcss";
import { createGlyphcssOrbitControls } from "glyphcss";
import { useGlyphcssSceneContext } from "../scene/context";

export interface GlyphcssOrbitControlsProps {
  /** Pointer-drag. Default true. */
  drag?: boolean;
  /** Wheel / pinch zoom. Default true. */
  wheel?: boolean;
  /** Drag-direction inversion. Default false. */
  invert?: boolean | number;
  /** Auto-rotate config. Default false. */
  animate?: false | { speed?: number; axis?: "x" | "y"; pauseOnInteraction?: boolean };
}

export function GlyphcssOrbitControls({
  drag = true,
  wheel = true,
  invert = false,
  animate = false,
}: GlyphcssOrbitControlsProps): null {
  const { sceneRef } = useGlyphcssSceneContext();
  const controlsRef = useRef<GlyphcssOrbitControlsHandle | null>(null);

  const propsRef = useRef({ drag, wheel, invert, animate });
  propsRef.current = { drag, wheel, invert, animate };

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    const opts: GlyphcssOrbitControlsOptions = {
      drag: propsRef.current.drag,
      wheel: propsRef.current.wheel,
      invert: propsRef.current.invert,
      animate: propsRef.current.animate === false ? false : propsRef.current.animate,
    };
    const controls = createGlyphcssOrbitControls(scene, opts);
    controlsRef.current = controls;

    return () => {
      controls.destroy();
      controlsRef.current = null;
    };
  }, [sceneRef]);

  // Forward prop changes to live controls
  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    controls.update({ drag, wheel, invert, animate: animate === false ? false : animate });
  });

  return null;
}
