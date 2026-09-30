// The muted grey `@glyphcss/charts` defaults an axis to, re-exported so
// `chartsWorkbenchState.ts` and `chartsWorkbenchRender.ts` — which already
// import from each other's neighbourhood — can both read it with no import
// cycle between them.
export { GLYPH_CHART_AXIS_DEFAULT_COLOR as CHARTS_AXIS_DEFAULT_COLOR } from "@glyphcss/charts";
