import { defineRouteMiddleware } from "@astrojs/starlight/route-data";

export const onRequest = defineRouteMiddleware(async ({ locals, site }, next) => {
  const route = locals.starlightRoute;
  const slug = route.id || "index";
  const image = new URL(`/og/docs/${slug}.png`, site).href;
  route.head.push(
    { tag: "meta", attrs: { property: "og:image", content: image } },
    { tag: "meta", attrs: { name: "twitter:image", content: image } },
  );
  if (route.id !== "404") {
    route.head.push({ tag: "link", attrs: { rel: "alternate", type: "text/markdown", href: `/docs/${slug}.md` } });
  }
  await next();
});
