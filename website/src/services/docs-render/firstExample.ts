import { parse } from "@astrojs/compiler";
import type { Node } from "@astrojs/compiler/types";
import type { GlyphDocsRenderInput } from "./glyphRender";

export async function firstGlyphDocsExample(body: string): Promise<GlyphDocsRenderInput | undefined> {
  return (await glyphDocsExamples(body))[0];
}

export async function glyphDocsExamples(body: string): Promise<GlyphDocsRenderInput[]> {
  // Code samples describe components; only actual MDX examples belong on cards.
  const markup = body
    .replace(/^([ \t]*)(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1\2[ \t]*(?=\r?$)/gm, "")
    .replace(/(`+)[^\n]*?\1/g, "");
  if (!markup.includes("<GlyphRender")) return [];
  const { ast } = await parse(markup);
  const found: GlyphDocsRenderInput[] = [];
  function visit(node: Node) {
    if (node.type === "component" && node.name === "GlyphRender") {
      const input: Record<string, unknown> = {};
      for (const attribute of node.attributes) {
        if (!["kind", "source", "options"].includes(attribute.name)) continue;
        // Docs keep example props as JSON literals, never evaluated JavaScript.
        input[attribute.name] = attribute.kind === "quoted" ? attribute.value : JSON.parse(attribute.value);
      }
      if (!input.kind || input.source === undefined) throw new Error("GlyphRender requires kind and source.");
      found.push(input as GlyphDocsRenderInput);
      return;
    }
    if ("children" in node) for (const child of node.children) visit(child);
  }
  visit(ast);
  return found;
}
