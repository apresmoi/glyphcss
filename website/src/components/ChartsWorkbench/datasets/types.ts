// Shared shape for every vendored dataset under `datasets/` — see
// AGENTS.md's "Charts" ("Data layer"). `recommended` is what the Data
// folder's "Custom…"/dataset-picker flow applies with one click; a caller
// wanting the FULL ranked list runs `recommendChart(profileRows(rows))`
// (`../../../lib/dataProfile`) itself.
import type { GlyphChartMarkType } from "@glyphcss/charts";

export interface ChartsDatasetSource {
  readonly name: string;
  readonly url: string;
  readonly licence: string;
}

export type ChartsDatasetCell = string | number | boolean | null;
export type ChartsDatasetRow = Readonly<Record<string, ChartsDatasetCell>>;

export interface ChartsDatasetRecommendation {
  readonly mark: GlyphChartMarkType;
  readonly x?: string;
  readonly y?: string;
  readonly fill?: string;
  readonly label?: string;
}

export interface ChartsDataset {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly source: ChartsDatasetSource;
  readonly columns: readonly string[];
  readonly rows: readonly ChartsDatasetRow[];
  readonly recommended: ChartsDatasetRecommendation;
}
