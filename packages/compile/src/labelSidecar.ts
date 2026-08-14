import type { Polygon } from "@glyphcss/core";
import {
  computeGlyphControlContentSha256,
  computeGlyphControlGeometryHashes,
  validateGlyphControlMetadata,
  type GlyphControlSceneManifest,
  type GlyphObjectDictionary,
} from "glyphcss";

export interface GlyphPolygonRemap {
  readonly schemaVersion: "glyph-polygon-remap/v1";
  /** Hashes of the exact polygon array returned by the loader. */
  readonly loadedGeometrySha256: string;
  readonly loadedPolygonOrderSha256: string;
  /** Hashes of the authored array to which `scene.polygonSurfaceIds` belongs. */
  readonly authoredGeometrySha256: string;
  readonly authoredPolygonOrderSha256: string;
  /** loaded polygon index -> authored polygon index. */
  readonly loadedToAuthored: readonly number[];
  readonly contentSha256: string;
}

export interface GlyphLabelSidecar {
  readonly schemaVersion: "glyph-label-sidecar/v1";
  readonly scene: GlyphControlSceneManifest;
  readonly dictionary: GlyphObjectDictionary;
  readonly polygonRemap?: GlyphPolygonRemap;
}

export interface GlyphVerifiedLabels {
  readonly sceneManifest: GlyphControlSceneManifest;
  readonly dictionary: GlyphObjectDictionary;
}

function exactKeys(value: object, expected: readonly string[], label: string): void {
  const actual = Object.keys(value);
  if (actual.length !== expected.length || expected.some((key) => !actual.includes(key))) {
    throw new TypeError(`glyphcss: ${label} must contain exactly ${expected.join(", ")}.`);
  }
}

/**
 * Bind authored labels to the exact post-load polygon array. A direct match
 * needs no remap. Any different order/geometry requires a hash-bound bijection,
 * after which the positional lineage is rebuilt in loaded order and resealed.
 */
export function verifyGlyphLabelSidecar(polygons: readonly Polygon[], sidecar: GlyphLabelSidecar): GlyphVerifiedLabels {
  exactKeys(sidecar, sidecar.polygonRemap
    ? ["schemaVersion", "scene", "dictionary", "polygonRemap"]
    : ["schemaVersion", "scene", "dictionary"], "label sidecar");
  if (sidecar.schemaVersion !== "glyph-label-sidecar/v1") throw new TypeError("glyphcss: unsupported label sidecar schemaVersion.");
  validateGlyphControlMetadata(sidecar.scene, sidecar.dictionary);
  const loaded = computeGlyphControlGeometryHashes(polygons);
  const direct = loaded.geometrySha256 === sidecar.scene.geometrySha256
    && loaded.polygonOrderSha256 === sidecar.scene.polygonOrderSha256;
  if (direct) {
    if (sidecar.scene.polygonSurfaceIds.length !== polygons.length) throw new RangeError("glyphcss: label sidecar polygon count does not match loaded polygons.");
    return { sceneManifest: sidecar.scene, dictionary: sidecar.dictionary };
  }
  const remap = sidecar.polygonRemap;
  if (!remap) throw new TypeError("glyphcss: label sidecar does not match loaded post-load geometry and polygon order.");
  exactKeys(remap, ["schemaVersion", "loadedGeometrySha256", "loadedPolygonOrderSha256", "authoredGeometrySha256", "authoredPolygonOrderSha256", "loadedToAuthored", "contentSha256"], "polygon remap");
  if (remap.schemaVersion !== "glyph-polygon-remap/v1") throw new TypeError("glyphcss: unsupported polygon remap schemaVersion.");
  if (remap.contentSha256 !== computeGlyphControlContentSha256(remap)) throw new TypeError("glyphcss: polygon remap contentSha256 mismatch.");
  if (remap.loadedGeometrySha256 !== loaded.geometrySha256 || remap.loadedPolygonOrderSha256 !== loaded.polygonOrderSha256) {
    throw new TypeError("glyphcss: polygon remap is stale for the loaded polygon array.");
  }
  if (remap.authoredGeometrySha256 !== sidecar.scene.geometrySha256 || remap.authoredPolygonOrderSha256 !== sidecar.scene.polygonOrderSha256) {
    throw new TypeError("glyphcss: polygon remap is not bound to the authored scene.");
  }
  const count = polygons.length;
  if (remap.loadedToAuthored.length !== count || sidecar.scene.polygonSurfaceIds.length !== count) {
    throw new RangeError("glyphcss: polygon remap and authored lineage must match the loaded polygon count.");
  }
  const seen = new Uint8Array(count);
  const polygonSurfaceIds = remap.loadedToAuthored.map((authored) => {
    if (!Number.isInteger(authored) || authored < 0 || authored >= count) throw new RangeError("glyphcss: polygon remap index is out of range.");
    if (seen[authored]) throw new TypeError("glyphcss: polygon remap must be a bijection.");
    seen[authored] = 1;
    return sidecar.scene.polygonSurfaceIds[authored]!;
  });
  if (seen.some((value) => value !== 1)) throw new TypeError("glyphcss: polygon remap must be a bijection.");
  const raw = {
    ...sidecar.scene,
    geometrySha256: loaded.geometrySha256,
    polygonOrderSha256: loaded.polygonOrderSha256,
    polygonSurfaceIds,
    contentSha256: "",
  };
  const sceneManifest: GlyphControlSceneManifest = { ...raw, contentSha256: computeGlyphControlContentSha256(raw) };
  validateGlyphControlMetadata(sceneManifest, sidecar.dictionary);
  return { sceneManifest, dictionary: sidecar.dictionary };
}
