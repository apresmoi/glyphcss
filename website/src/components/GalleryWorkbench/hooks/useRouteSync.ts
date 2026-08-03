import { useEffect, type Dispatch, type SetStateAction } from "react";
import { createUrlCodec, readUrlParam, writeUrlParam, type UrlField } from "../../../lib/urlState";
import type { SceneOptionsState } from "../types";

const MODEL_PARAM = "model";
const SCENE_PARAM = "scene";
const SCENE_SCHEMA_VERSION = "1";

// Compact single-query-param serialization of the sidebar options, built on
// the shared `createUrlCodec` (website/src/lib/urlState.ts) — same packed
// number/color/enum/bool primitives as /wordart and /synth. Only options that
// differ from the active preset's defaults are stored, so shared URLs stay
// short. `model` (which preset/asset is loaded) stays a separate param: it's
// a resource identifier, not a dial the user configures, and keeping it
// separate means dropping a local file can clear `scene` without touching it.
const RENDER_MODE_VALUES = ["wireframe", "solid", "ink"] as const;
const DRAG_MODE_VALUES = ["orbit", "pan", "fpv"] as const;
const GLYPH_PALETTE_VALUES = [
  "default", "ascii", "lines", "blocks", "stars", "arrows", "math", "binary", "hex", "calibrated",
] as const;
// "quadrant" appended (not inserted) so previously-shared URLs keep decoding
// to the same enum index for every earlier value.
const CHAR_MODE_VALUES = ["ascii", "braille", "halfblock", "quadrant"] as const;
const HIDDEN_LINES_VALUES = ["show", "hide"] as const;

const sceneFields: readonly UrlField<SceneOptionsState>[] = [
  { key: "animationPaused", token: "P", type: { kind: "bool" }, default: false },
  { key: "animationTimeScale", token: "A", type: { kind: "float", step: 0.0001 }, default: 1 },
  { key: "autoCenter", token: "c", type: { kind: "bool" }, default: true },
  { key: "autoRotate", token: "n", type: { kind: "bool" }, default: false },
  { key: "interactive", token: "i", type: { kind: "bool" }, default: true },
  // `zoom` is intentionally NOT serialized: the gallery auto-fits each model
  // (default 0 = auto-fit), so a restored fitted zoom would disable auto-fit
  // and bloat the URL on every load. Orbit (rotX/rotY) is persisted instead.
  { key: "rotX", token: "X", type: { kind: "float", step: 0.0001 }, default: 0 },
  { key: "rotY", token: "Y", type: { kind: "float", step: 0.0001 }, default: 0 },
  { key: "perspective", token: "p", type: { kind: "floatOrFalse", step: 0.0001 }, default: false },
  { key: "lightAzimuth", token: "a", type: { kind: "float", step: 0.0001 }, default: 0 },
  { key: "lightElevation", token: "e", type: { kind: "float", step: 0.0001 }, default: 0 },
  { key: "lightIntensity", token: "k", type: { kind: "float", step: 0.0001 }, default: 1 },
  { key: "lightColor", token: "K", type: { kind: "color" }, default: "#ffffff" },
  { key: "ambientIntensity", token: "m", type: { kind: "float", step: 0.0001 }, default: 0.4 },
  { key: "ambientColor", token: "M", type: { kind: "color" }, default: "#ffffff" },
  { key: "target", token: "t", type: { kind: "floatTuple", length: 3, step: 0.0001 }, default: [0, 0, 0] },
  { key: "renderMode", token: "R", type: { kind: "enum", values: RENDER_MODE_VALUES }, default: "wireframe" },
  { key: "featureEdges", token: "F", type: { kind: "float", step: 0.0001 }, default: 35 },
  { key: "glyphPalette", token: "G", type: { kind: "enum", values: GLYPH_PALETTE_VALUES }, default: "default" },
  { key: "charMode", token: "Z", type: { kind: "enum", values: CHAR_MODE_VALUES }, default: "ascii" },
  { key: "wireframeJunctions", token: "j", type: { kind: "bool" }, default: false },
  { key: "hiddenLines", token: "h", type: { kind: "enum", values: HIDDEN_LINES_VALUES }, default: "show" },
  { key: "solidWeightRamp", token: "w", type: { kind: "bool" }, default: false },
  { key: "lineHeight", token: "H", type: { kind: "float", step: 0.0001 }, default: 1 },
  { key: "density", token: "D", type: { kind: "float", step: 0.0001 }, default: 1 },
  { key: "dragDensity", token: "q", type: { kind: "float", step: 0.0001 }, default: 1 },
  { key: "useColors", token: "U", type: { kind: "bool" }, default: true },
  { key: "smoothShading", token: "W", type: { kind: "bool" }, default: false },
  { key: "creaseAngle", token: "N", type: { kind: "float", step: 0.0001 }, default: 35 },
  { key: "dragMode", token: "d", type: { kind: "enum", values: DRAG_MODE_VALUES }, default: "orbit" },
  { key: "fpvLook", token: "L", type: { kind: "bool" }, default: true },
  { key: "fpvMove", token: "V", type: { kind: "bool" }, default: true },
  { key: "fpvJump", token: "J", type: { kind: "bool" }, default: true },
  { key: "fpvCrouch", token: "C", type: { kind: "bool" }, default: true },
  { key: "fpvMoveSpeed", token: "1", type: { kind: "float", step: 0.0001 }, default: 4 },
  { key: "fpvJumpVelocity", token: "2", type: { kind: "float", step: 0.0001 }, default: 5 },
  { key: "fpvGravity", token: "3", type: { kind: "float", step: 0.0001 }, default: 14 },
  { key: "fpvEyeHeight", token: "4", type: { kind: "float", step: 0.0001 }, default: 1.7 },
  { key: "fpvCrouchHeight", token: "5", type: { kind: "float", step: 0.0001 }, default: 0.9 },
  { key: "fpvLookSensitivity", token: "6", type: { kind: "float", step: 0.0001 }, default: 1 },
  { key: "fpvInvertY", token: "7", type: { kind: "bool" }, default: false },
  { key: "shadowEnabled", token: "S", type: { kind: "bool" }, default: false },
  { key: "shadowOpacity", token: "O", type: { kind: "float", step: 0.0001 }, default: 0.25 },
  { key: "shadowLift", token: "8", type: { kind: "float", step: 0.0001 }, default: 0.05 },
  { key: "shadowColor", token: "Q", type: { kind: "color" }, default: "#000000" },
  { key: "shadowCast", token: "9", type: { kind: "bool" }, default: false },
  { key: "shadowReceive", token: "B", type: { kind: "bool" }, default: false },
  { key: "shadowFloor", token: "E", type: { kind: "bool" }, default: false },
];

export const sceneCodec = createUrlCodec<SceneOptionsState>(SCENE_SCHEMA_VERSION, sceneFields);

// ── Model param (unchanged shape: preset id hashed to a short uint32) ──────

function hashStringToUint32(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function routeIdForPresetId(presetId: string): string {
  return String(hashStringToUint32(presetId));
}

function resolveRoutePresetId(routeValue: string, presetIds: string[]): string {
  const value = typeof routeValue === "string" ? routeValue.trim() : "";
  if (!value) return "";
  if (/^\d+$/.test(value)) {
    const found = presetIds.find((id) => routeIdForPresetId(id) === value);
    if (found) return found;
  }
  return presetIds.find((id) => id === value) ?? "";
}

export function setRoutePresetId(presetId: string | null): void {
  const next = presetId ? routeIdForPresetId(presetId) : null;
  if (next === readUrlParam(MODEL_PARAM)) return;
  writeUrlParam(MODEL_PARAM, next);
}

export function routeInitialPresetId(presetIds: string[]): string {
  return resolveRoutePresetId(readUrlParam(MODEL_PARAM) ?? "", presetIds);
}

// ── Public scene-param API ─────────────────────────────────────────────────

export function routeInitialSceneOptions(): Partial<SceneOptionsState> {
  return sceneCodec.decode(readUrlParam(SCENE_PARAM));
}

export function routeHasSceneOptions(): boolean {
  return Object.keys(routeInitialSceneOptions()).length > 0;
}

export function setRouteSceneOptions({
  sceneOptions,
  presetId,
}: {
  sceneOptions: SceneOptionsState;
  sceneDefaults: SceneOptionsState;
  presetId: string | null;
}): void {
  if (typeof window === "undefined") return;
  const encoded = sceneCodec.encode(sceneOptions);
  writeUrlParam(MODEL_PARAM, presetId ? routeIdForPresetId(presetId) : null);
  writeUrlParam(SCENE_PARAM, encoded === `p${SCENE_SCHEMA_VERSION}` ? null : encoded);
}

export function clearRouteSceneOptions(): void {
  writeUrlParam(SCENE_PARAM, null);
}

export interface UseRouteSyncOptions {
  presetId: string;
  presetIds: string[];
  resetToPreset: (id: string) => void;
  /** Per-preset scene defaults, used to rebase decoded options on back/forward nav. */
  sceneDefaultsForPreset?: (id: string) => SceneOptionsState;
  setSceneOptions?: Dispatch<SetStateAction<SceneOptionsState>>;
}

export function useRouteSync({
  presetId,
  presetIds,
  resetToPreset,
  sceneDefaultsForPreset,
  setSceneOptions,
}: UseRouteSyncOptions): void {
  useEffect(() => {
    const routeValue = readUrlParam(MODEL_PARAM) ?? "";
    if (routeValue) {
      const routePresetId = resolveRoutePresetId(routeValue, presetIds);
      setRoutePresetId(routePresetId || null);
    }

    const handlePopState = () => {
      const nextRouteValue = readUrlParam(MODEL_PARAM) ?? "";
      const nextPresetId = nextRouteValue ? resolveRoutePresetId(nextRouteValue, presetIds) : "";
      if (nextRouteValue && !nextPresetId) {
        setRoutePresetId(null);
        return;
      }
      if (nextPresetId && nextPresetId !== presetId) {
        resetToPreset(nextPresetId);
      }
      const nextSceneOptions = sceneCodec.decode(readUrlParam(SCENE_PARAM));
      if (Object.keys(nextSceneOptions).length > 0 && setSceneOptions) {
        setSceneOptions((current) => ({
          ...(nextPresetId && sceneDefaultsForPreset ? sceneDefaultsForPreset(nextPresetId) : current),
          ...nextSceneOptions,
        }));
      }
    };

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [presetId, presetIds, resetToPreset, sceneDefaultsForPreset, setSceneOptions]);
}
