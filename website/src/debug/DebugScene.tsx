import { useEffect, useMemo, useRef, useState } from "react";
import {
  PolyAxesHelper,
  PolyCamera,
  PolyDirectionalLightHelper,
  PolyOrbitControls,
  PolyScene,
} from "@layoutit/polycss-react";
import type { Polygon, TextureLightingMode } from "@layoutit/polycss-react";
import PolygonCanvas from "./PolygonCanvas";
import { useDebug } from "./DebugLayout";
import { DebugSection } from "./DebugSection";
import { Pills, Row, Slider } from "./controls";

type Vec3 = [number, number, number];

interface DebugSceneProps {
  voxels: Polygon[];
  /** Origin in voxel coords for canvas projection — usually the mesh centroid. */
  origin: Vec3;
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
  // Single toggle drives voxcss's per-voxel direction-cull overlay. Polycss
  // polygons render through atlas sprites only, so this no longer adds a
  // second polygon backface element.
  const [showBackfaces, setShowBackfaces] = useState(false);
  const [debugShowLabels, setDebugShowLabels] = useState(false);
  const [showAxes, setShowAxes] = useState(false);
  const [showLightHelper, setShowLightHelper] = useState(false);
  const [textureLighting, setTextureLighting] = useState<TextureLightingMode>("baked");

  // Lighting controls (for triangle/polygon shading). Direction is held as
  // azimuth (0..360°, rotation around vertical) + elevation (-90..90°,
  // angle above horizon) — much easier to slide than 3 raw axis components.
  // Converted to a (x, y, z) vector below in CSS-pixel-space conventions
  // (+X right, +Y down, +Z toward viewer).
  const [lightAzimuth, setLightAzimuth] = useState(50);
  const [lightElevation, setLightElevation] = useState(45);
  const [lightIntensity, setLightIntensity] = useState(1);
  const [lightColor, setLightColor] = useState("#ffffff");
  const [ambientIntensity, setAmbientIntensity] = useState(0.4);
  const [ambientColor, setAmbientColor] = useState("#ffffff");
  const [directionalEnabled, setDirectionalEnabled] = useState(true);
  const [ambientEnabled, setAmbientEnabled] = useState(true);

  const directionalLight = useMemo(() => {
    const az = (lightAzimuth * Math.PI) / 180;
    const el = (lightElevation * Math.PI) / 180;
    // CSS-pixel space:
    //   CSS-x = horizontal, CSS-y = depth, CSS-z = elevation ("up").
    // "Direction" is from the surface TO the light source, so elevation=90°
    // means light is directly overhead → +CSS-z.
    const cosEl = Math.cos(el);
    const direction: [number, number, number] = [
      cosEl * Math.sin(az),
      cosEl * Math.cos(az),
      Math.sin(el),
    ];
    return {
      direction,
      color: lightColor,
      intensity: directionalEnabled ? lightIntensity : 0,
    };
  }, [lightAzimuth, lightElevation, lightIntensity, lightColor, directionalEnabled]);

  const ambientLight = useMemo(
    () => ({
      color: ambientColor,
      intensity: ambientEnabled ? ambientIntensity : 0,
    }),
    [ambientColor, ambientIntensity, ambientEnabled],
  );

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

  // Mesh bbox in world coords, used to size both the floor and the axis /
  // light helpers so they visually fit the current model.
  const meshBbox = useMemo(() => {
    if (voxels.length === 0) return null;
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const p of voxels) {
      for (const v of p.vertices) {
        if (v[0] < minX) minX = v[0]; if (v[0] > maxX) maxX = v[0];
        if (v[1] < minY) minY = v[1]; if (v[1] > maxY) maxY = v[1];
        if (v[2] < minZ) minZ = v[2]; if (v[2] > maxZ) maxZ = v[2];
      }
    }
    return { minX, minY, minZ, maxX, maxY, maxZ };
  }, [voxels]);

  // Largest mesh extent — drives helper sizing so axes / light marker scale
  // with the model. Falls back to a sane default when the mesh is empty.
  const helperScale = useMemo(() => {
    if (!meshBbox) return 4;
    return Math.max(
      meshBbox.maxX - meshBbox.minX,
      meshBbox.maxY - meshBbox.minY,
      meshBbox.maxZ - meshBbox.minZ,
      1,
    );
  }, [meshBbox]);

  // Bbox center — light helper orbits around this so the marker lands
  // outside the mesh even when its authored origin is at a corner.
  const helperTarget = useMemo<Vec3>(() => {
    if (!meshBbox) return [0, 0, 0];
    return [
      (meshBbox.minX + meshBbox.maxX) / 2,
      (meshBbox.minY + meshBbox.maxY) / 2,
      (meshBbox.minZ + meshBbox.maxZ) / 2,
    ];
  }, [meshBbox]);

  // Floor: a single square polygon at world z=0, sized to the mesh bbox
  // in X/Y plus 20% padding so it visibly extends past the shape's edge.
  // Concatenated to the rendered polygon list when "Show floor" is on.
  // For autoCenter-true scenes (e.g. loaded OBJ), the floor lands at the
  // mesh's actual world z=0 which is usually at its feet. For centered
  // procedural shapes (Platonic, Sphere) world z=0 cuts through the
  // middle — that's the convention; user can mentally adjust.
  const renderedPolygons = useMemo(() => {
    if (!showFloor || !meshBbox) return voxels;
    const { minX, minY, maxX, maxY } = meshBbox;
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
  }, [voxels, showFloor, meshBbox]);

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
        <label className="debug-checkbox" title="X=red, Y=green, Z=blue (world axes from origin)">
          <input type="checkbox" checked={showAxes} onChange={(e) => setShowAxes(e.target.checked)} />
          <span>Show axes</span>
        </label>
        <label className="debug-checkbox" title="Marker placed along the directional light's source direction">
          <input type="checkbox" checked={showLightHelper} onChange={(e) => setShowLightHelper(e.target.checked)} />
          <span>Show light</span>
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

      <DebugSection title="Light" dock="bottom">
        <Row label="Mode">
          <Pills<TextureLightingMode>
            value={textureLighting}
            onChange={setTextureLighting}
            options={[
              { value: "baked", label: "baked" },
              { value: "dynamic", label: "dynamic" },
            ]}
          />
        </Row>
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
            <Row label="Intensity">
              <Slider value={lightIntensity} onChange={setLightIntensity} min={0} max={2} step={0.05} format={(v) => v.toFixed(2)} />
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
            <Row label="Intensity">
              <Slider value={ambientIntensity} onChange={setAmbientIntensity} min={0} max={2} step={0.05} format={(v) => v.toFixed(2)} />
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
            zoom={zoom}
            rotX={defaultRotX}
            rotY={defaultRotY}
          >
            <PolyOrbitControls
              animate={autoRotate ? { speed: 0.5 } : false}
            />
            <PolyScene
              polygons={renderedPolygons}
              autoCenter={autoCenter}
              directionalLight={directionalLight}
              ambientLight={ambientLight}
              textureLighting={textureLighting}
            >
              {showAxes && <PolyAxesHelper size={helperScale * 0.6} />}
              {showLightHelper && (
                <PolyDirectionalLightHelper
                  light={directionalLight}
                  target={helperTarget}
                  distance={helperScale * 0.7}
                  size={helperScale * 0.05}
                />
              )}
            </PolyScene>
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
