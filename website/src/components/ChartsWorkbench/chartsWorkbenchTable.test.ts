import { describe, expect, it } from "vitest";
import {
  chartMarkTable, createChartsWorkbenchState, reduceChartsWorkbenchState,
  type ChartsWorkbenchMark, type ChartsWorkbenchState,
} from "./chartsWorkbenchState";

/**
 * Packet "renderers, legends, axes, table editor" item 7 — the table editor
 * is a pure reducer over `dataText`, tested here with NO DOM at all (the
 * component itself, `ChartsMarkCard.tsx`, only ever calls these actions).
 */
const numericMark = (dataText: string): ChartsWorkbenchMark => ({ id: 1, type: "line", dataText, channels: {}, transform: "none", options: {} });
const recordMark = (dataText: string): ChartsWorkbenchMark => ({ id: 1, type: "bar", dataText, channels: { x: "month", y: "value" }, transform: "none", options: {} });
const withMark = (state: ChartsWorkbenchState, mark: ChartsWorkbenchMark): ChartsWorkbenchState => ({ ...state, marks: [mark] });
const base = createChartsWorkbenchState();

describe("chartMarkTable — pure derivation from dataText", () => {
  it("a numeric array becomes a single 'value' column", () => {
    const table = chartMarkTable(numericMark("[3,5,2,8]"));
    expect(table).toEqual({ ok: true, columns: ["value"], rows: [{ value: 3 }, { value: 5 }, { value: 2 }, { value: 8 }] });
  });

  it("a record array's columns are the union of every row's keys, in first-seen order", () => {
    const table = chartMarkTable(recordMark(`[{"month":"Jan","value":3},{"month":"Feb","value":5,"note":"peak"}]`));
    expect(table.columns).toEqual(["month", "value", "note"]);
    expect(table.rows).toEqual([{ month: "Jan", value: 3 }, { month: "Feb", value: 5, note: "peak" }]);
  });

  it("invalid JSON reports ok: false instead of throwing", () => {
    expect(chartMarkTable(numericMark("not json")).ok).toBe(false);
  });
});

describe("table editor reducer actions", () => {
  it("setCell parses a numeric string into a number", () => {
    const state = reduceChartsWorkbenchState(withMark(base, numericMark("[3,5,2,8]")), { type: "set-cell", id: 1, row: 1, column: "value", value: "42" });
    expect(chartMarkTable(state.marks[0]!).rows).toEqual([{ value: 3 }, { value: 42 }, { value: 2 }, { value: 8 }]);
  });

  it("setCell keeps a Date-looking string as a string, never coerced to a number", () => {
    const state = reduceChartsWorkbenchState(withMark(base, recordMark(`[{"month":"Jan","value":3}]`)), { type: "set-cell", id: 1, row: 0, column: "month", value: "2026-03-01" });
    expect(chartMarkTable(state.marks[0]!).rows[0]!.month).toBe("2026-03-01");
    expect(typeof chartMarkTable(state.marks[0]!).rows[0]!.month).toBe("string");
  });

  it("addRow appends a row with every existing column defaulted", () => {
    const state = reduceChartsWorkbenchState(withMark(base, recordMark(`[{"month":"Jan","value":3}]`)), { type: "add-row", id: 1 });
    const table = chartMarkTable(state.marks[0]!);
    expect(table.rows).toHaveLength(2);
    expect(table.rows[1]).toEqual({ month: 0, value: 0 });
  });

  it("removeRow drops exactly the targeted row, keeping the others in order", () => {
    const state = reduceChartsWorkbenchState(withMark(base, numericMark("[3,5,2,8]")), { type: "remove-row", id: 1, row: 2 });
    expect(chartMarkTable(state.marks[0]!).rows).toEqual([{ value: 3 }, { value: 5 }, { value: 8 }]);
  });

  it("addColumn on a numeric-array table promotes it to records, keeping 'value' and defaulting the new column", () => {
    const state = reduceChartsWorkbenchState(withMark(base, numericMark("[3,5]")), { type: "add-column", id: 1, column: "region" });
    const table = chartMarkTable(state.marks[0]!);
    expect(table.columns).toEqual(["value", "region"]);
    expect(table.rows).toEqual([{ value: 3, region: 0 }, { value: 5, region: 0 }]);
  });

  it("addColumn is a no-op for a duplicate or empty name", () => {
    const mark = recordMark(`[{"month":"Jan","value":3}]`);
    const dup = reduceChartsWorkbenchState(withMark(base, mark), { type: "add-column", id: 1, column: "value" });
    expect(dup.marks[0]!.dataText).toBe(mark.dataText);
    const empty = reduceChartsWorkbenchState(withMark(base, mark), { type: "add-column", id: 1, column: "" });
    expect(empty.marks[0]!.dataText).toBe(mark.dataText);
  });

  it("removeColumn drops the field from every row", () => {
    const state = reduceChartsWorkbenchState(withMark(base, recordMark(`[{"month":"Jan","value":3,"note":"x"}]`)), { type: "remove-column", id: 1, column: "note" });
    expect(chartMarkTable(state.marks[0]!).rows).toEqual([{ month: "Jan", value: 3 }]);
  });

  it("renameColumn renames the field across every row and preserves column order", () => {
    const state = reduceChartsWorkbenchState(withMark(base, recordMark(`[{"month":"Jan","value":3}]`)), { type: "rename-column", id: 1, column: "month", next: "period" });
    const table = chartMarkTable(state.marks[0]!);
    expect(table.columns).toEqual(["period", "value"]);
    expect(table.rows).toEqual([{ period: "Jan", value: 3 }]);
  });

  it("renameColumn to an already-existing name is a no-op", () => {
    const mark = recordMark(`[{"month":"Jan","value":3}]`);
    const state = reduceChartsWorkbenchState(withMark(base, mark), { type: "rename-column", id: 1, column: "month", next: "value" });
    expect(state.marks[0]!.dataText).toBe(mark.dataText);
  });

  it("renaming 'value' on a numeric-array table promotes it to a record with the new field name", () => {
    const state = reduceChartsWorkbenchState(withMark(base, numericMark("[3,5]")), { type: "rename-column", id: 1, column: "value", next: "count" });
    expect(chartMarkTable(state.marks[0]!).rows).toEqual([{ count: 3 }, { count: 5 }]);
  });

  it("the table and JSON views are one state: a table edit is visible immediately as JSON text", () => {
    const state = reduceChartsWorkbenchState(withMark(base, numericMark("[3,5,2,8]")), { type: "set-cell", id: 1, row: 0, column: "value", value: "99" });
    expect(JSON.parse(state.marks[0]!.dataText)).toEqual([99, 5, 2, 8]);
  });

  it("mutation guard: an action targeting a different mark id leaves this mark's dataText untouched", () => {
    const mark = numericMark("[3,5]");
    const state = reduceChartsWorkbenchState(withMark(base, mark), { type: "set-cell", id: 999, row: 0, column: "value", value: "1" });
    expect(state.marks[0]!.dataText).toBe(mark.dataText);
  });
});
