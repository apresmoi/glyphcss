/**
 * createPolyScene — imperative scene API. The vanilla counterpart to
 * `<PolyScene>` in React / Vue.
 *
 * Per §API freeze: takes a host element + scene options, returns a
 * `SceneHandle` whose `add(parseResult, transform?)` mounts a mesh under
 * the scene root and returns a removable `MeshHandle`.
 *
 * Implementation:
 *   - Inserts a `<div class="polycss-scene">` into the host.
 *   - Each `add(...)` creates a `<div class="polycss-mesh">` with the
 *     mesh transform; mounts each polygon as a child SVG/img via
 *     `renderPoly` from `../render/polyDOM`.
 *   - `destroy()` removes the scene element and disposes every mesh
 *     (which in turn disposes per-polygon blob URLs).
 */
import type {
  DirectionalLight,
  ParseResult,
  Polygon,
  ProjectionMode,
  Vec3,
} from "@polycss/core";
import { mergePolygons } from "@polycss/core";
import { renderPoly, type RenderedPoly } from "../render/polyDOM";
import { injectBaseStyles } from "../styles/styles";

export interface PolySceneOptions {
  perspective?: number;
  rotX?: number;
  rotY?: number;
  zoom?: number;
  projection?: ProjectionMode;
  directionalLight?: DirectionalLight;
  /** Mesh post-processing — `"auto"` runs `mergePolygons`, `"off"` passes through. */
  merge?: "off" | "auto";
}

export interface MeshTransform {
  position?: Vec3;
  scale?: number | Vec3;
  rotation?: Vec3;
}

export interface MeshHandle {
  /** The polygons that were loaded (post-merge if scene merge is enabled). */
  polygons: Polygon[];
  /** Remove the mesh from the scene. */
  remove(): void;
  /** Update transform without re-parsing. */
  setTransform(t: Partial<MeshTransform>): void;
  /** Revoke any blob URLs the parse created. Idempotent. */
  dispose(): void;
}

export interface SceneHandle {
  /** Add a mesh to the scene. Returns a handle for later removal. */
  add(mesh: ParseResult, opts?: MeshTransform): MeshHandle;
  /** Update scene-level config (rotation, lighting, etc.). */
  setOptions(partial: Partial<PolySceneOptions>): void;
  /** Tear down the scene; revokes all blob URLs of registered meshes. */
  destroy(): void;
}

const DEFAULT_PERSPECTIVE = 1000;
const DEFAULT_ROT_X = 65;
const DEFAULT_ROT_Y = 45;
const DEFAULT_ZOOM = 1;

function buildMeshTransform(t: MeshTransform): string | undefined {
  const parts: string[] = [];
  if (t.position) {
    parts.push(
      `translate3d(${t.position[0]}px, ${t.position[1]}px, ${t.position[2]}px)`
    );
  }
  if (t.scale !== undefined) {
    if (typeof t.scale === "number") {
      if (t.scale !== 1) parts.push(`scale3d(${t.scale}, ${t.scale}, ${t.scale})`);
    } else {
      parts.push(`scale3d(${t.scale[0]}, ${t.scale[1]}, ${t.scale[2]})`);
    }
  }
  if (t.rotation) {
    if (t.rotation[0]) parts.push(`rotateX(${t.rotation[0]}deg)`);
    if (t.rotation[1]) parts.push(`rotateY(${t.rotation[1]}deg)`);
    if (t.rotation[2]) parts.push(`rotateZ(${t.rotation[2]}deg)`);
  }
  return parts.length > 0 ? parts.join(" ") : undefined;
}

function buildSceneTransform(opts: PolySceneOptions): string {
  const rotX = opts.rotX ?? DEFAULT_ROT_X;
  const rotY = opts.rotY ?? DEFAULT_ROT_Y;
  const zoom = opts.zoom ?? DEFAULT_ZOOM;
  return `scale(${zoom}) rotateX(${rotX}deg) rotateY(${rotY}deg)`;
}

export function createPolyScene(
  host: HTMLElement,
  options: PolySceneOptions = {},
): SceneHandle {
  if (!host || typeof host.appendChild !== "function") {
    throw new Error("createPolyScene: host must be an HTMLElement");
  }

  // Inject base styles into the host's owning document so .polycss-scene
  // has perspective + preserve-3d defaults.
  if (host.ownerDocument) injectBaseStyles(host.ownerDocument);

  let currentOptions: PolySceneOptions = { ...options };

  const sceneEl = (host.ownerDocument ?? document).createElement("div");
  sceneEl.className = "polycss-scene";
  applySceneStyle(sceneEl, currentOptions);
  host.appendChild(sceneEl);

  interface MeshEntry {
    handle: MeshHandle;
    wrapper: HTMLDivElement;
    parseResult: ParseResult;
    rendered: RenderedPoly[];
    disposed: boolean;
  }
  const meshes = new Set<MeshEntry>();

  function applySceneStyle(el: HTMLElement, opts: PolySceneOptions): void {
    el.style.position = "relative";
    el.style.transformStyle = "preserve-3d";
    el.style.perspective = `${opts.perspective ?? DEFAULT_PERSPECTIVE}px`;
    el.style.transform = buildSceneTransform(opts);
  }

  function add(parseResult: ParseResult, transformIn: MeshTransform = {}): MeshHandle {
    const doc = sceneEl.ownerDocument ?? document;
    const wrapper = doc.createElement("div");
    wrapper.className = "polycss-mesh";
    wrapper.style.position = "absolute";
    wrapper.style.transformStyle = "preserve-3d";

    let transform: MeshTransform = { ...transformIn };
    const css = buildMeshTransform(transform);
    if (css) wrapper.style.transform = css;

    // Optional auto-merge per scene option.
    const sourcePolygons =
      currentOptions.merge === "auto"
        ? mergePolygons(parseResult.polygons)
        : parseResult.polygons;

    const rendered: RenderedPoly[] = [];
    for (const poly of sourcePolygons) {
      const r = renderPoly(poly, {
        directionalLight: currentOptions.directionalLight,
      });
      if (!r) continue;
      wrapper.appendChild(r.element);
      rendered.push(r);
    }

    sceneEl.appendChild(wrapper);

    const entry: MeshEntry = {
      handle: undefined as unknown as MeshHandle,
      wrapper,
      parseResult,
      rendered,
      disposed: false,
    };

    const handle: MeshHandle = {
      polygons: sourcePolygons,
      remove() {
        if (wrapper.parentNode) wrapper.parentNode.removeChild(wrapper);
        // Removing from DOM doesn't auto-dispose blob URLs — call dispose()
        // for that. But we DO drop the per-poly cleanup so a re-mount
        // doesn't leak.
        for (const r of rendered) {
          try { r.dispose(); } catch { /* ignore */ }
        }
        rendered.length = 0;
        meshes.delete(entry);
      },
      setTransform(t: Partial<MeshTransform>) {
        transform = { ...transform, ...t };
        const css2 = buildMeshTransform(transform);
        wrapper.style.transform = css2 ?? "";
      },
      dispose() {
        if (entry.disposed) return;
        entry.disposed = true;
        if (wrapper.parentNode) wrapper.parentNode.removeChild(wrapper);
        for (const r of rendered) {
          try { r.dispose(); } catch { /* ignore */ }
        }
        rendered.length = 0;
        try { parseResult.dispose(); } catch { /* ignore */ }
        meshes.delete(entry);
      },
    };

    entry.handle = handle;
    meshes.add(entry);
    return handle;
  }

  function setOptions(partial: Partial<PolySceneOptions>): void {
    currentOptions = { ...currentOptions, ...partial };
    applySceneStyle(sceneEl, currentOptions);
  }

  function destroy(): void {
    // Dispose all meshes (revokes blob URLs) before removing the scene.
    // Snapshot first since dispose() mutates the set.
    const snapshot = Array.from(meshes);
    for (const m of snapshot) {
      try { m.handle.dispose(); } catch { /* ignore */ }
    }
    if (sceneEl.parentNode) sceneEl.parentNode.removeChild(sceneEl);
  }

  return { add, setOptions, destroy };
}
