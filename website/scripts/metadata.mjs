import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const websiteRoot = fileURLToPath(new URL("../", import.meta.url));
const docsRoot = path.join(websiteRoot, "src/content/docs");

export function readDocs(dir = docsRoot, root = dir) {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) return readDocs(file, root);
      if (!/\.mdx?$/.test(entry.name)) return [];
      const source = readFileSync(file, "utf8");
      const frontmatter =
        source.match(/^---\r?\n([\s\S]*?)\r?\n---/u)?.[1] ?? "";
      const value = (key) =>
        frontmatter
          .match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1]
          .trim()
          .replace(/^(['"])(.*)\1$/, "$2");
      const slug =
        value("slug") ??
        path
          .relative(root, file)
          .replace(/\\/g, "/")
          .replace(/\.mdx?$/, "")
          .replace(/(^|\/)index$/, "");
      const relative = path.relative(root, file).replace(/\\/g, "/");
      const section = slug.includes("/")
        ? slug.split("/")[0]
        : relative.includes("/")
          ? relative.split("/")[0]
          : "getting started";
      return [{ file, source, slug, section, title: value("title") ?? slug }];
    })
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

const builtAt = new Date().toISOString();
let docs;
export function sitemapLastmod(url) {
  const slug = new URL(url).pathname.replace(/^\/|\/$/g, "");
  docs ??= readDocs();
  const doc = docs.find((entry) => entry.slug === slug);
  const candidates = doc
    ? [doc.file]
    : [
        path.join(
          websiteRoot,
          "src/pages",
          slug ? `${slug}.astro` : "index.astro",
        ),
        path.join(websiteRoot, "src/pages", slug, "index.astro"),
      ];
  const file = candidates.find((candidate) => existsSync(candidate));
  if (!file) return builtAt;
  try {
    const date = execFileSync(
      "git",
      ["log", "-1", "--format=%cI", "--", file],
      {
        cwd: websiteRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    ).trim();
    return date || builtAt;
  } catch {
    // Source archives have no Git history; their build date remains truthful.
    return builtAt;
  }
}

export function cleanMarkdown(source) {
  const saved = [];
  let body = source.replace(/^---\r?\n[\s\S]*?\r?\n---\s*\n/u, "");
  // Preserve code verbatim before removing MDX syntax, including JSX examples.
  body = body.replace(
    /^([ \t]*)(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1\2[ \t]*(?=\r?$)/gm,
    (code) => `\u0000${saved.push(code) - 1}\u0000`,
  );
  body = body.replace(
    /(`+)[^\n]*?\1/g,
    (code) => `\u0000${saved.push(code) - 1}\u0000`,
  );
  body = body.replace(
    /^import\s+(?:[\s\S]*?\s+from\s+)?(['"])[^'"\n]+\1;?[ \t]*\r?\n/gm,
    "",
  );
  body = body.replace(
    /<\/?[A-Z][\w.:]*(?:\s+(?:[^<>"'{}]|"[^"]*"|'[^']*'|\{[^}]*\})*)?\s*\/?>/g,
    "",
  );
  body = body.replace(/\n[ \t]+\n/g, "\n\n").replace(/\n{3,}/g, "\n\n");
  return (
    body
      .replace(/\u0000(\d+)\u0000/g, (_, index) => saved[Number(index)])
      .trim() + "\n"
  );
}
