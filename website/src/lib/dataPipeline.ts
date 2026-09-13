// Pure ordered data-transform pipeline for `/charts`' data layer (AGENTS.md's
// "Charts" — "Data layer"). Turns a raw parsed value (`tabularParse.ts`'s
// `ParsedTabular`) into the flat rows a mark's table/`dataProfile.ts` want,
// through a small set of JSON-serializable steps a caller can build from
// Dock dropdowns and that ride in the `?c=` URL envelope unchanged.
//
// `derive`'s expression column is the one place a user-typed string reaches
// evaluation. It is NEVER handed to `eval`/`new Function` — a hand-rolled
// tokenizer + recursive-descent parser only ever walks a fixed AST of
// arithmetic/comparison/logical nodes, literal values, column lookups, and
// calls into a closed whitelist of pure functions. There is no code path
// from parsed input back to the host's `Function`/`eval`, so an expression
// cannot reach anything outside the row it was given.

import type { TabularCell, TabularRow } from "./tabularParse";

export type PipelineStep =
  | { readonly kind: "select"; readonly path: string }
  | { readonly kind: "flatten" }
  | { readonly kind: "pivotLonger"; readonly idColumns: readonly string[]; readonly keyColumn?: string; readonly valueColumn?: string }
  | { readonly kind: "pivotWider"; readonly keyColumn: string; readonly valueColumn: string }
  | { readonly kind: "filter"; readonly column: string; readonly operator: FilterOperator; readonly value: string }
  | { readonly kind: "derive"; readonly column: string; readonly expression: string }
  | { readonly kind: "sort"; readonly column: string; readonly direction?: "asc" | "desc" }
  | { readonly kind: "limit"; readonly count: number }
  | { readonly kind: "parseDate"; readonly column: string; readonly format?: string };

export const FILTER_OPERATORS = ["==", "!=", "<", "<=", ">", ">="] as const;
export type FilterOperator = typeof FILTER_OPERATORS[number];
export const PIPELINE_STEP_KINDS = ["select", "flatten", "pivotLonger", "pivotWider", "filter", "derive", "sort", "limit", "parseDate"] as const;

export type PipelineResult =
  | { readonly ok: true; readonly rows: readonly TabularRow[] }
  | { readonly ok: false; readonly error: string; readonly stepIndex: number };

// ── select / flatten ───────────────────────────────────────────────────

/** `data.items[*].value` -> walk `.`-separated segments, `[*]` spreads an
 *  array (only meaningful as the final segment or immediately before more
 *  path — a `[*]` in the middle maps the rest of the path over each element). */
function selectPath(value: unknown, path: string): unknown {
  const segments = path.split(".").filter(Boolean);
  let current: unknown = value;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    const star = seg.endsWith("[*]");
    const key = star ? seg.slice(0, -3) : seg;
    if (key) {
      if (current === null || typeof current !== "object") return undefined;
      current = (current as Record<string, unknown>)[key];
    }
    if (star) {
      if (!Array.isArray(current)) return undefined;
      const rest = segments.slice(i + 1).join(".");
      return rest ? current.map((item) => selectPath(item, rest)) : current;
    }
  }
  return current;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toRows(value: unknown): TabularRow[] | null {
  if (Array.isArray(value)) {
    if (value.every(isPlainRecord)) return value.map((v) => v as TabularRow);
    return null;
  }
  if (isPlainRecord(value)) return [value as TabularRow];
  return null;
}

function flattenRecord(row: TabularRow): TabularRow {
  const out: TabularRow = {};
  const walk = (obj: Record<string, unknown>, prefix: string) => {
    for (const [key, v] of Object.entries(obj)) {
      const flatKey = prefix ? `${prefix}.${key}` : key;
      if (isPlainRecord(v)) walk(v, flatKey);
      else out[flatKey] = (v as TabularCell) ?? null;
    }
  };
  walk(row, "");
  return out;
}

// ── pivot ──────────────────────────────────────────────────────────────

function pivotLonger(rows: readonly TabularRow[], idColumns: readonly string[], keyColumn: string, valueColumn: string): TabularRow[] {
  const out: TabularRow[] = [];
  for (const row of rows) {
    const ids = Object.fromEntries(idColumns.map((c) => [c, row[c] ?? null]));
    for (const [key, value] of Object.entries(row)) {
      if (idColumns.includes(key)) continue;
      out.push({ ...ids, [keyColumn]: key, [valueColumn]: value });
    }
  }
  return out;
}

function pivotWider(rows: readonly TabularRow[], keyColumn: string, valueColumn: string): TabularRow[] {
  const groups = new Map<string, TabularRow>();
  const order: string[] = [];
  for (const row of rows) {
    const rest = Object.fromEntries(Object.entries(row).filter(([k]) => k !== keyColumn && k !== valueColumn));
    const groupKey = JSON.stringify(rest);
    let group = groups.get(groupKey);
    if (!group) { group = { ...rest }; groups.set(groupKey, group); order.push(groupKey); }
    const keyValue = String(row[keyColumn] ?? "");
    group[keyValue] = row[valueColumn] ?? null;
  }
  return order.map((k) => groups.get(k)!);
}

// ── filter ─────────────────────────────────────────────────────────────

function parseLiteralForCompare(raw: string): TabularCell {
  const trimmed = raw.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  const n = Number(trimmed);
  return trimmed !== "" && Number.isFinite(n) ? n : raw;
}

function compareCells(a: TabularCell, op: FilterOperator, b: TabularCell): boolean {
  if (typeof a === "number" && typeof b === "number") {
    switch (op) {
      case "==": return a === b; case "!=": return a !== b;
      case "<": return a < b; case "<=": return a <= b;
      case ">": return a > b; case ">=": return a >= b;
    }
  }
  const as = String(a ?? ""); const bs = String(b ?? "");
  switch (op) {
    case "==": return as === bs; case "!=": return as !== bs;
    case "<": return as < bs; case "<=": return as <= bs;
    case ">": return as > bs; case ">=": return as >= bs;
  }
}

// ── sort / limit / parseDate ───────────────────────────────────────────

function compareForSort(a: TabularCell, b: TabularCell): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  const as = String(a ?? ""); const bs = String(b ?? "");
  return as < bs ? -1 : as > bs ? 1 : 0;
}

/** Minimal format tokens: `YYYY`, `MM`, `DD` — enough for the common
 *  non-ISO shapes a pasted CSV carries (`MM/DD/YYYY`, `DD-MM-YYYY`). No
 *  format = try `Date.parse` directly (handles ISO and most JS-parseable text). */
function parseDateCell(raw: TabularCell, format?: string): string | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const text = String(raw);
  if (!format) {
    const t = Date.parse(text);
    return Number.isNaN(t) ? null : new Date(t).toISOString();
  }
  const pattern = format.replace(/YYYY/g, "(?<y>\\d{4})").replace(/MM/g, "(?<m>\\d{1,2})").replace(/DD/g, "(?<d>\\d{1,2})");
  const match = new RegExp(`^${pattern}$`).exec(text);
  if (!match?.groups) return null;
  const y = Number(match.groups.y ?? "1970"); const m = Number(match.groups.m ?? "1"); const d = Number(match.groups.d ?? "1");
  const date = new Date(Date.UTC(y, m - 1, d));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// ── safe expression evaluator (`derive`) ──────────────────────────────
//
// Tokenizer -> recursive-descent parser -> tree-walking evaluator. No
// `eval`, no `new Function`, no access to anything but the row object
// passed to `evaluateExpression`. `EXPRESSION_FUNCTIONS` is the closed
// whitelist; an identifier that isn't a known function and isn't a column
// on the row evaluates to `null` rather than throwing, so a typo degrades
// instead of aborting the whole derive step.

type Token =
  | { readonly kind: "num"; readonly value: number }
  | { readonly kind: "str"; readonly value: string }
  | { readonly kind: "ident"; readonly value: string }
  | { readonly kind: "op"; readonly value: string }
  | { readonly kind: "eof" };

const OPERATORS = ["==", "!=", "<=", ">=", "&&", "||", "<", ">", "+", "-", "*", "/", "(", ")", ",", "!"];

export class ExpressionError extends Error {}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = source.length;
  while (i < n) {
    const c = source[i]!;
    if (/\s/.test(c)) { i++; continue; }
    if (c === '"' || c === "'") {
      const quote = c; let j = i + 1; let value = "";
      while (j < n && source[j] !== quote) {
        if (source[j] === "\\" && j + 1 < n) { value += source[j + 1]; j += 2; continue; }
        value += source[j]; j++;
      }
      if (j >= n) throw new ExpressionError(`Unterminated string starting at ${i}.`);
      tokens.push({ kind: "str", value }); i = j + 1; continue;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(source[i + 1] ?? ""))) {
      let j = i; while (j < n && /[0-9.]/.test(source[j]!)) j++;
      tokens.push({ kind: "num", value: Number(source.slice(i, j)) }); i = j; continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i; while (j < n && /[A-Za-z0-9_]/.test(source[j]!)) j++;
      tokens.push({ kind: "ident", value: source.slice(i, j) }); i = j; continue;
    }
    const two = source.slice(i, i + 2);
    if (OPERATORS.includes(two)) { tokens.push({ kind: "op", value: two }); i += 2; continue; }
    const one = source[i]!;
    if (OPERATORS.includes(one)) { tokens.push({ kind: "op", value: one }); i += 1; continue; }
    throw new ExpressionError(`Unexpected character "${one}" at position ${i}.`);
  }
  tokens.push({ kind: "eof" });
  return tokens;
}

type Node =
  | { readonly kind: "num"; readonly value: number }
  | { readonly kind: "str"; readonly value: string }
  | { readonly kind: "col"; readonly name: string }
  | { readonly kind: "call"; readonly name: string; readonly args: readonly Node[] }
  | { readonly kind: "unary"; readonly op: "-" | "!"; readonly value: Node }
  | { readonly kind: "binary"; readonly op: string; readonly left: Node; readonly right: Node };

/** Precedence climbing: `||` < `&&` < equality < relational < additive < multiplicative < unary < primary. */
function parseExpression(tokens: Token[]): Node {
  let pos = 0;
  const peek = () => tokens[pos]!;
  const advance = () => tokens[pos++]!;
  const expectOp = (value: string) => {
    const t = advance();
    if (t.kind !== "op" || t.value !== value) throw new ExpressionError(`Expected "${value}".`);
  };

  function parseOr(): Node {
    let left = parseAnd();
    while (peek().kind === "op" && (peek() as { value: string }).value === "||") { advance(); left = { kind: "binary", op: "||", left, right: parseAnd() }; }
    return left;
  }
  function parseAnd(): Node {
    let left = parseEquality();
    while (peek().kind === "op" && (peek() as { value: string }).value === "&&") { advance(); left = { kind: "binary", op: "&&", left, right: parseEquality() }; }
    return left;
  }
  function parseEquality(): Node {
    let left = parseRelational();
    while (peek().kind === "op" && ["==", "!="].includes((peek() as { value: string }).value)) {
      const op = (advance() as { value: string }).value; left = { kind: "binary", op, left, right: parseRelational() };
    }
    return left;
  }
  function parseRelational(): Node {
    let left = parseAdditive();
    while (peek().kind === "op" && ["<", "<=", ">", ">="].includes((peek() as { value: string }).value)) {
      const op = (advance() as { value: string }).value; left = { kind: "binary", op, left, right: parseAdditive() };
    }
    return left;
  }
  function parseAdditive(): Node {
    let left = parseMultiplicative();
    while (peek().kind === "op" && ["+", "-"].includes((peek() as { value: string }).value)) {
      const op = (advance() as { value: string }).value; left = { kind: "binary", op, left, right: parseMultiplicative() };
    }
    return left;
  }
  function parseMultiplicative(): Node {
    let left = parseUnary();
    while (peek().kind === "op" && ["*", "/"].includes((peek() as { value: string }).value)) {
      const op = (advance() as { value: string }).value; left = { kind: "binary", op, left, right: parseUnary() };
    }
    return left;
  }
  function parseUnary(): Node {
    if (peek().kind === "op" && ((peek() as { value: string }).value === "-" || (peek() as { value: string }).value === "!")) {
      const op = (advance() as { value: string }).value as "-" | "!";
      return { kind: "unary", op, value: parseUnary() };
    }
    return parsePrimary();
  }
  function parsePrimary(): Node {
    const t = advance();
    if (t.kind === "num") return { kind: "num", value: t.value };
    if (t.kind === "str") return { kind: "str", value: t.value };
    if (t.kind === "op" && t.value === "(") { const inner = parseOr(); expectOp(")"); return inner; }
    if (t.kind === "ident") {
      if (peek().kind === "op" && (peek() as { value: string }).value === "(") {
        advance();
        const args: Node[] = [];
        if (!(peek().kind === "op" && (peek() as { value: string }).value === ")")) {
          args.push(parseOr());
          while (peek().kind === "op" && (peek() as { value: string }).value === ",") { advance(); args.push(parseOr()); }
        }
        expectOp(")");
        return { kind: "call", name: t.value, args };
      }
      return { kind: "col", name: t.value };
    }
    throw new ExpressionError("Unexpected token in expression.");
  }

  const node = parseOr();
  if (peek().kind !== "eof") throw new ExpressionError("Unexpected trailing input in expression.");
  return node;
}

type ExprValue = number | string | boolean | null;

function dateComponent(value: ExprValue, part: "year" | "month" | "day"): number {
  const text = value === null ? "" : String(value);
  const t = Date.parse(text);
  if (Number.isNaN(t)) return NaN;
  const d = new Date(t);
  return part === "year" ? d.getUTCFullYear() : part === "month" ? d.getUTCMonth() + 1 : d.getUTCDate();
}

/** Closed whitelist — the ONLY functions `derive` can call. Every entry is
 *  a pure function of its (already-evaluated) arguments; none can reach
 *  anything outside them. */
const EXPRESSION_FUNCTIONS: Record<string, (args: ExprValue[]) => ExprValue> = {
  abs: ([a]) => Math.abs(Number(a)),
  min: (args) => Math.min(...args.map(Number)),
  max: (args) => Math.max(...args.map(Number)),
  round: ([a]) => Math.round(Number(a)),
  log: ([a]) => Math.log(Number(a)),
  sqrt: ([a]) => Math.sqrt(Number(a)),
  year: ([a]) => dateComponent(a!, "year"),
  month: ([a]) => dateComponent(a!, "month"),
  day: ([a]) => dateComponent(a!, "day"),
};

function evaluateNode(node: Node, row: TabularRow): ExprValue {
  switch (node.kind) {
    case "num": return node.value;
    case "str": return node.value;
    case "col": return (row[node.name] ?? null) as ExprValue;
    case "unary": {
      const v = evaluateNode(node.value, row);
      return node.op === "-" ? -Number(v) : !truthy(v);
    }
    case "call": {
      const fn = EXPRESSION_FUNCTIONS[node.name];
      if (!fn) return null;
      return fn(node.args.map((a) => evaluateNode(a, row)));
    }
    case "binary": {
      const { op } = node;
      if (op === "&&") return truthy(evaluateNode(node.left, row)) ? evaluateNode(node.right, row) : evaluateNode(node.left, row);
      if (op === "||") { const l = evaluateNode(node.left, row); return truthy(l) ? l : evaluateNode(node.right, row); }
      const l = evaluateNode(node.left, row); const r = evaluateNode(node.right, row);
      switch (op) {
        case "+": return typeof l === "string" || typeof r === "string" ? String(l ?? "") + String(r ?? "") : Number(l) + Number(r);
        case "-": return Number(l) - Number(r);
        case "*": return Number(l) * Number(r);
        case "/": return Number(l) / Number(r);
        case "==": return l === r;
        case "!=": return l !== r;
        case "<": return (l as number) < (r as number);
        case "<=": return (l as number) <= (r as number);
        case ">": return (l as number) > (r as number);
        case ">=": return (l as number) >= (r as number);
        default: throw new ExpressionError(`Unknown operator "${op}".`);
      }
    }
  }
}

function truthy(v: ExprValue): boolean { return v !== null && v !== false && v !== 0 && v !== ""; }

/** Parses `expression` once and returns a function evaluating it against a
 *  row. Throws `ExpressionError` for a syntax error (never for a runtime
 *  value issue — those degrade to `NaN`/`null`, matching a spreadsheet). */
export function compileExpression(expression: string): (row: TabularRow) => ExprValue {
  const ast = parseExpression(tokenize(expression));
  return (row) => evaluateNode(ast, row);
}

// ── pipeline runner ────────────────────────────────────────────────────

function applyStep(rows: readonly TabularRow[], raw: unknown, step: PipelineStep): { rows: readonly TabularRow[]; raw: unknown } {
  switch (step.kind) {
    case "select": {
      const selected = selectPath(raw, step.path);
      const asRows = toRows(selected);
      return { raw: selected, rows: asRows ?? rows };
    }
    case "flatten":
      return { raw, rows: rows.map(flattenRecord) };
    case "pivotLonger":
      return { raw, rows: pivotLonger(rows, step.idColumns, step.keyColumn ?? "key", step.valueColumn ?? "value") };
    case "pivotWider":
      return { raw, rows: pivotWider(rows, step.keyColumn, step.valueColumn) };
    case "filter": {
      const literal = parseLiteralForCompare(step.value);
      return { raw, rows: rows.filter((row) => compareCells(row[step.column] ?? null, step.operator, literal)) };
    }
    case "derive": {
      const evaluate = compileExpression(step.expression);
      return { raw, rows: rows.map((row) => ({ ...row, [step.column]: evaluate(row) as TabularCell })) };
    }
    case "sort": {
      const direction = step.direction ?? "asc";
      const sorted = [...rows].sort((a, b) => compareForSort(a[step.column] ?? null, b[step.column] ?? null));
      return { raw, rows: direction === "desc" ? sorted.reverse() : sorted };
    }
    case "limit":
      return { raw, rows: rows.slice(0, Math.max(0, step.count)) };
    case "parseDate":
      return { raw, rows: rows.map((row) => ({ ...row, [step.column]: parseDateCell(row[step.column] ?? null, step.format) })) };
  }
}

/** Runs every step in order against `input` (a raw parsed value — an
 *  already-flat row array, or a nested JSON value a leading `select`/
 *  `flatten` step turns into one). A step's own error names its index so
 *  the Dock can point at the offending row rather than failing silently. */
export function runPipeline(input: unknown, steps: readonly PipelineStep[]): PipelineResult {
  let raw = input;
  let rows: readonly TabularRow[] = toRows(input) ?? [];
  for (let i = 0; i < steps.length; i++) {
    try {
      const next = applyStep(rows, raw, steps[i]!);
      rows = next.rows; raw = next.raw;
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error), stepIndex: i };
    }
  }
  return { ok: true, rows };
}
