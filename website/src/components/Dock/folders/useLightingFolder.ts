/**
 * Lighting folder — directional key-light (azimuth / elevation / intensity /
 * color) and ambient (intensity / color).
 */
import type { GUI } from "lil-gui";
import type { SceneOptionsState } from "../../GalleryWorkbench/types";
import { useEffect } from "react";
import { useColor, useFolder, useSlider } from "../primitives";

export interface LightingFolderInputs {
  lightAzimuth: number;
  lightElevation: number;
  lightIntensity: number;
  lightColor: string;
  ambientIntensity: number;
  ambientColor: string;
  /**
   * Dim + disable Azimuth/Elev because something else owns the key light's
   * DIRECTION this frame (/maps' real-sun lighting on a globe is the
   * reference consumer — see `MapsWorkbench`). Default `false`. Opt-in and
   * additive, the same "each removal is an opt-out prop defaulting to
   * today's behaviour" convention `RenderingFolderInputs` already uses for
   * this shared folder.
   */
  directionLocked?: boolean;
  /** Tooltip explaining WHY the direction rows are locked. Ignored unless `directionLocked`. */
  directionLockedReason?: string;
  onUpdateScene: (partial: Partial<Pick<SceneOptionsState,
    | "lightAzimuth"
    | "lightElevation"
    | "lightIntensity"
    | "lightColor"
    | "ambientIntensity"
    | "ambientColor"
  >>) => void;
}

export function useLightingFolder(parent: GUI | null, inputs: LightingFolderInputs): GUI | null {
  const {
    lightAzimuth,
    lightElevation,
    lightIntensity,
    lightColor,
    ambientIntensity,
    ambientColor,
    onUpdateScene,
  } = inputs;

  const folder = useFolder(parent, "Lighting", { open: true });

  const azimuth = useSlider(folder, "Azimuth", { min: 0, max: 360, step: 1 }, lightAzimuth, (value) =>
    onUpdateScene({ lightAzimuth: value }),
  );
  const elevation = useSlider(folder, "Elev.", { min: -90, max: 90, step: 1 }, lightElevation, (value) =>
    onUpdateScene({ lightElevation: value }),
  );
  useSlider(folder, "Key", { min: 0, max: 2, step: 0.05 }, lightIntensity, (value) =>
    onUpdateScene({ lightIntensity: value }),
  );
  useColor(folder, "Key color", lightColor, (value) => onUpdateScene({ lightColor: value }));
  useSlider(folder, "Ambient", { min: 0, max: 2, step: 0.05 }, ambientIntensity, (value) =>
    onUpdateScene({ ambientIntensity: value }),
  );
  useColor(folder, "Amb. color", ambientColor, (value) => onUpdateScene({ ambientColor: value }));

  // Dimmed rather than hidden: the direction is still a real, restored value
  // the moment whatever took it over lets go, so removing the rows would
  // read as "this scene has no key light" instead of "something else is
  // aiming it".
  const locked = inputs.directionLocked ?? false;
  const reason = inputs.directionLockedReason;
  useEffect(() => {
    for (const ctrl of [azimuth, elevation]) {
      if (!ctrl) continue;
      ctrl.setEnabled(!locked);
      ctrl.raw.domElement.title = locked && reason ? reason : "";
    }
  }, [azimuth, elevation, locked, reason]);

  return folder;
}
