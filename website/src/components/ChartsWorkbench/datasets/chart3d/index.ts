// Vendored 3D datasets for `/charts`' 3D preset tray (packet C3/C6,
// AGENTS.md's "Charts 3D"). Eight presets across all five 3D mark types —
// real, vendored/reused data where a licence could be verified, computed
// reference examples otherwise (`../LICENSES.md` carries every entry).
export type { Chart3dDataset } from "./types";

import { maungaWhauVolcanoDataset } from "./maungaWhauVolcano";
import { etopo1AlpsDataset } from "./etopo1Alps";
import { irisScatter3dDataset } from "./irisScatter3d";
import { olympicsColumns3dDataset } from "./olympicsColumns3d";
import { sphereParametric3dDataset } from "./spherePreset";
import { torusParametric3dDataset } from "./torusPreset";
import { tiltedPlaneDataset } from "./tiltedPlane";
import { lorenzAttractorDataset } from "./lorenzAttractor";
import type { Chart3dDataset } from "./types";

export {
  maungaWhauVolcanoDataset, etopo1AlpsDataset, irisScatter3dDataset, olympicsColumns3dDataset,
  sphereParametric3dDataset, torusParametric3dDataset, tiltedPlaneDataset, lorenzAttractorDataset,
};

export const CHARTS_3D_DATASETS: readonly Chart3dDataset[] = [
  maungaWhauVolcanoDataset, etopo1AlpsDataset, tiltedPlaneDataset,
  irisScatter3dDataset, olympicsColumns3dDataset,
  sphereParametric3dDataset, torusParametric3dDataset, lorenzAttractorDataset,
];

export function findCharts3dDataset(id: string): Chart3dDataset | undefined {
  return CHARTS_3D_DATASETS.find((d) => d.id === id);
}

/** Mirrors `../index.ts`'s own `randomChartsDatasetId` exactly — a failed
 *  or unfittable Hugging Face 3D load (`ChartsWorkbench.tsx`'s
 *  `loadRemote3dDataset`) falls back to a random vendored 3D preset rather
 *  than leaving the reader on a stale or half-loaded 3D chart. */
export function randomCharts3dDatasetId(excludeId?: string): string {
  const pool = excludeId ? CHARTS_3D_DATASETS.filter((d) => d.id !== excludeId) : CHARTS_3D_DATASETS;
  const candidates = pool.length > 0 ? pool : CHARTS_3D_DATASETS;
  return (candidates[Math.floor(Math.random() * candidates.length)] ?? CHARTS_3D_DATASETS[0]!).id;
}
