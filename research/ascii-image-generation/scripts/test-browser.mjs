import { spawn, spawnSync } from "node:child_process";
import net from "node:net";

const port = 43219;
const args = process.argv.slice(2).filter((arg) => arg !== "--");
const reference = Boolean(process.env.GLYPHCSS_REFERENCE_CHROMIUM);
if (args.includes("reprojection-reference") && (!process.env.GLYPHCSS_REFERENCE_CHROMIUM || !process.env.GLYPHCSS_REFERENCE_OUTPUT)) {
  throw new Error("reprojection-reference requires GLYPHCSS_REFERENCE_CHROMIUM and GLYPHCSS_REFERENCE_OUTPUT; use scripts/remote-reference-browser.sh.");
}
const occupied = await new Promise((resolve) => {
  const probe = net.connect(port, "127.0.0.1");
  probe.once("connect", () => { probe.destroy(); resolve(true); });
  probe.once("error", () => resolve(false));
});
if (occupied) throw new Error(`glyphcss browser test port ${port} is occupied; refusing to reuse an unknown service.`);

const server = spawn("pnpm", reference ? ["exec", "vite", "--host", "127.0.0.1", "--port", String(port), "--strictPort"] : ["exec", "astro", "dev", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: reference ? new URL("../", import.meta.url) : new URL("../../../website/", import.meta.url),
  stdio: "inherit",
  detached: process.platform !== "win32",
});
const serverExit = new Promise((resolve) => {
  server.once("exit", (code, signal) => resolve({ code, signal }));
});
const serverError = new Promise((_, reject) => {
  server.once("error", reject);
});
const ready = new Promise((resolve, reject) => {
  const deadline = setTimeout(() => reject(new Error("glyphcss browser server did not start")), 30_000);
  const poll = () => {
    const probe = net.connect(port, "127.0.0.1");
    probe.once("connect", () => { probe.destroy(); clearTimeout(deadline); resolve(undefined); });
    probe.once("error", () => setTimeout(poll, 100));
  };
  poll();
});
try {
  await Promise.race([
    ready,
    serverError,
    serverExit.then(({ code, signal }) => Promise.reject(new Error(`glyphcss browser server exited before ready (code ${code ?? "none"}, signal ${signal ?? "none"})`))),
  ]);
  const timeout = reference ? Number.parseInt(process.env.GLYPHCSS_REFERENCE_TIMEOUT_MS ?? "", 10) : null;
  if (reference && timeout !== 1_800_000) throw new Error(`invalid reference timeout: ${process.env.GLYPHCSS_REFERENCE_TIMEOUT_MS ?? "missing"}`);
  const result = spawnSync("playwright", ["test", ...(timeout ? [`--timeout=${timeout}`] : []), ...(args.length ? ["--grep", args.join(" ")] : [])], {
    cwd: new URL("../", import.meta.url), stdio: "inherit", shell: process.platform === "win32", env: { ...process.env, GLYPHCSS_GALLERY_URL: `http://127.0.0.1:${port}` },
  });
  process.exitCode = result.status ?? 1;
} finally {
  if (server.pid !== undefined && server.exitCode === null) {
    if (process.platform === "win32") server.kill();
    else process.kill(-server.pid, "SIGTERM");
    await Promise.race([serverExit, new Promise((resolve) => setTimeout(resolve, 5_000))]);
  }
}
