import { useEffect, useRef, useState } from "react";
import { VoxCamera, VoxScene } from "@layoutit/voxcss/react";
import type { Voxel } from "@layoutit/voxcss/react";
import PolygonCanvas from "./PolygonCanvas";
import { useDebug } from "./DebugLayout";
import { DebugSection } from "./DebugSection";

type Vec3 = [number, number, number];

interface DebugSceneProps {
  voxels: Voxel[];
  /** Origin in voxel coords for canvas projection — usually the mesh centroid. */
  origin: Vec3;
  /** Forwarded to <VoxScene>. */
  voxScene?: {
    mergeVoxels?: false | "2d" | "3d" | "poly";
  };
  /** Initial values; the scene owns the live state from then on. */
  defaultZoom?: number;
  defaultRotX?: number;
  defaultRotY?: number;
  defaultShowFloor?: boolean;
}

const ZOOM_MIN = 0.05;
const ZOOM_MAX = 4;
const ZOOM_STEP = 0.05;

/**
 * Standard dual-pane viewport: voxcss on the left, polygon canvas on the
 * right. Owns zoom / auto-rotate / pane-visibility state and renders a
 * "View" section into the sidebar so every debug page has the same controls.
 */
export function DebugScene({
  voxels,
  origin,
  voxScene = {},
  defaultZoom = 0.6,
  defaultRotX = 65,
  defaultRotY = 45,
  defaultShowFloor = false,
}: DebugSceneProps) {
  const { voxSceneRef } = useDebug();
  const [zoom, setZoom] = useState(defaultZoom);
  const [autoRotate, setAutoRotate] = useState(false);
  const [showVoxcss, setShowVoxcss] = useState(true);
  const [showCanvas, setShowCanvas] = useState(false);
  const [showFloor, setShowFloor] = useState(defaultShowFloor);
  // Single toggle drives both back-face debug paths: voxcss's per-voxel
  // direction-cull overlay (cubes/ramps/wedges/spikes) and the triangle/
  // polygon backface render. CSS for both is unified so they look the same.
  const [showBackfaces, setShowBackfaces] = useState(false);
  const [debugShowLabels, setDebugShowLabels] = useState(false);

  const sceneContainerRef = useRef<HTMLDivElement>(null);
  const canvasWrapRef = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 });

  // Wire the rendered VoxScene container up to the layout's ref so DebugStats
  // can count its DOM elements.
  useEffect(() => {
    voxSceneRef.current = sceneContainerRef.current;
    return () => {
      if (voxSceneRef.current === sceneContainerRef.current) {
        voxSceneRef.current = null;
      }
    };
  }, [voxSceneRef, showVoxcss]);

  // Wheel-to-zoom over either pane.
  useEffect(() => {
    const els = [sceneContainerRef.current, canvasWrapRef.current].filter(Boolean) as HTMLElement[];
    if (els.length === 0) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = -Math.sign(e.deltaY) * ZOOM_STEP;
      setZoom((z) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z + delta)));
    };
    for (const el of els) el.addEventListener("wheel", onWheel, { passive: false });
    return () => { for (const el of els) el.removeEventListener("wheel", onWheel); };
  }, [showVoxcss, showCanvas]);

  // Track canvas pane size for the polygon renderer.
  useEffect(() => {
    const el = canvasWrapRef.current;
    if (!el) return;
    const measure = () => setCanvasSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [showCanvas, showVoxcss]);

  return (
    <>
      <DebugSection title="View" dock="bottom" collapsible={false}>
        <div className="debug-row">
          <span>Zoom</span>
          <button className="debug-btn" onClick={() => setZoom((z) => Math.max(ZOOM_MIN, z - ZOOM_STEP))}>−</button>
          <span style={{ minWidth: 36, textAlign: "center" }}>{zoom.toFixed(2)}</span>
          <button className="debug-btn" onClick={() => setZoom((z) => Math.min(ZOOM_MAX, z + ZOOM_STEP))}>+</button>
        </div>
        <label className="debug-checkbox">
          <input type="checkbox" checked={autoRotate} onChange={(e) => setAutoRotate(e.target.checked)} />
          <span>Auto-rotate</span>
        </label>
        <label className="debug-checkbox">
          <input type="checkbox" checked={showVoxcss} onChange={(e) => setShowVoxcss(e.target.checked)} />
          <span>voxcss pane</span>
        </label>
        <label className="debug-checkbox">
          <input type="checkbox" checked={showCanvas} onChange={(e) => setShowCanvas(e.target.checked)} />
          <span>canvas pane</span>
        </label>
        <label className="debug-checkbox">
          <input type="checkbox" checked={showFloor} onChange={(e) => setShowFloor(e.target.checked)} />
          <span>Show floor</span>
        </label>
        <label className="debug-checkbox" title="Show the back side of every shape (wall-mask culled cube faces + triangle/polygon back faces) tinted in orange">
          <input type="checkbox" checked={showBackfaces} onChange={(e) => setShowBackfaces(e.target.checked)} />
          <span style={{ color: showBackfaces ? "#fdba74" : undefined }}>Show back-faces</span>
        </label>
        <label className="debug-checkbox">
          <input type="checkbox" checked={debugShowLabels} onChange={(e) => setDebugShowLabels(e.target.checked)} />
          <span style={{ color: debugShowLabels ? "#86efac" : undefined }}>Add data-debug attribute</span>
        </label>
      </DebugSection>

      {showVoxcss && (
        <div ref={sceneContainerRef} className="debug-pane">
          <div className="debug-pane-label">voxcss</div>
          <VoxCamera
            interactive
            zoom={zoom}
            rotX={defaultRotX}
            rotY={defaultRotY}
            animate={autoRotate ? 0.5 : false}
          >
            <VoxScene
              voxels={voxels}
              showFloor={showFloor}
              mergeVoxels={voxScene.mergeVoxels}
              debugShowOccluded={showBackfaces}
              debugShowLabels={debugShowLabels}
              debugShowBackfaces={showBackfaces}
            />
          </VoxCamera>
        </div>
      )}
      {showCanvas && (
        <div ref={canvasWrapRef} className="debug-pane">
          <div className="debug-pane-label">canvas (polygon model)</div>
          {canvasSize.w > 0 && (
            <PolygonCanvas
              voxels={voxels}
              zoom={zoom}
              width={canvasSize.w}
              height={canvasSize.h}
              origin={origin}
            />
          )}
        </div>
      )}
    </>
  );
}
