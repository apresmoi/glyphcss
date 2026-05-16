import type {
  MeshResolution,
  PolyRenderStrategy,
  PolyTextureLightingMode,
  Vec3 as ReactVec3,
} from "@layoutit/polycss-react";
import type { TextureQuality } from "@layoutit/polycss";

// Shared types used by GalleryWorkbench and scene components.

export type GizmoMode = "translate" | "rotate";

export type DragMode = "orbit" | "pan" | "fpv";

export type PerspectiveMode = "perspective" | "orthographic";

export interface DomMetrics {
  measuredAt: number;
  nodeCount: number;
  sprites: number;
  rects: number;
  triangles: number;
  irregular: number;
  overpaintPercent: number;
}

export interface SceneOptionsState {
  renderer: "react" | "vanilla";
  animationPaused: boolean;
  animationTimeScale: number;
  autoCenter: boolean;
  interactive: boolean;
  animate: boolean;
  showAxes: boolean;
  selection: boolean;
  hoverEffects: boolean;
  showLight: boolean;
  zoom: number;
  rotX: number;
  rotY: number;
  perspective: number | false;
  lightAzimuth: number;
  lightElevation: number;
  lightIntensity: number;
  lightColor: string;
  ambientIntensity: number;
  ambientColor: string;
  textureLighting: PolyTextureLightingMode;
  textureQuality: TextureQuality;
  solidMaterials: boolean;
  matrixPrecision: "exact" | "2" | "3" | "4" | "5" | "6";
  borderShapePrecision: "exact" | "2" | "3" | "4" | "5" | "6";
  meshResolution: MeshResolution;
  meshInteriorFill: boolean;
  outlinePolygons: boolean;
  dragMode: "orbit" | "pan" | "fpv";
  target: ReactVec3;
  disableStrategies: PolyRenderStrategy[];
  castShadow: boolean;
  showGround: boolean;
  fpvLook: boolean;
  fpvMove: boolean;
  fpvJump: boolean;
  fpvCrouch: boolean;
  fpvMoveSpeed: number;
  fpvJumpVelocity: number;
  fpvGravity: number;
  fpvEyeHeight: number;
  fpvCrouchHeight: number;
  fpvLookSensitivity: number;
  fpvInvertY: boolean;
}
