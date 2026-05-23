/**
 * Lighting folder — directional key-light (azimuth / elevation / intensity /
 * color) and ambient (intensity / color).
 */
import type { GUI } from "lil-gui";
import type { SceneOptionsState } from "../../GalleryWorkbench/types";
import { useColor, useFolder, useSlider } from "../primitives";

export interface LightingFolderInputs {
  lightAzimuth: number;
  lightElevation: number;
  lightIntensity: number;
  lightColor: string;
  ambientIntensity: number;
  ambientColor: string;
  onUpdateScene: (partial: Partial<Pick<SceneOptionsState,
    | "lightAzimuth"
    | "lightElevation"
    | "lightIntensity"
    | "lightColor"
    | "ambientIntensity"
    | "ambientColor"
  >>) => void;
}

export function useLightingFolder(parent: GUI | null, inputs: LightingFolderInputs): void {
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

  useSlider(folder, "Azimuth", { min: 0, max: 360, step: 1 }, lightAzimuth, (value) =>
    onUpdateScene({ lightAzimuth: value }),
  );
  useSlider(folder, "Elev.", { min: -90, max: 90, step: 1 }, lightElevation, (value) =>
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
}
