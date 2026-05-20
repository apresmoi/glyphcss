import type { GlyphDirectionalLight, GlyphAmbientLight } from "glyphcss";
import type { SceneOptionsState } from "../types";

export function directionalFromOptions(options: SceneOptionsState): GlyphDirectionalLight {
  const az = (options.lightAzimuth * Math.PI) / 180;
  const el = (options.lightElevation * Math.PI) / 180;
  const cosEl = Math.cos(el);
  return {
    direction: [
      cosEl * Math.sin(az),
      cosEl * Math.cos(az),
      Math.sin(el),
    ],
    intensity: options.lightIntensity,
  };
}

export function ambientFromOptions(options: SceneOptionsState): GlyphAmbientLight {
  return {
    intensity: options.ambientIntensity,
  };
}
