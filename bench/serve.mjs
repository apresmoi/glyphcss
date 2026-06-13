// Minimal static server rooted at the repo root, so /bench/index.html can fetch
// the existing asset at /website/public/gallery/vox/army.vox without copying it.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve, extname, normalize } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.BENCH_PORT ?? 5180);
const TYPES = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".map": "application/json",
  ".vox": "application/octet-stream", ".png": "image/png", ".jpg": "image/jpeg",
  ".obj": "text/plain", ".mtl": "text/plain", ".glb": "model/gltf-binary",
};

createServer(async (req, res) => {
  try {
    let p = decodeURIComponent((req.url ?? "/").split("?")[0]);
    if (p === "/") p = "/bench/index.html";
    const abs = resolve(repoRoot, "." + normalize(p));
    if (!abs.startsWith(repoRoot)) { res.writeHead(403).end("forbidden"); return; }
    const body = await readFile(abs);
    res.writeHead(200, { "content-type": TYPES[extname(abs)] ?? "application/octet-stream", "cache-control": "no-store" });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
}).listen(port, () => console.log(`[bench] http://localhost:${port}/bench/index.html`));
