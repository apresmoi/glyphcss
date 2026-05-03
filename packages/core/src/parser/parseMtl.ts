/**
 * Wavefront `.mtl` material file parser. Companion to parseObj — reads the
 * material library that ships next to a `.obj` and returns a name → CSS
 * hex color map suitable for parseObj's `materialColors` option.
 *
 * We only read the `Kd r g b` (diffuse color) line per material. Specular,
 * ambient, alpha, illum model, and texture map paths are ignored — voxcss
 * doesn't have a use for them.
 *
 * Usage:
 *   const mtl = await fetch("/foo.mtl").then(r => r.text());
 *   const colors = parseMtl(mtl);
 *   const obj = await fetch("/foo.obj").then(r => r.text());
 *   const { voxels } = parseObj(obj, { materialColors: colors });
 */

const toHex = (n: number): string =>
  Math.round(Math.max(0, Math.min(1, n)) * 255).toString(16).padStart(2, "0");

export function parseMtl(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  let currentName: string | null = null;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.length === 0 || line.charCodeAt(0) === 35) continue; // skip "" and "#"
    if (line.startsWith("newmtl ")) {
      currentName = line.slice(7).trim();
      continue;
    }
    if (currentName && line.startsWith("Kd ")) {
      const parts = line.split(/\s+/);
      const r = parseFloat(parts[1]);
      const g = parseFloat(parts[2]);
      const b = parseFloat(parts[3]);
      if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) {
        out[currentName] = `#${toHex(r)}${toHex(g)}${toHex(b)}`;
      }
    }
  }
  return out;
}
