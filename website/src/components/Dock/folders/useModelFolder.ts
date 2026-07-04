/**
 * Model folder — live ASCII render output metrics: grid dimensions, rendered
 * character count, colored spans, layer count, and last bake time. All values are read-only
 * displays; no user input originates here.
 */
import type { GUI } from "lil-gui";
import type { GlyphMetrics } from "../../GalleryWorkbench/types";
import { useFolder, useReadonlyNumber, useReadonlyText } from "../primitives";

export interface ModelFolderInputs {
  metrics: GlyphMetrics;
}

export function useModelFolder(parent: GUI | null, inputs: ModelFolderInputs): void {
  const { metrics } = inputs;
  const folder = useFolder(parent, "Output", { open: true });

  useReadonlyText(folder, "Grid", `${metrics.cols} x ${metrics.rows}`);
  useReadonlyNumber(folder, "Glyphs", metrics.glyphs);
  useReadonlyNumber(folder, "Text chars", metrics.textChars);
  useReadonlyNumber(folder, "Color spans", metrics.colorSpans);
  useReadonlyNumber(folder, "DOM nodes", metrics.domNodes);
  useReadonlyNumber(folder, "Layers", metrics.layers);
  useReadonlyNumber(folder, "Render ms", metrics.bakeMs);
}
