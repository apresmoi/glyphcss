/**
 * The shared label arbiter (PLAN-3d.md §3.2 "Labels, ticks and legends when
 * the chart is one object among many").
 *
 * The scene owns ONE arbiter per output grid per frame (`createGlyphScene`
 * builds a fresh one inside `applyGlyphSceneObjectOverlays`, before running
 * any overlay's `stamp()` for that grid) so two charts sharing a scene never
 * overwrite each other's labels — the whole reason this lives at the SCENE
 * layer rather than inside each object's own overlay.
 *
 * Two-phase, like `@glyphcss/maps`' `glyphMapDeclutterLabels` (that
 * function is the model this generalizes, not a dependency — glyphcss
 * cannot import `@glyphcss/maps`): every overlay that wants a label calls
 * `place()` during `stamp()`, which only REGISTERS a candidate; nothing
 * paints until the scene calls `resolve(grid)` once every overlay for this
 * grid has run. Two-phase is required, not a style choice — greedy
 * PRIORITY-first resolution needs the whole candidate set up front, and
 * overlays run in registry order, not priority order.
 *
 * Resolution order is `(priority desc, id asc)` — PLAN-3d.md §3.2's own
 * words are "priority first, then stable id" — deliberately NOT candidate
 * registration index, unlike `glyphMapDeclutterLabels`' own tie-break:
 * registration index is a function of overlay MOUNT order, and two objects
 * mounted in either order must resolve an equal-priority tie identically.
 */
import type { CellGrid } from "../cells";
import { stampGlyphOverlayCell } from "./stamp";

export interface GlyphLabelCandidate {
  readonly id: string;
  readonly priority: number;
  readonly col: number;
  readonly row: number;
  readonly text: string;
  readonly color?: string;
  /**
   * This label's own object's mesh ids — see AGENTS.md's "Occlusion" clause:
   * a label hides iff the cell AT ITS ANCHOR is won (`CellGrid.winnerMesh`)
   * by a mesh NOT in this set. Omitted, or `grid.winnerMesh` absent
   * (non-solid mode, or nothing requested the buffer): never hidden.
   */
  readonly ownMeshIds?: ReadonlySet<number>;
  /** Optional depth test at the anchor, same convention as `stampGlyphOverlayCell`. */
  readonly depth?: number;
}

export interface GlyphLabelArbiter {
  place(candidate: GlyphLabelCandidate): void;
}

interface PlacedBox { col: number; row: number; width: number; }

interface GlyphLabelArbiterInternal extends GlyphLabelArbiter {
  resolve(grid: CellGrid): void;
}

/**
 * Fold to printable ASCII — following the atlas rule (AGENTS.md's font
 * atlas: every solid-mode glyph a scene emits must be in whatever atlas is
 * active, or the whole scene falls back to span encoding for that frame; an
 * overlay label folds unconditionally rather than risk being the one glyph
 * that flips an atlas-encoding scene back to spans). NFD + strip combining
 * marks first (so an accented letter degrades to its base letter, not `?`),
 * then any remaining non-printable-ASCII code point becomes `?`.
 */
export function foldGlyphOverlayLabelToAscii(text: string): string {
  const stripped = text.normalize("NFD").replace(/[̀-ͯ]/g, "");
  let out = "";
  for (const ch of stripped) {
    const cp = ch.codePointAt(0)!;
    out += cp >= 0x20 && cp <= 0x7e ? ch : "?";
  }
  return out;
}

function boxesOverlap(a: PlacedBox, b: PlacedBox): boolean {
  return !(a.col + a.width <= b.col || a.col >= b.col + b.width || a.row !== b.row);
}

export function createGlyphLabelArbiter(): GlyphLabelArbiterInternal {
  const candidates: GlyphLabelCandidate[] = [];
  return {
    place(candidate: GlyphLabelCandidate): void {
      candidates.push(candidate);
    },
    resolve(grid: CellGrid): void {
      // Tie-break on the candidate's own STABLE id (PLAN-3d.md §3.2: "greedy:
      // priority first, then stable id"), never on registration/mount order
      // — two objects composed in either mount order must resolve identically
      // (P2-c, fix round 1).
      const ordered = [...candidates]
        .sort((a, b) => b.priority - a.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      const placed: PlacedBox[] = [];
      const winnerMesh = grid.winnerMesh;
      for (const c of ordered) {
        const text = foldGlyphOverlayLabelToAscii(c.text);
        if (text.length === 0) continue;
        if (c.col < 0 || c.row < 0 || c.row >= grid.rows || c.col >= grid.cols) continue;
        // Occlusion: a label hides behind a mesh that isn't its own.
        if (c.ownMeshIds && winnerMesh) {
          const winner = winnerMesh[c.row * grid.cols + c.col];
          if (winner !== undefined && winner !== -1 && !c.ownMeshIds.has(winner)) continue;
        }
        const box: PlacedBox = { col: c.col, row: c.row, width: text.length };
        if (placed.some((p) => boxesOverlap(box, p))) continue;
        placed.push(box);
        for (let i = 0; i < text.length; i++) {
          stampGlyphOverlayCell(grid, {
            col: c.col + i,
            row: c.row,
            char: text[i]!,
            ...(c.color !== undefined ? { color: c.color } : {}),
            ...(c.depth !== undefined ? { depth: c.depth } : {}),
          });
        }
      }
    },
  };
}
