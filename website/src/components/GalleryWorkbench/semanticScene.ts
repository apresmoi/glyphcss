import dictionaryJson from "../../../../research/ascii-image-generation/config/glyph-object-dictionary.json";
import { computeGlyphControlContentSha256, computeGlyphControlGeometryHashes, type GlyphControlSceneManifest, type GlyphObjectDictionary } from "glyphcss";
import type { Polygon } from "@glyphcss/core";

/** The gallery deliberately offers semantic output only for this fixed, authored
 * fixture. Imported models have no immutable polygon-to-object lineage. */
export interface GallerySemanticScene {
  readonly dictionary: GlyphObjectDictionary;
  readonly sceneManifest: GlyphControlSceneManifest;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

const dictionary = deepFreeze(dictionaryJson) as GlyphObjectDictionary;
let cubeScene: GallerySemanticScene | null = null;

export function gallerySemanticSceneFor(presetId: string, polygons: readonly Polygon[]): GallerySemanticScene | null {
  if (presetId !== "primitive-cube") return null;
  if (cubeScene) return cubeScene;
  const hashes = computeGlyphControlGeometryHashes(polygons);
  const base = {
    schemaVersion: "control-scene/v1" as const,
    id: "gallery/primitive-cube-v1",
    dictionaryId: dictionary.id,
    dictionarySha256: dictionary.contentSha256,
    ...hashes,
    contentSha256: "",
    instances: [{ id: "gallery/cube", classId: 1 }],
    surfaces: polygons.map((_, index) => ({ id: `gallery/cube/face-${index}`, instanceId: "gallery/cube" })),
    polygonSurfaceIds: polygons.map((_, index) => `gallery/cube/face-${index}`),
  };
  cubeScene = deepFreeze({
    dictionary,
    sceneManifest: { ...base, contentSha256: computeGlyphControlContentSha256(base) },
  });
  return cubeScene;
}
