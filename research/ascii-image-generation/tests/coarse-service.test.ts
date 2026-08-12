import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCoarseService } from "../src/coarse/service.mjs";

const researchRoot = resolve(new URL("..", import.meta.url).pathname);
const digest = (bytes: ArrayBuffer | Buffer) => createHash("sha256")
  .update(bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes)
  .digest("hex");

describe("coarse local service contract", () => {
  let artifactRoot = "";
  let origin = "";
  let server: import("node:http").Server;

  beforeEach(async () => {
    artifactRoot = await mkdtemp(join(tmpdir(), "glyph-coarse-service-"));
    ({ server } = await createCoarseService({ researchRoot, artifactRoot }));
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    if (server?.listening) await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
    if (artifactRoot) await rm(artifactRoot, { recursive: true });
  });

  it("serves health, manifest, matched image bytes, hashes, and rejects malformed/stale image requests", async () => {
    const health = await fetch(`${origin}/health`).then((response) => response.json());
    expect(health).toMatchObject({
      status: "ready",
      teacher: { backend: "native-diffusion-intermediate", runtime: "gpu-4090" },
      nativePinnedKeyframes: 3,
    });
    const manifest = await fetch(`${origin}/v1/manifest`).then((response) => response.json());
    expect(manifest.bases).toHaveLength(6);
    const request = JSON.parse(await readFile(resolve(researchRoot, "fixtures/coarse/native-teacher-control/request.json"), "utf8"));
    request.controls.sceneSha256 = "38201f4a7604dd864d228e9ecd5ed208db3c2b864502e0d770412ba4d69a65f5";
    request.prompt = "weathered blue industrial box in a quiet studio";
    request.controls.camera.rotY = 38;
    const retrieval = await fetch(`${origin}/v1/retrieve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    }).then((response) => response.json());
    expect(retrieval.status).toBe("matched");
    expect(retrieval.selection.base.id).toBe("base/cube-blue-box-v1");
    const imageResponse = await fetch(retrieval.selection.base.image.url);
    expect(imageResponse.status).toBe(200);
    expect(digest(await imageResponse.arrayBuffer())).toBe(retrieval.selection.base.image.sha256);
    expect((await fetch(`${origin}/v1/native-image?sha256=${"0".repeat(64)}`)).status).toBe(404);
    expect((await fetch(`${origin}/v1/retrieve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    })).status).toBe(400);
  });

  it("persists and serves the exact native keyframe while refusing uncaptured controls", async () => {
    const request = JSON.parse(await readFile(resolve(researchRoot, "fixtures/coarse/native-teacher-control/request.json"), "utf8"));
    request.controls.sceneSha256 = "38201f4a7604dd864d228e9ecd5ed208db3c2b864502e0d770412ba4d69a65f5";
    const response = await fetch(`${origin}/v1/keyframes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    expect(response.status).toBe(201);
    const keyframe = await response.json();
    expect(keyframe.status).toBe("native-pinned-keyframe");
    expect(keyframe).not.toHaveProperty("fallback");
    expect(keyframe.teacher.backend.kind).toBe("native-diffusion-intermediate");
    expect(keyframe.teacher.selectedBranchId).toBe("branch-02");
    expect(keyframe.teacher.manifestContentSha256).toMatch(/^[a-f0-9]{64}$/);
    expect((await stat(join(keyframe.teacher.persistedAt, "manifest.json"))).isFile()).toBe(true);
    expect((await stat(join(keyframe.teacher.persistedAt, "request-pointer.json"))).isFile()).toBe(true);
    const image = await fetch(keyframe.selection.base.image.url);
    expect(image.headers.get("content-type")).toBe("image/png");
    expect(digest(await image.arrayBuffer())).toBe(keyframe.selection.base.image.sha256);

    request.controls.camera.rotY = 71;
    const unavailable = await fetch(`${origin}/v1/teacher/branch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ request, branchCount: 3 }),
    });
    expect(unavailable.status).toBe(409);
    await expect(unavailable.json()).resolves.toMatchObject({
      error: "native-keyframe-unavailable",
      compatibility: { compatible: false, reason: "native-keyframe-unavailable" },
    });
  });
});
