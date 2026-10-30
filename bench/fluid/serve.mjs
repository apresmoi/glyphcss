// Static server for the fluid bench on 127.0.0.1:4361 (FLUID_BENCH_PORT to override).
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve, extname, normalize } from "node:path";
const root = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.FLUID_BENCH_PORT ?? 4361);
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".map": "application/json", ".png": "image/png" };
createServer(async (req, res) => {
  try {
    let p = decodeURIComponent((req.url ?? "/").split("?")[0]);
    if (p === "/") p = "/index.html";
    const abs = resolve(root, "." + normalize(p));
    if (!abs.startsWith(root)) return res.writeHead(403).end();
    const body = await readFile(abs);
    res.writeHead(200, { "content-type": TYPES[extname(abs)] ?? "application/octet-stream", "cache-control": "no-store" });
    res.end(body);
  } catch { res.writeHead(404).end("not found"); }
}).listen(port, "127.0.0.1", () => console.log(`[fluid bench] http://127.0.0.1:${port}/`));
