import { stripGlyphMermaidPreamble } from "@glyphcss/core/mermaid";
import type { GlyphGraph, GlyphGraphDirection, GlyphGraphEdge, GlyphGraphGroup, GlyphGraphNode } from "./types";
import { glyphDiagramError, validateGlyphGraph } from "./validate";
import { GLYPH_MERMAID_ENTITY, labelText, skipMermaidComment } from "./mermaidText";
import { GLYPH_MERMAID_STATE_REGION, GLYPH_MERMAID_STATE_FRAME, type GlyphMermaidStateFrame } from "./layoutHints";
import { ledgerMermaidDegraded, ledgerStateShared, type GlyphDiagramLedgerEntry } from "./ledger";

function syntax(message: string): never { return glyphDiagramError("GLYPH_MERMAID_SYNTAX", message); }

/** Node kinds the painter turns into start/end markers; `measureGlyphGraph` picks the glyph for the charset. */
export const GLYPH_DIAGRAM_STATE_START_KIND = "state-start";
export const GLYPH_DIAGRAM_STATE_END_KIND = "state-end";
export const GLYPH_DIAGRAM_STATE_CHOICE_KIND = "state-choice";

const ID = String.raw`[\p{L}\p{N}_][\p{L}\p{N}_.-]*`;
const ENDPOINT = String.raw`(?:\[\*\]|${ID})(?::::[\w,-]+)*`;
const TRANSITION = new RegExp(String.raw`^(${ENDPOINT})\s*-->\s*(${ENDPOINT})(?:\s*:\s*([\s\S]*))?$`, "u");
// "A --> B : text" -- once this much of a statement is seen, every later character is label text.
const TRANSITION_HEAD = new RegExp(String.raw`^\s*(?:${ENDPOINT})\s*-->\s*(?:${ENDPOINT})\s*:`, "u");
const RESERVED = /^(?:state|end|direction|class|classDef|style)$/;
const CLASSED = new RegExp(String.raw`^(${ID}):::[\w,-]+$`, "u");
const DESCRIPTION = new RegExp(String.raw`^(${ID})\s*:\s*([\s\S]*)$`, "u");
const BARE = new RegExp(String.raw`^(${ID})$`, "u");
const STATE_NAMED = new RegExp(String.raw`^state\s+("[^"]*")\s+as\s+(${ID})\s*(\{)?$`, "u");
const STATE_STEREOTYPE = new RegExp(String.raw`^state\s+(?:"[^"]*"\s+as\s+)?(${ID})\s*(?:<<\s*(choice|fork|join)\s*>>|\[\[\s*(choice|fork|join)\s*\]\])$`, "u");
const STATE_COMPOSITE = new RegExp(String.raw`^state\s+(${ID})\s*\{$`, "u");
const STATE_PLAIN = new RegExp(String.raw`^state\s+(${ID})$`, "u");

/**
 * Newlines and ";" end a statement, except inside a quoted name and inside an
 * HTML entity's own ";" (so "&nbsp;" in a description survives), and not after
 * a transition's ":" (the rest of that line is its label, quotes and all). A "%%" comment runs
 * to the end of its line, and a "%%{ ... }%%" directive may span lines, as in
 * the flowchart adapter.
 */
function statements(source: string): string[] {
  const output: string[] = [];
  let current = "", quote = false, noteBody = false;
  const end = () => {
    const part = current.trim();
    if (part) output.push(part);
    if (/^note\s+(?:right|left)\s+of\s+\S+$/i.test(part)) noteBody = true;
    if (/^end\s+note$/i.test(part)) noteBody = false;
    current = "";
  };
  for (let index = 0; index < source.length; index++) {
    const char = source[index]!;
    // A quote only opens a name, right after `state`; anywhere else (a label, a description) it is an ordinary character. A name
    // ends at its closing quote, and a line ends a statement whatever is open, so an unclosed one can never swallow the next line.
    if (quote) {
      if (char === "\n" || char === "\r") syntax("Unclosed quoted state name.");
      current += char; if (char === '"') quote = false; continue;
    }
    if (!noteBody && char === '"' && /^\s*state\s+$/.test(current)) { quote = true; current += char; continue; }
    if (char === "&" || char === "#") {
      const entity = GLYPH_MERMAID_ENTITY.exec(source.slice(index));
      if (entity?.index === 0) { current += entity[0]; index += entity[0].length - 1; continue; }
    }
    if (char === "%" && source[index + 1] === "%") { index = skipMermaidComment(source, index); continue; }
    if (char === "\n" || char === "\r" || (char === ";" && !noteBody && !/^\s*note\b/i.test(current) && !TRANSITION_HEAD.test(current))) end(); else current += char;
  }
  if (quote) syntax("Unclosed quoted state name.");
  end();
  return output;
}

type Ref = { readonly state: string } | { readonly marker: "start" | "end"; readonly scope: string };
interface State { id: string; title?: string; descriptions: string[]; stereotype?: "choice" | "fork" | "join" }
interface Composite { id: string; title?: string; members: string[]; parent?: string; region?: number }

/** A group's label is one line, so a composite's description lines follow its name after this separator. */
export const COMPOSITE_DESCRIPTION_JOINER = " - ";
const startId = (scope: string) => scope ? `[*]:start:${scope}` : "[*]:start";
const endId = (scope: string) => scope ? `[*]:end:${scope}` : "[*]:end";

/** State syntax projects onto approved graph families; source-only approximations enter the ledger. */
export function glyphGraphFromMermaidState(source: string): GlyphGraph { return glyphParseMermaidState(source).graph; }
/** What the source says that the graph cannot: a state id reused inside a second composite (see `ledgerStateShared`). The combined internal reader supplies graph and notes together. */
export function glyphMermaidStateNotes(source: string): GlyphDiagramLedgerEntry[] { return glyphParseMermaidState(source).notes; }

export function glyphParseMermaidState(source: string): { graph: GlyphGraph; notes: GlyphDiagramLedgerEntry[] } {
  const notes: GlyphDiagramLedgerEntry[] = [];
  const note = (kind: string, message: string) => { if (!notes.some(entry => entry.detail?.kind === kind)) notes.push(ledgerMermaidDegraded({ kind, message })); };
  source = source.replace(/^\uFEFF/, "");
  const preamble = stripGlyphMermaidPreamble(source);
  source = preamble.body;
  if (preamble.frontmatter !== undefined) note("frontmatter", "Mermaid frontmatter is inert; render options control the diagram.");
  if (/%%\{/.test(source)) note("state-directive", "Mermaid state configuration is inert.");
  const parts = statements(source);
  const header = parts.shift();
  if (!header || !/^stateDiagram(?:-v2)?$/.test(header)) syntax("Expected a stateDiagram or stateDiagram-v2 declaration.");
  let direction: GlyphGraphDirection = "TB";
  const states = new Map<string, State>();
  const composites = new Map<string, Composite>();
  const owners = new Map<string, string>();
  const markers = new Map<string, { id: string; kind: "start" | "end"; scope: string }>();
  const transitions: { from: Ref; to: Ref; label?: string }[] = [];
  const created: string[] = [];
  const stack: string[] = [];
  const scope = () => stack[stack.length - 1] ?? "";
  // Discover region-owning bodies before creating markers, so even region one's
  // start/end have their own scope and never alias a sibling's markers.
  const concurrent = new Set<string>(), bodies: string[] = [];
  let inNote = false;
  for (const part of parts) {
    if (/^note\b/i.test(part) && !part.includes(":")) { inNote = true; continue; }
    if (inNote) { if (/^end\s+note$/i.test(part)) inNote = false; continue; }
    const opening = STATE_COMPOSITE.exec(part) ?? STATE_NAMED.exec(part);
    if (opening && part.endsWith("{")) bodies.push(opening[2] ?? opening[1]!);
    else if (part === "}") bodies.pop();
    else if (/^--+$/.test(part) && bodies.length) concurrent.add(bodies[bodies.length - 1]!);
  }

  const openComposite = (id: string, title?: string, region?: number): void => {
    if (composites.has(id)) syntax(`Composite state "${id}" is declared twice.`);
    // A state mentioned before its body is the composite, not an extra node. Declaring one inside another puts it in the
    // outer one's group whatever it turns out to be: a frame of its own, or (empty) an ordinary state.
    // An id named before it was declared sits in whichever scope named it; a composite belongs only to the scopes it is declared in.
    for (const other of composites.values()) if (!stack.includes(other.id)) other.members = other.members.filter((member) => member !== id);
    composites.set(id, { id, ...(title !== undefined ? { title } : {}), members: [], ...(region !== undefined ? { region } : {}), ...(stack.length ? { parent: scope() } : {}) });
    // The declaration is the composite's one owner: the scope it stands in, or none at the top (a stale owner from an earlier mention would outlive it).
    if (stack.length) owners.set(id, scope()); else owners.delete(id);
    join(id);
    if (!created.includes(id)) created.push(id);
    stack.push(id);
    if (concurrent.has(id)) openComposite(`${id}:region:1`, undefined, 1);
  };
  const join = (id: string) => {
    for (const parent of stack) {
      const members = composites.get(parent)!.members;
      if (!members.includes(id)) members.push(id);
    }
  };
  const state = (id: string): State => {
    let found = states.get(id);
    const owner = owners.get(id);
    // Ids are global, as in Mermaid: a state first used in one composite and used again inside a different one is the same state.
    if (found && stack.length > 0 && owner !== undefined && !stack.includes(owner) && !notes.some((n) => n.detail?.id === id && n.detail?.scope === scope())) notes.push(ledgerStateShared({ id, owner, scope: scope() }));
    if (!found) {
      found = { id, descriptions: [] };
      states.set(id, found);
      // A composite opened earlier already holds its place in the authored order.
      if (!created.includes(id)) created.push(id);
      if (stack.length) owners.set(id, scope());
      join(id);
    }
    return found;
  };
  /**
   * The record a naming, description or bare statement writes to. Such a statement says something ABOUT an id; it never gives a scope a
   * member it did not have, so for a composite (which owns its own place) the record is kept apart from every scope's membership.
   */
  const meta = (id: string): State => {
    const known = states.get(id);
    if (known || !composites.has(id)) return known ?? state(id);
    const silent: State = { id, descriptions: [] };
    states.set(id, silent);
    return silent;
  };
  const marker = (kind: "start" | "end"): Ref => {
    const id = (kind === "start" ? startId : endId)(scope());
    if (!markers.has(id)) { markers.set(id, { id, kind, scope: scope() }); created.push(id); if (stack.length) owners.set(id, scope()); join(id); }
    return { marker: kind, scope: scope() };
  };
  const endpoint = (text: string, role: "from" | "to"): Ref => {
    if (text.includes(":::")) note("state-style", "Mermaid state styles and classes are inert.");
    text = text.replace(/(?::::[\w,-]+)+$/, "");
    if (text === "[*]") return marker(role === "from" ? "start" : "end");
    const id = text;
    if (RESERVED.test(id)) syntax(`"${id}" is a state diagram keyword, not a state name.`);
    if (!composites.has(id)) state(id);
    return { state: id };
  };

  let pendingNote: { id: string; lines: string[] } | undefined;
  const stateNotes: { id: string; text: string }[] = [];
  const addNote = (id: string, lines: string[]) => {
    meta(id);
    stateNotes.push({ id, text: lines.map(line => labelText(line, true)).join("\n") });
    note("state-note", "State notes render as description rows; side placement is not retained.");
  };
  for (const statement of parts) {
    if (pendingNote) {
      if (/^end\s+note$/i.test(statement)) { addNote(pendingNote.id, pendingNote.lines); pendingNote = undefined; }
      else pendingNote.lines.push(statement);
      continue;
    }
    if (/^direction\s+(?:TB|TD|LR|BT|RL)$/.test(statement)) {
      if (!stack.length) { const value = statement.split(/\s+/)[1]!; direction = (value === "TD" ? "TB" : value) as GlyphGraphDirection; }
      else note("state-direction", "Composite states and concurrent regions inherit the diagram direction.");
      continue;
    }
    if (/^(?:classDef|class|style|click|linkStyle)\s+\S/.test(statement) || /^acc(?:Title|Descr)\s*:/.test(statement)
      || /^hide\s+empty\s+description$/.test(statement) || /^scale\s+\d+(?:\s+(?:width|height))?$/.test(statement)) {
      note("state-style", "Mermaid state styles, interactions and presentation metadata are inert."); continue;
    }
    const noteMatch = new RegExp(String.raw`^note\s+(?:right|left)\s+of\s+(${ID})(?:\s*:\s*([\s\S]*))?$`, "iu").exec(statement);
    if (noteMatch) {
      if (noteMatch[2] !== undefined) addNote(noteMatch[1]!, [noteMatch[2]]);
      else pendingNote = { id: noteMatch[1]!, lines: [] };
      continue;
    }
    if (/^(?:floating\s+)?note\b/i.test(statement)) glyphDiagramError("GLYPH_MERMAID_STATE_NOTE", `Malformed state note "${statement}".`);
    if (/^--+$/.test(statement)) {
      const region = composites.get(scope());
      if (region?.region === undefined) glyphDiagramError("GLYPH_MERMAID_STATE_CONCURRENCY", "A region separator requires a composite state.");
      stack.pop();
      openComposite(`${scope()}:region:${region.region + 1}`, undefined, region.region + 1);
      continue;
    }
    if (statement === "}") {
      if (composites.get(scope())?.region !== undefined) stack.pop();
      if (!stack.pop()) syntax("A closing } has no matching composite state.");
      continue;
    }
    let match: RegExpExecArray | null;
    if ((match = STATE_STEREOTYPE.exec(statement))) {
      const kind = (match[2] ?? match[3])! as "choice" | "fork" | "join";
      const record = state(match[1]!);
      record.stereotype = kind;
      const title = /^state\s+("[^"]*")\s+as\s+/.exec(statement)?.[1];
      if (title) record.title = labelText(title);
      if (kind !== "choice") note("state-fork-join", "Fork/join bars render as labelled rounded states; all branches are retained.");
      continue;
    }
    if ((match = STATE_NAMED.exec(statement))) {
      const id = match[2]!, title = labelText(match[1]!);
      if (match[3]) { openComposite(id, title); continue; }
      meta(id).title = title;
      continue;
    }
    if ((match = STATE_COMPOSITE.exec(statement))) { openComposite(match[1]!); continue; }
    if ((match = STATE_PLAIN.exec(statement))) { if (!composites.has(match[1]!)) state(match[1]!); continue; }
    if ((match = TRANSITION.exec(statement))) {
      const from = endpoint(match[1]!, "from"), to = endpoint(match[2]!, "to");
      const label = match[3] === undefined ? "" : labelText(match[3], true);
      transitions.push({ from, to, ...(label ? { label } : {}) });
      continue;
    }
    if (CLASSED.test(statement)) { meta(CLASSED.exec(statement)![1]!); note("state-style", "Mermaid state styles and classes are inert."); continue; }
    if ((match = DESCRIPTION.exec(statement))) {
      const text = labelText(match[2]!, true);
      if (text) meta(match[1]!).descriptions.push(text);
      else meta(match[1]!);
      continue;
    }
    // A keyword left bare ("state", "end") is a broken statement, not a state of that name.
    if ((match = BARE.exec(statement)) && !RESERVED.test(match[1]!)) { meta(match[1]!); continue; }
    syntax(`Unsupported state diagram statement "${statement}".`);
  }
  if (pendingNote) glyphDiagramError("GLYPH_MERMAID_STATE_NOTE", "Unclosed state note; expected end note.");
  if (stack.length) syntax(`Unclosed composite state "${stack[stack.length - 1]}".`);

  // A composite with no inner state is an ordinary state.
  for (const composite of [...composites.values()].reverse()) {
    if (composite.members.length > 0) continue;
    if (composite.region !== undefined) {
      composites.delete(composite.id);
      created.splice(created.indexOf(composite.id), 1);
      for (const parent of composites.values()) parent.members = parent.members.filter(id => id !== composite.id);
      note("state-empty-region", "Empty concurrent regions are omitted without drawing placeholder states.");
      continue;
    }
    composites.delete(composite.id);
    const plain = states.get(composite.id) ?? { id: composite.id, descriptions: [] };
    states.set(composite.id, plain);
    if (composite.title !== undefined) plain.title = composite.title;
  }

  for (const item of stateNotes) {
    const composite = composites.get(item.id);
    const child = composite?.members.find(id => states.has(id) && !composites.has(id));
    // A frame caption is one line and can abbreviate. Keep a composite note
    // on a real inner state's rows instead, where the ordinary fitter wraps it.
    meta(child ?? item.id).descriptions.push(child ? `Note (${item.id}): ${item.text}` : `Note: ${item.text}`);
    if (child) note("state-composite-note", "Composite notes attach to their first inner state so the note text can wrap.");
  }

  const nodes: GlyphGraphNode[] = created.filter((id) => !composites.has(id)).map((id): GlyphGraphNode => {
    const owner = owners.get(id), group = owner && composites.has(owner) ? { group: owner } : {};
    const m = markers.get(id);
    if (m) return { id, label: m.kind === "start" ? "●" : "◉", kind: m.kind === "start" ? GLYPH_DIAGRAM_STATE_START_KIND : GLYPH_DIAGRAM_STATE_END_KIND, shape: "point", ...group };
    const s = states.get(id)!;
    if (s.stereotype === "choice") return { id, label: ["◆", ...s.descriptions].join("\n"), kind: GLYPH_DIAGRAM_STATE_CHOICE_KIND, shape: "diamond", ...group };
    return { id, ...(s.stereotype ? { kind: `state-${s.stereotype}` } : {}), label: [s.title ?? s.id, ...(s.stereotype ? [`[${s.stereotype}]`] : []), ...s.descriptions].join("\n"), shape: "rounded", ...group };
  });
  const nodeIds = new Set(nodes.map((node) => node.id));
  /**
   * Concurrent composites own frame ports; their region endpoints only constrain layout ranks. Otherwise entering uses the
   * start/first child and leaving the end/last child. Nested composites recurse, and only a child the
   * composite holds directly counts (a state first used elsewhere, or a nested composite's own markers, are not its children).
   */
  type Attachment = { nodes: string[]; group?: string };
  const attach = (composite: Composite, role: "from" | "to", depth = 0): Attachment => {
    const regions = [...composites.values()].filter(c => c.parent === composite.id && c.region !== undefined);
    if (regions.length) return { nodes: regions.flatMap(region => attach(region, role, depth + 1).nodes), group: composite.id };
    const own = (role === "to" ? startId : endId)(composite.id);
    if (markers.has(own)) return { nodes: [own] };
    const children = composite.members.filter(id => composites.has(id) ? composites.get(id)!.parent === composite.id : states.has(id) && owners.get(id) === composite.id);
    const child = role === "to" ? children[0] : children[children.length - 1];
    if (child !== undefined && composites.has(child) && depth < composites.size) return attach(composites.get(child)!, role, depth + 1);
    return { nodes: [child ?? (markers.has(startId(composite.id)) ? startId(composite.id) : endId(composite.id))] };
  };
  const resolve = (ref: Ref, role: "from" | "to"): Attachment => {
    if ("marker" in ref) return { nodes: [(ref.marker === "start" ? startId : endId)(ref.scope)] };
    const composite = composites.get(ref.state);
    return composite ? attach(composite, role) : { nodes: [ref.state] };
  };
  const edges: (GlyphGraphEdge & GlyphMermaidStateFrame)[] = transitions.map(t => {
    if ("state" in t.from && "state" in t.to && t.from.state === t.to.state && composites.has(t.from.state)) {
      note("state-composite-loop", "Composite self transitions connect exit to entry using the ordinary composite attachment rules.");
    }
    const from = resolve(t.from, "from"), to = resolve(t.to, "to");
    return { from: from.nodes[0]!, to: to.nodes[0]!, ...(t.label ? { label: t.label } : {}), style: "solid",
      ...(from.group || to.group ? { [GLYPH_MERMAID_STATE_FRAME]: {
        ...(from.group ? { from: { group: from.group, nodes: from.nodes } } : {}),
        ...(to.group ? { to: { group: to.group, nodes: to.nodes } } : {}),
      } } : {}) };
  });
  for (const edge of edges) if (edge.from === edge.to) {
    const node = nodes.find(node => node.id === edge.from)!;
    if (node.shape === "point") {
      Object.assign(node, { shape: "rounded", label: node.kind === GLYPH_DIAGRAM_STATE_START_KIND ? "[start]" : "[end]" });
      note("state-point-loop", "A self transition on a composite's sole marker uses a labelled rounded state, which has room for a loop.");
    }
  }
  const members = (c: Composite) => c.members.filter((id) => nodeIds.has(id));
  // A parent is only recorded where the enclosing group lists exactly the same nodes, the one case it cannot be inferred.
  const groups: GlyphGraphGroup[] = [...composites.values()].map((c) => ({ id: c.id, label: c.region !== undefined ? "" : [c.title ?? states.get(c.id)?.title ?? c.id, ...(states.get(c.id)?.descriptions ?? [])].join(COMPOSITE_DESCRIPTION_JOINER),
    ...(c.region !== undefined ? { [GLYPH_MERMAID_STATE_REGION]: { parent: c.parent!, index: c.region } } : {}), members: members(c),
    ...(c.parent !== undefined && composites.has(c.parent) && members(composites.get(c.parent)!).length === members(c).length ? { parent: c.parent } : {}) }));
  return { graph: validateGlyphGraph({ nodes, edges, ...(groups.length ? { groups } : {}), direction }), notes };
}
