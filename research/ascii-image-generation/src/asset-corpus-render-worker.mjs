import { parentPort, threadId } from "node:worker_threads";
import { renderAssetCorpusWorkerTask } from "./render-asset-corpus.mjs";

if (!parentPort) throw new Error("ASSET_CORPUS_WORKER_PARENT_REQUIRED");

parentPort.on("message", async ({ index, value }) => {
  try {
    parentPort.postMessage({ index, threadId, result: await renderAssetCorpusWorkerTask(value) });
  } catch (error) {
    parentPort.postMessage({
      index,
      threadId,
      error: {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : null,
      },
    });
  }
});
