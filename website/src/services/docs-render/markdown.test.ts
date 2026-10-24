import { expect, it } from "vitest";
import { cleanMarkdown, readDocs } from "../../../scripts/metadata.mjs";
import { fitGlyphDocsOutput, renderGlyphDocs, type GlyphDocsRenderInput } from "./glyphRender";

it.each(readDocs())("keeps Markdown output identical to the shared docs renderer in $slug", async ({ source }) => {
  const markdown = await cleanMarkdown(source);
  const examples = source.matchAll(
    /<GlyphRender kind="([^"]+)" source={(.*?)} options={(.*?)}(?: showSource={false})? \/>/g,
  );
  for (const example of examples) {
    const input = {
      kind: example[1],
      source: JSON.parse(example[2]!),
      options: JSON.parse(example[3]!),
    } as GlyphDocsRenderInput;
    const textScale = input.options && "textScale" in input.options ? input.options.textScale : 1;
    const result = fitGlyphDocsOutput(await renderGlyphDocs(input), textScale);
    expect(markdown).toContain(`\n${result.text}\n`);
  }
});
