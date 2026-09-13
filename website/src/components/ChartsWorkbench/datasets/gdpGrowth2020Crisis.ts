// Vendored, real, small dataset for the /charts Data folder — see
// AGENTS.md's "Charts" ("Data layer") and datasets/LICENSES.md. No runtime
// fetch: values captured at build time from
//   curl -s "https://api.worldbank.org/v2/country/all/indicator/NY.GDP.MKTP.KD.ZG?date=2020&format=json&per_page=300"
// (World Bank national accounts data), 2020 — the COVID-19 pandemic year,
// when most economies contracted. Exercises the mixed-sign (diverging) bar
// axis path: 21 of 23 countries here posted negative growth.
import type { ChartsDataset } from "./types";

export const gdpGrowth2020CrisisDataset: ChartsDataset = {
  id: "gdp-growth-2020-crisis",
  title: "GDP growth by country (2020)",
  description: "Annual real GDP growth, 2020 — the pandemic year most of the world's economies contracted, from Spain and Peru's double-digit declines to China and Türkiye's rare gains.",
  source: {
    "name": "World Bank national accounts data — GDP growth (annual %), indicator NY.GDP.MKTP.KD.ZG",
    "url": "https://data.worldbank.org/indicator/NY.GDP.MKTP.KD.ZG",
    "licence": "CC BY 4.0 (World Bank)"
  },
  columns: ["country","gdp_growth_pct"],
  recommended: {"mark":"bar","x":"country","y":"gdp_growth_pct"},
  rows: [
    {"country":"Spain","gdp_growth_pct":-10.94},
    {"country":"Peru","gdp_growth_pct":-10.93},
    {"country":"United Kingdom","gdp_growth_pct":-10.05},
    {"country":"Argentina","gdp_growth_pct":-9.90},
    {"country":"Philippines","gdp_growth_pct":-9.52},
    {"country":"Italy","gdp_growth_pct":-8.87},
    {"country":"Mexico","gdp_growth_pct":-8.35},
    {"country":"France","gdp_growth_pct":-7.44},
    {"country":"India","gdp_growth_pct":-5.78},
    {"country":"Canada","gdp_growth_pct":-5.04},
    {"country":"Nigeria","gdp_growth_pct":-6.37},
    {"country":"South Africa","gdp_growth_pct":-6.17},
    {"country":"Japan","gdp_growth_pct":-4.28},
    {"country":"Germany","gdp_growth_pct":-4.13},
    {"country":"Saudi Arabia","gdp_growth_pct":-3.80},
    {"country":"Brazil","gdp_growth_pct":-3.28},
    {"country":"Russia","gdp_growth_pct":-2.65},
    {"country":"United States","gdp_growth_pct":-2.08},
    {"country":"Indonesia","gdp_growth_pct":-2.07},
    {"country":"South Korea","gdp_growth_pct":-0.70},
    {"country":"Australia","gdp_growth_pct":-0.13},
    {"country":"China","gdp_growth_pct":2.34},
    {"country":"Türkiye","gdp_growth_pct":1.80},
  ],
};
