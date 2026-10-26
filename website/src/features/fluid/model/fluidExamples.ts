import { GLYPH_FLUID_SIM_TUNING, type GlyphFluidTuning } from "@glyphcss/fluid";
import { PRESETS } from "../../gallery/data";
import type { ModelAttribution, PresetModel } from "../../gallery/model/types";
import {
  FLUID_DEFAULTS,
  FLUID_HEADING_COLOR,
  FLUID_READER_DEFAULTS,
  type FluidEncoding,
  type FluidFps,
} from "./fluidWorkbench";

export type FluidExampleKind = "text" | "image" | "mesh" | "reader" | "zones";
export type FluidReaderLook = "plain" | "glyph";
export type FluidReaderFont = "render" | "ui" | "prose" | "molty";

/**
 * Every option the /fluid workbench exposes, flat: `createGlyphFluid`'s own options,
 * the active example's target / zone / reader options, and the ripple button's impulse.
 */
export interface FluidConfig {
  readonly glue: "host" | "document";
  readonly shape: "rect" | "circle";
  readonly encoding: FluidEncoding;
  readonly face: "dots" | "universal";
  readonly fps: FluidFps;
  readonly fpsFallback: boolean;
  readonly worker: boolean;
  readonly clock: "auto" | "manual";
  readonly reducedMotion: "settle" | "animate";
  readonly pointer: "host" | "window" | "none";
  readonly shimmer: number;
  readonly fieldColor: string;
  readonly fieldLevel: number;
  readonly cellAspect: number;
  readonly targetCols: number;
  readonly minCellPx: number;
  readonly maxCellPx: number;
  readonly maxCols: number;
  readonly impulseStrength: number;
  readonly impulseRadius: number;
  readonly color: string;
  readonly delay: number;
  readonly visibility: "always" | "viewport";
  readonly condensed: boolean;
  readonly ink: "luminance" | "alpha";
  readonly meshRotX: number;
  readonly meshRotY: number;
  readonly meshSpin: number;
  readonly meshExtent: number;
  readonly meshAmbient: number;
  readonly meshFeatures: boolean;
  readonly meshSwell: boolean;
  readonly zoneKind: "quiet" | "pool";
  readonly zoneLevel: number;
  readonly text: string;
  readonly wpm: number;
  readonly loop: boolean;
  readonly look: FluidReaderLook;
  readonly font: FluidReaderFont;
  readonly ripple: number;
  readonly readerColor: string;
  readonly leadIn: number;
  readonly ariaLive: "off" | "polite";
}

export type FluidConfigKey = keyof FluidConfig;
export type FluidNumberKey = { [K in FluidConfigKey]: FluidConfig[K] extends number ? K : never }[FluidConfigKey];

/** The package's defaults (the reader's own options as the reader sets them). */
export const FLUID_CONFIG_DEFAULTS: FluidConfig = {
  glue: "host",
  shape: "rect",
  encoding: FLUID_DEFAULTS.encoding,
  face: "dots",
  fps: FLUID_DEFAULTS.fps,
  fpsFallback: true,
  worker: FLUID_DEFAULTS.worker,
  clock: "auto",
  reducedMotion: "settle",
  pointer: "host",
  shimmer: 0.12,
  fieldColor: FLUID_DEFAULTS.fieldColor,
  fieldLevel: FLUID_DEFAULTS.fieldLevel,
  cellAspect: 1.6,
  targetCols: 144,
  minCellPx: 5.4,
  maxCellPx: 10,
  maxCols: 176,
  impulseStrength: 1.5,
  impulseRadius: 0.045,
  color: FLUID_HEADING_COLOR,
  delay: 0,
  visibility: "always",
  condensed: true,
  ink: "luminance",
  meshRotX: 65,
  meshRotY: 45,
  meshSpin: 24,
  meshExtent: 1.15,
  meshAmbient: 0.4,
  meshFeatures: true,
  meshSwell: true,
  zoneKind: "quiet",
  zoneLevel: 0.12,
  text: FLUID_READER_DEFAULTS.text,
  wpm: FLUID_READER_DEFAULTS.wpm,
  loop: FLUID_READER_DEFAULTS.loop,
  look: "plain",
  font: "render",
  ripple: 0.63,
  readerColor: "#f2f5ff",
  leadIn: 550,
  ariaLive: "off",
};

/** Floor multiplier the package gives each zone kind when `level` is omitted. */
export const FLUID_ZONE_LEVELS = { quiet: 0.12, pool: 3.2 } as const;

/** The reader's own grid (`createGlyphFluidReader` sizes a 52-column fluid). */
const READER_GRID: Partial<FluidConfig> = { targetCols: 52, maxCols: 52, minCellPx: 2, maxCellPx: 24 };

export const FLUID_RANGES: Record<FluidNumberKey, { min: number; max: number; step: number }> = {
  fps: { min: 30, max: 60, step: 30 },
  shimmer: { min: 0, max: 0.6, step: 0.01 },
  fieldLevel: { min: 0, max: 0.6, step: 0.01 },
  cellAspect: { min: 1, max: 2.4, step: 0.05 },
  targetCols: { min: 16, max: 240, step: 1 },
  minCellPx: { min: 2, max: 16, step: 0.1 },
  maxCellPx: { min: 4, max: 32, step: 0.5 },
  maxCols: { min: 16, max: 320, step: 1 },
  impulseStrength: { min: 0, max: 4, step: 0.05 },
  impulseRadius: { min: 0.01, max: 0.3, step: 0.005 },
  delay: { min: 0, max: 5, step: 0.1 },
  meshRotX: { min: -180, max: 180, step: 1 },
  meshRotY: { min: 0, max: 360, step: 1 },
  meshSpin: { min: -180, max: 180, step: 1 },
  meshExtent: { min: 0.5, max: 3, step: 0.05 },
  meshAmbient: { min: 0, max: 1, step: 0.01 },
  zoneLevel: { min: 0, max: 6, step: 0.01 },
  wpm: { min: 60, max: 1000, step: 10 },
  ripple: { min: 0, max: 2, step: 0.01 },
  leadIn: { min: 0, max: 3000, step: 50 },
};

export interface FluidExample {
  readonly id: string;
  readonly label: string;
  readonly category: string;
  readonly kind: FluidExampleKind;
  /** Image examples: the picture's URL and its width / height. */
  readonly src?: string;
  readonly aspect?: number;
  /** Mesh examples: the /gallery preset rendered into the fluid. */
  readonly presetId?: string;
  readonly defaults?: Partial<FluidConfig>;
}

const meshExample = (presetId: string, label: string): FluidExample => {
  const preset = PRESETS.find((p) => p.id === presetId);
  return {
    id: `mesh-${presetId.replace(/^primitive-/, "")}`,
    label,
    category: "Meshes",
    kind: "mesh",
    presetId,
    defaults: { meshRotX: preset?.rotX ?? 65, meshRotY: preset?.rotY ?? 45 },
  };
};

/** Example ids are URL state: frozen once shipped. */
export const FLUID_EXAMPLES: readonly FluidExample[] = [
  { id: "heading", label: "Heading", category: "Text", kind: "text" },
  {
    id: "image-poly",
    label: "PolyCSS logo",
    category: "Image",
    kind: "image",
    src: "/voxisologo.png",
    aspect: 2048 / 682,
  },
  { id: "image-js", label: "JS logo", category: "Image", kind: "image", src: "/jslogo.png", aspect: 1 },
  meshExample("teapot", "Teapot"),
  meshExample("chicken", "Chicken"),
  meshExample("saucer", "Flying saucer"),
  meshExample("insurgent", "Ship - Insurgent"),
  meshExample("primitive-torus", "Torus"),
  meshExample("primitive-icosahedron", "Icosahedron"),
  { id: "reader-plain", label: "Reader · plain", category: "Reader", kind: "reader", defaults: { look: "plain" } },
  { id: "reader-glyph", label: "Reader · glyph", category: "Reader", kind: "reader", defaults: { look: "glyph" } },
  { id: "stir", label: "Stir & zones", category: "Pointer", kind: "zones" },
];

export const FLUID_DEFAULT_EXAMPLE = FLUID_EXAMPLES[0]!;

export function findFluidExample(id: string | null | undefined): FluidExample | undefined {
  return FLUID_EXAMPLES.find((example) => example.id === id);
}

export function fluidExamplePreset(example: FluidExample): PresetModel | undefined {
  return example.presetId ? PRESETS.find((p) => p.id === example.presetId) : undefined;
}

export function fluidExampleAttribution(example: FluidExample): ModelAttribution | undefined {
  return fluidExamplePreset(example)?.attribution;
}

/** What each control starts at for `example`: the package's defaults, then the example's. */
export function fluidExampleDefaults(example: FluidExample): FluidConfig {
  return {
    ...FLUID_CONFIG_DEFAULTS,
    ...(example.kind === "reader" ? { shape: "circle" as const, ...READER_GRID } : {}),
    ...example.defaults,
  };
}

/** Dropping the overrides equal to `defaults` keeps the URL to what the reader changed. */
export function pruneFluidOverrides(overrides: Partial<FluidConfig>, defaults: FluidConfig): Partial<FluidConfig> {
  return Object.fromEntries(
    Object.entries(overrides).filter(([key, value]) => value !== defaults[key as FluidConfigKey]),
  ) as Partial<FluidConfig>;
}

// ── Sim tuning ────────────────────────────────────────────────────────────

/** Tunables the sim reads from `tuning` on every step. */
export const FLUID_TUNABLE_KEYS = [
  "c2",
  "damp",
  "leak",
  "attract",
  "drag",
  "vmax",
  "relaxUp",
  "relaxDown",
  "swirl",
  "swirlFreq",
  "refr",
  "crest",
  "speedMul",
  "bgFreq",
  "bgDrift",
  "bgSpeed",
  "bgMob",
] as const satisfies readonly (keyof GlyphFluidTuning)[];

export type FluidTunableKey = (typeof FLUID_TUNABLE_KEYS)[number];
export type FluidTuning = Partial<Record<FluidTunableKey, number>>;

export const FLUID_TUNING_RANGES: Record<FluidTunableKey, { min: number; max: number; step: number }> = {
  c2: { min: 0, max: 0.3, step: 0.005 },
  damp: { min: 0.9, max: 1, step: 0.001 },
  leak: { min: 0.9, max: 1, step: 0.001 },
  attract: { min: 0, max: 200, step: 1 },
  drag: { min: 0, max: 10, step: 0.1 },
  vmax: { min: 0, max: 80, step: 1 },
  relaxUp: { min: 0, max: 12, step: 0.1 },
  relaxDown: { min: 0, max: 12, step: 0.1 },
  swirl: { min: 0, max: 3, step: 0.05 },
  swirlFreq: { min: 0, max: 8, step: 0.05 },
  refr: { min: 0, max: 3, step: 0.05 },
  crest: { min: 0, max: 2, step: 0.05 },
  speedMul: { min: 0, max: 3, step: 0.05 },
  bgFreq: { min: 0, max: 8, step: 0.05 },
  bgDrift: { min: 0, max: 0.5, step: 0.01 },
  bgSpeed: { min: 0, max: 1, step: 0.01 },
  bgMob: { min: 0, max: 2, step: 0.01 },
};

/**
 * Tunables the package owns elsewhere, shown dimmed with the reason: the step rewrites
 * `hold` and `tintRate` every frame, `bgRim` is read once at construction from molty's
 * constant, and `field` sets `bgLevel` / `bgColor`.
 */
export const FLUID_INERT_TUNING: readonly { key: keyof GlyphFluidTuning; reason: string }[] = [
  { key: "tintRate", reason: "The step sets tintRate from hold every frame." },
  { key: "hold", reason: "The runtime drives hold from the time since the last target change." },
  { key: "bgRim", reason: "The disc's rim fade is computed once from molty's constant." },
  { key: "bgLevel", reason: "Set by Fluid → field level (field.level)." },
  { key: "bgColor", reason: "Set by Fluid → field color (field.color)." },
];

/**
 * molty's `SIM_TUNING` as the fluid actually runs it: both shapes give the page fluid's
 * relax rates, and the reader its faster text rates.
 */
export function fluidTuningDefaults(example: FluidExample): Record<FluidTunableKey, number> {
  const base = Object.fromEntries(FLUID_TUNABLE_KEYS.map((key) => [key, GLYPH_FLUID_SIM_TUNING[key]])) as Record<
    FluidTunableKey,
    number
  >;
  return example.kind === "reader" ? { ...base, relaxUp: 7, relaxDown: 2.4 } : { ...base, relaxUp: 3, relaxDown: 2.4 };
}

export function pruneFluidTuning(tuning: FluidTuning, defaults: Record<FluidTunableKey, number>): FluidTuning {
  return Object.fromEntries(
    Object.entries(tuning).filter(([key, value]) => value !== defaults[key as FluidTunableKey]),
  ) as FluidTuning;
}
