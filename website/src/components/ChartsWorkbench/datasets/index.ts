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
