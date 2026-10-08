// Vendored, real, small dataset for the /charts Data folder — see
// AGENTS.md's "Charts" ("Data layer") and datasets/LICENSES.md. No runtime
// fetch. Reuses `@glyphcss/charts`' own `ENERGY_FLOW_SANKEY_DATA`
// (`packages/charts/src/flowMarksData.ts`) rather than sourcing a second
// sankey table — that data is already shaped like a real national energy
// balance (illustrative figures, not one country's actual reported
// quantities; see that file's own header comment) and conserves exactly at
// every node, which is what a sankey demo needs to render without a
// `sankey-imbalance` ledger entry.
import type { ChartsDataset } from "./types";

export const energyFlowSankeyDataset: ChartsDataset = {
  id: "energy-flow-sankey",
  title: "National energy flow (illustrative)",
  description:
    "A simplified national energy balance — four primary sources feed one electricity-generation stage (with its own conversion losses) and a direct industrial gas draw, together supplying three end-use sectors; every node conserves inflow and outflow exactly.",
  source: {
    name: "glyphcss project — packages/charts/src/flowMarksData.ts (ENERGY_FLOW_SANKEY_DATA); illustrative figures shaped like the structure published in national energy Sankey diagrams (e.g. the UK's BEIS/DESNZ \"Energy Flow Chart\" and the IEA's World Energy Balances Sankeys), not one country's actual reported quantities",
    url: "https://github.com/apresmoi/glyphcss/blob/main/packages/charts/src/flowMarksData.ts",
    licence: "MIT (glyphcss project)",
  },
  columns: ["source", "target", "value"],
  recommended: { mark: "sankey", source: "source", target: "target", value: "value" },
  rows: [
    { source: "Coal", target: "Electricity Generation", value: 200 },
    { source: "Natural Gas", target: "Electricity Generation", value: 300 },
    { source: "Natural Gas", target: "Industrial", value: 150 },
    { source: "Nuclear", target: "Electricity Generation", value: 150 },
    { source: "Renewables", target: "Electricity Generation", value: 100 },
    { source: "Electricity Generation", target: "Residential", value: 220 },
    { source: "Electricity Generation", target: "Commercial", value: 200 },
    { source: "Electricity Generation", target: "Industrial", value: 130 },
    { source: "Electricity Generation", target: "Losses", value: 200 },
  ],
};
