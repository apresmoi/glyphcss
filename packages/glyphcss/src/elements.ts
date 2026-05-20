/**
 * glyphcss/elements — side-effect entry that registers the glyphcss custom
 * elements with `customElements`.
 *
 * Importing this module has the effect of making the elements available
 * in HTML. Re-imports are safe (idempotent registration check).
 *
 * In non-DOM environments (SSR, Node test runners without happy-dom),
 * `customElements` is undefined and we silently no-op so importing this
 * module doesn't crash the bundle.
 */
import { GlyphSceneElement } from "./elements/GlyphSceneElement";
import { GlyphMeshElement } from "./elements/GlyphMeshElement";
import { GlyphHotspotElement } from "./elements/GlyphHotspotElement";
import { GlyphPerspectiveCameraElement } from "./elements/GlyphPerspectiveCameraElement";
import { GlyphOrthographicCameraElement } from "./elements/GlyphOrthographicCameraElement";
import { GlyphOrbitControlsElement } from "./elements/GlyphOrbitControlsElement";
import { GlyphMapControlsElement } from "./elements/GlyphMapControlsElement";

if (typeof customElements !== "undefined") {
  if (!customElements.get("glyph-scene")) {
    customElements.define("glyph-scene", GlyphSceneElement);
  }
  if (!customElements.get("glyph-mesh")) {
    customElements.define("glyph-mesh", GlyphMeshElement);
  }
  if (!customElements.get("glyph-hotspot")) {
    customElements.define("glyph-hotspot", GlyphHotspotElement);
  }
  if (!customElements.get("glyph-perspective-camera")) {
    customElements.define("glyph-perspective-camera", GlyphPerspectiveCameraElement);
  }
  if (!customElements.get("glyph-orthographic-camera")) {
    customElements.define("glyph-orthographic-camera", GlyphOrthographicCameraElement);
  }
  if (!customElements.get("glyph-orbit-controls")) {
    customElements.define("glyph-orbit-controls", GlyphOrbitControlsElement);
  }
  if (!customElements.get("glyph-map-controls")) {
    customElements.define("glyph-map-controls", GlyphMapControlsElement);
  }
}

export {
  GlyphSceneElement,
  GlyphMeshElement,
  GlyphHotspotElement,
  GlyphPerspectiveCameraElement,
  GlyphOrthographicCameraElement,
  GlyphOrbitControlsElement,
  GlyphMapControlsElement,
};
