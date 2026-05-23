/**
 * GlyphFirstPersonControls — first-person controls for an ASCII GlyphScene.
 * Pointer-drag looks around; WASD / arrow keys move.
 */
import { useEffect, useRef } from "react";
import type { GlyphFirstPersonControlsHandle, GlyphFirstPersonControlsOptions } from "glyphcss";
import { createGlyphFirstPersonControls } from "glyphcss";
import { useGlyphSceneContext } from "../scene/context";

export interface GlyphFirstPersonControlsProps {
  drag?: boolean;
  keyboard?: boolean;
  moveSpeed?: number;
  lookSpeed?: number;
  invert?: boolean | number;
}

export function GlyphFirstPersonControls({
  drag = true,
  keyboard = true,
  moveSpeed = 0.05,
  lookSpeed = 0.004,
  invert = false,
}: GlyphFirstPersonControlsProps): null {
  const { sceneRef } = useGlyphSceneContext();
  const controlsRef = useRef<GlyphFirstPersonControlsHandle | null>(null);
  const propsRef = useRef({ drag, keyboard, moveSpeed, lookSpeed, invert });
  propsRef.current = { drag, keyboard, moveSpeed, lookSpeed, invert };

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const opts: GlyphFirstPersonControlsOptions = {
      drag: propsRef.current.drag,
      keyboard: propsRef.current.keyboard,
      moveSpeed: propsRef.current.moveSpeed,
      lookSpeed: propsRef.current.lookSpeed,
      invert: propsRef.current.invert,
    };
    const controls = createGlyphFirstPersonControls(scene, opts);
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
