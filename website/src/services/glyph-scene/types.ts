import type {
  GlyphControlSceneManifest,
  GlyphEffectLayerHandle,
  GlyphObjectDictionary,
  LoadMeshOptions,
  ParseAnimationClip,
  Polygon,
  TextureTriangle,
  Vec3,
  WireframeEdge,
} from "glyphcss";

export type GeometryName = "cuboctahedron" | "icosahedron" | "cube";

export type RuntimeEffectParam = string | number | boolean;

export type RuntimeEffectConfig = {
  effect: unknown;
  params: Record<string, RuntimeEffectParam>;
  blend: "replace" | "over";
  paused: boolean;
  timeScale: number;
};

export type RuntimeEffectLayer = GlyphEffectLayerHandle<Record<string, RuntimeEffectParam>>;

export type RuntimeSemanticOutput = {
  sceneManifest: GlyphControlSceneManifest;
  dictionary: GlyphObjectDictionary;
} | null;

export interface ShadowState {
  enabled: boolean;
  opacity: number;
  lift: number;
  color: string;
  castShadow: boolean;
  receiveShadow: boolean;
  floor: boolean;
}

export interface Tunables {
  zoom: number;
  stretch: number;
  distance: number;
  perspective: number;
  rotX: number;
  rotY?: number;
  targetX?: number;
  targetY?: number;
  targetZ?: number;
  duration: number;
  density: number;
  lineHeight: number;
  fontSize?: number;
  geometry: GeometryName;
  renderMode?: "wireframe" | "solid" | "ink";
  featureEdges?: number;
  glyphPalette?: string;
  charMode?: "ascii" | "braille" | "halfblock" | "quadrant";
  wireframeJunctions?: boolean;
  hiddenLines?: "show" | "hide";
  /** Solid-mode-only font-weight-calibrated ramp toggle — see `weightedRamp.ts`. */
  solidWeightRamp?: boolean;
  /** `glyphcss` scene option — `"spans"` (default) or `"atlas"` (zero-`<span>`
   *  colour-font encoding). The atlas palette is not a tunable: `createGlyphScene`
   *  derives and pools it internally from the real cell buffers. */
  colorEncoding?: "spans" | "atlas";
  useColors?: boolean;
  smoothShading?: boolean;
  creaseAngle?: number;
}

export type DragMode = "orbit" | "pan" | "fpv";

export interface FpvOptions {
  look: boolean;
  move: boolean;
  jump: boolean;
  crouch: boolean;
  moveSpeed: number;
  jumpVelocity: number;
  gravity: number;
  eyeHeight: number;
  crouchHeight: number;
  groundZ: number;
  lookSensitivity: number;
  minPitch: number;
  maxPitch: number;
  invertY: boolean;
}

export interface ControlState {
  invertDrag: boolean;
  dragEnabled: boolean;
  wheelEnabled: boolean;
  autoCenter: boolean;
  lastMeshUrl: string | null;
  lastMtlUrl: string | null;
  lastLoadOptions: LoadMeshOptions | null;
  rotYLocked: boolean;
  projection: "perspective" | "orthographic";
  dragMode: DragMode;
  fpv: FpvOptions;
}

export const DEFAULT_TUNABLES: Tunables = {
  zoom: 0.3,
  stretch: 1.0,
  distance: 0,
  perspective: 32000,
  rotX: 65,
  duration: 6,
  density: 1.0,
  lineHeight: 1.0,
  geometry: "cuboctahedron",
};

export const DEMO_BASE_FONT_SIZE = 10;

export const DEMO_GEOMETRY_SIZE = 100;

// ── Geometry state ───────────────────────────────────────────────────────

export type GeometryState = {
  vertices: Vec3[];
  edges: WireframeEdge[];
  polygons: TextureTriangle[];
  /** Original N-gon polygons (pre fan-triangulation). Wireframe edge
   *  derivation uses these so outline edges don't get polluted by
   *  fan-triangulation diagonals. Empty for triangulated mesh imports. */
  ngonPolygons?: Polygon[];
  animations: ParseAnimationClip[];
  sample: (clipIndex: number, time: number) => TextureTriangle[];
};
