import type { GlyphChartLayout } from "./layout";

/** Content-first charts keep their compact geometry when a web viewport has spare cells. */
export function centerGlyphChartRows(layout: GlyphChartLayout, scale: number): GlyphChartLayout {
  const structure = layout.mermaidStructure, journey = layout.journey;
  if (!structure && !journey && !layout.gantt) return layout;
  const labels = structure?.labels ?? journey?.labels ?? [];
  const lines = structure?.lines ?? [];
  const titleEnd = layout.titleRow === null ? -1 : layout.titleRow + scale;
  const body = labels.filter((label) => label.y >= titleEnd);
  const xs = [...body.flatMap((label) => [label.x, label.x + label.text.length * scale - 1]), ...lines.flatMap(({ from, to }) => [from.x, to.x])];
  if (journey && layout.horizontalBarBands.size) xs.push(layout.plot.x0 + 1, layout.plot.x1);
  if (layout.gantt) {
    xs.push(layout.plot.x0, layout.plot.x1);
    for (const tick of [...layout.xTicks, ...layout.yTicks]) xs.push(tick.labelStart, tick.labelStart + tick.label.length * scale - 1);
  }
  const left = Math.min(...xs), right = Math.max(...xs);
  const dx = xs.length ? Math.floor((layout.cols - (right - left + 1)) / (2 * scale)) * scale - left : 0;
  const ys = [...labels.flatMap((label) => [label.y, label.y + scale - 1]), ...lines.flatMap(({ from, to }) => [from.y, to.y])];
  if (layout.gantt) {
    ys.push(layout.plot.y0, layout.plot.y1);
    for (const row of [layout.titleText ? layout.titleRow : null, layout.xAxisLine ? layout.xAxisLineRow : null, layout.xTicks.length ? layout.xAxisLabelRow : null, layout.xAxisTitle ? layout.xAxisTitleRow : null, layout.yAxisTitle ? layout.yAxisTitleRow : null, layout.legend?.row]) {
      if (row !== null && row !== undefined && row >= 0) ys.push(row, row + scale - 1);
    }
  }
  if (!ys.length) return layout;
  const top = Math.min(...ys), bottom = Math.max(...ys);
  const dy = Math.max(0, Math.floor((layout.rows - (bottom - top + 1)) / (2 * scale)) * scale - top);
  const shiftRow = (row: number) => row < 0 ? row : row + dy;
  const shiftLabel = (label: { x: number; y: number; text: string }) => ({ ...label, x: label.x + (label.y >= titleEnd ? dx : 0), y: label.y + dy });
  return {
    ...layout,
    ...(structure ? { mermaidStructure: { labels: labels.map(shiftLabel), lines: lines.map(({ from, to }) => ({ from: { x: from.x + dx, y: from.y + dy }, to: { x: to.x + dx, y: to.y + dy } })) } } : {}),
    ...(journey ? { journey: { labels: labels.map(shiftLabel) }, plot: { ...layout.plot, x0: layout.plot.x0 + dx, x1: layout.plot.x1 + dx } } : {}),
    horizontalBarBands: new Map([...layout.horizontalBarBands].map(([id, [a, b]]) => [id, a < 0 ? [a, b] : [a + dy, b + dy]])),
    titleRow: layout.titleRow === null ? null : layout.titleRow + dy,
    ...(layout.gantt ? {
      plot: { x0: layout.plot.x0 + dx, x1: layout.plot.x1 + dx, y0: layout.plot.y0 + dy, y1: layout.plot.y1 + dy },
      xTicks: layout.xTicks.map((tick) => ({ ...tick, cell: tick.cell + dx, labelStart: tick.labelStart + dx })),
      yAxisCol: layout.yAxisCol + dx,
      yTicks: layout.yTicks.map((tick) => ({ ...tick, cell: tick.cell + dy, labelStart: tick.labelStart + dx })),
      xAxisLineRow: shiftRow(layout.xAxisLineRow), xAxisLabelRow: shiftRow(layout.xAxisLabelRow),
      xAxisTitleRow: shiftRow(layout.xAxisTitleRow), yAxisTitleRow: shiftRow(layout.yAxisTitleRow),
      ...(layout.legend?.row !== undefined ? { legend: { ...layout.legend, row: layout.legend.row + dy } } : {}),
    } : {}),
  };
}
