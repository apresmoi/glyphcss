// Coalesce concurrent mounts, including React StrictMode's effect replay.
let runtime: Promise<typeof import("../../services/glyph-scene/mountGlyphDemo")> | undefined;

export function loadRuntime() {
  return (runtime ??= import("../../services/glyph-scene/mountGlyphDemo"));
}
