import { getCollection } from "astro:content";

export async function GET() {
  const docs = (await getCollection("docs")).map(({ id, data, filePath }) => {
    const source = filePath?.replaceAll("\\", "/").split("content/docs/")[1] ?? "";
    const section = id.includes("/")
      ? id.split("/")[0]!
      : source.includes("/")
        ? source.split("/")[0]!
        : "Getting started";
    const render =
      section === "maps"
        ? "maps"
        : /diagram/.test(id)
          ? "diagrams"
          : /chart/.test(id)
            ? "charts"
            : /effects/.test(id)
              ? "synth"
              : "gallery";
    return {
      slug: `docs/${id || "index"}`,
      title: data.title,
      section,
      render,
      url: `/${id}/`,
    };
  });
  if (!docs.some((doc) => doc.slug === "docs/404"))
    docs.push({ slug: "docs/404", title: "Page not found", section: "Help", render: "gallery", url: "/404/" });
  return Response.json(docs.sort((a, b) => a.slug.localeCompare(b.slug)));
}
