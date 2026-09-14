// Vendored, real, small dataset for the /charts Data folder — see
// AGENTS.md's "Charts" ("Data layer") and datasets/LICENSES.md. No runtime
// fetch: values captured at build time from
//   curl -s -L "https://ourworldindata.org/grapher/primary-sub-energy-source.csv?country=OWID_WRL~World&useColumnShortNames=true"
// (Energy Institute Statistical Review of World Energy, via Our World in
// Data), World, 1980-2024 at 5-year intervals. The source's nine/ten
// sub-fuel columns are grouped to four: Fossil fuels (coal+oil+gas),
// Nuclear, Renewables (wind+hydro+solar+biofuels+other renewables), and
// Traditional biomass — a long-format table so a stacked area shows total
// energy use growing while the renewable slice's share climbs.
import type { ChartsDataset } from "./types";

const YEARS: Record<string, Record<string, number>> = {
  "1980": { "Fossil fuels": 70684.05, "Nuclear": 2157.35, "Renewables": 2011.78, "Traditional biomass": 10000 },
  "1985": { "Fossil fuels": 73940.64, "Nuclear": 4511.88, "Renewables": 2444.55, "Traditional biomass": 10541 },
  "1990": { "Fossil fuels": 83071.25, "Nuclear": 6062.41, "Renewables": 2879.68, "Traditional biomass": 11111 },
  "1995": { "Fossil fuels": 86596.98, "Nuclear": 7037.97, "Renewables": 3339.47, "Traditional biomass": 11785 },
  "2000": { "Fossil fuels": 94434.00, "Nuclear": 7820.20, "Renewables": 3727.19, "Traditional biomass": 12500 },
  "2005": { "Fossil fuels": 110553.24, "Nuclear": 8389.71, "Renewables": 4419.03, "Traditional biomass": 12076 },
  "2010": { "Fossil fuels": 121765.15, "Nuclear": 8389.61, "Renewables": 6090.43, "Traditional biomass": 11667 },
  "2015": { "Fossil fuels": 129677.21, "Nuclear": 7805.56, "Renewables": 8016.85, "Traditional biomass": 11111 },
  "2020": { "Fossil fuels": 129419.04, "Nuclear": 8155.18, "Renewables": 10508.34, "Traditional biomass": 11111 },
  "2024": { "Fossil fuels": 142532.37, "Nuclear": 8531.21, "Renewables": 13430.05, "Traditional biomass": 11111 },
};

export const energyConsumptionBySourceDataset: ChartsDataset = {
  id: "energy-consumption-by-source",
  title: "World primary energy consumption by source",
  description: "World primary energy consumption (TWh, substitution method) by source group, 1980-2024 at 5-year intervals — fossil fuels dominate throughout even as total use grows and renewables' share climbs fastest after 2010.",
  source: {
    "name": "Our World in Data, based on the Energy Institute Statistical Review of World Energy — Primary energy consumption by source",
    "url": "https://ourworldindata.org/grapher/primary-sub-energy-source",
    "licence": "CC BY 4.0 (Our World in Data)"
  },
  columns: ["year","source","twh"],
  recommended: {"mark":"area","x":"year","y":"twh","fill":"source","transform":"stack"},
  rows: Object.entries(YEARS).flatMap(([year, sources]) =>
    Object.entries(sources).map(([source, twh]) => ({ year: `${year}-01-01`, source, twh })),
  ),
};
