import { useEffect, useRef } from "react";
import type { DragMode, SceneOptionsState } from "../../types";

export interface UseCameraShortcutsOptions {
  dragMode: DragMode;
  updateScene: (partial: Partial<SceneOptionsState>) => void;
}

// Hold Cmd (Mac) / Win (Windows) to temporarily switch from orbit → pan.
// Mirrors the three.js editor convention. Original mode is restored on
// key-up, on window blur, and on Escape so the hold can't get stuck.
// FPV mode is left alone — Cmd inside FPV would conflict with browser
// shortcuts the user might actually want there.
export function useCameraShortcuts({ dragMode, updateScene }: UseCameraShortcutsOptions): void {
  const dragModeRef = useRef(dragMode);
  dragModeRef.current = dragMode;

  useEffect(() => {
    let resumeMode: DragMode | null = null;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Meta" || e.repeat) return;
      if (resumeMode !== null) return;
      if (dragModeRef.current !== "orbit") return;
      resumeMode = "orbit";
      updateScene({ dragMode: "pan" });
    };
    const restore = () => {
      if (resumeMode === null) return;
      updateScene({ dragMode: resumeMode });
      resumeMode = null;
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Meta") restore();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", restore);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", restore);
    };
  }, [updateScene]);
}
