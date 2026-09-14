// Vendored 3D (surface) datasets for `/charts`' 3D preset tray (packet C3,
// AGENTS.md's "Charts 3D"). Two datasets — real, vendored, credited exactly
// like the 2D sixteen (`../LICENSES.md` carries both entries too).
export type { Chart3dDataset } from "./types";

import { maungaWhauVolcanoDataset } from "./maungaWhauVolcano";
import { etopo1AlpsDataset } from "./etopo1Alps";
import type { Chart3dDataset } from "./types";

export { maungaWhauVolcanoDataset, etopo1AlpsDataset };

export const CHARTS_3D_DATASETS: readonly Chart3dDataset[] = [maungaWhauVolcanoDataset, etopo1AlpsDataset];

export function findCharts3dDataset(id: string): Chart3dDataset | undefined {
  return CHARTS_3D_DATASETS.find((d) => d.id === id);
}
