import type { PolyDirectionalLight, PolyAmbientLight } from "@layoutit/polycss";
import type { SceneOptionsState } from "../../types";

export function directionalFromOptions(options: SceneOptionsState): PolyDirectionalLight {
  const az = (options.lightAzimuth * Math.PI) / 180;
  const el = (options.lightElevation * Math.PI) / 180;
  const cosEl = Math.cos(el);
  return {
    direction: [
      cosEl * Math.sin(az),
      cosEl * Math.cos(az),
      Math.sin(el),
    ],
    color: options.lightColor,
    intensity: options.lightIntensity,
  };
}

export function ambientFromOptions(options: SceneOptionsState): PolyAmbientLight {
  return {
    color: options.ambientColor,
    intensity: options.ambientIntensity,
  };
}
