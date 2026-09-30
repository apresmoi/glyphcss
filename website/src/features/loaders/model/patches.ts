import { MAX_VOICES, type Params, synthDefaults } from "../../synth/model/parameters";
import { type LoaderPreset } from "./loaders";

/** The loader's field-synth layer as a full patch — merged over the schema
 *  defaults so every voice key the cards read exists. */
export function synthPatchOf(loader: LoaderPreset): Params {
  const layer = loader.layers.find((l) => l.effectId === "field-synth");
  return { ...synthDefaults(), ...(layer?.params ?? {}) } as Params;
}

export function stockPatchesOf(loader: LoaderPreset): Record<number, Params> {
  const out: Record<number, Params> = {};
  loader.layers.forEach((l, i) => {
    if (l.effectId !== "field-synth") out[i] = { ...l.params } as Params;
  });
  return out;
}

export const slotsOf = (params: Params): number[] =>
  Array.from({ length: MAX_VOICES }, (_, i) => i + 1).filter((k) => Number(params[`amp${k}`]) > 0);
