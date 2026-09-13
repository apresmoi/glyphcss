// Eight vendored real-world datasets for `/charts`' Data folder (AGENTS.md's
// "Charts" — "Data layer"). No runtime fetch — every value here was
// captured at build time from the cited source; see `LICENSES.md` for the
// full credit/licence text per dataset. Three carry ISO date x-values at a
// different granularity each: `globalTemperatureDataset` (yearly),
// `co2MaunaLoaDataset`/`usUnemploymentDataset` (monthly), and
// `treasuryYield10yDataset` (daily).
export type { ChartsDataset, ChartsDatasetCell, ChartsDatasetRecommendation, ChartsDatasetRow, ChartsDatasetSource } from "./types";

import { globalTemperatureDataset } from "./globalTemperature";
import { co2MaunaLoaDataset } from "./co2MaunaLoa";
import { usUnemploymentDataset } from "./usUnemployment";
import { worldPopulationByCountryDataset } from "./worldPopulationByCountry";
import { renewableElectricityShareDataset } from "./renewableElectricityShare";
import { treasuryYield10yDataset } from "./treasuryYield10y";
import { olympics2024MedalsDataset } from "./olympics2024Medals";
import { irisFlowersDataset } from "./irisFlowers";
import type { ChartsDataset } from "./types";

export {
  globalTemperatureDataset, co2MaunaLoaDataset, usUnemploymentDataset, worldPopulationByCountryDataset,
  renewableElectricityShareDataset, treasuryYield10yDataset, olympics2024MedalsDataset, irisFlowersDataset,
};

export const CHARTS_DATASETS: readonly ChartsDataset[] = [
  globalTemperatureDataset, co2MaunaLoaDataset, usUnemploymentDataset, worldPopulationByCountryDataset,
  renewableElectricityShareDataset, treasuryYield10yDataset, olympics2024MedalsDataset, irisFlowersDataset,
];

export function findChartsDataset(id: string): ChartsDataset | undefined {
  return CHARTS_DATASETS.find((d) => d.id === id);
}

/** `/charts`' own version of GalleryWorkbench.tsx's `randomPreset()` — a
 *  plain `Math.random()` pick over the vendored list, used both for the
 *  no-`?c=`-param mount and the rail's "Random" button. `excludeId` (the
 *  currently-loaded dataset, when there is one) is left out of the pool so
 *  the button always picks something DIFFERENT, falling back to the full
 *  list only if excluding it would leave nothing to pick from (it never
 *  does, at 8 vendored datasets, but this mirrors `randomPreset`'s own
 *  `?? PRESETS[0]` safety net rather than assuming the count). */
export function randomChartsDatasetId(excludeId?: string): string {
  const pool = excludeId ? CHARTS_DATASETS.filter((d) => d.id !== excludeId) : CHARTS_DATASETS;
  const candidates = pool.length > 0 ? pool : CHARTS_DATASETS;
  return (candidates[Math.floor(Math.random() * candidates.length)] ?? CHARTS_DATASETS[0]!).id;
}
