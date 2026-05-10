/**
 * Compare the stock Insurgent glTF against variants that either remove the
 * tiny sphere-like connected components or replace them with cheap LOD
 * proxies.
 *
 * Usage:
 *   node bench/insurgent-semis-bench.mjs
 *   node bench/insurgent-semis-bench.mjs --warmup 1500 --sample 4000
 *   node bench/insurgent-semis-bench.mjs --scenario baked.static
 *   node bench/insurgent-semis-bench.mjs --variant lod-box
 *   node bench/insurgent-semis-bench.mjs --headed
 *
 * This uses the vanilla createPolyScene path. The page parses the glTF in
 * browser, so the embedded texture Blob URLs stay valid for rendering.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const benchDir = resolve(repoRoot, "bench");
const galleryDir = resolve(repoRoot, "website/public/gallery");
const polycssBundle = resolve(benchDir, "polycss.js");

const argv = process.argv.slice(2);
const flag = (name) => argv.indexOf(`--${name}`);
const optStr = (name, dflt = "") => {
  const i = flag(name);
  return i >= 0 ? argv[i + 1] : dflt;
};
const optNum = (name, dflt) => {
  const v = optStr(name);
  return v ? Number(v) : dflt;
};
const hasFlag = (name) => flag(name) >= 0;

const WARMUP_MS = optNum("warmup", 1500);
const SAMPLE_MS = optNum("sample", 4000);
const HEADED = hasFlag("headed");
const LABEL = optStr("label");
const SCENARIO_FILTER = optStr("scenario");
const VARIANT_FILTER = optStr("variant");

const SCENARIOS = [
  { key: "dynamic.static", mode: "dynamic", motion: "none" },
  { key: "dynamic.light_rotate", mode: "dynamic", motion: "light" },
  { key: "dynamic.camera_rotate", mode: "dynamic", motion: "rot" },
  { key: "baked.static", mode: "baked", motion: "none" },
  { key: "baked.camera_rotate", mode: "baked", motion: "rot" },
].filter((s) => !SCENARIO_FILTER || s.key === SCENARIO_FILTER);

const VARIANTS = ["normal", "no-semis", "lod-box", "lod-cross"]
  .filter((variant) => !VARIANT_FILTER || variant === VARIANT_FILTER);

if (SCENARIOS.length === 0) {
  throw new Error(`Unknown scenario "${SCENARIO_FILTER}"`);
}
if (VARIANTS.length === 0) {
  throw new Error(`Unknown variant "${VARIANT_FILTER}"`);
}
if (!existsSync(polycssBundle)) {
  throw new Error("bench/polycss.js is missing. Run `node bench/build.mjs` first.");
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".gltf": "application/json; charset=utf-8",
  ".glb": "model/gltf-binary",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

function pageHtml() {
  return String.raw`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>polycss perf - insurgent semis</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; background: #0e1014; color: #e2e8f0; font-family: ui-sans-serif, system-ui, sans-serif; }
    #host { width: 100vw; height: 100vh; position: relative; }
  </style>
</head>
<body>
  <div id="host"></div>
  <script type="module">
    import {
      createPolyScene,
      createPolyControls,
      parseGltf,
      cullInteriorPolygons,
      mergePolygons,
    } from "./polycss.js";

    const params = new URLSearchParams(location.search);
    const variant = params.get("variant") || "normal";
    const mode = params.get("mode") === "baked" ? "baked" : "dynamic";
    const motion = params.get("motion") || "none";
    const az = Number(params.get("az") || 50);
    const el = Number(params.get("el") || 45);

    function dirFromAzEl(azDeg, elDeg) {
      const azRad = (azDeg * Math.PI) / 180;
      const elRad = (elDeg * Math.PI) / 180;
      const cosEl = Math.cos(elRad);
      return [cosEl * Math.sin(azRad), cosEl * Math.cos(azRad), Math.sin(elRad)];
    }

    function solve4(A, b) {
      A = A.map((row) => row.slice());
      b = b.slice();
      for (let i = 0; i < 4; i++) {
        let pivot = i;
        for (let r = i + 1; r < 4; r++) {
          if (Math.abs(A[r][i]) > Math.abs(A[pivot][i])) pivot = r;
        }
        if (Math.abs(A[pivot][i]) < 1e-12) return null;
        [A[i], A[pivot]] = [A[pivot], A[i]];
        [b[i], b[pivot]] = [b[pivot], b[i]];
        const div = A[i][i];
        for (let c = i; c < 4; c++) A[i][c] /= div;
        b[i] /= div;
        for (let r = 0; r < 4; r++) {
          if (r === i) continue;
          const factor = A[r][i];
          for (let c = i; c < 4; c++) A[r][c] -= factor * A[i][c];
          b[r] -= factor * b[i];
        }
      }
      return b;
    }

    function fitSphere(points) {
      const A = Array.from({ length: 4 }, () => [0, 0, 0, 0]);
      const b = [0, 0, 0, 0];
      for (const [x, y, z] of points) {
        const row = [x, y, z, 1];
        const rhs = -(x * x + y * y + z * z);
        for (let i = 0; i < 4; i++) {
          for (let j = 0; j < 4; j++) A[i][j] += row[i] * row[j];
          b[i] += row[i] * rhs;
        }
      }
      const sol = solve4(A, b);
      if (!sol) return null;
      const [a, bb, c, d] = sol;
      const center = [-a / 2, -bb / 2, -c / 2];
      const radius2 = center[0] ** 2 + center[1] ** 2 + center[2] ** 2 - d;
      if (!(radius2 > 0)) return null;
      const radius = Math.sqrt(radius2);
      const min = [Infinity, Infinity, Infinity];
      const max = [-Infinity, -Infinity, -Infinity];
      const devs = [];
      const bins = new Set();
      for (const p of points) {
        for (let i = 0; i < 3; i++) {
          min[i] = Math.min(min[i], p[i]);
          max[i] = Math.max(max[i], p[i]);
        }
        const vx = p[0] - center[0];
        const vy = p[1] - center[1];
        const vz = p[2] - center[2];
        const len = Math.hypot(vx, vy, vz) || 1;
        devs.push(Math.abs(len - radius) / radius);
        const theta = Math.atan2(vy / len, vx / len);
        const phi = Math.asin(Math.max(-1, Math.min(1, vz / len)));
        bins.add(String(Math.floor((theta + Math.PI) / (2 * Math.PI) * 16)) + "," + String(Math.floor((phi + Math.PI / 2) / Math.PI * 8)));
      }
      devs.sort((x, y) => x - y);
      const p95 = devs[Math.floor(0.95 * (devs.length - 1))] ?? Infinity;
      const rms = Math.sqrt(devs.reduce((sum, x) => sum + x * x, 0) / devs.length);
      const extents = [max[0] - min[0], max[1] - min[1], max[2] - min[2]].sort((x, y) => x - y);
      const extentRatio = extents[2] > 0 ? extents[0] / extents[2] : 0;
      const boxCenter = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
      const centerOffset = Math.hypot(center[0] - boxCenter[0], center[1] - boxCenter[1], center[2] - boxCenter[2]) / radius;
      return { radius, p95, rms, extentRatio, centerOffset, bins: bins.size };
    }

    function componentInfo(polygons) {
      const keyToPoly = new Map();
      const keyFor = ([x, y, z]) => Math.round(x * 1000) + "," + Math.round(y * 1000) + "," + Math.round(z * 1000);
      polygons.forEach((polygon, index) => {
        for (const vertex of polygon.vertices ?? []) {
          const key = keyFor(vertex);
          let list = keyToPoly.get(key);
          if (!list) keyToPoly.set(key, list = []);
          list.push(index);
        }
      });

      const seen = new Uint8Array(polygons.length);
      const components = [];
      for (let i = 0; i < polygons.length; i++) {
        if (seen[i]) continue;
        const stack = [i];
        seen[i] = 1;
        const polygonIndices = [];
        const pointKeys = new Set();
        const points = [];
        while (stack.length) {
          const current = stack.pop();
          polygonIndices.push(current);
          for (const vertex of polygons[current].vertices ?? []) {
            const key = keyFor(vertex);
            if (!pointKeys.has(key)) {
              pointKeys.add(key);
              points.push(vertex);
            }
            for (const next of keyToPoly.get(key) ?? []) {
              if (!seen[next]) {
                seen[next] = 1;
                stack.push(next);
              }
            }
          }
        }
        components.push({ polygonIndices, points });
      }
      return components;
    }

    function boundsForPoints(points) {
      const min = [Infinity, Infinity, Infinity];
      const max = [-Infinity, -Infinity, -Infinity];
      for (const point of points) {
        for (let i = 0; i < 3; i++) {
          min[i] = Math.min(min[i], point[i]);
          max[i] = Math.max(max[i], point[i]);
        }
      }
      return { min, max };
    }

    function colorForComponent(component, polygons) {
      const counts = new Map();
      for (const index of component.polygonIndices) {
        const color = polygons[index].color ?? "#888888";
        counts.set(color, (counts.get(color) ?? 0) + 1);
      }
      let best = "#888888";
      let bestCount = -1;
      for (const [color, count] of counts) {
        if (count > bestCount) {
          best = color;
          bestCount = count;
        }
      }
      return best;
    }

    function boxProxyForComponent(component, polygons) {
      const { min, max } = boundsForPoints(component.points);
      const color = colorForComponent(component, polygons);
      const [x0, y0, z0] = min;
      const [x1, y1, z1] = max;
      return [
        { vertices: [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]], color },
        { vertices: [[x0, y0, z1], [x0, y1, z1], [x1, y1, z1], [x1, y0, z1]], color },
        { vertices: [[x0, y0, z0], [x0, y0, z1], [x1, y0, z1], [x1, y0, z0]], color },
        { vertices: [[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]], color },
        { vertices: [[x1, y1, z0], [x1, y1, z1], [x0, y1, z1], [x0, y1, z0]], color },
        { vertices: [[x0, y1, z0], [x0, y1, z1], [x0, y0, z1], [x0, y0, z0]], color },
      ];
    }

    function crossProxyForComponent(component, polygons) {
      const { min, max } = boundsForPoints(component.points);
      const color = colorForComponent(component, polygons);
      const [x0, y0, z0] = min;
      const [x1, y1, z1] = max;
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2;
      const cz = (z0 + z1) / 2;
      return [
        { vertices: [[x0, y0, cz], [x1, y0, cz], [x1, y1, cz], [x0, y1, cz]], color },
        { vertices: [[x0, cy, z0], [x1, cy, z0], [x1, cy, z1], [x0, cy, z1]], color },
        { vertices: [[cx, y0, z0], [cx, y1, z0], [cx, y1, z1], [cx, y0, z1]], color },
      ];
    }

    function findInsurgentSemis(polygons) {
      const components = componentInfo(polygons);
      const candidates = [];
      for (const component of components) {
        if (component.polygonIndices.length < 32 || component.points.length < 20) continue;
        const fit = fitSphere(component.points);
        if (!fit) continue;
        const semi =
          fit.p95 <= 0.055 &&
          fit.rms <= 0.04 &&
          fit.extentRatio >= 0.45 &&
          fit.centerOffset <= 0.55;
        if (!semi) continue;
        candidates.push({
          component,
          polygons: component.polygonIndices.length,
          vertices: component.points.length,
          radius: fit.radius,
          p95: fit.p95,
          rms: fit.rms,
          extentRatio: fit.extentRatio,
          centerOffset: fit.centerOffset,
          bins: fit.bins,
        });
      }
      return candidates;
    }

    function summarizeSemis(candidates) {
      return candidates.map(({ component, ...meta }) => meta);
    }

    function removeInsurgentSemis(polygons) {
      const candidates = findInsurgentSemis(polygons);
      const remove = new Set();
      for (const candidate of candidates) {
        for (const index of candidate.component.polygonIndices) remove.add(index);
      }
      return {
        polygons: polygons.filter((_, index) => !remove.has(index)),
        removedComponents: summarizeSemis(candidates),
        removedPolygons: remove.size,
        proxyPolygons: 0,
      };
    }

    function proxyInsurgentSemis(polygons, proxyKind) {
      const candidates = findInsurgentSemis(polygons);
      const remove = new Set();
      const proxies = [];
      for (const candidate of candidates) {
        for (const index of candidate.component.polygonIndices) remove.add(index);
        proxies.push(
          ...(proxyKind === "cross"
            ? crossProxyForComponent(candidate.component, polygons)
            : boxProxyForComponent(candidate.component, polygons)),
        );
      }
      return {
        polygons: [
          ...polygons.filter((_, index) => !remove.has(index)),
          ...proxies,
        ],
        removedComponents: summarizeSemis(candidates),
        removedPolygons: remove.size,
        proxyPolygons: proxies.length,
      };
    }

    function optimizeInsurgentSemis(polygons, variant) {
      if (variant === "no-semis") return removeInsurgentSemis(polygons);
      if (variant === "lod-box") return proxyInsurgentSemis(polygons, "box");
      if (variant === "lod-cross") return proxyInsurgentSemis(polygons, "cross");
      const detected = removeInsurgentSemis(polygons);
      return {
        polygons,
        removedComponents: detected.removedComponents,
        removedPolygons: detected.removedPolygons,
        proxyPolygons: 0,
      };
    }

    function postprocess(polygons) {
      const surface = cullInteriorPolygons(polygons);
      const merged = mergePolygons(surface);
      return merged.length < polygons.length ? merged : polygons;
    }

    function quantile(sorted, q) {
      if (sorted.length === 0) return 0;
      const i = (sorted.length - 1) * q;
      const lo = Math.floor(i);
      const hi = Math.ceil(i);
      if (lo === hi) return sorted[lo];
      return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
    }

    async function main() {
      const gltfUrl = new URL("/gallery/glb/insurgent.gltf", location.href).href;
      const buf = await fetch(gltfUrl).then((res) => {
        if (!res.ok) throw new Error("fetch insurgent.gltf -> " + res.status);
        return res.arrayBuffer();
      });
      const parsed = parseGltf(buf, { baseUrl: gltfUrl, targetSize: 60 });
      const rawPolygons = parsed.polygons;
      const optimized = optimizeInsurgentSemis(rawPolygons, variant);
      const selectedRaw = optimized.polygons;
      const finalPolygons = postprocess(selectedRaw);

      const host = document.getElementById("host");
      let azimuth = az;
      const scene = createPolyScene(host, {
        rotX: 65,
        rotY: 45,
        zoom: 0.4,
        directionalLight: { direction: dirFromAzEl(azimuth, el), color: "#ffffff", intensity: 1 },
        ambientLight: { color: "#ffffff", intensity: 0.4 },
        textureLighting: mode,
        autoCenter: true,
      });
      createPolyControls(scene, { drag: true, wheel: true, animate: false });
      scene.add({ ...parsed, polygons: finalPolygons });

      window.__perf__ = {
        ready: true,
        variant,
        mode,
        motion,
        polyCount: finalPolygons.length,
        rawPolyCount: rawPolygons.length,
        selectedRawPolyCount: selectedRaw.length,
        removedRawPolygons: optimized.removedPolygons,
        removedComponents: optimized.removedComponents,
        proxyPolygons: optimized.proxyPolygons,
        samples: [],
      };

      let lastTs = performance.now();
      let frameCount = 0;
      function tick(now) {
        const dt = now - lastTs;
        lastTs = now;
        window.__perf__.samples.push({ t: now, dt });
        if (window.__perf__.samples.length > 2400) {
          window.__perf__.samples.splice(0, window.__perf__.samples.length - 2400);
        }
        frameCount += 1;
        if (motion === "light") {
          azimuth = (azimuth + 0.5) % 360;
          scene.setOptions({
            directionalLight: { direction: dirFromAzEl(azimuth, el), color: "#ffffff", intensity: 1 },
          });
        } else if (motion === "rot") {
          scene.setOptions({ rotY: ((45 + frameCount * 0.5) + 360) % 360 });
        }
        requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    }

    main().catch((err) => {
      console.error(err);
      window.__perf__ = { ready: false, error: String(err?.message ?? err), samples: [] };
    });
  </script>
</body>
</html>`;
}

function startServer() {
  return new Promise((resolveStart, rejectStart) => {
    const server = createServer(async (req, res) => {
      try {
        const url = new URL(req.url, "http://localhost");
        const pathname = url.pathname.replace(/\/+/g, "/");
        if (pathname.includes("..")) {
          res.writeHead(403);
          res.end("forbidden");
          return;
        }
        if (pathname === "/" || pathname === "/insurgent-semis.html") {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
          res.end(pageHtml());
          return;
        }
        let abs;
        if (pathname.startsWith("/gallery/")) {
          abs = resolve(galleryDir, pathname.slice("/gallery/".length));
        } else {
          abs = resolve(benchDir, pathname.slice(1));
        }
        const data = await readFile(abs);
        res.writeHead(200, {
          "Content-Type": MIME[extname(abs).toLowerCase()] || "application/octet-stream",
          "Cache-Control": "no-store",
        });
        res.end(data);
      } catch (err) {
        res.writeHead(404);
        res.end(String(err?.message ?? err));
      }
    });
    server.on("error", rejectStart);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolveStart({ server, port: typeof addr === "object" ? addr.port : 0 });
    });
  });
}

function stopServer(server) {
  return new Promise((resolveStop) => server.close(() => resolveStop()));
}

async function runCase(port, scenario, variant) {
  const browser = await chromium.launch({ headless: !HEADED });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    const url = `http://127.0.0.1:${port}/insurgent-semis.html?variant=${variant}&mode=${scenario.mode}&motion=${scenario.motion}`;
    await page.goto(url, { waitUntil: "load" });
    await page.waitForFunction(() => window.__perf__?.ready === true, null, { timeout: 60000 });
    const meta = await page.evaluate(() => {
      const removed = window.__perf__.removedComponents ?? [];
      const groups = new Map();
      for (const item of removed) {
        const key = `${item.polygons}|${item.vertices}|${item.radius.toFixed(3)}`;
        const group = groups.get(key) ?? {
          count: 0,
          polygons: item.polygons,
          vertices: item.vertices,
          radius: +item.radius.toFixed(3),
        };
        group.count += 1;
        groups.set(key, group);
      }
      return {
        polyCount: window.__perf__.polyCount,
        rawPolyCount: window.__perf__.rawPolyCount,
        selectedRawPolyCount: window.__perf__.selectedRawPolyCount,
        removedRawPolygons: window.__perf__.removedRawPolygons,
        removedComponentCount: removed.length,
        removedComponentGroups: [...groups.values()],
        proxyPolygons: window.__perf__.proxyPolygons,
      };
    });
    await page.waitForTimeout(WARMUP_MS);
    const startIdx = await page.evaluate(() => window.__perf__.samples.length);
    await page.waitForTimeout(SAMPLE_MS);
    const result = await page.evaluate((from) => {
      const samples = window.__perf__.samples.slice(from);
      const raw = samples.map((s) => s.dt).filter((dt) => dt > 0);
      const dts = raw.filter((dt) => dt < 2000).sort((a, b) => a - b);
      const quantile = (sorted, q) => {
        if (sorted.length === 0) return 0;
        const i = (sorted.length - 1) * q;
        const lo = Math.floor(i);
        const hi = Math.ceil(i);
        if (lo === hi) return sorted[lo];
        return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
      };
      const p50 = quantile(dts, 0.5);
      const p95 = quantile(dts, 0.95);
      const p99 = quantile(dts, 0.99);
      return {
        fps_p50: p50 > 0 ? 1000 / p50 : 0,
        fps_p95: p95 > 0 ? 1000 / p95 : 0,
        frame_time_p50_ms: p50,
        frame_time_p95_ms: p95,
        frame_time_p99_ms: p99,
        sample_count: dts.length,
        sample_count_raw: raw.length,
      };
    }, startIdx);
    await ctx.close();
    return { ...meta, ...result };
  } finally {
    await browser.close();
  }
}

function roundResult(result) {
  return {
    ...result,
    fps_p50: +result.fps_p50.toFixed(2),
    fps_p95: +result.fps_p95.toFixed(2),
    frame_time_p50_ms: +result.frame_time_p50_ms.toFixed(2),
    frame_time_p95_ms: +result.frame_time_p95_ms.toFixed(2),
    frame_time_p99_ms: +result.frame_time_p99_ms.toFixed(2),
  };
}

const { server, port } = await startServer();
console.log(`[insurgent-semis] server :${port}`);
console.log(`[insurgent-semis] warmup=${WARMUP_MS}ms sample=${SAMPLE_MS}ms`);

try {
  const results = {};
  for (const scenario of SCENARIOS) {
    const scenarioResults = {};
    for (const variant of VARIANTS) {
      process.stdout.write(`  ${scenario.key.padEnd(24)} ${variant.padEnd(9)} ... `);
      const measured = await runCase(port, scenario, variant);
      process.stdout.write(`${measured.fps_p50.toFixed(1)}fps\n`);
      scenarioResults[variant] = roundResult(measured);
    }

    const normal = scenarioResults.normal;
    const deltas = {};
    if (normal) {
      for (const [variant, measured] of Object.entries(scenarioResults)) {
        if (variant === "normal") continue;
        deltas[variant] = {
          removedRawPolygons: measured.removedRawPolygons,
          removedComponents: measured.removedComponentCount,
          proxyPolygons: measured.proxyPolygons,
          finalPolygonDelta: normal.polyCount - measured.polyCount,
          fpsP50Delta: +(measured.fps_p50 - normal.fps_p50).toFixed(2),
          fpsP50Ratio: normal.fps_p50 > 0 ? +(measured.fps_p50 / normal.fps_p50).toFixed(3) : 0,
          frameP95DeltaMs: +(measured.frame_time_p95_ms - normal.frame_time_p95_ms).toFixed(2),
        };
      }
    }
    results[scenario.key] = { ...scenarioResults, deltas };
  }

  const output = {
    mesh: "insurgent",
    renderer: "vanilla",
    variants: VARIANTS,
    warmup_ms: WARMUP_MS,
    sample_ms: SAMPLE_MS,
    results,
  };

  if (LABEL) {
    const dir = resolve(repoRoot, "bench/results");
    mkdirSync(dir, { recursive: true });
    const file = resolve(dir, `${LABEL}.json`);
    writeFileSync(file, JSON.stringify(output, null, 2) + "\n");
    console.log(`[insurgent-semis] wrote ${file}`);
  }

  console.log(JSON.stringify(output, null, 2));
} finally {
  await stopServer(server);
}
