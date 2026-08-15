import type { CellGrid } from "./cells";
import { cloneCellGrid, isSingleCellGlyph } from "./cells";
import {
  GlyphEffectNoColor,
  GlyphEffectOutputChannel,
  parseGlyphEffectColor,
  type GlyphEffectBlend,
  type GlyphEffectCoordinates,
  type GlyphEffectDefinition,
  type GlyphEffectDefinitionLayerOptions,
  type GlyphEffectFrameView,
  type GlyphEffectImageView,
  type GlyphEffectLayerHandle,
  type GlyphEffectOutput,
  type GlyphEffectParamSchema,
  type GlyphEffectParamShape,
  type GlyphEffectParamSpec,
  type GlyphEffectParamValue,
  type GlyphEffectProgram,
  type GlyphEffectProgramLayerOptions,
  type GlyphEffectRequirement,
  type GlyphEffectScratchView,
  type GlyphEffectTarget,
  type GlyphEffectTargetView,
} from "../api/effects";

type AnyParams = Record<string, GlyphEffectParamValue>;
// `unknown` (not `any`) for the state param: `GlyphEffectProgram<P, S>`'s
// `createState` field type is a conditional on `[S] extends [undefined]`, and
// a bare `any` there triggers TS's "any collapses a conditional type to the
// union of both branches" rule, which made `program.createState` resolve to
// an uncallable `never` at the one call site below. `unknown` picks the
// `{ createState(): unknown }` branch cleanly — correct anyway, since a
// runtime-dispatched program's state is always handled opaquely (cast at the
// point of use), never actually relied on to BE `any`.
type AnyProgram = GlyphEffectProgram<AnyParams, unknown>;

const SUPPORTED_REQUIREMENTS = new Set<GlyphEffectRequirement>([
  "baseColor",
  "baseShade",
  "depth",
  "normal",
  "worldPosition",
  "objectPosition",
  "objectExit",
  "uv0",
]);

const EMPTY_SCRATCH: GlyphEffectScratchView = {
  images: [],
  floatFields: [],
  uintFields: [],
  glyphFields: [],
  samples: [],
};

export interface GlyphEffectOutputMetadata {
  readonly id: string;
  readonly pre: HTMLPreElement;
  readonly isBase: boolean;
  readonly cellToSceneGrid: readonly [number, number, number, number, number, number];
  readonly sceneGridSize: readonly [number, number];
  readonly localCellFootprint: readonly [number, number];
  readonly worldToSceneScale?: number;
}

export interface RuntimeGlyphEffectLayer {
  readonly declarationOrder: number;
  readonly program: AnyProgram;
  readonly paramsTarget: AnyParams;
  readonly candidateParams: AnyParams;
  readonly committedParams: AnyParams;
  readonly state: unknown;
  readonly handle: GlyphEffectLayerHandle<AnyParams>;
  target: "surfaces" | "viewport";
  blend: GlyphEffectBlend;
  opacity: number;
  order: number;
  enabled: boolean;
  disposed: boolean;
}

export interface PreparedGlyphEffectLayer {
  readonly layer: RuntimeGlyphEffectLayer;
  readonly params: Readonly<AnyParams>;
}

export interface RetainedGlyphEffectOutput {
  readonly metadata: GlyphEffectOutputMetadata;
  readonly baseGrid: CellGrid;
  readonly base: GlyphEffectFrameView;
  readonly baseColor: Uint32Array;
  readonly baseCoverage: Float32Array;
  readonly inputGlyph: string[];
  readonly inputColor: Uint32Array;
  readonly inputCoverage: Float32Array;
  readonly targetCoverage: Float32Array;
  readonly emission: GlyphEffectOutput;
  readonly packedColorCache: Map<number, string>;
  readonly workingGrid: CellGrid;
}

function assertFiniteNumber(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`glyphcss: ${label} must be a finite number.`);
  }
}

function assertParamValue(value: unknown, spec: GlyphEffectParamSpec | undefined, key: string): asserts value is GlyphEffectParamValue {
  if (spec?.kind === "number") {
    assertFiniteNumber(value, `effect parameter "${key}"`);
    return;
  }
  if (spec?.kind === "boolean") {
    if (typeof value !== "boolean") throw new TypeError(`glyphcss: effect parameter "${key}" must be boolean.`);
    return;
  }
  if (spec?.kind === "string") {
    if (typeof value !== "string") throw new TypeError(`glyphcss: effect parameter "${key}" must be a string.`);
    if (spec.values && !spec.values.includes(value)) {
      throw new RangeError(`glyphcss: effect parameter "${key}" must be one of: ${spec.values.join(", ")}.`);
    }
    return;
  }
  if (spec?.kind === "color") {
    if (typeof value !== "string") throw new TypeError(`glyphcss: effect parameter "${key}" must be a color string.`);
    parseGlyphEffectColor(value);
    return;
  }
  if (typeof value === "number") {
    assertFiniteNumber(value, `effect parameter "${key}"`);
    return;
  }
  if (typeof value !== "string" && typeof value !== "boolean") {
    throw new TypeError(`glyphcss: effect parameter "${key}" must be a number, string, or boolean.`);
  }
}

function validateSchema(schema: GlyphEffectParamSchema): void {
  for (const [key, spec] of Object.entries(schema)) {
    if (!key) throw new TypeError("glyphcss: effect parameter names cannot be empty.");
    if (!spec || typeof spec !== "object") throw new TypeError(`glyphcss: invalid schema for effect parameter "${key}".`);
    assertParamValue(spec.default, spec, key);
    if (spec.step !== undefined) {
      assertFiniteNumber(spec.step, `effect parameter "${key}" step`);
      if (spec.step <= 0) throw new RangeError(`glyphcss: effect parameter "${key}" step must be positive.`);
    }
    if (spec.kind === "number") {
      if (spec.min !== undefined) assertFiniteNumber(spec.min, `effect parameter "${key}" min`);
      if (spec.max !== undefined) assertFiniteNumber(spec.max, `effect parameter "${key}" max`);
      if (spec.min !== undefined && spec.max !== undefined && spec.min > spec.max) {
        throw new RangeError(`glyphcss: effect parameter "${key}" min cannot exceed max.`);
      }
    }
  }
}

function isDefinition(value: unknown): value is GlyphEffectDefinition<GlyphEffectParamSchema, unknown> {
  return !!value && typeof value === "object" && "parameterSchema" in value && "program" in value;
}

function assertProgram(program: AnyProgram, initialParams: AnyParams): void {
  if (!program || typeof program !== "object" || typeof program.evaluate !== "function") {
    throw new TypeError("glyphcss: an effect program must define evaluate().");
  }
  for (const requirement of [
    ...(program.requirements ?? []),
    ...(program.optionalRequirements ?? []),
    // Only the INITIAL params are checked here (mount time); `dynamicRequirements`
    // is re-evaluated per params transaction thereafter (see `effectRequests` in
    // `createGlyphScene.ts`), so a requirement name that only becomes reachable
    // through a later param value is caught the first time that value is live,
    // not necessarily at mount.
    ...(program.dynamicRequirements?.(initialParams) ?? []),
  ]) {
    if (!SUPPORTED_REQUIREMENTS.has(requirement)) {
      throw new Error(`glyphcss: effect requirement "${requirement}" is not supported by this runtime slice.`);
    }
  }
  if (program.sceneSampling !== undefined) {
    throw new Error("glyphcss: canonical scene sampling is not supported by this runtime slice.");
  }
  const scratch = program.scratch;
  if (scratch && Object.values(scratch).some((count) => count !== undefined && count !== 0)) {
    throw new Error("glyphcss: effect scratch buffers are not supported by this runtime slice.");
  }
}

function normalizeTarget(target: GlyphEffectTarget | undefined): "surfaces" | "viewport" {
  if (target === undefined || target === "surfaces") return "surfaces";
  if (target === "viewport") return "viewport";
  throw new Error("glyphcss: GlyphMeshHandle effect targets are not supported by this runtime slice.");
}

function normalizeBlend(blend: GlyphEffectBlend | undefined): GlyphEffectBlend {
  if (blend === undefined || blend === "over") return "over";
  if (blend === "replace") return "replace";
  throw new TypeError(`glyphcss: unsupported effect blend "${String(blend)}".`);
}

function normalizeOpacity(opacity: number | undefined): number {
  if (opacity === undefined) return 1;
  assertFiniteNumber(opacity, "effect opacity");
  if (opacity < 0 || opacity > 1) throw new RangeError("glyphcss: effect opacity must be in 0..1.");
  return opacity;
}

function normalizeOrder(order: number | undefined): number {
  if (order === undefined) return 0;
  assertFiniteNumber(order, "effect order");
  return order;
}

function copyParams(target: AnyParams, source: Readonly<AnyParams>): void {
  for (const key of Object.keys(target)) target[key] = source[key]!;
}

function paramsEqual(a: Readonly<AnyParams>, b: Readonly<AnyParams>): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => Object.is(a[key], b[key]));
}

function requirementSetKey(requirements: readonly GlyphEffectRequirement[] | undefined): string {
  if (!requirements || requirements.length === 0) return "";
  return Array.from(new Set(requirements)).sort().join(",");
}

/**
 * Whether a params change altered `program.dynamicRequirements`'s result
 * (order-independent). A plain params change only needs a cheap retained-
 * effect recompose; a REQUIREMENTS change additionally invalidates whatever
 * retained input buffers the previous requirement set produced (e.g. a
 * newly-live `objectExit` need), which only a full geometry render repopulates
 * — see the `onDirty(requirementsChanged)` callers below and their
 * `createGlyphScene.ts` handling.
 */
function dynamicRequirementsChanged(program: AnyProgram, before: Readonly<AnyParams>, after: Readonly<AnyParams>): boolean {
  if (!program.dynamicRequirements) return false;
  return requirementSetKey(program.dynamicRequirements(before)) !== requirementSetKey(program.dynamicRequirements(after));
}

export function createRuntimeGlyphEffectLayer<P extends GlyphEffectParamShape<P>, State>(
  options: GlyphEffectDefinitionLayerOptions<any, State> | GlyphEffectProgramLayerOptions<P, State>,
  declarationOrder: number,
  onDirty: (requirementsChanged?: boolean) => void,
  onDispose: (layer: RuntimeGlyphEffectLayer) => void,
): RuntimeGlyphEffectLayer {
  const effect = options.effect as unknown;
  let schema: GlyphEffectParamSchema | undefined;
  let program: AnyProgram;
  const initial: AnyParams = {};

  if (isDefinition(effect)) {
    if (typeof effect.id !== "string" || !effect.id.trim()) throw new TypeError("glyphcss: an effect definition needs a non-empty id.");
    if (!Number.isInteger(effect.version) || effect.version < 1) throw new RangeError("glyphcss: an effect definition version must be a positive integer.");
    schema = effect.parameterSchema;
    validateSchema(schema);
    program = effect.program as AnyProgram;
    const overrides = (options.params ?? {}) as Record<string, unknown>;
    for (const key of Object.keys(overrides)) {
      if (!(key in schema)) throw new TypeError(`glyphcss: unknown effect parameter "${key}".`);
    }
    for (const [key, spec] of Object.entries(schema)) {
      const value = Object.prototype.hasOwnProperty.call(overrides, key) ? overrides[key] : spec.default;
      assertParamValue(value, spec, key);
      initial[key] = value;
    }
  } else {
    program = effect as AnyProgram;
    const supplied = (options as GlyphEffectProgramLayerOptions<P, State>).params as unknown;
    if (!supplied || typeof supplied !== "object" || Array.isArray(supplied)) {
      throw new TypeError("glyphcss: a raw effect program requires a complete flat params object.");
    }
    for (const [key, value] of Object.entries(supplied)) {
      assertParamValue(value, undefined, key);
      initial[key] = value;
    }
  }

  assertProgram(program, initial);
  program.validateParams?.(initial);

  const paramsTarget: AnyParams = { ...initial };
  const candidateParams: AnyParams = { ...initial };
  const committedParams: AnyParams = { ...initial };
  const state = program.createState ? program.createState() : undefined;
  let layer!: RuntimeGlyphEffectLayer;

  const params = new Proxy(paramsTarget, {
    set(target, property, value): boolean {
      if (typeof property === "symbol") return Reflect.set(target, property, value);
      if (layer.disposed) throw new Error("glyphcss: cannot mutate a disposed effect layer.");
      if (!Object.prototype.hasOwnProperty.call(target, property)) {
        throw new TypeError(`glyphcss: unknown effect parameter "${property}".`);
      }
      assertParamValue(value, schema?.[property], property);
      if (Object.is(target[property], value)) return true;
      const before = { ...target };
      target[property] = value;
      onDirty(dynamicRequirementsChanged(program, before, target));
      return true;
    },
    defineProperty(target, property, descriptor): boolean {
      if (typeof property === "symbol") return Reflect.defineProperty(target, property, descriptor);
      if (layer.disposed) throw new Error("glyphcss: cannot mutate a disposed effect layer.");
      if (!Object.prototype.hasOwnProperty.call(target, property)) {
        throw new TypeError(`glyphcss: unknown effect parameter "${property}".`);
      }
      if ("get" in descriptor || "set" in descriptor) {
        throw new TypeError(`glyphcss: effect parameter "${property}" must remain a data property.`);
      }
      if (descriptor.writable === false || descriptor.enumerable === false || descriptor.configurable === false) {
        throw new TypeError(
          `glyphcss: effect parameter "${property}" must remain writable, enumerable, and configurable.`,
        );
      }
      if (!("value" in descriptor)) return Reflect.defineProperty(target, property, descriptor);
      assertParamValue(descriptor.value, schema?.[property], property);
      const changed = !Object.is(target[property], descriptor.value);
      const before = { ...target };
      const defined = Reflect.defineProperty(target, property, descriptor);
      if (defined && changed) onDirty(dynamicRequirementsChanged(program, before, target));
      return defined;
    },
    deleteProperty(target, property): boolean {
      if (typeof property === "symbol") return Reflect.deleteProperty(target, property);
      throw new TypeError(`glyphcss: effect parameter "${property}" cannot be deleted.`);
    },
  }) as AnyParams;

  function assertLive(): void {
    if (layer.disposed) throw new Error("glyphcss: effect layer is disposed.");
  }

  function setParams(partial: Partial<AnyParams>): void {
    assertLive();
    if (!partial || typeof partial !== "object" || Array.isArray(partial)) {
      throw new TypeError("glyphcss: setParams() expects a flat parameter object.");
    }
    copyParams(candidateParams, paramsTarget);
    for (const [key, value] of Object.entries(partial)) {
      if (!Object.prototype.hasOwnProperty.call(paramsTarget, key)) {
        throw new TypeError(`glyphcss: unknown effect parameter "${key}".`);
      }
      assertParamValue(value, schema?.[key], key);
      candidateParams[key] = value;
    }
    program.validateParams?.(candidateParams);
    if (paramsEqual(candidateParams, paramsTarget)) return;
    const before = { ...paramsTarget };
    copyParams(paramsTarget, candidateParams);
    onDirty(dynamicRequirementsChanged(program, before, paramsTarget));
  }

  function setOptions(partial: Partial<{
    target: GlyphEffectTarget;
    blend: GlyphEffectBlend;
    opacity: number;
    order: number;
    enabled: boolean;
  }>): void {
    assertLive();
    const nextTarget = "target" in partial ? normalizeTarget(partial.target) : layer.target;
    const nextBlend = "blend" in partial ? normalizeBlend(partial.blend) : layer.blend;
    const nextOpacity = "opacity" in partial ? normalizeOpacity(partial.opacity) : layer.opacity;
    const nextOrder = "order" in partial ? normalizeOrder(partial.order) : layer.order;
    const nextEnabled = "enabled" in partial ? partial.enabled : layer.enabled;
    if (typeof nextEnabled !== "boolean") throw new TypeError("glyphcss: effect enabled must be boolean.");
    if (
      nextTarget === layer.target && nextBlend === layer.blend && nextOpacity === layer.opacity &&
      nextOrder === layer.order && nextEnabled === layer.enabled
    ) return;
    layer.target = nextTarget;
    layer.blend = nextBlend;
    layer.opacity = nextOpacity;
    layer.order = nextOrder;
    layer.enabled = nextEnabled;
    onDirty();
  }

  const handle: GlyphEffectLayerHandle<AnyParams> = {
    get params() { return params; },
    get disposed() { return layer.disposed; },
    get enabled() { return layer.enabled; },
    set enabled(value: boolean) { setOptions({ enabled: value }); },
    get opacity() { return layer.opacity; },
    set opacity(value: number) { setOptions({ opacity: value }); },
    get order() { return layer.order; },
    set order(value: number) { setOptions({ order: value }); },
    setParams,
    setOptions,
    invalidate() {
      assertLive();
      onDirty();
    },
    dispose() {
      if (layer.disposed) return;
      layer.disposed = true;
      onDispose(layer);
    },
  };

  layer = {
    declarationOrder,
    program,
    paramsTarget,
    candidateParams,
    committedParams,
    state,
    handle,
    target: normalizeTarget(options.target),
    blend: normalizeBlend(options.blend),
    opacity: normalizeOpacity(options.opacity),
    order: normalizeOrder(options.order),
    enabled: options.enabled ?? true,
    disposed: false,
  };
  if (typeof layer.enabled !== "boolean") throw new TypeError("glyphcss: effect enabled must be boolean.");
  return layer;
}

export function prepareRuntimeGlyphEffectLayers(
  layers: readonly RuntimeGlyphEffectLayer[],
  sceneGridSize: readonly [number, number],
): PreparedGlyphEffectLayer[] {
  const sorted = layers
    .filter((layer) => !layer.disposed && layer.enabled)
    .sort((a, b) => a.order - b.order || a.declarationOrder - b.declarationOrder);

  for (const layer of sorted) {
    copyParams(layer.candidateParams, layer.paramsTarget);
    layer.program.validateParams?.(layer.candidateParams);
  }
  for (const layer of sorted) copyParams(layer.committedParams, layer.candidateParams);
  for (const layer of sorted) {
    layer.program.prepare?.({ params: layer.committedParams, sceneGridSize }, layer.state as any);
  }
  return sorted.map((layer) => ({ layer, params: layer.committedParams }));
}

function packCellColor(color: string | null): number {
  return color === null ? GlyphEffectNoColor : parseGlyphEffectColor(color).packed;
}

function unpackCellColor(color: number): string | null {
  if (color === GlyphEffectNoColor) return null;
  return `#${color.toString(16).padStart(6, "0")}`;
}

function composedCellColor(retained: RetainedGlyphEffectOutput, index: number, packed: number): string | null {
  if (packed === GlyphEffectNoColor) return null;
  if (packed === retained.baseColor[index]) return retained.baseGrid.color[index] ?? null;
  const cached = retained.packedColorCache.get(packed);
  if (cached !== undefined) return cached;
  const color = unpackCellColor(packed)!;
  retained.packedColorCache.set(packed, color);
  return color;
}

export function retainGlyphEffectOutput(
  grid: CellGrid,
  metadata: GlyphEffectOutputMetadata,
): RetainedGlyphEffectOutput {
  const baseGrid = cloneCellGrid(grid);
  const n = baseGrid.cols * baseGrid.rows;
  const baseColor = new Uint32Array(n);
  const baseCoverage = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    baseColor[i] = packCellColor(baseGrid.color[i] ?? null);
    baseCoverage[i] = Number.isFinite(baseGrid.depth[i]!) ? 1 : 0;
  }
  let uv0 = baseGrid.surfaceUv;
  if (!uv0) {
    uv0 = new Float32Array(n * 2);
    uv0.fill(Number.NaN);
  }
  const base: GlyphEffectFrameView = {
    cols: baseGrid.cols,
    rows: baseGrid.rows,
    length: n,
    glyph: baseGrid.char,
    coverage: baseCoverage,
    color: baseColor,
    depth: baseGrid.depth,
    uv0,
    ...(baseGrid.shade ? { shade: baseGrid.shade } : {}),
    ...(baseGrid.worldPosition ? { worldPosition: baseGrid.worldPosition } : {}),
    ...(baseGrid.objectPosition ? { objectPosition: baseGrid.objectPosition } : {}),
    ...(baseGrid.objectExit ? { objectExit: baseGrid.objectExit } : {}),
    ...(baseGrid.normal ? { normal: baseGrid.normal } : {}),
  };
  return {
    metadata,
    baseGrid,
    base,
    baseColor,
    baseCoverage,
    inputGlyph: new Array<string>(n).fill(" "),
    inputColor: new Uint32Array(n),
    inputCoverage: new Float32Array(n),
    targetCoverage: new Float32Array(n),
    emission: {
      glyph: new Array<string>(n).fill(" "),
      color: new Uint32Array(n),
      coverage: new Float32Array(n),
      channels: new Uint8Array(n),
    },
    packedColorCache: new Map(),
    workingGrid: cloneCellGrid(baseGrid),
  };
}

function assertSingleGlyph(glyph: string): void {
  if (!isSingleCellGlyph(glyph)) {
    throw new TypeError("glyphcss: effect output glyphs must contain exactly one printable character.");
  }
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function isPackedColor(value: number): boolean {
  return value >= 0 && value <= 0xffffff && Number.isInteger(value);
}

function blendPackedColor(
  input: number,
  emitted: number,
  inputWeight: number,
  emittedWeight: number,
): number {
  const inputPacked = isPackedColor(input);
  const emittedPacked = isPackedColor(emitted);
  if (inputPacked && emittedPacked) {
    const total = inputWeight + emittedWeight;
    if (total <= 0) return emitted;
    const r = Math.floor((((input >>> 16) & 0xff) * inputWeight + ((emitted >>> 16) & 0xff) * emittedWeight) / total + 0.5);
    const g = Math.floor((((input >>> 8) & 0xff) * inputWeight + ((emitted >>> 8) & 0xff) * emittedWeight) / total + 0.5);
    const b = Math.floor(((input & 0xff) * inputWeight + (emitted & 0xff) * emittedWeight) / total + 0.5);
    return (r << 16) | (g << 8) | b;
  }
  if (inputPacked !== emittedPacked) return emittedWeight >= inputWeight ? emitted : input;
  return GlyphEffectNoColor;
}

const BAYER_4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5] as const;

function positiveMod(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

function coverageThreshold(
  col: number,
  row: number,
  affine: readonly [number, number, number, number, number, number],
): number {
  const x = affine[0] * (col + 0.5) + affine[2] * (row + 0.5) + affine[4];
  const y = affine[1] * (col + 0.5) + affine[3] * (row + 0.5) + affine[5];
  const mx = Math.floor(4 * x);
  const my = Math.floor(4 * y);
  const coarse = BAYER_4[positiveMod(Math.floor(my / 4), 4) * 4 + positiveMod(Math.floor(mx / 4), 4)]!;
  const fine = BAYER_4[positiveMod(my, 4) * 4 + positiveMod(mx, 4)]!;
  return (16 * coarse + fine + 0.5) / 256;
}

export function composeRetainedGlyphEffectOutput(
  retained: RetainedGlyphEffectOutput,
  preparedLayers: readonly PreparedGlyphEffectLayer[],
): CellGrid {
  const { baseGrid, base, baseColor, baseCoverage, metadata } = retained;
  const { inputGlyph, inputColor, inputCoverage, targetCoverage, emission, workingGrid } = retained;
  const n = base.length;
  retained.packedColorCache.clear();
  workingGrid.depth.set(baseGrid.depth);
  if (workingGrid.shade && baseGrid.shade) workingGrid.shade.set(baseGrid.shade);
  if (workingGrid.worldPosition && baseGrid.worldPosition) {
    workingGrid.worldPosition.set(baseGrid.worldPosition);
  }
  if (workingGrid.objectPosition && baseGrid.objectPosition) {
    workingGrid.objectPosition.set(baseGrid.objectPosition);
  }
  if (workingGrid.objectExit && baseGrid.objectExit) {
    workingGrid.objectExit.set(baseGrid.objectExit);
  }
  if (workingGrid.normal && baseGrid.normal) workingGrid.normal.set(baseGrid.normal);
  workingGrid.screenX.set(baseGrid.screenX);
  workingGrid.screenY.set(baseGrid.screenY);
  if (workingGrid.surfaceUv && baseGrid.surfaceUv) workingGrid.surfaceUv.set(baseGrid.surfaceUv);
  for (let i = 0; i < n; i++) {
    inputGlyph[i] = baseGrid.char[i]!;
    inputColor[i] = baseColor[i]!;
    inputCoverage[i] = baseGrid.char[i] === " " ? 0 : 1;
  }

  const coordinates: GlyphEffectCoordinates = {
    cellToSceneGrid: metadata.cellToSceneGrid,
    sceneGridSize: metadata.sceneGridSize,
    localCellFootprint: metadata.localCellFootprint,
    ...(metadata.worldToSceneScale !== undefined
      ? { worldToSceneScale: metadata.worldToSceneScale }
      : {}),
  };
  const input: GlyphEffectImageView = {
    cols: base.cols,
    rows: base.rows,
    length: n,
    glyph: inputGlyph,
    coverage: inputCoverage,
    color: inputColor,
  };
  const target: GlyphEffectTargetView = { coverage: targetCoverage };

  for (const prepared of preparedLayers) {
    const { layer, params } = prepared;
    // Deliberately STATIC `requirements` only, not `dynamicRequirements`:
    // `assertEffectMode` (createGlyphScene.ts) already forces a hard STATIC
    // requirement's mode to `"solid"` at mount time, so these checks only
    // ever fire where the buffer is actually expected to exist. But
    // `dynamicRequirements` has no such mode gate (it can't see the render
    // mode at all — see VOLUMETRIC.md) and is optional-shaped everywhere
    // else in this pipeline (`effectRequests` uses it only to decide what to
    // RETAIN, never to hard-fail); folding it into this hard-throw guard
    // would turn a wireframe/voxel program's dynamic-only `objectExit`
    // request into a synchronous render-killing error instead of the
    // documented degrade-to-undefined (the same way `space: "object"`
    // degrades outside solid mode). Mount-time retention for a LIVE dynamic
    // requirement in solid mode is handled separately by `needsInputRaster`
    // (createGlyphScene.ts's `addEffectLayer`), so this guard doesn't need
    // to duplicate that as a hard failure here.
    if (layer.program.requirements?.includes("baseShade") && !base.shade) {
      throw new Error("glyphcss: retained base shading is unavailable for an effect that requires baseShade.");
    }
    if (layer.program.requirements?.includes("worldPosition") && !base.worldPosition) {
      throw new Error("glyphcss: retained world positions are unavailable for an effect that requires worldPosition.");
    }
    if (layer.program.requirements?.includes("objectPosition") && !base.objectPosition) {
      throw new Error("glyphcss: retained object positions are unavailable for an effect that requires objectPosition.");
    }
    if (layer.program.requirements?.includes("objectExit") && !base.objectExit) {
      throw new Error("glyphcss: retained object exit positions are unavailable for an effect that requires objectExit.");
    }
    if (layer.program.requirements?.includes("normal") && !base.normal) {
      throw new Error("glyphcss: retained face normals are unavailable for an effect that requires normal.");
    }
    for (let i = 0; i < n; i++) {
      targetCoverage[i] = layer.target === "viewport" && metadata.isBase ? 1 : baseCoverage[i]!;
    }
    emission.glyph.fill(" ");
    emission.coverage.fill(0);
    emission.channels.fill(0);
    emission.color.fill(GlyphEffectNoColor);
    layer.program.evaluate({
      params,
      state: layer.state as any,
      base,
      input,
      target,
      coordinates,
      scratch: EMPTY_SCRATCH,
      output: emission,
    });

    for (let i = 0; i < n; i++) {
      const channels = emission.channels[i]!;
      if ((channels & ~3) !== 0) throw new RangeError(`glyphcss: invalid effect output channel flags at cell ${i}.`);
      const rawCoverage = emission.coverage[i]!;
      if (!Number.isFinite(rawCoverage)) throw new RangeError(`glyphcss: non-finite effect coverage at cell ${i}.`);
      const emittedCoverage = clamp01(rawCoverage);
      const inputCellCoverage = inputCoverage[i]!;
      const targetCellCoverage = clamp01(targetCoverage[i]!);
      const opacity = layer.opacity;
      const emittedWeight = emittedCoverage * opacity * targetCellCoverage;
      const inputWeight = layer.blend === "over"
        ? inputCellCoverage * (1 - emittedWeight)
        : inputCellCoverage * (1 - opacity * targetCellCoverage);
      const nextCoverage = clamp01(emittedWeight + inputWeight);

      const hasGlyph = (channels & GlyphEffectOutputChannel.Glyph) !== 0;
      const emittedGlyph = hasGlyph ? emission.glyph[i]! : inputGlyph[i]!;
      if (hasGlyph) assertSingleGlyph(emittedGlyph);
      const hasColor = (channels & GlyphEffectOutputChannel.Color) !== 0;
      const emittedColor = hasColor ? emission.color[i]! : inputColor[i]!;
      if (hasColor && emittedColor !== GlyphEffectNoColor && !isPackedColor(emittedColor)) {
        throw new RangeError(`glyphcss: invalid packed effect color at cell ${i}.`);
      }

      const chooseEmitted = emittedWeight >= inputWeight;
      inputGlyph[i] = chooseEmitted ? emittedGlyph : inputGlyph[i]!;
      inputColor[i] = blendPackedColor(inputColor[i]!, emittedColor, inputWeight, emittedWeight);
      inputCoverage[i] = nextCoverage;
    }
  }

  const affine = metadata.cellToSceneGrid;
  for (let row = 0; row < baseGrid.rows; row++) {
    for (let col = 0; col < baseGrid.cols; col++) {
      const i = row * baseGrid.cols + col;
      const coverage = inputCoverage[i]!;
      const visible = coverage >= 1 || (coverage > 0 && coverage > coverageThreshold(col, row, affine));
      workingGrid.char[i] = visible ? inputGlyph[i]! : " ";
      workingGrid.color[i] = visible ? composedCellColor(retained, i, inputColor[i]!) : null;
    }
  }
  return workingGrid;
}
