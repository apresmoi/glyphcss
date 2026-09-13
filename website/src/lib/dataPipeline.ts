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

/** `Object.hasOwn`-guarded column read — a `filter`/`sort`/`parseDate` step
 *  names a column the same way `derive`'s "col" AST node does (F4/P2-1), so
 *  a column named after an inherited `Object.prototype` member (say
 *  `constructor`) reads `null` here too, never the live prototype value a
 *  plain `row[name]` lookup would resolve through the prototype chain. */
function rowColumn(row: TabularRow, name: string): TabularCell {
  return Object.hasOwn(row, name) ? row[name] ?? null : null;
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

// N5: both pivots used to read `row[name]` bare — a column NAMED after an
// inherited `Object.prototype` member (`constructor`, `toString`, …) then
// resolved through the prototype chain to that live function instead of
// the row's own (absent) column, handing it into a cell typed
// `TabularCell` exactly the shape `rowColumn` (above) already guards
// against for `filter`/`sort`/`parseDate`/`derive`'s "col" node — these two
// steps just hadn't been switched onto the same guard yet.
function pivotLonger(rows: readonly TabularRow[], idColumns: readonly string[], keyColumn: string, valueColumn: string): TabularRow[] {
  const out: TabularRow[] = [];
  for (const row of rows) {
    const ids = Object.fromEntries(idColumns.map((c) => [c, rowColumn(row, c)]));
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
    const keyValue = String(rowColumn(row, keyColumn) ?? "");
    group[keyValue] = rowColumn(row, valueColumn);
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
const DATE_FORMAT_TOKENS = [
  { token: "YYYY", pattern: "(?<y>\\d{4})" },
  { token: "MM", pattern: "(?<mo>\\d{1,2})" },
  { token: "DD", pattern: "(?<d>\\d{1,2})" },
] as const;
const REGEXP_METACHARS = /[.*+?^${}()|[\]\\]/;

export class PipelineFormatError extends Error {}

/** Compiles a `parseDate` format string into a `RegExp` — the ONE user-typed
 *  string in this whole file that used to reach `new RegExp` unescaped
 *  (AGENTS.md's "Charts" — "Data layer"'s safe-evaluator guarantee is about
 *  `derive`'s expression grammar; this is the OTHER free-text field). Only
 *  `YYYY`/`MM`/`DD` are recognized tokens; a run of `Y`/`M`/`D` that doesn't
 *  spell one of them exactly (a typo, or an attempt at a token this grammar
 *  doesn't have) is rejected as a structured `PipelineFormatError` naming
 *  the step, rather than silently degrading to a literal that can never
 *  match anything. Every other character — including a metacharacter used
 *  as a literal separator (`.`, `(`, …) — is escaped, so a hostile format
 *  can never inject regex syntax (a ReDoS pattern like `(a+)+b` compiles to
 *  the equivalent literal string, not a backtracking regex) and an
 *  accidental metacharacter in an otherwise-valid format still matches the
 *  literal character it looks like. Compiled ONCE per `parseDate` step,
 *  never per cell — the fix for both the injection and the ReDoS is the
 *  same compile-time escaping; not recompiling per row is what keeps a
 *  large column from paying to rebuild an (already-safe) `RegExp` per cell.
 *
 *  N6a/N6b close two remaining gaps in the same grammar. (a) A format with
 *  no `Y`/`M`/`D` run at all (`"abc"`) or one spelled in the wrong CASE
 *  (`"yyyy-mm-dd"`) used to pass this gate untouched — the bad-token scan
 *  only matched uppercase runs, so a lowercase or letter-free format
 *  compiled to a regex that can never match any real date, silently
 *  nulling the whole column (`ok: true`) instead of naming the typo. The
 *  scan is now case-INSENSITIVE for what counts as a token-shaped run (so
 *  a lowercase run hits the SAME "unrecognized token" branch, never
 *  silently surviving as literal text), and a format with no such run at
 *  all is rejected outright — it can never produce a date, so a silent
 *  null is strictly worse than an early, named error. (b) A format
 *  repeating the SAME token (`"YYYY-YYYY"`) used to pass this gate (each
 *  individual run is, on its own, a recognized token) and only fail inside
 *  `new RegExp` itself, with the raw "Duplicate capture group name" host
 *  message shown verbatim to the reader — a token is now rejected the
 *  SECOND time it's used, as the same structured `PipelineFormatError`
 *  every other bad format here produces.
 *
 *  R2 (round 3): a run of `[YyMmDd]+` can legitimately contain MULTIPLE
 *  adjacent tokens with no separator (`YYYYMMDD`, the ISO basic format —
 *  a routine export shape) — validating the run by requiring it to equal
 *  ONE whole token rejected every such format even though the tokenizing
 *  loop below has always walked adjacent tokens correctly. A run is now
 *  validated the same way it is compiled: tokenized greedily
 *  (`YYYY`/`MM`/`DD`) from its own start, so a run is accepted exactly
 *  when it fully decomposes into recognized tokens with nothing left
 *  over — a genuinely bad run still names the first unrecognized
 *  substring within it. */
export function compileDateFormat(format: string): RegExp {
  const badTokenRun = /[YyMmDd]+/g;
  let run: RegExpExecArray | null;
  let matchedToken = false;
  while ((run = badTokenRun.exec(format))) {
    const text = run[0];
    let j = 0;
    while (j < text.length) {
      const found = DATE_FORMAT_TOKENS.find((t) => text.startsWith(t.token, j));
      if (!found) {
        throw new PipelineFormatError(`Unrecognized date format token "${text.slice(j)}" — use YYYY, MM, or DD.`);
      }
      j += found.token.length;
      matchedToken = true;
    }
  }
  if (!matchedToken) {
    throw new PipelineFormatError(`Date format "${format}" has no YYYY, MM, or DD token.`);
  }
  let pattern = "";
  let i = 0;
  const usedTokens = new Set<string>();
  while (i < format.length) {
    const found = DATE_FORMAT_TOKENS.find((t) => format.startsWith(t.token, i));
    if (found) {
      if (usedTokens.has(found.token)) {
        throw new PipelineFormatError(`Date format token "${found.token}" is repeated — use each of YYYY, MM, DD at most once.`);
      }
      usedTokens.add(found.token);
      pattern += found.pattern; i += found.token.length; continue;
    }
    const ch = format[i]!;
    pattern += REGEXP_METACHARS.test(ch) ? `\\${ch}` : ch;
    i += 1;
  }
  return new RegExp(`^${pattern}$`);
}

function parseDateCellFreeform(raw: TabularCell): string | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const t = Date.parse(String(raw));
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

function parseDateCellWithFormat(raw: TabularCell, regex: RegExp): string | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const match = regex.exec(String(raw));
  if (!match?.groups) return null;
  const y = Number(match.groups.y ?? "1970"); const m = Number(match.groups.mo ?? "1"); const d = Number(match.groups.d ?? "1");
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
 *  anything outside them. `Object.create(null)` (never a plain object
 *  literal) so `EXPRESSION_FUNCTIONS[node.name]` cannot resolve to an
 *  INHERITED `Object.prototype` member (`constructor`, `toString`,
 *  `hasOwnProperty`, `__proto__`, …) for a call the reader never wrote into
 *  this table — a plain-object whitelist is reachable on TEN such names
 *  even though none of them appear here. */
const EXPRESSION_FUNCTIONS: Record<string, (args: ExprValue[]) => ExprValue> = Object.assign(Object.create(null), {
  abs: ([a]: ExprValue[]) => Math.abs(Number(a)),
  min: (args: ExprValue[]) => Math.min(...args.map(Number)),
  max: (args: ExprValue[]) => Math.max(...args.map(Number)),
  round: ([a]: ExprValue[]) => Math.round(Number(a)),
  log: ([a]: ExprValue[]) => Math.log(Number(a)),
  sqrt: ([a]: ExprValue[]) => Math.sqrt(Number(a)),
  year: ([a]: ExprValue[]) => dateComponent(a!, "year"),
  month: ([a]: ExprValue[]) => dateComponent(a!, "month"),
  day: ([a]: ExprValue[]) => dateComponent(a!, "day"),
});

function evaluateNode(node: Node, row: TabularRow): ExprValue {
  switch (node.kind) {
    case "num": return node.value;
    case "str": return node.value;
    // `Object.hasOwn`, not a plain `row[node.name]` read — a `TabularRow` is
    // a plain object, so an unqualified `row[name]` lookup for a name like
    // `constructor`/`toString`/`__proto__` resolves through the PROTOTYPE
    // chain to the real `Object.prototype` member instead of the row's own
    // (absent) column, handing a live function value into a cell typed
    // `TabularCell`. `hasOwn` makes every such name read `null`, same as
    // any other column the row doesn't have.
    case "col": return (Object.hasOwn(row, node.name) ? row[node.name] : null) as ExprValue;
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
      return { raw, rows: rows.filter((row) => compareCells(rowColumn(row, step.column), step.operator, literal)) };
    }
    case "derive": {
      const evaluate = compileExpression(step.expression);
      return { raw, rows: rows.map((row) => ({ ...row, [step.column]: evaluate(row) as TabularCell })) };
    }
    case "sort": {
      const direction = step.direction ?? "asc";
      const sorted = [...rows].sort((a, b) => compareForSort(rowColumn(a, step.column), rowColumn(b, step.column)));
      return { raw, rows: direction === "desc" ? sorted.reverse() : sorted };
    }
    case "limit":
      return { raw, rows: rows.slice(0, Math.max(0, step.count)) };
    case "parseDate": {
      if (!step.format) return { raw, rows: rows.map((row) => ({ ...row, [step.column]: parseDateCellFreeform(rowColumn(row, step.column)) })) };
      const regex = compileDateFormat(step.format);
      return { raw, rows: rows.map((row) => ({ ...row, [step.column]: parseDateCellWithFormat(rowColumn(row, step.column), regex) })) };
    }
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
