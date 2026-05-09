/**
 * Static server for the standalone perf bench pages.
 *
 * Serves:
 *   /                      → small index page that links the four perf-*.html
 *   /perf-{path}.html      → bench/perf-{path}.html   (vanilla / html / react / vue)
 *   /polycss*.js           → bench/polycss*.js        (built by bench/build.mjs)
 *   /gallery/...           → website/public/gallery/...  (mesh assets)
 *   anything else under /  → bench/<path>
 *
 * Run: `node bench/perf-serve.mjs [--port 4400]`
 * Use `node bench/perf-bench.mjs` for the headless bench (separate file).
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const repoRoot = resolve(__dirname, "..");
const benchDir = resolve(repoRoot, "bench");
const galleryDir = resolve(repoRoot, "website/public/gallery");

const portArgIndex = process.argv.indexOf("--port");
const PORT = portArgIndex >= 0 ? Number(process.argv[portArgIndex + 1]) : 4400;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".mjs":  "application/javascript; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".obj":  "text/plain; charset=utf-8",
  ".mtl":  "text/plain; charset=utf-8",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gltf": "application/json; charset=utf-8",
  ".glb":  "model/gltf-binary",
};

function resolvePath(reqPath) {
  // Normalize and prevent traversal
  const safe = reqPath.replace(/\/+/g, "/");
  if (safe.includes("..")) return null;
  if (safe === "/" || safe === "") {
    return { abs: null, label: "/", inline: INDEX_HTML, mime: "text/html; charset=utf-8" };
  }
  if (safe.startsWith("/gallery/")) {
    return { abs: resolve(galleryDir, safe.slice("/gallery/".length)), label: safe };
  }
  return { abs: resolve(benchDir, safe.slice(1)), label: safe };
}

const INDEX_HTML = `<!doctype html>
<html><head><meta charset='utf-8'><title>polycss bench</title>
<style>
  body { font: 14px ui-sans-serif, system-ui; background: #0e1014; color: #e2e8f0;
         padding: 32px; max-width: 720px; margin: 0 auto; }
  h1 { font-size: 18px; margin: 0 0 16px; color: #a3e635; }
  ul { list-style: none; padding: 0; }
  li { margin: 6px 0; }
  a { color: #93c5fd; text-decoration: none; font-family: ui-monospace, monospace; }
  a:hover { color: #fff; text-decoration: underline; }
  small { color: #94a3b8; }
</style>
</head><body>
<h1>polycss perf bench</h1>
<p><small>Each page mounts the same scene through a different render path. Append URL params:
<code>?mesh=saucer|chicken|coliseum|castle|teapot|synth-10k</code> ·
<code>?mode=dynamic|baked</code> ·
<code>?motion=light|rot|none</code></small></p>
<ul>
  <li><a href='/perf-html.html?mesh=saucer&mode=dynamic&motion=light'>/perf-html.html</a> &nbsp;<small>declarative custom elements</small></li>
  <li><a href='/perf-vanilla.html?mesh=saucer&mode=dynamic&motion=light'>/perf-vanilla.html</a> &nbsp;<small>imperative createPolyScene</small></li>
  <li><a href='/perf-react.html?mesh=saucer&mode=dynamic&motion=light'>/perf-react.html</a> &nbsp;<small>React @layoutit/polycss-react</small></li>
  <li><a href='/perf-vue.html?mesh=saucer&mode=dynamic&motion=light'>/perf-vue.html</a> &nbsp;<small>Vue @layoutit/polycss-vue</small></li>
</ul>
</body></html>`;

const server = createServer(async (req, res) => {
  try {
    const u = new URL(req.url, `http://localhost:${PORT}`);
    const target = resolvePath(u.pathname);
    if (!target) { res.writeHead(403); return res.end("forbidden"); }
    if (target.inline) {
      res.writeHead(200, { "Content-Type": target.mime, "Cache-Control": "no-store" });
      return res.end(target.inline);
    }
    const data = await readFile(target.abs);
    res.writeHead(200, {
      "Content-Type": MIME[extname(target.abs).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(data);
  } catch (err) {
    res.writeHead(404);
    res.end(String(err?.message ?? err));
  }
});

server.listen(PORT, () => {
  console.log(`[perf-serve] index → http://localhost:${PORT}/`);
});
