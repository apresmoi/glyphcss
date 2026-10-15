import type { GlyphGraph, GlyphGraphDirection, GlyphGraphEdge, GlyphGraphEdgeHead, GlyphGraphGroup, GlyphGraphNode } from "./types";
import { glyphDiagramError, validateGlyphGraph } from "./validate";
import { GLYPH_MERMAID_ENTITY, labelText, skipMermaidComment } from "./mermaidText";
import { ledgerMermaidDegraded, type GlyphDiagramLedgerEntry } from "./ledger";

const QUOTED = String.raw`"(?:\\.|[^"\\])*"|\x60[^\x60]*\x60`;
// Upstream alphaNumToken includes MINUS, even as the first token of a name.
const ID = String.raw`(?:${QUOTED}|[\p{L}\p{N}\p{M}_-][\p{L}\p{N}\p{M}_.-]*)`;
const CLASS_REF = String.raw`${ID}(?:~[^~]*~)?`;
const CLASS_RELATION = new RegExp(String.raw`^(${CLASS_REF})\s*("[^"]*")?\s*(<\||\(\)|[<*o])?(--|\.\.)(\|>|\(\)|[>*o])?\s*("[^"]*")?\s*(${CLASS_REF})(?:\s*:\s*([\s\S]*))?$`, "u");
const ER_CARD = String.raw`(?:\|[o|]|\}[o|]|[o|][|{]|one or zero|zero or one|one or more|one or many|many\(1\)|1\+|zero or more|zero or many|many\(0\)|0\+|only one|1)`;
const ER_REF = String.raw`(?:${QUOTED}|[^\s"\x60{}\[\]:|]+)(?:\s*\[(?:${QUOTED}|[^\]]*)\])?`;
const ER_RELATION = new RegExp(String.raw`^(${ER_REF})\s*(${ER_CARD})\s*(--|\.\.|optionally to|to)\s*(${ER_CARD})\s*(${ER_REF})\s*:\s*([\s\S]*)$`, "u");

/** Braces in ER cardinalities are operator characters, not block delimiters. */
function statements(source: string, er: boolean, fail: (message: string) => never): string[] {
  const parts: string[] = [];
  let current = "", quote = "", square = 0;
  const flush = () => { if (current.trim()) parts.push(current.trim()); current = ""; };
  for (let i = 0; i < source.length; i++) {
    const char = source[i]!;
    if (quote) {
      current += char;
      if (char === "\\" && i + 1 < source.length) current += source[++i];
      else if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "`") { quote = char; current += char; continue; }
    if (char === "%" && source[i + 1] === "%") { i = skipMermaidComment(source, i); continue; }
    if (char === "&" || char === "#") {
      const entity = GLYPH_MERMAID_ENTITY.exec(source.slice(i));
      if (entity?.index === 0) { current += entity[0]; i += entity[0].length - 1; continue; }
    }
    if (char === "[") square++;
    if (char === "]") square--;
    const relationLabel = /(?:--|\.\.)[\s\S]*:/.test(current);
    const rightCardinality = er && /(?:--|\.\.|(?:optionally )?to)\s*[o|]$/.test(current);
    if (!square && !relationLabel && char === "{" && !rightCardinality) { current += char; flush(); continue; }
    if (!square && !relationLabel && char === "}" && !(er && /^[o|]/.test(source.slice(i + 1)))) { flush(); parts.push("}"); continue; }
    if (!square && /[\n\r;]/.test(char)) flush(); else current += char;
  }
  if (quote || square) fail("Unclosed quoted name or alias.");
  flush();
  return parts;
}

function plain(text: string): string {
  return labelText(text.startsWith("`") && text.endsWith("`") ? text.slice(1, -1) : text);
}

/** Class attachments are syntax only outside quoted text and before captions. */
function withoutClasses(text: string): string {
  let output = "", quote = "";
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (quote) {
      output += char;
      if (char === "\\" && i + 1 < text.length) output += text[++i];
      else if (char === quote) quote = "";
    } else if (char === '"' || char === "`") { quote = char; output += char; }
    else if (text.startsWith(":::", i)) {
      const attachment = /^:::[\w,-]+/.exec(text.slice(i));
      if (attachment) i += attachment[0].length - 1; else output += char;
    } else if (char === ":") return output + text.slice(i);
    else output += char;
  }
  return output;
}

interface RecordNode { id: string; label: string; annotations: string[]; fields: string[]; methods: string[]; group?: string }

/** Both notations lower to the same measured compartments and routed edges. */
export function glyphParseMermaidClassEr(source: string, er: boolean): { graph: GlyphGraph; notes: GlyphDiagramLedgerEntry[] } {
  const syntax = (message: string): never => glyphDiagramError(er ? "GLYPH_MERMAID_ER_SYNTAX" : "GLYPH_MERMAID_CLASS_SYNTAX", message);
  const notes: GlyphDiagramLedgerEntry[] = [];
  const note = (kind: string, message: string) => { if (!notes.some(entry => entry.detail?.kind === kind)) notes.push(ledgerMermaidDegraded({ kind, message })); };
  if (/^\s*---\s*\n/.test(source)) {
    source = source.replace(/^\s*---\s*\n[\s\S]*?\n---\s*(?:\n|$)/, "");
    note("frontmatter", "Mermaid frontmatter is inert; render options control the diagram.");
  }
  if (/%%\{/.test(source)) note("configuration", "Mermaid configuration is inert; render options control the diagram.");
  source = source.replace(/^\s*accDescr\s*\{[\s\S]*?\}/gm, "accDescr: inert");
  const parts = statements(source.replace(/^\uFEFF/, ""), er, syntax);
  const header = parts.shift() ?? "";
  const kind = er ? "erDiagram" : "classDiagram";
  if (!header.startsWith(kind)) syntax(`Expected ${kind}.`);
  if (header.slice(kind.length).trim()) parts.unshift(header.slice(kind.length).trim());
  const nodes = new Map<string, RecordNode>(), edges: GlyphGraphEdge[] = [];
  const groups = new Map<string, { id: string; label: string; members: string[]; parent?: string }>();
  const scopes: string[] = [];
  let direction: GlyphGraphDirection = "TB", body: RecordNode | undefined;
  let serial = 0;
  const join = (node: RecordNode) => {
    if (!node.group && scopes.length) node.group = scopes[scopes.length - 1];
    for (const id of scopes) { const group = groups.get(id)!; if (!group.members.includes(node.id)) group.members.push(node.id); }
  };
  const node = (text: string): RecordNode => {
    const match = er ? new RegExp(String.raw`^(${QUOTED}|[^\s\[\]]+)(?:\s*\[([\s\S]*)\])?$`, "u").exec(text.trim()) : undefined;
    const generic = !er ? /~.*~$/.exec(text)?.[0] : undefined;
    const id = plain(er ? match?.[1] ?? text : text.replace(/~.*~$/, ""));
    let record = nodes.get(id);
    if (!record) { record = { id, label: id, annotations: [], fields: [], methods: [] }; nodes.set(id, record); }
    if (er && match?.[2] !== undefined) record.label = erText(match[2]);
    if (generic) {
      record.label = id + generic;
      note("class-typography", "Static, abstract and generic member notation stays literal instead of underlining or italics.");
    }
    join(record);
    return record;
  };
  const annotation = (record: RecordNode, value: string) => { const text = value.trim(); if (!record.annotations.includes(text)) record.annotations.push(text); };
  const member = (record: RecordNode, text: string) => {
    if (/^<<[\s\S]*>>$/.test(text)) { annotation(record, text); return; }
    const value = plain(text);
    (value.includes("(") ? record.methods : record.fields).push(value);
    if (/\)[*$](?:\s|$)|[$*]$/.test(value) || /~[^~]+~/.test(value)) note("class-typography", "Static, abstract and generic member notation stays literal instead of underlining or italics.");
  };
  const erText = (text: string) => {
    const value = plain(text);
    const simplified = value.replace(/(\*\*|__)([\s\S]+?)\1/g, "$2").replace(/\x60([^\x60]+)\x60/g, "$1").replace(/(^|\s)[*_]([^*_]+)[*_](?=\s|$)/g, "$1$2");
    if (simplified !== value) note("markdown", "ER markdown formatting becomes plain text.");
    return simplified;
  };
  const attributes = (record: RecordNode, text: string) => {
    // Mermaid also permits several attribute pairs on one physical line.
    const word = String.raw`(?:\x60[^\x60]+\x60\??|[^\s"\x60]+)`;
    const pattern = new RegExp(String.raw`\s*(${word})\s+(${word})(?:\s+((?:PK|FK|UK)(?:\s*,\s*(?:PK|FK|UK))*))?(?:\s+("(?:\\.|[^"\\])*"))?`, "gy");
    let at = 0;
    while (at < text.length) {
      pattern.lastIndex = at;
      const match = pattern.exec(text);
      if (!match) syntax(`Expected an attribute type and name in "${text.slice(at)}".`);
      const [, type, name, keys, comment] = match!;
      record.fields.push(`${type!.replace(/^\x60([^\x60]+)\x60/, "$1")} ${plain(name!)}${keys ? ` ${keys.replace(/\s*,\s*/g, ",")}` : ""}${comment ? ` — ${erText(comment)}` : ""}`);
      at = pattern.lastIndex;
    }
  };
  const openGroup = (id: string, label: string, parent?: string) => {
    let group = groups.get(id);
    if (!group) { group = { id, label, members: [], ...(parent ? { parent } : {}) }; groups.set(id, group); }
    else group.label = label;
    scopes.push(id);
  };
  const marker = (text: string | undefined): GlyphGraphEdgeHead => text === "<|" || text === "|>" ? "triangle" : text === "*" ? "filled-diamond" : text === "o" ? "open-diamond" : text === "()" ? "circle" : text === "<" || text === ">" ? "arrow" : "none";
  const cardinality = (text: string): GlyphGraphEdgeHead => /^(?:\|o|o\||one or zero|zero or one)$/.test(text) ? "er-zero-one"
    : /^(?:\|\||only one|1)$/.test(text) ? "er-one" : /^(?:\}o|o\{|zero or (?:more|many)|many\(0\)|0\+)$/.test(text) ? "er-zero-many" : "er-many";

  for (let statement of parts) {
    if (body) {
      if (statement === "}") { body = undefined; continue; }
      if (er) attributes(body, statement); else member(body, statement);
      continue;
    }
    if (/^(?:classDef|style|cssClass|click|link|callback|linkStyle)\b/.test(statement) || er && /^class\s/.test(statement)) {
      note("styling", "Mermaid styles and interactions are inert; no callbacks or URLs are executed."); continue;
    }
    if (/^acc(?:Title|Descr)\s*:/.test(statement)) { note("accessibility", "Mermaid accessibility metadata is inert in text output."); continue; }
    if (/^direction\s+(TB|TD|BT|LR|RL)$/.test(statement)) {
      const value = statement.split(/\s+/)[1]!;
      if (scopes.length && er) note("subgraph-direction", "Subgraphs inherit the diagram direction.");
      else direction = (value === "TD" ? "TB" : value) as GlyphGraphDirection;
      continue;
    }
    if (statement === "}" || er && statement === "end") {
      if (!scopes.pop()) syntax("A group closing has no matching group.");
      continue;
    }
    let match: RegExpExecArray | null;
    if (!er && (match = new RegExp(String.raw`^namespace\s+(${ID})(?:\s*\[([\s\S]*)\])?\s*\{$`, "u").exec(statement))) {
      const parent = scopes[scopes.length - 1];
      const name = plain(match[1]!);
      const segments = name.split(".");
      let up = parent;
      // Intermediate namespaces stay open only logically; one authored } closes one block.
      const opened: string[] = [];
      for (let i = 0; i < segments.length; i++) {
        const id = `${parent ? `${parent}.` : "namespace:"}${segments.slice(0, i + 1).join(".")}`;
        openGroup(id, i === segments.length - 1 && match[2] !== undefined ? plain(match[2]) : segments[i]!, up);
        opened.push(id); up = id;
      }
      scopes.splice(scopes.length - opened.length, opened.length, opened[opened.length - 1]!);
      continue;
    }
    if (er && (match = new RegExp(String.raw`^subgraph\s+(${ID})(?:\s*\[([\s\S]*)\])?$`, "u").exec(statement))) {
      openGroup(`subgraph:${plain(match[1]!)}`, plain(match[2] ?? match[1]!), scopes[scopes.length - 1]); continue;
    }
    if (!er && (match = new RegExp(String.raw`^note(?:\s+for\s+(${CLASS_REF}))?\s+("[\s\S]*")$`, "u").exec(statement))) {
      const text = plain(match[2]!).replace(/\\n/g, "\n");
      if (match[1]) node(match[1]).fields.push(`Note: ${text}`);
      else {
        let id: string; do { id = `note:${++serial}`; } while (nodes.has(id));
        const record = node(id); record.label = "Note"; record.fields.push(text);
      }
      note("class-notes", "Class notes use member rows or a separate rectangle instead of floating note placement."); continue;
    }
    statement = withoutClasses(statement);
    if (!er && (match = CLASS_RELATION.exec(statement))) {
      const from = node(match[1]!).id, to = node(match[7]!).id;
      const cards = [match[2], match[6]].filter(Boolean);
      const label = cards.length ? [match[2] ? `[${plain(match[2])}]` : "", match[8] ? plain(match[8]) : "", match[6] ? `[${plain(match[6])}]` : ""].filter(Boolean).join(" ") : match[8] ? plain(match[8]) : "";
      edges.push({ from, to, startHead: marker(match[3]), endHead: marker(match[5]), style: match[4] === ".." ? "dotted" : "solid", ...(label ? { label } : {}) });
      if (cards.length) note("class-cardinality", "Multiplicity is included in square brackets in the relation caption, source first and target last, instead of floating at the ends.");
      if (match[3] === "()" || match[5] === "()") note("class-lollipop", "Lollipop interfaces use a circle endpoint on a named rectangle.");
      continue;
    }
    if (er && (match = ER_RELATION.exec(statement))) {
      edges.push({ from: node(match[1]!).id, to: node(match[5]!).id, startHead: cardinality(match[2]!), endHead: cardinality(match[4]!), style: match[3] === ".." || match[3] === "optionally to" ? "dotted" : "solid", label: erText(match[6]!) });
      continue;
    }
    if (!er && (match = new RegExp(String.raw`^class\s+(${CLASS_REF})(?:\s*\[([\s\S]*)\])?(?:\s*(<<[^>]*>>))?\s*(\{)?$`, "u").exec(statement))) {
      const record = node(match[1]!);
      if (match[2] !== undefined) record.label = erText(match[2]);
      if (match[3]) annotation(record, match[3]);
      if (match[4]) body = record;
      continue;
    }
    if (!er && (match = new RegExp(String.raw`^(<<[^>]*>>)\s+(${CLASS_REF})$`, "u").exec(statement))) { annotation(node(match[2]!), match[1]!); continue; }
    if (!er && (match = new RegExp(String.raw`^(${CLASS_REF})\s*:\s*([\s\S]*)$`, "u").exec(statement))) { member(node(match[1]!), match[2]!); continue; }
    if (er && (match = new RegExp(String.raw`^(${ER_REF})\s*(\{)?$`, "u").exec(statement))) { const record = node(match[1]!); if (match[2]) body = record; continue; }
    if (!er && (match = new RegExp(String.raw`^(${CLASS_REF})$`, "u").exec(statement))) { node(match[1]!); continue; }
    syntax(`Unsupported ${kind} statement "${statement}".`);
  }
  if (body || scopes.length) syntax("Unclosed member or group block.");
  // Dotted namespace ancestors must include all descendants, even when they were implicit.
  for (const group of [...groups.values()].reverse()) if (group.parent) {
    const parent = groups.get(group.parent)!;
    for (const id of group.members) if (!parent.members.includes(id)) parent.members.push(id);
  }
  // ER group endpoints attach to real members just like flowchart subgraph endpoints.
  for (const group of groups.values()) {
    const endpoint = group.id.replace(/^subgraph:/, "");
    if (!er || !nodes.has(endpoint) || !group.members.length) continue;
    nodes.delete(endpoint);
    for (let i = 0; i < edges.length; i++) {
      const edge = edges[i]!;
      edges[i] = { ...edge, from: edge.from === endpoint ? group.members[group.members.length - 1]! : edge.from, to: edge.to === endpoint ? group.members[0]! : edge.to };
    }
    for (const other of groups.values()) other.members = other.members.filter(id => id !== endpoint);
    note("group-endpoints", "Group relations attach to the first or last real member.");
  }
  if ([...groups.values()].some(group => !group.members.length)) note("empty-groups", "Empty groups have no enclosure because they contain no entities or classes.");
  if (!nodes.size) { node(kind); note("empty-diagram", "An empty diagram uses one named rectangle."); }
  const output: GlyphGraphNode[] = [...nodes.values()].map(record => ({ id: record.id, label: [record.label, ...record.annotations].join("\n"), shape: "compartment", compartments: !er && record.fields.length && record.methods.length ? [record.fields, record.methods] : [record.fields.length ? record.fields : record.methods], ...(record.group ? { group: record.group } : {}) }));
  const kept: GlyphGraphGroup[] = [...groups.values()].filter(group => group.members.length).map(group => ({ ...group }));
  note("relation-markers", "Class and ER relation ends use proposed compact glyphs pending visual sign-off.");
  return { graph: validateGlyphGraph({ nodes: output, edges, direction, ...(kept.length ? { groups: kept } : {}) }), notes };
}
