/**
 * The braille-dots atlas's base64 WOFF2 payload — the ONLY module that touches
 * `braille-dots-atlas-font.json`, mirroring `fontAtlasPayload.ts`'s contract.
 *
 * Nothing may import this statically. `fontAtlas.ts` reaches it exclusively
 * through `import("./fontAtlasBrailleDotsPayload")`, which keeps ~49KB of
 * base64 out of every consumer's main chunk until a caller names
 * `GLYPH_FONT_ATLAS_BRAILLE_DOTS` (today: `@glyphcss/fluid`).
 */
import brailleDotsAtlasFont from "../../assets/glyph-atlas/braille-dots-atlas-font.json";

export const GLYPH_FONT_ATLAS_WOFF2_BASE64: string = brailleDotsAtlasFont.woff2Base64;
