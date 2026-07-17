import type { GlyphMeshHandle } from "./createGlyphScene";

export interface GlyphReadonlyNumberArray {
  readonly length: number;
  readonly [index: number]: number;
}

export type GlyphEffectParamValue = number | string | boolean;

export type GlyphEffectParamShape<P> = {
  -readonly [K in keyof P]-?: GlyphEffectParamValue;
};

export type GlyphEffectPackedColor = number;

export interface GlyphEffectParsedColor {
  packed: GlyphEffectPackedColor;
  opacity: number;
}

export const GlyphEffectNoColor = 0xffffffff as const;

function parseRgbChannel(value: string): number | null {
  const trimmed = value.trim();
  const parsed = Number.parseFloat(trimmed);
  if (!Number.isFinite(parsed)) return null;
  const channel = trimmed.endsWith("%") ? parsed * 2.55 : parsed;
  if (channel < 0 || channel > 255) return null;
  return Math.round(channel);
}

function parseAlpha(value: string): number | null {
  const trimmed = value.trim();
  const parsed = Number.parseFloat(trimmed);
  if (!Number.isFinite(parsed)) return null;
  const alpha = trimmed.endsWith("%") ? parsed / 100 : parsed;
  return alpha >= 0 && alpha <= 1 ? alpha : null;
}

export function parseGlyphEffectColor(
  value: string,
  out: GlyphEffectParsedColor = { packed: 0, opacity: 1 },
): GlyphEffectParsedColor {
  const input = value.trim().toLowerCase();
  let r: number;
  let g: number;
  let b: number;
  let opacity = 1;

  const hex = /^#([\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.exec(input)?.[1];
  if (hex) {
    if (hex.length === 3 || hex.length === 4) {
      r = Number.parseInt(hex[0]! + hex[0]!, 16);
      g = Number.parseInt(hex[1]! + hex[1]!, 16);
      b = Number.parseInt(hex[2]! + hex[2]!, 16);
      if (hex.length === 4) opacity = Number.parseInt(hex[3]! + hex[3]!, 16) / 255;
    } else {
      r = Number.parseInt(hex.slice(0, 2), 16);
      g = Number.parseInt(hex.slice(2, 4), 16);
      b = Number.parseInt(hex.slice(4, 6), 16);
      if (hex.length === 8) opacity = Number.parseInt(hex.slice(6, 8), 16) / 255;
    }
  } else {
    const rgb = /^rgba?\((.*)\)$/.exec(input);
    if (!rgb) throw new TypeError(`glyphcss: unsupported effect color "${value}".`);
    const parts = rgb[1]!.split(",");
    if (parts.length !== 3 && parts.length !== 4) {
      throw new TypeError(`glyphcss: invalid effect color "${value}".`);
    }
    const parsedR = parseRgbChannel(parts[0]!);
    const parsedG = parseRgbChannel(parts[1]!);
    const parsedB = parseRgbChannel(parts[2]!);
    const parsedAlpha = parts.length === 4 ? parseAlpha(parts[3]!) : 1;
    if (parsedR === null || parsedG === null || parsedB === null || parsedAlpha === null) {
      throw new TypeError(`glyphcss: invalid effect color "${value}".`);
    }
    r = parsedR;
    g = parsedG;
    b = parsedB;
    opacity = parsedAlpha;
  }

  out.packed = (r << 16) | (g << 8) | b;
  out.opacity = opacity;
  return out;
}

export interface GlyphEffectImageView {
  readonly cols: number;
  readonly rows: number;
  readonly length: number;
  readonly glyph: readonly string[];
  readonly coverage: GlyphReadonlyNumberArray;
  readonly color?: GlyphReadonlyNumberArray;
}

export interface GlyphEffectFrameView extends GlyphEffectImageView {
  readonly shade?: GlyphReadonlyNumberArray;
  readonly depth?: GlyphReadonlyNumberArray;
  readonly normal?: GlyphReadonlyNumberArray;
  readonly worldPosition?: GlyphReadonlyNumberArray;
  readonly surfaceKey?: GlyphReadonlyNumberArray;
  readonly uv0?: GlyphReadonlyNumberArray;
}

export interface GlyphEffectCoordinates {
  readonly cellToSceneGrid: readonly [number, number, number, number, number, number];
  readonly sceneGridSize: readonly [number, number];
  readonly localCellFootprint: readonly [number, number];
  /** Isotropic conversion from world units to canonical scene-grid cells. */
  readonly worldToSceneScale?: number;
  readonly uv0Footprint?: GlyphReadonlyNumberArray;
}

export interface GlyphEffectTargetView {
  readonly coverage: GlyphReadonlyNumberArray;
}

export const GlyphEffectOutputChannel = {
  Glyph: 1 << 0,
  Color: 1 << 1,
} as const;

export type GlyphEffectOutputChannel = 0 | 1 | 2 | 3;

export interface GlyphEffectOutput {
  readonly glyph: string[];
  readonly color: Uint32Array;
  readonly coverage: Float32Array;
  readonly channels: Uint8Array;
}

export interface GlyphEffectScratchRequirements {
  readonly images?: number;
  readonly floatFields?: number;
  readonly uintFields?: number;
  readonly glyphFields?: number;
  readonly samples?: number;
}

export interface GlyphEffectScratchView {
  readonly images: readonly GlyphEffectOutput[];
  readonly floatFields: readonly Float32Array[];
  readonly uintFields: readonly Uint32Array[];
  readonly glyphFields: readonly string[][];
  readonly samples: readonly GlyphEffectImageSample[];
}

export type GlyphEffectEdgeMode = "transparent" | "clamp" | "repeat" | "mirror";

export interface GlyphEffectImageSample {
  glyph: string;
  hasGlyph: boolean;
  color: GlyphEffectPackedColor;
  hasColor: boolean;
  coverage: number;
}

export interface GlyphEffectSceneInputView {
  sampleNearestSceneGrid(
    x: number,
    y: number,
    edge: GlyphEffectEdgeMode,
    out: GlyphEffectImageSample,
  ): void;
}

export interface GlyphEffectPrepareContext<P extends object> {
  readonly params: Readonly<P>;
  readonly sceneGridSize: readonly [number, number];
}

export interface GlyphEffectEvaluateContext<P extends object, S> {
  readonly params: Readonly<P>;
  readonly state: Readonly<S>;
  readonly base: GlyphEffectFrameView;
  readonly input: GlyphEffectImageView;
  readonly sceneInput?: GlyphEffectSceneInputView;
  readonly target: GlyphEffectTargetView;
  readonly coordinates: GlyphEffectCoordinates;
  readonly scratch: GlyphEffectScratchView;
  readonly output: GlyphEffectOutput;
}

export type GlyphEffectRequirement =
  | "baseColor"
  | "baseShade"
  | "depth"
  | "normal"
  | "worldPosition"
  | "surfaceKey"
  | "uv0"
  | "uv0Footprint";

export interface GlyphEffectProgramBase<P extends object, S> {
  readonly requirements?: readonly GlyphEffectRequirement[];
  /**
   * Inputs retained when the active render mode can provide them. Unlike hard
   * requirements, their absence never makes a program incompatible with a
   * render mode, so evaluate() must provide a fallback.
   */
  readonly optionalRequirements?: readonly GlyphEffectRequirement[];
  readonly sceneSampling?: "nearest";
  readonly scratch?: GlyphEffectScratchRequirements;
  validateParams?(params: Readonly<P>): void;
  prepare?(context: GlyphEffectPrepareContext<P>, state: S): void;
  evaluate(context: GlyphEffectEvaluateContext<P, S>): void;
}

export type GlyphEffectProgram<P extends object, S = undefined> =
  GlyphEffectProgramBase<P, S> & (
    [S] extends [undefined]
      ? { readonly createState?: undefined }
      : { createState(): S }
  );

export function defineGlyphEffect<P extends GlyphEffectParamShape<P>, S = undefined>(
  program: GlyphEffectProgram<P, S>,
): GlyphEffectProgram<P, S> {
  return program;
}

interface GlyphEffectParamMetadata {
  readonly label?: string;
  readonly description?: string;
  readonly step?: number;
  readonly hidden?: boolean;
}

export interface GlyphEffectNumberParamSpec extends GlyphEffectParamMetadata {
  readonly kind: "number";
  readonly default: number;
  readonly unit?: string;
  readonly min?: number;
  readonly max?: number;
  readonly animation?: "continuous";
}

export interface GlyphEffectStringParamSpec extends GlyphEffectParamMetadata {
  readonly kind: "string";
  readonly default: string;
  readonly values?: readonly string[];
  readonly animation: "discrete";
}

export interface GlyphEffectBooleanParamSpec extends GlyphEffectParamMetadata {
  readonly kind: "boolean";
  readonly default: boolean;
  readonly animation: "discrete";
}

export interface GlyphEffectColorParamSpec extends GlyphEffectParamMetadata {
  readonly kind: "color";
  readonly default: string;
  readonly animation?: "continuous";
}

export type GlyphEffectParamSpec =
  | GlyphEffectNumberParamSpec
  | GlyphEffectStringParamSpec
  | GlyphEffectBooleanParamSpec
  | GlyphEffectColorParamSpec;

export type GlyphEffectParamSchema = Readonly<Record<string, GlyphEffectParamSpec>>;

export type GlyphEffectParamValueOf<Spec> =
  Spec extends GlyphEffectNumberParamSpec ? number
    : Spec extends GlyphEffectBooleanParamSpec ? boolean
      : Spec extends GlyphEffectStringParamSpec | GlyphEffectColorParamSpec ? string
        : never;

export type GlyphEffectParamValues<S extends GlyphEffectParamSchema> = {
  -readonly [K in keyof S]: GlyphEffectParamValueOf<S[K]>;
};

export interface GlyphEffectDefinition<Schema extends GlyphEffectParamSchema, State = undefined> {
  readonly id: string;
  readonly version: number;
  readonly label?: string;
  readonly description?: string;
  readonly parameterSchema: Schema;
  readonly program: GlyphEffectProgram<GlyphEffectParamValues<Schema>, State>;
}

export type GlyphEffectParamsOf<D> =
  D extends { readonly parameterSchema: infer Schema extends GlyphEffectParamSchema }
    ? GlyphEffectParamValues<Schema>
    : never;

export type GlyphEffectTarget = "surfaces" | "viewport" | GlyphMeshHandle | readonly GlyphMeshHandle[];
export type GlyphEffectBlend = "replace" | "over";

export interface GlyphEffectLayerCommonOptions {
  target?: GlyphEffectTarget;
  blend?: GlyphEffectBlend;
  opacity?: number;
  order?: number;
  enabled?: boolean;
}

export interface GlyphEffectDefinitionLayerOptions<
  Schema extends GlyphEffectParamSchema,
  State = undefined,
> extends GlyphEffectLayerCommonOptions {
  effect: GlyphEffectDefinition<Schema, State>;
  params?: Partial<GlyphEffectParamValues<Schema>>;
}

export interface GlyphEffectProgramLayerOptions<
  P extends GlyphEffectParamShape<P>,
  State = undefined,
> extends GlyphEffectLayerCommonOptions {
  effect: GlyphEffectProgram<P, State>;
  params: P;
}

export type GlyphEffectLayerOptions =
  | GlyphEffectDefinitionLayerOptions<GlyphEffectParamSchema, any>
  | GlyphEffectProgramLayerOptions<Record<string, GlyphEffectParamValue>, any>;

export interface GlyphEffectLayerHandle<P extends object> {
  readonly params: P;
  readonly disposed: boolean;
  enabled: boolean;
  opacity: number;
  order: number;
  setParams(params: Partial<P>): void;
  setOptions(options: Partial<{
    target: GlyphEffectTarget;
    blend: GlyphEffectBlend;
    opacity: number;
    order: number;
    enabled: boolean;
  }>): void;
  invalidate(): void;
  dispose(): void;
}
