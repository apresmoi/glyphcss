import type { GalleryPresetFile, ObjGalleryPresetFile, PresetModel } from "../types";
import { GLB_PRESET_ATTRIBUTIONS } from "./attributions";

export function galleryFileUrl(folder: "glb" | "obj" | "vox", file: string): string {
  return `/gallery/${folder}/${file.split("/").map(encodeURIComponent).join("/")}`;
}

export function presetIdFromFile(prefix: string, file: string): string {
  return `${prefix}-${file
    .replace(/\.[^.]+$/, "")
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()}`;
}

export function labelFromFile(file: string): string {
  const base = file
    .split("/")
    .pop()!
    .replace(/\.[^.]+$/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ");
  return base
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function glbPreset(input: GalleryPresetFile): PresetModel {
  return {
    id: presetIdFromFile("glb", input.file),
    label: input.label ?? labelFromFile(input.file),
    category: input.category,
    kind: "glb",
    url: galleryFileUrl("glb", input.file),
    zoom: input.zoom ?? 0.4,
    rotX: input.rotX ?? 65,
    rotY: input.rotY ?? 45,
    galleryBucket: input.galleryBucket,
    attribution: input.attribution ?? GLB_PRESET_ATTRIBUTIONS[input.file],
  };
}

export function objPreset(input: ObjGalleryPresetFile): PresetModel {
  const inferredMtlFile = input.file.replace(/\.obj$/i, ".mtl");
  const mtlFile = input.mtlFile === null ? undefined : input.mtlFile ?? inferredMtlFile;
  return {
    id: presetIdFromFile("obj", input.file),
    label: input.label ?? labelFromFile(input.file),
    category: input.category,
    kind: "obj",
    url: galleryFileUrl("obj", input.file),
    mtlUrl: mtlFile ? galleryFileUrl("obj", mtlFile) : undefined,
    zoom: input.zoom ?? 0.35,
    rotX: input.rotX ?? 65,
    rotY: input.rotY ?? 45,
    galleryBucket: input.galleryBucket,
    attribution: input.attribution,
  };
}

export function voxPreset(input: GalleryPresetFile): PresetModel {
  return {
    id: presetIdFromFile("vox", input.file),
    label: input.label ?? labelFromFile(input.file),
    category: input.category,
    kind: "vox",
    url: galleryFileUrl("vox", input.file),
    zoom: input.zoom ?? 0.4,
    rotX: input.rotX ?? 65,
    rotY: input.rotY ?? 45,
    galleryBucket: input.galleryBucket,
    attribution: input.attribution,
  };
}

export function stripParenthesizedText(label: string): string {
  return label.replace(/\s*\((?:GLB|UV-mapped|[^)]*\.(?:glb|gltf|obj|vox)[^)]*)\)/gi, "").trim();
}
