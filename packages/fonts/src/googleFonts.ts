/**
 * Browser-side loading helpers. These are the only part of the package that
 * touches the network (`fetch`); the parse + extrude core stays pure.
 *
 * Fonts come from the Fontsource API/CDN, which mirrors every Google font and
 * serves plain **.ttf** with open CORS — exactly what `parseFont` needs
 * (Google's default woff2 is not supported). No API key required.
 */
import { parseFont, type ParsedFont } from "./parseFont";

export interface FontEntry {
  id: string;
  family: string;
  weights: number[];
  styles: string[];
  subsets: string[];
  defSubset: string;
  category: string;
  type: string;
}

const FONTS_API = "https://api.fontsource.org/v1/fonts";
const WEIGHT_PREFERENCE = [700, 400, 500, 600, 800, 300, 900, 200, 100];

let cache: FontEntry[] | null = null;

/** All Google fonts that ship a normal (upright) style, sorted by family. */
export async function listGoogleFonts(): Promise<FontEntry[]> {
  if (cache) return cache;
  const res = await fetch(FONTS_API);
  if (!res.ok) throw new Error(`font list ${res.status}`);
  const all = (await res.json()) as FontEntry[];
  cache = all
    .filter((f) => f.type === "google" && f.styles.includes("normal"))
    .sort((a, b) => a.family.localeCompare(b.family));
  return cache;
}

/** Pick the requested weight if available, else the closest sensible default. */
export function pickWeight(font: FontEntry, preferred?: number): number {
  if (preferred && font.weights.includes(preferred)) return preferred;
  for (const w of WEIGHT_PREFERENCE) {
    if (font.weights.includes(w)) return w;
  }
  return font.weights[0] ?? 400;
}

export type FontStyle = "normal" | "italic";

/** Direct .ttf URL for a font at a given weight/style (open CORS, parseFont-ready). */
export function googleFontUrl(font: FontEntry, weight?: number, style: FontStyle = "normal"): string {
  const w = pickWeight(font, weight);
  const subset = font.subsets.includes("latin") ? "latin" : font.defSubset;
  const s = style === "italic" && font.styles.includes("italic") ? "italic" : "normal";
  return `https://cdn.jsdelivr.net/fontsource/fonts/${font.id}@latest/${subset}-${w}-${s}.ttf`;
}

/** Fetch a .ttf from any URL and parse it into a `ParsedFont`. */
export async function loadFont(url: string): Promise<ParsedFont> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`load font ${res.status}: ${url}`);
  return parseFont(await res.arrayBuffer());
}

/** Fetch + parse a specific Google font family/weight/style. */
export async function loadGoogleFont(font: FontEntry, weight?: number, style: FontStyle = "normal"): Promise<ParsedFont> {
  return loadFont(googleFontUrl(font, weight, style));
}
