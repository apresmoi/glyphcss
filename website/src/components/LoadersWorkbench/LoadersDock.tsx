import { useEffect, type ReactNode } from "react";
import { getGlyphEffect, GlyphRamps } from "@glyphcss/effects";
import { useDockGui } from "../Dock/slots";
import { useColor, useFolder, useOption, useSlider, useText, useToggle } from "../Dock/primitives";
import type { Params, ParamValue } from "../SynthWorkbench/synthKit";
import type { LoaderPreset } from "./loaders";

const opts = <T extends string>(list: readonly T[]): Record<string, T> =>
  Object.fromEntries(list.map((v) => [v, v])) as Record<string, T>;

const COMBINE_OPTS = opts(["add", "multiply", "max", "min", "difference"] as const);
const SPACE_OPTS = opts(["auto", "surface", "scene"] as const);
const SUBCELL_OPTS = opts(["1x1", "2x4"] as const);
/** Named character sets, same source /synth and the gallery pick from. */
const RAMP_OPTS: Record<string, string> = Object.fromEntries(Object.entries(GlyphRamps).map(([name, ramp]) => [name, ramp]));
const rampNameFor = (glyphs: string): string =>
  Object.entries(GlyphRamps).find(([, ramp]) => ramp === glyphs)?.[1] ?? "";

/**
 * Right rail for /examples/loaders — the same lil-gui dock /synth uses, with
 * the folders that apply here. There is no Shape row: a loader is always the
 * flat plane, and the box shape is what the stage's size grid varies.
 *
 * Beyond the field-synth patch it exposes each NON-field-synth layer (wipe,
 * scan, ripple, matrix-rain, …) generated from that effect's own
 * `parameterSchema`, so every loader is tunable rather than only the ~20
 * field-synth ones.
 */
export function LoadersDock({ loader, params, onParam, layerParams, onLayerParam, timeScale, onTimeScale, paused, onPaused, density, onDensity }: {
  loader: LoaderPreset;
  params: Params;
  onParam: (key: string, value: ParamValue) => void;
  layerParams: Record<number, Params>;
  onLayerParam: (index: number, key: string, value: ParamValue) => void;
  timeScale: number;
  onTimeScale: (n: number) => void;
  paused: boolean;
  onPaused: (b: boolean) => void;
  /** Rendered cell size in px. Unlike /synth's Density this cannot add cells —
   *  a loader's cols×rows is the example itself — so it scales the glyph box. */
  density: number;
  onDensity: (n: number) => void;
}): ReactNode {
  const gui = useDockGui();
  const s = (k: string) => String(params[k] ?? "");
  const n = (k: string) => Number(params[k] ?? 0);
  const synthIndex = loader.layers.findIndex((l) => l.effectId === "field-synth");
  const hasSynth = synthIndex >= 0;

  const stage = useFolder(gui, "Stage", { open: true });
  useSlider(stage, "Cell size", { min: 6, max: 24, step: 1 }, density, onDensity);
  useSlider(stage, "Speed", { min: 0.05, max: 8, step: 0.05 }, timeScale, onTimeScale);
  useToggle(stage, "Paused", paused, onPaused);

  // Mix/Output configure the field-synth patch. A loader built only from stock
  // effects (scan, ripple, matrix-rain) has no patch, so showing them would be
  // a dozen controls that change nothing.
  const mix = useFolder(hasSynth ? gui : null, "Mix", { open: true });
  useOption(mix, "Mapping", SPACE_OPTS, s("space"), (v) => onParam("space", v));
  useOption(mix, "Combine", COMBINE_OPTS, s("combine"), (v) => onParam("combine", v));
  useSlider(mix, "Scale", { min: 0.1, max: 12, step: 0.1 }, n("scale"), (v) => onParam("scale", v));
  useSlider(mix, "Origin U", { min: 0, max: 1, step: 0.01 }, n("originU"), (v) => onParam("originU", v));
  useSlider(mix, "Origin V", { min: 0, max: 1, step: 0.01 }, n("originV"), (v) => onParam("originV", v));
  useSlider(mix, "Contrast", { min: 0, max: 12, step: 0.05 }, n("gain"), (v) => onParam("gain", v));
  useSlider(mix, "Brightness", { min: -1, max: 2, step: 0.05 }, n("bias"), (v) => onParam("bias", v));

  const output = useFolder(hasSynth ? gui : null, "Output", { open: true });
  useOption(output, "Subcell", SUBCELL_OPTS, s("subcellRes"), (v) => onParam("subcellRes", v));
  // At 2x4 field-synth synthesizes a Braille dot mask per cell and never reads
  // the ramp at all (the ramp branch is the 1x1-only `else` in its evaluate()),
  // so Ramp/Chars are dimmed rather than left live and inert — same treatment
  // /synth gives them.
  const ramp = useOption(output, "Ramp", RAMP_OPTS, rampNameFor(s("glyphs")), (v) => onParam("glyphs", v));
  // An empty ramp leaves the shader with no glyph to index and blanks the
  // render, so reject it instead of accepting an unusable value.
  const chars = useText(output, "Chars", s("glyphs"), (v) => onParam("glyphs", v), (next) => next.length > 0);
  useColor(output, "Color", s("color"), (v) => onParam("color", v));
  useColor(output, "Color B", s("colorB"), (v) => onParam("colorB", v));
  useSlider(output, "Gradient", { min: 0, max: 1, step: 0.05 }, n("gradient"), (v) => onParam("gradient", v));

  const subcellIs2x4 = s("subcellRes") === "2x4";
  useEffect(() => {
    for (const c of [ramp, chars]) {
      if (!c) continue;
      if (subcellIs2x4) { c.raw.disable(); c.raw.$name.title = "Subcell = 2x4 renders a Braille dot mask, not the ramp — Chars/Ramp have no effect."; }
      else { c.raw.enable(); c.raw.$name.title = ""; }
    }
  }, [ramp, chars, subcellIs2x4]);

  // Every layer that is not the field-synth patch, driven straight off its
  // stock `parameterSchema` — no per-effect UI to keep in sync.
  const stockLayers = loader.layers
    .map((layer, index) => ({ layer, index }))
    .filter(({ layer }) => layer.effectId !== "field-synth");

  return (
    <>
      {stockLayers.map(({ layer, index }) => (
        <StockLayerFolder
          key={`${loader.id}-${index}`}
          effectId={layer.effectId}
          index={index}
          params={layerParams[index] ?? {}}
          onParam={onLayerParam}
        />
      ))}
    </>
  );
}

/** One folder per stock layer, built from that effect's parameter schema. */
function StockLayerFolder({ effectId, index, params, onParam }: {
  effectId: string;
  index: number;
  params: Params;
  onParam: (index: number, key: string, value: ParamValue) => void;
}): ReactNode {
  const gui = useDockGui();
  const definition = getGlyphEffect(effectId);
  const folder = useFolder(gui, definition?.label ?? effectId, { open: true });
  const schema = (definition?.parameterSchema ?? {}) as Record<string, {
    kind: string; min?: number; max?: number; step?: number; label?: string;
    values?: readonly string[]; hidden?: boolean; default?: ParamValue;
  }>;

  return (
    <>
      {Object.entries(schema).map(([key, spec]) => (
        <SchemaRow
          key={key}
          folder={folder}
          name={spec.label ?? key}
          spec={spec}
          value={params[key] ?? spec.default ?? ""}
          onChange={(v) => onParam(index, key, v)}
        />
      ))}
    </>
  );
}

function SchemaRow({ folder, name, spec, value, onChange }: {
  folder: ReturnType<typeof useFolder>;
  name: string;
  spec: { kind: string; min?: number; max?: number; step?: number; values?: readonly string[]; hidden?: boolean };
  value: ParamValue;
  onChange: (v: ParamValue) => void;
}): null {
  // `time` (and anything else the schema hides) is driven by the page clock, so
  // showing it would hand the user a control the animation immediately fights.
  const hidden = spec.hidden === true;
  const isNumber = spec.kind === "number";
  const isColor = spec.kind === "color";
  const isBool = spec.kind === "boolean";
  const isEnum = spec.kind === "string" && Array.isArray(spec.values);

  useSlider(
    isNumber && !hidden ? folder : null,
    name,
    { min: spec.min ?? 0, max: spec.max ?? 1, step: spec.step ?? 0.01 },
    Number(value),
    onChange as (n: number) => void,
  );
  useColor(isColor && !hidden ? folder : null, name, String(value), onChange as (s: string) => void);
  useToggle(isBool && !hidden ? folder : null, name, Boolean(value), onChange as (b: boolean) => void);
  useOption(
    isEnum && !hidden ? folder : null,
    name,
    Object.fromEntries((spec.values ?? []).map((v) => [v, v])),
    String(value),
    onChange as (s: string) => void,
  );
  useText(
    spec.kind === "string" && !isEnum && !hidden ? folder : null,
    name,
    String(value),
    onChange as (s: string) => void,
  );
  return null;
}
