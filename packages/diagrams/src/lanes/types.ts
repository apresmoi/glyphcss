/**
 * The lane-DAG IR. Deliberately domain-agnostic: "nodes with parents,
 * ordered in time, allocated to lanes." A git commit graph is the familiar
 * instance (git log --graph), but the same shape fits a release train, a CI
 * pipeline's parallel stages, or a data-lineage graph — anything shaped like
 * a branching-and-merging process walked in time order. No `commit`/`sha`/
 * `branch`/`ref`/`author` vocabulary anywhere in this file.
 */

/**
 * `parents` are OLDER nodes — nodes that must appear LATER in the array
 * (see `GlyphLaneDag.nodes`'s own doc on array order). Two or more parents
 * is a branch point (this node is where history diverges going backward in
 * time); two or more nodes naming the same parent is a merge point (this
 * parent is where history converges).
 */
export interface GlyphLaneNode {
  readonly id: string;
  readonly label: string;
  readonly parents: readonly string[];
  /** Caller-owned annotations (what git would spend on tags/heads) — opaque, rendered verbatim, never interpreted. */
  readonly marks?: readonly string[];
}

/**
 * `nodes` is ordered NEWEST FIRST, exactly like `git log`'s own default
 * order: `nodes[0]` is the most recent, and every `parents` reference points
 * to an id that occurs LATER in this same array (an older node). This is
 * what makes "array order is time" a structural invariant rather than a
 * convention a caller could violate silently — `validateGlyphLaneDag`
 * rejects a parent reference that doesn't strictly follow its child.
 */
export interface GlyphLaneDag {
  readonly nodes: readonly GlyphLaneNode[];
}
