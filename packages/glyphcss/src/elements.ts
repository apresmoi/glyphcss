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
import { GlyphcssSceneElement } from "./elements/GlyphcssSceneElement";
import { GlyphcssMeshElement } from "./elements/GlyphcssMeshElement";
import { GlyphcssHotspotElement } from "./elements/GlyphcssHotspotElement";
import { GlyphcssPerspectiveCameraElement } from "./elements/GlyphcssPerspectiveCameraElement";
import { GlyphcssOrthographicCameraElement } from "./elements/GlyphcssOrthographicCameraElement";
import { GlyphcssOrbitControlsElement } from "./elements/GlyphcssOrbitControlsElement";
import { GlyphcssMapControlsElement } from "./elements/GlyphcssMapControlsElement";

if (typeof customElements !== "undefined") {
  if (!customElements.get("glyphcss-scene")) {
    customElements.define("glyphcss-scene", GlyphcssSceneElement);
  }
  if (!customElements.get("glyphcss-mesh")) {
    customElements.define("glyphcss-mesh", GlyphcssMeshElement);
  }
  if (!customElements.get("glyphcss-hotspot")) {
    customElements.define("glyphcss-hotspot", GlyphcssHotspotElement);
  }
  if (!customElements.get("glyphcss-perspective-camera")) {
    customElements.define("glyphcss-perspective-camera", GlyphcssPerspectiveCameraElement);
  }
  if (!customElements.get("glyphcss-orthographic-camera")) {
    customElements.define("glyphcss-orthographic-camera", GlyphcssOrthographicCameraElement);
  }
  if (!customElements.get("glyphcss-orbit-controls")) {
    customElements.define("glyphcss-orbit-controls", GlyphcssOrbitControlsElement);
  }
  if (!customElements.get("glyphcss-map-controls")) {
    customElements.define("glyphcss-map-controls", GlyphcssMapControlsElement);
  }
}

export {
  GlyphcssSceneElement,
  GlyphcssMeshElement,
  GlyphcssHotspotElement,
  GlyphcssPerspectiveCameraElement,
  GlyphcssOrthographicCameraElement,
  GlyphcssOrbitControlsElement,
  GlyphcssMapControlsElement,
};
