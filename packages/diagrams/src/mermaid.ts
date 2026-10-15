import type { GlyphGraph, GlyphGraphDirection, GlyphGraphEdge, GlyphGraphEdgeStyle, GlyphGraphEdgeHead, GlyphGraphGroup, GlyphGraphNode, GlyphGraphNodeShape } from "./types";
import { glyphDiagramError, validateGlyphGraph } from "./validate";
import { labelText, skipMermaidComment, GLYPH_MERMAID_ENTITY } from "./mermaidText";
import type { GlyphDiagramLedgerEntry } from "./ledger";
import { glyphMermaidShape } from "./mermaidShapes";
import { ledgerMermaidDegraded } from "./ledger";
import { glyphParseMermaidGit, type GlyphMermaidGitLanes } from "./mermaidGit";
import { glyphParseMermaidMindmap } from "./mermaidMindmap";
import { glyphParseMermaidState } from "./mermaidState";

function syntax(message: string): never { return glyphDiagramError("GLYPH_MERMAID_SYNTAX", message); }

const EDGE_OPERATOR = /^([<ox]?)(-{2,}[>ox]|-{3,}|-\.+-[>ox]?|={2,}[>ox]|={3,}|~{3,})/;
const EDGE_TEXT_OPEN = /^([<ox]?)(--|==|-\.)/;

/** Separators inside quoted labels, shapes, metadata and link text are literal. */
function statements(source: string): string[] {
  const output: string[] = [];
  let current = "";
  let quote = "";
  const brackets: string[] = [];
  let edgeText = "";
  let pipe = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index]!;
    if (quote) {
      current += char;
      if (char === "\\" && index + 1 < source.length) current += source[++index];
      else if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || (char === "'" && /[\s[(|{:]/.test(source[index - 1] ?? " "))) { quote = char; current += char; continue; }
    if (edgeText) {
      // A decoded HTML entity's own literal ";" (e.g. inside "&nbsp;") is not
      // a statement separator; recognize and consume the whole entity so the
      // terminator check below only ever sees a REAL one.
      if (char === "&" || char === "#") {
        const entity = GLYPH_MERMAID_ENTITY.exec(source.slice(index));
        if (entity?.index === 0) { current += entity[0]; index += entity[0].length - 1; continue; }
      }
      if ((char === ";" || char === "\n" || char === "\r") && brackets.length === 0) syntax(`Missing ".->" in "${current.trim()}".`);
      current += char;
      const close = (edgeText === "." ? /^\.+-[>ox]?/ : edgeText === "=" ? /^={2,}[>ox]|^={3,}/ : /^-{2,}[>ox]|^-{3,}/).exec(source.slice(index));
      if (close) {
        current += close[0].slice(1);
        index += close[0].length - 1;
        edgeText = "";
      }
      continue;
    }
    if (pipe) {
      current += char;
      if (char === "|") pipe = false;
      continue;
    }
    if (char === "%" && source[index + 1] === "%" && brackets.length === 0) { index = skipMermaidComment(source, index); continue; }
    const textOpening = !EDGE_OPERATOR.test(source.slice(index)) && EDGE_TEXT_OPEN.exec(source.slice(index));
    if (textOpening && brackets.length === 0 && !/[=~-]/.test(source[index - 1] ?? "")) {
      edgeText = textOpening[2] === "-." ? "." : textOpening[2]![0]!;
      current += textOpening[0]; index += textOpening[0].length - 1; continue;
    }
    if (char === "|" && brackets.length === 0) { pipe = true; current += char; continue; }
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
  if (edgeText) syntax(`Missing ".->" in "${current.trim()}".`);
  if (quote || brackets.length || pipe) syntax("Unclosed quoted label, node shape, edge text, or edge label.");
  if (current.trim()) output.push(current.trim());
  return output;
}

const SHAPES: readonly { open: string; close: string | readonly string[]; shape: GlyphGraphNodeShape }[] = [
  { open: "(((", close: ")))", shape: "circle" },
  { open: "[(", close: ")]", shape: "cylinder" },
  { open: "[/", close: ["/]", "\\]"], shape: "rect" },
  { open: "[\\", close: ["\\]", "/]"], shape: "rect" },
  { open: "{{", close: "}}", shape: "rect" },
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
  private closedWith = "";
  constructor(private readonly source: string, private readonly note: (kind: string, message: string) => void, private readonly edgeIds: Set<string>) {}
  get rest(): string { return this.source.slice(this.position).trimStart(); }
  private whitespace(): void { this.position += this.source.slice(this.position).length - this.rest.length; }
  private consume(value: string): boolean {
    this.whitespace();
    if (!this.source.startsWith(value, this.position)) return false;
    this.position += value.length;
    return true;
  }
  private until(close: string | readonly string[]): string {
    const closers = typeof close === "string" ? [close] : close;
    const start = this.position;
    let quote = "";
    while (this.position < this.source.length) {
      const char = this.source[this.position]!;
      if (quote) {
        if (char === "\\") this.position++;
        else if (char === quote) quote = "";
      } else if (char === '"' || (char === "'" && /[\s[(|{:]/.test(this.source[this.position - 1] ?? " "))) quote = char;
      else {
        const end = closers.find((value) => this.source.startsWith(value, this.position));
        if (end) {
          const value = this.source.slice(start, this.position);
          this.position += end.length;
          this.closedWith = end;
          return value;
        }
      }
      this.position++;
    }
    return syntax(`Missing "${closers.join(" or ")}" in "${this.source}".`);
  }
  properties(): Record<string, string> {
    if (!this.consume("@{")) syntax(`Expected properties near "${this.rest}".`);
    const body = this.until("}");
    const properties: Record<string, string> = Object.create(null);
    const field = /([\w-]+)\s*:\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^,\n]+)\s*(?:,|$)/g;
    for (const match of body.matchAll(field)) properties[match[1]!] = labelText(match[2]!);
    return properties;
  }
  node(): { node: GlyphGraphNode; declared: boolean; labelDeclared: boolean; properties?: Record<string, string> } {
    this.whitespace();
    const match = /^[\p{L}\p{N}_](?:[\p{L}\p{N}_.]|:(?!:)|-(?=[\p{L}\p{N}_]))*/u.exec(this.rest);
    if (!match) syntax(`Expected a node id near "${this.rest}".`);
    const id = match[0];
    this.position += id.length;
    let label = id;
    let shape: GlyphGraphNodeShape | undefined;
    this.whitespace();
    let declared = false, labelDeclared = false;
    let properties: Record<string, string> | undefined;
    for (const candidate of SHAPES) {
      if (!this.source.startsWith(candidate.open, this.position)) continue;
      this.position += candidate.open.length;
      label = labelText(this.until(candidate.close));
      shape = candidate.shape;
      declared = true; labelDeclared = true;
      const fallback = candidate.open === "{{" ? "hex" : candidate.open === "(((" ? "dbl-circ" : candidate.open === "[/" ? this.closedWith === "\\]" ? "trap-b" : "lean-r" : candidate.open === "[\\" ? this.closedWith === "/]" ? "trap-t" : "lean-l" : undefined;
      if (fallback) this.note(`shape:${fallback}`, `Rendered Mermaid ${fallback} with the approved ${shape} family.`);
      break;
    }
    if (this.rest.startsWith("@{")) {
      const props = properties = this.properties();
      const name = props.icon !== undefined ? "icon" : props.img !== undefined ? "image" : props.shape;
      if (name) {
        const family = glyphMermaidShape(name);
        shape = family.shape;
        if (name === "icon") shape = props.form === "circle" ? "circle" : props.form === "rounded" ? "rounded" : "rect";
        if (family.fallback) this.note(`shape:${family.kind}`, `Rendered Mermaid ${family.kind} with the approved ${shape} family.`);
      }
      if (props.label !== undefined) { label = props.label; labelDeclared = true; }
      declared = true;
    }
    while (this.consume(":::")) {
      const classes = /^[\w,-]+/.exec(this.rest);
      if (!classes) syntax(`Expected a class name after node "${id}".`);
      this.position += classes[0].length;
    }
    return { node: { id, label, ...(shape ? { shape } : {}) }, declared, labelDeclared, ...(properties ? { properties } : {}) };
  }
  nodeSet(): ReturnType<GlyphMermaidStatement["node"]>[] {
    const nodes = [this.node()];
    while (this.consume("&")) nodes.push(this.node());
    return nodes;
  }
  edge(): Omit<GlyphGraphEdge, "from" | "to"> {
    this.whitespace();
    const edgeId = /^[\p{L}\p{N}_][\p{L}\p{N}_.-]*@(?=[<ox=~-])/u.exec(this.rest);
    if (edgeId) { this.edgeIds.add(edgeId[0].slice(0, -1)); this.position += edgeId[0].length; }
    const operator = EDGE_OPERATOR.exec(this.rest);
    let token: string, start = "", label: string | undefined;
    if (operator) {
      start = operator[1]!; token = operator[2]!;
      this.position += operator[0].length;
    } else {
      const opening = EDGE_TEXT_OPEN.exec(this.rest);
      if (!opening) return syntax(`Unsupported edge operator near "${this.rest}".`);
      start = opening[1]!;
      this.position += opening[0].length;
      const tail = this.rest;
      const closing = opening[2] === "-." ? /\.+-[>ox]?/ : opening[2] === "==" ? /={2,}[>ox]|={3,}/ : /-{2,}[>ox]|-{3,}/;
      // Quoted labels can contain operator-shaped text.
      let quote = "", end = -1, length = 0;
      for (let i = 0; i < tail.length; i++) {
        const char = tail[i]!;
        if (quote) { if (char === "\\") i++; else if (char === quote) quote = ""; continue; }
        if (char === '"' || (char === "'" && /[\s[(|{:]/.test(tail[i - 1] ?? " "))) { quote = char; continue; }
        const match = closing.exec(tail.slice(i));
        if (match?.index === 0) { end = i; length = match[0].length; break; }
      }
      if (end < 0) return syntax(`Missing edge terminator in "${this.source}".`);
      label = labelText(tail.slice(0, end));
      token = tail.slice(end, end + length);
      this.whitespace(); this.position += end + length;
    }
    if (this.consume("|")) label = labelText(this.until("|"));
    const invisible = token.startsWith("~");
    const dotted = token.includes("."), thick = token.startsWith("=");
    const last = token.slice(-1);
    const marker = (value: string): GlyphGraphEdgeHead => value === "<" || value === ">" ? "arrow" : value === "o" ? "circle" : value === "x" ? "cross" : "none";
    const startHead = marker(start), endHead = marker(last);
    const style: GlyphGraphEdgeStyle = dotted ? "dotted" : thick ? "thick" : endHead === "none" && startHead === "none" ? "undirected" : "solid";
    const length = dotted ? (token.match(/\./g)?.length ?? 1) : token.replace(/[>ox]$/, "").length - (endHead === "none" ? 2 : 1);
    if (length > 1) this.note("edge-length", "Longer Mermaid links use the renderer's compact spacing.");
    return { style, ...(label !== undefined && !invisible ? { label } : {}),
      ...(startHead !== "none" ? { startHead } : {}),
      ...(endHead === "circle" || endHead === "cross" || endHead === "none" && style !== "undirected" ? { endHead } : {}),
      ...(invisible ? { invisible: true } : {}) };
  }
}

export function glyphGraphFromMermaid(source: string): GlyphGraph { return glyphParseMermaid(source).graph; }

export function glyphParseMermaid(source: string): { graph: GlyphGraph; notes: GlyphDiagramLedgerEntry[]; lanes?: GlyphMermaidGitLanes } {
  const originalSource = source;
  const notes: GlyphDiagramLedgerEntry[] = [];
  const note = (kind: string, message: string) => { if (!notes.some(entry => entry.detail?.kind === kind)) notes.push(ledgerMermaidDegraded({ kind, message })); };
  if (typeof source !== "string") syntax("Mermaid source must be a string.");
  source = source.replace(/^\uFEFF/, "");
  if (/^\s*---\s*\n/.test(source)) {
    source = source.replace(/^\s*---\s*\n[\s\S]*?\n---\s*(?:\n|$)/, "");
    note("frontmatter", "Mermaid frontmatter is inert; render options control the diagram.");
  }
  // Identify the grammar before tokenizing its body: an unsupported kind's
  // delimiters need not obey flowchart syntax to earn its named rejection.
  const prefix = source.replace(/^\uFEFF/, "").replace(/^(?:\s|%%\{[\s\S]*?\}%%|%%[^\n]*(?:\n|$))*/, "");
  const declaredKind = /^[\w-]+/.exec(prefix)?.[0];
  if (declaredKind?.toLowerCase() === "gitgraph") return glyphParseMermaidGit(originalSource);
  if (declaredKind === "mindmap") return glyphParseMermaidMindmap(originalSource);
  if (declaredKind === "stateDiagram" || declaredKind === "stateDiagram-v2") return glyphParseMermaidState(source);
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
  const groups = new Map<string, { id: string; label?: string; members: string[]; parent?: string }>();
  const activeGroups: string[] = [];
  const edgeIds = new Set<string>();
  const declarations: { value: ReturnType<GlyphMermaidStatement["node"]>; scopes: string[]; standalone: boolean }[] = [];

  const addNode = ({ node, declared, labelDeclared }: ReturnType<GlyphMermaidStatement["node"]>, scopes: string[]): string => {
    const previous = nodes.get(node.id);
    const group = scopes[scopes.length - 1];
    const owner = group && (declared || !previous?.group || scopes.includes(previous.group)) ? group : previous?.group;
    nodes.set(node.id, { ...(previous && !declared ? previous : { ...previous, ...node, ...(previous && !labelDeclared ? { label: previous.label } : {}) }), ...(owner ? { group: owner } : {}) });
    // A previously declared node referenced inside a subgraph is still a member.
    for (const id of scopes) {
      const members = groups.get(id)!.members;
      if (!members.includes(node.id)) members.push(node.id);
    }
    return node.id;
  };

  for (const statement of parts) {
    // These directives are accepted as inert source data. In particular click
    // URLs/callbacks are never dereferenced, even on a web render target.
    if (/^(?:classDef|class|style|click|linkStyle)\s+\S/.test(statement)) {
      if (/\b(?:animate\s*:\s*true|animation\s*:)/.test(statement)) note("animation", "Mermaid animation is inert in cell diagrams.");
      continue;
    }
    if (/^acc(?:Title|Descr)\s*(?::|\{)/.test(statement)) { note("accessibility", "Mermaid accessibility metadata is inert in text output."); continue; }
    if (statement === "end") {
      if (!activeGroups.pop()) syntax("subgraph end has no matching subgraph.");
      continue;
    }
    if (/^subgraph\b/.test(statement)) {
      const body = statement.replace(/^subgraph\s*/, "");
      if (!body) syntax("subgraph requires an id or label.");
      let id: string;
      let label: string;
      const explicit = /^([\p{L}\p{N}_.-]+)\s*\[([\s\S]*)\]$/u.exec(body);
      if (explicit) { id = explicit[1]!; label = labelText(explicit[2]!); }
      else { id = labelText(body); label = id; }
      if (!id.trim() || groups.has(id)) syntax(`subgraph id "${id}" must be non-empty and unique.`);
      groups.set(id, { id, label, members: [], ...(activeGroups.length ? { parent: activeGroups[activeGroups.length - 1] } : {}) });
      activeGroups.push(id);
      continue;
    }
    if (/^direction\s+(?:TB|TD|LR|BT|RL)$/.test(statement) && activeGroups.length) { note("subgraph-direction", "Subgraphs inherit the diagram direction."); continue; }
    const cursor = new GlyphMermaidStatement(statement, note, edgeIds);
    const first = cursor.nodeSet();
    const record = (value: ReturnType<GlyphMermaidStatement["node"]>, standalone = false) => {
      declarations.push({ value, scopes: [...activeGroups], standalone });
      return value.node.id;
    };
    let from = first.map(value => record(value, first.length === 1 && !cursor.rest));
    while (cursor.rest) {
      const edge = cursor.edge();
      const to = cursor.nodeSet().map(value => record(value));
      for (const sourceId of from) for (const targetId of to) {
        edges.push({ from: sourceId, to: targetId, ...edge });
      }
      from = to;
    }
  }
  // Resolve properties only after parsed links have identified edge ids. Quoted
  // labels may contain operator-shaped text or property names without meaning it.
  for (const { value, scopes, standalone } of declarations) {
    if (standalone && value.properties && edgeIds.has(value.node.id)) {
      if (value.properties.animate === "true" || value.properties.animation !== undefined) note("animation", "Mermaid animation is inert in cell diagrams.");
      else note("edge-properties", "Mermaid edge properties are inert; edges use orthogonal routes.");
    } else addNode(value, scopes);
  }
  if (/"`[\s\S]*?`"/.test(source)) note("markdown", "Markdown strings render as plain text with line wrapping.");
  if (activeGroups.length) syntax(`Unclosed subgraph "${activeGroups[activeGroups.length - 1]}".`);
  // Group ids referenced as endpoints are not members, even when mentioned inside a frame.
  for (const group of groups.values()) group.members = group.members.filter(id => !groups.has(id));
  for (const group of groups.values()) if (!group.members.length) {
    nodes.set(group.id, { id: group.id, label: group.label ?? group.id, shape: "rect" });
    note("empty-subgraph", "Empty subgraphs render as labelled rectangles.");
  }
  // A parent is only recorded where the enclosing group lists exactly the same nodes, the one case it cannot be inferred.
  const nested = [...groups.values()].map(({ parent, ...group }) => parent !== undefined && groups.get(parent)!.members.length === group.members.length ? { ...group, parent } : group);
  // Group endpoints attach to real members, rather than inventing a node box with the frame's name.
  const attach = (id: string, end: "from" | "to") => {
    const members = groups.get(id)?.members;
    if (!members?.length) return id;
    nodes.delete(id);
    note("subgraph-edge", "Edges to subgraphs attach to their first or last member.");
    return end === "to" ? members[0]! : members[members.length - 1]!;
  };
  const connected = edges.map(edge => ({ ...edge, from: attach(edge.from, "from"), to: attach(edge.to, "to") }));
  const cleanGroups = nested.map(group => ({ ...group, members: group.members.filter(id => nodes.has(id)) })).filter(group => group.members.length);
  return { graph: validateGlyphGraph({ nodes: [...nodes.values()], edges: connected, ...(cleanGroups.length ? { groups: cleanGroups as GlyphGraphGroup[] } : {}), direction }), notes };
}

/** Source approximations join the render ledger; parsing is deterministic and has no side effects. */
export function glyphMermaidNotes(source: string): GlyphDiagramLedgerEntry[] { return glyphParseMermaid(source).notes; }
