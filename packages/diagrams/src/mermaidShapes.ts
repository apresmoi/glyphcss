import type { GlyphGraphNodeShape } from "./types";

// Canonical names keep one ledger note per fallback kind, regardless of aliases.
const families: readonly [GlyphGraphNodeShape, string, boolean][] = [
  ["rect", "rect proc process rectangle", false],
  ["rounded", "rounded event", false],
  ["stadium", "stadium pill terminal", false],
  ["subroutine", "fr-rect framed-rectangle subproc subprocess subroutine", false],
  ["cylinder", "cyl cylinder database db", false],
  ["circle", "circle circ", false],
  ["diamond", "diam decision diamond question", false],
  ["asymmetric", "odd", false],
  ["notch-rect", "notch-rect card notched-rectangle", false],
  ["cloud", "cloud", false],
  ["hourglass", "hourglass collate", false],
  ["bolt", "bolt com-link lightning-bolt", false],
  ["brace", "brace brace-l comment", false],
  ["brace-r", "brace-r", false], ["braces", "braces", false],
  ["lean-r", "lean-r in-out lean-right", false], ["lean-l", "lean-l lean-left out-in", false],
  ["delay", "delay half-rounded-rectangle", false],
  ["h-cyl", "h-cyl das horizontal-cylinder", false], ["lin-cyl", "lin-cyl disk lined-cylinder", false],
  ["curv-trap", "curv-trap curved-trapezoid display", false],
  ["div-rect", "div-rect div-proc divided-process divided-rectangle", false],
  ["doc", "doc document", false], ["tri", "tri extract triangle", false],
  ["fork", "fork join", false], ["subroutine", "win-pane internal-storage window-pane", true],
  ["f-circ", "f-circ filled-circle junction", false], ["rect", "lin-doc lined-document", true],
  ["lin-rect", "lin-rect lin-proc lined-process lined-rectangle shaded-process", false],
  ["notch-pent", "notch-pent loop-limit notched-pentagon", false],
  ["flip-tri", "flip-tri flipped-triangle manual-file", false], ["rect", "sl-rect manual-input sloped-rectangle", true],
  ["trap-t", "trap-t inv-trapezoid manual trapezoid-top", false],
  ["docs", "docs documents st-doc stacked-document", false],
  ["st-rect", "st-rect processes procs stacked-rectangle", false],
  ["flag", "flag paper-tape", false], ["hexagon", "hex hexagon prepare", false],
  ["trap-b", "trap-b priority trapezoid trapezoid-bottom", false],
  ["sm-circ", "sm-circ small-circle start", false], ["dbl-circ", "dbl-circ double-circle", false],
  ["fr-circ", "fr-circ framed-circle stop", false], ["bow-rect", "bow-rect bow-tie-rectangle stored-data", false],
  ["cross-circ", "cross-circ crossed-circle summary", false],
  ["tag-doc", "tag-doc tagged-document", false], ["tag-rect", "tag-rect tag-proc tagged-process tagged-rectangle", false],
  ["text", "text", false], ["bang", "bang", false],
  // Application shells use the same reviewed catalogue as flowchart shapes.
  ["browser", "browser", false], ["bucket", "bucket", false], ["console", "console", false],
  ["datastore", "datastore data-store", false], ["rect", "folder directory", true], ["person", "person", false],
];
const shapes = new Map(families.flatMap(([shape, names, fallback]) => names.split(" ").map(name => [name, { shape, kind: names.split(" ")[0]!, fallback }] as const)));

export function glyphMermaidShape(name: string): { shape: GlyphGraphNodeShape; kind: string; fallback: boolean } {
  return shapes.get(name.toLowerCase()) ?? { shape: "rect", kind: name, fallback: true };
}
