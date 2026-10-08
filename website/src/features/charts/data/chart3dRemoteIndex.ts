// A curated list of Hugging Face datasets verified to carry 3+ numeric
// columns (packet C6, AGENTS.md's "Charts 3D" "Website") — the 3D sibling
// of `remoteIndex.ts`, shown as suggestions in the dataset search box while
// a 3D type is active. Every id below is already IN `remoteIndex.ts` (so it
// is also verified to load, per that file's own P2-3 doc) — this list adds
// a SECOND, narrower verification: a real HTTP round trip against
// `datasets-server.huggingface.co`'s `/first-rows` (per-column `dtype`
// inspected directly, not merely "loads") confirming at least 3 numeric
// (`int64`/`float64`) columns, which is what `chartsScatter3dFitFromRows`
// (`chartsWorkbench3d.ts`) needs to build a real scatter. All five read
// well as a scatter specifically (not merely "fits"): each has a
// low-cardinality categorical column too (species/class/sex/glass_type),
// giving the marker series/colour something meaningful to show.
//
// Verified 2026 via (one round trip per id, config resolved from `/splits`
// first since none of these use the Hub's own "default" config name):
//   curl -s "https://datasets-server.huggingface.co/first-rows?dataset=<ref>&config=<config>&split=train"
// `../LICENSES.md`'s own "3D" table records each id's confirmed numeric
// column count and licence.
import type { DatasetHit } from "../../../services/datasets/datasetSearch";

export const CHARTS_3D_REMOTE_DATASET_INDEX: readonly DatasetHit[] = [
  {
    id: "scikit-learn/iris",
    kind: "hf",
    ref: "scikit-learn/iris",
    title: "Iris species",
    description:
      "Fisher's classic sepal/petal measurements across three iris species — 4 numeric columns, verified for 3D scatter.",
    url: "https://huggingface.co/datasets/scikit-learn/iris",
  },
  {
    id: "mstz/wine",
    kind: "hf",
    ref: "mstz/wine",
    title: "Wine quality",
    description: "Physicochemical wine measurements — 13 numeric columns, verified for 3D scatter.",
    url: "https://huggingface.co/datasets/mstz/wine",
  },
  {
    id: "mstz/seeds",
    kind: "hf",
    ref: "mstz/seeds",
    title: "Wheat seed measurements",
    description:
      "Geometric wheat-kernel measurements across three varieties — 7 numeric columns, verified for 3D scatter.",
    url: "https://huggingface.co/datasets/mstz/seeds",
  },
  {
    id: "mstz/abalone",
    kind: "hf",
    ref: "mstz/abalone",
    title: "Abalone age",
    description: "Physical shell measurements used to predict age — 8 numeric columns, verified for 3D scatter.",
    url: "https://huggingface.co/datasets/mstz/abalone",
  },
  {
    id: "mstz/glass",
    kind: "hf",
    ref: "mstz/glass",
    title: "Glass identification",
    description:
      "Refractive index and oxide content used to classify glass fragments — 9 numeric columns, verified for 3D scatter.",
    url: "https://huggingface.co/datasets/mstz/glass",
  },
];
