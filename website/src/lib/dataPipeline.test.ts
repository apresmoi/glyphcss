import { describe, expect, it } from "vitest";
import { compileExpression, ExpressionError, runPipeline, type PipelineStep } from "./dataPipeline";
import type { TabularRow } from "./tabularParse";

describe("runPipeline — select/flatten", () => {
  it("selects a nested array with [*] and flattens its records", () => {
    const input = { meta: { count: 2 }, items: [{ id: 1, info: { name: "a" } }, { id: 2, info: { name: "b" } }] };
    const steps: PipelineStep[] = [{ kind: "select", path: "items[*]" }, { kind: "flatten" }];
    const result = runPipeline(input, steps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.rows).toEqual([{ id: 1, "info.name": "a" }, { id: 2, "info.name": "b" }]);
  });

  it("reports a step index on failure", () => {
    const result = runPipeline([{ a: 1 }], [{ kind: "filter", column: "a", operator: "==", value: "1" }, { kind: "derive", column: "b", expression: "((" }]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.stepIndex).toBe(1);
  });
});

describe("runPipeline — pivot", () => {
  it("pivotLonger turns wide columns into key/value rows", () => {
    const rows: TabularRow[] = [{ country: "US", 2020: 10, 2021: 12 }];
    const result = runPipeline(rows, [{ kind: "pivotLonger", idColumns: ["country"], keyColumn: "year", valueColumn: "value" }]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.rows).toEqual([
      { country: "US", year: "2020", value: 10 },
      { country: "US", year: "2021", value: 12 },
    ]);
  });

  it("pivotWider is the inverse of pivotLonger for the same shape", () => {
    const long: TabularRow[] = [
      { country: "US", year: "2020", value: 10 },
      { country: "US", year: "2021", value: 12 },
    ];
    const result = runPipeline(long, [{ kind: "pivotWider", keyColumn: "year", valueColumn: "value" }]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.rows).toEqual([{ country: "US", "2020": 10, "2021": 12 }]);
  });
});

describe("runPipeline — filter/sort/limit/parseDate", () => {
  const rows: TabularRow[] = [{ a: 3, d: "2021-06-01" }, { a: 1, d: "2020-01-01" }, { a: 2, d: "2022-12-31" }];

  it("filter keeps rows matching the operator", () => {
    const result = runPipeline(rows, [{ kind: "filter", column: "a", operator: ">", value: "1" }]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.rows.map((r) => r.a)).toEqual([3, 2]);
  });

  it("sort orders ascending by default and descending when asked", () => {
    const asc = runPipeline(rows, [{ kind: "sort", column: "a" }]);
    const desc = runPipeline(rows, [{ kind: "sort", column: "a", direction: "desc" }]);
    if (!asc.ok || !desc.ok) throw new Error("expected ok");
    expect(asc.rows.map((r) => r.a)).toEqual([1, 2, 3]);
    expect(desc.rows.map((r) => r.a)).toEqual([3, 2, 1]);
  });

  it("limit truncates to the requested count", () => {
    const result = runPipeline(rows, [{ kind: "limit", count: 2 }]);
    if (!result.ok) throw new Error(result.error);
    expect(result.rows).toHaveLength(2);
  });

  it("parseDate normalizes to ISO", () => {
    const result = runPipeline([{ d: "06/01/2021" }], [{ kind: "parseDate", column: "d", format: "MM/DD/YYYY" }]);
    if (!result.ok) throw new Error(result.error);
    expect(result.rows[0]!.d).toBe(new Date(Date.UTC(2021, 5, 1)).toISOString());
  });

  it("parseDate with no format falls back to Date.parse and yields null for unparseable text", () => {
    const result = runPipeline([{ d: "not a date" }], [{ kind: "parseDate", column: "d" }]);
    if (!result.ok) throw new Error(result.error);
    expect(result.rows[0]!.d).toBeNull();
  });
});

describe("runPipeline — derive", () => {
  it("computes arithmetic, comparisons, and whitelisted function calls", () => {
    const rows: TabularRow[] = [{ x: 3, y: 4 }];
    const result = runPipeline(rows, [{ kind: "derive", column: "dist", expression: "sqrt(x*x + y*y)" }]);
    if (!result.ok) throw new Error(result.error);
    expect(result.rows[0]!.dist).toBe(5);
  });

  it("supports logical operators and string concatenation", () => {
    const rows: TabularRow[] = [{ a: 5, b: 10, name: "x" }];
    const result = runPipeline(rows, [
      { kind: "derive", column: "big", expression: "a > 3 && b > 3" },
      { kind: "derive", column: "label", expression: '"item-" + name' },
    ]);
    if (!result.ok) throw new Error(result.error);
    expect(result.rows[0]!.big).toBe(true);
    expect(result.rows[0]!.label).toBe("item-x");
  });

  it("extracts date components with year/month/day", () => {
    const rows: TabularRow[] = [{ d: "2023-05-17" }];
    const result = runPipeline(rows, [{ kind: "derive", column: "y", expression: "year(d)" }]);
    if (!result.ok) throw new Error(result.error);
    expect(result.rows[0]!.y).toBe(2023);
  });

  it("rejects a malformed expression as a structured pipeline error", () => {
    const result = runPipeline([{ a: 1 }], [{ kind: "derive", column: "b", expression: "a +" }]);
    expect(result.ok).toBe(false);
  });
});

// ── Safe-evaluator mutation check ─────────────────────────────────────────
//
// These pin the property "derive never reaches `eval`/`new Function`" with
// assertions that would FAIL if the implementation were ever swapped for a
// naive `new Function(expr)(row)` — a real eval would execute the payload
// below and produce a non-null/observable result; the safe evaluator must
// treat every one of these as an inert unknown identifier/call or a plain
// syntax error instead.
describe("compileExpression — rejects eval-like input", () => {
  it("never executes eval/Function-style calls — they resolve to null via the closed whitelist", () => {
    // A real `eval`/`new Function` would compute 2 here. The whitelist has
    // no "eval" entry, so a call to it must be a no-op, not an execution.
    expect(compileExpression("eval(1 + 1)")({})).toBeNull();
    expect(compileExpression("Function(1)")({})).toBeNull();
  });

  it("treats a bare global identifier as a column lookup, never the real global", () => {
    // A real eval would resolve `globalThis`/`process` to live host objects.
    // Here an identifier that isn't a whitelisted function name and isn't a
    // column on the row is just `null`.
    expect(compileExpression("globalThis")({})).toBeNull();
    expect(compileExpression("process")({ process: "not the real one" })).toBe("not the real one");
  });

  it("cannot reach property/constructor access at all — the tokenizer has no '.' operator", () => {
    // The classic sandbox-escape shape `constructor.constructor('return process')()`
    // depends on `.` member access, which this grammar simply does not have —
    // it is a syntax error, not a permitted-but-inert expression.
    expect(() => compileExpression("row.constructor")).toThrow(ExpressionError);
    expect(() => compileExpression("constructor.constructor('return 1')()")).toThrow(ExpressionError);
  });

  it("rejects a template literal / backtick payload as a syntax error", () => {
    expect(() => compileExpression("`${1+1}`")).toThrow(ExpressionError);
  });

  it("only exposes the documented whitelist — an arbitrary unknown function call is inert", () => {
    expect(compileExpression("require('fs')")({})).toBeNull();
    expect(compileExpression("abs(-5)")({})).toBe(5); // the whitelist itself still works
  });
});
