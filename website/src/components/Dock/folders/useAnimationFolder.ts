/**
 * Animation folder — extracted from the legacy Dock.tsx mega-effect.
 *
 * Owns three controllers (Sequence / Paused / Playback speed) plus the folder
 * shell itself. When the model has no animation clips the whole folder is
 * hidden via lil-gui's `.hide()` and the three controllers are dimmed so any
 * direct DOM access doesn't fire stale onChange callbacks. The Sequence
 * dropdown's option list is refreshed at runtime whenever `animationOptions`
 * changes reference (model swap), and the current `selectedAnimation` is
 * re-validated against the new list — if it's missing we ask the parent to
 * clear it.
 */
import { useEffect, useRef } from "react";
import type { GUI } from "lil-gui";
import { useFolder, useOption, useSlider, useToggle } from "../primitives";

export interface AnimationFolderInputs {
  selectedAnimation: string;
  animationOptions: Record<string, string>;
  animationPaused: boolean;
  animationTimeScale: number;
  animationClipCount: number;
  onAnimationChange: (value: string) => void;
  onResetAnimatedPolygons: () => void;
  onSelectAnimationClear: () => void;
  onUpdateScene: (partial: { animationPaused?: boolean; animationTimeScale?: number }) => void;
}

export function useAnimationFolder(parent: GUI | null, inputs: AnimationFolderInputs): void {
  const {
    selectedAnimation,
    animationOptions,
    animationPaused,
    animationTimeScale,
    animationClipCount,
    onAnimationChange,
    onResetAnimatedPolygons,
    onSelectAnimationClear,
    onUpdateScene,
  } = inputs;

  const folder = useFolder(parent, "Animation");

  const sequenceController = useOption<string>(
    folder,
    "Sequence",
    animationOptions,
    selectedAnimation,
    (value) => {
      onAnimationChange(value);
      onResetAnimatedPolygons();
    },
  );

  const pausedController = useToggle(
    folder,
    "Paused",
    animationPaused,
    (value) => onUpdateScene({ animationPaused: value }),
  );

  const speedController = useSlider(
    folder,
    "Playback speed",
    { min: -3, max: 3, step: 0.05 },
    animationTimeScale,
    (value) => onUpdateScene({ animationTimeScale: value }),
  );

  // Refresh the dropdown options when the model changes. lil-gui's `options()`
  // call replaces the underlying controller; the primitive's `setOptions`
  // hides that swap. Re-validate `selectedAnimation` against the new list and
  // clear it upstream if it's gone — leaving a stale value in the dropdown
  // would let `onChange` fire with a key the model can no longer resolve.
  const prevOptionsRef = useRef(animationOptions);
  useEffect(() => {
    if (!sequenceController) return;
    if (prevOptionsRef.current === animationOptions) return;
    prevOptionsRef.current = animationOptions;
    sequenceController.setOptions(animationOptions);
    const valid = Object.values(animationOptions).includes(selectedAnimation);
    if (!valid) {
      sequenceController.setValue("");
      if (selectedAnimation !== "") onSelectAnimationClear();
    }
  }, [sequenceController, animationOptions, selectedAnimation, onSelectAnimationClear]);

  // Folder visibility + controller enabled state follow clip availability.
  // Hiding the folder also collapses the controllers visually, but we still
  // disable them so any programmatic access (or lil-gui internals) doesn't
  // route through dead controls.
  useEffect(() => {
    if (!folder) return;
    if (animationClipCount > 0) folder.show();
    else folder.hide();
  }, [folder, animationClipCount]);

  useEffect(() => {
    const enabled = animationClipCount > 0;
    sequenceController?.setEnabled(enabled, { dim: true });
    pausedController?.setEnabled(enabled, { dim: true });
    speedController?.setEnabled(enabled, { dim: true });
  }, [animationClipCount, sequenceController, pausedController, speedController]);
}
