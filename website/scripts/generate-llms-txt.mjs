import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { cleanMarkdown, readDocs, websiteRoot } from "./metadata.mjs";

const dist = join(websiteRoot, "dist");
const docs = readDocs();
const description =
  "> Glyphcss renders 3D models, Mermaid diagrams and data charts as monospace text for the DOM, chat and terminals. JavaScript libraries, React/Vue bindings and a Node.js CLI. MIT licensed.";
const start = [
  "## Start here",
  "",
  "- [Diagrams workbench — Mermaid to text](https://glyphcss.com/diagrams/)",
  "- [Charts workbench — ASCII and braille charts](https://glyphcss.com/charts/)",
  "- [3D renderer: glyphcss on npm](https://www.npmjs.com/package/glyphcss)",
  "- [Diagrams: @glyphcss/diagrams on npm](https://www.npmjs.com/package/@glyphcss/diagrams)",
  "- [Charts: @glyphcss/charts on npm](https://www.npmjs.com/package/@glyphcss/charts)",
  "- [CLI: @glyphcss/compile on npm](https://www.npmjs.com/package/@glyphcss/compile) — glyphcss diagram graph.mmd; glyphcss chart chart.json",
  "- [Agent skill and Claude Code / Codex plugin](https://github.com/apresmoi/glyphcss-diagrams) — npx skills add apresmoi/glyphcss-diagrams",
  "- [CLI skill reference](https://glyphcss.com/skill.md)",
  "",
];
const index = ["# Glyphcss", "", description, "", ...start];
const full = ["# Glyphcss — Full Documentation", "", description, "", ...start];
const sections = new Map();
const labels = {
  api: "API reference",
  components: "Components",
  guides: "Guides",
};
for (const doc of docs) {
  const section = doc.section;
  const title =
    labels[section] ?? section.charAt(0).toUpperCase() + section.slice(1);
  if (!sections.has(title)) sections.set(title, []);
  sections.get(title).push(doc);
  const out = join(dist, "docs", `${doc.slug || "index"}.md`);
  mkdirSync(dirname(out), { recursive: true });
  const body = await cleanMarkdown(doc.source);
  writeFileSync(out, `# ${doc.title}\n\n${body}`);
  full.push("---", "", `# ${doc.title}`, "", body, "");
}
for (const [title, entries] of sections) {
  index.push(`## ${title}`, "");
  for (const doc of entries)
    index.push(
      `- [${doc.title}](https://glyphcss.com/docs/${doc.slug || "index"}.md)`,
    );
  index.push("");
}
index.push(
  "## Source",
  "",
  "- GitHub: https://github.com/apresmoi/glyphcss",
  "- License: MIT",
  "",
);
writeFileSync(join(dist, "llms.txt"), index.join("\n"));
writeFileSync(join(dist, "llms-full.txt"), full.join("\n"));
console.log(
  `Generated llms.txt, llms-full.txt and ${docs.length} readable Markdown twins.`,
);
