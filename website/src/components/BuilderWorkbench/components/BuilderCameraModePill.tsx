import type { DragMode, SceneOptionsState } from "../../types";

export interface BuilderCameraModePillProps {
  dragMode: DragMode;
  updateScene: (partial: Partial<SceneOptionsState>) => void;
}

export function BuilderCameraModePill({ dragMode, updateScene }: BuilderCameraModePillProps) {
  if (dragMode === "fpv") return null;
  return (
    <div className="builder-camera-mode" role="group" aria-label="Camera mode">
      <button
        type="button"
        className={`builder-camera-mode__btn${dragMode === "orbit" ? " is-active" : ""}`}
        onClick={() => updateScene({ dragMode: "orbit" })}
      >Orbit</button>
      <button
        type="button"
        className={`builder-camera-mode__btn${dragMode === "pan" ? " is-active" : ""}`}
        onClick={() => updateScene({ dragMode: "pan" })}
      >Pan</button>
      <span className="builder-camera-mode__hint">⌘ to pan</span>
    </div>
  );
}
