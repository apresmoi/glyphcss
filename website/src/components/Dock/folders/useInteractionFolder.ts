/**
 * Interaction folder for the Dock: scene-level pointer flags + gizmo mode.
 *
 * Extracted from the monolithic `Dock.tsx` so callers that don't want the
 * folder simply omit this hook (no `hideInteractionFolder` flag required).
 */
import { useEffect } from "react";
import type { GUI } from "lil-gui";

import { useFolder, useOption, useToggle } from "../primitives";
import type { GizmoMode } from "../../types";

export interface InteractionFolderInputs {
  interactive: boolean;
  hoverEffects: boolean;
  selection: boolean;
  gizmoMode: GizmoMode;
  onUpdateScene: (partial: {
    interactive?: boolean;
    hoverEffects?: boolean;
    selection?: boolean;
  }) => void;
  onGizmoModeChange: (mode: GizmoMode) => void;
}

const GIZMO_OPTIONS: Record<string, GizmoMode> = { translate: "translate", rotate: "rotate" };

export function useInteractionFolder(parent: GUI | null, inputs: InteractionFolderInputs): void {
  const folder = useFolder(parent, "Interaction");

  useToggle(folder, "Scene interactive", inputs.interactive, (value) =>
    inputs.onUpdateScene({ interactive: value }),
  );
  useToggle(folder, "Mesh hover", inputs.hoverEffects, (value) =>
    inputs.onUpdateScene({ hoverEffects: value }),
  );
  useToggle(folder, "Mesh selection", inputs.selection, (value) =>
    inputs.onUpdateScene({ selection: value }),
  );
  const gizmo = useOption<GizmoMode>(folder, "Gizmo", GIZMO_OPTIONS, inputs.gizmoMode, (value) =>
    inputs.onGizmoModeChange(value),
  );

  // Gizmo is meaningless without selection — dim it when selection is off.
  useEffect(() => {
    if (gizmo) gizmo.setEnabled(inputs.selection);
  }, [gizmo, inputs.selection]);
}
