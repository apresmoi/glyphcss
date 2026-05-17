/**
 * Floating "what does the click target?" toggle — sits next to the
 * tool palette at the top of the viewport. Vertex picks individual
 * grid intersections (raise warps 4 cells into a tent); Face picks
 * whole cells (raise pushes all 4 corners up so the cell becomes a
 * flat plateau).
 */
import type { TargetMode } from "../types";

export interface BuilderTargetModeProps {
  targetMode: TargetMode;
  onChange: (mode: TargetMode) => void;
}

export function BuilderTargetMode({ targetMode, onChange }: BuilderTargetModeProps) {
  return (
    <div className="builder-target-mode" role="group" aria-label="Target mode">
      <button
        type="button"
        className={`builder-target-mode__btn${targetMode === "vertex" ? " is-active" : ""}`}
        onClick={() => onChange("vertex")}
        title="Click affects the nearest grid vertex"
      >
        ⊙ Vertex
      </button>
      <button
        type="button"
        className={`builder-target-mode__btn${targetMode === "face" ? " is-active" : ""}`}
        onClick={() => onChange("face")}
        title="Click affects the whole cell under the cursor"
      >
        ▣ Face
      </button>
    </div>
  );
}
