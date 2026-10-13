import type { GlyphGraph, GlyphGraphDirection, GlyphGraphEdge, GlyphGraphGroup, GlyphGraphNode } from "./types";
import { glyphDiagramError, validateGlyphGraph } from "./validate";
import { labelText, skipMermaidComment } from "./mermaidText";
import { ledgerStateShared, type GlyphDiagramLedgerEntry } from "./ledger";

function syntax(message: string): never { return glyphDiagramError("GLYPH_MERMAID_SYNTAX", message); }

/** Node kinds the painter turns into start/end markers; `measureGlyphGraph` picks the glyph for the charset. */
export const GLYPH_DIAGRAM_STATE_START_KIND = "state-start";
export const GLYPH_DIAGRAM_STATE_END_KIND = "state-end";
export const GLYPH_DIAGRAM_STATE_CHOICE_KIND = "state-choice";

const ID = String.raw`[\p{L}\p{N}_][\p{L}\p{N}_.-]*`;
const ENDPOINT = String.raw`\[\*\]|${ID}(?::::?[\w,-]+)?`;
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
  let current = "", quote = false;
  const end = () => { if (current.trim()) output.push(current.trim()); current = ""; };
  for (let index = 0; index < source.length; index++) {
    const char = source[index]!;
    // A quote only opens a name, right after `state`; anywhere else (a label, a description) it is an ordinary character. A name
    // ends at its closing quote, and a line ends a statement whatever is open, so an unclosed one can never swallow the next line.
    if (quote) {
      if (char === "\n" || char === "\r") syntax("Unclosed quoted state name.");
      current += char; if (char === '"') quote = false; continue;
    }
    if (char === '"' && /^\s*state\s+$/.test(current)) { quote = true; current += char; continue; }
    if (char === "&") {
      const entity = /^&(?:amp|lt|gt|quot|apos|nbsp|#\d+|#x[\da-f]+);/i.exec(source.slice(index));
      if (entity) { current += entity[0]; index += entity[0].length - 1; continue; }
    }
    if (char === "%" && source[index + 1] === "%") { index = skipMermaidComment(source, index); continue; }
    if (char === "\n" || char === "\r" || (char === ";" && !TRANSITION_HEAD.test(current))) end(); else current += char;
  }
  if (quote) syntax("Unclosed quoted state name.");
  end();
  return output;
}

type Ref = { readonly state: string } | { readonly marker: "start" | "end"; readonly scope: string };
interface State { id: string; title?: string; descriptions: string[]; stereotype?: "choice" }
interface Composite { id: string; title?: string; members: string[]; parent?: string }

/** A group's label is one line, so a composite's description lines follow its name after this separator. */
export const COMPOSITE_DESCRIPTION_JOINER = " - ";
const startId = (scope: string) => scope ? `[*]:start:${scope}` : "[*]:start";
const endId = (scope: string) => scope ? `[*]:end:${scope}` : "[*]:end";

/**
 * Mermaid `stateDiagram` / `stateDiagram-v2` as the flowchart graph IR, so a
 * state machine takes the ordinary fit, route and paint path.
 *
 * - A state is a `rounded` node labelled with its title (the id, or the name
 *   from `state "Name" as Id`), then each `Id : description` line on its own
 *   row. A `<<choice>>` is a `diamond` holding one `◆`.
 * - `[*]` becomes one start node and one end node PER SCOPE (the diagram, and
 *   each composite), shared by every use in that scope, as Mermaid does.
 * - A composite `state P { ... }` is a group holding its inner states, labelled
 *   with its `state "Name" as P` name wherever that statement stands, followed
 *   by any `P : text` lines after " - " (a frame caption is one line, and an
 *   ASCII hyphen keeps it ASCII). The
 *   graph IR connects nodes, not groups, so a transition INTO `P` ends at its
 *   inner start (else its first state), and one OUT of `P` leaves from its
 *   inner end (else its last state). A composite with no inner state is a
 *   plain state. A composite cannot loop to itself: a loop hangs on a node's
 *   border and a frame exists only after layout, so that is rejected.
 * - A state belongs to the scope where it is first mentioned.
 * - `direction` sets the diagram's direction; inside a composite it is inert.
 *   `classDef`/`class`/`style` are inert, as in flowcharts.
 * - Notes, `--` concurrency regions and `<<fork>>`/`<<join>>` are rejected by
 *   name rather than dropped: a fork/join is a one-cell bar, and a node box
 *   is at least 3 rows tall with its border taking the arrowhead.
 */
export function glyphGraphFromMermaidState(source: string): GlyphGraph { return parseMermaidState(source).graph; }
/** What the source says that the graph cannot: a state id reused inside a second composite (see `ledgerStateShared`). Parses again, which is cheap. */
export function glyphMermaidStateNotes(source: string): GlyphDiagramLedgerEntry[] { return parseMermaidState(source).notes; }

function parseMermaidState(source: string): { graph: GlyphGraph; notes: GlyphDiagramLedgerEntry[] } {
  const notes: GlyphDiagramLedgerEntry[] = [];
  const parts = statements(source.replace(/^﻿/, ""));
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

  const openComposite = (id: string, title?: string): void => {
    if (composites.has(id)) syntax(`Composite state "${id}" is declared twice.`);
    // A state mentioned before its body is the composite, not an extra node. Declaring one inside another puts it in the
    // outer one's group whatever it turns out to be: a frame of its own, or (empty) an ordinary state.
    // An id named before it was declared sits in whichever scope named it; a composite belongs only to the scopes it is declared in.
    for (const other of composites.values()) if (!stack.includes(other.id)) other.members = other.members.filter((member) => member !== id);
    composites.set(id, { id, ...(title !== undefined ? { title } : {}), members: [], ...(stack.length ? { parent: scope() } : {}) });
    // The declaration is the composite's one owner: the scope it stands in, or none at the top (a stale owner from an earlier mention would outlive it).
    if (stack.length) owners.set(id, scope()); else owners.delete(id);
    join(id);
    if (!created.includes(id)) created.push(id);
    stack.push(id);
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
    if (text === "[*]") return marker(role === "from" ? "start" : "end");
    const id = text.replace(/:::?[\w,-]+$/, "");
    if (RESERVED.test(id)) syntax(`"${id}" is a state diagram keyword, not a state name.`);
    if (!composites.has(id)) state(id);
    return { state: id };
  };

  for (const statement of parts) {
    if (/^direction\s+(?:TB|TD|LR|BT|RL)$/.test(statement)) {
      if (!stack.length) { const value = statement.split(/\s+/)[1]!; direction = (value === "TD" ? "TB" : value) as GlyphGraphDirection; }
      continue;
    }
    if (/^(?:classDef|class|style|click|linkStyle)\s+\S/.test(statement) || /^acc(?:Title|Descr)\s*:/.test(statement)
      || /^hide\s+empty\s+description$/.test(statement) || /^scale\s+\d+(?:\s+(?:width|height))?$/.test(statement)) continue;
    if (/^(?:floating\s+)?note\b/i.test(statement)) glyphDiagramError("GLYPH_MERMAID_STATE_NOTE", `Mermaid state notes are not supported ("${statement}").`);
    if (/^--+$/.test(statement)) glyphDiagramError("GLYPH_MERMAID_STATE_CONCURRENCY", "Mermaid state concurrency regions (--) are not supported.");
    if (statement === "}") {
      if (!stack.pop()) syntax("A closing } has no matching composite state.");
      continue;
    }
    let match: RegExpExecArray | null;
    if ((match = STATE_STEREOTYPE.exec(statement))) {
      if (match[2] ?? match[3]) {
        const kind = (match[2] ?? match[3])!;
        if (kind !== "choice") glyphDiagramError("GLYPH_MERMAID_STATE_FORK_JOIN", `Mermaid <<${kind}>> states are not supported ("${statement}").`);
        state(match[1]!).stereotype = "choice";
      }
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
    if (CLASSED.test(statement)) { meta(CLASSED.exec(statement)![1]!); continue; }
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
  if (stack.length) syntax(`Unclosed composite state "${stack[stack.length - 1]}".`);

  // A composite with no inner state is an ordinary state.
  for (const composite of [...composites.values()]) {
    if (composite.members.length > 0) continue;
    composites.delete(composite.id);
    const plain = states.get(composite.id) ?? { id: composite.id, descriptions: [] };
    states.set(composite.id, plain);
    if (composite.title !== undefined) plain.title = composite.title;
  }

  const nodes: GlyphGraphNode[] = created.filter((id) => !composites.has(id)).map((id): GlyphGraphNode => {
    const owner = owners.get(id), group = owner && composites.has(owner) ? { group: owner } : {};
    const m = markers.get(id);
    if (m) return { id, label: m.kind === "start" ? "●" : "◉", kind: m.kind === "start" ? GLYPH_DIAGRAM_STATE_START_KIND : GLYPH_DIAGRAM_STATE_END_KIND, shape: "point", ...group };
    const s = states.get(id)!;
    if (s.stereotype === "choice") return { id, label: "◆", kind: GLYPH_DIAGRAM_STATE_CHOICE_KIND, shape: "diamond", ...group };
    return { id, label: [s.title ?? s.id, ...s.descriptions].join("\n"), shape: "rounded", ...group };
  });
  const nodeIds = new Set(nodes.map((node) => node.id));
  /**
   * Where an edge into (`to`) or out of (`from`) a composite attaches. Entering uses its start marker, else its first child; leaving
   * its end marker, else its last child. A child that is itself a composite is entered or left the same way, and only a child the
   * composite holds directly counts (a state first used elsewhere, or a nested composite's own markers, are not its children).
   */
  const attach = (composite: Composite, role: "from" | "to", depth = 0): string => {
    const own = (role === "to" ? startId : endId)(composite.id);
    if (markers.has(own)) return own;
    const children = composite.members.filter((id) => composites.has(id) ? composites.get(id)!.parent === composite.id : states.has(id) && owners.get(id) === composite.id);
    const child = role === "to" ? children[0] : children[children.length - 1];
    if (child !== undefined && composites.has(child) && depth < composites.size) return attach(composites.get(child)!, role, depth + 1);
    // Only markers of its own are left: the other one is the one node it has.
    return child ?? (markers.has(startId(composite.id)) ? startId(composite.id) : endId(composite.id));
  };
  const resolve = (ref: Ref, role: "from" | "to"): string => {
    if ("marker" in ref) return (ref.marker === "start" ? startId : endId)(ref.scope);
    const composite = composites.get(ref.state);
    return composite ? attach(composite, role) : ref.state;
  };
  for (const t of transitions) {
    if ("state" in t.from && "state" in t.to && t.from.state === t.to.state && composites.has(t.from.state)) {
      glyphDiagramError("GLYPH_MERMAID_STATE_COMPOSITE_LOOP", `The composite state "${t.from.state}" cannot transition to itself.`);
    }
  }
  const edges: GlyphGraphEdge[] = transitions.map((t) => ({ from: resolve(t.from, "from"), to: resolve(t.to, "to"), ...(t.label ? { label: t.label } : {}), style: "solid" as const }));
  const members = (c: Composite) => c.members.filter((id) => nodeIds.has(id));
  // A parent is only recorded where the enclosing group lists exactly the same nodes, the one case it cannot be inferred.
  const groups: GlyphGraphGroup[] = [...composites.values()].map((c) => ({ id: c.id, label: [c.title ?? states.get(c.id)?.title ?? c.id, ...(states.get(c.id)?.descriptions ?? [])].join(COMPOSITE_DESCRIPTION_JOINER), members: members(c),
    ...(c.parent !== undefined && composites.has(c.parent) && members(composites.get(c.parent)!).length === members(c).length ? { parent: c.parent } : {}) }));
  return { graph: validateGlyphGraph({ nodes, edges, ...(groups.length ? { groups } : {}), direction }), notes };
}
