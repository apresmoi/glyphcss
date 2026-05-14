/**
 * bench/perf-shared.mjs — framework-agnostic helpers for the four
 * perf pages (html / vanilla / react / vue).
 *
 * Each page imports this for:
 *   - PRESETS: mesh preset metadata (url + parser options + camera defaults)
 *   - parseUrlParams(): pull mesh/mode/motion/az/el from window.location.search
 *   - dirFromAzEl(): light-direction vector
 *   - createPerfRecorder(): installs window.__perf__, wires the FPS overlay,
 *     and returns an onFrame() callback the page hands to its rAF loop.
 *
 * Mesh loading and scene mounting are NOT here — those are framework-
 * specific. Each page handles its own mount and its own per-frame state
 * update; this module just provides the measurement surface.
 */

export const PRESETS = {
  saucer: {
    url: "/gallery/obj/saucer.obj",
    options: { targetSize: 60, defaultColor: "#94a3b8" },
    zoom: 0.2, rotX: 67, rotY: 42.3,
  },
  chicken: {
    url: "/gallery/obj/chicken.obj",
    mtlUrl: "/gallery/obj/chicken.mtl",
    options: { targetSize: 60, defaultColor: "#cccccc" },
    zoom: 0.15, rotX: 74.4, rotY: 301.6,
  },
  coliseum: {
    url: "/gallery/obj/coliseum.obj",
    options: { targetSize: 80, palette: ["#c9a876", "#a78760", "#8b6f47", "#6b5538"] },
    zoom: 0.15, rotX: 65, rotY: 45,
  },
  castle: {
    url: "/gallery/obj/castle.obj",
    options: { targetSize: 60 },
    zoom: 0.15, rotX: 66.9, rotY: 68.5,
  },
  teapot: {
    url: "/gallery/obj/teapot.obj",
    options: { targetSize: 60, defaultColor: "#a3a3a3" },
    zoom: 0.2, rotX: 65, rotY: 45,
  },
  rock1: {
    url: "/gallery/obj/rock1.obj",
    mtlUrl: "/gallery/obj/rock1.mtl",
    options: { targetSize: 40, defaultColor: "#8b6f47", excludeObjects: ["Plane"] },
    zoom: 0.6, rotX: 65, rotY: 45,
  },
  apple: {
    url: "/gallery/glb/apple.glb",
    options: { targetSize: 60 },
    zoom: 0.25, rotX: 74.4, rotY: 301.6,
  },
};

export function parseUrlParams() {
  const params = new URLSearchParams(window.location.search);
  const meshId = params.get("mesh") || "saucer";
  return {
    meshId,
    mode: params.get("mode") === "baked" ? "baked" : "dynamic",
    motion: params.get("motion") || "light", // light | rot | none
    az: parseFloat(params.get("az")) || 50,
    el: parseFloat(params.get("el")) || 45,
    isSynth: meshId.startsWith("synth-"),
    preset: meshId.startsWith("synth-")
      ? { url: null, options: {}, zoom: 0.2, rotX: 65, rotY: 45 }
      : (PRESETS[meshId] ?? PRESETS.saucer),
  };
}

export function dirFromAzEl(azDeg, elDeg) {
  const az = (azDeg * Math.PI) / 180;
  const el = (elDeg * Math.PI) / 180;
  const cosEl = Math.cos(el);
  return [cosEl * Math.sin(az), cosEl * Math.cos(az), Math.sin(el)];
}

/**
 * Set up the FPS overlay (matches the layout in each perf-*.html) and
 * the window.__perf__ recorder the headless bench reads.
 *
 * Returns:
 *   { onFrame(now) }  — call once per rAF tick. Updates the rolling
 *                       FPS readout, appends to window.__perf__.samples,
 *                       and bounds memory.
 */
export function createPerfRecorder({ rendererLabel, meshId, mode, motion, polyCount }) {
  document.getElementById("meta-renderer").textContent = rendererLabel;
  document.getElementById("meta-polys").textContent = String(polyCount ?? "?");
  document.getElementById("meta-mode").textContent = mode;
  document.getElementById("meta-motion").textContent = motion;

  const fpsNow = document.getElementById("fps-now");
  const metaFrames = document.getElementById("meta-frames");
  const FRAME_BUFFER = 60; // last ~1 sec at 60fps

  const frameTimes = [];
  let lastTs = performance.now();
  let frameCount = 0;

  // Headless bench reads this. Appended to once per onFrame() call.
  window.__perf__ = {
    renderer: rendererLabel,
    mesh: meshId, mode, motion,
    polyCount: polyCount ?? 0,
    samples: [],
    ready: true,
    startedAt: performance.now(),
  };

  return {
    onFrame(now) {
      const dt = now - lastTs;
      lastTs = now;
      frameTimes.push(dt);
      if (frameTimes.length > FRAME_BUFFER) frameTimes.shift();
      frameCount += 1;
      window.__perf__.samples.push({ t: now, dt });
      if (window.__perf__.samples.length > 1800) {
        window.__perf__.samples.splice(0, window.__perf__.samples.length - 1800);
      }
      if (frameCount % 10 === 0) {
        const avg = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
        fpsNow.textContent = (1000 / avg).toFixed(1);
        metaFrames.textContent = String(frameCount);
      }
    },
  };
}

/**
 * Shared overlay HTML used by every perf-*.html page. Each page just
 * does `document.body.insertAdjacentHTML('beforeend', PERF_OVERLAY_HTML)`
 * to drop in the same FPS panel.
 */
export const PERF_OVERLAY_HTML = `
  <div id="fps">
    <b id="fps-now">—</b><small> fps (avg)</small>
    <hr/>
    <div class="row"><small>renderer</small><b id="meta-renderer">—</b></div>
    <div class="row"><small>polys</small><b id="meta-polys">—</b></div>
    <div class="row"><small>mode</small><b id="meta-mode">—</b></div>
    <div class="row"><small>motion</small><b id="meta-motion">—</b></div>
    <div class="row"><small>frames</small><b id="meta-frames">—</b></div>
  </div>
`;

export const PERF_OVERLAY_CSS = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
    width: 100%; height: 100%;
    background: #0e1014; color: #e2e8f0;
    font-family: ui-sans-serif, system-ui, sans-serif;
  }
  #host { width: 100vw; height: 100vh; position: relative; }
  #fps {
    position: fixed; top: 12px; right: 12px;
    background: rgba(15, 18, 24, 0.85);
    border: 1px solid #2a313d;
    border-radius: 6px;
    padding: 10px 14px;
    font-family: ui-monospace, monospace;
    font-size: 13px;
    line-height: 1.45;
    pointer-events: none;
    z-index: 1000;
    min-width: 200px;
  }
  #fps b#fps-now { color: #a3e635; font-size: 22px; display: inline-block; min-width: 50px; }
  #fps small { color: #94a3b8; font-size: 11px; }
  #fps .row { display: flex; justify-content: space-between; gap: 8px; }
  #fps .row b { color: #e2e8f0; font-weight: 500; }
  #fps hr { border: none; border-top: 1px solid #2a313d; margin: 6px 0; }
`;
