import { parentPort, threadId } from "node:worker_threads";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

if (!parentPort) throw new Error("ASSET_CORPUS_TEST_WORKER_PARENT_REQUIRED");

parentPort.on("message", async ({ index, value }) => {
  if (value.malformed === "missing") {
    parentPort.postMessage({ index, threadId });
    return;
  }
  if (value.malformed === "both") {
    parentPort.postMessage({ index, threadId, result: {}, error: { message: "bad", stack: null } });
    return;
  }
  if (value.fail) {
    parentPort.postMessage({ index, threadId, error: { message: value.fail === true ? "sentinel" : value.fail, stack: null } });
    return;
  }
  if (value.cpuMs) {
    const deadline = performance.now() + value.cpuMs;
    let accumulator = 0;
    while (performance.now() < deadline) accumulator += Math.sqrt(accumulator + 1);
    if (!Number.isFinite(accumulator)) throw new Error("ASSET_CORPUS_TEST_WORKER_CPU_INVALID");
  }
  if (value.output) {
    await mkdir(value.output, { recursive: true });
    await writeFile(join(value.output, `${value.population}-${value.id}.fixture`), `${value.population}:${value.id}\n`);
  }
  if (value.failAfterWrite) {
    parentPort.postMessage({ index, threadId, error: { message: "mid-write-sentinel", stack: null } });
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, value.delay ?? 0));
  parentPort.postMessage({ index, threadId, result: { id: value.id, population: value.population, threadId, pid: process.pid } });
});
