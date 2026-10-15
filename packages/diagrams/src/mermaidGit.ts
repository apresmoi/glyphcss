import type { GlyphGraph } from "./types";
import type { GlyphLaneDag, GlyphLaneNode } from "./lanes/types";
import { validateGlyphLaneDag } from "./lanes/validate";
import { glyphDiagramError, validateGlyphGraph } from "./validate";
import { labelText } from "./mermaidText";
import { ledgerMermaidDegraded, type GlyphDiagramLedgerEntry } from "./ledger";
import { glyphMermaidTreeDocument, glyphMermaidTreeStatements, glyphMermaidGitConfig } from "./mermaidTreeText";

export interface GlyphMermaidGitLanes { readonly dag: GlyphLaneDag; readonly order: "newest-first" | "oldest-first"; readonly ids: boolean; readonly laneOf: ReadonlyMap<string, number> }
function syntax(message: string): never { return glyphDiagramError("GLYPH_MERMAID_GIT_SYNTAX", message); }
const TOKEN = /^("(?:\\.|[^"\\])*"|'[^']*'|[^\s:]+)\s*/;
function attributes(source: string): Record<string, string> {
  const values: Record<string, string> = Object.create(null);
  while (source.trim()) {
    const key = /^\s*(id|type|tag|parent|order)\s*:\s*/.exec(source);
    if (!key) syntax(`Unknown gitGraph attribute: ${source}`);
    source = source.slice(key[0].length);
    const value = TOKEN.exec(source);
    if (!value) syntax(`Missing gitGraph ${key[1]} value.`);
    values[key[1]!] = labelText(value[1]!); source = source.slice(value[0].length);
  }
  return values;
}

export function glyphParseMermaidGit(source: string): { graph: GlyphGraph; notes: GlyphDiagramLedgerEntry[]; lanes: GlyphMermaidGitLanes } {
  const { body, config } = glyphMermaidTreeDocument(source), parts = glyphMermaidTreeStatements(body).map(s => s.trim());
  const header = /^gitGraph(?:\s+(LR|TB|BT))?\s*:?\s*$/i.exec(parts.shift() ?? "");
  if (!header) syntax("Use gitGraph, gitGraph LR:, gitGraph TB:, or gitGraph BT:.");
  const notes: GlyphDiagramLedgerEntry[] = [];
  const note = (kind: string, message: string) => { if (!notes.some(n => n.detail?.kind === kind)) notes.push(ledgerMermaidDegraded({ kind, message })); };
  note("git-layout", "GitGraph uses existing lane markers, branch names on final heads, and horizontal id/tag annotations instead of circles, persistent branch headers and tag outlines.");
  const setting = (key: string) => glyphMermaidGitConfig(config, key);
  let current = setting("mainBranchName") ?? "main";
  const branches = new Map<string, string | undefined>([[current, undefined]]);
  const branchOrder = new Map<string, number | undefined>([[current, Number(setting("mainBranchOrder") ?? 0)]]);
  const commits: (GlyphLaneNode & { branch: string })[] = [];
  const ids = new Set<string>();
  // Reserve authored ids before allocating deterministic substitutes for Mermaid's random ids.
  const reserved = new Set(parts.flatMap(part => /^commit\b|^merge\b/.test(part) ? [...part.matchAll(/\bid\s*:\s*("(?:\\.|[^"\\])*"|'[^']*'|[^\s:]+)/g)].map(m => labelText(m[1]!)) : []));
  let serial = 0;
  const generated = () => { let id: string; do { id = `commit-${++serial}`; } while (ids.has(id) || reserved.has(id)); return id; };
  const showBranches = setting("showBranches") !== "false", showLabels = setting("showCommitLabel") !== "false";
  if (config.trim()) note("git-config", "GitGraph reads only scalar branch-name, order and visibility settings; styling, rotation, parallel placement and other configuration are inert.");
  if (!showBranches) note("git-hidden-branches", "Branch names are hidden; history connectors remain to preserve ancestry.");
  const commit = (attrs: Record<string, string>, parents: string[], marks: string[] = [], pick = false) => {
    const id = pick ? generated() : attrs.id ?? generated();
    if (ids.has(id)) syntax(`Duplicate commit id "${id}".`);
    ids.add(id);
    const type = attrs.type ?? "NORMAL";
    if (!["NORMAL", "REVERSE", "HIGHLIGHT"].includes(type)) syntax(`Unknown commit type "${type}".`);
    if (type !== "NORMAL") { marks.push(type); note("git-types", "Commit types use text annotations beside the existing lane marker."); }
    if (attrs.tag !== undefined) marks.push(`tag: ${attrs.tag}`);
    commits.push({ id, label: "", parents, marks, branch: current }); branches.set(current, id);
  };
  for (const statement of parts) {
    const command = /^(commit|branch|checkout|switch|merge|cherry-pick)\b\s*([\s\S]*)$/.exec(statement);
    if (!command) syntax(`Unsupported gitGraph statement: ${statement}`);
    const op = command[1]!, rest = command[2]!;
    const head = branches.get(current);
    if (op === "commit") { commit(attributes(rest), head ? [head] : []); continue; }
    if (op === "cherry-pick") {
      const attrs = attributes(rest), picked = commits.find(n => n.id === attrs.id);
      if (!picked || !head || picked.branch === current) syntax("cherry-pick needs an existing commit from another branch and a current head.");
      if (picked.parents.length > 1 && (!attrs.parent || !picked.parents.includes(attrs.parent))) syntax("Cherry-picking a merge needs an immediate parent id.");
      commit(attrs, [head], [`cherry-pick: ${picked.id}${attrs.parent ? ` parent: ${attrs.parent}` : ""}`], true);
      note("git-cherry-pick", "Cherry-pick provenance uses text; only the current head is an ancestry parent."); continue;
    }
    const token = TOKEN.exec(rest);
    if (!token) syntax(`${op} needs a branch name.`);
    const name = labelText(token[1]!), attrs = attributes(rest.slice(token[0].length));
    if (op === "branch") {
      if (branches.has(name)) syntax(`Duplicate branch "${name}".`);
      branches.set(name, head); current = name;
      branchOrder.set(name, attrs.order === undefined ? undefined : Number(attrs.order));
    } else if (op === "checkout" || op === "switch") {
      if (!branches.has(name)) syntax(`Unknown branch "${name}".`);
      current = name;
    } else {
      const other = branches.get(name);
      if (!other || !head || name === current || other === head) syntax("merge needs two distinct branch heads.");
      commit(attrs, [head, other], attrs.type === undefined ? ["merge"] : []);
      note("git-merge", "Merge commits reuse the lane marker and ancestry connectors; merge or type text replaces the double circle.");
    }
  }
  // Branches annotate their final heads, just like git-log marks; tags stay on their authored commits.
  if (showBranches) for (const [name, head] of branches) {
    const node = commits.find(n => n.id === head);
    if (node) (node.marks as string[]).unshift(name);
  }
  // Unordered branches precede explicitly ordered branches; stable ties keep
  // declaration order. Main defaults to zero, unless configured otherwise.
  const ordered = [...branchOrder].sort((a, b) => (a[1] ?? 0) - (b[1] ?? 0));
  const laneOfBranch = new Map(ordered.map(([name], index) => [name, index]));
  const laneOf = new Map(commits.map(node => [node.id, laneOfBranch.get(node.branch)!]));
  const dag = validateGlyphLaneDag({ nodes: [...commits].reverse().map(({ branch: _branch, ...node }) => node) });
  const direction = (header[1]?.toUpperCase() ?? "LR");
  if (direction === "LR") note("git-orientation", "GitGraph LR reads oldest first down compact vertical lanes to preserve room for labels at 72 columns.");
  const graph = validateGlyphGraph({ direction: direction === "BT" ? "BT" : "TB", nodes: dag.nodes.map(n => ({ id: n.id, label: [showLabels ? n.id : "", ...(n.marks ?? [])].filter(Boolean).join(" ") || "*", shape: "rounded" as const })), edges: dag.nodes.flatMap(n => n.parents.map(p => ({ from: p, to: n.id }))) });
  return { graph, notes, lanes: { dag, order: direction === "BT" ? "newest-first" : "oldest-first", ids: showLabels, laneOf } };
}
