#!/usr/bin/env node
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createCoarseService } from "../src/coarse/service.mjs";

const researchRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
function arg(name, fallback) {
  const inline = args.find((value) => value.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}
const host = arg("--host", process.env.GLYPH_COARSE_HOST ?? "127.0.0.1");
const port = Number(arg("--port", process.env.GLYPH_COARSE_PORT ?? "47331"));
const artifactRoot = resolve(arg(
  "--artifact-root",
  process.env.GLYPH_COARSE_ARTIFACT_ROOT ?? "/mnt/docker-data/glyphcss-ascii-image-generation/coarse-b57/native-keyframes",
));
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new TypeError("--port must be an integer in [1,65535].");

const { server, manifest, native } = await createCoarseService({ researchRoot, artifactRoot });
server.listen(port, host, () => {
  process.stdout.write(`glyphcss coarse retrieval service ready at http://${host}:${port}\n`);
  process.stdout.write(`library ${manifest.id} sha256:${manifest.contentSha256} (${manifest.bases.length} bases)\n`);
  process.stdout.write(`teacher native ${native.capture.id}; artifacts ${artifactRoot}\n`);
});
