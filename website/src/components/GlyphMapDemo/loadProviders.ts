import type { GlyphMapProvider, GlyphMapVectorProvider } from "@glyphcss/maps";
import { createGeoTilesProvider } from "../../features/maps/providers/geoTilesProvider";
import { createVectorTilesProvider } from "../../features/maps/providers/vectorTilesProvider";

let terrain: Promise<GlyphMapProvider> | undefined;
let borders: Promise<GlyphMapVectorProvider> | undefined;

// Terrain/contours and neighbouring islands sweep independently. Share active
// requests without retaining a second tile cache after the widgets release them.
function shareTiles<T extends GlyphMapProvider | GlyphMapVectorProvider>(provider: T): T {
  const active = new Map<string, ReturnType<T["loadTile"]>>();
  return {
    ...provider,
    loadTile(z: number, x: number, y: number) {
      const key = `${z}/${x}/${y}`;
      let pending = active.get(key);
      if (!pending) {
        pending = provider.loadTile(z, x, y).finally(() => active.delete(key)) as ReturnType<T["loadTile"]>;
        active.set(key, pending);
      }
      return pending;
    },
  };
}

export function loadTerrain() {
  return (terrain ??= createGeoTilesProvider()
    .then(shareTiles)
    .catch((error) => {
      terrain = undefined;
      throw error;
    }));
}

export function loadBorders() {
  return (borders ??= createVectorTilesProvider()
    .then(shareTiles)
    .catch((error) => {
      borders = undefined;
      throw error;
    }));
}
