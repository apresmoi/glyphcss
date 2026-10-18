import type { GlyphGraph, GlyphGraphNode, GlyphGraphEdge, GlyphGraphNodeShape } from "./types";
import { glyphDiagramError, validateGlyphGraph } from "./validate";
import { labelText } from "./mermaidText";
import { ledgerMermaidDegraded, type GlyphDiagramLedgerEntry } from "./ledger";
import { glyphMermaidTreeDocument, glyphMermaidTreeStatements } from "./mermaidTreeText";

const SHAPES: readonly [string, string, GlyphGraphNodeShape][] = [
  ["((", "))", "circle"], ["))", "((", "bang"],
  [")", "(", "cloud"], ["{{", "}}", "hexagon"],
  ["(", ")", "rounded"], ["[", "]", "rect"],
];
function syntax(message: string): never { return glyphDiagramError("GLYPH_MERMAID_MINDMAP_SYNTAX", message); }

export function glyphParseMermaidMindmap(source: string): { graph: GlyphGraph; notes: GlyphDiagramLedgerEntry[] } {
  const { body, config } = glyphMermaidTreeDocument(source, false), lines = glyphMermaidTreeStatements(body, false, false);
  if (lines.shift()?.trim() !== "mindmap") syntax("Expected a mindmap header.");
  const notes: GlyphDiagramLedgerEntry[] = [];
  const note = (kind: string, message: string) => { if (!notes.some(n => n.detail?.kind === kind)) notes.push(ledgerMermaidDegraded({ kind, message })); };
  if (config.trim()) note("mindmap-config", "Mindmap configuration is inert; the graph renderer controls layout and colors.");
  const nodes: GlyphGraphNode[] = [], edges: GlyphGraphEdge[] = [], stack: { indent: number; id: string }[] = [];
  for (const line of lines) {
    let text = line.trim();
    const indent = line.match(/^\s*/u)![0].replace(/\t/g, "    ").length;
    if (/^(?:::icon\(|:::)/.test(text)) { note("mindmap-assets", "Mindmap icons and CSS classes are inert; labels and tree connections remain."); continue; }
    // Suffixes are outside the quoted/shaped label; literal ::icon/::: text stays text.
    let quote = "", depth = 0, suffix = -1;
    for (let i = 0; i < text.length; i++) {
      const char = text[i]!;
      if (quote) { if (char === "\\") i++; else if (char === quote) quote = ""; continue; }
      if (char === '"') { quote = char; continue; }
      if (text.startsWith("::icon(", i) || text.startsWith(":::", i)) { if (depth === 0) { suffix = i; break; } }
      if ("[({".includes(char)) depth++;
      if ("])}".includes(char)) depth = Math.max(0, depth - 1);
    }
    // Bang/cloud delimiters are reversed, so their closing '(' must not hide suffixes.
    const reversed = /^(?:[^\s()[\]{}]+)?\)\)?[\s\S]*?\(\(?\s*(?=::)/.exec(text);
    if (reversed) suffix = reversed[0].length;
    if (suffix >= 0) { text = text.slice(0, suffix).trim(); note("mindmap-assets", "Mindmap icons and CSS classes are inert; labels and tree connections remain."); }
    if (!text) continue;
    let label = text, shape: GlyphGraphNodeShape = "rounded";
    const opening = /^(?:[^\s()[\]{}"`]+\s*)?([()[\]{}])/.exec(text);
    if (!opening) note("mindmap-default", "Unshaped mindmap nodes use the approved rounded family.");
    if (opening) {
      const offset = opening[0].length - 1;
      const candidate = SHAPES.find(([open]) => text.startsWith(open, offset));
      if (!candidate || !text.endsWith(candidate[1])) syntax(`Unclosed mindmap shape: ${text}`);
      label = text.slice(offset + candidate[0].length, -candidate[1].length); shape = candidate[2];
    }
    if (/"`/.test(label)) note("markdown", "Markdown strings render as plain text with line wrapping.");
    label = labelText(label);
    const id = `mindmap:${nodes.length}`;
    nodes.push({ id, label, shape });
    while (stack.length && stack[stack.length - 1]!.indent >= indent) stack.pop();
    const parent = stack[stack.length - 1];
    if (parent) edges.push({ from: parent.id, to: id, style: "undirected", endHead: "none" });
    else if (nodes.length > 1) syntax("A mindmap must have one root; indent child nodes beneath it.");
    stack.push({ indent, id });
  }
  if (!nodes.length) syntax("A mindmap needs a root node.");
  note("mindmap-layout", "Mindmap uses a left-to-right tree with undirected connectors instead of radial placement.");
  return { graph: validateGlyphGraph({ nodes, edges, direction: "LR" }), notes };
}
