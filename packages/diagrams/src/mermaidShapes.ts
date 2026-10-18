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
  ["rect", "notch-rect card notched-rectangle", true],
  ["cloud", "cloud", false],
  ["diamond", "hourglass collate", true],
  ["asymmetric", "bolt com-link lightning-bolt", true],
  ["rect", "brace brace-l comment", true],
  ["rect", "brace-r", true], ["rect", "braces", true],
  ["rect", "lean-r in-out lean-right", true], ["rect", "lean-l lean-left out-in", true],
  ["rounded", "delay half-rounded-rectangle", true],
  ["cylinder", "h-cyl das horizontal-cylinder", true], ["cylinder", "lin-cyl disk lined-cylinder", true],
  ["asymmetric", "curv-trap curved-trapezoid display", true],
  ["subroutine", "div-rect div-proc divided-process divided-rectangle", true],
  ["rect", "doc document", true], ["rect", "tri extract triangle", true],
  ["rect", "fork join", true], ["subroutine", "win-pane internal-storage window-pane", true],
  ["circle", "f-circ filled-circle junction", true], ["rect", "lin-doc lined-document", true],
  ["subroutine", "lin-rect lin-proc lined-process lined-rectangle shaded-process", true],
  ["rect", "notch-pent loop-limit notched-pentagon", true],
  ["rect", "flip-tri flipped-triangle manual-file", true], ["rect", "sl-rect manual-input sloped-rectangle", true],
  ["rect", "trap-t inv-trapezoid manual trapezoid-top", true],
  ["rect", "docs documents st-doc stacked-document", true],
  ["subroutine", "st-rect processes procs stacked-rectangle", true],
  ["asymmetric", "flag paper-tape", true], ["hexagon", "hex hexagon prepare", false],
  ["rect", "trap-b priority trapezoid trapezoid-bottom", true],
  ["circle", "sm-circ small-circle start", true], ["circle", "dbl-circ double-circle", true],
  ["circle", "fr-circ framed-circle stop", true], ["rect", "bow-rect bow-tie-rectangle stored-data", true],
  ["circle", "cross-circ crossed-circle summary", true],
  ["rect", "tag-doc tagged-document", true], ["rect", "tag-rect tag-proc tagged-process tagged-rectangle", true],
  ["rect", "text", true], ["bang", "bang", false],
  // Newer names also degrade without creating a second drawing vocabulary.
  ["rect", "browser", true], ["cylinder", "bucket", true], ["rect", "console", true],
  ["cylinder", "datastore data-store", true], ["rect", "folder directory", true], ["rounded", "person", true],
];
const shapes = new Map(families.flatMap(([shape, names, fallback]) => names.split(" ").map(name => [name, { shape, kind: names.split(" ")[0]!, fallback }] as const)));

export function glyphMermaidShape(name: string): { shape: GlyphGraphNodeShape; kind: string; fallback: boolean } {
  return shapes.get(name.toLowerCase()) ?? { shape: "rect", kind: name, fallback: true };
}
