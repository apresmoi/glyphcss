/**
 * polycss/elements — side-effect entry that registers <poly-scene>,
 * <poly-mesh>, <poly-polygon> with `customElements`.
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
}

export { PolySceneElement, PolyMeshElement, PolyPolygonElement };
