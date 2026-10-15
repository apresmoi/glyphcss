import { labelText, skipMermaidComment } from "./mermaidText";
import { glyphDiagramError } from "./validate";

/** Keep indentation and quoted newlines; configuration remains data, never code. */
export function glyphMermaidTreeDocument(source: string, singleQuotes = true): { body: string; config: string } {
  let body = source.replace(/^\uFEFF/, ""), config = "";
  body = body.replace(/^\s*---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/, (_, value: string) => { config += value; return ""; });
  let text = "", quote = "";
  for (let i = 0; i < body.length; i++) {
    const char = body[i]!;
    if (quote) {
      text += char;
      if (char === "\\" && i + 1 < body.length) text += body[++i];
      else if (char === quote) quote = "";
    } else if (char === '"' || singleQuotes && char === "'" && /[\s:]/.test(body[i - 1] ?? " ")) { quote = char; text += char; }
    else if (char === "%" && body[i + 1] === "%") {
      const end = skipMermaidComment(body, i);
      if (body[i + 2] === "{") config += `\n${body.slice(i, end + 1)}`;
      text += body.slice(i, end + 1).replace(/[^\r\n]/g, " "); i = end;
    } else text += char;
  }
  if (quote) glyphDiagramError("GLYPH_MERMAID_SYNTAX", "Unclosed Mermaid quoted string.");
  return { body: text, config };
}

export function glyphMermaidTreeStatements(body: string, semicolons = true, singleQuotes = true): string[] {
  const lines: string[] = []; let current = "", quote = "";
  for (let i = 0; i < body.length; i++) {
    const char = body[i]!;
    if (quote) {
      current += char;
      if (char === "\\" && i + 1 < body.length) current += body[++i];
      else if (char === quote) quote = "";
    } else if (char === '"' || singleQuotes && char === "'" && /[\s:]/.test(body[i - 1] ?? " ")) { quote = char; current += char; }
    else if (char === "\n" || char === "\r" || (semicolons && char === ";")) { if (current.trim()) lines.push(current); current = ""; }
    else current += char;
  }
  if (current.trim()) lines.push(current);
  return lines;
}

export function glyphMermaidGitConfig(config: string, key: string): string | undefined {
  const match = new RegExp(`(?:["']?${key}["']?)\\s*:\\s*("(?:\\\\.|[^"\\\\])*"|'[^']*'|[^,}\\r\\n]+)`).exec(config);
  return match ? labelText(/^["']/.test(match[1]!) ? match[1]! : match[1]!.replace(/\s+#.*$/, "")) : undefined;
}
