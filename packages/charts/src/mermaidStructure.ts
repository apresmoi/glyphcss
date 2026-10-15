import { chartText } from "./labels";
import { ledgerMermaidDegraded, type GlyphChartLedgerEntry } from "./ledger";
import type { GlyphChartLayout } from "./layout";
import type { GlyphChartMermaidSpec } from "./mermaid";
import { glyphChartText } from "./spec";
import type { GlyphChartCharset, GlyphChartSpec } from "./types";

type TimelineRow = { kind: "section"; text: string } | { kind: "period"; text: string; events: string[] };
type PacketField = { start: number; end: number; text: string };
type Structure = { kind: "timeline"; rows: TimelineRow[] } | { kind: "packet"; fields: PacketField[] };
interface Reader { label(raw: string): string; syntax(message: string): never }
type Common = Pick<GlyphChartMermaidSpec, "title" | "description" | "ledger">;
// Like journey, the annotation survives shallow copies and validation; JSON is not its transport.
export const GLYPH_CHART_MERMAID_STRUCTURE = Symbol("glyph-chart-mermaid-structure");
type StructuredSpec = GlyphChartSpec & { [GLYPH_CHART_MERMAID_STRUCTURE]?: Structure };
type Point = { x: number; y: number };
export interface GlyphChartMermaidStructureLayout {
  readonly labels: readonly (Point & { text: string })[];
  readonly lines: readonly { from: Point; to: Point }[];
}
const statement = (part: string): string => part.startsWith('"') ? JSON.parse(part) as string : part;
const textLabel = (raw: string, r: Reader) => r.label(raw.replace(/<br\s*\/?\s*>/gi, "\uE000")).replace(/\uE000/g, "\n");
function spec(common: Common, structure: Structure): GlyphChartMermaidSpec {
  const labels = structure.kind === "timeline" ? structure.rows.flatMap((row) => row.kind === "section" ? [row.text] : [row.text, ...row.events]) : structure.fields.map((field) => field.text);
  return { ...common, [GLYPH_CHART_MERMAID_STRUCTURE]: structure, legend: false,
    marks: [glyphChartText((labels.length ? labels : [""]).map((label, y) => ({ x: 0, y, label })), { x: "x", y: "y", label: "label" })],
  } as GlyphChartMermaidSpec;
}

export function timeline(parts: string[], common: Common, r: Reader): GlyphChartMermaidSpec {
  const rows: TimelineRow[] = [];
  let current: Extract<TimelineRow, { kind: "period" }> | undefined;
  for (const part of parts) {
    const raw = statement(part), section = /^section(?:\s+(.*))?$/i.exec(raw);
    if (section) { rows.push({ kind: "section", text: textLabel(section[1] ?? "", r) }); current = undefined; continue; }
    // Mermaid's event token starts at a colon followed by whitespace; times and URLs stay text.
    const fields = raw.split(/:\s+/).map((s) => textLabel(s, r));
    const period = fields.shift()!;
    if (period) { current = { kind: "period", text: period, events: fields }; rows.push(current); }
    else if (current) current.events.push(...fields);
    else r.syntax("Timeline continuation needs a preceding period in its section.");
  }
  (common.ledger as GlyphChartLedgerEntry[]).push(ledgerMermaidDegraded({ feature: "timeline direction and event boxes", replacement: "compact vertical periods with events beside them, section headers and native text/rules" }));
  return spec(common, { kind: "timeline", rows });
}

export function packet(parts: string[], common: Common, r: Reader): GlyphChartMermaidSpec {
  const fields: PacketField[] = [], ledger = common.ledger as GlyphChartLedgerEntry[];
  let next = 0;
  for (const part of parts) {
    const raw = statement(part), match = /^(?:\+(\d+)|(\d+)(?:\s*-\s*(\d+))?)\s*:\s*(.*)$/.exec(raw);
    if (!match) r.syntax(`Expected a packet bit range, single bit or +count in "${raw}".`);
    const start = match[1] === undefined ? Number(match[2]) : next;
    const end = match[1] === undefined ? Number(match[3] ?? match[2]) : start + Number(match[1]) - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start) {
      ledger.push(ledgerMermaidDegraded({ feature: "unrepresentable packet range", replacement: "the field omitted; following relative fields retain the previous end", range: raw })); continue;
    }
    fields.push({ start, end, text: textLabel(match[4]!, r) }); next = end + 1;
  }
  return spec(common, { kind: "packet", fields });
}

/** Text/rule layout shares the canvas's approved sharp rectangle family, including junction merging. */
export function layoutGlyphMermaidStructure(input: StructuredSpec, cols: number, height: number | undefined, scale: number, charset: GlyphChartCharset, ledger: GlyphChartLedgerEntry[]): GlyphChartLayout | undefined {
  const source = input[GLYPH_CHART_MERMAID_STRUCTURE];
  if (!source) return undefined;
  const width = Math.floor(cols / scale), maxRows = height === undefined ? Infinity : Math.floor(height / scale);
  const labels: (Point & { text: string })[] = [], lines: { from: Point; to: Point }[] = [];
  const note = (feature: string, replacement: string, detail?: Record<string, unknown>) => ledger.push(ledgerMermaidDegraded({ feature, replacement, ...detail }));
  const wrap = (text: string, budget: number, role: string): string[] => {
    const result: string[] = [];
    for (const paragraph of text.split("\n")) {
      let row = "";
      for (const word of chartText(paragraph, charset).split(/\s+/).filter(Boolean)) {
        if (word.length > budget) { note(`${source.kind} ${role} word wider than the viewport`, "the whole word omitted, never split", { word, columns: Math.max(0, budget) }); continue; }
        if (row && row.length + 1 + word.length > budget) { result.push(row); row = ""; }
        row += `${row ? " " : ""}${word}`;
      }
      if (row) result.push(row);
    }
    return result;
  };
  const add = (x: number, y: number, text: string) => { if (text) labels.push({ x: x * scale, y: y * scale, text }); };
  const line = (x0: number, y0: number, x1: number, y1: number) => lines.push({ from: { x: x0 * scale, y: y0 * scale }, to: { x: x1 * scale, y: y1 * scale } });
  let y = 0;
  const group = (count: number, role: string, paint: () => void): boolean => {
    const fits = y + count <= maxRows;
    if (fits) paint(); else note(`${source.kind} ${role} outside the viewport`, "the complete group omitted", { rows: count, columns: width });
    y += count;
    return fits;
  };
  const rawTitle = typeof input.title === "string" ? input.title : input.title?.text;
  const title = rawTitle ? wrap(rawTitle, width, "title") : [];
  if (title.length) group(title.length, "title", () => title.forEach((text, i) => add(Math.floor((width - text.length) / 2), y + i, text)));
  if (source.kind === "timeline") {
    const indent = Math.min(2, Math.max(0, width - 1)), contentWidth = width - indent;
    const periods = source.rows.filter((row) => row.kind === "period");
    const periodWidth = Math.min(Math.max(1, ...periods.map((row) => chartText(row.text, charset).length)), Math.max(1, Math.floor(contentWidth / 3)));
    const eventX = indent + periodWidth + 5, eventWidth = width - eventX;
    let content = false;
    for (const row of source.rows) {
      if (row.kind === "section") {
        if (content) y++;
        const text = wrap(row.text, width, "section");
        group(Math.max(1, text.length), "section", () => text.forEach((s, i) => add(0, y + i, s)));
        content = true;
        continue;
      }
      // Stack when a whole word fits the indented content width but not the side-by-side columns.
      const stacked = row.text.split(/\s+/).some((word) => word.length > periodWidth) || row.events.some((event) => event.split(/\s+/).some((word) => word.length > eventWidth)) || eventWidth < 1;
      if (stacked) {
        note("timeline narrow columns", "the period above its events, wrapped across the indented content width", { period: row.text });
        const text = [wrap(row.text, contentWidth, "period"), ...row.events.map((event) => wrap(event, contentWidth, "event"))].flat();
        group(Math.max(1, text.length), "period", () => text.forEach((s, i) => add(indent, y + i, s)));
      } else {
        const period = wrap(row.text, periodWidth, "period");
        const events = row.events.flatMap((event) => {
          const wrapped = wrap(event, eventWidth, "event");
          return wrapped.map((s, i) => ({ text: s, first: i === 0 }));
        });
        const count = Math.max(1, period.length, events.length);
        group(count, "period", () => {
          period.forEach((s, i) => add(indent, y + i, s));
          if (count === 1) add(indent + periodWidth + 1, y, charset === "ascii" ? "|" : "│");
          else line(indent + periodWidth + 1, y, indent + periodWidth + 1, y + count - 1);
          events.forEach((s, i) => { if (s.first) add(eventX - 2, y + i, "-"); add(eventX, y + i, s.text); });
        });
      }
      content = true;
    }
    if (!source.rows.length) group(1, "empty caption", () => wrap("No periods", width, "caption").forEach((s, i) => add(0, y + i, s)));
  } else {
    const bits = Math.min(32, Math.max(1, Math.floor((width - 1) / 2)));
    const pitch = Math.floor((width - 1) / bits), gridWidth = bits * pitch, x = Math.floor((width - gridWidth - 1) / 2);
    if (bits < 32) note("packet narrow viewport", "fewer bits per displayed row; absolute bit positions retained", { bitsPerRow: bits });
    const keys = new Map<number, number>(), visible = new Set<number>();
    const rows = new Map<number, { field: PacketField; index: number; start: number; end: number }[]>();
    source.fields.forEach((field, index) => {
      const first = Math.floor(field.start / bits), last = Math.floor(field.end / bits);
      const count = Math.min(256, last - first + 1);
      if (last - first + 1 > count) note("packet field spanning too many rows", "the first 256 rows of the field", { start: field.start, end: field.end });
      for (let offset = 0; offset < count; offset++) {
        const row = first + offset, start = Math.max(field.start, row * bits), end = Math.min(field.end, row * bits + bits - 1);
        const segments = rows.get(row) ?? [];
        if (segments.some((s) => start <= s.end && end >= s.start)) { note("overlapping packet fields", "the first declared field retained in the overlapping row", { start, end }); continue; }
        segments.push({ field, index, start, end }); rows.set(row, segments);
      }
    });
    if (pitch < 2) {
      note("packet grid narrower than one bit cell", "a wrapped field list with absolute ranges");
      for (const field of source.fields) { const text = wrap(`${field.start}-${field.end}: ${field.text}`, width, "field"); group(text.length, "field", () => text.forEach((s, i) => add(0, y + i, s))); }
    } else for (const [row, segments] of [...rows].sort((a, b) => a[0] - b[0])) {
      const digits = String(row * bits + bits - 1).length;
      const cells = segments.map((segment) => {
        const left = x + (segment.start - row * bits) * pitch, right = x + (segment.end - row * bits + 1) * pitch;
        const budget = right - left - 1;
        const keyed = segment.field.text.split(/\s+/).some((word) => chartText(word, charset).length > budget);
        if (keyed && !keys.has(segment.index)) {
          const key = keys.size + 1; keys.set(segment.index, key);
          note("packet label wider than its cell", "a numbered key below the grid; multi-digit keys stack vertically in one-cell fields", { key, label: segment.field.text, start: segment.field.start, end: segment.field.end });
        }
        const key = keyed ? keys.get(segment.index) : undefined;
        const text = key === undefined ? wrap(segment.field.text, budget, "field") : String(key).length > budget ? [...String(key)] : [String(key)];
        return { ...segment, left, right, text, key };
      });
      const content = Math.max(1, ...cells.map((cell) => cell.text.length)), count = digits + content + 2;
      group(count, "bit row", () => {
        // Vertical decimal ticks preserve every absolute bit number without collisions at two columns per bit.
        for (let bit = 0; bit < bits; bit++) {
          const tick = String(row * bits + bit).padStart(digits, " ");
          [...tick].forEach((digit, i) => add(x + bit * pitch + 1, y + i, digit));
        }
        const top = y + digits, bottom = top + content + 1;
        line(x, top, x + gridWidth, top); line(x, bottom, x + gridWidth, bottom);
        line(x, top, x, bottom); line(x + gridWidth, top, x + gridWidth, bottom);
        for (const cell of cells) {
          line(cell.left, top, cell.left, bottom); line(cell.right, top, cell.right, bottom);
          cell.text.forEach((s, i) => add(cell.left + 1 + Math.floor((cell.right - cell.left - 1 - s.length) / 2), top + 1 + i, s));
          if (cell.key !== undefined) visible.add(cell.index);
        }
      });
    }
    for (const [index, key] of keys) {
      if (!visible.has(index)) continue;
      const field = source.fields[index]!, text = wrap(`${key}. [${field.start}${field.end === field.start ? "" : `-${field.end}`}] ${field.text}`, width, "key");
      group(text.length, "key", () => text.forEach((s, i) => add(0, y + i, s)));
    }
    if (!source.fields.length) { const text = wrap("No fields", width, "caption"); group(Math.max(1, text.length), "empty caption", () => text.forEach((s, i) => add(0, y + i, s))); }
  }
  const rows = height ?? Math.max(scale, y * scale);
  return {
    cols, rows, plot: { x0: 0, x1: cols - 1, y0: 0, y1: rows - 1 }, mermaidStructure: { labels, lines }, horizontalBarBands: new Map(),
    xTicks: [], yTicks: [], titleText: rawTitle ?? null, titleRow: title.length ? 0 : null, titleAlign: "center",
    xAxisLineRow: -1, xAxisLabelRow: -1, yAxisCol: -1, xTickMarks: false, yTickMarks: false,
    xAxisLine: false, yAxisLine: false, cellKeyRow: -1, xGrid: false, yGrid: false,
    xAxisColor: "#7a7f8a", yAxisColor: "#7a7f8a", xAxisTitle: null, yAxisTitle: null,
    xAxisTitleRow: -1, xAxisTitleAt: "center", yAxisTitleRow: -1, legend: null, hasCartesianAxes: false,
  };
}
