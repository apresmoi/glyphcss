import { getCollection } from "astro:content";
import { socialDocsCards } from "../services/static-workbench/docsCards";

export async function GET() {
  const { manifest } = await socialDocsCards(await getCollection("docs"));
  return Response.json(manifest);
}
