// Pure text -> tabular-ish value parser for `/charts`' "Custom…" dataset
// upload/paste (AGENTS.md's "Charts" — "Data layer"). No DOM, no fetch.
//
// A caller hands this raw text plus an optional filename/mimeType hint; it
// returns either flat ROWS (CSV/TSV, a JSON array of records, or a JSON
// array of arrays with a header row) ready for `dataProfile.ts`, or a raw
// JSON `value` for something that ISN'T already flat (a nested object, or
// an array that mixes shapes) — `dataPipeline.ts`'s `select`/`flatten`
// steps turn that into rows. Never throws: every failure is a structured
// `{ ok: false, error }`.

export type TabularCell = string | number | boolean | null;
export type TabularRow = Record<string, TabularCell>;

export type ParsedTabular =
  | { readonly ok: true; readonly kind: "rows"; readonly rows: readonly TabularRow[] }
  | { readonly ok: true; readonly kind: "json"; readonly value: unknown }
  | { readonly ok: false; readonly error: string };

export interface ParseTabularHint {
  readonly filename?: string;
  readonly mimeType?: string;
}

/** "3", "3.5", "-2e3" -> number; "true"/"false" -> boolean; everything else
 *  (including a date-looking string and free text) stays a TRIMMED string —
 *  `dataProfile.ts` is where date detection actually happens, so a cell
 *  parser doesn't need to guess dates itself. Trimming is consistent with
 *  every OTHER cell shape here: the header is trimmed
 *  (`delimitedToRows`'s `h.trim()`) and a numeric cell effectively is too
 *  (`Number(" 42")` is `42`) — returning the untrimmed `raw` only for the
 *  plain-string case (P2-3) split the ubiquitous `"a, b"` CSV shape into
 *  two categories (`" Paris"` and `"Paris"`) purely from that inconsistency.
 *
 *  N9b: a QUOTED field is the one exception — RFC4180 (and d3-dsv, and
 *  PapaParse) treat a quoted field's content as literal, which is the one
 *  place the format lets an author SAY the padding is data (`" x "` inside
 *  quotes means the two spaces are part of the value); trimming or
 *  type-coercing it the same way an unquoted field is would silently
 *  overrule that. A quoted field is returned exactly as written. */
function coerceCell(raw: string, quoted: boolean): TabularCell {
  if (quoted) return raw;
  const trimmed = raw.trim();
  if (trimmed === "") return "";
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(trimmed) && trimmed !== "-" && trimmed !== "+") {
    const n = Number(trimmed);
    if (Number.isFinite(n)) return n;
  }
  return trimmed;
}

/** A duplicate header used to silently drop the earlier column
 *  (`"a,a\n1,2"` -> `{a:2}`, only the LAST value survives object-key
 *  collision) — a later repeat now gets a numbered suffix instead, so both
 *  columns' data survives (P3). N9a: the naive `count===0 ? name :
 *  name_(count+1)` scheme could still generate a suffix that COLLIDES with
 *  a column that is ITSELF literally named that way — `"a,a,a_2"` used to
 *  generate `a_2` for the second `a` and then silently re-collide with the
 *  third column's own real name `a_2`, dropping ITS value too (the exact
 *  object-key collision this function exists to prevent, one level later).
 *  Walking left to right and tracking every name already committed (rather
 *  than only how many times each ORIGINAL name repeats) means a column
 *  whose own literal name is already taken — by an earlier duplicate OR by
 *  an earlier duplicate's own generated suffix — keeps climbing the same
 *  `_<n>` ladder for its base name until it lands on a free one:
 *  `"a,a,a_2"` -> `"a,a_2,a_3"`, never a second collision. */
function dedupeHeaders(headers: readonly string[]): string[] {
  const used = new Set<string>();
  const nextFree = (base: string, from: number): string => {
    let n = from;
    while (used.has(`${base}_${n}`)) n++;
    return `${base}_${n}`;
  };
  return headers.map((name) => {
    const match = /^(.*)_(\d+)$/.exec(name);
    const requested = match ? Number(match[2]) : NaN;
    // Only treat a "_<n>" suffix as part of this scheme's own numbering
    // when n >= 2 — the smallest suffix this function ever generates — so
    // an ordinary column literally named e.g. "q_1" is never reinterpreted
    // as base "q"'s first duplicate.
    if (match && requested >= 2) {
      const base = match[1]!;
      const candidate = `${base}_${requested}`;
      const final = used.has(candidate) ? nextFree(base, requested + 1) : candidate;
      used.add(final);
      return final;
    }
    if (!used.has(name)) { used.add(name); return name; }
    const final = nextFree(name, 2);
    used.add(final);
    return final;
  });
}

interface DelimitedCell {
  readonly value: string;
  /** N9b: whether this field was wrapped in quotes in the source text —
   *  `coerceCell` treats a quoted field's content as literal (RFC4180),
   *  never trimmed or type-coerced. */
  readonly quoted: boolean;
}

/** RFC4180-ish delimited-text tokenizer: quoted fields, escaped `""`,
 *  embedded delimiters/newlines inside quotes. Works for both CSV and TSV —
 *  the delimiter is the only difference. */
function parseDelimited(text: string, delimiter: string): DelimitedCell[][] {
  const rows: DelimitedCell[][] = [];
  let row: DelimitedCell[] = [];
  let field = "";
  let fieldQuoted = false;
  let inQuotes = false;
  let i = 0;
  const n = text.length;
  const pushField = () => { row.push({ value: field, quoted: fieldQuoted }); field = ""; fieldQuoted = false; };
  while (i < n) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; fieldQuoted = true; i++; continue; }
    if (c === delimiter) { pushField(); i++; continue; }
    if (c === "\r") { i++; continue; }
    if (c === "\n") { pushField(); rows.push(row); row = []; i++; continue; }
    field += c; i++;
  }
  pushField();
  if (row.length > 1 || row[0]!.value !== "") rows.push(row);
  return rows;
}

function delimitedToRows(text: string, delimiter: string): ParsedTabular {
  const table = parseDelimited(text, delimiter);
  const nonEmpty = table.filter((r) => r.length > 1 || r[0]!.value !== "");
  if (nonEmpty.length === 0) return { ok: false, error: "No rows found." };
  const header = dedupeHeaders(nonEmpty[0]!.map((h) => h.value.trim() || "column"));
  const rows: TabularRow[] = nonEmpty.slice(1).map((cells) => {
    const record: TabularRow = {};
    header.forEach((name, i) => { record[name] = coerceCell(cells[i]?.value ?? "", cells[i]?.quoted ?? false); });
    return record;
  });
  return { ok: true, kind: "rows", rows };
}

function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r\n|\n/, 1)[0] ?? "";
  const tabs = (firstLine.match(/\t/g) ?? []).length;
  const commas = (firstLine.match(/,/g) ?? []).length;
  return tabs > commas ? "\t" : ",";
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonToParsedTabular(value: unknown): ParsedTabular {
  if (Array.isArray(value)) {
    if (value.length === 0) return { ok: true, kind: "rows", rows: [] };
    if (value.every(isPlainRecord)) {
      return { ok: true, kind: "rows", rows: value.map((row) => row as TabularRow) };
    }
    if (value.every((row) => Array.isArray(row))) {
      const [header, ...body] = value as unknown[][];
      const columns = (header ?? []).map((h) => String(h));
      const rows: TabularRow[] = body.map((cells) => {
        const record: TabularRow = {};
        columns.forEach((name, i) => {
          const cell = cells[i];
          record[name] = typeof cell === "number" || typeof cell === "boolean" || typeof cell === "string" || cell === null ? cell : String(cell ?? "");
        });
        return record;
      });
      return { ok: true, kind: "rows", rows };
    }
    // A bare array of scalars (numbers, strings, booleans, null) — the ONE
    // shape `renderGlyphChart` has documented sugar for (AGENTS.md: "a bare
    // `number[]` ... copying Observable Plot's own shorthand"), and the
    // shape the mark table already renders as a single "value" column
    // (`chartMarkTable`). Without this a bare `[1,2,3]` fell through to the
    // mixed-shape branch below, `dataPipeline.ts`'s `toRows` rejected it
    // (not every element is a plain record), and the Data folder recommended
    // an empty "bar" with no data at all (P2-6).
    if (value.every((v) => v === null || typeof v !== "object")) {
      return { ok: true, kind: "rows", rows: value.map((v) => ({ value: v as TabularCell })) };
    }
    // Mixed-shape array — hand it back raw for `select`/`flatten` to sort out.
    return { ok: true, kind: "json", value };
  }
  if (isPlainRecord(value)) return { ok: true, kind: "json", value };
  return { ok: false, error: "JSON must be an array or object." };
}

/** Entry point. `hint.mimeType`/`filename` steer format detection for an
 *  ambiguous file (a `.json` extension always wins; otherwise this sniffs
 *  the text itself), but every branch degrades gracefully with no hint at all. */
export function parseTabular(text: string, hint?: ParseTabularHint): ParsedTabular {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: false, error: "Empty input." };

  const looksJson = trimmed.startsWith("[") || trimmed.startsWith("{");
  const wantsJson = hint?.filename?.toLowerCase().endsWith(".json") || hint?.mimeType === "application/json";
  const wantsTsv = hint?.filename?.toLowerCase().endsWith(".tsv") || hint?.mimeType === "text/tab-separated-values";
  const wantsCsv = hint?.filename?.toLowerCase().endsWith(".csv") || hint?.mimeType === "text/csv";

  if (wantsJson || (looksJson && !wantsTsv && !wantsCsv)) {
    let value: unknown;
    try { value = JSON.parse(trimmed); }
    catch (error) { return { ok: false, error: `Invalid JSON: ${(error as Error).message}` }; }
    return jsonToParsedTabular(value);
  }

  const delimiter = wantsTsv ? "\t" : wantsCsv ? "," : detectDelimiter(trimmed);
  return delimitedToRows(trimmed, delimiter);
}
