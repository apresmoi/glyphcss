import { encodeGlyphBuffers, encodeStaticGlyphHtml } from "glyphcss";
import type { GlyphMapBands, GlyphMapCompileOptions, GlyphMapPresentation } from "./types";

function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return `#${[clamp(r), clamp(g), clamp(b)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Raster-space slope-difference shading — the flat-path hillshade (MAPS.md
 * §5, "One lighting owner only"). Horn's algorithm over grid-relative
 * central differences; `zFactor` absorbs the degree-vs-real-distance
 * mismatch a geographic (lon/lat) grid has no fixed conversion for, the same
 * role it plays in `gdaldem hillshade`. Edge and noData neighbors are
 * replicated from the center cell (zero local slope contribution from that
 * direction) rather than sampled out of bounds.
 */
function computeHillshade(bands: GlyphMapBands, opts: { azimuth: number; altitude: number; zFactor: number }): Float32Array {
  const { cols, rows, field } = bands;
  const shade = new Float32Array(cols * rows);
  const zenithRad = ((90 - opts.altitude) * Math.PI) / 180;
  const azimuthRad = (opts.azimuth * Math.PI) / 180;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const idx = row * cols + col;
      if (field.noData[idx]) { shade[idx] = 1; continue; }
      const c0 = field.values[idx];
      // Edge-replicated + noData-replicated neighbor: out of grid, or
      // itself noData, contributes zero local slope from that direction.
      const neighbor = (nCol: number, nRow: number): number => {
        if (nCol < 0 || nCol >= cols || nRow < 0 || nRow >= rows) return c0;
        const nIdx = nRow * cols + nCol;
        return field.noData[nIdx] ? c0 : field.values[nIdx];
      };
      const w = neighbor(col - 1, row);
      const e = neighbor(col + 1, row);
      const n = neighbor(col, row - 1);
      const s = neighbor(col, row + 1);
      const dzdx = (e - w) / 2;
      const dzdy = (s - n) / 2;
      const slopeRad = Math.atan(opts.zFactor * Math.sqrt(dzdx * dzdx + dzdy * dzdy));
      const aspectRad = Math.atan2(dzdy, -dzdx);
      const value = Math.cos(zenithRad) * Math.cos(slopeRad) + Math.sin(zenithRad) * Math.sin(slopeRad) * Math.cos(azimuthRad - aspectRad);
      shade[idx] = Math.max(0, Math.min(1, value));
    }
  }
  return shade;
}

/**
 * Bands → glyphs (MAPS.md §5). The pure path is `encodeGlyphBuffers` →
 * `encodeStaticGlyphHtml`, NOT `compileScene` — this slice has no polygons
 * or camera. Returns `{ html, css? }` because `encodeStaticGlyphHtml`
 * separates them in its smallest (class-based) mode.
 */
export function compileGlyphMap(bands: GlyphMapBands, presentation: GlyphMapPresentation, opts: GlyphMapCompileOptions = {}): { html: string; css?: string } {
  const { cols, rows } = bands;
  const ramp = presentation.ramp;
  const glyphAt = (band: number): string => ramp[band] ?? " ";
  const useColors = presentation.colors !== undefined;
  const shade = presentation.hillshade ? computeHillshade(bands, presentation.hillshade) : null;

  const char: string[] = new Array(cols * rows);
  const color: (string | null)[] = new Array(cols * rows);

  for (let i = 0; i < cols * rows; i++) {
    if (bands.noData[i]) {
      char[i] = presentation.noData ?? " ";
      color[i] = null;
      continue;
    }
    const band = bands.bands[i];
    const isWater = band === 0 && presentation.water !== undefined;
    char[i] = isWater ? (presentation.water ?? " ") : glyphAt(band);
    let cellColor = presentation.colors?.[band] ?? null;
    if (cellColor && shade) {
      const [r, g, b] = hexToRgb(cellColor);
      const s = shade[i];
      cellColor = rgbToHex(r * s, g * s, b * s);
    }
    color[i] = cellColor;
  }

  const inner = encodeGlyphBuffers(char, color, cols, rows, useColors, null, 0);
  return encodeStaticGlyphHtml(inner, opts.mode ?? "classes", { preClass: opts.preClass });
}
