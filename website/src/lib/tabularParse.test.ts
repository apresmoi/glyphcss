import { describe, expect, it } from "vitest";
import { parseTabular } from "./tabularParse";

describe("parseTabular", () => {
  it("parses CSV with quoted fields and embedded commas", () => {
    const csv = 'name,note\n"Acme, Inc.",42\nBob,"line1\nline2"';
    const result = parseTabular(csv);
    expect(result.ok).toBe(true);
    if (!result.ok || result.kind !== "rows") throw new Error("expected rows");
    expect(result.rows).toEqual([
      { name: "Acme, Inc.", note: 42 },
      { name: "Bob", note: "line1\nline2" },
    ]);
  });

  it("detects TSV by tab count in the first line", () => {
    const tsv = "a\tb\n1\t2";
    const result = parseTabular(tsv);
    expect(result.ok).toBe(true);
    if (!result.ok || result.kind !== "rows") throw new Error("expected rows");
    expect(result.rows).toEqual([{ a: 1, b: 2 }]);
  });

  it("forces TSV/CSV via a filename hint", () => {
    const oneColumn = "a,b\n1,2"; // would be sniffed as CSV; force TSV instead
    const result = parseTabular(oneColumn, { filename: "data.tsv" });
    expect(result.ok).toBe(true);
    if (!result.ok || result.kind !== "rows") throw new Error("expected rows");
    // No real tab in the text, so the whole line is one column.
    expect(result.rows[0]).toEqual({ "a,b": "1,2" });
  });

  it("parses a JSON array of records directly", () => {
    const json = JSON.stringify([{ x: 1, y: "a" }, { x: 2, y: "b" }]);
    const result = parseTabular(json);
    expect(result.ok).toBe(true);
    if (!result.ok || result.kind !== "rows") throw new Error("expected rows");
    expect(result.rows).toEqual([{ x: 1, y: "a" }, { x: 2, y: "b" }]);
  });

  it("parses a JSON array of arrays with a header row", () => {
    const json = JSON.stringify([["a", "b"], [1, 2], [3, 4]]);
    const result = parseTabular(json);
    expect(result.ok).toBe(true);
    if (!result.ok || result.kind !== "rows") throw new Error("expected rows");
    expect(result.rows).toEqual([{ a: 1, b: 2 }, { a: 3, b: 4 }]);
  });

  it("hands back a nested JSON object as kind 'json' for the pipeline to select from", () => {
    const json = JSON.stringify({ meta: { count: 2 }, items: [{ id: 1 }, { id: 2 }] });
    const result = parseTabular(json);
    expect(result.ok).toBe(true);
    if (!result.ok || result.kind !== "json") throw new Error("expected json");
    expect(result.value).toEqual({ meta: { count: 2 }, items: [{ id: 1 }, { id: 2 }] });
  });

  it("rejects empty input", () => {
    const result = parseTabular("   ");
    expect(result).toEqual({ ok: false, error: "Empty input." });
  });

  it("reports a JSON syntax error instead of throwing", () => {
    const result = parseTabular("{ bad json", { filename: "data.json" });
    expect(result.ok).toBe(false);
  });

  it("coerces booleans and numbers, leaves other strings alone", () => {
    const csv = "flag,count,label\ntrue,3.5,hello";
    const result = parseTabular(csv);
    expect(result.ok).toBe(true);
    if (!result.ok || result.kind !== "rows") throw new Error("expected rows");
    expect(result.rows[0]).toEqual({ flag: true, count: 3.5, label: "hello" });
  });

  // P2-3: `coerceCell` used to trim for TYPE DETECTION and then return the
  // untrimmed original for the plain-string fallback — inconsistent with
  // the header (already trimmed) and a numeric cell (`Number` trims
  // implicitly), and it split the ubiquitous `"a, b"` CSV shape into two
  // categories. Mutation check: reverting the fallback from `trimmed` to
  // `raw` makes this assertion fail (`" Paris"` !== `"Paris"`).
  it("trims a plain-string cell the same way a numeric/boolean cell is trimmed (F6/P2-3)", () => {
    const result = parseTabular("name, city\nBob, Paris\nAnn,Paris");
    expect(result.ok).toBe(true);
    if (!result.ok || result.kind !== "rows") throw new Error("expected rows");
    expect(result.rows).toEqual([{ name: "Bob", city: "Paris" }, { name: "Ann", city: "Paris" }]);
    // Both rows now land in the SAME category — the whole point of the fix.
    expect(new Set(result.rows.map((r) => r.city)).size).toBe(1);
  });

  // P3: a duplicate header used to silently drop the earlier column via
  // plain object-key collision (`"a,a\n1,2"` -> `{a:2}`, one value lost).
  it("gives a duplicate header a numbered suffix instead of silently dropping the earlier column", () => {
    const result = parseTabular("a,a\n1,2");
    expect(result.ok).toBe(true);
    if (!result.ok || result.kind !== "rows") throw new Error("expected rows");
    expect(result.rows).toEqual([{ a: 1, a_2: 2 }]);
  });

  // N9a: the naive numbering scheme's own generated suffix could still
  // collide with a LATER column that is itself literally named that way —
  // `"a,a,a_2"` used to generate `a_2` for the second `a` and then silently
  // re-collide with the third column's own real name `a_2`, losing ITS
  // value to the exact object-key collision this function exists to
  // prevent, one level later. Mutation check: reverting `dedupeHeaders` to
  // the per-original-name counter (`count===0 ? name : name_(count+1)`,
  // with no "already used" check) makes this go red — `a_2`'s value (3) is
  // silently overwritten by the second `a`'s value (2) at the same key.
  it("keeps climbing past an already-used name when a later column is itself literally the generated suffix", () => {
    const result = parseTabular("a,a,a_2\n1,2,3");
    expect(result.ok).toBe(true);
    if (!result.ok || result.kind !== "rows") throw new Error("expected rows");
    expect(result.rows).toEqual([{ a: 1, a_2: 2, a_3: 3 }]);
  });

  // N9c (batch-3 review): a "_<n>" suffix past Number.MAX_SAFE_INTEGER
  // (2^53) used to loop forever — `requested + 1` and this scheme's own
  // `n++` both stop advancing at that magnitude in IEEE-754 double
  // arithmetic (`2**53 + 1 === 2**53`), so `nextFree`'s `while
  // (used.has(...))` kept re-testing the SAME already-occupied name.
  // Mutation check: dropping the `Number.isSafeInteger` gate (treating
  // `requested >= 2` alone as sufficient) makes this hang past the 1500ms
  // vitest default test timeout instead of returning in well under 50ms.
  it("dedupes a header whose numeric suffix is past Number.MAX_SAFE_INTEGER, in well under 50ms", () => {
    const started = performance.now();
    const result = parseTabular("col_9007199254740992,col_9007199254740992\n1,2");
    const elapsedMs = performance.now() - started;
    expect(elapsedMs).toBeLessThan(50);
    expect(result.ok).toBe(true);
    if (!result.ok || result.kind !== "rows") throw new Error("expected rows");
    const [row] = result.rows;
    const names = Object.keys(row!);
    expect(names).toHaveLength(2);
    expect(new Set(names).size).toBe(2); // distinct names — neither value silently dropped
    expect(row).toEqual({ col_9007199254740992: 1, col_9007199254740992_2: 2 });
  });

  // N9b: RFC4180 (and d3-dsv, and PapaParse) treat a quoted field's
  // whitespace as literal — the one place the format lets an author SAY
  // the padding is data. `coerceCell`'s trim (F6/P2-3, above) must not
  // reach inside quotes. R1 (round 3): quoting must NOT also suppress type
  // coercion — a quoted numeric cell (a QUOTE_ALL export's routine shape)
  // still coerces to a number exactly like an unquoted one; only a value
  // that doesn't parse as a bool/number keeps its literal padding.
  // Mutation check: reverting `coerceCell` to trim/coerce unconditionally
  // (dropping the `quoted` parameter) makes this go red (`" x "` comes
  // back trimmed to `"x"`).
  it("keeps a quoted field's padding exactly as written but still type-coerces it", () => {
    const result = parseTabular('a,b,c\n" x ",2,"3"');
    expect(result.ok).toBe(true);
    if (!result.ok || result.kind !== "rows") throw new Error("expected rows");
    expect(result.rows).toEqual([{ a: " x ", b: 2, c: 3 }]);
  });

  // R1 (round 3, P1): a QUOTE_ALL export (every field quoted, including
  // numerics) must profile identically to the same data unquoted — the
  // parent commit did this; round 2's N9b fix broke it by returning every
  // quoted field verbatim regardless of type. Mutation check: reverting
  // `coerceCell` to `if (quoted) return raw;` makes this go red (`sales`
  // comes back as the string `"100"` instead of the number `100`).
  it("coerces a quoted numeric cell exactly like an unquoted one (QUOTE_ALL export)", () => {
    const result = parseTabular('"region","sales"\n"North","100"\n"South","80"');
    expect(result.ok).toBe(true);
    if (!result.ok || result.kind !== "rows") throw new Error("expected rows");
    expect(result.rows).toEqual([{ region: "North", sales: 100 }, { region: "South", sales: 80 }]);
  });

  // R1 (round 3, P1): the same holds when only ONE cell in an otherwise
  // plain numeric column happens to be quoted (a common CSV-writer quirk
  // when a value contains a comma elsewhere in the export) — it must not
  // flip that one cell, or the column's inferred type, to category.
  it("doesn't flip a numeric column to category when only one of its cells is quoted", () => {
    const result = parseTabular('region,sales\nNorth,100\n"South",80\nEast,120');
    expect(result.ok).toBe(true);
    if (!result.ok || result.kind !== "rows") throw new Error("expected rows");
    expect(result.rows).toEqual([
      { region: "North", sales: 100 },
      { region: "South", sales: 80 },
      { region: "East", sales: 120 },
    ]);
  });

  // P2-6: a bare JSON array of scalars is the ONE shape `renderGlyphChart`
  // has documented sugar for (AGENTS.md: "x = index, y = identity"); before
  // this it fell through to `dataPipeline.ts`'s `toRows`, which rejects a
  // non-record array and left the Data folder with zero rows and an empty
  // "bar" recommendation.
  it("resolves a bare JSON array of numbers to a single 'value' column (P2-6)", () => {
    const result = parseTabular("[1,2,3]");
    expect(result.ok).toBe(true);
    if (!result.ok || result.kind !== "rows") throw new Error("expected rows");
    expect(result.rows).toEqual([{ value: 1 }, { value: 2 }, { value: 3 }]);
  });
});
