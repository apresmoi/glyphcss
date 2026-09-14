// Vendored, real, small dataset for the /charts Data folder — see
// AGENTS.md's "Charts" ("Data layer") and datasets/LICENSES.md. No runtime
// fetch. Reuses `@glyphcss/charts`' own `ECOMMERCE_FUNNEL_DATA`
// (`packages/charts/src/flowMarksData.ts`) rather than sourcing a second
// funnel table — figures consistent with commonly cited industry
// benchmarks (see that file's own header comment for the sources).
import type { ChartsDataset } from "./types";

export const ecommerceConversionFunnelDataset: ChartsDataset = {
  id: "ecommerce-conversion-funnel",
  title: "E-commerce conversion funnel",
  description: "A typical online-store funnel from site visits down to completed purchases, with the steepest drop at checkout — a shape consistent with widely cited cart-abandonment research.",
  source: {
    "name": "glyphcss project — packages/charts/src/flowMarksData.ts (ECOMMERCE_FUNNEL_DATA); figures consistent with commonly cited e-commerce benchmarks (~1-3% overall visit-to-purchase conversion, cart abandonment concentrated at checkout — see e.g. the Baymard Institute's checkout-usability research)",
    "url": "https://github.com/apresmoi/glyphcss/blob/main/packages/charts/src/flowMarksData.ts",
    "licence": "MIT (glyphcss project)"
  },
  columns: ["stage","count"],
  recommended: {"mark":"funnel","stage":"stage","value":"count"},
  rows: [
    {"stage":"Visits","count":10000},
    {"stage":"Product Views","count":4000},
    {"stage":"Add to Cart","count":1000},
    {"stage":"Checkout","count":400},
    {"stage":"Purchase","count":260},
  ],
};
