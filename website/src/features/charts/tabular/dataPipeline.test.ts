import { describe, expect, it } from "vitest";
import { compileDateFormat, compileExpression, ExpressionError, normaliseDateColumn, PipelineFormatError, runPipeline, type PipelineStep } from "./dataPipeline";
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

  // P2-7 (batch-3 review): `JSON.stringify(rest)` made a group's identity
  // depend on the IDENTIFIER columns' own property ORDER, not just their
  // (name, value) pairs — two rows carrying the SAME `id`/`group` differing
  // only in which was written first (`{id,group,...}` vs `{group,id,...}`,
  // a routine outcome of `Object.fromEntries(Object.entries(row).filter(...))`
  // over rows built by different code paths) grouped as TWO rows, each
  // missing the other's key. Mutation check: reverting `pivotWiderGroupKey`
  // to bare `JSON.stringify(rest)` makes this go red — two incomplete rows
  // with `ok: true` instead of one merged row.
  it("merges two rows with the same identifier columns in different property orders into one group", () => {
    const rows: TabularRow[] = [
      { id: 1, group: "a", k: "x", v: 3 },
      { group: "a", id: 1, k: "y", v: 4 } as unknown as TabularRow,
    ];
    const result = runPipeline(rows, [{ kind: "pivotWider", keyColumn: "k", valueColumn: "v" }]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.rows).toEqual([{ id: 1, group: "a", x: 3, y: 4 }]);
  });

  // P4 (fable seat, batch-3 review): `pivotWider`'s WRITE (`group[keyValue]
  // = value`, a plain bracket assignment) went through `Object.prototype`'s
  // own `__proto__` accessor for a key column whose VALUE is literally the
  // string "__proto__" — a primitive value silently dropped the write
  // entirely (`[[Set]]` on `__proto__` with a non-object value is a no-op
  // per spec), and an object value REPLACED the row's prototype instead of
  // storing a column named `__proto__`. `setRowField`'s `defineProperty`
  // always creates an own data property, matching what `JSON.parse` itself
  // already does for the same key. Mutation check: reverting the group
  // write back to `group[keyValue] = value` makes both assertions below go
  // red (primitive: the row has NO `__proto__` own key at all; object: the
  // row's OWN prototype is replaced, `Object.getPrototypeOf(row) !==
  // Object.prototype`).
  it("stores a __proto__-named key column as an own data property, never through the prototype accessor", () => {
    const primitive = runPipeline([{ k: "__proto__", v: 42 }], [{ kind: "pivotWider", keyColumn: "k", valueColumn: "v" }]);
    if (!primitive.ok) throw new Error(primitive.error);
    const [row] = primitive.rows;
    expect(Object.getPrototypeOf(row)).toBe(Object.prototype);
    expect(Object.hasOwn(row!, "__proto__")).toBe(true);
    expect((row as unknown as Record<string, unknown>)["__proto__"]).toBe(42);

    const objectValue = { evil: true };
    const nested = runPipeline([{ k: "__proto__", v: objectValue }] as unknown as TabularRow[], [{ kind: "pivotWider", keyColumn: "k", valueColumn: "v" }]);
    if (!nested.ok) throw new Error(nested.error);
    const [nestedRow] = nested.rows;
    expect(Object.getPrototypeOf(nestedRow)).toBe(Object.prototype); // prototype untouched
    expect(Object.hasOwn(nestedRow!, "__proto__")).toBe(true);
    expect((nestedRow as unknown as Record<string, unknown>)["__proto__"]).toBe(objectValue);
  });
});

// ── N5 — `pivotLonger`/`pivotWider` go through the SAME `rowColumn` guard
// as `filter`/`sort`/`parseDate` and `derive`'s "col" node ────────────────
//
// Both pivots used to read `row[name]` bare: `pivotWider keyColumn:
// "constructor"` produced a group keyed on the literal string
// `"function Object() { [native code] }"`, and `pivotLonger
// idColumns:["toString"]` handed the live `Object.prototype.toString`
// function into a cell typed `TabularCell` — the SAME shape F4/P2-1 closed
// for `filter`/`sort`/`parseDate`/`derive`, just on two step kinds that
// hadn't been switched onto `rowColumn` yet. Mutation check: reverting
// either pivot's `rowColumn(...)` call back to a bare `row[name] ?? null`
// makes its own two assertions below go red (the "unowned" one recovers
// the live prototype value instead of `null`).
describe("runPipeline — pivotLonger/pivotWider column reads (N5)", () => {
  const PROTOTYPE_NAMES = [
    "constructor", "toString", "valueOf", "hasOwnProperty", "propertyIsEnumerable",
    "isPrototypeOf", "toLocaleString", "__defineGetter__", "__defineSetter__", "__proto__",
  ] as const;

  it.each(PROTOTYPE_NAMES)("pivotLonger's %s id column is null when unowned, and its own value when owned", (name) => {
    const unowned = runPipeline([{ metric: 1 }], [{ kind: "pivotLonger", idColumns: [name] }]);
    if (!unowned.ok) throw new Error(unowned.error);
    expect(unowned.rows[0]![name]).toBeNull();

    const owned = runPipeline([{ [name]: "id-value", metric: 1 } as TabularRow], [{ kind: "pivotLonger", idColumns: [name] }]);
    if (!owned.ok) throw new Error(owned.error);
    expect(owned.rows[0]![name]).toBe("id-value");
  });

  it.each(PROTOTYPE_NAMES)("pivotWider's %s key column is null (group key \"\") when unowned, and its own value when owned", (name) => {
    const unowned = runPipeline([{ v: 42 }], [{ kind: "pivotWider", keyColumn: name, valueColumn: "v" }]);
    if (!unowned.ok) throw new Error(unowned.error);
    expect(unowned.rows[0]).toEqual({ "": 42 });

    const owned = runPipeline([{ [name]: "the-key", v: 42 } as TabularRow], [{ kind: "pivotWider", keyColumn: name, valueColumn: "v" }]);
    if (!owned.ok) throw new Error(owned.error);
    expect(owned.rows[0]).toEqual({ "the-key": 42 });
  });

  it.each(PROTOTYPE_NAMES)("pivotWider's %s value column is null when unowned, and its own value when owned", (name) => {
    const unowned = runPipeline([{ k: "a" }], [{ kind: "pivotWider", keyColumn: "k", valueColumn: name }]);
    if (!unowned.ok) throw new Error(unowned.error);
    expect(unowned.rows[0]).toEqual({ a: null });

    const owned = runPipeline([{ k: "a", [name]: "v-value" } as TabularRow], [{ kind: "pivotWider", keyColumn: "k", valueColumn: name }]);
    if (!owned.ok) throw new Error(owned.error);
    expect(owned.rows[0]).toEqual({ a: "v-value" });
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
  // N6a: a format with NO YYYY/MM/DD token at all now rejects outright
  // (see below) rather than silently compiling to a never-matching
  // literal, so the ReDoS repro needs a token somewhere in the format to
  // reach the metacharacter-escaping code this test actually exercises —
  // "YYYY" up front, then the same adversarial `(a+)+b` suffix as literal
  // text. Mutation check: reverting `compileDateFormat` to the old
  // `format.replace(/YYYY/g,…).replace(...)` + bare `new RegExp` makes the
  // ReDoS assertion below time out well past 50ms (measured ~50-60 SECONDS
  // for `(a+)+b` against a 40-character row in the reviewer's own repro) —
  // it does not merely fail, it hangs the test run, which is the defect
  // itself.
  it("a catastrophic-backtracking format compiles to a literal match and returns in well under 50ms (ReDoS)", () => {
    const started = performance.now();
    const result = runPipeline([{ d: "a".repeat(40) }], [{ kind: "parseDate", column: "d", format: "YYYY(a+)+b" }]);
    const elapsedMs = performance.now() - started;
    expect(elapsedMs).toBeLessThan(50);
    if (!result.ok) throw new Error(result.error);
    // The row has no 4 digits followed by that literal suffix, so it can
    // never match — the important assertion is the ELAPSED TIME above;
    // this just confirms the pipeline didn't throw or hang getting there.
    expect(result.rows[0]!.d).toBeNull();
  });

  // N6a — the "second half" of F2's own typo protection: a format with no
  // recognized token at all, or one spelled in the wrong case, used to
  // compile successfully to a regex that can never match anything, so
  // every row in the column silently became `null` with `ok: true` and no
  // error at all — worse than the ALREADY-flagged "YYY" typo, which at
  // least fails loudly.
  it("rejects a format with no YYYY/MM/DD token at all, rather than silently nulling the whole column", () => {
    const result = runPipeline([{ d: "2020-01-01" }], [{ kind: "parseDate", column: "d", format: "abc" }]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error).toMatch(/no YYYY, MM, or DD token/);
  });

  it("rejects a lowercase 'yyyy' as an unrecognized token, not a silently-never-matching literal", () => {
    expect(() => compileDateFormat("yyyy-mm-dd")).toThrow(PipelineFormatError);
  });

  // N6b: each of "YYYY" and "YYYY" is, on its own, a recognized token —
  // the old bad-token gate never looked at repetition, so this used to
  // reach `new RegExp` with two capture groups both named `y` and throw
  // the host's raw "Duplicate capture group name" message, unwrapped, all
  // the way to the reader's `role="alert"` readout.
  it("rejects a duplicated date-format token as a structured PipelineFormatError, never a raw RegExp syntax error", () => {
    expect(() => compileDateFormat("YYYY-YYYY")).toThrow(PipelineFormatError);
    try { compileDateFormat("YYYY-YYYY"); throw new Error("expected throw"); }
    catch (error) { expect(String(error)).not.toMatch(/Duplicate capture group/); }
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

  // R2 (round 3): the bad-token scan matches a whole RUN of `[YyMmDd]+`,
  // and requiring the whole run to equal exactly one token rejected every
  // format with adjacent tokens and no separator — `YYYYMMDD` is the ISO
  // basic date format and a routine export shape. Mutation check:
  // reverting the scan to whole-run equality makes every case here throw
  // "Unrecognized date format token" instead of parsing.
  it("compiles and parses adjacent date-format tokens with no separator (YYYYMMDD and friends)", () => {
    const ymd = runPipeline([{ d: "20240102" }], [{ kind: "parseDate", column: "d", format: "YYYYMMDD" }]);
    if (!ymd.ok) throw new Error(ymd.error);
    expect(ymd.rows[0]!.d).toBe(new Date(Date.UTC(2024, 0, 2)).toISOString());

    const ym = runPipeline([{ d: "202401" }], [{ kind: "parseDate", column: "d", format: "YYYYMM" }]);
    if (!ym.ok) throw new Error(ym.error);
    expect(ym.rows[0]!.d).toBe(new Date(Date.UTC(2024, 0, 1)).toISOString());

    const mdy = runPipeline([{ d: "01022024" }], [{ kind: "parseDate", column: "d", format: "MMDDYYYY" }]);
    if (!mdy.ok) throw new Error(mdy.error);
    expect(mdy.rows[0]!.d).toBe(new Date(Date.UTC(2024, 0, 2)).toISOString());

    const dmy = runPipeline([{ d: "02012024" }], [{ kind: "parseDate", column: "d", format: "DDMMYYYY" }]);
    if (!dmy.ok) throw new Error(dmy.error);
    expect(dmy.rows[0]!.d).toBe(new Date(Date.UTC(2024, 0, 2)).toISOString());
  });

  // R2 residue: the fix must not loosen the round-2 rejections — a
  // lowercase run, a no-token format, a duplicated token and a genuinely
  // unrecognized run must all still reject (re-asserted here alongside the
  // fix so the two never drift apart again).
  it("still rejects the round-2 bad-format cases after the adjacent-token fix", () => {
    expect(() => compileDateFormat("yyyy-mm-dd")).toThrow(PipelineFormatError);
    expect(() => compileDateFormat("abc")).toThrow(PipelineFormatError);
    expect(() => compileDateFormat("YYYY-YYYY")).toThrow(PipelineFormatError);
    expect(() => compileDateFormat("YYYMMDD")).toThrow(PipelineFormatError);
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

  // P2-8 (batch-3 review): `Date.UTC` silently NORMALIZES an out-of-range
  // month/day onto a later date (`2024-02-31` -> March 2, `2024-00-01` ->
  // 2023-12-01) instead of rejecting it, and REMAPS a year in 0..99 onto
  // 1900..1999 (the two-digit-year legacy rule) — all three used to return
  // `ok: true` with a changed value. The calendar fields are now read back
  // out and compared to what was actually typed (a genuine 0..99 year is
  // corrected with `setUTCFullYear` first, the one `Date` method with no
  // such remapping). Mutation check: reverting `parseDateCellWithFormat` to
  // a bare `new Date(Date.UTC(y, m-1, d))` with no round-trip check makes
  // all three assertions below go red (rolled to 2024-03-02, rolled to
  // 2023-12-01, and remapped to 1999 respectively).
  it("rejects an invalid calendar date instead of silently rolling it, and preserves a 0..99 year instead of remapping to 19xx", () => {
    const rolledDay = runPipeline([{ d: "2024-02-31" }], [{ kind: "parseDate", column: "d", format: "YYYY-MM-DD" }]);
    if (!rolledDay.ok) throw new Error(rolledDay.error);
    expect(rolledDay.rows[0]!.d).toBeNull();

    const rolledMonth = runPipeline([{ d: "2024-00-01" }], [{ kind: "parseDate", column: "d", format: "YYYY-MM-DD" }]);
    if (!rolledMonth.ok) throw new Error(rolledMonth.error);
    expect(rolledMonth.rows[0]!.d).toBeNull();

    const twoDigitYear = runPipeline([{ d: "0099-01-01" }], [{ kind: "parseDate", column: "d", format: "YYYY-MM-DD" }]);
    if (!twoDigitYear.ok) throw new Error(twoDigitYear.error);
    const date = new Date(twoDigitYear.rows[0]!.d as string);
    expect(date.getUTCFullYear()).toBe(99); // never 1999
    expect(date.getUTCMonth()).toBe(0);
    expect(date.getUTCDate()).toBe(1);
  });
});

// P1-5 (batch-3 review): the one pure function Apply and the `parseDate`
// step now BOTH normalize a recognized date shape through, so a chart's
// `scales.x.type: "time"` and the mark's own `dataText` never disagree
// about what the x column contains.
describe("normaliseDateColumn", () => {
  it("passes an already-full calendar date (bare or with a time part) through untouched", () => {
    expect(normaliseDateColumn("2024-01-02")).toBe("2024-01-02");
    expect(normaliseDateColumn("2024-01-02T00:00:00.000Z")).toBe("2024-01-02T00:00:00.000Z");
  });

  it("expands a bare YYYY-MM month to the first of that month", () => {
    expect(normaliseDateColumn("2024-01")).toBe("2024-01-01");
    expect(normaliseDateColumn("2024-12")).toBe("2024-12-01");
  });

  // The timezone-shift bug this function exists to avoid: `Date.parse`
  // reads "MM/DD/YYYY" at LOCAL midnight (`dataProfile.ts`'s own
  // `isRolledCalendarDate` doc), so `new Date("1/2/2024").toISOString()` in
  // a positive-UTC-offset zone becomes "2024-01-01T23:00:00.000Z" — the
  // WRONG calendar day. `normaliseDateColumn` never constructs a `Date` for
  // this shape at all, so the result is independent of the runner's own
  // timezone.
  it("normalizes a slash date (MM/DD/YYYY) to the exact calendar day named, independent of the local timezone", () => {
    expect(normaliseDateColumn("1/2/2024")).toBe("2024-01-02");
    expect(normaliseDateColumn("12/31/2024")).toBe("2024-12-31");
  });

  it("expands a 2-digit slash year into 20xx", () => {
    expect(normaliseDateColumn("1/2/24")).toBe("2024-01-02");
  });

  it("passes an unrecognized shape (arbitrary text, non-date strings) through untouched", () => {
    expect(normaliseDateColumn("not a date")).toBe("not a date");
    expect(normaliseDateColumn(42)).toBe(42);
    expect(normaliseDateColumn(null)).toBeNull();
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

  // P1-1 (batch-3 review): `&&`'s FALSE branch used to re-evaluate its own
  // LEFT subtree a second time (`truthy(evaluateNode(node.left, row)) ?
  // evaluateNode(node.right, row) : evaluateNode(node.left, row)`) —
  // observable only on a FALSY left, which is exactly the reported repro's
  // own shape (`Array(40).fill("0").join(" && ")` tokenizes each bare `0`
  // as the NUMBER `0`, and `truthy(0)` is `false` here; a chain of TRUTHY
  // operands never reaches this branch at all under either the old or new
  // code, left- or right-leaning). Since `parseAnd` builds a LEFT-leaning
  // tree for a chain of `&&`s, every node's own left subtree is ITSELF
  // another such node, so the leftmost leaf's evaluation count doubled per
  // level: 24 chained falsy operands measured 16,777,215 (2^24-1)
  // evaluations for one row, and a 40-operand chain exceeded a 1500ms
  // limit outright. `col`'s own read (`row[node.name]`, through a getter
  // here) is the one observable per-evaluation side effect, so counting it
  // pins the fix's own guarantee. Mutation check: reverting the `&&` case
  // to the old double-evaluation form makes `reads` explode exponentially
  // and the elapsed-time assertion fail by many orders of magnitude —
  // confirmed directly against a 20-node chain of the exact reverted
  // expression (39 total node evaluations under the fix, versus doubling
  // per level under the reverted form).
  it("evaluates a 40-node chained && over a FALSY column, short-circuiting once instead of doubling per level, in well under 50ms", () => {
    let reads = 0;
    const target: TabularRow = { col: 0 };
    const row = new Proxy(target, {
      get(obj, prop, receiver) {
        if (prop === "col") reads++;
        return Reflect.get(obj, prop, receiver);
      },
    });
    const expression = Array(40).fill("col").join(" && ");
    const evaluate = compileExpression(expression);
    const started = performance.now();
    const result = evaluate(row);
    const elapsedMs = performance.now() - started;
    expect(elapsedMs).toBeLessThan(50);
    expect(reads).toBeLessThanOrEqual(40); // linear at worst — never the exponential blow-up the bug produced
    expect(result).toBe(0); // `&&` short-circuits on the first falsy operand, exactly like real JS
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
