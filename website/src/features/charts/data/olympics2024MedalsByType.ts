// Vendored, real, small dataset for the /charts Data folder — see
// AGENTS.md's "Charts" ("Data layer") and datasets/LICENSES.md. No runtime
// fetch: the same top-10 medal counts as `olympics2024MedalsDataset`
// (`olympics2024Medals.ts`), reshaped long-format (country × medal type ×
// count) so a `bar` mark with `fill: "medal"` and `transform: "stack"`
// shows each country's total medal haul broken into gold/silver/bronze —
// the wide-format sibling dataset only ever charts gold alone.
import type { ChartsDataset } from "./types";

const COUNTRIES: Record<string, { readonly gold: number; readonly silver: number; readonly bronze: number }> = {
  "United States": { gold: 40, silver: 44, bronze: 42 },
  China: { gold: 40, silver: 27, bronze: 24 },
  Japan: { gold: 20, silver: 12, bronze: 13 },
  Australia: { gold: 18, silver: 19, bronze: 16 },
  France: { gold: 16, silver: 26, bronze: 22 },
  Netherlands: { gold: 15, silver: 7, bronze: 12 },
  "Great Britain": { gold: 14, silver: 22, bronze: 29 },
  "South Korea": { gold: 13, silver: 9, bronze: 10 },
  Italy: { gold: 12, silver: 13, bronze: 15 },
  Germany: { gold: 12, silver: 13, bronze: 8 },
};
const MEDALS = ["gold", "silver", "bronze"] as const;

export const olympics2024MedalsByTypeDataset: ChartsDataset = {
  id: "olympics-2024-medals-by-type",
  title: "2024 Olympics medals by type",
  description:
    "Gold, silver, and bronze medal counts stacked per country for the top 10 nations at the 2024 Paris Summer Olympics, showing each country's full medal haul rather than gold alone.",
  source: {
    name: "Wikipedia, 2024 Summer Olympics medal table",
    url: "https://en.wikipedia.org/wiki/2024_Summer_Olympics_medal_table",
    licence: "CC BY-SA 4.0 (Wikipedia)",
  },
  columns: ["country", "medal", "count"],
  recommended: { mark: "bar", x: "country", y: "count", fill: "medal", transform: "stack" },
  rows: Object.entries(COUNTRIES).flatMap(([country, counts]) =>
    MEDALS.map((medal) => ({ country, medal, count: counts[medal] })),
  ),
};
