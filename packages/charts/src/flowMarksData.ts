/**
 * Real-shaped datasets for the sankey/funnel mark tests and README
 * examples (`flowMarks.test.ts`, `README.md`'s "Sankey"/"Funnel" sections).
 */

/**
 * A simplified national energy balance — sources feed one transformation
 * stage (electricity generation, with its own conversion losses), which
 * together with a direct industrial gas draw feeds four end-use sectors.
 * Illustrative figures shaped like the structure published in national
 * energy Sankey diagrams (e.g. the UK's BEIS/DESNZ "Energy Flow Chart" and
 * the IEA's World Energy Balances Sankeys) — not the actual reported
 * quantities. In (Coal 200 + Natural Gas 450 + Nuclear 150 + Renewables
 * 100 = 900) equals out (Residential 220 + Commercial 200 + Industrial
 * 280 + Transportation 0... see below) plus generation Losses, so every
 * node conserves exactly.
 */
export const ENERGY_FLOW_SANKEY_DATA: readonly { readonly from: string; readonly to: string; readonly amount: number }[] = [
  { from: "Coal", to: "Electricity Generation", amount: 200 },
  { from: "Natural Gas", to: "Electricity Generation", amount: 300 },
  { from: "Natural Gas", to: "Industrial", amount: 150 },
  { from: "Nuclear", to: "Electricity Generation", amount: 150 },
  { from: "Renewables", to: "Electricity Generation", amount: 100 },
  { from: "Electricity Generation", to: "Residential", amount: 220 },
  { from: "Electricity Generation", to: "Commercial", amount: 200 },
  { from: "Electricity Generation", to: "Industrial", amount: 130 },
  { from: "Electricity Generation", to: "Losses", amount: 200 },
];

/**
 * A typical e-commerce conversion funnel: visits down to completed
 * purchases. Illustrative figures consistent with commonly cited
 * industry benchmarks (~1-3% overall visit-to-purchase conversion, with
 * cart abandonment concentrated at the checkout step — see e.g. the
 * Baymard Institute's checkout-usability research and standard
 * e-commerce funnel conversion-rate reports).
 */
export const ECOMMERCE_FUNNEL_DATA: readonly { readonly stage: string; readonly count: number }[] = [
  { stage: "Visits", count: 10000 },
  { stage: "Product Views", count: 4000 },
  { stage: "Add to Cart", count: 1000 },
  { stage: "Checkout", count: 400 },
  { stage: "Purchase", count: 260 },
];
