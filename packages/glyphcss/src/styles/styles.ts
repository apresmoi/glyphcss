/**
 * glyphcss base stylesheet — injected once per Document.
 * Provides minimal positioning and monospace rendering for the ASCII output.
 * Full terminal aesthetic CSS lands in Phase 5.
 */
import { GLYPH_FONT_ATLAS, buildGlyphAtlasFontFaceCss, glyphAtlasFontPayload, loadGlyphAtlasFontPayload } from "../render/fontAtlas";

const GLYPH_STYLE_ID = "glyph-styles";

export function injectGlyphBaseStyles(doc?: Document): void {
  const target = doc ?? (typeof document !== "undefined" ? document : undefined);
  if (!target || target.getElementById(GLYPH_STYLE_ID)) return;
  const style = target.createElement("style");
  style.id = GLYPH_STYLE_ID;
  style.textContent = CORE_BASE_STYLES;
  target.head.appendChild(style);
}

/**
 * `colorEncoding: "atlas"` colour-font `@font-face` — injected once per
 * Document, same idempotent-by-id shape as {@link injectGlyphBaseStyles}.
 * Static and content-independent (the atlas font itself never changes), so
 * unlike the per-scene `@font-palette-values` block (created directly in
 * `createGlyphScene.ts`, since palette colours are per-scene data this
 * module has no business owning), this is the one piece of atlas CSS that
 * really is shared, injected-once, document-global state.
 */
const GLYPH_ATLAS_FONT_FACE_STYLE_ID = "glyph-atlas-font-face";

let atlasFontReady = new WeakMap<Document, Promise<boolean>>();

/**
 * Drop the per-document readiness cache. Test-only seam — not exported from
 * the package index — and the counterpart to `fontAtlas.ts`'s
 * `setGlyphAtlasFontPayloadImportForTests`: swapping the payload importer
 * without clearing this would leave a document pinned to the PREVIOUS test's
 * outcome (most damagingly, a cached `false` from a simulated load failure).
 */
export function resetGlyphAtlasFontFaceStylesForTests(): void {
  atlasFontReady = new WeakMap();
}

function injectAtlasFontFace(target: Document, woff2Base64: string): void {
  if (target.getElementById(GLYPH_ATLAS_FONT_FACE_STYLE_ID)) return;
  const style = target.createElement("style");
  style.id = GLYPH_ATLAS_FONT_FACE_STYLE_ID;
  style.textContent = buildGlyphAtlasFontFaceCss(woff2Base64);
  target.head.appendChild(style);
}

/**
 * Make the atlas `@font-face` available in `doc`, lazily fetching the WOFF2
 * payload (`render/fontAtlas.ts`) the first time any scene asks. Idempotent
 * and shared PER DOCUMENT — ten scenes on one page await one promise and
 * inject one `<style>`; the underlying payload import is shared process-wide
 * on top of that.
 *
 * Resolves `true` only when a scene may safely emit PUA code points, which is
 * strictly stronger than "the `<style>` exists": it also waits on
 * `document.fonts.load` for a real atlas code point, so the caller can't paint
 * a frame of PUA into a fallback monospace face (tofu boxes) while the browser
 * is still decoding the WOFF2. Resolves `false` — never rejects — when the
 * payload or the font itself fails to load; the caller stays on spans.
 */
export function ensureGlyphAtlasFontFaceStyles(doc?: Document): Promise<boolean> {
  const target = doc ?? (typeof document !== "undefined" ? document : undefined);
  if (!target) return Promise.resolve(false);
  const cached = atlasFontReady.get(target);
  if (cached) {
    // The READINESS is cached per document; the `<style>` is not, because it is
    // ordinary DOM that a consumer (or a test's cleanup) can remove after the
    // fact. Re-asserting it on the cached path keeps "idempotent" meaning
    // "always present afterwards", not "injected at most once ever".
    return cached.then((ready) => {
      const base64 = glyphAtlasFontPayload();
      if (ready && base64) injectAtlasFontFace(target, base64);
      return ready;
    });
  }

  const ready = loadGlyphAtlasFontPayload().then(async (base64) => {
    if (base64 === null) return false;
    injectAtlasFontFace(target, base64);
    // `FontFaceSet.load` is the only way to know the face has actually been
    // decoded. Probe with a real atlas code point rather than the default
    // test string: the atlas cmap covers U+0020 and its own PUA range only,
    // and a PUA glyph is what the encoder will actually emit.
    const fonts = (target as Document & { fonts?: FontFaceSet }).fonts;
    if (typeof fonts?.load !== "function") return true;
    try {
      const faces = await fonts.load(`16px "${GLYPH_FONT_ATLAS.family}"`, String.fromCodePoint(GLYPH_FONT_ATLAS.puaStart));
      return faces.length > 0;
    } catch {
      // A decode failure here is the same outcome as a missing payload: this
      // document stays on spans. `loadGlyphAtlasFontPayload` already warned if
      // the payload itself was the problem; warn for the font-decode case too.
      console.warn(`glyphcss: the colour-font atlas "${GLYPH_FONT_ATLAS.family}" failed to load in this document; colorEncoding "atlas" will render as "spans".`);
      return false;
    }
  });
  atlasFontReady.set(target, ready);
  return ready;
}

const CORE_BASE_STYLES = `
/* ── React / Vue host wrapper ────────────────────────────────────────── */

.glyph-host {
  /* Fill the camera wrapper so autoSize can observe a non-zero height. */
  width: 100%;
  height: 100%;
}

/* ── Glyphcss scene container ───────────────────────────────────────── */

.glyph-scene {
  position: relative;
  display: block;
  overflow: hidden;
  line-height: 1;
}

/* ── ASCII output <pre> ──────────────────────────────────────────────── */

.glyph-scene .glyph-output {
  /* inline-block so the box shrinks to the text's natural width. With display:
     block the pre inherits parent width, leaving empty space on the right, and
     cellW = preRect.width / cols overshoots the actual character cell — placing
     hotspots to the right of the rasterized glyph they're supposed to anchor. */
  display: inline-block;
  margin: 0;
  padding: 0;
  font-family: monospace;
  font-size: inherit;
  line-height: 1;
  white-space: pre;
  overflow: hidden;
}

/* Text isn't selectable by default — dragging orbits the camera instead of
   highlighting glyphs. Unscoped so it also covers compiled / static output
   (a bare .glyph-output with no .glyph-scene ancestor). Re-enable per scene
   with the glyph-selectable class (or your own user-select override). */
.glyph-output {
  user-select: none;
  -webkit-user-select: none;
}
.glyph-output.glyph-selectable {
  user-select: text;
  -webkit-user-select: text;
}

/* ── Hotspot overlay ─────────────────────────────────────────────────── */

.glyph-scene .glyph-hotspot-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  /* Isolate the stacking context so per-hotspot z-index values (derived from
     camera depth, sometimes negative) stay scoped INSIDE the layer. Without
     this, a negative-z-index hotspot would render below the sibling <pre>,
     hidden behind the rasterized glyphs. */
  isolation: isolate;
}

.glyph-scene .glyph-hotspot {
  position: absolute;
  pointer-events: all;
  cursor: pointer;
  /* Center the label on the projected anchor point rather than anchoring its
     top-left corner there. Without this, padding / label width visually offset
     the content from the 3D vertex being labelled. */
  transform: translate(-50%, -50%);
}
`;
