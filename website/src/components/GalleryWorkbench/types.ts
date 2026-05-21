// Shared types for the gallery workbench. Keep this file lean — only the
// type declarations that flow between subfolders (presets/, helpers/, the
// component itself) live here. Component-internal types stay local.

export type ModelKind = "obj" | "glb" | "gltf" | "vox";
export type GalleryBucket = "Solid" | "Textured" | "Animated" | "Voxel";
export type PerspectiveMode = "perspective" | "orthographic";
export type DragMode = "orbit" | "pan" | "fpv";

export interface ModelAttribution {
  creator: string;
  license?: string;
  sourceUrl?: string;
  tris?: number;
}

export interface PresetModel {
  id: string;
  label: string;
  kind: ModelKind;
  category: string;
  url: string;
  mtlUrl?: string;
  zoom?: number;
  rotX?: number;
  rotY?: number;
  galleryBucket?: GalleryBucket;
  attribution?: ModelAttribution;
}

export interface DroppedModelSource {
  id: string;
  label: string;
  kind: Exclude<ModelKind, "gltf">;
  primaryFile: File;
  files: File[];
  preset: PresetModel;
}

export interface GalleryPresetFile {
  file: string;
  label?: string;
  category: string;
  targetSize?: number;
  zoom?: number;
  rotX?: number;
  rotY?: number;
  galleryBucket?: GalleryBucket;
  attribution?: ModelAttribution;
}

export interface ObjGalleryPresetFile extends GalleryPresetFile {
  mtlFile?: string | null;
  defaultColor?: string;
}

export interface GlyphMetrics {
  measuredAt: number;
  cells: number;
  edges: number;
  triangles: number;
  vertices: number;
  frames: number;
  bakeMs: number;
}

export interface SceneOptionsState {
  animationPaused: boolean;
  animationTimeScale: number;
  autoCenter: boolean;
  interactive: boolean;
  showAxes: boolean;
  showLight: boolean;
  showGround: boolean;
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
  target: [number, number, number];
  renderMode: "wireframe" | "solid";
  featureEdges: number;
  glyphPalette: "default" | "ascii" | "dots" | "lines" | "blocks" | "stars" | "arrows" | "braille" | "runes" | "math" | "binary" | "hex";
  lineHeight: number;
  useColors: boolean;
  smoothShading: boolean;
  creaseAngle: number;
  backfaceCull: boolean;
  dragMode: DragMode;
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
