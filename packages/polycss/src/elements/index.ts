/**
 * @layoutit/polycss/elements — side-effect entry that registers the polycss custom
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
import { PolyOrbitControlsElement } from "./PolyOrbitControlsElement";
import { PolyMapControlsElement } from "./PolyMapControlsElement";
import { PolyPerspectiveCameraElement } from "./PolyPerspectiveCameraElement";
import { PolyOrthographicCameraElement } from "./PolyOrthographicCameraElement";
import { PolyTransformControlsElement } from "./PolyTransformControlsElement";
import { PolySelectElement } from "./PolySelectElement";

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
  if (!customElements.get("poly-orbit-controls")) {
    customElements.define("poly-orbit-controls", PolyOrbitControlsElement);
  }
  if (!customElements.get("poly-map-controls")) {
    customElements.define("poly-map-controls", PolyMapControlsElement);
  }
  if (!customElements.get("poly-perspective-camera")) {
    customElements.define("poly-perspective-camera", PolyPerspectiveCameraElement);
  }
  if (!customElements.get("poly-orthographic-camera")) {
    customElements.define("poly-orthographic-camera", PolyOrthographicCameraElement);
  }
  if (!customElements.get("poly-transform-controls")) {
    customElements.define("poly-transform-controls", PolyTransformControlsElement);
  }
  if (!customElements.get("poly-select")) {
    customElements.define("poly-select", PolySelectElement);
  }
}

export {
  PolySceneElement,
  PolyMeshElement,
  PolyPolygonElement,
  PolyAxesHelperElement,
  PolyDirectionalLightHelperElement,
  PolyOrbitControlsElement,
  PolyMapControlsElement,
  PolyPerspectiveCameraElement,
  PolyOrthographicCameraElement,
  PolyTransformControlsElement,
  PolySelectElement,
};
