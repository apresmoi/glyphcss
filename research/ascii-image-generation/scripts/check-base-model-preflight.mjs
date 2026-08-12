import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, resolve, sep } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";

const [schemaPath, configPath, reportPath, sourceRootArg] = process.argv.slice(2);
if (!schemaPath || !configPath || !reportPath || !sourceRootArg) throw new Error("usage: check-base-model-preflight.mjs <schema> <config> <report> <source-root>");
const [schema, config, report] = await Promise.all([schemaPath, configPath, reportPath].map(async (path) => JSON.parse(await readFile(path, "utf8"))));
const ajv = new Ajv2020({ allErrors: true, strict: true });
const validate = ajv.compile(schema);
if (!validate(report)) throw new Error(`B34 preflight schema failed: ${ajv.errorsText(validate.errors)}`);

const hash = (value) => createHash("sha256").update(value).digest("hex");
const canonicalValue = (value) => {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
  return value;
};
const canonical = (value) => JSON.stringify(canonicalValue(value));
const equal = (left, right, message) => {
  if (canonical(left) !== canonical(right)) throw new Error(message);
};

if (report.configSha256 !== hash(await readFile(configPath))) throw new Error("B34 config hash mismatch");
equal(report.container, config.execution, "B34 launcher context/image/digest mismatch");
if (report.model.id !== config.id || report.model.repository !== config.repository || report.model.revision !== config.revision || report.model.resolvedRevision !== config.revision || report.model.precision !== config.precision) throw new Error("B34 immutable model identity mismatch");
equal(report.model.parameterCount, config.parameterCount, "B34 parameter-count claim drift");
equal(report.model.recomputedParameterCount, config.parameterCount.exactArtifacts, "B34 recomputed parameter-count evidence drift");
const exact = report.model.recomputedParameterCount;
if (exact.generatorCore + exact.safetyChecker !== exact.allDownloaded || exact.unet > exact.generatorCore) throw new Error("B34 exact parameter counts are arithmetically inconsistent");
equal(report.model.browserPayload, config.expectedBrowserPayload, "B34 browser payload/disposition binding drift");
equal(report.disposition, config.disposition, "B34 use disposition drift");
if (!report.disposition.localTraining.includes("allowed") || !report.disposition.localDemo.includes("allowed") || !report.disposition.browserBundle.includes("safety-checker") || !report.disposition.browserBundle.includes("B18 must reject") || !report.disposition.redistribution.includes("not authorized") || !report.disposition.derivativeWeights.includes("not authorized")) throw new Error("B34 license disposition is not fail-closed");

const expectedFiles = config.requiredFiles.map((entry) => ({
  path: entry.path,
  bytes: entry.bytes,
  sha256: entry.sha256,
  url: `https://huggingface.co/${config.repository}/resolve/${config.revision}/${entry.path}`,
  kind: entry.kind,
}));
equal(report.model.files, expectedFiles, "B34 consumed model-file identity drift");
if (expectedFiles.some((entry) => entry.path.endsWith(".bin") || entry.kind === "pickle")) throw new Error("B34 unsafe weight format selected");
if (!report.verification.noPickleConsumed || !report.verification.identical || report.verification.rounds.length !== 2) throw new Error("B34 verification evidence is incomplete");
for (const [index, round] of report.verification.rounds.entries()) {
  if (round.round !== index + 1 || round.forceDownload !== (index === 1)) throw new Error("B34 download-round identity drift");
  equal(round.files, expectedFiles, `B34 round ${round.round} file identity drift`);
  const recomputed = hash(canonical(round.files));
  if (round.treeSha256 !== recomputed) throw new Error(`B34 round ${round.round} tree hash mismatch`);
}
if (report.verification.rounds[0].treeSha256 !== report.verification.rounds[1].treeSha256) throw new Error("B34 second forced download differs from the first");

const generator = config.expectedBrowserPayload.generatorCore;
const demo = config.expectedBrowserPayload.requiredLocalDemo;
const sumBytes = (paths) => paths.reduce((sum, path) => sum + expectedFiles.find((entry) => entry.path === path)?.bytes, 0);
if (sumBytes(generator.paths) !== generator.weightsBytes || sumBytes(demo.paths) !== demo.weightsBytes) throw new Error("B34 payload byte total drift");
if (!demo.paths.includes("safety_checker/model.fp16.safetensors") || demo.weightsBytes - generator.weightsBytes !== demo.safetyCheckerWeightsBytes || demo.parameters - generator.parameters !== demo.safetyCheckerParameters) throw new Error("B34 required local-demo safety path is incomplete");

equal(report.sourceTexts, config.sourceTexts, "B34 source-text manifest drift");
const sourceRoot = await realpath(sourceRootArg);
for (const source of config.sourceTexts) {
  if (isAbsolute(source.path) || source.path.split("/").some((part) => part === "." || part === "..")) throw new Error(`B34 unsafe ${source.role} path`);
  const path = resolve(sourceRoot, source.path);
  const resolved = await realpath(path);
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || !resolved.startsWith(`${sourceRoot}${sep}`)) throw new Error(`B34 unsafe ${source.role} source file`);
  if (hash(await readFile(path)) !== source.sha256) throw new Error(`B34 checked-in ${source.role} bytes drift`);
}
const expectedArtifactRoot = `/mnt/docker-data/glyphcss-ascii-image-generation/models/base/${config.id}/${config.revision}`;
if (report.artifactRoot !== expectedArtifactRoot) throw new Error("B34 artifact root is not bound to the model/revision");

console.log(`B34 base-model preflight validated: ${report.model.repository}@${report.model.revision}`);
