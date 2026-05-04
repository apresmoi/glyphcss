import { useEffect, useMemo, useRef, useState } from "react";
import { PolyCamera, PolyScene } from "@polycss/react";
import type { Polygon } from "@polycss/react";
import PolygonCanvas from "./PolygonCanvas";
import { useDebug } from "./DebugLayout";
import { DebugSection } from "./DebugSection";
import { Pills, Row, Slider } from "./controls";

type Vec3 = [number, number, number];

interface DebugSceneProps {
  voxels: Polygon[];
  /** Origin in voxel coords for canvas projection — usually the mesh centroid. */
  origin: Vec3;
  /** Forwarded to <PolyScene>. */
  voxScene?: {
    merge?: "off" | "auto";
  };
  /**
   * Forwarded to <PolyScene>. Pivots rotation around the mesh's bbox
   * center — useful for loaded meshes whose origin sits at a corner.
   */
  autoCenter?: boolean;
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
  autoCenter = false,
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
  // Live merge mode override — lets the user flip merging on/off from the
  // sidebar to A/B-test what mergePolygons does to a textured mesh. The
  // initial value comes from the page's voxScene prop (so a page that
  // hardcodes a default still respects it on first render).
  const [mergeMode, setMergeMode] = useState<"off" | "auto">(
    voxScene.merge ?? "off",
  );
  // Single toggle drives both back-face debug paths: voxcss's per-voxel
  // direction-cull overlay (cubes/ramps/wedges/spikes) and the triangle/
  // polygon backface render. CSS for both is unified so they look the same.
  const [showBackfaces, setShowBackfaces] = useState(false);
  const [debugShowLabels, setDebugShowLabels] = useState(false);

  // Lighting controls (for triangle/polygon shading). Direction is held as
  // azimuth (0..360°, rotation around vertical) + elevation (-90..90°,
  // angle above horizon) — much easier to slide than 3 raw axis components.
  // Converted to a (x, y, z) vector below in CSS-pixel-space conventions
  // (+X right, +Y down, +Z toward viewer).
  const [lightAzimuth, setLightAzimuth] = useState(50);
  const [lightElevation, setLightElevation] = useState(45);
  const [ambient, setAmbient] = useState(0.45);
  const [lightColor, setLightColor] = useState("#ffffff");
  const [ambientColor, setAmbientColor] = useState("#ffffff");
  const [directionalEnabled, setDirectionalEnabled] = useState(true);
  const [ambientEnabled, setAmbientEnabled] = useState(true);

  const directionalLight = useMemo(() => {
    const az = (lightAzimuth * Math.PI) / 180;
    const el = (lightElevation * Math.PI) / 180;
    // CSS-pixel space inside Triangle.tsx (after the voxel.x↔voxel.y axis
    // swap):
    //   CSS-x = voxcss horizontal
    //   CSS-y = voxcss depth (forward / back)
    //   CSS-z = voxcss elevation ("up")
    // "Direction" is from the surface TO the light source, so elevation=90°
    // means light is directly overhead → +CSS-z.
    const cosEl = Math.cos(el);
    const direction: [number, number, number] = [
      cosEl * Math.sin(az),
      cosEl * Math.cos(az),
      Math.sin(el),
    ];
    // Disabling either contribution = zero out its tint. Since the renderer
    // multiplies channel-wise, an effective color of "#000000" makes the
    // contribution drop to zero without removing the field.
    return {
      direction,
      color: directionalEnabled ? lightColor : "#000000",
      ambientColor: ambientEnabled ? ambientColor : "#000000",
      ambient: ambientEnabled ? ambient : 0,
    };
  }, [lightAzimuth, lightElevation, ambient, lightColor, ambientColor, directionalEnabled, ambientEnabled]);

  const sceneContainerRef = useRef<HTMLDivElement>(null);
  const canvasWrapRef = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 });

  // Wire the rendered PolyScene container up to the layout's ref so DebugStats
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

  // Floor: a single square polygon at world z=0, sized to the mesh bbox
  // in X/Y plus 20% padding so it visibly extends past the shape's edge.
  // Concatenated to the rendered polygon list when "Show floor" is on.
  // For autoCenter-true scenes (e.g. loaded OBJ), the floor lands at the
  // mesh's actual world z=0 which is usually at its feet. For centered
  // procedural shapes (Platonic, Sphere) world z=0 cuts through the
  // middle — that's the convention; user can mentally adjust.
  const renderedPolygons = useMemo(() => {
    if (!showFloor) return voxels;
    if (voxels.length === 0) return voxels;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of voxels) {
      for (const v of p.vertices) {
        if (v[0] < minX) minX = v[0]; if (v[0] > maxX) maxX = v[0];
        if (v[1] < minY) minY = v[1]; if (v[1] > maxY) maxY = v[1];
      }
    }
    const padX = (maxX - minX) * 0.2;
    const padY = (maxY - minY) * 0.2;
    const x0 = minX - padX, x1 = maxX + padX;
    const y0 = minY - padY, y1 = maxY + padY;
    const floor: Polygon = {
      vertices: [
        [x0, y0, 0],
        [x1, y0, 0],
        [x1, y1, 0],
        [x0, y1, 0],
      ],
      color: "#3a3a3a",
    };
    return [...voxels, floor];
  }, [voxels, showFloor]);

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
          <span>polycss pane</span>
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
        <Row label="Merge">
          <Pills<"off" | "auto">
            value={mergeMode}
            onChange={setMergeMode}
            options={[
              { value: "off", label: "off" },
              { value: "auto", label: "auto" },
            ]}
          />
        </Row>
      </DebugSection>

      <DebugSection title="Light" dock="bottom">
        <label className="debug-checkbox">
          <input type="checkbox" checked={directionalEnabled} onChange={(e) => setDirectionalEnabled(e.target.checked)} />
          <span>Directional</span>
        </label>
        {directionalEnabled && (
          <>
            <Row label="Azimuth">
              <Slider value={lightAzimuth} onChange={setLightAzimuth} min={0} max={360} step={1} format={(v) => `${v.toFixed(0)}°`} />
            </Row>
            <Row label="Elev.">
              <Slider value={lightElevation} onChange={setLightElevation} min={-90} max={90} step={1} format={(v) => `${v.toFixed(0)}°`} />
            </Row>
            <div className="debug-row">
              <span>Color</span>
              <input type="color" className="debug-color-swatch" value={lightColor} onChange={(e) => setLightColor(e.target.value)} title="Directional light tint" />
              <span style={{ fontFamily: "monospace", fontSize: 11, opacity: 0.7 }}>{lightColor}</span>
            </div>
          </>
        )}
        <label className="debug-checkbox" style={{ marginTop: 4 }}>
          <input type="checkbox" checked={ambientEnabled} onChange={(e) => setAmbientEnabled(e.target.checked)} />
          <span>Ambient</span>
        </label>
        {ambientEnabled && (
          <>
            <Row label="Strength">
              <Slider value={ambient} onChange={setAmbient} min={0} max={1} step={0.05} format={(v) => v.toFixed(2)} />
            </Row>
            <div className="debug-row">
              <span>Color</span>
              <input type="color" className="debug-color-swatch" value={ambientColor} onChange={(e) => setAmbientColor(e.target.value)} title="Ambient light tint" />
              <span style={{ fontFamily: "monospace", fontSize: 11, opacity: 0.7 }}>{ambientColor}</span>
            </div>
          </>
        )}
      </DebugSection>

      {showVoxcss && (
        <div ref={sceneContainerRef} className="debug-pane">
          <div className="debug-pane-label">polycss</div>
          <PolyCamera
            interactive
            zoom={zoom}
            rotX={defaultRotX}
            rotY={defaultRotY}
            animate={autoRotate ? 0.5 : false}
          >
            <PolyScene
              polygons={renderedPolygons}
              merge={mergeMode}
              autoCenter={autoCenter}
              directionalLight={directionalLight}
            />
          </PolyCamera>
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
