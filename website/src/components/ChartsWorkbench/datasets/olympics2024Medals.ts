// Vendored, real, small dataset for the /charts Data folder — see
// AGENTS.md's "Charts" ("Data layer") and datasets/LICENSES.md. No
// runtime fetch: values are captured at build time from the cited source.
import type { ChartsDataset } from "./types";

export const olympics2024MedalsDataset: ChartsDataset = {
  id: "olympics-2024-medals",
  title: "2024 Olympics gold medals",
  description: "Gold medal counts for the top 10 countries at the 2024 Paris Summer Olympics — a compact, category-friendly share of the podium.",
  source: {
    "name": "Wikipedia, 2024 Summer Olympics medal table",
    "url": "https://en.wikipedia.org/wiki/2024_Summer_Olympics_medal_table",
    "licence": "CC BY-SA 4.0 (Wikipedia)"
  },
  columns: ["country","gold","silver","bronze"],
  recommended: {"mark":"bar","x":"country","y":"gold"},
  rows: [
    {"country":"United States","gold":40,"silver":44,"bronze":42},
    {"country":"China","gold":40,"silver":27,"bronze":24},
    {"country":"Japan","gold":20,"silver":12,"bronze":13},
    {"country":"Australia","gold":18,"silver":19,"bronze":16},
    {"country":"France","gold":16,"silver":26,"bronze":22},
    {"country":"Netherlands","gold":15,"silver":7,"bronze":12},
    {"country":"Great Britain","gold":14,"silver":22,"bronze":29},
    {"country":"South Korea","gold":13,"silver":9,"bronze":10},
    {"country":"Italy","gold":12,"silver":13,"bronze":15},
    {"country":"Germany","gold":12,"silver":13,"bronze":8},
  ],
};
