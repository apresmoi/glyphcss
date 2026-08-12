import { createHash } from "node:crypto";

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function contentSha256(value) {
  const { contentSha256: _ignored, ...content } = value;
  return sha256(stableJson(content));
}

function tokens(value) {
  return new Set(value.toLowerCase().match(/[a-z0-9]+/g) ?? []);
}

function promptAffinity(prompt, base) {
  const requested = tokens(prompt);
  if (requested.size === 0) return 0;
  const candidate = new Set([...tokens(base.prompt.text), ...base.prompt.tags.flatMap((tag) => [...tokens(tag)])]);
  let overlap = 0;
  for (const token of requested) if (candidate.has(token)) overlap++;
  return overlap / requested.size;
}

function angleDelta(left, right) {
  const delta = Math.abs(left - right) % 360;
  return Math.min(delta, 360 - delta);
}

function cameraDistance(request, base, limits) {
  const rotX = angleDelta(request.rotX, base.rotX);
  const rotY = angleDelta(request.rotY, base.rotY);
  const zoom = Math.abs(request.zoom - base.zoom) / base.zoom;
  const normalized = (
    Math.min(1, rotX / limits.maxRotXDelta)
    + Math.min(1, rotY / limits.maxRotYDelta)
    + Math.min(1, zoom / limits.maxZoomRelativeDelta)
  ) / 3;
  return { rotX, rotY, zoom, normalized };
}

function round(value) {
  return Math.round(value * 10_000) / 10_000;
}

export function assertRetrievalRequest(request) {
  if (!request || typeof request !== "object" || Array.isArray(request)) throw new TypeError("Request must be a JSON object.");
  if (request.schemaVersion !== "glyph-coarse-base-request/v1") throw new TypeError("Unsupported request schemaVersion.");
  if (typeof request.prompt !== "string" || request.prompt.trim().length === 0 || request.prompt.length > 500) {
    throw new TypeError("prompt must contain 1..500 characters.");
  }
  if (!Number.isInteger(request.seed) || request.seed < 0 || request.seed > 0xffff_ffff) throw new TypeError("seed must be a uint32.");
  if (!["base", "style A", "style B"].includes(request.styleId)) throw new TypeError("styleId is unsupported.");
  const controls = request.controls;
  if (!controls || typeof controls !== "object") throw new TypeError("controls are required.");
  if (!["cube", "sphere", "prism"].includes(controls.geometry)) throw new TypeError("controls.geometry is unsupported.");
  if (typeof controls.sceneId !== "string" || typeof controls.sceneSha256 !== "string") throw new TypeError("scene identity is required.");
  if (!/^[a-f0-9]{64}$/.test(controls.sceneSha256)) throw new TypeError("sceneSha256 must be a SHA-256.");
  if (!/^[a-f0-9]{64}$/.test(controls.tensorContractSha256)) throw new TypeError("tensorContractSha256 must be a SHA-256.");
  if (!Number.isFinite(controls.coverageRatio) || controls.coverageRatio < 0 || controls.coverageRatio > 1) {
    throw new TypeError("coverageRatio must be in [0,1].");
  }
  const camera = controls.camera;
  if (!camera || camera.projection !== "orthographic") throw new TypeError("Only the coarse orthographic camera contract is supported.");
  for (const key of ["rotX", "rotY", "zoom"]) {
    if (!Number.isFinite(camera[key])) throw new TypeError(`camera.${key} must be finite.`);
  }
  if (!(camera.zoom > 0)) throw new TypeError("camera.zoom must be positive.");
  return request;
}

export function retrieveBase(manifest, rawRequest) {
  const request = assertRetrievalRequest(rawRequest);
  const requestSha256 = sha256(stableJson(request));
  const limits = manifest.selection.cameraNeighborhood;
  const compatibleGeometry = manifest.bases.filter((base) => base.controls.geometry === request.controls.geometry);
  if (compatibleGeometry.length === 0) {
    return fallback(manifest, requestSha256, "unsupported-geometry", null, []);
  }
  if (request.controls.tensorContractSha256 !== manifest.controlContract.contentSha256) {
    return fallback(manifest, requestSha256, "control-contract-mismatch", null, []);
  }

  const ranked = compatibleGeometry.map((base) => {
    const camera = cameraDistance(request.controls.camera, base.camera, limits);
    const score =
      0.35
      + 0.2 * (1 - camera.normalized)
      + 0.15
      + 0.05 * Number(request.controls.sceneId === base.controls.sceneId)
      + 0.1 * Number(base.styleIds.includes(request.styleId))
      + 0.1 * promptAffinity(request.prompt, base)
      + 0.05 * Number(request.controls.coverageRatio >= 0.04);
    return {
      base,
      confidence: round(Math.max(0, Math.min(1, score))),
      promptAffinity: round(promptAffinity(request.prompt, base)),
      camera: {
        rotXDelta: round(camera.rotX),
        rotYDelta: round(camera.rotY),
        zoomRelativeDelta: round(camera.zoom)
      }
    };
  }).sort((left, right) => right.confidence - left.confidence || left.base.id.localeCompare(right.base.id));

  const best = ranked[0];
  const cameraOutside = best.camera.rotXDelta > limits.maxRotXDelta
    || best.camera.rotYDelta > limits.maxRotYDelta
    || best.camera.zoomRelativeDelta > limits.maxZoomRelativeDelta;
  if (cameraOutside) return fallback(manifest, requestSha256, "camera-divergence", best, ranked);
  if (best.confidence < manifest.selection.minimumConfidence) {
    return fallback(manifest, requestSha256, "low-retrieval-confidence", best, ranked);
  }

  return {
    schemaVersion: "glyph-coarse-base-retrieval/v1",
    status: "matched",
    requestSha256,
    library: { id: manifest.id, contentSha256: manifest.contentSha256 },
    confidence: best.confidence,
    confidenceThreshold: manifest.selection.minimumConfidence,
    selection: best,
    fallback: { required: false, reason: null, endpoint: "/v1/keyframes" },
    candidates: ranked.map(({ base, confidence, promptAffinity, camera }) => ({ baseId: base.id, confidence, promptAffinity, camera }))
  };
}

function fallback(manifest, requestSha256, reason, nearest, ranked) {
  return {
    schemaVersion: "glyph-coarse-base-retrieval/v1",
    status: "fallback-required",
    requestSha256,
    library: { id: manifest.id, contentSha256: manifest.contentSha256 },
    confidence: nearest?.confidence ?? 0,
    confidenceThreshold: manifest.selection.minimumConfidence,
    selection: null,
    nearest: nearest ? { baseId: nearest.base.id, confidence: nearest.confidence, camera: nearest.camera } : null,
    fallback: { required: true, reason, endpoint: "/v1/keyframes" },
    candidates: ranked.map(({ base, confidence, promptAffinity, camera }) => ({ baseId: base.id, confidence, promptAffinity, camera }))
  };
}

function escapeXml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\"", "&quot;");
}

export function createDeterministicFallbackBase(rawRequest, library) {
  const request = assertRetrievalRequest(rawRequest);
  const requestSha256 = sha256(stableJson(request));
  const hue = Number.parseInt(requestSha256.slice(0, 4), 16) % 360;
  const hueB = (hue + 52 + (request.seed % 71)) % 360;
  const shape = request.controls.geometry === "sphere"
    ? '<circle cx="200" cy="220" r="120"/>'
    : request.controls.geometry === "prism"
      ? '<path d="M92 286 146 126 306 96 342 260 244 352Z"/>'
      : '<path d="M96 156 230 94 338 158 320 318 184 370 82 292Z"/><path d="m96 156 90 58 152-56M186 214l-2 156" opacity=".42"/>';
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="480" viewBox="0 0 400 480">',
    "<defs>",
    `<linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="hsl(${hue} 68% 64%)"/><stop offset="1" stop-color="hsl(${hueB} 72% 22%)"/></linearGradient>`,
    `<filter id="n"><feTurbulence baseFrequency=".55" numOctaves="2" seed="${request.seed % 997}"/><feBlend in="SourceGraphic" mode="soft-light"/></filter>`,
    "</defs>",
    '<rect width="400" height="480" fill="#05080d"/>',
    `<g fill="url(#g)" stroke="hsl(${hue} 75% 80%)" stroke-width="4" filter="url(#n)">${shape}</g>`,
    '<rect x="18" y="404" width="364" height="52" fill="#05080d" fill-opacity=".86" stroke="#ffffff" stroke-opacity=".18"/>',
    `<text x="30" y="427" fill="#e7edf7" font-family="monospace" font-size="12">${escapeXml(request.controls.geometry.toUpperCase())} / SEED ${request.seed}</text>`,
    `<text x="30" y="446" fill="#96a5ba" font-family="monospace" font-size="10">${escapeXml(request.prompt.slice(0, 52))}</text>`,
    "</svg>"
  ].join("");
  const bytes = Buffer.from(svg);
  const imageSha256 = sha256(bytes);
  const base = {
    id: `generated/${imageSha256}`,
    label: "Deterministic coarse keyframe",
    image: { mimeType: "image/svg+xml", width: 400, height: 480, sha256: imageSha256 },
    prompt: { text: request.prompt, tags: [...tokens(request.prompt)] },
    styleIds: [request.styleId],
    camera: request.controls.camera,
    controls: { geometry: request.controls.geometry, sceneId: request.controls.sceneId },
    provenance: {
      kind: "deterministic-local-fallback",
      generator: "glyphcss-coarse-svg-keyframe/v1",
      requestSha256,
      paidCalls: 0,
      remoteCalls: 0
    }
  };
  return {
    bytes,
    response: {
      schemaVersion: "glyph-coarse-keyframe-response/v1",
      status: "generated-fallback",
      requestSha256,
      library: { id: library.id, contentSha256: library.contentSha256 },
      confidence: 1,
      selection: { base, confidence: 1, promptAffinity: 1, camera: { rotXDelta: 0, rotYDelta: 0, zoomRelativeDelta: 0 } },
      fallback: { required: false, reason: null }
    }
  };
}
