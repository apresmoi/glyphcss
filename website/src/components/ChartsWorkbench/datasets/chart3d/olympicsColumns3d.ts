// Columns 3D (`bars3d`) preset — REUSES `../olympics2024MedalsByType.ts`'s
// own vendored rows (country x medal type x count), already credited in
// `../LICENSES.md` (Wikipedia, 2024 Summer Olympics medal table, CC BY-SA
// 4.0). `glyphChartBars3d`'s x/y channels are NUMERIC positions
// (`packages/charts/src/3d/bars.ts`'s own doc) — the library never plots a
// bar on a categorical grid directly — so each row is pre-shaped here with
// an integer `countryIndex`/`medalIndex` position plus the real
// `country`/`medal` name riding on `xLabel`/`yLabel`, mirroring the DATA
// convention `GlyphChart3dBarsChannels.xLabel`/`yLabel` exists for: a
// column-index position with a real category NAME for a reader.
import type { Chart3dBarsDataset } from "./types";
import { olympics2024MedalsByTypeDataset } from "../olympics2024MedalsByType";

const COUNTRIES = [...new Set(olympics2024MedalsByTypeDataset.rows.map((r) => String(r.country)))];
const MEDALS = [...new Set(olympics2024MedalsByTypeDataset.rows.map((r) => String(r.medal)))];

const data = olympics2024MedalsByTypeDataset.rows.map((row) => ({
  countryIndex: COUNTRIES.indexOf(String(row.country)),
  medalIndex: MEDALS.indexOf(String(row.medal)),
  count: Number(row.count),
  country: String(row.country),
  medal: String(row.medal),
}));

export const olympicsColumns3dDataset: Chart3dBarsDataset = {
  id: "olympics-2024-columns-3d",
  markType: "bars3d",
  title: "2024 Olympics medals by type (3D columns)",
  description: "Gold, silver and bronze medal counts as upright columns per country for the top 10 nations at the 2024 Paris Summer Olympics.",
  source: olympics2024MedalsByTypeDataset.source,
  data,
  channels: { x: "countryIndex", y: "medalIndex", z: "count", xLabel: "country", yLabel: "medal" },
  options: {
    axes: {
      x: { title: "country" },
      y: { title: "medal" },
      z: { title: "count" },
    },
  },
};
