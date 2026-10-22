import { getCollection } from "astro:content";
import { staticLoader, staticMap, staticSynth } from "../services/static-workbench/scenes";
import {
  socialBench,
  socialEarth,
  socialDiagram,
  socialCharts,
  socialDocsSections,
} from "../services/static-workbench/socialRenders";
import { socialDocsCards, socialGrid } from "../services/static-workbench/docsCards";

export async function GET() {
  const { renders } = await socialDocsCards(await getCollection("docs"));
  return Response.json({
    home: [await socialEarth()],
    bench: [socialBench()],
    diagrams: [await socialDiagram()],
    charts: await socialCharts(),
    maps: [socialGrid(await staticMap())],
    synth: [socialGrid(staticSynth())],
    loaders: [socialGrid(staticLoader())],
    ...socialDocsSections(),
    ...renders,
  });
}
