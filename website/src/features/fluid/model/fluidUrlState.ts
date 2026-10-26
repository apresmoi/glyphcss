// /fluid's link: `?example=<id>` names the example; `?f=` packs the options that differ
// from that example's defaults and `?sim=` the changed sim tunables, both with the
// shared packed codec. Append-only: tokens and enum value lists only ever grow (an
// enum packs as its index), and a malformed field degrades to absent.
import { createUrlCodec, type UrlField, type UrlFieldKind } from "../../../utils/url-state/codec";
import {
  FLUID_RANGES,
  FLUID_TUNABLE_KEYS,
  FLUID_TUNING_RANGES,
  findFluidExample,
  type FluidConfig,
  type FluidConfigKey,
  type FluidExample,
  type FluidTunableKey,
  type FluidTuning,
} from "./fluidExamples";

export const FLUID_EXAMPLE_PARAM = "example";
export const FLUID_CONFIG_PARAM = "f";
export const FLUID_TUNING_PARAM = "sim";
const VERSION = "1";
const TEXT_MAX = 600;

const bool: UrlFieldKind = { kind: "bool" };
const color: UrlFieldKind = { kind: "color" };
const float = (step: number): UrlFieldKind => ({ kind: "float", step });
const int: UrlFieldKind = { kind: "int" };
const oneOf = (...values: string[]): UrlFieldKind => ({ kind: "enum", values });

const CONFIG_FIELDS: readonly { key: FluidConfigKey; token: string; type: UrlFieldKind }[] = [
  { key: "glue", token: "g", type: oneOf("host", "document") },
  { key: "shape", token: "s", type: oneOf("rect", "circle") },
  { key: "encoding", token: "e", type: oneOf("atlas", "mono") },
  { key: "face", token: "F", type: oneOf("dots", "universal") },
  { key: "fps", token: "p", type: int },
  { key: "fpsFallback", token: "P", type: bool },
  { key: "worker", token: "w", type: bool },
  { key: "clock", token: "k", type: oneOf("auto", "manual") },
  { key: "reducedMotion", token: "m", type: oneOf("settle", "animate") },
  { key: "pointer", token: "o", type: oneOf("host", "window", "none") },
  { key: "shimmer", token: "h", type: float(0.01) },
  { key: "fieldColor", token: "c", type: color },
  { key: "fieldLevel", token: "l", type: float(0.01) },
  { key: "cellAspect", token: "a", type: float(0.05) },
  { key: "targetCols", token: "t", type: int },
  { key: "minCellPx", token: "n", type: float(0.1) },
  { key: "maxCellPx", token: "x", type: float(0.5) },
  { key: "maxCols", token: "X", type: int },
  { key: "impulseStrength", token: "i", type: float(0.05) },
  { key: "impulseRadius", token: "r", type: float(0.005) },
  { key: "color", token: "C", type: color },
  { key: "delay", token: "d", type: float(0.1) },
  { key: "visibility", token: "v", type: oneOf("always", "viewport") },
  { key: "condensed", token: "D", type: bool },
  { key: "ink", token: "I", type: oneOf("luminance", "alpha") },
  { key: "meshRotX", token: "R", type: int },
  { key: "meshRotY", token: "Y", type: int },
  { key: "meshSpin", token: "S", type: int },
  { key: "meshExtent", token: "E", type: float(0.05) },
  { key: "meshAmbient", token: "A", type: float(0.01) },
  { key: "meshFeatures", token: "u", type: bool },
  { key: "meshSwell", token: "W", type: bool },
  { key: "zoneKind", token: "z", type: oneOf("quiet", "pool") },
  { key: "zoneLevel", token: "Z", type: float(0.01) },
  { key: "text", token: "T", type: { kind: "string" } },
  { key: "wpm", token: "q", type: int },
  { key: "loop", token: "L", type: bool },
  { key: "look", token: "K", type: oneOf("plain", "glyph") },
  { key: "font", token: "f", type: oneOf("render", "ui", "prose", "molty") },
  { key: "ripple", token: "j", type: float(0.01) },
  { key: "readerColor", token: "J", type: color },
  { key: "leadIn", token: "N", type: int },
  { key: "ariaLive", token: "V", type: oneOf("off", "polite") },
];

const TUNING_TOKENS: Record<FluidTunableKey, string> = {
  c2: "c",
  damp: "d",
  leak: "l",
  attract: "a",
  drag: "g",
  vmax: "v",
  relaxUp: "u",
  relaxDown: "D",
  swirl: "s",
  swirlFreq: "S",
  refr: "r",
  crest: "C",
  speedMul: "m",
  bgFreq: "f",
  bgDrift: "t",
  bgSpeed: "p",
  bgMob: "b",
};

function configCodec(defaults: FluidConfig) {
  const fields = CONFIG_FIELDS.map((f) => ({ ...f, default: defaults[f.key] })) as UrlField<FluidConfig>[];
  return createUrlCodec<FluidConfig>(VERSION, fields);
}

function tuningCodec(defaults: Record<FluidTunableKey, number>) {
  const fields = FLUID_TUNABLE_KEYS.map((key) => ({
    key,
    token: TUNING_TOKENS[key],
    type: float(FLUID_TUNING_RANGES[key].step),
    default: defaults[key],
  }));
  return createUrlCodec<Record<FluidTunableKey, number>>(VERSION, fields);
}

const packed = (raw: string) => (raw.length > 2 ? raw : null);
const inRange = (value: unknown, range: { min: number; max: number }) =>
  typeof value === "number" && Number.isFinite(value) && value >= range.min && value <= range.max;

/** The packed `?f=` value for `config`, or null when it equals the example's defaults. */
export function encodeFluidConfig(config: FluidConfig, defaults: FluidConfig): string | null {
  return packed(configCodec(defaults).encode(config));
}

/** Every field the link carries that is in range; anything else is absent. */
export function decodeFluidConfig(raw: string | null | undefined): Partial<FluidConfig> {
  const decoded = configCodec({} as FluidConfig).decode(raw) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(decoded)) {
    const range = FLUID_RANGES[key as keyof typeof FLUID_RANGES];
    if (key === "fps") {
      if (value === 30 || value === 60) out[key] = value;
    } else if (range) {
      if (inRange(value, range)) out[key] = value;
    } else if (key === "text") {
      if (typeof value === "string" && value.trim() && value.length <= TEXT_MAX) out[key] = value;
    } else out[key] = value;
  }
  return out as Partial<FluidConfig>;
}

export function encodeFluidTuning(
  tuning: Record<FluidTunableKey, number>,
  defaults: Record<FluidTunableKey, number>,
): string | null {
  return packed(tuningCodec(defaults).encode(tuning));
}

export function decodeFluidTuning(raw: string | null | undefined): FluidTuning {
  const decoded = tuningCodec({} as Record<FluidTunableKey, number>).decode(raw);
  return Object.fromEntries(
    Object.entries(decoded).filter(([key, value]) => inRange(value, FLUID_TUNING_RANGES[key as FluidTunableKey])),
  ) as FluidTuning;
}

export interface FluidUrlState {
  readonly example: FluidExample | undefined;
  readonly config: Partial<FluidConfig>;
  readonly tuning: FluidTuning;
}

export function readFluidUrlState(search: string): FluidUrlState {
  const params = new URLSearchParams(search);
  return {
    example: findFluidExample(params.get(FLUID_EXAMPLE_PARAM)),
    config: decodeFluidConfig(params.get(FLUID_CONFIG_PARAM)),
    tuning: decodeFluidTuning(params.get(FLUID_TUNING_PARAM)),
  };
}
