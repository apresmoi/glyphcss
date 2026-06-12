import type { GlyphDirectionalLight, GlyphAmbientLight } from "glyphcss";
import type { SceneOptionsState } from "../types";

export function directionalFromOptions(options: SceneOptionsState): GlyphDirectionalLight {
  const az = (options.lightAzimuth * Math.PI) / 180;
  const el = (options.lightElevation * Math.PI) / 180;
  const cosEl = Math.cos(el);
  // `direction` = "shines TOWARD" (three.js convention): negate the
  // subsolar unit vector so the vector points away from the sun toward
  // the scene. Lambert = max(0, -dot(n, dir)).
  return {
    direction: [
      -cosEl * Math.sin(az),
      -cosEl * Math.cos(az),
      -Math.sin(el),
    ],
    intensity: options.lightIntensity,
  };
}

export function ambientFromOptions(options: SceneOptionsState): GlyphAmbientLight {
  return {
    intensity: options.ambientIntensity,
  };
}
