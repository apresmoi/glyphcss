import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { contentSha256, retrieveBase, sha256 } from "./retrieval.mjs";
import {
  createNativeTeacherKeyframe,
  loadNativeTeacherCapture,
  persistNativeTeacherKeyframe,
} from "./nativeTeacher.mjs";

function corsHeaders(extra = {}) {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
    ...extra,
  };
}

function json(response, status, value) {
  const body = JSON.stringify(value, null, 2);
  response.writeHead(status, corsHeaders({
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  }));
  response.end(body);
}

async function bodyJson(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 64 * 1024) throw new RangeError("Request body exceeds 64 KiB.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function withImageUrl(value, requestUrl) {
  if (!value.selection) return value;
  const base = value.selection.base;
  const imageUrl = base.id.startsWith("native/")
    ? new URL(`/v1/native-image?sha256=${encodeURIComponent(base.image.sha256)}`, requestUrl).href
    : new URL(`/v1/base-image?id=${encodeURIComponent(base.id)}`, requestUrl).href;
  return {
    ...value,
    selection: {
      ...value.selection,
      base: { ...base, image: { ...base.image, url: imageUrl } },
    },
  };
}

export async function createCoarseService({ researchRoot, artifactRoot }) {
  const manifestPath = resolve(researchRoot, "config/coarse-base-library.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (contentSha256(manifest) !== manifest.contentSha256) throw new Error(`Coarse base manifest hash mismatch: ${manifestPath}`);
  const native = await loadNativeTeacherCapture(researchRoot);
  const baseImages = new Map();
  const nativeImages = new Map();
  for (const base of manifest.bases) {
    const bytes = await readFile(resolve(researchRoot, base.image.path));
    if (sha256(bytes) !== base.image.sha256) throw new Error(`Base image hash mismatch: ${base.id}`);
    baseImages.set(base.id, { bytes, mimeType: base.image.mimeType, sha256: base.image.sha256 });
  }
  for (const image of native.branchImages.values()) {
    nativeImages.set(image.sha256, { bytes: image.bytes, mimeType: image.mimeType });
  }

  const server = createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
    if (request.method === "OPTIONS") {
      response.writeHead(204, corsHeaders());
      response.end();
      return;
    }
    try {
      if (request.method === "GET" && requestUrl.pathname === "/health") {
        json(response, 200, {
          schemaVersion: "glyph-coarse-service-health/v1",
          status: "ready",
          library: { id: manifest.id, contentSha256: manifest.contentSha256, bases: manifest.bases.length },
          refiner: "coarse-residual-refiner/native-trajectory-mlp-v1",
          teacher: {
            backend: "native-diffusion-intermediate",
            runtime: "gpu-4090",
            captureId: native.capture.id,
            contentSha256: native.capture.contentSha256,
            fileSha256: native.fileSha256,
            artifactRoot,
          },
          nativePinnedKeyframes: nativeImages.size,
        });
        return;
      }
      if (request.method === "GET" && requestUrl.pathname === "/v1/manifest") {
        json(response, 200, manifest);
        return;
      }
      if (request.method === "GET" && requestUrl.pathname === "/v1/base-image") {
        const image = baseImages.get(requestUrl.searchParams.get("id"));
        if (!image) return json(response, 404, { error: "unknown-base" });
        response.writeHead(200, corsHeaders({
          "content-type": image.mimeType,
          "content-length": image.bytes.length,
          "etag": `"sha256-${image.sha256}"`,
          "cache-control": "public, max-age=31536000, immutable",
        }));
        response.end(image.bytes);
        return;
      }
      if (request.method === "GET" && requestUrl.pathname === "/v1/native-image") {
        const image = nativeImages.get(requestUrl.searchParams.get("sha256"));
        if (!image) return json(response, 404, { error: "unknown-native-keyframe" });
        response.writeHead(200, corsHeaders({
          "content-type": image.mimeType,
          "content-length": image.bytes.length,
          "cache-control": "private, max-age=86400",
          "etag": `"sha256-${sha256(image.bytes)}"`,
        }));
        response.end(image.bytes);
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/v1/retrieve") {
        json(response, 200, withImageUrl(retrieveBase(manifest, await bodyJson(request)), requestUrl));
        return;
      }
      if (request.method === "POST" && (requestUrl.pathname === "/v1/keyframes" || requestUrl.pathname === "/v1/teacher/branch")) {
        const input = await bodyJson(request);
        const teacherRequest = input.request ?? input;
        const bundle = createNativeTeacherKeyframe(teacherRequest, native, manifest);
        const runDirectory = await persistNativeTeacherKeyframe(bundle, native, artifactRoot);
        json(response, 201, withImageUrl({
          ...bundle.response,
          teacher: { ...bundle.response.teacher, persistedAt: runDirectory },
        }, requestUrl));
        return;
      }
      json(response, 404, { error: "not-found" });
    } catch (error) {
      if (error?.code === "NATIVE_KEYFRAME_UNAVAILABLE") {
        json(response, 409, {
          error: error.code.toLowerCase().replaceAll("_", "-"),
          message: error.message,
          compatibility: error.details,
        });
        return;
      }
      const status = error instanceof TypeError || error instanceof RangeError || error instanceof SyntaxError ? 400 : 500;
      json(response, status, { error: error instanceof Error ? error.message : "Unknown service error" });
    }
  });
  return { server, manifest, native, baseImages, nativeImages };
}
