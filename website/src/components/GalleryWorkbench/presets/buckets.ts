import type { GalleryBucket, PresetModel } from "../types";

export const GALLERY_BUCKET_ORDER: GalleryBucket[] = ["Solid", "Textured", "Animated", "Voxel"];

export const ANIMATED_PRESET_IDS = new Set([
  "glb-poly-pizza-cow",
  "glb-poly-pizza-llama",
  "glb-poly-pizza-man",
  "glb-poly-pizza-pug",
  "glb-poly-pizza-rabbit-blond",
  "glb-poly-pizza-sheep",
]);

export function isAnimatedPreset(preset: Pick<PresetModel, "label" | "id" | "category" | "url">): boolean {
  return (
    ANIMATED_PRESET_IDS.has(preset.id) ||
    preset.category === "Animated" ||
    /animated/i.test(preset.label) ||
    /animated/i.test(preset.id)
  );
}

export function galleryBucketForPreset(preset: PresetModel): GalleryBucket {
  if (isAnimatedPreset(preset)) return "Animated";
  if (preset.kind === "vox") return "Voxel";
  return preset.galleryBucket ?? "Solid";
}

export function galleryBucketRank(category: string): number {
  const index = GALLERY_BUCKET_ORDER.indexOf(category as GalleryBucket);
  return index === -1 ? GALLERY_BUCKET_ORDER.length : index;
}
