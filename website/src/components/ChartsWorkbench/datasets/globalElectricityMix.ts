// Vendored, real, small dataset for the /charts Data folder — see
// AGENTS.md's "Charts" ("Data layer") and datasets/LICENSES.md. No runtime
// fetch: values captured at build time from
//   curl -s -L "https://ourworldindata.org/grapher/electricity-prod-source-stacked.csv?country=OWID_WRL~World&useColumnShortNames=true"
// (Ember's Yearly Electricity Data via Our World in Data), World, 2024 (the
// latest full calendar year in the series). The source's own nine fuel
// columns are grouped to six slices for a readable pie: wind+solar combine
// (both intermittent, fast-growing), and oil+bioenergy+other-renewables
// (each under 3% individually) combine into "Other".
import type { ChartsDataset } from "./types";

export const globalElectricityMixDataset: ChartsDataset = {
  id: "global-electricity-mix",
  title: "World electricity generation by source (2024)",
  description: "Share of world electricity generation by fuel/technology in 2024 — coal remains the single largest source even as wind and solar together approach a sixth of the mix.",
  source: {
    "name": "Our World in Data / Ember, Yearly Electricity Data — Electricity generation by source",
    "url": "https://ourworldindata.org/grapher/electricity-prod-source-stacked",
    "licence": "CC BY 4.0 (Our World in Data)"
  },
  columns: ["source","generation_twh"],
  recommended: {"mark":"arc","y":"generation_twh","fill":"source"},
  rows: [
    {"source":"Coal","generation_twh":10538.94},
    {"source":"Gas","generation_twh":6882.73},
    {"source":"Hydro","generation_twh":4433.65},
    {"source":"Wind & solar","generation_twh":4652.15},
    {"source":"Nuclear","generation_twh":2777.11},
    {"source":"Other (oil, bioenergy, other renewables)","generation_twh":1645.65},
  ],
};
