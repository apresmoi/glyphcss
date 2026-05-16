import { useEffect, useRef } from "react";
import type { ParseAnimationController, PolyAmbientLight, PolyDirectionalLight, Polygon, Vec3 as ReactVec3 } from "@layoutit/polycss-react";
import {
  axesHelperPolygons,
  createPolyFirstPersonControls,
  createPolyOrbitControls,
  createPolyMapControls,
  createPolyScene,
  createSelect,
  createTransformControls,
  octahedronPolygons,
} from "@layoutit/polycss";
import type {
  PolyControlsHandle,
  PolyFirstPersonControlsHandle,
  PolyMeshHandle as VanillaPolyMeshHandle,
  PolySceneOptions,
  PolySceneHandle,
  PolySelectionHandle,
  PolyTransformControlsHandle,
  Vec3,
} from "@layoutit/polycss";
import type { GizmoMode, SceneOptionsState } from "../types";

export type { GizmoMode, SceneOptionsState };

// Light helper world units → CSS pixels conversion (matches the helper
// components in @layoutit/polycss-react and @layoutit/polycss-vue).
const LIGHT_HELPER_TILE = 50;

function lightHelperPosition(
  light: PolyDirectionalLight,
  target: Vec3,
  distance: number,
): Vec3 {
  const [dx, dy, dz] = light.direction;
  const len = Math.hypot(dx, dy, dz) || 1;
  return [
    (target[1] + (dx / len) * distance) * LIGHT_HELPER_TILE,
    (target[0] + (dy / len) * distance) * LIGHT_HELPER_TILE,
    (target[2] + (dz / len) * distance) * LIGHT_HELPER_TILE,
  ];
}

export interface VanillaSceneProps {
  polygons: Polygon[];
  options: SceneOptionsState;
  directionalLight: PolyDirectionalLight;
  ambientLight: PolyAmbientLight;
  showAxes: boolean;
  showLight: boolean;
  showGround: boolean;
  helperScale: number;
  helperTarget: Vec3;
  mergePolygonsForMesh: boolean;
  stableDomForMesh: boolean;
  animationKey?: string;
  animationFrameFactory?: (timeSeconds: number) => Polygon[];
  onBuild: (ms: number) => void;
  onCameraChange?: (camera: { rotX: number; rotY: number; zoom: number; target?: ReactVec3 }) => void;
  enableSelection?: boolean;
  meshId?: string;
  onSelectionChange?: (selectedIds: string[]) => void;
  gizmoMode?: GizmoMode;
  enableHover?: boolean;
  onHoverChange?: (id: string | null) => void;
  onMeshHandleChange?: (handle: VanillaPolyMeshHandle | null) => void;
}

export function VanillaScene({
  polygons,
  options,
  directionalLight,
  ambientLight,
  showAxes,
  showLight,
  showGround,
  helperScale,
  helperTarget,
  mergePolygonsForMesh,
  stableDomForMesh,
  animationKey,
  animationFrameFactory,
  onBuild,
  onCameraChange,
  enableSelection,
  meshId,
  onSelectionChange,
  gizmoMode,
  enableHover,
  onHoverChange,
  onMeshHandleChange,
}: VanillaSceneProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<PolySceneHandle | null>(null);
  const controlsRef = useRef<PolyControlsHandle | PolyFirstPersonControlsHandle | null>(null);
  const meshHandleRef = useRef<VanillaPolyMeshHandle | null>(null);
  const axesHandleRef = useRef<VanillaPolyMeshHandle | null>(null);
  const lightHandleRef = useRef<VanillaPolyMeshHandle | null>(null);
  const groundHandleRef = useRef<VanillaPolyMeshHandle | null>(null);
  const selectionRef = useRef<PolySelectionHandle | null>(null);
  const transformControlsRef = useRef<PolyTransformControlsHandle | null>(null);
  const onBuildRef = useRef(onBuild);
  onBuildRef.current = onBuild;
  const onCameraChangeRef = useRef(onCameraChange);
  onCameraChangeRef.current = onCameraChange;
  const onSelectionChangeRef = useRef(onSelectionChange);
  onSelectionChangeRef.current = onSelectionChange;
  const onHoverChangeRef = useRef(onHoverChange);
  onHoverChangeRef.current = onHoverChange;
  const onMeshHandleChangeRef = useRef(onMeshHandleChange);
  onMeshHandleChangeRef.current = onMeshHandleChange;
  const animationPausedRef = useRef(options.animationPaused);
  animationPausedRef.current = options.animationPaused;
  const animationTimeScaleRef = useRef(options.animationTimeScale);
  animationTimeScaleRef.current = options.animationTimeScale;

  // Split things into "structural" (require destroying the scene) vs
  // "incremental" (can be applied via setOptions / setTransform). In
  // dynamic mode the chicken's atlas is light-independent, so we drop the
  // light from the structural deps — sliding the light then only flows
  // through the cheap setOptions effect, no flicker.
  const stableDirectionalForRebuild =
    options.textureLighting === "dynamic" ? null : directionalLight;
  const stableAmbientForRebuild =
    options.textureLighting === "dynamic" ? null : ambientLight;

  // Effect 1 — heavy: create the scene + add the current polygons once.
  // Polygon replacement is handled by Effect 1.5 so animation frames do not
  // tear down controls/helpers.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.innerHTML = "";
    const sceneOptions: PolySceneOptions = {
      rotX: options.rotX,
      rotY: options.rotY,
      zoom: options.zoom,
      directionalLight,
      ambientLight,
      textureLighting: options.textureLighting,
      perspective: options.perspective,
      autoCenter: options.autoCenter,
      textureQuality: options.textureQuality,
      strategies: { disable: options.disableStrategies },
    };
    const scene = createPolyScene(host, sceneOptions);
    sceneRef.current = scene;
    meshHandleRef.current = scene.add({
      polygons,
      objectUrls: [],
      warnings: [],
      dispose: () => {},
    }, { merge: mergePolygonsForMesh, stableDom: stableDomForMesh, id: meshId, castShadow: options.castShadow });
    meshHandleRef.current.element.classList.add("dn-model-mesh");
    onMeshHandleChangeRef.current?.(meshHandleRef.current);
    return () => {
      // Tear controls down BEFORE destroying the scene — otherwise the
      // controls' rAF tick could fire one more time against a stale handle.
      onMeshHandleChangeRef.current?.(null);
      controlsRef.current?.destroy();
      controlsRef.current = null;
      axesHandleRef.current = null;
      lightHandleRef.current = null;
      groundHandleRef.current = null;
      meshHandleRef.current = null;
      sceneRef.current = null;
      scene.destroy();
    };
  }, [
    options.autoCenter,
    options.textureQuality,
    options.textureLighting,
    options.perspective,
    stableDirectionalForRebuild,
    stableAmbientForRebuild,
    stableDomForMesh,
  ]);

  // Effect 1.5 — replace geometry on the existing mesh. This is the path
  // used by animated GLB playback.
  useEffect(() => {
    const handle = meshHandleRef.current;
    if (!handle) return;
    const started = performance.now();
    handle.setPolygons(polygons, {
      merge: mergePolygonsForMesh,
      stableDom: stableDomForMesh,
    });
    requestAnimationFrame(() =>
      onBuildRef.current(performance.now() - started),
    );
  }, [polygons, mergePolygonsForMesh, stableDomForMesh]);

  // Effect 1.6 — live-toggle castShadow without rebuilding the scene.
  useEffect(() => {
    const handle = meshHandleRef.current;
    if (!handle) return;
    handle.setTransform({ castShadow: options.castShadow });
  }, [options.castShadow]);

  // Selection + transform-controls layer. Selection toggle controls
  // both — when on, clicking the mesh selects it (and attaches the
  // gizmo); clicking again deselects (and detaches). The gizmo's
  // mode follows `gizmoMode` (translate / rotate).
  useEffect(() => {
    if (!enableSelection) {
      selectionRef.current?.destroy();
      selectionRef.current = null;
      transformControlsRef.current?.destroy();
      transformControlsRef.current = null;
      onSelectionChangeRef.current?.([]);
      return;
    }
    const scene = sceneRef.current;
    if (!scene) return;
    const tc = createTransformControls(scene, {
      mode: gizmoMode ?? "translate",
    });
    transformControlsRef.current = tc;
    const select = createSelect(scene, {
      clearOnMiss: false,
      onChange: (meshes) => {
        // Drive the gizmo from selection: attach to the first selected
        // mesh, or detach when nothing is selected.
        tc.attach(meshes[0] ?? null);
        onSelectionChangeRef.current?.(meshes.map((m) => m.id ?? ""));
      },
    });
    selectionRef.current = select;
    return () => {
      select.destroy();
      tc.destroy();
      selectionRef.current = null;
      transformControlsRef.current = null;
    };
  }, [
    enableSelection,
    // Same deps as the scene-init effect so the selection rebinds to
    // the new PolySceneHandle whenever the scene tears down + rebuilds.
    options.autoCenter,
    options.textureQuality,
    options.textureLighting,
    options.perspective,
    stableDirectionalForRebuild,
    stableAmbientForRebuild,
    stableDomForMesh,
  ]);

  // Forward gizmo mode changes to the live PolyTransformControls handle.
  useEffect(() => {
    transformControlsRef.current?.setMode(gizmoMode ?? "translate");
  }, [gizmoMode]);

  // Hover layer for vanilla — pointerenter / pointerleave on the mesh
  // wrapper. DOM enter/leave semantics fire only when the pointer
  // actually crosses the wrapper boundary (not on every internal
  // polygon-to-polygon transition), so the hover state stays stable
  // across the chicken's many `<i>` polygons. Adds the `is-hovered`
  // class so the same `.polycss-mesh.is-hovered i { filter: brightness }`
  // rule the React path uses kicks in here too.
  useEffect(() => {
    const mesh = meshHandleRef.current;
    if (!mesh || !enableHover) {
      onHoverChangeRef.current?.(null);
      return;
    }
    const onEnter = (): void => {
      mesh.element.classList.add("is-hovered");
      onHoverChangeRef.current?.(mesh.id ?? null);
    };
    const onLeave = (): void => {
      mesh.element.classList.remove("is-hovered");
      onHoverChangeRef.current?.(null);
    };
    mesh.element.addEventListener("pointerenter", onEnter);
    mesh.element.addEventListener("pointerleave", onLeave);
    return () => {
      mesh.element.removeEventListener("pointerenter", onEnter);
      mesh.element.removeEventListener("pointerleave", onLeave);
      mesh.element.classList.remove("is-hovered");
    };
  }, [
    enableHover,
    // Same deps as the scene-init effect so the hover listener
    // reattaches to the new mesh wrapper after a scene rebuild.
    options.autoCenter,
    options.textureQuality,
    options.textureLighting,
    options.perspective,
    stableDirectionalForRebuild,
    stableAmbientForRebuild,
    stableDomForMesh,
  ]);

  useEffect(() => {
    if (!animationFrameFactory || !animationKey) return;
    let raf = 0;
    let last = performance.now();
    let elapsedSeconds = 0;
    let sampledSeconds: number | null = null;

    const tick = (now: number) => {
      const deltaSeconds = Math.max(0, (now - last) / 1000);
      last = now;
      if (!animationPausedRef.current) {
        elapsedSeconds += deltaSeconds * animationTimeScaleRef.current;
      }
      const handle = meshHandleRef.current;
      if (handle && sampledSeconds !== elapsedSeconds) {
        sampledSeconds = elapsedSeconds;
        handle.setPolygons(animationFrameFactory(elapsedSeconds), {
          merge: false,
          stableDom: true,
          recomputeAutoCenter: false,
        });
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [animationKey, animationFrameFactory]);

  // Effect 2 — cheap: live transform + lighting updates via setOptions.
  // Sliding sliders only flows through this path.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    scene.setOptions({
      rotX: options.rotX,
      rotY: options.rotY,
      zoom: options.zoom,
      target: options.target as Vec3,
      directionalLight,
      ambientLight,
      textureLighting: options.textureLighting,
    });
  }, [
    options.rotX,
    options.rotY,
    options.zoom,
    options.target,
    options.textureLighting,
    directionalLight,
    ambientLight,
  ]);

  // Effect 2b — strategy toggles. Kept separate from Effect 2 because
  // `setOptions({ strategies })` triggers a full mesh re-render in
  // createPolyScene; folding it into the camera/lighting effect would
  // re-render on every rotation/zoom tick.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    scene.setOptions({
      strategies: { disable: options.disableStrategies },
    });
  }, [options.disableStrategies]);

  // Effect 2.5 — vanilla controls. The React renderer wires interactive +
  // animate through <PolyCamera>; the vanilla path uses createPolyOrbitControls.
  // The handle is created lazily once the scene is ready and we're on the
  // vanilla renderer; subsequent prop changes flow through controls.update().
  useEffect(() => {
    if (options.renderer !== "vanilla") {
      controlsRef.current?.destroy();
      controlsRef.current = null;
      return;
    }
    const scene = sceneRef.current;
    if (!scene) return;
    const buildControls = (): PolyControlsHandle | PolyFirstPersonControlsHandle => {
      if (options.dragMode === "fpv") {
        const fpv = createPolyFirstPersonControls(scene, {
          enabled: options.interactive,
          lookEnabled: options.fpvLook,
          moveEnabled: options.fpvMove,
          jumpEnabled: options.fpvJump,
          crouchEnabled: options.fpvCrouch,
          moveSpeed: options.fpvMoveSpeed,
          jumpVelocity: options.fpvJumpVelocity,
          gravity: options.fpvGravity,
          eyeHeight: options.fpvEyeHeight,
          crouchHeight: options.fpvCrouchHeight,
          lookSensitivity: options.fpvLookSensitivity,
          invertY: options.fpvInvertY,
        });
        // FPV is authoritative over the camera while engaged — don't echo
        // its per-frame writes back into React state; that round-trip fights
        // the rAF tick and causes visible jitter on mouselook and walk.
        // The React side picks up the final camera state when the user
        // exits FPV mode (next controls rebuild reads scene.getOptions()).
        return fpv;
      }
      const factory = options.dragMode === "pan" ? createPolyMapControls : createPolyOrbitControls;
      const controls: PolyControlsHandle = factory(scene, {
        drag: options.interactive,
        wheel: options.interactive,
        animate: options.animate ? { speed: 0.3, axis: "y" as const, pauseOnInteraction: true } : false as const,
      });
      controls.addEventListener("end", ((e: { camera: { rotX: number; rotY: number; zoom: number; target?: ReactVec3 } }) => {
        onCameraChangeRef.current?.(e.camera);
      }) as any);
      return controls;
    };
    if (controlsRef.current) controlsRef.current.destroy();
    controlsRef.current = buildControls();
    return () => {
      // Effect re-runs when deps change — destroy only on full unmount,
      // which is signaled by the scene Effect 1 cleanup destroying scene.
      // Until then, the next effect run will reuse + update controlsRef.
    };
  }, [
    options.renderer,
    options.interactive,
    options.animate,
    options.dragMode,
    polygons,
    options.autoCenter,
    options.textureQuality,
    options.textureLighting,
    options.perspective,
    stableDirectionalForRebuild,
    stableAmbientForRebuild,
    stableDomForMesh,
  ]);

  // Effect 2.6 — live-update FPV options (booleans + numerics) without
  // destroying the controls. Keeps the pointer-lock + camera target intact
  // while sliders are dragged.
  useEffect(() => {
    if (options.dragMode !== "fpv") return;
    const handle = controlsRef.current as PolyFirstPersonControlsHandle | null;
    if (!handle || !("lock" in handle)) return;
    handle.update({
      enabled: options.interactive,
      lookEnabled: options.fpvLook,
      moveEnabled: options.fpvMove,
      jumpEnabled: options.fpvJump,
      crouchEnabled: options.fpvCrouch,
      moveSpeed: options.fpvMoveSpeed,
      jumpVelocity: options.fpvJumpVelocity,
      gravity: options.fpvGravity,
      eyeHeight: options.fpvEyeHeight,
      crouchHeight: options.fpvCrouchHeight,
      lookSensitivity: options.fpvLookSensitivity,
      invertY: options.fpvInvertY,
    });
  }, [
    options.dragMode,
    options.interactive,
    options.fpvLook,
    options.fpvMove,
    options.fpvJump,
    options.fpvCrouch,
    options.fpvMoveSpeed,
    options.fpvJumpVelocity,
    options.fpvGravity,
    options.fpvEyeHeight,
    options.fpvCrouchHeight,
    options.fpvLookSensitivity,
    options.fpvInvertY,
  ]);

  // Effect 3 — axes helper. Add/remove based on toggle; rebuild when scale
  // changes (different bar lengths bake into different polygons).
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (!showAxes) {
      axesHandleRef.current?.dispose();
      axesHandleRef.current = null;
      return;
    }
    axesHandleRef.current = scene.add(
      {
        polygons: axesHelperPolygons({ size: helperScale * 0.6 }),
        objectUrls: [],
        warnings: [],
        dispose: () => {},
      },
      { excludeFromAutoCenter: true },
    );
    return () => {
      axesHandleRef.current?.dispose();
      axesHandleRef.current = null;
    };
  }, [
    showAxes,
    helperScale,
    polygons,
    options.autoCenter,
    options.textureQuality,
    options.textureLighting,
    options.perspective,
    stableDirectionalForRebuild,
    stableAmbientForRebuild,
  ]);

  // Effect 3.5 — ground receiver. A flat quad in the XY plane (Z is "up"
  // in polycss's world convention — the red-green plane in the axes helper
  // is the floor) at the model's min-Z, sized to ~3× the model's horizontal
  // span. Gives shadows something to land on. excludeFromAutoCenter so
  // toggling it doesn't shift the camera pivot; castShadow:false because
  // the floor doesn't shadow itself.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (!showGround || polygons.length === 0) {
      groundHandleRef.current?.dispose();
      groundHandleRef.current = null;
      return;
    }
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const p of polygons) {
      for (const v of p.vertices) {
        if (v[0] < minX) minX = v[0]; if (v[0] > maxX) maxX = v[0];
        if (v[1] < minY) minY = v[1]; if (v[1] > maxY) maxY = v[1];
        if (v[2] < minZ) minZ = v[2]; if (v[2] > maxZ) maxZ = v[2];
      }
    }
    if (!Number.isFinite(minZ)) {
      groundHandleRef.current?.dispose();
      groundHandleRef.current = null;
      return;
    }
    const span = Math.max(maxX - minX, maxY - minY, 1);
    const pad = span * 1.5;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const z = minZ;
    const groundPoly: Polygon = {
      vertices: [
        [cx - pad, cy - pad, z],
        [cx + pad, cy - pad, z],
        [cx + pad, cy + pad, z],
        [cx - pad, cy + pad, z],
      ],
      // Medium gray — needs to be light enough that the 25% black shadow
      // on top has visible contrast (the page background is near-black).
      color: "#7d848e",
    };
    groundHandleRef.current = scene.add(
      {
        polygons: [groundPoly],
        objectUrls: [],
        warnings: [],
        dispose: () => {},
      },
      { excludeFromAutoCenter: true, castShadow: false },
    );
    return () => {
      groundHandleRef.current?.dispose();
      groundHandleRef.current = null;
    };
  }, [
    showGround,
    polygons,
    options.autoCenter,
    options.textureQuality,
    options.textureLighting,
    options.perspective,
    stableDirectionalForRebuild,
    stableAmbientForRebuild,
  ]);

  // Effect 4 — light helper. Octahedron at LOCAL origin so polygons stay
  // stable across light moves; the light direction only updates the
  // mesh wrapper transform.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (!showLight) {
      lightHandleRef.current?.dispose();
      lightHandleRef.current = null;
      return;
    }
    const swatch = directionalLight.color ?? "#ffd54a";
    lightHandleRef.current = scene.add(
      {
        polygons: octahedronPolygons({ center: [0, 0, 0], size: helperScale * 0.05, color: swatch }),
        objectUrls: [],
        warnings: [],
        dispose: () => {},
      },
      {
        position: lightHelperPosition(
          directionalLight,
          helperTarget,
          helperScale * 0.7,
        ),
        excludeFromAutoCenter: true,
      },
    );
    return () => {
      lightHandleRef.current?.dispose();
      lightHandleRef.current = null;
    };
    // directionalLight.color triggers a remount because the swatch is
    // baked into polygon data; direction is handled by Effect 5 below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    showLight,
    helperScale,
    directionalLight.color,
    polygons,
    options.autoCenter,
    options.textureQuality,
    options.textureLighting,
    options.perspective,
    stableDirectionalForRebuild,
    stableAmbientForRebuild,
  ]);

  // Effect 5 — slide the light helper to the new orbit position whenever
  // direction or target/distance change. Only updates the wrapper
  // transform, no atlas work.
  useEffect(() => {
    const handle = lightHandleRef.current;
    if (!handle) return;
    handle.setTransform({
      position: lightHelperPosition(
        directionalLight,
        helperTarget,
        helperScale * 0.7,
      ),
    });
  }, [directionalLight, helperTarget, helperScale]);

  return <div className="dn-vanilla-host" ref={hostRef} />;
}
