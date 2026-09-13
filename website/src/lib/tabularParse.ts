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
 *  (including "", a date-looking string, and free text) stays a string —
 *  `dataProfile.ts` is where date detection actually happens, so a cell
 *  parser doesn't need to guess dates itself. */
function coerceCell(raw: string): TabularCell {
  const trimmed = raw.trim();
  if (trimmed === "") return "";
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(trimmed) && trimmed !== "-" && trimmed !== "+") {
    const n = Number(trimmed);
    if (Number.isFinite(n)) return n;
  }
  return raw;
}

/** RFC4180-ish delimited-text tokenizer: quoted fields, escaped `""`,
 *  embedded delimiters/newlines inside quotes. Works for both CSV and TSV —
 *  the delimiter is the only difference. */
function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === delimiter) { row.push(field); field = ""; i++; continue; }
    if (c === "\r") { i++; continue; }
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
    field += c; i++;
  }
  row.push(field);
  if (row.length > 1 || row[0] !== "") rows.push(row);
  return rows;
}

function delimitedToRows(text: string, delimiter: string): ParsedTabular {
  const table = parseDelimited(text, delimiter);
  const nonEmpty = table.filter((r) => r.length > 1 || r[0] !== "");
  if (nonEmpty.length === 0) return { ok: false, error: "No rows found." };
  const header = nonEmpty[0]!.map((h) => h.trim() || "column");
  const rows: TabularRow[] = nonEmpty.slice(1).map((cells) => {
    const record: TabularRow = {};
    header.forEach((name, i) => { record[name] = coerceCell(cells[i] ?? ""); });
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
