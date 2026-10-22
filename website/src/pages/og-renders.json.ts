import { staticDiagrams } from "../features/diagrams/render/staticDiagrams";
import { staticCharts } from "../features/charts/render/staticCharts";
import { staticGallery, staticLoader, staticMap, staticSynth } from "../services/static-workbench/scenes";
import { socialBench, socialEarth } from "../services/static-workbench/socialRenders";

export async function GET() {
  const diagrams = await staticDiagrams();
  const charts = staticCharts();
  const grid = (entry: { text: string; html: string }) => ({
    html: entry.html,
    cols: Math.max(...entry.text.split("\n").map((line) => [...line].length)),
    rows: entry.text.split("\n").length,
  });
  return Response.json({
    home: [await socialEarth()],
    bench: [socialBench()],
    diagrams: [diagrams.initial, ...diagrams.examples.slice(0, 2)].map(grid),
    charts: [charts.initial, ...charts.examples.filter((entry) => ["Heatmap", "Donut"].includes(entry.title))].map(
      grid,
    ),
    maps: [grid(await staticMap())],
    gallery: [grid(staticGallery())],
    synth: [grid(staticSynth())],
    loaders: [grid(staticLoader())],
  });
}
