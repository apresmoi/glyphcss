import { getCollection } from "astro:content";
import { staticFluid, staticSynth } from "../../services/static-workbench/scenes";
import {
  socialBench,
  socialEarth,
  socialDiagram,
  socialCharts,
  socialDocsSections,
  socialLoaders,
  socialAgents,
} from "../../services/static-workbench/socialRenders";
import { socialDocsCards, socialGrid } from "../../services/static-workbench/docsCards";

export async function GET() {
  const { renders } = await socialDocsCards(await getCollection("docs"));
  return Response.json({
    home: [await socialEarth()],
    bench: [socialBench()],
    diagrams: [await socialDiagram()],
    charts: await socialCharts(),
    agents: [await socialAgents()],
    maps: [await socialEarth()],
    synth: [socialGrid(staticSynth())],
    fluid: [socialGrid(await staticFluid(72, 30))],
    loaders: socialLoaders(),
    ...socialDocsSections(),
    ...renders,
  });
}
