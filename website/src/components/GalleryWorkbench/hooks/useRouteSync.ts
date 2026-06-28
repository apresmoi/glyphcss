import { useEffect, type Dispatch, type SetStateAction } from "react";
import type { SceneOptionsState } from "../types";

const MODEL_PARAM = "model";
const SCENE_PARAM = "scene";

type SceneTarget = SceneOptionsState["target"];

// Short-key serialization of the sidebar options. Only options that differ from
// the active preset's defaults are stored, so shared URLs stay compact. Mirrors
// voxcss's gallery route-sync (compact "scene" param), adapted to glyphcss's
// SceneOptionsState fields.
interface SerializedGallerySceneOptions {
  ap?: boolean;   // animationPaused
  ats?: number;   // animationTimeScale
  c?: boolean;    // autoCenter
  ar?: boolean;   // autoRotate
  i?: boolean;    // interactive
  rx?: number;    // rotX
  ry?: number;    // rotY
  p?: number | false; // perspective
  az?: number;    // lightAzimuth
  el?: number;    // lightElevation
  key?: number;   // lightIntensity
  kc?: string;    // lightColor
  amb?: number;   // ambientIntensity
  amc?: string;   // ambientColor
  t?: SceneTarget; // target
  rm?: SceneOptionsState["renderMode"];
  fe?: number;    // featureEdges
  gp?: SceneOptionsState["glyphPalette"];
  lh?: number;    // lineHeight
  dn?: number;    // density
  uc?: boolean;   // useColors
  ss?: boolean;   // smoothShading
  ca?: number;    // creaseAngle
  drag?: SceneOptionsState["dragMode"];
  fl?: boolean;   // fpvLook
  fm?: boolean;   // fpvMove
  fj?: boolean;   // fpvJump
  fcr?: boolean;  // fpvCrouch
  fms?: number;   // fpvMoveSpeed
  fjv?: number;   // fpvJumpVelocity
  fg?: number;    // fpvGravity
  feh?: number;   // fpvEyeHeight
  fch?: number;   // fpvCrouchHeight
  fls?: number;   // fpvLookSensitivity
  fiy?: boolean;  // fpvInvertY
  sh?: boolean;   // shadowEnabled
  so?: number;    // shadowOpacity
  sli?: number;   // shadowLift
  sc?: string;    // shadowColor
  sca?: boolean;  // shadowCast
  sre?: boolean;  // shadowReceive
  sfl?: boolean;  // shadowFloor
}

type SerializedGallerySceneOptionKey = keyof SerializedGallerySceneOptions;

const COMPACT_SCENE_VERSION = "2";
const COMPACT_NUMBER_SCALE = 10000;

// Each option maps to a unique single-char token in the compact "scene" string.
// "0" is reserved as the boolean-false sentinel, so it is never used as a key.
const COMPACT_KEY_BY_OPTION: Record<SerializedGallerySceneOptionKey, string> = {
  ap: "P", ats: "A", c: "c", ar: "n", i: "i", rx: "X", ry: "Y",
  p: "p", az: "a", el: "e", key: "k", kc: "K", amb: "m", amc: "M", t: "t",
  rm: "R", fe: "F", gp: "G", lh: "H", dn: "D", uc: "U", ss: "W", ca: "N", drag: "d",
  fl: "L", fm: "V", fj: "J", fcr: "C", fms: "1", fjv: "2", fg: "3", feh: "4",
  fch: "5", fls: "6", fiy: "7", sh: "S", so: "O", sli: "8", sc: "Q",
  sca: "9", sre: "B", sfl: "D",
};
const COMPACT_OPTION_BY_KEY = Object.fromEntries(
  Object.entries(COMPACT_KEY_BY_OPTION).map(([key, compact]) => [compact, key]),
) as Record<string, SerializedGallerySceneOptionKey>;

const BOOLEAN_OPTIONS = new Set<SerializedGallerySceneOptionKey>([
  "ap", "c", "ar", "i", "uc", "ss", "fl", "fm", "fj", "fcr", "fiy",
  "sh", "sca", "sre", "sfl",
]);

const RENDER_MODE_ENUM = { wireframe: "w", solid: "s" } as const;
const DRAG_MODE_ENUM = { orbit: "o", pan: "p", fpv: "f" } as const;
const GLYPH_PALETTE_ENUM = {
  default: "d", ascii: "a", lines: "l", blocks: "b", stars: "r",
  arrows: "o", math: "m", binary: "y", hex: "x",
} as const;

// ── Model param ────────────────────────────────────────────────────────────

function getRoutePresetValue(): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get(MODEL_PARAM) || "";
}

function getRouteSceneValue(): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get(SCENE_PARAM) || "";
}

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

function writeRouteParams(params: URLSearchParams): void {
  if (typeof window === "undefined") return;
  const newSearch = params.toString();
  const newUrl = `${window.location.pathname}${newSearch ? `?${newSearch}` : ""}${window.location.hash}`;
  if (newUrl !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
    window.history.replaceState(null, "", newUrl);
  }
}

export function setRoutePresetId(presetId: string | null): void {
  if (typeof window === "undefined") return;
  const next = presetId ? routeIdForPresetId(presetId) : "";
  if (next === getRoutePresetValue()) return;
  const params = new URLSearchParams(window.location.search);
  if (next) params.set(MODEL_PARAM, next);
  else params.delete(MODEL_PARAM);
  writeRouteParams(params);
}

export function routeInitialPresetId(presetIds: string[]): string {
  return resolveRoutePresetId(getRoutePresetValue(), presetIds);
}

// ── Numeric / color codec (compact base36) ─────────────────────────────────

function round(value: number): number {
  return Number(value.toFixed(4));
}

function roundVec3(value: SceneTarget): SceneTarget {
  return [round(value[0]), round(value[1]), round(value[2])];
}

function sameNumber(a: number, b: number): boolean {
  return round(a) === round(b);
}

function sameVec3(a: SceneTarget, b: SceneTarget): boolean {
  return sameNumber(a[0], b[0]) && sameNumber(a[1], b[1]) && sameNumber(a[2], b[2]);
}

function samePerspective(a: SceneOptionsState["perspective"], b: SceneOptionsState["perspective"]): boolean {
  if (a === false || b === false) return a === b;
  return sameNumber(a, b);
}

function encodeCompactNumber(value: number): string {
  return Math.round(round(value) * COMPACT_NUMBER_SCALE).toString(36);
}

function decodeCompactNumber(value: string): number | undefined {
  if (!/^-?[0-9a-z]+$/i.test(value)) return undefined;
  const sign = value.startsWith("-") ? -1 : 1;
  const digits = sign === -1 ? value.slice(1) : value;
  const parsed = Number.parseInt(digits, 36);
  if (!Number.isFinite(parsed)) return undefined;
  return round((sign * parsed) / COMPACT_NUMBER_SCALE);
}

// Length-prefixed number so values can be concatenated without separators.
function encodePackedNumber(value: number): string {
  const encoded = encodeCompactNumber(value);
  return `${encoded.length.toString(36)}${encoded}`;
}

function readPackedNumber(value: string, index: number): { value: number; next: number } | undefined {
  const length = Number.parseInt(value[index] ?? "", 36);
  if (!Number.isFinite(length) || length <= 0) return undefined;
  const start = index + 1;
  const end = start + length;
  if (end > value.length) return undefined;
  const decoded = decodeCompactNumber(value.slice(start, end));
  return decoded === undefined ? undefined : { value: decoded, next: end };
}

function encodeCompactColor(value: string): string | undefined {
  const hex = value.replace(/^#/, "").toLowerCase();
  if (!/^[0-9a-f]{6}$/.test(hex)) return undefined;
  return Number.parseInt(hex, 16).toString(36).padStart(5, "0");
}

function decodeCompactColor(value: string): string | undefined {
  if (!/^[0-9a-z]{5}$/i.test(value)) return undefined;
  const parsed = Number.parseInt(value, 36);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 0xffffff) return undefined;
  return `#${parsed.toString(16).padStart(6, "0")}`;
}

function encodeEnum<T extends string>(value: T, values: Record<T, string>): string {
  return values[value];
}

function decodeEnum<T extends string>(value: string, values: Record<string, string>): T | undefined {
  for (const [decoded, encoded] of Object.entries(values)) {
    if (encoded === value) return decoded as T;
  }
  return undefined;
}

// ── Diff against defaults → serialized payload ─────────────────────────────

function addBoolean(out: SerializedGallerySceneOptions, key: SerializedGallerySceneOptionKey, value: boolean, def: boolean): void {
  if (value !== def) (out as Record<string, unknown>)[key] = value;
}

function addNumber(out: SerializedGallerySceneOptions, key: SerializedGallerySceneOptionKey, value: number, def: number): void {
  if (!sameNumber(value, def)) (out as Record<string, unknown>)[key] = round(value);
}

function addString(out: SerializedGallerySceneOptions, key: SerializedGallerySceneOptionKey, value: string, def: string): void {
  if (value !== def) (out as Record<string, unknown>)[key] = value;
}

function sceneOptionsPayload(
  options: SceneOptionsState,
  defaults: SceneOptionsState,
): SerializedGallerySceneOptions | undefined {
  const out: SerializedGallerySceneOptions = {};
  addBoolean(out, "ap", options.animationPaused, defaults.animationPaused);
  addNumber(out, "ats", options.animationTimeScale, defaults.animationTimeScale);
  addBoolean(out, "c", options.autoCenter, defaults.autoCenter);
  addBoolean(out, "ar", options.autoRotate, defaults.autoRotate);
  addBoolean(out, "i", options.interactive, defaults.interactive);
  // `zoom` is intentionally NOT serialized: the gallery auto-fits each model
  // (default 0 = auto-fit), so a restored fitted zoom would disable auto-fit
  // and bloat the URL on every load. Orbit (rotX/rotY) is persisted instead.
  addNumber(out, "rx", options.rotX, defaults.rotX);
  addNumber(out, "ry", options.rotY, defaults.rotY);
  if (!samePerspective(options.perspective, defaults.perspective)) {
    out.p = options.perspective === false ? false : round(options.perspective);
  }
  addNumber(out, "az", options.lightAzimuth, defaults.lightAzimuth);
  addNumber(out, "el", options.lightElevation, defaults.lightElevation);
  addNumber(out, "key", options.lightIntensity, defaults.lightIntensity);
  addString(out, "kc", options.lightColor, defaults.lightColor);
  addNumber(out, "amb", options.ambientIntensity, defaults.ambientIntensity);
  addString(out, "amc", options.ambientColor, defaults.ambientColor);
  if (!sameVec3(options.target, defaults.target)) out.t = roundVec3(options.target);
  addString(out, "rm", options.renderMode, defaults.renderMode);
  addNumber(out, "fe", options.featureEdges, defaults.featureEdges);
  addString(out, "gp", options.glyphPalette, defaults.glyphPalette);
  addNumber(out, "lh", options.lineHeight, defaults.lineHeight);
  addNumber(out, "dn", options.density, defaults.density);
  addBoolean(out, "uc", options.useColors, defaults.useColors);
  addBoolean(out, "ss", options.smoothShading, defaults.smoothShading);
  addNumber(out, "ca", options.creaseAngle, defaults.creaseAngle);
  addString(out, "drag", options.dragMode, defaults.dragMode);
  addBoolean(out, "fl", options.fpvLook, defaults.fpvLook);
  addBoolean(out, "fm", options.fpvMove, defaults.fpvMove);
  addBoolean(out, "fj", options.fpvJump, defaults.fpvJump);
  addBoolean(out, "fcr", options.fpvCrouch, defaults.fpvCrouch);
  addNumber(out, "fms", options.fpvMoveSpeed, defaults.fpvMoveSpeed);
  addNumber(out, "fjv", options.fpvJumpVelocity, defaults.fpvJumpVelocity);
  addNumber(out, "fg", options.fpvGravity, defaults.fpvGravity);
  addNumber(out, "feh", options.fpvEyeHeight, defaults.fpvEyeHeight);
  addNumber(out, "fch", options.fpvCrouchHeight, defaults.fpvCrouchHeight);
  addNumber(out, "fls", options.fpvLookSensitivity, defaults.fpvLookSensitivity);
  addBoolean(out, "fiy", options.fpvInvertY, defaults.fpvInvertY);
  addBoolean(out, "sh", options.shadowEnabled, defaults.shadowEnabled);
  addNumber(out, "so", options.shadowOpacity, defaults.shadowOpacity);
  addNumber(out, "sli", options.shadowLift, defaults.shadowLift);
  addString(out, "sc", options.shadowColor, defaults.shadowColor);
  addBoolean(out, "sca", options.shadowCast, defaults.shadowCast);
  addBoolean(out, "sre", options.shadowReceive, defaults.shadowReceive);
  addBoolean(out, "sfl", options.shadowFloor, defaults.shadowFloor);
  return Object.keys(out).length > 0 ? out : undefined;
}

function encodeCompactValue(key: SerializedGallerySceneOptionKey, value: unknown): string | undefined {
  if (typeof value === "boolean") return value ? "" : "0";
  if (key === "p") return value === false ? "n" : typeof value === "number" ? encodePackedNumber(value) : undefined;
  if (key === "t" && isVec3(value)) return value.map(encodePackedNumber).join("");
  if (key === "kc" || key === "amc" || key === "sc") return typeof value === "string" ? encodeCompactColor(value) : undefined;
  if (key === "rm") return typeof value === "string" ? encodeEnum(value as SceneOptionsState["renderMode"], RENDER_MODE_ENUM) : undefined;
  if (key === "gp") return typeof value === "string" ? encodeEnum(value as SceneOptionsState["glyphPalette"], GLYPH_PALETTE_ENUM) : undefined;
  if (key === "drag") return typeof value === "string" ? encodeEnum(value as SceneOptionsState["dragMode"], DRAG_MODE_ENUM) : undefined;
  if (typeof value === "number") return encodePackedNumber(value);
  return undefined;
}

function encodeCompactScene(payload: SerializedGallerySceneOptions): string {
  const tokens: string[] = [];
  for (const [rawKey, rawValue] of Object.entries(payload)) {
    const key = rawKey as SerializedGallerySceneOptionKey;
    const compactKey = COMPACT_KEY_BY_OPTION[key];
    const value = encodeCompactValue(key, rawValue);
    if (!compactKey || value === undefined) continue;
    tokens.push(`${compactKey}${value}`);
  }
  return `${COMPACT_SCENE_VERSION}${tokens.join("")}`;
}

// ── Decode → Partial<SceneOptionsState> ────────────────────────────────────

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}

function isVec3(value: unknown): value is SceneTarget {
  return Array.isArray(value) && value.length === 3 && value.every((v) => typeof v === "number" && Number.isFinite(v));
}

function isRenderMode(value: unknown): value is SceneOptionsState["renderMode"] {
  return value === "wireframe" || value === "solid";
}

function isGlyphPalette(value: unknown): value is SceneOptionsState["glyphPalette"] {
  return typeof value === "string" && value in GLYPH_PALETTE_ENUM;
}

function isDragMode(value: unknown): value is SceneOptionsState["dragMode"] {
  return value === "orbit" || value === "pan" || value === "fpv";
}

function sceneOptionsFromPayload(o: SerializedGallerySceneOptions): Partial<SceneOptionsState> {
  return {
    ...(isBoolean(o.ap) ? { animationPaused: o.ap } : null),
    ...(isFiniteNumber(o.ats) ? { animationTimeScale: o.ats } : null),
    ...(isBoolean(o.c) ? { autoCenter: o.c } : null),
    ...(isBoolean(o.ar) ? { autoRotate: o.ar } : null),
    ...(isBoolean(o.i) ? { interactive: o.i } : null),
    ...(isFiniteNumber(o.rx) ? { rotX: o.rx } : null),
    ...(isFiniteNumber(o.ry) ? { rotY: o.ry } : null),
    ...(o.p === false || isFiniteNumber(o.p) ? { perspective: o.p } : null),
    ...(isFiniteNumber(o.az) ? { lightAzimuth: o.az } : null),
    ...(isFiniteNumber(o.el) ? { lightElevation: o.el } : null),
    ...(isFiniteNumber(o.key) ? { lightIntensity: o.key } : null),
    ...(isHexColor(o.kc) ? { lightColor: o.kc } : null),
    ...(isFiniteNumber(o.amb) ? { ambientIntensity: o.amb } : null),
    ...(isHexColor(o.amc) ? { ambientColor: o.amc } : null),
    ...(isVec3(o.t) ? { target: o.t } : null),
    ...(isRenderMode(o.rm) ? { renderMode: o.rm } : null),
    ...(isFiniteNumber(o.fe) ? { featureEdges: o.fe } : null),
    ...(isGlyphPalette(o.gp) ? { glyphPalette: o.gp } : null),
    ...(isFiniteNumber(o.lh) ? { lineHeight: o.lh } : null),
    ...(isFiniteNumber(o.dn) ? { density: o.dn } : null),
    ...(isBoolean(o.uc) ? { useColors: o.uc } : null),
    ...(isBoolean(o.ss) ? { smoothShading: o.ss } : null),
    ...(isFiniteNumber(o.ca) ? { creaseAngle: o.ca } : null),
    ...(isDragMode(o.drag) ? { dragMode: o.drag } : null),
    ...(isBoolean(o.fl) ? { fpvLook: o.fl } : null),
    ...(isBoolean(o.fm) ? { fpvMove: o.fm } : null),
    ...(isBoolean(o.fj) ? { fpvJump: o.fj } : null),
    ...(isBoolean(o.fcr) ? { fpvCrouch: o.fcr } : null),
    ...(isFiniteNumber(o.fms) ? { fpvMoveSpeed: o.fms } : null),
    ...(isFiniteNumber(o.fjv) ? { fpvJumpVelocity: o.fjv } : null),
    ...(isFiniteNumber(o.fg) ? { fpvGravity: o.fg } : null),
    ...(isFiniteNumber(o.feh) ? { fpvEyeHeight: o.feh } : null),
    ...(isFiniteNumber(o.fch) ? { fpvCrouchHeight: o.fch } : null),
    ...(isFiniteNumber(o.fls) ? { fpvLookSensitivity: o.fls } : null),
    ...(isBoolean(o.fiy) ? { fpvInvertY: o.fiy } : null),
    ...(isBoolean(o.sh) ? { shadowEnabled: o.sh } : null),
    ...(isFiniteNumber(o.so) ? { shadowOpacity: o.so } : null),
    ...(isFiniteNumber(o.sli) ? { shadowLift: o.sli } : null),
    ...(isHexColor(o.sc) ? { shadowColor: o.sc } : null),
    ...(isBoolean(o.sca) ? { shadowCast: o.sca } : null),
    ...(isBoolean(o.sre) ? { shadowReceive: o.sre } : null),
    ...(isBoolean(o.sfl) ? { shadowFloor: o.sfl } : null),
  };
}

function readPackedValue(
  key: SerializedGallerySceneOptionKey,
  routeValue: string,
  index: number,
): { value: unknown; next: number } | undefined {
  if (BOOLEAN_OPTIONS.has(key)) {
    return routeValue[index] === "0"
      ? { value: false, next: index + 1 }
      : { value: true, next: index };
  }
  if (key === "p") {
    if (routeValue[index] === "n") return { value: false, next: index + 1 };
    return readPackedNumber(routeValue, index);
  }
  if (key === "t") {
    const x = readPackedNumber(routeValue, index);
    if (!x) return undefined;
    const y = readPackedNumber(routeValue, x.next);
    if (!y) return undefined;
    const z = readPackedNumber(routeValue, y.next);
    return z ? { value: [x.value, y.value, z.value], next: z.next } : undefined;
  }
  if (key === "kc" || key === "amc" || key === "sc") {
    const color = decodeCompactColor(routeValue.slice(index, index + 5));
    return color ? { value: color, next: index + 5 } : undefined;
  }
  if (key === "rm") {
    const value = decodeEnum<SceneOptionsState["renderMode"]>(routeValue[index] ?? "", RENDER_MODE_ENUM);
    return value ? { value, next: index + 1 } : undefined;
  }
  if (key === "gp") {
    const value = decodeEnum<SceneOptionsState["glyphPalette"]>(routeValue[index] ?? "", GLYPH_PALETTE_ENUM);
    return value ? { value, next: index + 1 } : undefined;
  }
  if (key === "drag") {
    const value = decodeEnum<SceneOptionsState["dragMode"]>(routeValue[index] ?? "", DRAG_MODE_ENUM);
    return value ? { value, next: index + 1 } : undefined;
  }
  return readPackedNumber(routeValue, index);
}

function decodeRouteSceneOptions(routeValue: string): Partial<SceneOptionsState> | null {
  if (!routeValue.startsWith(COMPACT_SCENE_VERSION)) return null;
  const payload: SerializedGallerySceneOptions = {};
  let index = COMPACT_SCENE_VERSION.length;
  while (index < routeValue.length) {
    const optionKey = COMPACT_OPTION_BY_KEY[routeValue[index]];
    index += 1;
    if (!optionKey) return null;
    const decoded = readPackedValue(optionKey, routeValue, index);
    if (!decoded) return null;
    (payload as Record<string, unknown>)[optionKey] = decoded.value;
    index = decoded.next;
  }
  return Object.keys(payload).length > 0 ? sceneOptionsFromPayload(payload) : null;
}

// ── Public scene-param API ─────────────────────────────────────────────────

export function routeInitialSceneOptions(): Partial<SceneOptionsState> {
  return decodeRouteSceneOptions(getRouteSceneValue()) ?? {};
}

export function routeHasSceneOptions(): boolean {
  return decodeRouteSceneOptions(getRouteSceneValue()) !== null;
}

export function setRouteSceneOptions({
  sceneOptions,
  sceneDefaults,
  presetId,
}: {
  sceneOptions: SceneOptionsState;
  sceneDefaults: SceneOptionsState;
  presetId: string | null;
}): void {
  if (typeof window === "undefined") return;
  const payload = sceneOptionsPayload(sceneOptions, sceneDefaults);
  const params = new URLSearchParams(window.location.search);
  if (presetId) params.set(MODEL_PARAM, routeIdForPresetId(presetId));
  else params.delete(MODEL_PARAM);
  if (payload) params.set(SCENE_PARAM, encodeCompactScene(payload));
  else params.delete(SCENE_PARAM);
  writeRouteParams(params);
}

export function clearRouteSceneOptions(): void {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  params.delete(SCENE_PARAM);
  writeRouteParams(params);
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
    const routeValue = getRoutePresetValue();
    if (routeValue) {
      const routePresetId = resolveRoutePresetId(routeValue, presetIds);
      setRoutePresetId(routePresetId || null);
    }

    const handlePopState = () => {
      const nextRouteValue = getRoutePresetValue();
      const nextPresetId = nextRouteValue ? resolveRoutePresetId(nextRouteValue, presetIds) : "";
      if (nextRouteValue && !nextPresetId) {
        setRoutePresetId(null);
        return;
      }
      if (nextPresetId && nextPresetId !== presetId) {
        resetToPreset(nextPresetId);
      }
      const nextSceneOptions = decodeRouteSceneOptions(getRouteSceneValue());
      if (nextSceneOptions && setSceneOptions) {
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
