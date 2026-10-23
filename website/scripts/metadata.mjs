import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import ts from "typescript";

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

let docsRenderer;
async function loadDocsRenderer() {
  // Bundle the shared TypeScript adapter for Node versions without type stripping.
  docsRenderer ??= (async () => {
    const require = createRequire(new URL("../package.json", import.meta.url));
    const result = await build({
      entryPoints: [
        path.join(websiteRoot, "src/services/docs-render/glyphRender.ts"),
      ],
      bundle: true,
      write: false,
      platform: "node",
      format: "esm",
      plugins: [
        {
          name: "workspace-exports",
          setup(builder) {
            builder.onResolve(
              { filter: /^@glyphcss\// },
              ({ path: specifier }) => ({
                path: pathToFileURL(require.resolve(specifier)).href,
                external: true,
              }),
            );
          },
        },
      ],
    });
    return import(
      /* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
    );
  })();
  return docsRenderer;
}

function literalValue(node) {
  if (ts.isParenthesizedExpression(node)) return literalValue(node.expression);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (
    ts.isPrefixUnaryExpression(node) &&
    node.operator === ts.SyntaxKind.MinusToken
  )
    return -literalValue(node.operand);
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(literalValue);
  if (ts.isObjectLiteralExpression(node)) {
    return Object.fromEntries(
      node.properties.map((property) => {
        if (
          !ts.isPropertyAssignment(property) ||
          ts.isComputedPropertyName(property.name)
        )
          throw new Error("GlyphRender props must use literal properties.");
        return [property.name.text, literalValue(property.initializer)];
      }),
    );
  }
  if (ts.isTemplateExpression(node)) {
    return (
      node.head.text +
      node.templateSpans
        .map(
          (span) => String(literalValue(span.expression)) + span.literal.text,
        )
        .join("")
    );
  }
  throw new Error("GlyphRender props must be static literals.");
}

function openingComponent(source) {
  const file = ts.createSourceFile(
    "example.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let opening;
  function visit(node) {
    if (opening) return;
    if (
      (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) &&
      node.getStart(file) === 0
    ) {
      opening = node;
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  if (!opening || !source.slice(0, opening.end).endsWith(">"))
    throw new Error("Unclosed MDX component.");
  return opening;
}

function fenced(value, language) {
  const fence = "`".repeat(
    Math.max(
      3,
      ...[...value.matchAll(/`+/g)].map((match) => match[0].length + 1),
    ),
  );
  return `${fence}${language}\n${value}\n${fence}`;
}

export async function cleanMarkdown(source) {
  const saved = [];
  let body = source.replace(/^---\r?\n[\s\S]*?\r?\n---\s*\n/u, "");
  // Preserve code verbatim before removing MDX syntax, including JSX examples.
  body = body.replace(
    /^([ \t]*)(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1\2[ \t]*(?=\r?$)/gm,
    (code) => `\u0000${saved.push(code) - 1}\u0000`,
  );
  body = body.replace(
    /^import\s+(?:[\s\S]*?\s+from\s+)?(['"])[^'"\n]+\1;?[ \t]*\r?\n/gm,
    "",
  );
  // Consume JSX before looking for inline code: template backticks inside props
  // belong to JavaScript, while backticks before a tag protect Markdown examples.
  const tokens = /(`+)|<\/?([A-Z][\w.:]*)\b/g;
  let cursor = 0;
  let cleaned = "";
  for (let match; (match = tokens.exec(body)); ) {
    cleaned += body.slice(cursor, match.index);
    let end;
    let replacement = "";
    if (match[1]) {
      const code = body.slice(match.index).match(/^(`+)[^\n]*?\1/);
      end = match.index + (code?.[0].length ?? match[0].length);
      replacement = body.slice(match.index, end);
    } else if (match[0].startsWith("</")) {
      end = body.indexOf(">", tokens.lastIndex) + 1;
      if (!end) throw new Error("Unclosed MDX closing tag.");
    } else {
      const opening = openingComponent(body.slice(match.index));
      end = match.index + opening.end;
      if (match[2] === "GlyphRender") {
        if (!ts.isJsxSelfClosingElement(opening))
          throw new Error("GlyphRender must be self-closing.");
        const input = {};
        for (const attribute of opening.attributes.properties) {
          if (!ts.isJsxAttribute(attribute))
            throw new Error("GlyphRender cannot spread props.");
          if (!["kind", "source", "options"].includes(attribute.name.text))
            continue;
          const value = attribute.initializer;
          input[attribute.name.text] = literalValue(
            ts.isJsxExpression(value) ? value.expression : value,
          );
        }
        if (!input.kind || input.source === undefined)
          throw new Error("GlyphRender requires kind and source.");
        const {
          normalizeGlyphDocsSource,
          renderGlyphDocs,
          fitGlyphDocsOutput,
        } = await loadDocsRenderer();
        const example =
          typeof input.source === "string"
            ? normalizeGlyphDocsSource(input.source)
            : JSON.stringify(input.source, null, 2);
        const language = typeof input.source === "string" ? "mermaid" : "json";
        const output = fitGlyphDocsOutput(
          await renderGlyphDocs(input),
          input.options?.textScale,
        );
        replacement = `\n\n${fenced(example, language)}\n\n${fenced(output.text, "text")}\n\n`;
      }
    }
    if (replacement) cleaned += `\u0000${saved.push(replacement) - 1}\u0000`;
    cursor = end;
    tokens.lastIndex = end;
  }
  body = cleaned + body.slice(cursor);
  body = body.replace(/\n[ \t]+\n/g, "\n\n").replace(/\n{3,}/g, "\n\n");
  return (
    body
      .replace(/\u0000(\d+)\u0000/g, (_, index) => saved[Number(index)])
      .trim() + "\n"
  );
}
