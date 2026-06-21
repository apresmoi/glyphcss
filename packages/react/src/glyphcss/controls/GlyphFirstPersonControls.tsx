/**
 * GlyphFirstPersonControls — first-person controls for an ASCII GlyphScene.
 * Pointer-lock mouselook, WASD/arrow planar move, Space jump, Ctrl crouch.
 * Mirrors voxcss PolyFirstPersonControls.
 */
import { useEffect, useRef } from "react";
import type { GlyphFirstPersonControlsHandle, GlyphFirstPersonControlsOptions } from "glyphcss";
import { createGlyphFirstPersonControls } from "glyphcss";
import { useGlyphSceneContext } from "../scene/context";

export interface GlyphFirstPersonControlsProps {
  enabled?: boolean;
  lookEnabled?: boolean;
  moveEnabled?: boolean;
  jumpEnabled?: boolean;
  crouchEnabled?: boolean;
  lookSensitivity?: number;
  invertY?: boolean;
  moveSpeed?: number;
  jumpVelocity?: number;
  gravity?: number;
  eyeHeight?: number;
  crouchHeight?: number;
  groundZ?: number;
  minPitch?: number;
  maxPitch?: number;
}

export function GlyphFirstPersonControls(props: GlyphFirstPersonControlsProps): null {
  const { sceneRef } = useGlyphSceneContext();
  const controlsRef = useRef<GlyphFirstPersonControlsHandle | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const controls = createGlyphFirstPersonControls(scene, propsRef.current as GlyphFirstPersonControlsOptions);
    controlsRef.current = controls;
    return () => {
      controls.destroy();
      controlsRef.current = null;
    };
  }, [sceneRef]);

  useEffect(() => {
    controlsRef.current?.update(props as GlyphFirstPersonControlsOptions);
  });

  return null;
}
