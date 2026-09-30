// Shared shape for a vendored 3D dataset — the `./chart3d` sibling of
// `../types.ts`'s 2D `ChartsDataset`. A discriminated union over
// `markType`, one variant per `@glyphcss/charts/3d` mark constructor's own
// `(data, channels?, options?)` shape — a 2D dataset is long-row
// `ChartsDatasetRow[]`, a `surface` grid is `z(x, y)`, a `parametric3d`
// grid is precomputed `x`/`y`/`z` sample grids, and the two don't unify
// without inventing a reshape neither side needs (packet C6, generalizing
// C3's original surface-only `Chart3dDataset`). Each variant is its own
// named interface (not an inline `Extract<>`) so an individual dataset
// module can declare its own const against the NARROW shape — `dataset.
// data.z` (etc.) then type-checks with no `markType` narrowing at the call
// site, exactly like the original C3 (surface-only) shape did.
import type {
  GlyphChart3dBarsChannels,
  GlyphChart3dBarsOptions,
  GlyphChart3dLineInput,
  GlyphChart3dLineOptions,
  GlyphChart3dParametricInput,
  GlyphChart3dParametricOptions,
  GlyphChart3dScatterChannels,
  GlyphChart3dScatterOptions,
  GlyphChart3dSurfaceChannels,
  GlyphChart3dSurfaceGridData,
  GlyphChart3dSurfaceOptions,
  GlyphChart3dSurfaceRecord,
} from "@glyphcss/charts/3d";
import type { ChartsDatasetSource } from "../types";

interface Chart3dDatasetBase {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly source: ChartsDatasetSource;
}

export interface Chart3dSurfaceDataset extends Chart3dDatasetBase {
  readonly markType: "surface";
  // Grid-shape only (never the long-row alternative `glyphChartSurface`
  // also accepts) — every vendored/computed surface preset is authored as
  // a grid.
  readonly data: GlyphChart3dSurfaceGridData;
  readonly channels: GlyphChart3dSurfaceChannels;
  readonly options?: GlyphChart3dSurfaceOptions;
}
export interface Chart3dScatterDataset extends Chart3dDatasetBase {
  readonly markType: "scatter3d";
  readonly data: readonly GlyphChart3dSurfaceRecord[];
  readonly channels?: GlyphChart3dScatterChannels;
  readonly options?: GlyphChart3dScatterOptions;
}
export interface Chart3dParametricDataset extends Chart3dDatasetBase {
  readonly markType: "parametric3d";
  readonly data: GlyphChart3dParametricInput;
  readonly options?: GlyphChart3dParametricOptions;
}
export interface Chart3dBarsDataset extends Chart3dDatasetBase {
  readonly markType: "bars3d";
  readonly data: readonly GlyphChart3dSurfaceRecord[];
  readonly channels?: GlyphChart3dBarsChannels;
  readonly options?: GlyphChart3dBarsOptions;
}
export interface Chart3dLineDataset extends Chart3dDatasetBase {
  readonly markType: "line3d";
  readonly data: GlyphChart3dLineInput;
  readonly options?: GlyphChart3dLineOptions;
}

export type Chart3dDataset =
  | Chart3dSurfaceDataset
  | Chart3dScatterDataset
  | Chart3dParametricDataset
  | Chart3dBarsDataset
  | Chart3dLineDataset;
