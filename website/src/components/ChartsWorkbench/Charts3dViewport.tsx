// The live 3D viewport (packet C3, AGENTS.md's "Charts 3D"): a real
// `createGlyphScene` orbiting a `glyphChartObject` mount, reusing the exact
// vanilla mount pattern `/synth` and `/maps` already use (`createGlyphScene`
// into a host div ref, `createGlyphOrbitControls` on top) rather than a
// lookalike — see `SynthWorkbench.tsx`'s own scene-build effect, the
// reference this file was studied from. Deliberately built HERE, in
// `ChartsWorkbench`, not lifted into `InstrumentWorkbench` yet: at the time
// of writing, `feat/diagrams` carries no shared 3D viewport for D3's own
// `/diagrams` to have contributed (grepped `addObject` under
// `website/src/components` — none landed). Factored to make a later lift
// trivial: this component takes only a resolved `GlyphChart3dSurfaceMark`
// plus plain camera/scene-option props, no `ChartsWorkbenchState` import.
import { useEffect, useRef } from "react";
import {
  createGlyphOrbitControls, createGlyphOrthographicCamera, createGlyphScene, injectGlyphBaseStyles,
  type GlyphOrbitControlsHandle, type GlyphSceneHandle, type GlyphSceneObjectHandle, type Vec3,
} from "glyphcss";
import { GLYPH_CHART_3D_DEFAULT_CAMERA, glyphChart3dFitCamera, glyphChartObject, type GlyphChart3dSurfaceMark } from "@glyphcss/charts/3d";
import type { Charts3dCamera, Charts3dOrbitMode, Charts3dSceneOptions } from "./chartsWorkbench3d";

function objectBoundsCenter(bounds: { readonly min: Vec3; readonly max: Vec3 }): Vec3 {
  return [(bounds.min[0] + bounds.max[0]) / 2, (bounds.min[1] + bounds.max[1]) / 2, (bounds.min[2] + bounds.max[2]) / 2];
}

// `createGlyphScene`'s OWN fallbacks (`createGlyphScene.ts`: `cols: opts.
// cols ?? 80, rows: opts.rows ?? 24, cellAspect: opts.cellAspect ?? 2.0`) —
// `getOptions()` types these as optional because a scene MAY be built with
// none supplied, but this scene always passes `autoSize: true` and calls
// `scene.fit()` before ever reading them, so in practice they are always
// populated; these three exist only to satisfy the optional type with the
// SAME numbers the scene itself would already be using, never a distinct
// guess.
const SCENE_DEFAULT_COLS = 80;
const SCENE_DEFAULT_ROWS = 24;
const SCENE_DEFAULT_CELL_ASPECT = 2.0;

export interface Charts3dViewportHandle {
  /** Recomputes the auto-fit camera at the library's own DEFAULT rotation
   *  (`GLYPH_CHART_3D_DEFAULT_CAMERA`, never a page-side copy) and applies
   *  it — the View folder's own "Reset camera" button. */
  resetCamera(): void;
}

export function Charts3dViewport({ mark, camera, orbitMode, sceneOptions, onCameraChange, viewportRef, handleRef }: {
  mark: GlyphChart3dSurfaceMark;
  camera: Charts3dCamera;
  orbitMode: Charts3dOrbitMode;
  sceneOptions: Charts3dSceneOptions;
  /** Fired on drag/wheel release (the orbit controls' own "end" event, never
   *  per-frame) so the camera survives into `?c=` and Copy without a
   *  dispatch storm mid-gesture. */
  onCameraChange: (camera: Charts3dCamera) => void;
  viewportRef: { current: HTMLDivElement | null };
  /** Exposes `resetCamera()` to the Dock's View folder — a plain mutable
   *  ref (not `forwardRef`), since this component is mounted directly and
   *  never through a parent needing `ref`-forwarding semantics. */
  handleRef?: { current: Charts3dViewportHandle | null };
}) {
  const hostRef = viewportRef;
  const onCameraChangeRef = useRef(onCameraChange);
  onCameraChangeRef.current = onCameraChange;
  const sceneRef = useRef<GlyphSceneHandle | null>(null);
  const orbitControlsRef = useRef<GlyphOrbitControlsHandle | null>(null);
  const cameraObjRef = useRef<ReturnType<typeof createGlyphOrthographicCamera> | null>(null);
  const objectBoundsRef = useRef<{ min: Vec3; max: Vec3 } | null>(null);
  const objectHandleRef = useRef<GlyphSceneObjectHandle | null>(null);

  // MOUNT-ONLY: creates the scene, camera and orbit controls exactly once
  // per viewport lifetime — remounted only when the CALLER unmounts this
  // component (closing the 3D view, switching target away from `web`),
  // never merely because `mark`/`sceneOptions` changed (P1-2 fix round 1,
  // codex review: the prior cut re-ran this whole effect on every shading/
  // colorscale/colour edit, which tore down and rebuilt the scene — and,
  // because `mark` is a NEW object on every render of the parent's own
  // `state.chart3d`-derived memo, on every orbit-drag release too — losing
  // the camera each time). `mark`/`camera`/`orbitMode`/`sceneOptions` are
  // read here ONLY for the viewport's INITIAL pose/appearance/content; a
  // later change to any of them is applied imperatively by the effects
  // below, never by re-running this one.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    injectGlyphBaseStyles(host.ownerDocument ?? undefined);
    const cam = createGlyphOrthographicCamera({
      rotX: camera.rotX, rotY: camera.rotY, zoom: 1,
      ...(camera.useMat && camera.mat ? { mat: [...camera.mat], useMat: true } : {}),
    });
    const scene = createGlyphScene(host, {
      camera: cam, autoSize: true, mode: "solid",
      useColors: sceneOptions.useColors,
      // A surface's underside is reachable now that pitch is unrestricted
      // (this file's own orbit-controls call, below, passes `pitchRange:
      // null`) — single-sided would back-face cull it to nothing.
      doubleSided: true,
    });
    // Re-measures the host's actual cell size before the camera fit below
    // reads `getOptions()` (SynthWorkbench.tsx's own "call after a render
    // so the <pre> reflects the real cell" rule).
    scene.fit();
    scene.rerender();
    const object = glyphChartObject(mark);
    objectBoundsRef.current = object.bounds as { min: Vec3; max: Vec3 };
    const opts = scene.getOptions();
    const fit = glyphChart3dFitCamera({
      bounds: object.bounds, rotX: camera.rotX, rotY: camera.rotY,
      ...(camera.useMat && camera.mat ? { mat: [...camera.mat], useMat: true } : {}),
      cols: opts.cols ?? SCENE_DEFAULT_COLS, rows: opts.rows ?? SCENE_DEFAULT_ROWS, cellAspect: opts.cellAspect ?? SCENE_DEFAULT_CELL_ASPECT,
    });
    cam.target = camera.zoom !== undefined ? objectBoundsCenter(object.bounds) : fit.target;
    cam.zoom = camera.zoom ?? fit.zoom;
    cameraObjRef.current = cam;
    sceneRef.current = scene;
    objectHandleRef.current = scene.addObject(object);
    scene.rerender();
    const orbitControls = createGlyphOrbitControls(scene, {
      drag: true, wheel: true,
      // "Every 3D chart rotates in any direction" (user decision,
      // PLAN-3d.md §9/§11): no pitch clamp, so the view reaches straight
      // above and straight below the surface, with no roll (the Euler
      // path's own up-vector-locked guarantee).
      pitchRange: null,
      mode: orbitMode,
    });
    orbitControlsRef.current = orbitControls;
    // Trackball orbit composes into `cam.mat`/`cam.useMat` (the real
    // `GlyphCamera` fields `createGlyphOrbitControls`'s own trackball path
    // writes) rather than `rotX`/`rotY` — reported alongside them so a
    // later turntable switch still has a sensible `rotX`/`rotY` to resume
    // from, per `Charts3dCamera.mat`'s own doc (the KNOWN library gap: the
    // static exit can't consume this yet).
    const onEnd = () => onCameraChangeRef.current({
      rotX: cam.rotX, rotY: cam.rotY, zoom: cam.zoom,
      ...(cam.useMat && cam.mat ? { mat: [...cam.mat], useMat: true } : {}),
    });
    orbitControls.addEventListener("end", onEnd);
    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      // A resized viewport changes `cols`/`rows` (`autoSize`), so the
      // fitted framing is now stale — re-fit at the CURRENT rotation
      // (never reset it) so a reader mid-orbit doesn't get bounced back to
      // the default view just because their window changed shape. Only
      // when the camera is still auto-fitted (`camera.zoom === undefined`
      // at mount, i.e. the caller never pinned one) — an explicit zoom is
      // the reader's own choice and a resize must not silently override it.
      // Bounds are re-read from `objectBoundsRef` (not this closure's own
      // `object.bounds`) since a later mark update replaces it in place.
      const autoFitted = camera.zoom === undefined;
      resizeObserver = new ResizeObserver(() => {
        scene.fit();
        if (!autoFitted) { scene.rerender(); return; }
        const bounds = objectBoundsRef.current;
        if (!bounds) { scene.rerender(); return; }
        const o = scene.getOptions();
        const refit = glyphChart3dFitCamera({ bounds, rotX: cam.rotX, rotY: cam.rotY, cols: o.cols ?? SCENE_DEFAULT_COLS, rows: o.rows ?? SCENE_DEFAULT_ROWS, cellAspect: o.cellAspect ?? SCENE_DEFAULT_CELL_ASPECT });
        cam.target = refit.target; cam.zoom = refit.zoom;
        scene.rerender();
      });
      resizeObserver.observe(host);
    }
    return () => {
      resizeObserver?.disconnect();
      orbitControls.removeEventListener("end", onEnd);
      orbitControls.destroy();
      scene.destroy();
      sceneRef.current = null;
      orbitControlsRef.current = null;
      cameraObjRef.current = null;
      objectBoundsRef.current = null;
      objectHandleRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A new MARK — a different dataset, shading or colorscale — updates the
  // EXISTING scene-object handle IN PLACE (`GlyphSceneObjectHandle.update`,
  // AGENTS.md's "Scene objects": "replaces meshes/overlays/hotspots/
  // samplers wholesale, keeping the handle's identity") rather than
  // rebuilding the whole scene: the camera and orbit controls survive a
  // shading/colorscale/dataset edit exactly the way they already survive an
  // ordinary orbit drag (P1-2 fix round 1). Skips its own first run — the
  // mount effect above already added this exact mark as the object's
  // initial content, so re-running `update()` on it here would be a
  // redundant (if harmless) rebuild of the identical meshes.
  const isFirstMarkEffect = useRef(true);
  useEffect(() => {
    if (isFirstMarkEffect.current) { isFirstMarkEffect.current = false; return; }
    const handle = objectHandleRef.current;
    if (!handle) return;
    const object = glyphChartObject(mark);
    objectBoundsRef.current = object.bounds as { min: Vec3; max: Vec3 };
    handle.update(object);
    sceneRef.current?.rerender();
  }, [mark]);

  // A colour edit (`color: none` <-> a colour mode) applies via
  // `scene.setOptions` — no mesh rebuild, no camera reset (P1-2 fix round
  // 1). Charset never reaches the scene at all (`chartsWorkbench3dSceneOptions`'s
  // own doc: a 3D chart's box/tick overlay disables the halfblock/quadrant
  // encoders regardless, so there is no live `charMode` to set).
  const isFirstColorEffect = useRef(true);
  useEffect(() => {
    if (isFirstColorEffect.current) { isFirstColorEffect.current = false; return; }
    sceneRef.current?.setOptions({ useColors: sceneOptions.useColors });
  }, [sceneOptions.useColors]);

  // Orbit mode: applied to the EXISTING controls without a scene rebuild —
  // `createGlyphOrbitControls`'s own contract ("switching modes carries the
  // current on-screen orientation over").
  useEffect(() => {
    orbitControlsRef.current?.update({ mode: orbitMode });
  }, [orbitMode]);

  useEffect(() => {
    if (!handleRef) return;
    handleRef.current = {
      resetCamera() {
        const scene = sceneRef.current, cam = cameraObjRef.current, bounds = objectBoundsRef.current;
        if (!scene || !cam || !bounds) return;
        const o = scene.getOptions();
        const { rotX, rotY } = GLYPH_CHART_3D_DEFAULT_CAMERA;
        const fit = glyphChart3dFitCamera({ bounds, rotX, rotY, cols: o.cols ?? SCENE_DEFAULT_COLS, rows: o.rows ?? SCENE_DEFAULT_ROWS, cellAspect: o.cellAspect ?? SCENE_DEFAULT_CELL_ASPECT });
        // Reset always returns to the library's own default Euler pose —
        // `useMat` cleared too, so a reset out of a trackball orientation
        // doesn't leave the live camera still reading its stale matrix
        // while `rotX`/`rotY` silently go unused underneath it.
        cam.useMat = false; cam.rotX = rotX; cam.rotY = rotY; cam.target = fit.target; cam.zoom = fit.zoom;
        scene.rerender();
        onCameraChangeRef.current({ rotX, rotY, zoom: undefined });
      },
    };
    return () => { if (handleRef) handleRef.current = null; };
  }, [handleRef]);

  // Nothing is ever rendered inside the viewport besides the scene itself
  // (C3 fix round 2, user feedback) — AGENTS.md's "TargetPreview" rule ("a
  // chrome note lives in the frame's OWN chrome... never the viewport's
  // render area") applies here exactly like it does to the 2D exit; what a
  // reader needs to know about an unsupported charset lives on the Dock's
  // own dimmed Charset toggle (`ChartsDock.tsx`'s `chartsCharsetToggle`)
  // instead, and an explicit override or an old link that still hands this
  // viewport one renders the faithful downgrade silently (there was never
  // a `charMode` for it to set either way).
  return <div className="charts-3d-viewport"><div className="charts-3d-viewport-host" ref={hostRef} /></div>;
}
