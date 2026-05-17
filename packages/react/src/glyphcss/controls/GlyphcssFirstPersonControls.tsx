/**
 * GlyphcssFirstPersonControls — first-person controls for an ASCII GlyphcssScene.
 * Pointer-drag looks around; WASD / arrow keys move.
 */
import { useEffect, useRef } from "react";
import type { GlyphcssFirstPersonControlsHandle, GlyphcssFirstPersonControlsOptions } from "glyphcss";
import { createGlyphcssFirstPersonControls } from "glyphcss";
import { useGlyphcssSceneContext } from "../scene/context";

export interface GlyphcssFirstPersonControlsProps {
  drag?: boolean;
  keyboard?: boolean;
  moveSpeed?: number;
  lookSpeed?: number;
  invert?: boolean | number;
}

export function GlyphcssFirstPersonControls({
  drag = true,
  keyboard = true,
  moveSpeed = 0.05,
  lookSpeed = 0.004,
  invert = false,
}: GlyphcssFirstPersonControlsProps): null {
  const { sceneRef } = useGlyphcssSceneContext();
  const controlsRef = useRef<GlyphcssFirstPersonControlsHandle | null>(null);
  const propsRef = useRef({ drag, keyboard, moveSpeed, lookSpeed, invert });
  propsRef.current = { drag, keyboard, moveSpeed, lookSpeed, invert };

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const opts: GlyphcssFirstPersonControlsOptions = {
      drag: propsRef.current.drag,
      keyboard: propsRef.current.keyboard,
      moveSpeed: propsRef.current.moveSpeed,
      lookSpeed: propsRef.current.lookSpeed,
      invert: propsRef.current.invert,
    };
    const controls = createGlyphcssFirstPersonControls(scene, opts);
    controlsRef.current = controls;
    return () => {
      controls.destroy();
      controlsRef.current = null;
    };
  }, [sceneRef]);

  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    controls.update({ drag, keyboard, moveSpeed, lookSpeed, invert });
  });

  return null;
}
