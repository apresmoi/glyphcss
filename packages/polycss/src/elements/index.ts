/**
 * polycss/elements — side-effect entry that registers the polycss custom
 * elements with `customElements`.
 *
 * Importing this module has the effect of making the elements available
 * in HTML. Re-imports are safe (idempotent registration check).
 *
 * In non-DOM environments (SSR, Node test runners without happy-dom),
 * `customElements` is undefined and we silently no-op so importing this
 * module doesn't crash the bundle.
 */
import { PolySceneElement } from "./PolySceneElement";
import { PolyMeshElement } from "./PolyMeshElement";
import { PolyPolygonElement } from "./PolyPolygonElement";
import { PolyAxesHelperElement } from "./PolyAxesHelperElement";
import { PolyDirectionalLightHelperElement } from "./PolyDirectionalLightHelperElement";
import { PolyControlsElement } from "./PolyControlsElement";

if (typeof customElements !== "undefined") {
  if (!customElements.get("poly-scene")) {
    customElements.define("poly-scene", PolySceneElement);
  }
  if (!customElements.get("poly-mesh")) {
    customElements.define("poly-mesh", PolyMeshElement);
  }
  if (!customElements.get("poly-polygon")) {
    customElements.define("poly-polygon", PolyPolygonElement);
  }
  if (!customElements.get("poly-axes-helper")) {
    customElements.define("poly-axes-helper", PolyAxesHelperElement);
  }
  if (!customElements.get("poly-directional-light-helper")) {
    customElements.define(
      "poly-directional-light-helper",
      PolyDirectionalLightHelperElement,
    );
  }
  if (!customElements.get("poly-controls")) {
    customElements.define("poly-controls", PolyControlsElement);
  }
}

export {
  PolySceneElement,
  PolyMeshElement,
  PolyPolygonElement,
  PolyAxesHelperElement,
  PolyDirectionalLightHelperElement,
  PolyControlsElement,
};
