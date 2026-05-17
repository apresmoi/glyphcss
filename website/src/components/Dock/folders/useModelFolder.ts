/**
 * Model folder — live ASCII render metrics: grid dimensions, edge/triangle/
 * vertex counts, frame count, and last bake time. All values are read-only
 * displays; no user input originates here.
 */
import type { GUI } from "lil-gui";
import type { GlyphcssMetrics } from "../../GalleryWorkbench/types";
import { useFolder, useReadonlyNumber } from "../primitives";

export interface ModelFolderInputs {
  metrics: GlyphcssMetrics;
}

export function useModelFolder(parent: GUI | null, inputs: ModelFolderInputs): void {
  const { metrics } = inputs;
  const folder = useFolder(parent, "Model", { open: true });

  useReadonlyNumber(folder, "Cells", metrics.cells);
  useReadonlyNumber(folder, "Edges", metrics.edges);
  useReadonlyNumber(folder, "Triangles", metrics.triangles);
  useReadonlyNumber(folder, "Vertices", metrics.vertices);
  useReadonlyNumber(folder, "Frames", metrics.frames);
  useReadonlyNumber(folder, "Bake ms", metrics.bakeMs);
}
