import type { SceneOptionsState } from "../types";

export const BUILDER_KIT_CATEGORIES: string[] = ["City Kit", "Urban Pack", "Medieval Village"];

export const PARSER_DEFAULTS = { targetSize: 60, gridShift: 1, defaultColor: "#8b95a1" };
export const NORMALIZED_MAX_DIM = 8;
export const GRID_STEP = 10;
export const GRID_COLS = 3;

// Builder starts with the same scene defaults as the gallery's chicken preset
// so the camera / lighting / strategies feel familiar to anyone coming from
// /gallery. The fields the builder doesn't currently use (selection/hover/
// animation/etc.) still have to be present because the Dock reads them.
export const DEFAULT_SCENE: SceneOptionsState = {
  renderer: "react",
  animationPaused: false,
  animationTimeScale: 1,
  autoCenter: true,
  interactive: true,
  animate: false,
  showAxes: true,
  // Selection is always on in the builder — picking a placed mesh is core
  // to its workflow. The Interaction folder is hidden in this surface so
  // there's no toggle to flip this off.
  selection: true,
  hoverEffects: false,
  showLight: false,
  zoom: 0.3,
  rotX: 65,
  rotY: 45,
  perspective: false,
  lightAzimuth: 50,
  lightElevation: 45,
  lightIntensity: 1,
  lightColor: "#ffffff",
  ambientIntensity: 0.4,
  ambientColor: "#ffffff",
  textureLighting: "baked",
  textureQuality: "auto",
  solidMaterials: false,
  matrixPrecision: "exact",
  borderShapePrecision: "exact",
  meshResolution: "lossy",
  meshInteriorFill: false,
  outlinePolygons: false,
  dragMode: "orbit",
  target: [0, 0, 0],
  disableStrategies: [],
  castShadow: false,
  showGround: true,
  fpvLook: true,
  fpvMove: true,
  fpvJump: true,
  fpvCrouch: true,
  fpvMoveSpeed: 30,
  fpvJumpVelocity: 25,
  fpvGravity: 60,
  fpvEyeHeight: 6,
  fpvCrouchHeight: 3,
  fpvLookSensitivity: 0.15,
  fpvInvertY: false,
  fpvRenderDistance: 40,
  snapToGrid: true,
  gridResolution: 5,
};
