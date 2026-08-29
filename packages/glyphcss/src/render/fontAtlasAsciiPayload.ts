/**
 * The ASCII atlas variant's base64 WOFF2 payload — the ONLY module that
 * touches `ascii-atlas-font.json`, mirroring `fontAtlasPayload.ts`'s contract
 * for the universal atlas exactly.
 *
 * Nothing may import this statically. `fontAtlas.ts` reaches it exclusively
 * through `import("./fontAtlasAsciiPayload")`, which keeps ~44KB of base64
 * out of `dist/index.js` (and out of every consumer's main chunk) until a
 * scene actually opts into `fontAtlas: GLYPH_FONT_ATLAS_ASCII` with
 * `colorEncoding: "atlas"`. A single static import anywhere — including a
 * test — silently undoes the split.
 */
import asciiAtlasFont from "../../assets/glyph-atlas/ascii-atlas-font.json";

export const GLYPH_FONT_ATLAS_WOFF2_BASE64: string = asciiAtlasFont.woff2Base64;
