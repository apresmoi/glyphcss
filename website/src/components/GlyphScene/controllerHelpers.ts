import type { LoadMeshOptions } from "@glyphcss/core";
import type { PresetModel } from "../../features/gallery/model/types";

export const POLL_INTERVAL_MS = 500;

const GALLERY_ZOOM_COMPAT = 50;

export function toRuntimeZoom(galleryZoom: number): number {
  return galleryZoom * GALLERY_ZOOM_COMPAT;
}

export function fromRuntimeZoom(runtimeZoom: number): number {
  return runtimeZoom / GALLERY_ZOOM_COMPAT;
}

export function dragDensityToDownscale(dragDensity: number): number {
  if (!Number.isFinite(dragDensity)) return 2;
  return 1 / Math.min(Math.max(dragDensity, 0.1), 1);
}

export function loadOptionsForPreset(preset: PresetModel | undefined): LoadMeshOptions | undefined {
  if (!preset || preset.kind === "primitive" || !preset.options) return undefined;
  if (preset.kind === "obj") return { objOptions: preset.options as LoadMeshOptions["objOptions"] };
  if (preset.kind === "glb" || preset.kind === "gltf")
    return { gltfOptions: preset.options as LoadMeshOptions["gltfOptions"] };
  if (preset.kind === "vox") return { voxOptions: preset.options as LoadMeshOptions["voxOptions"] };
  if (preset.kind === "stl") return { stlOptions: preset.options as LoadMeshOptions["stlOptions"] };
  return undefined;
}

export function htmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
