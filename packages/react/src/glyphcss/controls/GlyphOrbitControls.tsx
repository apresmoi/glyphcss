/**
 * GlyphOrbitControls — orbit controls for an ASCII GlyphScene.
 *
 * Mirrors PolyOrbitControls's props; wraps createGlyphOrbitControls from
 * the glyphcss package. Must be placed inside a <GlyphScene>.
 */
import { useEffect, useRef } from "react";
import type { GlyphOrbitControlsHandle, GlyphOrbitControlsOptions } from "glyphcss";
import { createGlyphOrbitControls } from "glyphcss";
import { useGlyphSceneContext } from "../scene/context";

export interface GlyphOrbitControlsProps {
  /** Pointer-drag. Default true. */
  drag?: boolean;
  /** Wheel / pinch zoom. Default true. */
  wheel?: boolean;
  /** Drag-direction inversion. Default false. */
  invert?: boolean | number;
  /** Auto-rotate config. Default false. */
  animate?: false | { speed?: number; axis?: "x" | "y"; pauseOnInteraction?: boolean };
}

export function GlyphOrbitControls({
  drag = true,
  wheel = true,
  invert = false,
  animate = false,
}: GlyphOrbitControlsProps): null {
  const { sceneRef } = useGlyphSceneContext();
  const controlsRef = useRef<GlyphOrbitControlsHandle | null>(null);

  const propsRef = useRef({ drag, wheel, invert, animate });
  propsRef.current = { drag, wheel, invert, animate };

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    const opts: GlyphOrbitControlsOptions = {
      drag: propsRef.current.drag,
      wheel: propsRef.current.wheel,
      invert: propsRef.current.invert,
      animate: propsRef.current.animate === false ? false : propsRef.current.animate,
    };
    const controls = createGlyphOrbitControls(scene, opts);
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
