#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";

const root = resolve(import.meta.dirname, "..");
const config = JSON.parse(await readFile(join(root, "config/control-tensor.json"), "utf8"));
const template = JSON.parse(await readFile(join(root, "../../packages/glyphcss/src/api/controlTensorContract.json"), "utf8"));
const schema = JSON.parse(await readFile(join(root, "schema/control-tensor.schema.json"), "utf8"));
const canonical = (value) => Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : value && typeof value === "object" ? `{${Object.keys(value).filter((key) => key !== "contentSha256" && value[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}` : JSON.stringify(value);
const hash = (value) => createHash("sha256").update(canonical(value)).digest("hex");
const fail = (code) => { const error = new Error(code); error.code = code; throw error; };
const expected = { ...template, contentSha256: hash(template) };
const ajv = new Ajv2020({ allErrors: true, strict: true });
const schemaCheck = ajv.compile(schema);
const rawIdentityChannel = (value) => /(?:winner|class|instance|surface|object)(?:[-_.]?ids?)(?:$|[-_.])/i.test(value)
  || /(?:winner|class|instance|surface|object)Ids?(?:$|[A-Z_.-])/i.test(value);

function check(value) {
  if (!schemaCheck(value)) fail("TENSOR_SCHEMA");
  if (hash(value) !== value.contentSha256) fail("TENSOR_HASH");
  if (JSON.stringify(value) !== JSON.stringify(expected)) fail("TENSOR_CONTRACT");
  const allChannels = [...value.keyframeChannels, ...value.temporalPrefixChannels];
  if (allChannels.some((channel) => rawIdentityChannel(channel.id) || rawIdentityChannel(channel.source))) fail("RAW_ID_CHANNEL");
  if (value.keyframeWidth !== 17 || value.temporalWidth !== 23) fail("TENSOR_WIDTH");
}

check(config);
for (const name of (await readdir(join(root, "fixtures/tensor/invalid"))).sort()) {
  const fixture = JSON.parse(await readFile(join(root, "fixtures/tensor/invalid", name), "utf8"));
  const value = structuredClone(config);
  const channel = value.keyframeChannels[0];
  if (fixture.mutation === "reorder") [value.keyframeChannels[0], value.keyframeChannels[1]] = [value.keyframeChannels[1], value.keyframeChannels[0]];
  if (fixture.mutation === "wrong-width") channel.width = 2;
  if (fixture.mutation === "raw-id") channel.source = "surfaceId";
  if (fixture.mutation === "wrong-scaling") channel.scaling = "raw";
  if (fixture.mutation === "wrong-sentinel") channel.emptySentinel = -1;
  if (fixture.mutation === "wrong-clamp") channel.clamp = [-1, 1];
  if (fixture.mutation === "wrong-encoding") channel.encoding = "raw";
  if (fixture.mutation === "wrong-source") channel.source = "shade";
  if (fixture.mutation === "missing-ablation") delete channel.causalityAblation;
  if (fixture.mutation === "unnormalized") value.normalization = { depth: { near: 1, far: 1 }, world: { min: [0, 0, 0], max: [0, 1, 1] } };
  if (fixture.mutation === "dependency") value.dependencies = { font: "platform", dictionary: "platform" };
  if (fixture.mutation === "hash") value.contentSha256 = "0".repeat(64);
  if (fixture.mutation !== "hash") value.contentSha256 = hash(value);
  try { check(value); fail("TENSOR_FIXTURE_DID_NOT_FAIL"); } catch (error) { if (error.code !== fixture.expectedError) fail(`TENSOR_FIXTURE_WRONG_ERROR:${name}:${error.code}`); }
}

if (!process.argv.includes("--contract-only")) {
  const browser = spawnSync("pnpm", ["--filter", "@glyphcss/ascii-image-generation", "test:browser", "--", "tensor-parity"], { cwd: resolve(root, "../.."), stdio: "inherit" });
  if (browser.status !== 0) fail("TENSOR_CHROMIUM_PARITY");
  console.log("Validated B32 tensor contract glyph-control-tensor-contract/mvp-v2: K=17, T=23; Chromium Float32 parity passed.");
} else {
  console.log("Validated B32 tensor contract glyph-control-tensor-contract/mvp-v2: K=17, T=23; browser parity intentionally deferred.");
}
