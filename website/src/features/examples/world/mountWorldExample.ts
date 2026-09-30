import { createGlyphOrthographicCamera, createGlyphScene } from "glyphcss";
import { createMountScope } from "../../../services/lifecycle/mountScope";

import { readQueryNumber } from "../model/queryValues";
import { createExampleQuerySync } from "../services/querySync";

import { defaultGlyphColorEncoding } from "../../../services/rendering/glyphColorEncodingDefault";

export function mountWorldExample(root: HTMLElement) {
  const scope = createMountScope();
  let mountedTimer0: ReturnType<typeof setTimeout> | undefined;
  scope.onDispose(() => {
    if (mountedTimer0 !== undefined) clearTimeout(mountedTimer0);
  });

  type Polygon = { vertices: [number, number, number][]; color?: string };

  type MeshHandle = { dispose(): void; setTransform(t: unknown): void };

  type Manifest = {
    zooms: Array<{ z: number; cols: number; rows: number; tileLonSpan: number; tileLatSpan: number }>;
    heightExagg: number;
    earthRadiusM: number;
  };

  const INITIAL_ZOOM = 300;

  function compactRotation(degrees: number): number {
    const normalized = ((((degrees + 180) % 360) + 360) % 360) - 180;
    return Object.is(normalized, -0) ? 0 : normalized;
  }

  // Camera.zoom thresholds for LOD selection. zoom is absolute CSS px per
  // world unit. At the default zoom the whole unit-radius globe is visible at
  // low detail (z0). Switch to z1 once the user has zoomed in enough that z0
  // tiles look coarse.
  // Globe ships only z0/z1 tiles (decorative orbit view — deep zoom isn't
  // worth the data weight), so the LOD never exceeds 1.
  function targetLOD(zoom: number): number {
    if (zoom < 600) return 0;
    return 1;
  }

  // Match bake-globe.mjs's latLonToXYZ exactly so the client can predict
  // where tile corners sit in world space and run the same projection the
  // renderer uses.
  function latLonToXYZ(latDeg: number, lonDeg: number): [number, number, number] {
    const lat = (latDeg * Math.PI) / 180;
    const lon = (lonDeg * Math.PI) / 180;
    const cosLat = Math.cos(lat);
    return [cosLat * Math.cos(lon), -cosLat * Math.sin(lon), Math.sin(lat)];
  }

  async function mountGlobe() {
    const host = root.querySelector(`#${"globe-host"}`) as HTMLDivElement;
    const loading = root.querySelector(`#${"loading"}`);
    if (!host) return;

    // Classic iso: rotX ≈ 55°, rotY ≈ 45°. INITIAL_ZOOM fills most of the
    // viewport while staying in LOD 0.
    // On a narrow phone the desktop zoom crops the sphere, so start smaller
    // there — scaled to the viewport width so the whole globe is visible.
    const responsiveZoom = window.innerWidth < 800 ? Math.max(120, Math.round(window.innerWidth / 2.6)) : INITIAL_ZOOM;
    const queryParams = new URLSearchParams(window.location.search);
    const initialRotX = compactRotation(readQueryNumber(queryParams, "rotX", 55));
    const initialRotY = compactRotation(readQueryNumber(queryParams, "rotY", 45));
    const initialZoom = readQueryNumber(queryParams, "zoom", responsiveZoom, { min: 80, max: 1800 });
    const camera = createGlyphOrthographicCamera({
      rotX: initialRotX,
      rotY: initialRotY,
      zoom: initialZoom,
    });

    const querySync = createExampleQuerySync(() => ({
      rotX: compactRotation(camera.rotX),
      rotY: compactRotation(camera.rotY),
      zoom: Math.max(80, Math.min(1800, camera.zoom)),
    }));
    querySync.write();

    const scene = scope.own(
      createGlyphScene(host, {
        camera,
        autoSize: true,
        mode: "solid",
        useColors: true,
        glyphPalette: "default",
        // Feature-detected site default; no UI control on this fixed demo, so
        // this is the only place it's decided. Degrades to spans on its own
        // (colour/palette budget, unsupported engine) via isGlyphAtlasEncodable.
        colorEncoding: defaultGlyphColorEncoding(),
        directionalLight: { direction: [0.5, 0.7, 0.5], intensity: 1.1 },
        ambientLight: { intensity: 0.45 },
      }),
      (resource) => resource.destroy(),
    );

    const manifestRes = await fetch("/data/tiles/manifest.json", { signal: scope.signal });
    const manifest = (await manifestRes.json()) as Manifest;

    // Tile cache (key = "z/x_y") + active mesh handles. We never refetch a
    // tile once loaded; mounting from cache is dispose-old + scene.add.
    const tileCache = new Map<string, Polygon[]>();
    const activeHandles = new Map<string, MeshHandle>();
    let currentLOD: number | null = null;
    let updateInFlight = false;

    async function loadTile(z: number, x: number, y: number): Promise<Polygon[]> {
      const key = `${z}/${x}_${y}`;
      const cached = tileCache.get(key);
      if (cached) return cached;
      const res = await fetch(`/data/tiles/${key}.json`, { signal: scope.signal });
      const polys = await res.json();
      tileCache.set(key, polys);
      return polys;
    }

    // Visibility test built on great-circle distance from the camera's
    // focal point. Avoids per-tile screen-space projection (which the
    // earlier corner-projection test got wrong at high zoom: the projection
    // shoots points way off-grid, so "is the col in [0, 100]" silently
    // rejects every tile except the one your view is aimed directly at).
    //
    //   1. Sample lat/lon grid → find world point with minimum projected
    //      depth (the surface point closest to camera = focal point).
    //   2. Visible angular radius shrinks with zoom: at zoom 0.5 the whole
    //      hemisphere is visible; at zoom 50 we see ~π/50 rad of arc.
    //   3. A tile is visible if ANY of its 9 sample points is within that
    //      radius of the focal point on the sphere.

    function findFocalLatLon(): [number, number] {
      // Coarse scan over the front hemisphere — depth < 0 means front-facing.
      let bestLat = 0,
        bestLon = 0,
        bestDepth = Infinity;
      for (let lat = -80; lat <= 80; lat += 10) {
        for (let lon = -180; lon < 180; lon += 10) {
          const [, , depth] = camera.project(latLonToXYZ(lat, lon), 100, 100, 1);
          if (depth < bestDepth) {
            bestDepth = depth;
            bestLat = lat;
            bestLon = lon;
          }
        }
      }
      // Refine in a ±10° window at 2° steps.
      for (let lat = bestLat - 10; lat <= bestLat + 10; lat += 2) {
        for (let lon = bestLon - 10; lon <= bestLon + 10; lon += 2) {
          const [, , depth] = camera.project(latLonToXYZ(lat, lon), 100, 100, 1);
          if (depth < bestDepth) {
            bestDepth = depth;
            bestLat = lat;
            bestLon = lon;
          }
        }
      }
      return [bestLat, bestLon];
    }

    function angularDistanceRad(lat1: number, lon1: number, lat2: number, lon2: number): number {
      const phi1 = (lat1 * Math.PI) / 180;
      const phi2 = (lat2 * Math.PI) / 180;
      const dLambda = ((lon2 - lon1) * Math.PI) / 180;
      const cos = Math.min(
        1,
        Math.max(-1, Math.sin(phi1) * Math.sin(phi2) + Math.cos(phi1) * Math.cos(phi2) * Math.cos(dLambda)),
      );
      return Math.acos(cos);
    }

    function isTileVisible(
      z: number,
      x: number,
      y: number,
      focalLat: number,
      focalLon: number,
      radiusRad: number,
    ): boolean {
      const def = manifest.zooms.find((zz) => zz.z === z);
      if (!def) return false;
      const lonMin = -180 + x * def.tileLonSpan;
      const lonMax = lonMin + def.tileLonSpan;
      const latMax = 90 - y * def.tileLatSpan;
      const latMin = latMax - def.tileLatSpan;
      for (const lat of [latMin, (latMin + latMax) / 2, latMax]) {
        for (const lon of [lonMin, (lonMin + lonMax) / 2, lonMax]) {
          if (angularDistanceRad(focalLat, focalLon, lat, lon) < radiusRad) return true;
        }
      }
      return false;
    }

    // Pick the active tile set for the current zoom + view direction, then
    // diff against currently-mounted handles. Fetches missing tiles in
    // parallel before doing any DOM changes so the scene never blinks.
    async function updateActiveSet() {
      if (updateInFlight) return;
      updateInFlight = true;
      try {
        const lod = targetLOD(camera.zoom);
        const def = manifest.zooms.find((zz) => zz.z === lod);
        if (!def) return;

        // Visible angular radius. For an orthographic globe view we always see
        // roughly the front hemisphere (π/2 rad). Pad by a tile diagonal so
        // tiles straddling the horizon still load before they pop in.
        const tileDiagRad = Math.hypot(def.tileLonSpan, def.tileLatSpan) * 0.5 * (Math.PI / 180);
        const visibleAngularRad = Math.PI / 2 + tileDiagRad;

        const [focalLat, focalLon] = findFocalLatLon();

        const desired = new Set<string>();
        for (let y = 0; y < def.rows; y++) {
          for (let x = 0; x < def.cols; x++) {
            if (isTileVisible(lod, x, y, focalLat, focalLon, visibleAngularRad)) {
              desired.add(`${lod}/${x}_${y}`);
            }
          }
        }
        // Failsafe: at high zoom looking near a pole the corner test can
        // miss every tile. Always include at least one tile.
        if (desired.size === 0 && def.cols > 0 && def.rows > 0) {
          desired.add(`${lod}/0_0`);
        }

        // Fetch missing tiles in parallel.
        const missing = [...desired].filter((k) => !tileCache.has(k));
        if (missing.length > 0) {
          await Promise.all(
            missing.map((k) => {
              const [z, xy] = k.split("/");
              const [x, y] = xy.split("_").map(Number);
              return loadTile(Number(z), x, y);
            }),
          );
        }

        // Diff: dispose handles whose tile no longer belongs, mount new ones.
        for (const [key, handle] of activeHandles) {
          if (!desired.has(key)) {
            handle.dispose();
            activeHandles.delete(key);
          }
        }
        for (const key of desired) {
          if (!activeHandles.has(key)) {
            const polys = tileCache.get(key);
            if (polys) activeHandles.set(key, scene.add(polys) as unknown as MeshHandle);
          }
        }

        currentLOD = lod;
        scene.rerender();
      } finally {
        updateInFlight = false;
      }
    }

    // Wheel events fire ~50 per second; a rapid scroll can blow through
    // every LOD threshold in one burst. Debounce so we only fetch the
    // tier the user settles on, not every intermediate one.
    let updateTimer: ReturnType<typeof setTimeout> | null = null;
    function scheduleUpdate(onSettled?: () => void): void {
      if (updateTimer) clearTimeout(updateTimer);
      updateTimer = mountedTimer0 = setTimeout(() => {
        updateTimer = null;
        void updateActiveSet();
        onSettled?.();
      }, 180);
    }

    await updateActiveSet();
    loading?.remove();

    // ── Country labels (GADM) anchored on the sphere ──────────────────
    // Hotspots at each country's lat/lon, lifted just above the terrain so
    // they float on the globe. We hide far-side labels (projected depth on
    // the back hemisphere) and declutter by country size.
    type LabelRec = { name: string; lat: number; lon: number; w: number };
    const labelEls: HTMLElement[] = [];
    let labelData: LabelRec[] = [];
    const LABEL_R = 1.06; // sphere radius for labels (above peak relief ~1.04)
    type ProjectionGrid = {
      cols: number;
      rows: number;
      cellAspect: number;
      cellWidth: number;
      cellHeight: number;
      centerCol: number;
      centerRow: number;
    };
    function gridDims() {
      const o = scene.getOptions();
      return { cols: o.cols ?? 80, rows: o.rows ?? 24, cellAspect: o.cellAspect ?? 2 };
    }
    function projectionGrid(): ProjectionGrid {
      const g = gridDims();
      const hostRect = host.getBoundingClientRect();
      const preRect = scene.output.getBoundingClientRect();
      const cellWidth =
        preRect.width > 0 ? preRect.width / g.cols : hostRect.width > 0 ? hostRect.width / g.cols : 50 / g.cellAspect;
      const cellHeight =
        preRect.height > 0 ? preRect.height / g.rows : hostRect.height > 0 ? hostRect.height / g.rows : 50;
      return {
        ...g,
        cellWidth,
        cellHeight,
        centerCol:
          g.cols * camera.center[0] +
          (hostRect.width > 0 ? (hostRect.width - g.cols * cellWidth) / (2 * cellWidth) : 0),
        centerRow:
          g.rows * camera.center[1] +
          (hostRect.height > 0 ? (hostRect.height - g.rows * cellHeight) / (2 * cellHeight) : 0),
      };
    }
    function updateGlobeLabels(): void {
      const pg = projectionGrid();
      const hostRect = host.getBoundingClientRect();
      const maxShown = Math.max(8, Math.min(labelData.length, Math.round((camera.zoom / INITIAL_ZOOM) * 9)));
      const placed: Array<{ x: number; y: number; w: number; h: number }> = [];
      let count = 0;
      for (let i = 0; i < labelEls.length; i++) {
        const rec = labelData[i];
        const u = latLonToXYZ(rec.lat, rec.lon);
        const [col, row, depth] = camera.project(
          [u[0] * LABEL_R, u[1] * LABEL_R, u[2] * LABEL_R],
          pg.cols,
          pg.rows,
          pg.cellAspect,
          pg,
        );
        let show = false;
        // depth < 0 = front hemisphere (facing camera). Back-side labels hide.
        if (count < maxShown && depth < 0 && Number.isFinite(col)) {
          const px = col * pg.cellWidth,
            py = row * pg.cellHeight;
          if (px >= 0 && px <= hostRect.width && py >= 0 && py <= hostRect.height) {
            const w = rec.name.length * 6 + 6,
              h = 13;
            const r = { x: px - w / 2, y: py - h / 2, w, h };
            if (!placed.some((p) => !(r.x + r.w < p.x || r.x > p.x + p.w || r.y + r.h < p.y || r.y > p.y + p.h))) {
              placed.push(r);
              count++;
              show = true;
              const el = labelEls[i];
              el.style.left = `${px}px`;
              el.style.top = `${py}px`;
            }
          }
        }
        labelEls[i].style.opacity = show ? "0.92" : "0";
      }
    }
    void (async () => {
      try {
        const res = await fetch("/data/flatmap/labels.json", { signal: scope.signal });
        labelData = await res.json();
        for (const rec of labelData) {
          const el = document.createElement("div");
          el.textContent = rec.name;
          el.style.cssText =
            "position:absolute;transform:translate(-50%,-50%);white-space:nowrap;font-size:10px;" +
            "letter-spacing:0.08em;text-transform:uppercase;color:rgba(255,245,224,0.96);" +
            "text-shadow:0 0 3px #000,0 0 6px #000;opacity:0;transition:opacity 140ms ease;" +
            "pointer-events:none;z-index:5;";
          host.appendChild(el);
          labelEls.push(el);
        }
        updateGlobeLabels();
      } catch (e) {
        console.error("labels load failed", e);
      }
    })();

    // Custom drag handler — no pitch clamp (lets you flip the globe to view
    // poles from above/below). `invert`-style sign convention: drag right
    // spins the visible face east.
    //
    // Sensitivity is derived from the globe's on-screen size so dragging
    // tracks the cursor 1:1 at any zoom. A surface point at the front moves
    // ≈ dθ · R_screen pixels for a rotation dθ, and the sphere radius is 1
    // world unit, so dθ = dx_px / pixelsPerWorldUnit.
    function pixelsPerUnit(): number {
      const pg = projectionGrid();
      const a = camera.project([0, 0, 0], pg.cols, pg.rows, pg.cellAspect, pg);
      const b = camera.project([0, 0, 1], pg.cols, pg.rows, pg.cellAspect, pg); // +Z unit (screen-up axis)
      const dCol = (b[0] - a[0]) * pg.cellWidth;
      const dRow = (b[1] - a[1]) * pg.cellHeight;
      return Math.hypot(dCol, dRow) || 1;
    }
    let activePtr: number | null = null;
    let lastX = 0,
      lastY = 0;
    let viewDirty = false;
    host.addEventListener(
      "pointerdown",
      (e) => {
        if (activePtr !== null) return;
        activePtr = e.pointerId;
        lastX = e.clientX;
        lastY = e.clientY;
        // Capture on the stable host, NOT e.target: each pointermove rerenders
        // the <pre> (innerHTML replaced), which would destroy a captured child
        // and drop the gesture mid-drag — especially on touch.
        host.setPointerCapture(e.pointerId);
      },
      { signal: scope.signal },
    );
    host.addEventListener(
      "pointermove",
      (e) => {
        if (activePtr !== e.pointerId) return;
        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;
        lastX = e.clientX;
        lastY = e.clientY;
        // 1:1 cursor tracking: 1 world-unit subtends pixelsPerUnit() px on
        // screen; 1 radian of globe rotation moves a surface point ~1 world-unit
        // (radius 1 globe). Camera is in degrees, so convert.
        const degPerPx = (1 / pixelsPerUnit()) * (180 / Math.PI);
        camera.rotY += dx * degPerPx;
        camera.rotX += dy * degPerPx;
        viewDirty = true;
        scene.rerender();
        updateGlobeLabels();
      },
      { signal: scope.signal },
    );
    const release = (e: PointerEvent) => {
      if (activePtr !== e.pointerId) return;
      activePtr = null;
      try {
        host.releasePointerCapture(e.pointerId);
      } catch {}
      // Recompute visible tile set after a drag — newly-revealed tiles
      // get fetched (and cached for next time).
      if (viewDirty) {
        viewDirty = false;
        querySync.write();
        scheduleUpdate();
      }
    };
    host.addEventListener("pointerup", release, { signal: scope.signal });
    host.addEventListener("pointercancel", release, { signal: scope.signal });
    host.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const delta = e.deltaY * 0.001;
        // Zoom range: 80 (globe small) – 1800 (z1 tiles fill viewport).
        // Only z0/z1 tiles ship so deeper zoom just enlarges coarse tiles.
        camera.zoom = Math.max(80, Math.min(1800, camera.zoom * (1 - delta)));
        scene.rerender();
        updateGlobeLabels();
        // Always schedule — the debounce coalesces rapid wheel events into
        // a single fetch for whichever LOD the user lands on.
        scheduleUpdate(querySync.write);
      },
      { ...{ passive: false }, signal: scope.signal },
    );
  }

  void mountGlobe();

  return scope.dispose;
}
