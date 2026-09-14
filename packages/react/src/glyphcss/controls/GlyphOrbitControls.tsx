/**
 * GlyphOrbitControls — orbit controls for an ASCII GlyphScene.
 *
 * Mirrors PolyOrbitControls's props; wraps createGlyphOrbitControls from
 * the glyphcss package. Must be placed inside a <GlyphScene>.
 */
import { useEffect, useRef } from "react";
import type { GlyphOrbitControlsHandle, GlyphOrbitControlsMode, GlyphOrbitControlsOptions } from "glyphcss";
import { createGlyphOrbitControls } from "glyphcss";
import { useGlyphSceneContext } from "../scene/context";

export interface GlyphOrbitControlsProps {
  /** Pointer-drag. Default true. */
  drag?: boolean;
  /** Wheel / pinch zoom. Default true. */
  wheel?: boolean;
  /** Drag-direction inversion. Default false. */
  invert?: boolean | number;
  /**
   * Turntable-mode pitch clamp, `[min, max]` degrees, or `null` for
   * unrestricted tumbling (views from below the equator included; the
   * up-vector never rolls). Default `[-90, 90]`. No-op in `"trackball"` mode.
   */
  pitchRange?: [number, number] | null;
  /**
   * `"turntable"` (default) — Euler orbit, up-vector locked. `"trackball"` —
   * free rotation about the screen axis perpendicular to the drag, reaching
   * any orientation including roll; a two-finger twist rolls.
   */
  mode?: GlyphOrbitControlsMode;
  /** Auto-rotate config. Default false. */
  animate?: false | { speed?: number; axis?: "x" | "y"; pauseOnInteraction?: boolean };
}

export function GlyphOrbitControls({
  drag = true,
  wheel = true,
  invert = false,
  pitchRange = [-90, 90],
  mode = "turntable",
  animate = false,
}: GlyphOrbitControlsProps): null {
  const { sceneRef } = useGlyphSceneContext();
  const controlsRef = useRef<GlyphOrbitControlsHandle | null>(null);

  const propsRef = useRef({ drag, wheel, invert, pitchRange, mode, animate });
  propsRef.current = { drag, wheel, invert, pitchRange, mode, animate };

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    const opts: GlyphOrbitControlsOptions = {
      drag: propsRef.current.drag,
      wheel: propsRef.current.wheel,
      invert: propsRef.current.invert,
      pitchRange: propsRef.current.pitchRange,
      mode: propsRef.current.mode,
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
    controls.update({ drag, wheel, invert, pitchRange, mode, animate: animate === false ? false : animate });
  });

  return null;
}
