import type { GlyphLaneDag, GlyphLaneNode } from "./types";
import { glyphDiagramError } from "../validate";
import { validateGlyphLaneDag } from "./validate";

function syntax(message: string): never { return glyphDiagramError("GLYPH_LANE_GIT_SYNTAX", message); }

/**
 * Optional adapter mapping `git log --pretty=format:"%h|%p|%d|%s"` output
 * onto the agnostic IR — kept out of `layout.ts`/`paint.ts` the same way
 * `sequence/mermaid.ts` keeps Mermaid syntax out of the sequence layout/
 * paint pair. git is the FAMILIAR instance of a lane DAG this form was
 * designed against, never a vocabulary the IR itself knows about: this file
 * is the only place in the lane-DAG form that reads a `%p`-style
 * space-separated parent list or a `(HEAD -> main, tag: v1)` decoration
 * string. A caller modelling a release train, a CI run, or a lineage graph
 * builds a `GlyphLaneDag` directly and never touches this file.
 *
 * Expects one commit per line, NEWEST FIRST (`git log`'s own default
 * order — see `types.ts`'s own doc on `GlyphLaneDag.nodes`), and every
 * referenced parent present somewhere in the same output: a truncated
 * window (`git log -20`) that cuts off a parent fails the same
 * `unknown-parent` integrity check a hand-authored JSON document would —
 * use `git log --all` or a deep-enough `-n` for a self-contained window.
 */
export function glyphLaneDagFromGitLog(source: string): GlyphLaneDag {
  if (typeof source !== "string") syntax("git log source must be a string.");
  const lines = source.split(/\r\n|\r|\n/).map((line) => line.trim()).filter((line) => line.length > 0);
  if (lines.length === 0) syntax('Expected at least one "id|parents|decoration|subject" line.');
  const nodes: GlyphLaneNode[] = lines.map((line) => {
    const parts = line.split("|");
    if (parts.length < 4) syntax(`Expected "id|parents|decoration|subject", got: "${line}".`);
    const [id, parentField, decoration, ...subjectParts] = parts;
    if (!id?.trim()) syntax(`Missing id in line: "${line}".`);
    const parents = (parentField ?? "").trim().split(/\s+/).filter((p) => p.length > 0);
    const marks = (decoration ?? "").trim().replace(/^\(|\)$/g, "").split(",")
      .map((mark) => mark.trim().replace(/^HEAD\s*->\s*/, "").replace(/^tag:\s*/, ""))
      .filter((mark) => mark.length > 0);
    return { id: id!.trim(), label: subjectParts.join("|").trim(), parents, ...(marks.length ? { marks } : {}) };
  });
  return validateGlyphLaneDag({ nodes });
}
