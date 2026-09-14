// Shared shape for a vendored 3D (surface) dataset — the `./chart3d`
// sibling of `../types.ts`'s 2D `ChartsDataset`. Deliberately a SEPARATE
// type: a 2D dataset is long-row `ChartsDatasetRow[]`, a 3D surface dataset
// is a `z(x, y)` GRID (`GlyphChart3dSurfaceGridData`) plus its own position
// vectors — the two shapes don't unify without inventing a reshape neither
// side needs (AGENTS.md's "Charts 3D").
import type { GlyphChart3dSurfaceChannels, GlyphChart3dSurfaceGridData, GlyphChart3dSurfaceOptions } from "@glyphcss/charts/3d";
import type { ChartsDatasetSource } from "../types";

export interface Chart3dDataset {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly source: ChartsDatasetSource;
  readonly data: GlyphChart3dSurfaceGridData;
  readonly channels: GlyphChart3dSurfaceChannels;
  readonly options?: GlyphChart3dSurfaceOptions;
}
