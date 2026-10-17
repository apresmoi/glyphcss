import { glyphChartRowSpacing, glyphChartTitleGap } from "./rowSpacing";
import { chartText } from "./labels";
import { ledgerMermaidDegraded, type GlyphChartLedgerEntry } from "./ledger";
import type { GlyphChartLayout } from "./layout";
import type { GlyphChartMermaidSpec } from "./mermaid";
import { glyphChartText } from "./spec";
import type { GlyphChartCharset, GlyphChartSpec } from "./types";

type TimelineRow = { kind: "section"; text: string } | { kind: "period"; text: string; events: string[] };
type PacketField = { start: number; end: number; text: string };
type KanbanItem = { id: string; text: string; metadata: Record<string, string> };
type KanbanColumn = { id: string; text: string; items: KanbanItem[] };
type Structure = { kind: "kanban"; columns: KanbanColumn[] } | { kind: "timeline"; rows: TimelineRow[] } | { kind: "packet"; fields: PacketField[] };
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
const textLabel = (raw: string, r: Reader) => r.label(raw.replace(/<\/?br\s*\/?\s*>/gi, "\uE000")).replace(/\uE000/g, "\n");
function spec(common: Common, structure: Structure): GlyphChartMermaidSpec {
  const labels = structure.kind === "kanban" ? structure.columns.flatMap((column) => [column.text, ...column.items.map((item) => item.text)]) : structure.kind === "timeline" ? structure.rows.flatMap((row) => row.kind === "section" ? [row.text] : [row.text, ...row.events]) : structure.fields.map((field) => field.text);
  return { ...common, [GLYPH_CHART_MERMAID_STRUCTURE]: structure, legend: false,
    marks: [glyphChartText((labels.length ? labels : [""]).map((label, y) => ({ x: 0, y, label })), { x: "x", y: "y", label: "label" })],
  } as GlyphChartMermaidSpec;
}

/** Protect indentation and node/metadata literals before the shared statement scanner. */
export function protectGlyphKanbanStatement(source: string): { text: string; length: number } | undefined {
  if (/^[ \t]*kanban\b/i.test(source) || /^(?:title[ \t]|acc(?:Title|Descr)\s*:|accDescr\s*\{)/i.test(source)) return undefined;
  let bracket = false, metadata = 0, quote = "";
  for (let i = 0; i < source.length; i++) {
    const char = source[i]!;
    if (quote) {
      if (char === "\\" && quote === '"') i++;
      else if (char === quote) { if (source[i + 1] === quote) i++; else quote = ""; }
    } else if ((bracket && char === '"') || (metadata && (char === '"' || char === "'") && /[:,{\[]\s*$/.test(source.slice(0, i)))) quote = char;
    else if (!metadata && char === "[") bracket = true;
    else if (bracket && char === "]") bracket = false;
    else if (!bracket && char === "{" && (metadata || source[i - 1] === "@")) metadata++;
    else if (metadata && char === "}") metadata--;
    else if (!bracket && !metadata && (char === "\n" || source.startsWith("%%", i))) {
      return { text: source.slice(0, i), length: i };
    }
  }
  return { text: source, length: source.length };
}

export function kanban(parts: string[], common: Common, r: Reader): GlyphChartMermaidSpec {
  const columns: KanbanColumn[] = [], ledger = common.ledger as GlyphChartLedgerEntry[];
  let columnIndent = Infinity, itemIndent: number | undefined;
  for (const part of parts) {
    const raw = statement(part), indent = /^[ \t]*/.exec(raw)![0].length;
    if (!raw.trim()) continue;
    const match = /^\s*([^\[\]{}@]*?)(?:\[((?:"(?:\\.|[^"\\])*"|[^\]])*)\])?\s*(?:@\{([\s\S]*)\})?\s*$/.exec(raw);
    if (!match || (!match[1]!.trim() && match[2] === undefined)) r.syntax(`Expected a kanban column or item in "${raw.trim()}".`);
    const text = textLabel(match[2] ?? match[1]!, r), id = match[1]!.trim() || text;
    const metadata: Record<string, string> = {};
    if (match[3] !== undefined) {
      // Scalar metadata is YAML-like; commas inside either quoted form are literal.
      const fields: string[] = [], raw = match[3]!;
      let start = 0, quote = "", depth = 0;
      for (let i = 0; i <= raw.length; i++) {
        const char = raw[i];
        if (quote) {
          if (char === "\\" && quote === '"') i++;
          else if (char === quote) { if (raw[i + 1] === quote) i++; else quote = ""; }
        } else if ((char === '"' || char === "'") && /[:,{\[]\s*$/.test(raw.slice(start, i))) quote = char;
        else if (char === "[" || char === "{") depth++;
        else if (char === "]" || char === "}") depth--;
        else if (i === raw.length || (char === "," && depth === 0)) { if (raw.slice(start, i).trim()) fields.push(raw.slice(start, i)); start = i + 1; }
      }
      if (quote || depth) r.syntax("Unclosed kanban metadata value.");
      for (const field of fields) {
        const pair = /^\s*([\w-]+)\s*:\s*([\s\S]*?)\s*$/.exec(field);
        if (!pair) r.syntax(`Expected key: value in kanban metadata "${field}".`);
        const key = pair[1]!, value = pair[2]!;
        const decoded = value.startsWith("'") && value.endsWith("'") ? value.slice(1, -1).replace(/''/g, "'") : value;
        if (["assigned", "ticket", "priority"].includes(key)) metadata[key] = r.label(decoded);
        else ledger.push(ledgerMermaidDegraded({ feature: `kanban metadata ${key}`, replacement: "unsupported metadata omitted", id }));
      }
    }
    if (!columns.length || indent <= columnIndent) {
      columns.push({ id, text, items: [] }); columnIndent = indent; itemIndent = undefined;
      if (Object.keys(metadata).length) ledger.push(ledgerMermaidDegraded({ feature: "kanban column metadata", replacement: "plain column header", id }));
    } else {
      if (itemIndent !== undefined && indent !== itemIndent) ledger.push(ledgerMermaidDegraded({ feature: "kanban nested indentation", replacement: "a card in the current column, in authored order", id }));
      itemIndent ??= indent;
      columns[columns.length - 1]!.items.push({ id, text, metadata });
    }
  }
  return spec(common, { kind: "kanban", columns });
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
  const wrap = (text: string, budget: number, role: string, report = true): string[] => {
    const result: string[] = [];
    for (const paragraph of text.split("\n")) {
      let row = "";
      for (const word of chartText(paragraph, charset, report ? { ledger, role: `${source.kind} ${role}` } : undefined).split(/\s+/).filter(Boolean)) {
        if (word.length > budget) { if (report) note(`${source.kind} ${role} word wider than the viewport`, "the whole word omitted, never split", { word, columns: Math.max(0, budget) }); continue; }
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
  const separateTitle = () => {
    const gap = title.length ? glyphChartTitleGap(height ?? Infinity, y * scale, scale, cols, height ?? (y + 1) * scale, ledger) : 0;
    if (gap) {
      for (const label of labels) if (label.y >= title.length * scale) label.y += gap;
      for (const segment of lines) { segment.from.y += gap; segment.to.y += gap; }
      y += gap / scale;
    }
    return gap;
  };
  if (source.kind === "timeline") {
    const indent = Math.min(2, Math.max(0, width - 1)), contentWidth = width - indent;
    const periods = source.rows.filter((row) => row.kind === "period");
    const periodWidth = Math.min(Math.max(1, ...periods.map((row) => chartText(row.text, charset).length)), Math.max(1, Math.floor(contentWidth / 3)));
    const eventX = indent + periodWidth + 5, eventWidth = width - eventX;
    const boundaries: number[] = [];
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
      if (row !== source.rows.at(-1)) boundaries.push(y * scale);
      content = true;
    }
    if (!source.rows.length) group(1, "empty caption", () => wrap("No periods", width, "caption").forEach((s, i) => add(0, y + i, s)));
    const gap = separateTitle();
    const space = glyphChartRowSpacing(y * scale, height, boundaries.map((row) => row + gap), scale);
    for (const label of labels) label.y = space(label.y);
    for (const segment of lines) { segment.from.y = space(segment.from.y); segment.to.y = space(segment.to.y); }
  } else if (source.kind === "kanban") {
    const rect = (x: number, top: number, w: number, h: number) => {
      line(x, top, x + w - 1, top); line(x, top + h - 1, x + w - 1, top + h - 1);
      line(x, top, x, top + h - 1); line(x + w - 1, top, x + w - 1, top + h - 1);
    };
    const metadata = (item: KanbanItem) => [item.metadata.ticket ? `#${item.metadata.ticket.replace(/^#/, "")}` : "", item.metadata.assigned, item.metadata.priority].filter((value): value is string => Boolean(value));
    const wrapMetadata = (item: KanbanItem, budget: number, report = true): string[] => {
      const rows: string[] = [];
      const separator = ` ${chartText("·", charset)} `;
      for (const value of metadata(item)) {
        const text = chartText(value, charset, report ? { ledger, role: "kanban metadata" } : undefined);
        // A separator belongs between complete items, never at either edge of a row.
        if (text.length > budget) {
          if (report) note("kanban metadata item wider than the viewport", "the complete item omitted, never split", { item: text, columns: budget });
          continue;
        }
        const last = rows.length - 1;
        if (last >= 0 && rows[last]!.length + separator.length + text.length <= budget) rows[last] += separator + text;
        else rows.push(text);
      }
      return rows;
    };
    // Reserve outer lane + inset + card border + text padding before choosing columns.
    const wordWidth = (text: string, padding: number) => chartText(text, charset).split(/\s+/).map((word) => word.length + padding);
    const wanted = source.columns.map((column) => Math.min(width, Math.max(9, ...wordWidth(column.text, 4),
      ...column.items.flatMap((item) => [...wordWidth(item.text, 8), ...metadata(item).map((value) => chartText(value, charset).length + 8)]))));
    const bands: { column: KanbanColumn; width: number }[][] = [];
    source.columns.forEach((column, i) => {
      const last = bands[bands.length - 1], w = wanted[i]!;
      if (!last || last.reduce((sum, lane) => sum + lane.width, 0) + last.length * 2 + w > width) bands.push([{ column, width: w }]);
      else last.push({ column, width: w });
    });
    if (bands.length > 1) note("kanban columns wrapped", "further rows of boxed lanes in authored order", { laneRows: bands.length, columns: width });
    for (const band of bands) {
      const extra = Math.max(0, width - band.reduce((sum, lane) => sum + lane.width, 0) - (band.length - 1) * 2);
      // Whole-word wrapping has plateaus: a greedy one-cell gain misses improvements several cells away.
      // Explore spare-width partitions; fit the tallest lane, then balance widths before saving wraps.
      type Allocation = { rows: number; headers: number; balance: number; widths: number[] };
      const choicesByLane = band.map((lane) => Array.from({ length: extra + 1 }, (_, share) => {
        const w = lane.width + share;
        const rows = lane.column.items.reduce((sum, item) => sum + Math.max(1, wrap(item.text, w - 8, "item", false).length) + wrapMetadata(item, w - 8, false).length, 0);
        const headers = Math.max(1, wrap(lane.column.text, w - 4, "column header", false).length);
        return { w, rows, headers, height: rows + headers + 3 + lane.column.items.length * 2 + (lane.column.items.length ? 0 : 1),
          balance: (w - (width - (band.length - 1) * 2) / band.length) ** 2 };
      }));
      // The tallest lane owns the board height. Minimizing total text rows first can
      // strand a tall narrow lane beside short wide ones, then omit its final card.
      let heights = [0];
      for (const choices of choicesByLane) {
        const next: number[] = [];
        heights.forEach((previous, spent) => {
          for (let share = 0; share + spent <= extra; share++) {
            const candidate = Math.max(previous, choices[share]!.height);
            next[spent + share] = Math.min(next[spent + share] ?? Infinity, candidate);
          }
        });
        heights = next;
      }
      const maxHeight = heights[extra]!;
      const balanceFirst = new Set(band.map((lane) => lane.column.items.length)).size === 1;
      let allocations: (Allocation | undefined)[] = [{ rows: 0, headers: 0, balance: 0, widths: [] }];
      for (const choices of choicesByLane) {
        const next: (Allocation | undefined)[] = [];
        allocations.forEach((previous, spent) => {
          if (!previous) return;
          for (let share = 0; share + spent <= extra; share++) {
            const choice = choices[share]!;
            if (choice.height > maxHeight) continue;
            const candidate = { rows: previous.rows + choice.rows, headers: previous.headers + choice.headers, balance: previous.balance + choice.balance, widths: [...previous.widths, choice.w] };
            const best = next[spent + share];
            const better = !best || (balanceFirst
              ? candidate.balance < best.balance || candidate.balance === best.balance && (candidate.rows < best.rows || candidate.rows === best.rows && candidate.headers < best.headers)
              : candidate.rows < best.rows || candidate.rows === best.rows && (candidate.headers < best.headers || candidate.headers === best.headers && candidate.balance < best.balance));
            if (better) next[spent + share] = candidate;
          }
        });
        allocations = next;
      }
      const lanes = band.map((lane, i) => {
        const w = allocations[extra]!.widths[i]!;
        const header = wrap(lane.column.text, w - 4, "column header");
        const cards = lane.column.items.map((item) => ({ item, text: wrap(item.text, w - 8, "item"), meta: wrapMetadata(item, w - 8) }));
        return { ...lane, width: w, header, cards, headerRows: Math.max(1, header.length) };
      });
      const fitted = lanes.map((lane) => {
        const { width: w, column } = lane;
        if (w < 9) { note("kanban lane narrower than a card", "the complete lane omitted", { id: column.id, columns: w }); return undefined; }
        const base = lane.headerRows + 3;
        if (y + base + 1 > maxRows) { note("kanban lane outside the viewport", "the complete lane omitted", { id: column.id, rows: base + 1 }); return undefined; }
        const cards = [];
        let h = base;
        for (const card of lane.cards) {
          const cardHeight = Math.max(1, card.text.length) + card.meta.length + 2;
          if (y + h + cardHeight > maxRows) { note("kanban card outside the viewport", "the complete card omitted", { id: card.item.id, rows: cardHeight }); continue; }
          cards.push({ ...card, height: cardHeight }); h += cardHeight;
        }
        return { ...lane, cards, height: h + (cards.length ? 0 : 1) };
      });
      const bandHeight = Math.max(0, ...fitted.map((lane) => lane?.height ?? 0));
      let x = 0;
      fitted.forEach((lane, i) => {
        if (!lane) { x += lanes[i]!.width + 2; return; }
        const { width: w, cards } = lane;
        rect(x, y, w, bandHeight);
        lane.header.forEach((s, i) => add(x + 2, y + 1 + i, s));
        line(x, y + lane.headerRows + 1, x + w - 1, y + lane.headerRows + 1);
        let cardY = y + lane.headerRows + 2;
        for (const card of cards) {
          rect(x + 2, cardY, w - 4, card.height);
          card.text.forEach((s, i) => add(x + 4, cardY + 1 + i, s));
          card.meta.forEach((s, i) => add(x + 4, cardY + 1 + Math.max(1, card.text.length) + i, s));
          cardY += card.height;
        }
        x += w + 2;
      });
      y += bandHeight + 1;
    }
    if (bands.length) y = Math.max(title.length, y - 1);
    else { const text = wrap("No columns", width, "caption"); group(Math.max(1, text.length), "empty caption", () => text.forEach((s, i) => add(0, y + i, s))); }
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
        const budget = Math.max(1, right - left - 3);
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
    const keyRows: string[] = [];
    for (const [index, key] of keys) {
      if (!visible.has(index)) continue;
      const field = source.fields[index]!, text = `${key}. [${field.start}${field.end === field.start ? "" : `-${field.end}`}] ${field.text}`;
      const last = keyRows.length - 1;
      if (last >= 0 && keyRows[last]!.length + 2 + text.length <= width - x) keyRows[last] += `  ${text}`;
      else keyRows.push(...wrap(text, width - x, "key"));
    }
    group(keyRows.length, "key", () => keyRows.forEach((s, i) => add(x, y + i, s)));
    if (!source.fields.length) { const text = wrap("No fields", width, "caption"); group(Math.max(1, text.length), "empty caption", () => text.forEach((s, i) => add(0, y + i, s))); }
  }
  if (source.kind !== "timeline") separateTitle();
  if (source.kind === "timeline") {
    const body = labels.filter((label) => !title.length || label.y >= title.length * scale);
    const right = Math.max(0, ...body.map((label) => label.x / scale + label.text.length), ...lines.map((line) => Math.max(line.from.x, line.to.x) / scale + 1));
    const offset = Math.max(0, Math.floor((width - right) / 2)) * scale;
    for (const label of body) label.x += offset;
    for (const line of lines) { line.from.x += offset; line.to.x += offset; }
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
