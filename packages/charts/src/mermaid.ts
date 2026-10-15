import type { GlyphChartDatum, GlyphChartMark, GlyphChartRenderOptions, GlyphChartResult, GlyphChartScaleOptions, GlyphChartSpec } from "./types";
import { glyphChartArc, glyphChartBar, glyphChartDot, glyphChartLine, glyphChartRule, glyphChartSankey, glyphChartText } from "./spec";
import { ledgerMermaidDegraded, ledgerMermaidIgnored, type GlyphChartLedgerEntry } from "./ledger";
import { GLYPH_CHART_TARGET_DEFAULTS, renderGlyphChart } from "./render";
import { gantt, journey, radar, treemap } from "./mermaidMore";
import { resolveSankeyRows } from "./flowMarks";

/** A normal chart spec plus source-adaptation notes; use the convenience renderer to merge both ledgers. */
export interface GlyphChartMermaidSpec extends GlyphChartSpec {
  readonly ledger: readonly GlyphChartLedgerEntry[];
}
export type GlyphChartMermaidErrorCode = "GLYPH_MERMAID_SYNTAX" | "GLYPH_MERMAID_NOT_CHART_TYPE";
export interface GlyphChartMermaidError extends Error { readonly code: GlyphChartMermaidErrorCode }

function fail(code: GlyphChartMermaidErrorCode, message: string): never {
  throw Object.assign(new Error(`glyphcss: ${code}: ${message}`), { code });
}
function syntax(message: string): never { return fail("GLYPH_MERMAID_SYNTAX", message); }
const NUMBER = String.raw`[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?`;
const QUOTED = String.raw`"(?:\\.|""|[^"\\])*"`;
const TEXT_CHANNELS = { x: "x", y: "y", label: "label" } as const;
function label(raw: string): string {
  let text = raw.trim();
  if (text.startsWith('"') && text.endsWith('"')) {
    try { text = JSON.parse(text) as string; }
    catch { text = text.slice(1, -1).replace(/""/g, '"').replace(/\\(["\\])/g, "$1"); }
  }
  if (text.startsWith("`") && text.endsWith("`")) text = text.slice(1, -1);
  const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (original, key: string) => {
    if (!key.startsWith("#")) return entities[key.toLowerCase()] ?? original;
    const value = key[1]?.toLowerCase() === "x" ? parseInt(key.slice(2), 16) : Number(key.slice(1));
    return value > 0 && value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff) ? String.fromCodePoint(value) : original;
  }).replace(/<br\s*\/?\s*>|[\r\n\t]+/gi, " ");
}
function numeric(raw: string): number {
  const value = Number(raw.trim());
  if (!raw.trim() || !Number.isFinite(value)) syntax(`Expected a finite number, got "${raw}".`);
  return value;
}

/** Directive grammars see no comment suffix; quoted URLs and style values retain literal %% text. */
function withoutTrailingComment(line: string): string {
  let quote = "";
  for (let i = 0; i < line.length; i++) {
    const char = line[i]!;
    if (quote) {
      if (char === "\\") i++;
      else if (char === quote) {
        if (line[i + 1] === quote) i++; else quote = "";
      }
    } else if (char === '"' || char === "'") quote = char;
    else if (char === "%" && line[i + 1] === "%") return line.slice(0, i);
  }
  return line;
}

/** Only Gantt has click statements; a leading word alone is never a directive. */
function inertDirective(statement: string, kind: string): string | undefined {
  if (kind === "gantt") {
    const href = String.raw`href\s+${QUOTED}`;
    const call = String.raw`call\s+[^\s(]+\s*\([^\n]*\)`;
    if (new RegExp(`^click\\s+[^\\s:]+\\s+(?:${href}(?:\\s+${call})?|${call}(?:\\s+${href})?)\\s*;?\\s*$`, "i").test(statement)) return "click";
  }
  if (kind.startsWith("treemap") && /^classDef\s+[a-zA-Z_][a-zA-Z0-9_]+(?:\s+[^;\r\n]*)?;?$/i.test(statement)) return "classDef";
  return undefined;
}

/** Configuration stays inert; name the requested look and the actual native fallback. */
function ignoredConfiguration(source: string, kind: string, ledger: GlyphChartLedgerEntry[]): void {
  const pie = kind === "pie";
  const sankey = kind.startsWith("sankey");
  const looks: Record<string, string> = pie ? {
    textPosition: "outside slice callouts; arc labels have no radial-position option",
    legendPosition: "a bottom legend; source configuration is inert (native spec.legend supports bottom and inside corners)",
    donutHole: "a solid pie; source configuration is inert (native arc.options.innerRadius supports donut holes)",
    highlightSlice: "unhighlighted slices; static arcs have no highlight or hover state",
  } : sankey ? {
    nodeAlignment: "native depth columns; the Sankey mark has no node-alignment option",
    nodeColors: "the default per-source palette; source configuration is inert (native mark.options.color supports per-source hex colors, not independent target-node colors)",
    linkColor: "source-colored links; source configuration is inert (native mark.options.color supports source or constant hex colors, not target colors or gradients)",
    labelStyle: "plain node labels; the text canvas has no outlined-label option",
    nodeWidth: "one-cell node bars; the Sankey mark has no pixel-width option",
    nodePadding: "native cell-based padding; the Sankey mark has no pixel-padding option",
    showValues: "native node totals and flow values; the Sankey mark has no value-label switch",
    prefix: "unprefixed numeric values; the Sankey mark has no value-prefix option",
    suffix: "unsuffixed numeric values; the Sankey mark has no value-suffix option",
  } : kind.startsWith("treemap") ? {
    showValues: "native leaf labels always include values; source configuration is inert",
    valueFormat: "native SI value formatting; source format strings are inert",
  } : {};
  for (const [key, replacement] of Object.entries({ ...looks, width: "the caller's column budget, never source pixels", height: "the caller's row budget, never source pixels" })) {
    if (new RegExp(`(?:^|[\\s,{])["']?${key}["']?\\s*:`, "m").test(source)) {
      ledger.push(ledgerMermaidIgnored({ feature: `${pie ? "pie" : sankey ? "sankey" : kind.startsWith("treemap") ? "treemap" : "chart"}.${key}`, replacement }));
    }
  }
}

/** Preserve quoted CSV fields, bracket lists and entities while removing only real comments/directives. */
function clean(source: string, ledger: GlyphChartLedgerEntry[], kind: string): { body: string; title?: string } {
  source = source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  let title: string | undefined;
  source = source.replace(/^\s*---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/, (_, front: string) => {
    title = /^title\s*:\s*(.+)$/m.exec(front)?.[1];
    ledger.push(ledgerMermaidIgnored({ feature: "frontmatter configuration" }));
    const config = /^config[ \t]*:([\s\S]*)/m.exec(front);
    if (config) ignoredConfiguration(config[1]!, kind, ledger);
    return "";
  });
  let body = "", quoted = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i]!;
    const csv = /^\s*sankey(?:-beta)?\b/i.test(body);
    if (!quoted && kind === "journey" && char === "#") {
      const end = source.indexOf("\n", i); i = end < 0 ? source.length : end - 1; continue;
    }
    // Comments must win over every free-label protector, even when they contain colons or unbalanced quotes.
    const comment = !quoted && (!csv || /(?:^|\n)[ \t]*$/.test(body)) && /^[ \t]*%%/.exec(source.slice(i));
    if (comment) {
      i += comment[0].length - 2;
      if (source.startsWith("%%{", i)) {
        const end = source.indexOf("}%%", i + 3);
        if (end < 0) syntax("Unclosed Mermaid directive.");
        ledger.push(ledgerMermaidIgnored({ feature: "initialization directive" }));
        ignoredConfiguration(source.slice(i, end), kind, ledger);
        body += " "; i = end + 2;
      } else { const end = source.indexOf("\n", i); i = end < 0 ? source.length : end - 1; }
      continue;
    }
    if (!quoted && !csv && (/(?:^|\n|;)\s*$/.test(body) || /^pie(?:\s+showData)?\s+$/i.test(body))) {
      const rawLine = source.slice(i).split("\n")[0]!;
      const directive = inertDirective(withoutTrailingComment(rawLine).trim(), kind);
      if (directive) { ledger.push(ledgerMermaidIgnored({ feature: directive })); i += rawLine.length - 1; continue; }
      if (kind === "journey") {
        // Journey names are free text, including unmatched quotes/brackets and semicolons.
        const statement = rawLine.replace(/(?:%%|#).*$/, "").trim();
        const section = /^section\s+(.+)$/i.exec(statement);
        if (section) { body += `section ${JSON.stringify(label(section[1]!))}`; i += rawLine.length - 1; continue; }
        if (!/^(?:title\s|acc(?:Title|Descr)\s*:|accDescr\s*\{)/i.test(statement) && statement.includes(":")) {
          body += JSON.stringify(statement); i += rawLine.length - 1; continue;
        }
      }
      // Titles are free text to end-of-line, so their punctuation must never enter the shared scanner.
      if (kind === "gantt") {
        const rawLine = source.slice(i).split("\n")[0]!;
        const statement = rawLine.trimStart();
        const format = /^(dateFormat|axisFormat|todayMarker)\s+(.+)$/i.exec(statement);
        if (format) { body += `${format[1]} ${JSON.stringify(format[2]!)}`; i += rawLine.length - 1; continue; }
        const free = /^(section)\s+(.+)$/i.exec(statement);
        const task = /^(?!title\b|accTitle\b|accDescr\b|dateFormat\b|axisFormat\b|todayMarker\b|vert\b)([^:]+):/.exec(statement);
        if (free) { body += `section ${JSON.stringify(label(free[2]!))}`; i += rawLine.length - 1; continue; }
        if (task) { body += JSON.stringify(label(task[1]!)) + ":"; i += rawLine.length - statement.length + task[0].length - 1; continue; }
      }
      const heading = /^title[ \t]+([^\n]*)/i.exec(source.slice(i));
      if (heading) { title = kind === "journey" ? heading[1]!.replace(/#.*$/, "") : heading[1]!; body += " "; i += heading[0].length - 1; continue; }
      const acc = /^(accTitle|accDescr)\s*:\s*([^\n]*)/i.exec(source.slice(i))
        ?? /^(accDescr)\s*\{([\s\S]*?)\}/i.exec(source.slice(i));
      if (acc) { body += `${acc[1]}: ${JSON.stringify(acc[2]!.trim())}`; i += acc[0].length - 1; continue; }
    }
    if (char === '"') {
      body += char;
      if (quoted && source[i + 1] === '"') { body += source[++i]; continue; }
      quoted = !quoted; continue;
    }
    if (quoted && !csv && char === "\\" && i + 1 < source.length) { body += char + source[++i]; continue; }
    body += char;
  }
  if (quoted) syntax("Unclosed quoted text.");
  return { body: body.trim(), title: title === undefined ? undefined : label(title) };
}
function statements(body: string): string[] {
  const parts: string[] = [];
  let current = "", quote = false, depth = 0;
  for (let i = 0; i < body.length; i++) {
    const char = body[i]!;
    if (char === '"') {
      current += char;
      if (quote && body[i + 1] === '"') { current += body[++i]; continue; }
      quote = !quote; continue;
    }
    if (quote && char === "\\" && i + 1 < body.length) { current += char + body[++i]; continue; }
    if (!quote) {
      if (char === "[" || char === "{") depth++;
      if (char === "]" || char === "}") depth--;
      if (char === "&") {
        const entity = /^&(?:#x[\da-f]+|#\d+|\w+);/i.exec(body.slice(i));
        if (entity) { current += entity[0]; i += entity[0].length - 1; continue; }
      }
      if (depth === 0 && (char === ";" || char === "\n")) {
        if (current.trim()) parts.push(current.trim());
        current = ""; continue;
      }
    }
    current += char;
  }
  if (depth !== 0) syntax("Unclosed chart data list.");
  if (current.trim()) parts.push(current.trim());
  return parts;
}
function splitList(body: string, separator = ","): string[] {
  const parts: string[] = [];
  let quote = false, start = 0;
  for (let i = 0; i < body.length; i++) {
    if (body[i] === "\\" && quote) { i++; continue; }
    if (body[i] === '"') {
      if (quote && body[i + 1] === '"') { i++; continue; }
      quote = !quote;
    }
    if (body.startsWith(separator, i) && !quote) { parts.push(body.slice(start, i).trim()); i += separator.length - 1; start = i + 1; }
  }
  if (body.slice(start).trim()) parts.push(body.slice(start).trim());
  return parts;
}
/** A bracket in a quoted series/axis title is text, not the start of data. */
function bracketList(body: string): { prefix: string; content: string } | undefined {
  let quote = false;
  for (let i = 0; i < body.length; i++) {
    const char = body[i];
    if (char === "\\" && quote) { i++; continue; }
    if (char === '"') {
      if (quote && body[i + 1] === '"') { i++; continue; }
      quote = !quote; continue;
    }
    if (!quote && char === "[" && body.endsWith("]")) return { prefix: body.slice(0, i), content: body.slice(i + 1, -1) };
  }
  return undefined;
}
const emptyMark = () => glyphChartText([{ x: 0, y: 0, label: "" }], TEXT_CHANNELS);

/** Tolerant Mermaid chart reader. Other grammars are rejected before their body is tokenized. */
export function glyphChartFromMermaid(source: string): GlyphChartMermaidSpec { return parseChart(source, false); }

function parseChart(source: string, radarSummary: boolean): GlyphChartMermaidSpec {
  if (typeof source !== "string") syntax("Mermaid source must be a string.");
  const prefix = source.replace(/^\uFEFF/, "").replace(/^\s*---\s*\n[\s\S]*?\n---\s*(?:\n|$)/, "").replace(/^(?:\s|%%\{[\s\S]*?\}%%|%%[^\n]*(?:\n|$))*/, "");
  const journeyPrefix = prefix.replace(/^(?:\s|#[^\n]*(?:\n|$)|%%\{[\s\S]*?\}%%|%%[^\n]*(?:\n|$))*/, "");
  const declared = /^[\w-]+/.exec(/^journey\b/i.test(journeyPrefix) ? journeyPrefix : prefix)?.[0];
  if (declared && !["pie", "xychart", "xychart-beta", "sankey", "sankey-beta", "quadrantchart", "gantt", "journey", "radar", "radar-beta", "treemap", "treemap-beta"].includes(declared.toLowerCase())) {
    fail("GLYPH_MERMAID_NOT_CHART_TYPE", `Mermaid ${declared} is not a chart type handled by this reader.`);
  }
  const ledger: GlyphChartLedgerEntry[] = [];
  const cleaned = clean(source, ledger, declared?.toLowerCase() ?? "");
  const header = /^([\w-]+)\b/.exec(cleaned.body);
  if (!header) syntax("Expected a Mermaid chart declaration.");
  const kind = header[1]!.toLowerCase();
  if (!["pie", "xychart", "xychart-beta", "sankey", "sankey-beta", "quadrantchart", "gantt", "journey", "radar", "radar-beta", "treemap", "treemap-beta"].includes(kind)) {
    return fail("GLYPH_MERMAID_NOT_CHART_TYPE", `Mermaid ${header[1]} is not a chart type handled by this reader.`);
  }
  if (kind.startsWith("treemap")) return treemap(cleaned.body.slice(header[0].length), { title: cleaned.title, ledger }, { label, numeric, syntax, splitList });
  let body = cleaned.body.slice(header[0].length).trim();
  let title = cleaned.title, description: string | undefined;
  const degrade = (feature: string, replacement: string, detail?: Record<string, unknown>) => ledger.push(ledgerMermaidDegraded({ feature, replacement, ...detail }));
  if (kind.startsWith("sankey")) return sankey(body, ledger, title);
  const horizontal = /^horizontal\b/i.test(body);
  let showData = false;
  if (kind === "pie") { showData = /^showData\b/i.test(body); body = body.replace(/^showData\b/i, "").trim(); }
  if (kind.startsWith("xychart")) body = body.replace(/^(?:horizontal|vertical)\b/i, "").trim();
  const parts = statements(body);
  const content: string[] = [];
  // Accessibility data is kept as inert metadata, never HTML or callbacks.
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    if (/^title\s+/i.test(part)) { title = label(part.replace(/^title\s+/i, "")); continue; }
    const acc = /^acc(Title|Descr)\s*:\s*(.*)$/i.exec(part);
    if (acc) { description = [description, label(acc[2]!)].filter(Boolean).join("\n"); continue; }
    if (/^accDescr\s*\{/i.test(part)) {
      let value = part.replace(/^accDescr\s*\{/i, "");
      while (!value.includes("}") && i + 1 < parts.length) value += `\n${parts[++i]}`;
      description = [description, value.replace(/}\s*$/, "").trim()].filter(Boolean).join("\n"); continue;
    }
    content.push(part);
  }
  const common = { title, description, ledger };
  if (kind === "pie") {
    const data: GlyphChartDatum[] = [];
    for (const part of content) {
      const match = new RegExp(`^(${QUOTED})\\s*:\\s*(${NUMBER})$`).exec(part);
      if (!match) syntax(`Expected a quoted pie label and value in "${part}".`);
      const value = numeric(match[2]!);
      if (value < 0) syntax("Pie values cannot be negative.");
      const name = label(match[1]!);
      data.push({ label: showData ? `${name} [${value}]` : name, value });
    }
    return { ...common, marks: [data.length ? glyphChartArc(data, { y: "value", fill: "label" }) : emptyMark()] };
  }
  if (kind === "quadrantchart") return quadrant(content, common, degrade);
  if (kind === "gantt") return gantt(content, common, { label, numeric, syntax, splitList });
  if (kind === "journey") return journey(content, common, { label, numeric, syntax, splitList });
  if (kind.startsWith("radar")) return radar(content, common, { label, numeric, syntax, splitList }, radarSummary);
  let categories: string[] | undefined, xDomain: number[] | undefined, yDomain: number[] | undefined;
  let xTitle = "", yTitle = "";
  const series: { type: "bar" | "line"; name?: string; points: { value: number; label: string }[] }[] = [];
  for (const part of content) {
    const axis = /^([xy])-axis\s+([\s\S]+)$/i.exec(part);
    if (axis) {
      const axisBody = axis[2]!;
      const list = bracketList(axisBody);
      const range = new RegExp(`^([\\s\\S]*?)(${NUMBER})\\s*-->\\s*(${NUMBER})$`).exec(axisBody);
      const axisTitle = label(list?.prefix ?? range?.[1] ?? axisBody);
      if (axis[1]!.toLowerCase() === "x") {
        xTitle = axisTitle;
        if (list) categories = splitList(list.content).map(label);
        if (range) xDomain = [numeric(range[2]!), numeric(range[3]!)];
      } else { yTitle = axisTitle; if (range) yDomain = [numeric(range[2]!), numeric(range[3]!)]; }
      continue;
    }
    const match = /^(bar|line)\s*([\s\S]*)$/i.exec(part);
    const list = match ? bracketList(match[2]!) : undefined;
    if (!match || !list) syntax(`Expected an XY axis or series in "${part}".`);
    const points = splitList(list.content).map((value) => {
      const point = new RegExp(`^(${NUMBER})(?:\\s*(${QUOTED}))?$`).exec(value);
      if (!point) syntax(`Expected an XY value with an optional quoted label in "${value}".`);
      return { value: numeric(point[1]!), label: point[2] ? label(point[2]) : "" };
    });
    series.push({ type: match[1]!.toLowerCase() as "bar" | "line", name: list.prefix.trim() ? label(list.prefix) : undefined, points });
  }
  const marks: GlyphChartMark[] = [];
  const count = Math.max(0, ...series.map((s) => s.points.length));
  if (categories && count > categories.length) {
    degrade("short category list", "extra numbered categories for the remaining data", { categories: categories.length, values: count });
    categories = Array.from({ length: count }, (_, i) => categories?.[i] ?? `#${i + 1}`);
  }
  // Mermaid's first nonempty series establishes the implicit numeric range; later series span it independently.
  const firstSeries = series.find((s) => s.points.length);
  if (!categories && !xDomain && firstSeries) xDomain = [1, firstSeries.points.length];
  const transpose = horizontal;
  for (const s of series) {
    if (!s.points.length) continue;
    const data = s.points.map((p, i) => {
      const position = categories ? categories[i]! : xDomain ? xDomain[0]! + (xDomain[1]! - xDomain[0]!) * i / Math.max(1, s.points.length - 1) : i + 1;
      return transpose ? { x: p.value, y: position, label: p.label } : { x: position, y: p.value, label: p.label };
    });
    marks.push((s.type === "bar" ? glyphChartBar : glyphChartLine)(data, { x: "x", y: "y" }, { ...(s.name ? { name: s.name } : {}), ...(s.type === "bar" && horizontal ? { orientation: "horizontal" as const } : {}) }));
    if (s.type === "line" && data.some((d) => d.label)) marks.push(glyphChartText(data.filter((d) => d.label), TEXT_CHANNELS, s.name ? { name: s.name } : undefined));
  }
  if (yDomain && series.some((s) => s.type === "bar") && !(Math.min(...yDomain) <= 0 && Math.max(...yDomain) >= 0)) {
    const before = [...yDomain]; yDomain = [Math.min(0, ...yDomain), Math.max(0, ...yDomain)];
    degrade("bar domain excluding zero", "a value domain including the zero baseline", { before, after: yDomain });
  }
  const x: GlyphChartScaleOptions = categories ? { type: "band", ...(categories.length > 1 ? { domain: categories } : {}) } : { type: "linear", ...(xDomain ? { domain: xDomain, nice: false } : {}) };
  const y: GlyphChartScaleOptions = { type: "linear", ...(yDomain ? { domain: yDomain, nice: false } : {}) };
  return { ...common, marks: marks.length ? marks : [emptyMark()], scales: transpose ? { x: y, y: x } : { x, y }, axes: { x: { title: transpose ? yTitle : xTitle }, y: { title: transpose ? xTitle : yTitle } }, legend: series.some((s) => Boolean(s.name)) };
}

type Common = Pick<GlyphChartMermaidSpec, "title" | "description" | "ledger">;
type Degrade = (feature: string, replacement: string, detail?: Record<string, unknown>) => void;
function quadrant(parts: string[], common: Common, degrade: Degrade): GlyphChartMermaidSpec {
  const classes = new Map<string, Record<string, string>>();
  const points: { label: string; x: number; y: number; className?: string; style: Record<string, string> }[] = [];
  const captions: GlyphChartDatum[] = [];
  let xNames: string[] = [], yNames: string[] = [];
  const styles = (text: string) => Object.fromEntries(splitList(text).map((part) => { const at = part.indexOf(":"); return [part.slice(0, at).trim(), part.slice(at + 1).trim()]; }));
  for (const part of parts) {
    const classDef = /^classDef\s+([\w-]+)\s+([a-z][\w-]*\s*:\s*[^\[\]]+)$/i.exec(part);
    if (classDef) { classes.set(classDef[1]!, styles(classDef[2]!)); continue; }
    const axis = /^([xy])-axis\s+(.+)$/i.exec(part);
    if (axis) {
      const names = splitList(axis[2]!, "-->").map(label);
      if (axis[1]!.toLowerCase() === "x") xNames = names; else yNames = names;
      continue;
    }
    const caption = /^quadrant-([1-4])\s+(.+)$/i.exec(part);
    if (caption) {
      const q = Number(caption[1]);
      captions.push({ x: q === 1 || q === 4 ? 0.75 : 0.25, y: q <= 2 ? 0.94 : 0.44, label: label(caption[2]!) }); continue;
    }
    const point = new RegExp(`^(.*?)(?::::([\\w-]+))?\\s*:\\s*\\[\\s*(${NUMBER})\\s*,\\s*(${NUMBER})\\s*\\]\\s*(.*)$`).exec(part);
    if (!point) syntax(`Expected a quadrant caption, axis, point or class in "${part}".`);
    const x = numeric(point[3]!), y = numeric(point[4]!);
    if (x < 0 || x > 1 || y < 0 || y > 1) syntax("Quadrant coordinates must be between zero and one.");
    points.push({ label: label(point[1]!), className: point[2], x, y, style: styles(point[5]!) });
  }
  const marks: GlyphChartMark[] = [glyphChartRule([0.5], { axis: "x" }), glyphChartRule([0.5])];
  for (const point of points) {
    const style = { ...classes.get(point.className ?? ""), ...point.style };
    let color: string | undefined = style.color?.toLowerCase();
    if (color && /^#[\da-f]{3}$/.test(color)) color = `#${[...color.slice(1)].map((c) => c + c).join("")}`;
    if (color && !/^#[\da-f]{6}$/.test(color)) { degrade("point CSS color", "the default point color", { color }); color = undefined; }
    if (Object.keys(style).some((key) => key !== "color")) degrade("point radius and border styling", "a single-cell dot retaining its fill color", { point: point.label, style });
    const data = [{ x: point.x, y: point.y, label: point.label }];
    marks.push(glyphChartDot(data, { x: "x", y: "y" }, color ? { color } : undefined));
    marks.push(glyphChartText(data, TEXT_CHANNELS, color ? { color } : undefined));
  }
  if (captions.length) marks.push(glyphChartText(points.length ? captions : captions.map((caption) => ({ ...caption, y: Number(caption.y) > 0.5 ? 0.75 : 0.25 })), TEXT_CHANNELS));
  const endpoint = (names: string[]) => (value: number | string | Date) => Number(value) === 0 ? names[0] ?? "" : Number(value) === 1 ? names[1] ?? "" : "";
  return { ...common, marks, scales: { x: { domain: [0, 1], nice: false }, y: { domain: [0, 1], nice: false } }, axes: { x: { title: "", tickMarks: false, ticks: xNames.length ? 2 : 0, format: endpoint(xNames) }, y: { title: "", tickMarks: false, ticks: yNames.length ? 2 : 0, format: endpoint(yNames) } }, legend: false };
}

function sankey(body: string, ledger: GlyphChartLedgerEntry[], title?: string): GlyphChartMermaidSpec {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quote = false;
  for (let i = 0; i <= body.length; i++) {
    const char = body[i];
    if (char === '"') {
      if (quote && body[i + 1] === '"') { field += '"'; i++; } else quote = !quote;
    } else if (!quote && (char === "," || char === "\n" || char === undefined)) {
      row.push(field.trim()); field = "";
      if (char !== ",") { if (row.some(Boolean)) rows.push(row); row = []; }
    } else if (char !== undefined) field += char;
  }
  const originalNames = new Map<string, string>();
  let ambiguousNames = false;
  const data = rows.map((values) => {
    if (values.length !== 3) syntax("Sankey rows require exactly source,target,value CSV fields.");
    const source = values[0]!.replace(/[\r\n\t]+/g, " "), target = values[1]!.replace(/[\r\n\t]+/g, " ");
    for (const [normalized, original] of [[source, values[0]!], [target, values[1]!]]) {
      if (originalNames.has(normalized!) && originalNames.get(normalized!) !== original) ambiguousNames = true;
      originalNames.set(normalized!, original!);
    }
    if (source !== values[0] || target !== values[1]) ledger.push(ledgerMermaidDegraded({ feature: "multiline CSV label", replacement: "a single-line node label" }));
    return { source, target, value: numeric(values[2]!) };
  });
  const positive = data.filter((d) => d.value > 0);
  if (positive.length !== data.length) ledger.push(ledgerMermaidDegraded({ feature: "nonpositive Sankey flows", replacement: "positive flows only", dropped: data.length - positive.length }));
  const flowList = (feature: string, flows: readonly { source: string; target: string; value: number }[]): GlyphChartMermaidSpec => {
    ledger.push(ledgerMermaidDegraded({ feature, replacement: "a text list preserving every positive flow", fallback: "flow-list" }));
    const display = (name: string) => name.replace(/\n/g, "\\n").replace(/\t/g, "\\t") || "(empty)";
    return { title, ledger, legend: false, marks: [glyphChartText(flows.map((d, i) => ({ x: 0, y: flows.length - i, label: `${display(d.source)} -> ${display(d.target)} (${d.value})` })), TEXT_CHANNELS)] };
  };
  if (ambiguousNames || positive.some((d) => !d.source || !d.target)) {
    return flowList(ambiguousNames ? "ambiguous normalized CSV names" : "empty Sankey node names", rows.map((r) => ({ source: r[0]!, target: r[1]!, value: numeric(r[2]!) })).filter((d) => d.value > 0));
  }
  const mark = positive.length ? glyphChartSankey(positive, { source: "source", target: "target", value: "value" }) : emptyMark();
  if (positive.length) {
    try { resolveSankeyRows(mark); }
    catch (error) {
      if ((error as { code?: string }).code === "sankey-cycle") return flowList("cyclic Sankey graph", positive);
      throw error;
    }
  }
  return { title, ledger, marks: [mark], legend: false };
}

/** Render through the ordinary mark pipeline and retain adaptation notes in both result.report and build.report. */
export function renderGlyphChartMermaid(source: string, options: GlyphChartRenderOptions = {}): GlyphChartResult {
  const charset = options.charset ?? GLYPH_CHART_TARGET_DEFAULTS[options.target ?? "web"].charset;
  const spec = parseChart(source, charset === "box" || charset === "ascii");
  const flowList = spec.ledger.some((entry) => entry.detail?.fallback === "flow-list");
  const result = renderGlyphChart(spec, flowList && options.height === undefined ? { ...options, height: Math.max(3, spec.marks[0]!.data.length) } : options);
  const report = { ...result.report, ledger: [...spec.ledger, ...result.report.ledger] };
  return { ...result, report, build: { ...result.build, report } };
}
