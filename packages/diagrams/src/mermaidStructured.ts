import { stripGlyphMermaidPreamble } from "@glyphcss/core/mermaid";
import type { GlyphGraph, GlyphGraphDirection, GlyphGraphEdge, GlyphGraphGroup, GlyphGraphNode } from "./types";
import { glyphDiagramError, validateGlyphGraph } from "./validate";
import { GLYPH_MERMAID_ENTITY, labelText, skipMermaidComment } from "./mermaidText";
import { ledgerMermaidDegraded, type GlyphDiagramLedgerEntry } from "./ledger";
import { GlyphMermaidStatement } from "./mermaid";

export const GLYPH_MERMAID_ADAPTIVE = Symbol("Mermaid adaptive graph layout");
import { GLYPH_MERMAID_BLOCK } from "./layoutHints";
export { GLYPH_MERMAID_BLOCK };
export interface GlyphMermaidBlockCell { id?: string; span: number; grid?: GlyphMermaidBlockGrid }
export interface GlyphMermaidBlockGrid { id?: string; columns?: number; cells: GlyphMermaidBlockCell[] }
export type GlyphMermaidBlockGraph = GlyphGraph & { [GLYPH_MERMAID_BLOCK]?: GlyphMermaidBlockGrid; [GLYPH_MERMAID_ADAPTIVE]?: boolean };
const ID = String.raw`[\p{L}\p{N}_][\p{L}\p{N}_.-]*`;

/** Quoted punctuation is data; braces split requirement/C4 scopes, not labels. */
function statements(source: string, braces: boolean, fail: (message: string) => never): string[] {
  const parts: string[] = [];
  let current = "", quote = "", depth = 0;
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
    if (char === "(" || char === "[") depth++;
    if (char === ")" || char === "]") depth = Math.max(0, depth - 1);
    if (braces && !depth && char === "{") { current += char; flush(); continue; }
    if (braces && !depth && char === "}") { flush(); parts.push("}"); continue; }
    if (!depth && /[\n\r;]/.test(char)) flush(); else current += char;
  }
  if (quote || depth) fail("Unclosed quoted label, shape or call.");
  flush();
  return parts;
}

export function glyphParseMermaidStructured(source: string, kind: string): { graph: GlyphGraph; notes: GlyphDiagramLedgerEntry[] } {
  const family = kind.startsWith("block") ? "BLOCK" : kind.startsWith("architecture") ? "ARCHITECTURE" : kind === "requirementDiagram" ? "REQUIREMENT" : "C4";
  const fail = (message: string): never => glyphDiagramError(`GLYPH_MERMAID_${family}_SYNTAX`, message);
  const notes: GlyphDiagramLedgerEntry[] = [];
  const note = (kind: string, message: string) => { if (!notes.some(n => n.detail?.kind === kind)) notes.push(ledgerMermaidDegraded({ kind, message })); };
  source = source.replace(/^\uFEFF/, "");
  const preamble = stripGlyphMermaidPreamble(source);
  source = preamble.body;
  if (preamble.frontmatter !== undefined) note("frontmatter", "Mermaid frontmatter is inert; render options control the diagram.");
  if (/%%\{/.test(source)) note("configuration", "Mermaid configuration is inert; render options control the diagram.");
  source = source.replace(/^\s*accDescr\s*\{[\s\S]*?\}/gm, "accDescr: inert");
  const parts = statements(source, family === "C4" || family === "REQUIREMENT", fail);
  const header = parts.shift() ?? "";
  if (!header.startsWith(kind)) fail(`Expected ${kind}.`);
  if (header.slice(kind.length).trim()) parts.unshift(header.slice(kind.length).trim());
  const nodes = new Map<string, GlyphGraphNode>(), edges: GlyphGraphEdge[] = [];
  const groups = new Map<string, { id: string; label: string; members: string[]; parent?: string }>();
  let direction: GlyphGraphDirection = family === "C4" || family === "ARCHITECTURE" ? "LR" : "TB";
  const scopes: string[] = [];
  let serial = 0;
  const fresh = () => { let id: string; do { id = `__glyph_block_${++serial}`; } while (source.includes(id)); return id; };
  const add = (node: GlyphGraphNode, owner = scopes.at(-1)) => {
    nodes.set(node.id, { ...node, ...(owner ? { group: owner } : {}) });
    for (const id of scopes) { const group = groups.get(id)!; if (!group.members.includes(node.id)) group.members.push(node.id); }
  };
  const inert = (line: string) => {
    if (/^(?:classDef|class|style|click|linkStyle)\s/.test(line)) { note("styling", "Mermaid styles and interactions are inert."); return true; }
    if (/^acc(?:Title|Descr)\b/.test(line)) { note("accessibility", "Mermaid accessibility metadata is inert."); return true; }
    return false;
  };
  const root: GlyphMermaidBlockGrid = { cells: [] }, grids = [root];
  let requirement: { id: string; type: string; rows: string[] } | undefined;
  const plain = (text: string) => {
    const value = labelText(text), result = value.replace(/(\*\*|__)([\s\S]+?)\1/g, "$2").replace(/([*_])([^*_\n]+)\1/g, "$2");
    if (result !== value) note("requirement-markdown", "Requirement markdown renders as plain text; emphasis is omitted.");
    return result;
  };
  const bind = (id: string, out: boolean): string => {
    const group = groups.get(id);
    if (!group) return id;
    note(`${family.toLowerCase()}-group-edge`, "Group edges attach to the first or last real member, rather than the frame.");
    return (out ? group.members.at(-1) : group.members[0]) ?? id;
  };
  for (const line of parts) {
    if (inert(line)) continue;
    if (family === "BLOCK") {
      const grid = grids.at(-1)!;
      const columns = /^columns\s+(auto|\d+)$/i.exec(line);
      if (columns) { grid.columns = columns[1] === "auto" ? undefined : Number(columns[1]); if (grid.columns === 0) fail("columns must be positive or auto."); continue; }
      if (line === "end") { if (grids.length === 1) fail("Unexpected block end."); grids.pop(); scopes.pop(); continue; }
      const nested = new RegExp(String.raw`^block(?:\s*:\s*(${ID}))?(?:\s*:\s*(\d+))?$`, "u").exec(line);
      if (nested) {
        const id = nested[1] ?? fresh();
        const child: GlyphMermaidBlockGrid = { id, cells: [] };
        grid.cells.push({ id, span: Number(nested[2] ?? 1), grid: child }); grids.push(child);
        groups.set(id, { id, label: nested[1] ?? "", members: [], ...(scopes.length ? { parent: scopes.at(-1) } : {}) }); scopes.push(id); continue;
      }
      const reader = new GlyphMermaidStatement(line, note, new Set(), false);
      let previous: string | undefined;
      while (reader.rest) {
        if (/^(?:[<ox]?(?:--|==|~|-[.]))/.test(reader.rest)) {
          if (!previous) fail(`Missing source block in ${line}.`);
          const edge = reader.edge(), target = reader.node();
          if (!nodes.has(target.node.id) && !groups.has(target.node.id)) { add(target.node); grid.cells.push({ id: target.node.id, span: 1 }); }
          else if (target.declared && nodes.has(target.node.id)) add({ ...nodes.get(target.node.id)!, ...target.node });
          edges.push({ ...edge, from: previous!, to: target.node.id }); previous = target.node.id; continue;
        }
        const space = /^space(?:\s*:\s*(\d+))?(?=\s|$)/.exec(reader.rest);
        if (space) {
          // Consume through the same cursor without ever making a visible space node.
          reader.node();
          const span = reader.blockSpan();
          grid.cells.push({ span }); previous = undefined; continue;
        }
        const arrow = new RegExp(String.raw`^(${ID})?\s*<\[([\s\S]*?)\]>\(([^)]*)\)(?:\s*:\s*(\d+))?`, "u").exec(reader.rest);
        if (arrow) {
          const id = arrow[1] ?? fresh(), tag = arrow[3]!.split(",").map(s => s.trim()).join(", ");
          add({ id, label: `${labelText(arrow[2]!)}\n[${tag}]`, shape: "asymmetric", kind: "block-arrow" });
          grid.cells.push({ id, span: Number(arrow[4] ?? 1) });
          note("block-arrow", "Block arrows reuse the approved asymmetric outline; direction names remain in a text tag.");
          reader.skip(arrow[0].length); previous = id; continue;
        }
        const value = reader.node(), span = reader.blockSpan();
        const seen = nodes.has(value.node.id) || groups.has(value.node.id);
        if (!seen) { add(value.node); grid.cells.push({ id: value.node.id, span }); }
        else if (value.declared) add({ ...nodes.get(value.node.id)!, ...value.node });
        previous = value.node.id;
      }
      continue;
    }
    if (family === "ARCHITECTURE") {
      const declaration = new RegExp(String.raw`^(group|service|junction)\s+(${ID})(?:\(([^)]*)\))?(?:\[([\s\S]*)\])?(?:\s+in\s+(${ID}))?$`, "u").exec(line);
      if (declaration) {
        const [, type, id, icon, label, parent] = declaration;
        const tag = icon ? `[${icon === "database" ? "db" : icon}] ` : "";
        if (icon) note("architecture-icon", "Architecture icons render as inert text tags; no asset is fetched.");
        if (type === "group") groups.set(id!, { id: id!, label: tag + labelText(label ?? id!), members: [], ...(parent ? { parent } : {}) });
        else add({ id: id!, label: type === "junction" ? "+" : tag + labelText(label ?? id!), shape: type === "junction" ? "point" : icon === "database" ? "cylinder" : "rect", kind: type }, parent);
        continue;
      }
      if (/^align\s+(?:row|column)\s+/.test(line)) { note("architecture-align", "Architecture alignment constraints yield to the graph layout."); continue; }
      const edge = new RegExp(String.raw`^(${ID})(\{group\})?\s*:\s*([LRTB])\s*(<)?--(>)?\s*([LRTB])\s*:\s*(${ID})(\{group\})?$`, "u").exec(line);
      if (!edge) fail(`Unsupported architecture statement: ${line}`);
      const [, from, fromGroup, side, start, end, toSide, to, toGroup] = edge!;
      if (!edges.length) direction = side === "R" ? "LR" : side === "L" ? "RL" : side === "B" ? "TB" : "BT";
      edges.push({ from: from!, to: to!, style: "solid", startHead: start ? "arrow" : "none", endHead: end ? "arrow" : "none" });
      note("architecture-ports", `Architecture L/R/T/B ports guide the overall direction; the router chooses final attachment sides (including ${side}/${toSide}).`);
      if (fromGroup || toGroup) note("architecture-group-edge", "Group edges attach to the named member, crossing its group frame.");
      continue;
    }
    if (family === "REQUIREMENT") {
      if (line === "}") {
        if (!requirement) fail("Unexpected requirement closing brace.");
        add({ id: requirement!.id, label: `${requirement!.id}\n<<${requirement!.type}>>`, shape: "compartment", kind: requirement!.type, compartments: [requirement!.rows] }); requirement = undefined; continue;
      }
      if (requirement) {
        const field = /^(id|text|risk|verifymethod|type|docref)\s*:\s*([\s\S]*)$/i.exec(line);
        if (!field) fail(`Expected a requirement or element field: ${line}`);
        requirement.rows.push(`${field![1]!.toLowerCase()}: ${plain(field![2]!)}`); continue;
      }
      const start = new RegExp(String.raw`^(requirement|functionalRequirement|interfaceRequirement|performanceRequirement|physicalRequirement|designConstraint|element)\s+(.+?)(?:\x3a{3}[\w,]+)?\s*\{$`, "iu").exec(line);
      if (start) { requirement = { type: start[1]!, id: plain(start[2]!), rows: [] }; continue; }
      const dir = /^direction\s+(TB|TD|BT|LR|RL)$/i.exec(line);
      if (dir) { direction = dir[1]!.toUpperCase().replace("TD", "TB") as GlyphGraphDirection; continue; }
      const relation = new RegExp(String.raw`^(.+?)\s*(<-|-)\s*(contains|copies|derives|satisfies|verifies|refines|traces)\s*(->|-)\s*(.+)$`, "iu").exec(line);
      if (relation) {
        const reverse = relation[2] === "<-";
        edges.push({ from: plain(relation[reverse ? 5 : 1]!), to: plain(relation[reverse ? 1 : 5]!), label: relation[3]!.toLowerCase(), style: relation[3]!.toLowerCase() === "contains" ? "solid" : "dotted" }); continue;
      }
      if (/^.+:::[\w,]+$/.test(line)) { note("styling", "Mermaid styles and interactions are inert."); continue; }
      fail(`Unsupported requirement statement: ${line}`);
    }
    if (family === "C4") {
      if (line === "}") { if (!scopes.length) fail("Unexpected C4 closing brace."); scopes.pop(); continue; }
      if (/^title\b/i.test(line)) { note("c4-title", "C4 source titles are inert; pass the title render option to draw one."); continue; }
      const call = /^(\w+)\s*\(([\s\S]*)\)\s*(\{)?$/.exec(line);
      if (!call) fail(`Expected a C4 declaration or relation: ${line}`);
      const name = call![1]!, args = argumentsOf(call![2]!);
      if (Object.keys(args.named).some(key => ["sprite", "tags", "link"].includes(key))) note("c4-assets", "C4 sprites, tags and links are inert; nothing is fetched or executed.");
      const value = (index: number, key: string) => args.named[key] ?? args.positional[index] ?? "";
      if (/^(?:Update|update|Add|add|Lay_|LAYOUT|SHOW_|HIDE_|Set|set)/.test(name)) { note("c4-configuration", "C4 style, layout, tags and interaction directives are inert."); continue; }
      const relation = /^(BiRel|Rel)(?:_(U|Up|D|Down|L|Left|R|Right|Back))?$/.exec(name);
      if (relation || name === "RelIndex") {
        const offset = name === "RelIndex" ? 1 : 0;
        let from = value(offset, "from"), to = value(offset + 1, "to");
        if (relation?.[2] === "Back") [from, to] = [to, from];
        const label = value(offset + 2, "label"), tech = name === "RelIndex" ? "" : value(offset + 3, "techn"), descr = name === "RelIndex" ? "" : value(offset + 4, "descr");
        const count = edges.length + 1;
        edges.push({ from, to, label: `${kind === "C4Dynamic" ? `${count}: ` : ""}${[label, tech && `[${tech}]`, descr].filter(Boolean).join(" ")}`, ...(relation?.[1] === "BiRel" ? { startHead: "arrow" as const } : {}) });
        if (relation?.[2] && relation[2] !== "Back") note("c4-direction", "C4 relationship direction hints yield to graph layout; arrow direction stays semantic.");
        if (name === "RelIndex") note("c4-index", "C4 dynamic sequence numbers follow relationship order, matching Mermaid; explicit indices are inert.");
        continue;
      }
      const boundary = /^(?:Boundary|Enterprise_Boundary|System_Boundary|Container_Boundary|Deployment_Node|Node(?:_[LR])?)$/.test(name);
      const id = value(0, "alias"), label = value(1, "label") || id;
      if (!id) fail(`Missing C4 alias: ${line}`);
      if (boundary && call![3]) {
        const type = name === "Boundary" || /^(?:Deployment_Node|Node)/.test(name) ? value(2, "type") : "", descr = /^(?:Deployment_Node|Node)/.test(name) ? value(3, "descr") : "";
        groups.set(id, { id, label: [label, type && `[${type}]`, descr].filter(Boolean).join(" "), members: [], ...(scopes.length ? { parent: scopes.at(-1) } : {}) }); scopes.push(id); continue;
      }
      if (boundary) note("c4-empty-boundary", "A C4 boundary without children renders as a labelled rectangle.");
      const element = /^(Person|System|Container|Component)(Db|Queue)?(_Ext)?$/.exec(name);
      if (!element && !boundary) fail(`Unknown C4 declaration: ${name}`);
      const base = element?.[1] ?? "Node", db = element?.[2] === "Db", queue = element?.[2] === "Queue", ext = !!element?.[3];
      const tech = base === "Container" || base === "Component" || boundary ? value(2, boundary ? "type" : "techn") : "";
      const descr = value(base === "Container" || base === "Component" || boundary ? 3 : 2, "descr");
      add({ id, label: [label, `[${base.toLowerCase()}${queue ? " queue" : db ? " db" : ""}${ext ? ", external" : ""}]`, tech, descr].filter(Boolean).join("\n"), shape: db ? "cylinder" : base === "Person" ? "rounded" : "rect", kind: name });
      if (ext) note("c4-external", "External C4 elements use an external text marker; approved node borders are solid.");
      if (queue) note("c4-queue", "C4 queues reuse the approved rectangle with a queue stereotype.");
      if (Object.keys(args.named).some(key => ["sprite", "tags", "link"].includes(key)) || args.positional.length > (base === "Container" || base === "Component" ? 4 : 3)) note("c4-assets", "C4 sprites, tags and links are inert; nothing is fetched or executed.");
    }
  }
  if (requirement || scopes.length || grids.length !== 1) fail("Unclosed declaration or group.");
  // Architecture declarations name parents rather than using lexical scopes.
  if (family === "ARCHITECTURE") for (const node of nodes.values()) {
    let parent = node.group; const seen = new Set<string>();
    while (parent) {
      if (seen.has(parent)) fail("Cyclic architecture groups."); seen.add(parent);
      const group = groups.get(parent); if (!group) fail(`Unknown architecture group ${parent}.`);
      if (!group!.members.includes(node.id)) group!.members.push(node.id);
      parent = group!.parent;
    }
  }
  for (const group of groups.values()) if (!group.members.length) {
    add({ id: group.id, label: group.label || group.id, shape: "rect" }, group.parent);
    group.members.push(group.id);
    let parent = group.parent; const seen = new Set<string>();
    while (parent && !seen.has(parent)) { seen.add(parent); const up = groups.get(parent); if (!up) break; if (!up.members.includes(group.id)) up.members.push(group.id); parent = up.parent; }
    note("empty-group", "Empty groups render as labelled rectangles.");
  }
  const resolved = edges.map(edge => ({ ...edge, from: bind(edge.from, true), to: bind(edge.to, false) }));
  // A point has no border for a loop; keep the junction identity in a rounded node.
  for (const edge of resolved) if (edge.from === edge.to && nodes.get(edge.from)?.shape === "point") {
    nodes.set(edge.from, { ...nodes.get(edge.from)!, label: "junction", shape: "rounded" }); note("architecture-junction-loop", "A self-linked junction uses a rounded box so its loop has a border.");
  }
  const graph: GlyphMermaidBlockGraph = { nodes: [...nodes.values()], edges: resolved, ...(groups.size ? { groups: [...groups.values()] as GlyphGraphGroup[] } : {}), direction };
  if (family === "BLOCK") graph[GLYPH_MERMAID_BLOCK] = root;
  if (family === "C4") graph[GLYPH_MERMAID_ADAPTIVE] = true;
  return { graph: validateGlyphGraph(graph), notes };
}

/** Named parameters do not shift later positional fields; commas in quotes/calls stay literal. */
function argumentsOf(source: string): { positional: string[]; named: Record<string, string> } {
  const values: string[] = []; let current = "", quote = "", depth = 0;
  for (let i = 0; i < source.length; i++) {
    const char = source[i]!;
    if (quote) { current += char; if (char === "\\" && i + 1 < source.length) current += source[++i]; else if (char === quote) quote = ""; }
    else if (char === '"') { quote = char; current += char; }
    else if (char === "(") { depth++; current += char; }
    else if (char === ")") { depth--; current += char; }
    else if (char === "," && !depth) { values.push(current.trim()); current = ""; }
    else current += char;
  }
  values.push(current.trim());
  const positional: string[] = [], named: Record<string, string> = Object.create(null);
  for (const raw of values) {
    const match = /^\$(\w+)\s*=\s*([\s\S]*)$/.exec(raw);
    if (match) named[match[1]!] = labelText(match[2]!); else positional.push(labelText(raw));
  }
  return { positional, named };
}
