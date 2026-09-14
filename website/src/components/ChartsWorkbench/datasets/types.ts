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
  /** `sankey`'s own channel vocabulary (non-cartesian, like `arc` — AGENTS.md's
   *  "Charts"): the source/target node names and the flow value, instead of `x`/`y`. */
  readonly source?: string;
  readonly target?: string;
  readonly value?: string;
  /** `funnel`'s own stage-name channel (paired with `value` above). */
  readonly stage?: string;
  /** A row transform the mark needs to read as intended — e.g. `"stack"`
   *  for a genuinely stacked bar/area rather than a dodged one — forwarded
   *  onto the built mark's `transform: { kind }` (`chartsDataSource.ts`'s
   *  `buildDatasetMark`), mirroring `ChartsWorkbenchMark.transform`'s own
   *  vocabulary at the UI layer. */
  readonly transform?: "stack" | "group" | "normalize";
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
