/**
 * The atlas's base64 WOFF2 payload — the ONLY module that touches
 * `atlas-font.json`, and the only reason that file is separate from
 * `atlas.json`.
 *
 * Nothing may import this statically. `fontAtlas.ts` reaches it exclusively
 * through `import("./fontAtlasPayload")`, which is what keeps ~44KB of base64
 * out of `dist/index.js` (and out of every consumer's main chunk) until a
 * scene actually sets `colorEncoding: "atlas"`. A single static import
 * anywhere — including a test — silently undoes the whole split, so
 * `fontAtlas.lazy.test.ts` asserts this module has exactly one importer and
 * `bundle.atlas.test.ts` asserts the built chunk boundary directly.
 */
import atlasFont from "../../assets/glyph-atlas/atlas-font.json";

export const GLYPH_FONT_ATLAS_WOFF2_BASE64: string = atlasFont.woff2Base64;
