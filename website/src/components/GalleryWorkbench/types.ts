// Shared types for the gallery workbench. Keep this file lean — only the
// type declarations that flow between subfolders (presets/, helpers/, the
// component itself) live here. Component-internal types stay local.

import type { ObjParseOptions, GltfParseOptions, VoxParseOptions, Polygon, ParseAnimationController } from "@layoutit/polycss";

export type Renderer = "react" | "vanilla";
export type ModelKind = "obj" | "glb" | "gltf" | "vox";
export type GalleryBucket = "Solid" | "Textured" | "Animated" | "Voxel";
export type MatrixPrecision = "exact" | "2" | "3" | "4" | "5" | "6";
export type BorderShapePrecision = "exact" | "2" | "3" | "4" | "5" | "6";

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
  options?: ObjParseOptions | GltfParseOptions | VoxParseOptions;
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

export interface LoadedModel {
  label: string;
  kind: ModelKind;
  rawPolygons: Polygon[];
  polygons: Polygon[];
  sourcePolygons: number;
  sourceBytes: number;
  warnings: string[];
  parseMs: number;
  dispose: () => void;
  animation?: ParseAnimationController;
}

export interface ParserOptionsState {
  targetSize: number;
  gridShift: number;
  defaultColor: string;
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
  options?: ObjParseOptions;
}
