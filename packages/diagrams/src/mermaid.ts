import type { GlyphGraph, GlyphGraphDirection, GlyphGraphEdge, GlyphGraphEdgeStyle, GlyphGraphGroup, GlyphGraphNode, GlyphGraphNodeShape } from "./types";
import { glyphDiagramError, validateGlyphGraph } from "./validate";

function syntax(message: string): never { return glyphDiagramError("GLYPH_MERMAID_SYNTAX", message); }

/** Quotes and shape brackets protect labels from statement separators. */
function statements(source: string): string[] {
  const output: string[] = [];
  let current = "";
  let quote = "";
  const brackets: string[] = [];
  for (let index = 0; index < source.length; index++) {
    const char = source[index]!;
    if (quote) {
      current += char;
      if (char === "\\" && index + 1 < source.length) current += source[++index];
      else if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || (char === "'" && /[\s[(|{]/.test(source[index - 1] ?? " "))) { quote = char; current += char; continue; }
    if (char === "%" && source[index + 1] === "%" && brackets.length === 0) {
      if (source[index + 2] === "{") {
        const end = source.indexOf("}%%", index + 3);
        if (end < 0) syntax("Unclosed Mermaid init directive.");
        index = end + 2;
      } else {
        while (index + 1 < source.length && source[index + 1] !== "\n") index++;
      }
      continue;
    }
    if (char === ">" && brackets.length === 0 && /[\p{L}\p{N}_.]\s*$/u.test(current)) brackets.push("]");
    else if (char === "(" && source[index - 1] === ">" && brackets[brackets.length - 1] === "]") { /* >( opens the same asymmetric shape. */ }
    else if ("[({".includes(char)) brackets.push({ "[": "]", "(": ")", "{": "}" }[char]!);
    else if ("])}".includes(char)) {
      if (brackets[brackets.length - 1] === char) brackets.pop();
      // Mermaid's asymmetric node opens with > and closes with ].
      else if (!(char === "]" && brackets.length === 0)) syntax(`Unmatched "${char}" in Mermaid source.`);
    }
    if ((char === ";" || char === "\n" || char === "\r") && brackets.length === 0) {
      if (current.trim()) output.push(current.trim());
      current = "";
    } else current += char;
  }
  if (quote || brackets.length) syntax("Unclosed quoted label or node shape.");
  if (current.trim()) output.push(current.trim());
  return output;
}

function labelText(input: string): string {
  let text = input.trim();
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) text = text.slice(1, -1);
  // LangGraph emits paragraph markup inside stadium nodes. Decode only text;
  // styling, links, and Mermaid click statements never become DOM or code.
  text = text.replace(/<br\s*\/?\s*>/gi, "\n").replace(/<\/?(?:p|b|strong|i|em|span)(?:\s[^>]*?)?\s*>/gi, "");
  return text.replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi, (entity) => {
    const value = entity.slice(1, -1).toLowerCase();
    const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
    if (named[value] !== undefined) return named[value]!;
    const point = value.startsWith("#x") ? Number.parseInt(value.slice(2), 16) : Number.parseInt(value.slice(1), 10);
    return point >= 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : entity;
  }).replace(/\\(["'\\])/g, "$1");
}

const SHAPES: readonly { open: string; close: string; shape: GlyphGraphNodeShape }[] = [
  { open: "([", close: "])", shape: "stadium" },
  { open: "((", close: "))", shape: "circle" },
  { open: "[[", close: "]]", shape: "subroutine" },
  { open: "[", close: "]", shape: "rect" },
  { open: "(", close: ")", shape: "rounded" },
  { open: "{", close: "}", shape: "diamond" },
  { open: ">(", close: "]", shape: "asymmetric" },
  { open: ">", close: "]", shape: "asymmetric" },
];

class GlyphMermaidStatement {
  private position = 0;
  constructor(private readonly source: string) {}
  get rest(): string { return this.source.slice(this.position).trimStart(); }
  private whitespace(): void { this.position += this.source.slice(this.position).length - this.rest.length; }
  private consume(value: string): boolean {
    this.whitespace();
    if (!this.source.startsWith(value, this.position)) return false;
    this.position += value.length;
    return true;
  }
  private until(close: string): string {
    const start = this.position;
    let quote = "";
    while (this.position < this.source.length) {
      const char = this.source[this.position]!;
      if (quote) {
        if (char === "\\") this.position++;
        else if (char === quote) quote = "";
      } else if (char === '"' || (char === "'" && /[\s[(|{]/.test(this.source[this.position - 1] ?? " "))) quote = char;
      else if (this.source.startsWith(close, this.position)) {
        const value = this.source.slice(start, this.position);
        this.position += close.length;
        return value;
      }
      this.position++;
    }
    return syntax(`Missing "${close}" in "${this.source}".`);
  }
  node(): { node: GlyphGraphNode; declared: boolean } {
    this.whitespace();
    const match = /^[\p{L}\p{N}_](?:[\p{L}\p{N}_.]|:(?!:)|-(?=[\p{L}\p{N}_]))*/u.exec(this.rest);
    if (!match) syntax(`Expected a node id near "${this.rest}".`);
    const id = match[0];
    this.position += id.length;
    let label = id;
    let shape: GlyphGraphNodeShape | undefined;
    this.whitespace();
    for (const candidate of SHAPES) {
      if (!this.source.startsWith(candidate.open, this.position)) continue;
      this.position += candidate.open.length;
      label = labelText(this.until(candidate.close));
      shape = candidate.shape;
      break;
    }
    if (this.consume(":::")) {
      const classes = /^[\w,-]+/.exec(this.rest);
      if (!classes) syntax(`Expected a class name after node "${id}".`);
      this.position += classes[0].length;
    }
    return { node: { id, label, ...(shape ? { shape } : {}) }, declared: shape !== undefined };
  }
  nodeSet(): ReturnType<GlyphMermaidStatement["node"]>[] {
    const nodes = [this.node()];
    while (this.consume("&")) nodes.push(this.node());
    return nodes;
  }
  edge(): { style: GlyphGraphEdgeStyle; label?: string } {
    let style: GlyphGraphEdgeStyle;
    let label: string | undefined;
    if (this.consume("-.->")) style = "dotted";
    else if (this.consume("==>")) style = "thick";
    else if (this.consume("-->")) style = "solid";
    else if (this.consume("---")) style = "undirected";
    else if (this.consume("-.")) { style = "dotted"; label = labelText(this.until(".->")); }
    else if (this.consume("--")) { style = "solid"; label = labelText(this.until("-->")); }
    else if (this.consume("==")) { style = "thick"; label = labelText(this.until("==>")); }
    else return syntax(`Unsupported edge operator near "${this.rest}".`);
    if (this.consume("|")) label = labelText(this.until("|"));
    return { style, ...(label !== undefined ? { label } : {}) };
  }
}

export function glyphGraphFromMermaid(source: string): GlyphGraph {
  if (typeof source !== "string") syntax("Mermaid source must be a string.");
  // Identify the grammar before tokenizing its body: an unsupported kind's
  // delimiters need not obey flowchart syntax to earn its named rejection.
  const prefix = source.replace(/^\uFEFF/, "").replace(/^(?:\s|%%\{[\s\S]*?\}%%|%%[^\n]*(?:\n|$))*/, "");
  const declaredKind = /^[\w-]+/.exec(prefix)?.[0];
  if (declaredKind && declaredKind !== "flowchart" && declaredKind !== "graph") glyphDiagramError(`GLYPH_MERMAID_UNSUPPORTED_${declaredKind.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`, `Mermaid ${declaredKind} is not supported; use flowchart or graph.`);
  const parts = statements(source.replace(/^\uFEFF/, ""));
  const header = parts.shift();
  if (!header) syntax("Mermaid source is empty.");
  const kind = /^[\w-]+/.exec(header)?.[0];
  if (!kind) syntax("Expected a flowchart or graph declaration.");
  if (kind !== "flowchart" && kind !== "graph") glyphDiagramError(`GLYPH_MERMAID_UNSUPPORTED_${kind.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`, `Mermaid ${kind} is not supported; use flowchart or graph.`);
  const declaration = /^(?:flowchart|graph)\s+(TB|TD|LR|BT|RL)(?:\s+([\s\S]+))?$/.exec(header);
  if (!declaration) syntax("Use flowchart/graph with direction TB, TD, LR, BT, or RL.");
  const direction = (declaration[1] === "TD" ? "TB" : declaration[1]) as GlyphGraphDirection;
  if (declaration[2]) parts.unshift(declaration[2]);
  const nodes = new Map<string, GlyphGraphNode>();
  const edges: GlyphGraphEdge[] = [];
  const groups = new Map<string, { id: string; label?: string; members: string[] }>();
  const activeGroups: string[] = [];

  const addNode = ({ node, declared }: ReturnType<GlyphMermaidStatement["node"]>): string => {
    const previous = nodes.get(node.id);
    const group = activeGroups[activeGroups.length - 1];
    const owner = group && (declared || !previous?.group || activeGroups.includes(previous.group)) ? group : previous?.group;
    nodes.set(node.id, { ...(previous && !declared ? previous : { ...previous, ...node }), ...(owner ? { group: owner } : {}) });
    // A previously declared node referenced inside a subgraph is still a member.
    for (const id of activeGroups) {
      const members = groups.get(id)!.members;
      if (!members.includes(node.id)) members.push(node.id);
    }
    return node.id;
  };

  for (const statement of parts) {
    // These directives are accepted as inert source data. In particular click
    // URLs/callbacks are never dereferenced, even on a web render target.
    if (/^(?:classDef|class|style|click)\s+\S/.test(statement)) continue;
    if (statement === "end") {
      if (!activeGroups.pop()) syntax("subgraph end has no matching subgraph.");
      continue;
    }
    if (/^subgraph\b/.test(statement)) {
      const body = statement.replace(/^subgraph\s*/, "");
      if (!body) syntax("subgraph requires an id or label.");
      let id: string;
      let label: string;
      const explicit = /^([\w.-]+)\s*\[([\s\S]*)\]$/.exec(body);
      if (explicit) { id = explicit[1]!; label = labelText(explicit[2]!); }
      else { id = labelText(body); label = id; }
      if (!id.trim() || groups.has(id)) syntax(`subgraph id "${id}" must be non-empty and unique.`);
      groups.set(id, { id, label, members: [] });
      activeGroups.push(id);
      continue;
    }
    if (/^direction\s+(?:TB|TD|LR|BT|RL)$/.test(statement) && activeGroups.length) continue;
    const cursor = new GlyphMermaidStatement(statement);
    let from = cursor.nodeSet().map(addNode);
    while (cursor.rest) {
      const edge = cursor.edge();
      const to = cursor.nodeSet().map(addNode);
      for (const sourceId of from) for (const targetId of to) edges.push({ from: sourceId, to: targetId, ...edge });
      from = to;
    }
  }
  if (activeGroups.length) syntax(`Unclosed subgraph "${activeGroups[activeGroups.length - 1]}".`);
  return validateGlyphGraph({ nodes: [...nodes.values()], edges, ...(groups.size ? { groups: [...groups.values()] as GlyphGraphGroup[] } : {}), direction });
}
