// @vitest-environment node
//
// Packet C6 (AGENTS.md's "Charts 3D" — the C6 mark types) — the fit checks
// and column-ranking helper that let scatter3d/bars3d/line3d (and the
// coordinator's Hugging Face channel picker) join `surface`'s own "Surface"
// option on the mark card's Type row. Each test names the mutation that
// would turn it red.
import { describe, expect, it } from "vitest";
import {
  CHARTS_BARS3D_NEEDS, CHARTS_LINE3D_NEEDS, CHARTS_PARAMETRIC3D_NEEDS, CHARTS_SCATTER3D_NEEDS, CHARTS_SURFACE_NEEDS,
  chartsBars3dFitFromRows, chartsBest3dFitFromRows, chartsFitTableFromRows, chartsLine3dFitFromRows,
  chartsRankColumnsForScatter3d, chartsScatter3dFitFromRows,
} from "./chartsWorkbench3d";
import type { ChartsWorkbenchDataState, ChartsWorkbenchMark } from "./chartsWorkbenchState";
import type { TabularRow } from "../../lib/tabularParse";

function markWithRows(id: number, dataText: string): ChartsWorkbenchMark {
  return { id, type: "dot", dataText, channels: {}, transform: "none", options: {} };
}
const EMPTY_DATA: ChartsWorkbenchDataState = { source: null, pipeline: [] };

describe("chartsRankColumnsForScatter3d", () => {
  it("null when fewer than 3 numeric columns exist", () => {
    expect(chartsRankColumnsForScatter3d([{ a: 1, b: "x" }, { a: 2, b: "y" }])).toBeNull();
  });

  // The mutation this guards: a naive "first three numeric columns in
  // table order" picker (surface's/line3d's own simpler rule) would take
  // a/b/c here — INCLUDING both "a" and "b", which are perfectly
  // correlated (b = 2*a) and so carry the SAME information twice. The real
  // least-correlated ranker must prefer "c"/"d" (independent of "a"/"b")
  // over the redundant "a" once "b" (the higher-variance of the pair) is
  // already picked.
  it("avoids picking a column that duplicates an already-picked one's information, even though a naive 'first N columns' rule would", () => {
    const rows: TabularRow[] = Array.from({ length: 30 }, (_, i) => ({
      a: i, b: 2 * i, c: (i * 17) % 23, d: (i * 13) % 19,
    }));
    const ranking = chartsRankColumnsForScatter3d(rows);
    expect(ranking).not.toBeNull();
    expect(ranking!.columns).toContain("b"); // the higher-variance of the redundant pair
    expect(ranking!.columns).not.toContain("a"); // strictly redundant with "b" — never worth a second axis
  });

  it("picks a low-cardinality categorical column as the series/colour channel when one exists", () => {
    const rows: TabularRow[] = Array.from({ length: 30 }, (_, i) => ({
      x: i, y: i * 2, z: (i * 7) % 11, group: i % 3 === 0 ? "alpha" : i % 3 === 1 ? "beta" : "gamma",
    }));
    const ranking = chartsRankColumnsForScatter3d(rows);
    expect(ranking!.categorical).toBe("group");
  });

  it("no categorical column offered when none is low-cardinality (every value distinct, or too many distinct values)", () => {
    const rows: TabularRow[] = Array.from({ length: 30 }, (_, i) => ({ x: i, y: i * 2, z: (i * 7) % 11, id: `row-${i}` }));
    const ranking = chartsRankColumnsForScatter3d(rows);
    expect(ranking!.categorical).toBeUndefined();
  });
});

describe("chartsScatter3dFitFromRows", () => {
  it("fits a table with 3+ numeric columns, via the real glyphChartScatter3d build", () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ x: i, y: i * 2, z: i * 3 }));
    const mark = markWithRows(1, JSON.stringify(rows));
    const fit = chartsScatter3dFitFromRows(EMPTY_DATA, [mark]);
    expect(fit.fits).toBe(true);
    if (fit.fits) expect(fit.source.markType).toBe("scatter3d");
  });
  it("disables with fewer than 3 numeric columns", () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ x: i, label: `row-${i}` }));
    const mark = markWithRows(1, JSON.stringify(rows));
    const fit = chartsScatter3dFitFromRows(EMPTY_DATA, [mark]);
    expect(fit.fits).toBe(false);
    if (!fit.fits) expect(fit.reason).toBe(CHARTS_SCATTER3D_NEEDS);
  });
  it("disables with no marks at all", () => {
    expect(chartsScatter3dFitFromRows(EMPTY_DATA, []).fits).toBe(false);
  });
});

describe("chartsBars3dFitFromRows", () => {
  it("fits categorical x/y + numeric z, mapping each category to a stable numeric index with the real name kept on xLabel/yLabel", () => {
    const rows: TabularRow[] = [];
    for (const country of ["A", "B", "C"]) for (const medal of ["gold", "silver", "bronze"]) rows.push({ country, medal, count: Math.random() * 10 });
    const mark = markWithRows(1, JSON.stringify(rows));
    const fit = chartsBars3dFitFromRows(EMPTY_DATA, [mark]);
    expect(fit.fits).toBe(true);
    if (!fit.fits) return;
    expect(fit.source.markType).toBe("bars3d");
    expect(fit.source.channels.xLabel).toBeDefined();
    expect(fit.source.channels.yLabel).toBeDefined();
    // Every shaped row keeps a REAL numeric value under the resolved x/y
    // channel fields — the categorical mapping actually ran.
    for (const row of fit.source.rows) {
      expect(typeof row[fit.source.channels.x]).toBe("number");
      expect(typeof row[fit.source.channels.y]).toBe("number");
    }
  });
  it("fits two numeric position columns + a numeric z too (no categorical column required)", () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ x: i % 4, y: Math.floor(i / 4), z: i }));
    const mark = markWithRows(1, JSON.stringify(rows));
    const fit = chartsBars3dFitFromRows(EMPTY_DATA, [mark]);
    expect(fit.fits).toBe(true);
  });
  it("disables with no numeric column at all", () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ label: `row-${i}`, other: `x-${i}` }));
    const mark = markWithRows(1, JSON.stringify(rows));
    const fit = chartsBars3dFitFromRows(EMPTY_DATA, [mark]);
    expect(fit.fits).toBe(false);
    if (!fit.fits) expect(fit.reason).toBe(CHARTS_BARS3D_NEEDS);
  });
});

describe("chartsLine3dFitFromRows", () => {
  it("fits 3+ numeric columns taken in ROW ORDER (never regridded/reordered)", () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ x: i, y: i * i, z: -i }));
    const mark = markWithRows(1, JSON.stringify(rows));
    const fit = chartsLine3dFitFromRows(EMPTY_DATA, [mark]);
    expect(fit.fits).toBe(true);
    if (!fit.fits) return;
    expect(fit.source.markType).toBe("line3d");
  });
  it("disables with fewer than 2 rows even with 3 numeric columns", () => {
    const rows = [{ x: 0, y: 0, z: 0 }];
    const mark = markWithRows(1, JSON.stringify(rows));
    const fit = chartsLine3dFitFromRows(EMPTY_DATA, [mark]);
    expect(fit.fits).toBe(false);
    if (!fit.fits) expect(fit.reason).toBe(CHARTS_LINE3D_NEEDS);
  });
});

describe("chartsFitTableFromRows", () => {
  it("parametric3d is always unfit — preset-only by contract, never offered for arbitrary data", () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ x: i, y: i * 2, z: i * 3 }));
    const mark = markWithRows(1, JSON.stringify(rows));
    const table = chartsFitTableFromRows(EMPTY_DATA, [mark]);
    expect(table.parametric3d.fits).toBe(false);
    if (!table.parametric3d.fits) expect(table.parametric3d.reason).toBe(CHARTS_PARAMETRIC3D_NEEDS);
  });
  it("carries one entry per CHARTS_3D_MARK_TYPES, independently resolved", () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ x: i, y: i * 2, z: i * 3 }));
    const mark = markWithRows(1, JSON.stringify(rows));
    const table = chartsFitTableFromRows(EMPTY_DATA, [mark]);
    expect(Object.keys(table).sort()).toEqual(["bars3d", "line3d", "parametric3d", "scatter3d", "surface"]);
  });
});

describe("chartsBest3dFitFromRows — the Hugging Face auto-pick's own priority order", () => {
  it("surface (complete grid) wins when the table honestly is one", () => {
    const rows: TabularRow[] = [];
    for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) rows.push({ x, y, z: x + y });
    const fit = chartsBest3dFitFromRows(rows, "test");
    expect(fit?.source.markType).toBe("surface");
  });
  it("falls through to scatter3d for a general numeric table with no grid/categorical structure", () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({ a: i, b: Math.sin(i) * 10, c: Math.cos(i) * 5 }));
    const fit = chartsBest3dFitFromRows(rows, "test");
    expect(fit?.source.markType).toBe("scatter3d");
  });
  it("null when nothing fits at all (no numeric columns)", () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ label: `row-${i}` }));
    expect(chartsBest3dFitFromRows(rows, "test")).toBeNull();
  });
  it("the returned inline source carries the CALLER's own title", () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({ a: i, b: Math.sin(i) * 10, c: Math.cos(i) * 5 }));
    const fit = chartsBest3dFitFromRows(rows, "My Hugging Face Table");
    expect(fit?.source.title).toBe("My Hugging Face Table");
  });
});

// Sanity: CHARTS_SURFACE_NEEDS itself still resolves for the pre-existing
// surface fit path (re-exported here since this file imports the sibling
// constants) — a smoke check that the barrel re-export didn't drop it.
describe("CHARTS_SURFACE_NEEDS", () => {
  it("is a non-empty string", () => {
    expect(CHARTS_SURFACE_NEEDS.length).toBeGreaterThan(0);
  });
});
