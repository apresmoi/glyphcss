/**
 * Builder scene presets — composite layouts that load multiple model
 * presets at once with prebuilt relative positions/rotations/scales.
 *
 * Scene items reference model presets by FILE (relative to
 * `website/public/gallery/glb/`) and the matching preset ID is derived
 * via `presetIdFromFile`. This keeps the scene definitions
 * human-readable AND impossible to desync from the preset list — the
 * filename is the single source of truth.
 *
 * Positions are in WORLD units (post `fitScale` normalization, models
 * are ~NORMALIZED_MAX_DIM = 8 units wide). X is right, Y is depth (back),
 * Z snaps to floor via `placeMeshOnFloor`. Rotation is in degrees (Euler
 * XYZ). Scale is a multiplier on the auto-fit scale; 1 keeps the
 * normalized size, 1.5 makes it 50 % larger, etc.
 */

import type { SceneOptionsState } from "../types";
import { presetIdFromFile } from "../GalleryWorkbench/presets/presetBuilders";

export interface ScenePresetItem {
  presetId: string;
  /** Desired world position (X, Y, Z). Z is usually 0 (floor); the
   *  builder's `placeMeshOnFloor` adds vertical correction so the
   *  visible bottom of the mesh lands on the ground plane. */
  position: [number, number, number];
  /** Euler XYZ in degrees. Defaults to [0, 0, 0]. */
  rotation?: [number, number, number];
  /** Multiplier on the auto-fit scale. Defaults to 1. */
  scale?: number;
}

export interface ScenePreset {
  id: string;
  label: string;
  category: string;
  items: ScenePresetItem[];
  /** Patch applied to `sceneOptions` when the scene loads. Lets a
   *  scene declare "I want the ground plane visible" or similar without
   *  the user having to flip the toggle in the dock. Applied via
   *  `updateScene` in `handleAddScene` before the items are placed. */
  defaultSceneOptions?: Partial<SceneOptionsState>;
}

/** Scene IDs are prefixed so BuilderWorkbench's click handler can route
 *  them to `handleAddScene` instead of `handleAddPreset`. */
export const SCENE_PRESET_ID_PREFIX = "scene-";

/** Preset ID for a GLB file under `public/gallery/glb/`. */
const glb = (file: string): string => presetIdFromFile("glb", file);

/** Single city block — buildings arranged around a small empty plot,
 *  all facing outward toward the surrounding streets. Roughly 3×3
 *  building footprints (~25×25 world units) so it sits comfortably
 *  inside the default render distance of 40. */
export const CITY_BLOCK: ScenePreset = {
  id: `${SCENE_PRESET_ID_PREFIX}city-block`,
  label: "City Block",
  category: "Scenes",
  items: [
    // Back row (north edge of the block) — taller anchors facing outward
    { presetId: glb("city/Skyscraper.glb"), position: [0, 10, 0], rotation: [0, 0, 180] },
    { presetId: glb("city/Large Building.glb"), position: [-10, 10, 0], rotation: [0, 0, 180] },
    { presetId: glb("city/Large Building-3IhrYZp6tP.glb"), position: [10, 10, 0], rotation: [0, 0, 180] },

    // Side rows — small/low buildings facing east and west
    { presetId: glb("city/Small Building.glb"), position: [-10, 0, 0], rotation: [0, 0, 90] },
    { presetId: glb("city/Small Building-QjL4Fo9dU9.glb"), position: [10, 0, 0], rotation: [0, 0, -90] },

    // Front row (south edge) — mid-height buildings facing the camera default
    { presetId: glb("city/Low Building.glb"), position: [-10, -10, 0] },
    { presetId: glb("city/Sign Hospital.glb"), position: [0, -10, 0] },
    { presetId: glb("city/Low Wide.glb"), position: [10, -10, 0] },
  ],
};

/** Roads + trees on a big ground plane — no buildings. A north/south
 *  road and an east/west road cross at the origin; trees + a few props
 *  are scattered on the surrounding "lawn". The scene asks for
 *  `showGround: true` via defaultSceneOptions so the ground plane
 *  (200 world units in builder) sits underneath the road tiles. */
export const CITY_STREET: ScenePreset = {
  id: `${SCENE_PRESET_ID_PREFIX}city-street`,
  label: "City Roads",
  category: "Scenes",
  defaultSceneOptions: {
    showGround: true,
  },
  items: [
    // North–south road tiles through the origin
    { presetId: glb("urban/Road Bits.glb"), position: [0, -24, 0] },
    { presetId: glb("urban/Road Bits.glb"), position: [0, -16, 0] },
    { presetId: glb("urban/Road Bits.glb"), position: [0, -8, 0] },
    { presetId: glb("urban/Road Bits.glb"), position: [0, 0, 0] },
    { presetId: glb("urban/Road Bits.glb"), position: [0, 8, 0] },
    { presetId: glb("urban/Road Bits.glb"), position: [0, 16, 0] },
    { presetId: glb("urban/Road Bits.glb"), position: [0, 24, 0] },

    // East–west road tiles (rotated 90 around Z) crossing at origin
    { presetId: glb("urban/Road Bits.glb"), position: [-24, 0, 0], rotation: [0, 0, 90] },
    { presetId: glb("urban/Road Bits.glb"), position: [-16, 0, 0], rotation: [0, 0, 90] },
    { presetId: glb("urban/Road Bits.glb"), position: [-8, 0, 0], rotation: [0, 0, 90] },
    { presetId: glb("urban/Road Bits.glb"), position: [8, 0, 0], rotation: [0, 0, 90] },
    { presetId: glb("urban/Road Bits.glb"), position: [16, 0, 0], rotation: [0, 0, 90] },
    { presetId: glb("urban/Road Bits.glb"), position: [24, 0, 0], rotation: [0, 0, 90] },

    // Trees in each quadrant — corners of the cross
    { presetId: glb("urban/Tree.glb"), position: [-8, 8, 0] },
    { presetId: glb("urban/Tree.glb"), position: [-14, 12, 0] },
    { presetId: glb("urban/Tree.glb"), position: [-6, 16, 0] },
    { presetId: glb("urban/Tree.glb"), position: [-18, 6, 0] },

    { presetId: glb("urban/Tree.glb"), position: [8, 8, 0] },
    { presetId: glb("urban/Tree.glb"), position: [14, 14, 0] },
    { presetId: glb("urban/Tree.glb"), position: [18, 6, 0] },
    { presetId: glb("urban/Tree.glb"), position: [6, 18, 0] },

    { presetId: glb("urban/Tree.glb"), position: [-8, -8, 0] },
    { presetId: glb("urban/Tree.glb"), position: [-14, -14, 0] },
    { presetId: glb("urban/Tree.glb"), position: [-18, -6, 0] },
    { presetId: glb("urban/Tree.glb"), position: [-6, -16, 0] },

    { presetId: glb("urban/Tree.glb"), position: [8, -8, 0] },
    { presetId: glb("urban/Tree.glb"), position: [16, -12, 0] },
    { presetId: glb("urban/Tree.glb"), position: [18, -18, 0] },
    { presetId: glb("urban/Tree.glb"), position: [6, -20, 0] },

    // A couple of cars on the road just for life
    { presetId: glb("urban/Car.glb"), position: [0, -12, 0] },
    { presetId: glb("urban/Police Car.glb"), position: [0, 12, 0], rotation: [0, 0, 180] },
    { presetId: glb("urban/SUV.glb"), position: [-12, 0, 0], rotation: [0, 0, 90] },
  ],
};

export const SCENE_PRESETS: ScenePreset[] = [CITY_STREET, CITY_BLOCK];
