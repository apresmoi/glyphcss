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

// A dense glyph, so the probe below has plenty of covered pixels to read.
const ATLAS_PROBE_GLYPH = "@";
const ATLAS_PROBE_PX = 24;
// Palette slot 0's baked CPAL colour is a saturated hue (see `build-atlas.py`'s
// `hue_palette`), so "the painted pixels are CHROMATIC" cleanly separates a
// real COLR paint from both failure modes below. 24 is far above antialiasing
// noise and far below the ~216 spread slot 0 actually produces.
const ATLAS_PROBE_CHROMA = 24;

/**
 * Does this engine actually PAINT the atlas's COLR layers?
 *
 * `CSS.supports("font-palette", "--x")` — the cheap check a caller might reach
 * for — tests the wrong capability: it asks whether `font-palette` PARSES, not
 * whether COLR/CPAL renders. The two failure modes it cannot see are both
 * silent and both catastrophic, because every atlas base glyph has a
 * deliberately EMPTY outline (`build-atlas.py`) and all the ink lives in its
 * COLR layer:
 *
 *   - COLR-blind engine, font applied  -> every cell renders BLANK.
 *   - font never applied at all        -> every cell renders tofu boxes.
 *
 * So this rasterizes one atlas code point and asks whether the result is
 * chromatic. A blank canvas isn't (nothing painted); tofu isn't (it paints in
 * `fillStyle`, which the probe pins to black); a real COLR paint is, because
 * the colour comes from the font's own CPAL table rather than `fillStyle`.
 *
 * Returns `true` when it cannot conclude — no 2D context, no `getImageData`
 * (a headless or locked-down environment) — rather than demoting a browser it
 * simply failed to measure. Being wrong in that direction costs nothing here:
 * the website's own synchronous `CSS.supports` gate decides the DEFAULT, and
 * this is the safety net under it.
 */
function atlasColrPaints(target: Document): boolean {
  const canvas = target.createElement("canvas");
  canvas.width = ATLAS_PROBE_PX;
  canvas.height = ATLAS_PROBE_PX;
  const ctx = typeof canvas.getContext === "function" ? canvas.getContext("2d") : null;
  if (!ctx || typeof ctx.fillText !== "function" || typeof ctx.getImageData !== "function") return true;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, ATLAS_PROBE_PX, ATLAS_PROBE_PX);
  ctx.fillStyle = "#000000";
  ctx.font = `${ATLAS_PROBE_PX}px "${GLYPH_FONT_ATLAS.family}"`;
  ctx.textBaseline = "alphabetic";
  const glyphIndex = Math.max(0, GLYPH_FONT_ATLAS.glyphs.indexOf(ATLAS_PROBE_GLYPH));
  ctx.fillText(String.fromCodePoint(GLYPH_FONT_ATLAS.puaStart + glyphIndex), 0, ATLAS_PROBE_PX * 0.8);

  let pixels: Uint8ClampedArray;
  try {
    pixels = ctx.getImageData(0, 0, ATLAS_PROBE_PX, ATLAS_PROBE_PX).data;
  } catch {
    return true;
  }
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i]!, g = pixels[i + 1]!, b = pixels[i + 2]!;
    if (Math.max(r, g, b) - Math.min(r, g, b) > ATLAS_PROBE_CHROMA) return true;
  }
  return false;
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
 * is still decoding the WOFF2, and then checks that the engine really PAINTS
 * the atlas's COLR layers ({@link atlasColrPaints}). Resolves `false` — never
 * rejects — when the payload, the font, or COLR painting fails; the caller
 * stays on spans.
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
    if (typeof fonts?.load === "function") {
      try {
        const faces = await fonts.load(`16px "${GLYPH_FONT_ATLAS.family}"`, String.fromCodePoint(GLYPH_FONT_ATLAS.puaStart));
        if (faces.length === 0) return false;
      } catch {
        // A decode failure here is the same outcome as a missing payload: this
        // document stays on spans. `loadGlyphAtlasFontPayload` already warned if
        // the payload itself was the problem; warn for the font-decode case too.
        console.warn(`glyphcss: the colour-font atlas "${GLYPH_FONT_ATLAS.family}" failed to load in this document; colorEncoding "atlas" will render as "spans".`);
        return false;
      }
    }
    // The face decoded — but decoding is not painting. See `atlasColrPaints`.
    if (atlasColrPaints(target)) return true;
    console.warn(`glyphcss: this engine does not paint the colour-font atlas's COLR layers; colorEncoding "atlas" will render as "spans".`);
    return false;
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
