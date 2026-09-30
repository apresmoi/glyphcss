// Scatter 3D preset — REUSES `../irisFlowers.ts`'s own vendored rows
// verbatim (no re-fetch, no duplication): Fisher's classic 150-flower Iris
// measurements, already credited in `../LICENSES.md` and that dataset's
// own `source` field (Hugging Face `scikit-learn/iris`, itself the UCI
// Machine Learning Repository's canonical mirror — public domain). Four
// numeric measurements give a genuine 3-axis spread; `species` (3 values)
// drives the marker series/colour, exactly the "labelled scatter plot"
// role the 2D sibling dataset's own description already claims.
import { irisFlowersDataset } from "../irisFlowers";
import type { Chart3dScatterDataset } from "./types";

export const irisScatter3dDataset: Chart3dScatterDataset = {
  id: "iris-scatter-3d",
  markType: "scatter3d",
  title: "Iris flower measurements (3D scatter)",
  description:
    "Fisher's classic 150-flower Iris dataset in three measurement axes — sepal length, petal length and petal width — coloured by species.",
  source: irisFlowersDataset.source,
  data: irisFlowersDataset.rows,
  channels: { x: "sepal_length_cm", y: "petal_length_cm", z: "petal_width_cm", series: "species" },
  options: {
    axes: {
      x: { title: "sepal length (cm)" },
      y: { title: "petal length (cm)" },
      z: { title: "petal width (cm)" },
    },
  },
};
