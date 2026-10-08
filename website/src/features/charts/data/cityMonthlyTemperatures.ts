// Vendored, real, small dataset for the /charts Data folder — see
// AGENTS.md's "Charts" ("Data layer") and datasets/LICENSES.md. No runtime
// fetch: values are NOAA's own 1991-2020 U.S. Climate Normals (mean daily
// temperature per month), each city's own "Climate data" table on
// Wikipedia (which cites NOAA/NCEI directly) fetched at build time, e.g.
//   https://en.wikipedia.org/wiki/Climate_of_New_York_City
//   https://en.wikipedia.org/wiki/Climate_of_Chicago
//   https://en.wikipedia.org/wiki/Climate_of_Los_Angeles
//   https://en.wikipedia.org/wiki/Climate_of_Miami
//   https://en.wikipedia.org/wiki/Seattle (Climate section, SeaTac station)
//   https://en.wikipedia.org/wiki/Denver (Climate section)
//   https://en.wikipedia.org/wiki/Phoenix,_Arizona (Climate section)
//   https://en.wikipedia.org/wiki/Minneapolis (Climate section)
import type { ChartsDataset } from "./types";

const CITIES: Record<string, readonly number[]> = {
  // Jan .. Dec, degrees C.
  "New York": [0.9, 2.2, 6.0, 12.1, 17.3, 22.2, 25.3, 24.5, 20.7, 14.4, 8.9, 3.9],
  Chicago: [-3.8, -1.8, 3.9, 9.8, 15.9, 21.4, 24.1, 23.2, 19.1, 12.2, 5.2, -0.8],
  "Los Angeles": [14.7, 15.0, 16.2, 17.6, 18.8, 20.7, 22.9, 23.7, 23.1, 20.7, 17.2, 14.3],
  Miami: [20.3, 21.5, 22.8, 24.8, 26.7, 28.2, 28.9, 29.0, 28.3, 26.7, 23.8, 21.8],
  Seattle: [6.0, 6.7, 8.4, 10.7, 14.2, 16.7, 19.5, 19.7, 17.0, 12.1, 8.1, 5.6],
  Denver: [-0.2, 0.4, 5.3, 8.8, 14.1, 20.1, 23.9, 22.7, 18.2, 10.6, 4.1, -0.4],
  Phoenix: [13.8, 15.5, 19.1, 22.9, 27.8, 33.0, 35.3, 34.7, 31.8, 25.2, 18.4, 13.2],
  Minneapolis: [-8.8, -6.3, 0.7, 8.4, 15.3, 20.9, 23.5, 22.1, 17.5, 9.7, 1.6, -5.6],
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const cityMonthlyTemperaturesDataset: ChartsDataset = {
  id: "city-monthly-temperatures",
  title: "Monthly mean temperature by U.S. city",
  description:
    "1991-2020 mean daily temperature by month for eight U.S. cities spanning subtropical, desert, continental, and marine climates — Phoenix's summer heat and Minneapolis's winter cold anchor the extremes.",
  source: {
    name: 'NOAA National Centers for Environmental Information — 1991-2020 U.S. Climate Normals (mean daily temperature), via each city\'s own NOAA-cited "Climate data" table on Wikipedia',
    url: "https://www.ncei.noaa.gov/products/land-based-station/us-climate-normals",
    licence: "US public domain (NOAA); compiled via Wikipedia (CC BY-SA 4.0)",
  },
  columns: ["city", "month", "temperature_c"],
  recommended: { mark: "cell", x: "month", y: "city", fill: "temperature_c" },
  rows: Object.entries(CITIES).flatMap(([city, values]) =>
    values.map((temperature_c, i) => ({ city, month: MONTHS[i]!, temperature_c })),
  ),
};
