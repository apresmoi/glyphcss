/**
 * Animation folder — sequence picker, pause toggle, and playback speed.
 *
 * The folder is hidden when the loaded mesh has no animation clips, and the
 * sequence dropdown's option list refreshes at runtime on model swap. A stale
 * `selectedAnimation` that no longer exists in the new list triggers
 * `onSelectAnimationClear` so the parent can reset cleanly.
 */
import { useEffect, useRef } from "react";
import type { GUI } from "lil-gui";
import { useFolder, useOption, useSlider, useToggle } from "../primitives";
import type { SceneOptionsState } from "../../GalleryWorkbench/types";

export interface AnimationFolderInputs {
  selectedAnimation: string;
  animationOptions: Record<string, string>;
  animationPaused: boolean;
  animationTimeScale: number;
  animationClipCount: number;
  onAnimationChange: (value: string) => void;
  onSelectAnimationClear: () => void;
  onUpdateScene: (partial: Partial<Pick<SceneOptionsState, "animationPaused" | "animationTimeScale">>) => void;
}

export function useAnimationFolder(parent: GUI | null, inputs: AnimationFolderInputs): void {
  const {
    selectedAnimation,
    animationOptions,
    animationPaused,
    animationTimeScale,
    animationClipCount,
    onAnimationChange,
    onSelectAnimationClear,
    onUpdateScene,
  } = inputs;

  const folder = useFolder(parent, "Animation", { open: true });

  const sequenceController = useOption<string>(
    folder,
    "Sequence",
    animationOptions,
    selectedAnimation,
    (value) => onAnimationChange(value),
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

  // Refresh dropdown when the model changes and re-validate the selected value.
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
