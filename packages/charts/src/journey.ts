import { glyphChartRowSpacing, glyphChartTitleGap } from "./rowSpacing";
import { chartText } from "./labels";
import { ledgerMermaidDegraded, type GlyphChartLedgerEntry } from "./ledger";
import type { GlyphChartLayout } from "./layout";
import type { GlyphChartCharset, GlyphChartSpec } from "./types";

export type GlyphChartJourneyRow = { readonly kind: "section"; readonly text: string }
  | { readonly kind: "task"; readonly id: string; readonly text: string; readonly value: number; readonly actors: string };

// Enumerable symbols survive validation's spec copy without adding a native public option.
export const GLYPH_CHART_JOURNEY = Symbol("glyph-chart-journey");
export type GlyphChartJourneySpec = GlyphChartSpec & { readonly [GLYPH_CHART_JOURNEY]?: readonly GlyphChartJourneyRow[] };
export interface GlyphChartJourneyLayout {
  readonly labels: readonly { readonly x: number; readonly y: number; readonly text: string }[];
}

/** Journey rows are a table, not categories: only task rows own bars. */
export function layoutGlyphJourney(spec: GlyphChartJourneySpec, cols: number, height: number | undefined, scale: number, charset: GlyphChartCharset, ledger: GlyphChartLedgerEntry[]): GlyphChartLayout | undefined {
  const authored = spec[GLYPH_CHART_JOURNEY];
  if (!authored) return undefined;
  const width = Math.floor(cols / scale);
  const note = (feature: string, detail: Record<string, unknown>) => ledger.push(ledgerMermaidDegraded({ feature, replacement: "complete words or rows omitted, never clipped or split", ...detail }));
  const fold = (text: string) => chartText(text, charset);
  const wrap = (text: string, budget: number, role: string): string[] => {
    const lines: string[] = [];
    for (const word of chartText(text, charset, { ledger, role: `journey ${role}` }).split(/\s+/).filter(Boolean)) {
      if (word.length > budget) { note(`journey ${role} word wider than its column`, { word, columns: Math.max(0, budget) }); continue; }
      const last = lines.length - 1;
      if (last >= 0 && lines[last]!.length + word.length + 1 <= budget) lines[last] += ` ${word}`;
      else lines.push(word);
    }
    return lines;
  };
  const tasks = authored.filter((row) => row.kind === "task");
  const taskWidth = Math.min(Math.max(1, ...tasks.map((row) => fold(row.text).length)), Math.max(1, Math.floor(width / 3)));
  const barStart = 2 + taskWidth + 2;
  const scoreWidth = Math.max(1, ...tasks.map((row) => String(row.value).length));
  const barWidth = Math.max(1, Math.min(26, width - barStart - scoreWidth - 1));
  const scoreCol = barStart + barWidth + 1, actorCol = scoreCol + scoreWidth + 2;
  const labels: { x: number; y: number; text: string }[] = [];
  const horizontalBarBands = new Map<string, readonly [number, number]>();
  const maxRows = height === undefined ? Infinity : Math.floor(height / scale);
  let y = 0;
  const add = (x: number, row: number, text: string) => { if (text) labels.push({ x: x * scale, y: row * scale, text }); };
  const rawTitle = typeof spec.title === "string" ? spec.title : spec.title?.text;
  let title: string | null = rawTitle ? chartText(rawTitle, charset, { ledger, role: "journey title" }) : null;
  if (title && title.length > width) {
    const kept: string[] = [];
    for (const word of title.split(/\s+/)) { if ([...kept, word].join(" ").length > width) break; kept.push(word); }
    note("journey title wider than the viewport", { title: rawTitle, columns: width });
    title = kept.join(" ") || null;
  }
  if (title) { if (maxRows >= 1) add(Math.floor((width - title.length) / 2), y, title); else note("journey title beyond the viewport", { title }); y++; }
  const boundaries: number[] = [];
  let content = false;
  for (const row of authored) {
    if (row.kind === "section") {
      if (content) y++;
      const lines = wrap(row.text, width, "section");
      if (y + Math.max(1, lines.length) <= maxRows) lines.forEach((line, i) => add(0, y + i, line));
      else note("journey section beyond the viewport", { section: row.text, rows: maxRows });
      y += Math.max(1, lines.length);
      content = true;
      continue;
    }
    const names = wrap(row.text, taskWidth, "task");
    const actorText = fold(row.actors);
    const beside = actorText.length <= width - actorCol;
    const actorX = beside ? actorCol : barStart;
    const actors = wrap(row.actors, width - actorX, "actor");
    const actorOffset = beside || !actors.length ? 0 : 1;
    const rowHeight = Math.max(1, names.length, actorOffset + actors.length);
    if (y + rowHeight <= maxRows && scoreCol + scoreWidth <= width) {
      names.forEach((line, i) => add(2, y + i, line));
      add(scoreCol, y, String(row.value));
      actors.forEach((line, i) => add(actorX, y + actorOffset + i, line));
      horizontalBarBands.set(row.id, [y * scale, (y + 1) * scale - 1]);
    } else note("journey task outside the viewport", { task: row.text, columns: width, rows: height ?? y + rowHeight });
    y += rowHeight;
    if (row !== authored.at(-1)) boundaries.push(y * scale);
    content = true;
  }
  if (!authored.length) { if (width >= 8 && maxRows >= y + 1) add(0, y, "No tasks"); else note("journey empty caption outside the viewport", { columns: width }); y++; }
  const gap = title ? glyphChartTitleGap(height ?? Infinity, y * scale, scale, cols, height ?? (y + 1) * scale, ledger) : 0;
  if (gap) {
    for (const label of labels) if (label.y >= scale) label.y += gap;
    for (const [id, [top, bottom]] of horizontalBarBands) horizontalBarBands.set(id, [top + gap, bottom + gap]);
    for (let i = 0; i < boundaries.length; i++) boundaries[i]! += gap;
    y += gap / scale;
  }
  const rows = height ?? Math.max(scale, y * scale);
  const space = glyphChartRowSpacing(y * scale, height, boundaries, scale);
  for (const label of labels) label.y = space(label.y);
  for (const [id, [top, bottom]] of horizontalBarBands) horizontalBarBands.set(id, [space(top), space(bottom)]);
  // Centre the table as one unit; centring individual rows would detach scores and actors.
  const body = labels.filter((label) => !title || label.y !== 0);
  const left = Math.min(0, ...body.map((label) => label.x / scale));
  const right = Math.max(scoreCol + scoreWidth, ...body.map((label) => label.x / scale + label.text.length));
  const offset = Math.max(0, Math.floor((width - (right - left)) / 2) - left);
  for (const label of body) label.x += offset * scale;
  const plot = { x0: Math.min(cols - 1, (barStart + offset) * scale - 1), x1: Math.min(cols - 1, (barStart + offset + barWidth) * scale - 1), y0: 0, y1: rows - 1 };
  return {
    cols, rows, plot, horizontalBarBands, journey: { labels },
    xTicks: [], yTicks: [], titleText: title, titleRow: title ? 0 : null, titleAlign: "center",
    xAxisLineRow: -1, xAxisLabelRow: -1, yAxisCol: -1, xTickMarks: false, yTickMarks: false,
    xAxisLine: false, yAxisLine: false, cellKeyRow: -1, xGrid: false, yGrid: false,
    xAxisColor: "#7a7f8a", yAxisColor: "#7a7f8a", xAxisTitle: null, yAxisTitle: null,
    xAxisTitleRow: -1, xAxisTitleAt: "center", yAxisTitleRow: -1, legend: null, hasCartesianAxes: false,
  };
}
