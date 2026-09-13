import { describe, expect, it } from "vitest";
import { compileDateFormat, compileExpression, ExpressionError, PipelineFormatError, runPipeline, type PipelineStep } from "./dataPipeline";
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

  // ── F2/P1-2 — `parseDate`'s format string never reaches `new RegExp`
  // unescaped ────────────────────────────────────────────────────────────
  //
  // A user-typed `format` used to be interpolated into `new RegExp` after
  // only the three token substitutions — every other character (including
  // a regex metacharacter) survived verbatim as live regex SOURCE. That was
  // both a ReDoS vector from a shared `?c=` link and a silent-null footgun
  // for an innocent typo. Mutation check: reverting `compileDateFormat` to
  // the old `format.replace(/YYYY/g,…).replace(...)` + bare `new RegExp`
  // makes the ReDoS assertion below time out well past 50ms (measured
  // ~50-60 SECONDS for `(a+)+b` against a 40-character row in the
  // reviewer's own repro) — it does not merely fail, it hangs the test run,
  // which is the defect itself.
  it("a catastrophic-backtracking format compiles to a literal match and returns in well under 50ms (ReDoS)", () => {
    const started = performance.now();
    const result = runPipeline([{ d: "a".repeat(40) }], [{ kind: "parseDate", column: "d", format: "(a+)+b" }]);
    const elapsedMs = performance.now() - started;
    expect(elapsedMs).toBeLessThan(50);
    if (!result.ok) throw new Error(result.error);
    // The format has no YYYY/MM/DD token at all, so it can never produce a
    // date — the important assertion is the ELAPSED TIME above; this just
    // confirms the pipeline didn't throw or hang getting there.
    expect(result.rows[0]!.d).toBeNull();
  });

  it("escapes a metacharacter used as a literal separator instead of interpreting it as regex syntax", () => {
    // Before the fix, an unescaped "." is "match any character" — a WRONG
    // separator ("X" instead of ".") would incorrectly validate. After the
    // fix "." is literal, so only the real separator matches.
    const wrongSeparator = runPipeline([{ d: "2020X01X01" }], [{ kind: "parseDate", column: "d", format: "YYYY.MM.DD" }]);
    if (!wrongSeparator.ok) throw new Error(wrongSeparator.error);
    expect(wrongSeparator.rows[0]!.d).toBeNull();
  });

  it("an innocent metacharacter separator still parses correctly, never nulling the column", () => {
    const result = runPipeline([{ d: "2020.01.02" }], [{ kind: "parseDate", column: "d", format: "YYYY.MM.DD" }]);
    if (!result.ok) throw new Error(result.error);
    expect(result.rows[0]!.d).toBe(new Date(Date.UTC(2020, 0, 2)).toISOString());
  });

  it("rejects an unrecognized date-format token as a structured pipeline error naming the step", () => {
    const result = runPipeline([{ d: "2020-01-01" }], [{ kind: "parseDate", column: "d", format: "YYY-MM-DD" }]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.stepIndex).toBe(0);
    expect(result.error).toMatch(/YYY/);
  });

  it("a bad token is rejected as PipelineFormatError specifically, not a bare Error", () => {
    expect(() => compileDateFormat("MMM")).toThrow(PipelineFormatError);
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

// ── F4/P2-1 — the whitelist and the column lookup are closed prototype
// chains, not plain objects ────────────────────────────────────────────
//
// `EXPRESSION_FUNCTIONS` was a plain object literal and the "col" AST node
// read `row[name]` directly — both resolve an inherited `Object.prototype`
// member for one of these ten names even though the whitelist table never
// mentions them. Mutation check: reverting `EXPRESSION_FUNCTIONS` from
// `Object.assign(Object.create(null), {...})` back to a plain `{...}`
// literal makes `constructor(1)` return the real `Object` constructor
// (truthy, not `null`) — the first assertion below goes red. Reverting the
// "col" case from `Object.hasOwn(row, node.name) ? row[node.name] : null`
// back to `row[node.name] ?? null` makes the bare-identifier assertion
// return the same live constructor function instead of `null` — the second
// assertion goes red. Both were independently verified by hand before
// writing this comment.
describe("compileExpression — closed whitelist and column lookup (F4/P2-1)", () => {
  const PROTOTYPE_NAMES = [
    "constructor", "toString", "valueOf", "hasOwnProperty", "propertyIsEnumerable",
    "isPrototypeOf", "toLocaleString", "__defineGetter__", "__defineSetter__", "__proto__",
  ] as const;

  it.each(PROTOTYPE_NAMES)("a call to %s(...) is an inert null, never the real Object.prototype method", (name) => {
    expect(compileExpression(`${name}(1)`)({})).toBeNull();
  });

  it.each(PROTOTYPE_NAMES)("a bare %s column reads null unless the row itself owns that name", (name) => {
    expect(compileExpression(name)({})).toBeNull();
    // Bracket/computed assignment sets a real OWN property (never the
    // object's actual prototype, unlike the non-computed `{ __proto__: v }`
    // literal form) — a row that genuinely has a column with this name
    // must still read it back.
    expect(compileExpression(name)({ [name]: "own value" } as TabularRow)).toBe("own value");
  });
});
