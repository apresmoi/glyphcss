import type { LoadMeshOptions, ParseAnimationClip, Polygon } from "@glyphcss/core";
import type { GlyphControlSceneManifest, GlyphObjectDictionary, GlyphSemanticCellLineage } from "glyphcss";
import type {
  GalleryEffectBlend,
  GalleryEffectParamValue,
  GlyphMetrics,
  PresetModel,
  SceneOptionsState,
} from "../../features/gallery/model/types";

export interface GlyphSceneEffectConfig {
  effect: unknown;
  params: Record<string, GalleryEffectParamValue>;
  blend: GalleryEffectBlend;
  paused: boolean;
  timeScale: number;
}

// Mirror of the handle shape exposed by glyph-runtime on demoEl.glyphcssDemo.
export interface DemoHandle {
  setMeshUrl: (url: string, mtlUrl?: string, options?: LoadMeshOptions) => Promise<void>;
  setPolygons: (polygons: Polygon[]) => void;
  setAutoRotate: (enabled: boolean) => void;
  setTunables: (partial: Record<string, number | string | boolean>) => void;
  setInteractiveDownscale: (value: number) => void;
  setControlState: (partial: { autoCenter?: boolean; dragEnabled?: boolean; wheelEnabled?: boolean }) => void;
  getCameraState: () => { rotX: number; rotY: number; scale: number; target: [number, number, number] };
  getStats: () => {
    cols: number;
    rows: number;
    glyphs: number;
    textChars: number;
    colorSpans: number;
    domNodes: number;
    layers: number;
    bakeMs: number;
  };
  setAnimation: (clipIndex: number) => void;
  clearAnimation: () => void;
  setAnimationPaused: (paused: boolean) => void;
  setAnimationTimeScale: (scale: number) => void;
  getAnimationInfo: () => { clips: ParseAnimationClip[]; current: number; time: number; paused: boolean };
  resumeAutoRotate: () => void;
  setProjection: (kind: "perspective" | "orthographic") => void;
  setDragMode: (mode: "orbit" | "pan" | "fpv") => void;
  getDragMode: () => "orbit" | "pan" | "fpv";
  setFpvOptions: (partial: {
    look?: boolean;
    move?: boolean;
    jump?: boolean;
    crouch?: boolean;
    moveSpeed?: number;
    jumpVelocity?: number;
    gravity?: number;
    eyeHeight?: number;
    crouchHeight?: number;
    lookSensitivity?: number;
    invertY?: boolean;
  }) => void;
  setLighting: (partial: {
    azimuth?: number;
    elevation?: number;
    keyIntensity?: number;
    ambientIntensity?: number;
    keyColor?: string;
    ambientColor?: string;
  }) => void;
  setShadow: (partial: {
    enabled?: boolean;
    opacity?: number;
    lift?: number;
    color?: string;
    castShadow?: boolean;
    receiveShadow?: boolean;
    floor?: boolean;
  }) => void;
  configureEffect: (config: GlyphSceneEffectConfig | null) => void;
  setPresentation: (
    renderMode: SceneOptionsState["renderMode"],
    semanticOutput: { sceneManifest: GlyphControlSceneManifest; dictionary: GlyphObjectDictionary } | null,
  ) => void;
  getSemanticCellFrame: () => {
    cols: number;
    rows: number;
    cells: readonly (GlyphSemanticCellLineage | null)[];
  } | null;
  /** Real reason `colorEncoding: "atlas"` isn't available right now (`null`
   *  when it is) — see `../../lib/glyphAtlasAvailability.ts`. Polled, not
   *  pushed, same as `getStats`/`getAnimationInfo`. */
  getAtlasAvailability: () => { reason: string | null };
}

export interface GlyphSceneProps {
  meshUrl: string;
  selectedPreset?: PresetModel;
  options: SceneOptionsState;
  onBuild?: (ms: number) => void;
  onCameraChange?: (cam: { rotX: number; rotY: number; zoom?: number; target?: [number, number, number] }) => void;
  onStatsChange?: (stats: GlyphMetrics) => void;
  /** Real reason `colorEncoding: "atlas"` isn't available right now (`null`
   *  when it is) — polled alongside stats, see `startPolling` below. */
  onAtlasAvailability?: (reason: string | null) => void;
  onAnimationInfoChange: (info: { clips: Array<{ index: number; name: string; duration: number }> }) => void;
  selectedAnimation: string;
  animationPaused: boolean;
  animationTimeScale: number;
  effect: GlyphSceneEffectConfig | null;
  semanticOutput?: { sceneManifest: GlyphControlSceneManifest; dictionary: GlyphObjectDictionary } | null;
  onSemanticCellLineage?: (lineage: GlyphSemanticCellLineage | null) => void;
}
