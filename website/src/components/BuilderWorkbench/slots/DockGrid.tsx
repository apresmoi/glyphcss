/**
 * Builder-only Dock slot for the floor-grid + snap-to-grid controls.
 *
 * Mirrors the slot-component pattern used by DockScene / DockModel etc.:
 * picks up the lil-gui parent from `useDockGui()`, then creates a
 * "Grid" folder with three controls (show / snap / resolution). Lives
 * in BuilderWorkbench because the grid is a builder-specific concern —
 * gallery has no placement workflow and doesn't need this folder.
 */
import { useDockGui, useFolder, useToggle, useSlider } from "../../Dock";

export interface DockGridInputs {
  showGround: boolean;
  snapToGrid: boolean;
  gridResolution: number;
  onUpdateScene: (partial: {
    showGround?: boolean;
    snapToGrid?: boolean;
    gridResolution?: number;
  }) => void;
}

export function DockGrid(inputs: DockGridInputs): null {
  const folder = useFolder(useDockGui(), "Grid");
  useToggle(folder, "Show grid", inputs.showGround, (value) =>
    inputs.onUpdateScene({ showGround: value }),
  );
  useToggle(folder, "Snap to grid", inputs.snapToGrid, (value) =>
    inputs.onUpdateScene({ snapToGrid: value }),
  );
  useSlider(
    folder,
    "Grid size",
    { min: 1, max: 25, step: 0.5 },
    inputs.gridResolution,
    (value) => inputs.onUpdateScene({ gridResolution: value }),
  );
  return null;
}
