import { GLYPH_CHART_RADAR_CAPTION_RADIUS, GLYPH_CHART_RADAR } from "./radar";
import { GLYPH_CHART_GANTT, GLYPH_CHART_GANTT_TICKS, glyphGanttTickGranularity, type GlyphChartGanttRow } from "./gantt";
import { GLYPH_CHART_JOURNEY, type GlyphChartJourneyRow } from "./journey";
import { formatLinearTick } from "./scales";
import { timeFormat } from "d3-time-format";
import { glyphChartBar, glyphChartDot, glyphChartLine, glyphChartText, glyphChartTreemap } from "./spec";
import { ledgerMermaidDegraded, ledgerMermaidIgnored, type GlyphChartLedgerEntry } from "./ledger";
import type { GlyphChartMermaidSpec } from "./mermaid";
import type { GlyphChartDatum, GlyphChartMark } from "./types";

interface Reader {
  label(raw: string): string;
  splitList(raw: string, separator?: string): string[];
  syntax(message: string): never;
  numeric(raw: string): number;
}
type Common = Pick<GlyphChartMermaidSpec, "title" | "description" | "ledger">;
const channels = { x: "x", y: "y", label: "label" } as const;
const quietAxes = { x: { title: "", ticks: 0, line: false }, y: { title: "", ticks: 0, line: false } } as const;
const empty = () => glyphChartText([{ x: 0, y: 0, label: "" }], channels);

/** Preserve source rows; the journey layout owns wrapping and task/actor attribution. */
export function journey(parts: string[], common: Common, r: Reader): GlyphChartMermaidSpec {
  const ledger = common.ledger as GlyphChartLedgerEntry[];
  const rows: GlyphChartJourneyRow[] = [], bars: GlyphChartDatum[] = [];
  for (const part of parts) {
    const section = /^section\s+(.+)$/i.exec(part);
    if (section) { rows.push({ kind: "section", text: r.label(section[1]!) }); continue; }
    const statement = part.startsWith('"') ? JSON.parse(part) as string : part;
    const task = /^(.+?)\s*:\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)?\s*(?::\s*([\s\S]*))?$/i.exec(statement);
    if (!task) r.syntax(`Expected a journey task, score and optional actors in "${statement}".`);
    const score = task[2] === undefined ? 0 : r.numeric(task[2]);
    const value = Math.max(1, Math.min(5, score));
    if (value !== score) ledger.push(ledgerMermaidDegraded({ feature: "journey score outside 1–5", replacement: "a score clamped to 1–5", score, value }));
    const name = r.label(task[1]!);
    const actors = (task[3] ?? "").split(",").map((actor) => r.label(actor)).filter(Boolean).join(", ");
    const id = `journey-${rows.length}`;
    rows.push({ kind: "task", id, text: name, value, actors });
    bars.push({ x: value, y: id, task: name, score, actors });
  }
  ledger.push(ledgerMermaidDegraded({ feature: "journey timeline and faces", replacement: "section headers and compact task rows with horizontal bars on a fixed 0–5 scale, numeric scores and actors", fallback: "journey-summary" }));
  return { ...common, [GLYPH_CHART_JOURNEY]: rows,
    marks: [glyphChartBar(bars.length ? bars : [{ x: 0, y: "journey-empty" }], { x: "x", y: "y" }, { orientation: "horizontal" })],
    legend: false, scales: { x: { type: "linear", domain: [0, 5], nice: false }, y: { type: "band" } }, axes: quietAxes,
  } as GlyphChartMermaidSpec;
}

export function radar(parts: string[], common: Common, r: Reader, summary = false, grid: "all" | "outer" = "all"): GlyphChartMermaidSpec {
  const axes: { id: string; label: string }[] = [], curves: { id: string; label: string; values: string[] }[] = [];
  let min = 0, max: number | undefined, ticks = 5, polygon = false, legend = true;
  const ledger = common.ledger as GlyphChartLedgerEntry[];
  const named = /^([^\s\[{},]+)\s*(?:\[\s*("(?:\\.|[^"\\])*"|[^\]]+)\s*\])?$/;
  const identity = (raw: string) => { const m = named.exec(raw.trim()); if (!m) r.syntax(`Expected radar id and optional label in "${raw}".`); return { id: m[1]!, label: r.label(m[2] ?? m[1]!) }; };
  for (const part of parts) {
    const axis = /^axis\s+(.+)$/i.exec(part);
    if (axis) { axes.push(...r.splitList(axis[1]!).map(identity)); continue; }
    const curve = /^curve\s+([\s\S]+)$/i.exec(part);
    if (curve) {
      let remaining = curve[1]!.trim();
      while (remaining) {
        let quote = false, bracket = 0, open = -1;
        for (let i = 0; i < remaining.length; i++) {
          const ch = remaining[i];
          if (quote && ch === "\\") { i++; continue; }
          if (ch === '"') { if (quote && remaining[i + 1] === '"') { i++; continue; } quote = !quote; }
          if (!quote) { if (ch === "[") bracket++; if (ch === "]") bracket--; if (ch === "{" && bracket === 0) { open = i; break; } }
        }
        const close = remaining.indexOf("}", open + 1);
        if (open < 0 || close < 0) r.syntax(`Expected radar curves in "${part}".`);
        curves.push({ ...identity(remaining.slice(0, open)), values: r.splitList(remaining.slice(open + 1, close)) });
        remaining = remaining.slice(close + 1).trim();
        if (remaining && !remaining.startsWith(",")) r.syntax("Expected a comma between radar curves.");
        remaining = remaining.replace(/^,\s*/, "");
      }
      continue;
    }
    const option = /^(max|min|ticks|graticule|showLegend)\s+(.+)$/i.exec(part);
    if (!option) r.syntax(`Expected a radar axis, curve or option in "${part}".`);
    const key = option[1]!.toLowerCase(), value = option[2]!.trim();
    if (key === "max") max = r.numeric(value);
    if (key === "min") min = r.numeric(value);
    if (key === "ticks") ticks = Math.max(0, Math.floor(r.numeric(value)));
    if (key === "graticule") { if (!/^(circle|polygon)$/i.test(value)) r.syntax("Radar graticule must be circle or polygon."); polygon = /^polygon$/i.test(value); }
    if (key === "showlegend") { if (!/^(true|false)$/i.test(value)) r.syntax("showLegend must be true or false."); legend = /^true$/i.test(value); }
  }
  const values = curves.map((curve) => {
    curve.values.forEach((value) => r.numeric(value.includes(":") ? value.slice(value.indexOf(":") + 1) : value));
    const keyed = curve.values.some((s) => s.includes(":"));
    const map = new Map(curve.values.map((s) => { const at = s.indexOf(":"); return [s.slice(0, at).trim(), s.slice(at + 1)]; }));
    if (curve.values.length !== axes.length || keyed && (map.size !== axes.length || axes.some((a) => !map.has(a.id)))) ledger.push(ledgerMermaidDegraded({ feature: `radar curve ${curve.label} axis coverage`, replacement: "missing values at the minimum and extra values omitted" }));
    return axes.map((a, i) => { const v = keyed ? map.get(a.id) : curve.values[i]; return v === undefined ? min : r.numeric(v); });
  });
  max ??= values.reduce((maximum, row) => row.reduce((m, v) => Math.max(m, v), maximum), min);
  if (max <= min) { if (min + 1 === min) min = 0; max = min + 1; ledger.push(ledgerMermaidDegraded({ feature: "empty radar range", replacement: "a unit range above the minimum" })); }
  if (ticks > 10) { ledger.push(ledgerMermaidDegraded({ feature: "dense radar ticks", replacement: "ten graticules", requested: ticks })); ticks = 10; }
  if (axes.length < 3 && axes.length) ledger.push(ledgerMermaidDegraded({ feature: "radar with fewer than three axes", replacement: "radial spokes and degenerate curves" }));
  const seriesName = (index: number) => `${index < 26 ? String.fromCharCode(65 + index) : `S${index + 1}`}: ${curves[index]!.label}`;
  values.forEach((v, index) => {
    if (v.some((value) => value < min || value > max!)) ledger.push(ledgerMermaidDegraded({ feature: `radar curve ${curves[index]!.label} out-of-range values`, replacement: "values clamped to the radial domain" }));
  });
  if (summary) {
    ledger.push(ledgerMermaidDegraded({ feature: "radar whole-cell curves", replacement: "grouped horizontal interval bars per axis, from the radial minimum to each clamped value" }));
    const magnitude = Math.max(1, Math.abs(min), Math.abs(max));
    const normalize = !Number.isFinite(max - min);
    if (normalize) ledger.push(ledgerMermaidDegraded({ feature: "overflowing radar range", replacement: "bars and ticks normalized by the largest magnitude" }));
    const barValue = (value: number) => normalize ? value / magnitude : value;
    if (new Set(axes.map((a) => a.label)).size < axes.length) ledger.push(ledgerMermaidDegraded({ feature: "radar repeated axis labels", replacement: "axis ids appended to repeated labels so summary bands remain distinct" }));
    const axisLabel = (id: string) => {
      const axis = axes.find((a) => a.id === id);
      return axis && axes.filter((a) => a.label === axis.label).length > 1 ? `${axis.label} (${id})` : axis?.label ?? id;
    };
    const rows = values.flatMap((row, index) => row.map((value, i) => ({ x0: barValue(min), x: barValue(Math.max(min, Math.min(max!, value))), y: axes[i]!.id, series: seriesName(index) })));
    // One categorical mark lets the bar painter dodge curves into distinct rows within each axis band.
    const marks = [glyphChartBar(rows, { x0: "x0", x: "x", y: "y", fill: "series" }, { orientation: "horizontal" })];
    return { ...common, marks: rows.length ? marks : [empty()], scales: { x: { domain: [barValue(min), barValue(max)], nice: false }, y: { type: "band", ...(axes.length > 1 ? { domain: axes.map((a) => a.id).reverse() } : {}) } }, axes: { x: { title: "Value", ...(normalize ? { format: (v: number | string | Date) => formatLinearTick(Number(v) * magnitude) } : {}) }, y: { title: "", line: false, format: (v: number | string | Date) => axisLabel(String(v)) } }, legend };
  }
  const marks: GlyphChartMark[] = [], captions: GlyphChartDatum[] = [];
  const point = (index: number, radius: number, count = axes.length) => { const angle = 2 * Math.PI * index / count; return { x: Math.sin(angle) * radius, y: Math.cos(angle) * radius }; };
  const line = (data: GlyphChartDatum[], name?: string) => glyphChartLine(data, channels, { color: name ? undefined : "#7a7f8a", ...(name ? { name } : {}) });
  if (axes.length) {
    if (grid === "outer" && ticks > 1) ledger.push(ledgerMermaidDegraded({ feature: "radar inner graticules", replacement: "outer contour and all axis spokes" }));
    for (let i = grid === "outer" ? Math.max(1, ticks) : 1; i <= ticks; i++) {
      const n = polygon ? axes.length : 256;
      marks.push(line(Array.from({ length: n + 1 }, (_, k) => point(k, i / ticks, n))));
    }
    axes.forEach((a, i) => { marks.push(line([{ x: 0, y: 0 }, point(i, 1)])); captions.push({ ...point(i, GLYPH_CHART_RADAR_CAPTION_RADIUS), label: a.label }); });
    const magnitude = Math.max(1, Math.abs(min), Math.abs(max));
    const radius = (value: number) => Math.max(0, Math.min(1, (value / magnitude - min / magnitude) / (max! / magnitude - min / magnitude)));
    values.forEach((v, index) => {
      const points = v.map((value, i) => point(i, radius(value)));
      marks.push(line([...points, points[0]!], seriesName(index)));
    });
  }
  if (captions.length) marks.push(glyphChartText(captions, channels));
  ledger.push(ledgerMermaidDegraded({ feature: "radar tick labels", replacement: "unlabeled graticules; interior numbers omitted to avoid curve collisions" }));
  ledger.push(ledgerMermaidDegraded({ feature: "radar filled smooth curves", replacement: "closed native line polygons without fill or smoothing" }));
  return { ...common, [GLYPH_CHART_RADAR]: true, marks: marks.length ? marks : [empty()], scales: { x: { domain: [-1.45, 1.45] }, y: { domain: [-1.35, 1.35] } }, axes: quietAxes, legend } as GlyphChartMermaidSpec;
}

export function treemap(body: string, common: Common, r: Reader): GlyphChartMermaidSpec {
  const data: GlyphChartDatum[] = [], stack: { indent: number; id: string }[] = [];
  const ledger = common.ledger as GlyphChartLedgerEntry[];
  let description = common.description;
  for (const line of body.split("\n")) {
    const acc = /^\s*acc(?:Title|Descr)\s*:\s*(.*)$/i.exec(line);
    if (acc) { description = [description, r.label(acc[1]!)].filter(Boolean).join("\n"); continue; }
    if (!line.trim()) continue;
    const match = /^(\s*)("(?:\\.|""|[^"\\])*")(?:\s*:\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?))?\s*(?:::\:[\w,-]+)?\s*;?\s*$/i.exec(line);
    if (!match) r.syntax(`Expected an indented quoted treemap node in "${line.trim()}".`);
    const indent = match[1]!.replace(/\t/g, "    ").length;
    while (stack.length && stack[stack.length - 1]!.indent >= indent) stack.pop();
    const value = match[3] ? r.numeric(match[3]) : 0;
    if (value < 0) ledger.push(ledgerMermaidDegraded({ feature: "negative treemap value", replacement: "zero area", value }));
    if (line.includes(":::")) ledger.push(ledgerMermaidIgnored({ feature: "treemap class assignment" }));
    const id = String(data.length);
    data.push({ id, parent: stack[stack.length - 1]?.id ?? "", label: r.label(match[2]!), value: Math.max(0, value) });
    stack.push({ indent, id });
  }
  return { ...common, description, marks: data.length ? [glyphChartTreemap(data)] : [empty()], legend: false };
}

const DAY = 86_400_000;
const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** Dayjs's documented Gantt tokens, parsed locally without executing source configuration. */
function dateParser(format: string): (raw: string) => number {
  const tokens = /\[[^\]]*\]|YYYY|MMMM|MMM|DDDD|DDD|SSS|YY|MM|Do|DD|HH|hh|mm|ss|SS|ZZ|[QMDHhmsSaAXxZ]/g;
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const fields: string[] = [];
  let at = 0, pattern = "^", m: RegExpExecArray | null;
  while ((m = tokens.exec(format))) {
    pattern += escape(format.slice(at, m.index)); at = tokens.lastIndex;
    const token = m[0];
    if (token.startsWith("[")) { pattern += escape(token.slice(1, -1)); continue; }
    fields.push(token);
    pattern += token === "MMMM" || token === "MMM" ? "([A-Za-z]+)" : token === "a" || token === "A" ? "(am|pm)" : token === "Z" || token === "ZZ" ? "(Z|[+-]\\d{2}:?\\d{2})" : token === "Do" ? "(\\d{1,2}(?:st|nd|rd|th))" : token === "X" || token === "x" ? "([+-]?\\d+(?:\\.\\d+)?)" : token === "YYYY" ? "(\\d{4})" : token === "DDD" || token === "DDDD" ? "(\\d{1,3})" : `(${token.length === 1 ? "\\d{1,2}" : `\\d{${token.length}}`})`;
  }
  const regex = new RegExp(pattern + escape(format.slice(at)) + "$", "i");
  return (raw) => {
    const match = regex.exec(raw.trim()); if (!match) return NaN;
    let year = 1970, month = 0, day = 1, hour = 0, minute = 0, second = 0, ms = 0, pm: string | undefined, offset: string | undefined, ordinal = false;
    fields.forEach((token, i) => {
      const rawValue = match[i + 1]!, value = parseInt(rawValue, 10);
      if (token === "YYYY") year = value;
      else if (token === "YY") year = value + (value > 68 ? 1900 : 2000);
      else if (token === "Q") month = (value - 1) * 3;
      else if (/^M+$/.test(token)) month = token.length >= 3 ? months.findIndex((s) => token === "MMM" ? s.slice(0, 3).toLowerCase() === rawValue.toLowerCase() : s.toLowerCase() === rawValue.toLowerCase()) : value - 1;
      else if (/^D/.test(token)) { day = value; ordinal = token === "DDD" || token === "DDDD"; }
      else if (/^[Hh]/.test(token)) hour = value;
      else if (/^m/.test(token)) minute = value;
      else if (/^s/.test(token)) second = value;
      else if (/^S/.test(token)) ms = value * 10 ** (3 - token.length);
      else if (/^[aA]$/.test(token)) pm = rawValue;
      else if (/^Z/.test(token)) offset = rawValue;
    });
    if (fields.includes("X")) return Number(match[fields.indexOf("X") + 1]) * 1000;
    if (fields.includes("x")) return Number(match[fields.indexOf("x") + 1]);
    if (pm) hour = hour % 12 + (/pm/i.test(pm) ? 12 : 0);
    const date = new Date(0); date.setFullYear(year, ordinal ? 0 : month, day); date.setHours(hour, minute, second, ms);
    if (month < 0 || month > 11 || day < 1 || (!ordinal && date.getDate() !== day) || hour > 23 || minute > 59 || second > 59) return NaN;
    if (offset) {
      const utc = Date.UTC(year, ordinal ? 0 : month, day, hour, minute, second, ms);
      const zone = offset === "Z" ? 0 : (offset.startsWith("-") ? -1 : 1) * (Number(offset.slice(1, 3)) * 60 + Number(offset.replace(":", "").slice(3, 5)));
      return utc - zone * 60_000;
    }
    return date.getTime();
  };
}
interface Task { id: string; label: string; section: string; tags: string[]; start?: string; end: string; previous?: string }

export function gantt(parts: string[], common: Common, r: Reader): GlyphChartMermaidSpec {
  const ledger = common.ledger as GlyphChartLedgerEntry[];
  let dateFormat = "YYYY-MM-DD", axisFormat = "%Y-%m-%d", section = "", weekend = 6;
  let inclusive = false;
  const included: string[] = [];
  const excluded: string[] = [], tasks: Task[] = [], markers: { label: string; date: string; time?: number }[] = [];
  let interval: string | undefined;
  for (const part of parts) {
    if (/^inclusiveEndDates$/i.test(part)) { inclusive = true; continue; }
    if (/^(?:topAxis|displayMode(?:\s+.*)?)$/i.test(part)) { ledger.push(ledgerMermaidIgnored({ feature: part, replacement: "one task per row and a bottom time axis" })); continue; }
    const setting = /^(dateFormat|axisFormat|tickInterval|excludes|includes|section|weekend|weekday|todayMarker|vert)\s+(.+)$/i.exec(part);
    if (setting) {
      const key = setting[1]!.toLowerCase(), v = setting[2]!.trim();
      if (key === "dateformat") dateFormat = r.label(v);
      if (key === "axisformat") axisFormat = r.label(v);
      if (key === "tickinterval") interval = v;
      if (key === "excludes") excluded.push(...v.split(/[\s,]+/));
      if (key === "includes") included.push(...v.split(/[\s,]+/));
      if (key === "section") section = r.label(v);
      if (key === "weekend") weekend = /^friday$/i.test(v) ? 5 : 6;
      if (key === "vert") { const colon = v.indexOf(" :"); markers.push({ label: colon < 0 ? "" : r.label(v.slice(0, colon)), date: colon < 0 ? v : v.slice(colon + 2).trim() }); }
      if (["todaymarker", "weekday"].includes(key)) ledger.push(ledgerMermaidIgnored({ feature: setting[1]!, replacement: key === "todaymarker" ? "no live today marker" : "native calendar ticks and exclusions" }));
      continue;
    }
    const colon = part.indexOf(":"); if (colon < 0) r.syntax(`Expected a Gantt task in "${part}".`);
    const fields = r.splitList(part.slice(colon + 1)), tags: string[] = [];
    while (/^(?:crit|active|done|milestone|vert)$/i.test(fields[0] ?? "")) tags.push(fields.shift()!.toLowerCase());
    if (!fields.length) r.syntax("Gantt tasks need a date or duration.");
    const duration = /^(?:\d+(?:\.\d*)?|\.\d+)(?:ms|s|m|h|d|w|M|y)$/;
    const parse = dateParser(dateFormat);
    let id = `__task${tasks.length}`;
    if (fields.length >= 3 || fields.length === 2 && !Number.isFinite(parse(fields[0]!)) && !/^(after|until)\s/i.test(fields[0]!) && !duration.test(fields[0]!)) id = fields.shift()!;
    const end = fields.pop()!, start = fields.shift();
    tasks.push({ id, label: r.label(part.slice(0, colon)), section, tags, start, end, previous: tasks[tasks.length - 1]?.id });
  }
  if (!/YYYY|YY|[Xx]/.test(dateFormat)) ledger.push(ledgerMermaidDegraded({ feature: "partial Gantt dateFormat", replacement: "the stable 1970 calendar for omitted date fields", dateFormat }));
  const parse = dateParser(dateFormat), byId = new Map(tasks.map((t) => [t.id, t]));
  const resolved = new Map<string, { start: number; end: number }>(), visiting = new Set<string>();
  const calendarKey = (time: number) => { const d = new Date(time); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
  const tokenDate = (s: string) => Number.isFinite(parse(s)) ? parse(s) : dateParser("YYYY-MM-DD")(s);
  const excludedDates = new Set(excluded.filter((s) => Number.isFinite(tokenDate(s))).map((s) => calendarKey(tokenDate(s))));
  const includedDates = new Set(included.filter((s) => Number.isFinite(tokenDate(s))).map((s) => calendarKey(tokenDate(s))));
  const isExcluded = (time: number) => { const d = new Date(time); return !includedDates.has(calendarKey(time)) && (excludedDates.has(calendarKey(time)) || excluded.some((s) => s.toLowerCase() === days[d.getDay()] || s.toLowerCase() === "weekends" && [weekend, (weekend + 1) % 7].includes(d.getDay()))); };
  const durationEnd = (start: number, raw: string) => {
    const match = /^(\d+(?:\.\d*)?|\.\d+)(ms|s|m|h|d|w|M|y)$/.exec(raw);
    if (!match) return NaN;
    const n = Number(match[1]), unit = match[2]!;
    const d = new Date(start);
    if (unit === "M" || unit === "y") {
      const day = d.getDate(); d.setDate(1);
      if (unit === "M") d.setMonth(d.getMonth() + n); else d.setFullYear(d.getFullYear() + n);
      const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); d.setDate(Math.min(day, last));
    }
    else if (unit === "d" || unit === "w") { const whole = Math.floor(n * (unit === "w" ? 7 : 1)); d.setDate(d.getDate() + whole); d.setTime(d.getTime() + (n * (unit === "w" ? 7 : 1) - whole) * DAY); }
    else d.setTime(start + n * ({ ms: 1, s: 1000, m: 60_000, h: 3_600_000 }[unit] ?? 0));
    let end = d.getTime();
    if (excluded.length && end > start) {
      // A finite calendar walk; an impossible all-week exclusion must never hang the reader.
      const cursor = new Date(start); cursor.setDate(cursor.getDate() + 1); let walked = 0;
      while (cursor.getTime() <= end && walked++ < 36600) { if (isExcluded(cursor.getTime())) { const next = new Date(end); next.setDate(next.getDate() + 1); end = next.getTime(); } cursor.setDate(cursor.getDate() + 1); }
      if (walked >= 36600) { ledger.push(ledgerMermaidDegraded({ feature: "Gantt exclusion horizon", replacement: "the unextended duration beyond 36600 calendar days" })); return d.getTime(); }
    }
    return end;
  };
  const resolve = (task: Task): { start: number; end: number } => {
    const prior = resolved.get(task.id); if (prior) return prior;
    if (visiting.has(task.id)) { ledger.push(ledgerMermaidDegraded({ feature: "cyclic Gantt dependency", replacement: "the Unix epoch anchor" })); return { start: 0, end: 0 }; }
    visiting.add(task.id);
    const dependency = (text: string, edge: "start" | "end") => {
      const dates = text.trim().split(/\s+/).map((id) => { const t = byId.get(id); if (t) return resolve(t)[edge]; ledger.push(ledgerMermaidDegraded({ feature: `unknown Gantt dependency ${id}`, replacement: "the Unix epoch anchor" })); return 0; });
      return dates.length ? edge === "start" ? Math.min(...dates) : Math.max(...dates) : 0;
    };
    let start = task.start ? /^after\s+/i.test(task.start) ? dependency(task.start.replace(/^after\s+/i, ""), "end") : parse(task.start) : task.previous ? resolve(byId.get(task.previous)! ).end : 0;
    if (!Number.isFinite(start)) { start = 0; ledger.push(ledgerMermaidDegraded({ feature: "unrecognized Gantt start date", replacement: "the Unix epoch anchor", dateFormat })); }
    if (!task.start && !task.previous) ledger.push(ledgerMermaidDegraded({ feature: "implicit first Gantt task start", replacement: "the stable Unix epoch instead of the live current date" }));
    let end = /^until\s+/i.test(task.end) ? dependency(task.end.replace(/^until\s+/i, ""), "start") : parse(task.end);
    if (inclusive && Number.isFinite(end) && !/^until\s+/i.test(task.end)) { const next = new Date(end); next.setDate(next.getDate() + 1); end = next.getTime(); }
    if (!Number.isFinite(end)) end = durationEnd(start, task.end);
    if (!Number.isFinite(end)) { end = start; ledger.push(ledgerMermaidDegraded({ feature: "unrecognized Gantt end date or duration", replacement: "a zero-duration event", dateFormat })); }
    if (end < start) { ledger.push(ledgerMermaidDegraded({ feature: "Gantt end before start", replacement: "a zero-duration event" })); end = start; }
    visiting.delete(task.id); const result = { start, end }; resolved.set(task.id, result); return result;
  };
  const marks: GlyphChartMark[] = [], rows: string[] = [], labels = new Map<string, string>();
  const ganttRows: GlyphChartGanttRow[] = [];
  let previousSection: string | undefined;
  let lo = Infinity, hi = -Infinity;
  tasks.forEach((task, index) => {
    const t = resolve(task);
    if (task.tags.includes("vert")) { markers.push({ label: task.label, date: "", time: t.start }); lo = Math.min(lo, t.start); hi = Math.max(hi, t.end); return; }
    const name = `${task.section ? `${task.section} / ` : ""}${task.label}${task.tags.some((s) => ["crit", "active", "done"].includes(s)) ? ` [${task.tags.filter((s) => ["crit", "active", "done"].includes(s)).join(",")}]` : ""}`;
    if (task.section && task.section !== previousSection) { const key = `__section${index}`; rows.push(key); labels.set(key, task.section); ganttRows.push({ key, label: task.section, section: true }); }
    previousSection = task.section;
    const row = `${index + 1}. ${name}`; rows.push(row);
    const status = task.tags.filter((s) => ["crit", "active", "done"].includes(s)).join(",");
    labels.set(row, task.label);
    ganttRows.push({ key: row, label: task.label, section: false, ...(status ? { status } : {}) });
    lo = Math.min(lo, t.start); hi = Math.max(hi, t.end);
    if (task.tags.includes("milestone") || t.start === t.end) marks.push(glyphChartDot([{ x: new Date((t.start + t.end) / 2), y: row }], channels));
    else marks.push(glyphChartBar([{ x0: new Date(t.start), x: new Date(t.end), y: row }], { x0: "x0", x: "x", y: "y" }, { orientation: "horizontal" }));
  });
  const taskWidth = Math.max(0, ...ganttRows.filter((row) => !row.section).map((row) => row.label.length));
  const statusWidth = Math.max(0, ...ganttRows.map((row) => row.status?.length ?? 0));
  if (statusWidth) for (const row of ganttRows) {
    if (!row.section) labels.set(row.key, `${row.label.padStart(taskWidth)}  ${(row.status ?? "").padEnd(statusWidth)}`);
  }
  for (const marker of markers) {
    const date = marker.time ?? parse(marker.date); if (!Number.isFinite(date)) { ledger.push(ledgerMermaidDegraded({ feature: "unrecognized Gantt vertical marker", replacement: "an omitted marker" })); continue; }
    lo = Math.min(lo, date); hi = Math.max(hi, date);
    marks.push({ type: "rule", data: [{ x: new Date(date) }], channels: { x: "x" }, options: { axis: "x", ...(marker.label ? { name: marker.label } : {}) } });
  }
  if (!Number.isFinite(lo)) { lo = 0; hi = DAY; }
  if (lo === hi) hi = lo + DAY;
  if (excluded.length) ledger.push(ledgerMermaidDegraded({ feature: "Gantt excluded-day background shading", replacement: "an unshaded time axis with duration calculations retaining all exclusions" }));
  if (tasks.some((t) => t.tags.some((s) => ["crit", "active", "done"].includes(s)))) ledger.push(ledgerMermaidDegraded({ feature: "Gantt status styling", replacement: "an aligned status column, retaining simultaneous crit/active/done tags" }));
  if (tasks.some((t) => t.tags.includes("milestone"))) ledger.push(ledgerMermaidDegraded({ feature: "Gantt milestone diamonds", replacement: "native dots at start plus half duration" }));
  let ticks: number | undefined;
  if (interval) {
    const m = /^([1-9]\d*)(millisecond|second|minute|hour|day|week|month)$/.exec(interval);
    if (m) ticks = Math.max(1, Math.min(100, Math.ceil((hi - lo) / (Number(m[1]) * ({ millisecond: 1, second: 1000, minute: 60000, hour: 3600000, day: DAY, week: 7 * DAY, month: 30 * DAY }[m[2]!] ?? DAY)))));
    ledger.push(ledgerMermaidDegraded({ feature: `Gantt tickInterval ${interval}`, replacement: "a requested native tick count, thinned to prevent label collisions" }));
  }
  return { ...common, [GLYPH_CHART_GANTT]: ganttRows, [GLYPH_CHART_GANTT_TICKS]: glyphGanttTickGranularity(dateFormat, axisFormat), marks: marks.length ? marks : [empty()], scales: { x: { type: "time", domain: [new Date(lo), new Date(hi)], nice: false }, ...(rows.length ? { y: { type: "band" as const, ...(rows.length > 1 ? { domain: [...rows].reverse() } : {}) } } : {}) }, axes: { x: { title: "", ...(ticks === undefined ? {} : { ticks }), format: (v) => timeFormat(axisFormat)(new Date(v)) }, y: { title: "", tickMarks: false, line: false, format: (v) => labels.get(String(v)) ?? "" } }, legend: markers.some((m) => m.label !== "") } as GlyphChartMermaidSpec;
}
