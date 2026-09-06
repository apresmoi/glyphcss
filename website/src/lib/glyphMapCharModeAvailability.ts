/**
 * Shared "does this /maps `charMode` actually do anything right now?"
 * check — the character-mode sibling of `glyphAtlasAvailability.ts`.
 * `charMode: "halfblock" | "quadrant"` both silently no-op under a specific,
 * real renderer condition (AGENTS.md's render-modes section); this module
 * turns that condition into the same `{ reason: string | null }` shape
 * `computeGlyphAtlasAvailability` returns, so the Dock's "Character mode"
 * control can disable itself with a REAL explanation instead of looking
 * live while doing nothing (the reported bug). Braille has no branch here —
 * with Terrain pinned to `solid` and no scene-wide render mode, Braille
 * (wireframe-only) can never do anything on `/maps`, so it's dropped from
 * the picker's own option list entirely (`MapsWorkbench.tsx`'s
 * `MAPS_CHAR_MODE_OPTIONS`) rather than modeled as a permanent no-op here.
 *
 * ── Halfblock/quadrant: unavailable while the shared cell hook is owned ──
 *
 * Both need a genuine subcell colour split and refuse to engage whenever
 * something else already owns the scene's one `transformCells` hook
 * (AGENTS.md: "a no-op alongside a transformCells hook"). `createGlyphMap`
 * (`packages/maps/src/widget.ts`'s `syncStrokeHookInstalled`) installs that
 * shared hook whenever a `line`/`contour` layer is mounted OR the sun's
 * day/night terminator is being stamped on a non-orbit (sheet) projection —
 * so this predicate reads all three real triggers, not just the two the
 * page's Borders/Contour toggles surface, since ignoring the sun coupling
 * would reintroduce exactly the kind of lie this module exists to remove
 * (a "toggle Borders/Contour off" message that's still wrong with Sun on).
 */

export interface GlyphMapCharModeAvailability {
  /** `null` when the current charMode is doing real work; otherwise the
   *  real, user-facing reason it silently isn't. */
  reason: string | null;
}

export interface GlyphMapCharModeGateInputs {
  charMode: "ascii" | "halfblock" | "quadrant";
  /** Borders (`line`) layer currently mounted. */
  bordersOn: boolean;
  /** Contour layer currently mounted. */
  contourOn: boolean;
  /** The sun's day/night terminator is currently being stamped through the
   *  shared cell hook — true only for `sunMode !== "off"` on a non-orbit
   *  (sheet) projection; an orbit (globe) projection lights the terminator
   *  as a real directional light instead and never installs the hook for
   *  it. */
  sunStampingTerminator: boolean;
}

function joinReadable(items: readonly string[]): string {
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

/**
 * Real availability check for the current `charMode` selection on `/maps`.
 * `"ascii"` is always available (the only encoding the atlas covers too).
 */
export function computeGlyphMapCharModeAvailability(gate: GlyphMapCharModeGateInputs): GlyphMapCharModeAvailability {
  if (gate.charMode === "ascii") return { reason: null };

  const sources: string[] = [];
  if (gate.bordersOn) sources.push("Borders");
  if (gate.contourOn) sources.push("Contour");
  if (gate.sunStampingTerminator) sources.push("Sun");
  if (sources.length === 0) return { reason: null };

  const label = gate.charMode === "halfblock" ? "Halfblock" : "Quadrant";
  const list = joinReadable(sources);
  const pronoun = sources.length === 1 ? "it" : "them";
  return {
    reason: `${label} needs its own sub-cell colour split, which is disabled while ${list} draw${sources.length === 1 ? "s" : ""} through the map's shared cell hook — turn ${pronoun} off to use ${label}.`,
  };
}
