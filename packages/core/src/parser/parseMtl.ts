/**
 * Wavefront `.mtl` material file parser. Companion to parseObj — reads the
 * material library that ships next to a `.obj` and returns per-material
 * diffuse color (`Kd`) and optional diffuse texture map path (`map_Kd`).
 *
 * Usage:
 *   const mtl = await fetch("/foo.mtl").then(r => r.text());
 *   const { colors, textures } = parseMtl(mtl);
 *   const obj = await fetch("/foo.obj").then(r => r.text());
 *   const { polygons } = parseObj(obj, { materialColors: colors, materialTextures: textures });
 *
 * Texture paths are returned exactly as written in the .mtl — relative paths,
 * Windows backslashes etc. are not normalized. Callers are expected to
 * resolve them against the .mtl's base URL.
 *
 * NOTE: parseMtl intentionally returns its own `MtlParseResult` shape
 * (NOT the unified `ParseResult`). It's an asymmetric helper — it emits
 * materials, not polygons — and forcing it into ParseResult would mean
 * an empty `polygons[]` and a misleading `dispose()`. The migration plan
 * (POLYCSS_MIGRATION.md §"parseMtl special case") calls out this carve-out
 * explicitly.
 */

const toHex = (n: number): string =>
  Math.round(Math.max(0, Math.min(1, n)) * 255).toString(16).padStart(2, "0");

export interface MtlParseResult {
  /** Material name → CSS hex color (from `Kd r g b`). */
  colors: Record<string, string>;
  /** Material name → texture path (from `map_Kd <path>`). Path is unresolved. */
  textures: Record<string, string>;
}

export function parseMtl(text: string): MtlParseResult {
  const colors: Record<string, string> = {};
  const textures: Record<string, string> = {};
  let currentName: string | null = null;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.length === 0 || line.charCodeAt(0) === 35) continue; // skip "" and "#"
    if (line.startsWith("newmtl ")) {
      currentName = line.slice(7).trim();
      continue;
    }
    if (!currentName) continue;
    if (line.startsWith("Kd ")) {
      const parts = line.split(/\s+/);
      const r = parseFloat(parts[1]);
      const g = parseFloat(parts[2]);
      const b = parseFloat(parts[3]);
      if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) {
        colors[currentName] = `#${toHex(r)}${toHex(g)}${toHex(b)}`;
      }
    } else if (line.startsWith("map_Kd ")) {
      // map_Kd may carry options before the path (e.g. `map_Kd -s 1 1 1 wood.png`).
      // Take the last whitespace-separated token as the path; that's how
      // virtually every real-world MTL writes it. Windows-exported MTLs use
      // backslashes — normalize to forward slashes so URL resolution works
      // in the browser.
      const parts = line.split(/\s+/);
      const path = parts[parts.length - 1]?.replace(/\\+/g, "/");
      if (path && path !== "map_Kd") textures[currentName] = path;
    }
  }
  return { colors, textures };
}
