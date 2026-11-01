// Phase 2 driver: schedules animation + style tasks on worker threads.
import path from "node:path";
import { Worker } from "node:worker_threads";
import { FACES, HERE } from "./common.mjs";
import { buildSequences } from "./anim.mjs";
import { buildCases } from "./geometry.mjs";

export const LAMBDAS = [0, 0.005, 0.02, 0.08];
export const MARGINS = [0, 0.005, 0.02, 0.08];
export const ANIM_VOCABS = ["ink", "box", "braille", "all"];

function pool(tasks, workers, onDone, log) {
  return new Promise((resolve, reject) => {
    let next = 0, running = 0, done = 0, lastLog = performance.now();
    const launch = () => {
      while (running < workers && next < tasks.length) {
        const t = tasks[next++];
        running++;
        const w = new Worker(path.join(HERE, "animWorker.mjs"), { workerData: { face: t.face, task: t.task } });
        w.on("message", (m) => { if (m.done) onDone(t, m.done); });
        w.on("error", reject);
        w.on("exit", (code) => {
          running--; done++;
          if (performance.now() - lastLog > 15000) { lastLog = performance.now(); log(`phase 2: ${done}/${tasks.length} tasks`); }
          if (code !== 0) return reject(new Error(`anim worker exited ${code}`));
          if (next >= tasks.length && running === 0) resolve(); else launch();
        });
      }
    };
    launch();
  });
}

/** staticResults: the phase-1 results (fitted tables are reused for hysteresis). */
export async function runAnimation(faces, staticResults, { workers, M, log }) {
  const tasks = [];
  for (const face of Object.keys(FACES)) {
    const nSeq = buildSequences(faces[face]).length;
    const tables = Object.fromEntries(ANIM_VOCABS.map((v) => [v, staticResults.tables[face][v].table]));
    for (let s = 0; s < nSeq; s++) {
      for (const v of ANIM_VOCABS) tasks.push({ face, task: { type: "anim-dp", seq: s, vocab: v, lambdas: LAMBDAS, M } });
      tasks.push({ face, task: { type: "anim-current", seq: s, tables, margins: MARGINS } });
    }
    const n = buildCases(faces[face]).length;
    for (let i = 0; i < n; i += 12) tasks.push({ face, task: { type: "style", indices: [...Array(Math.min(12, n - i)).keys()].map((k) => i + k), M } });
  }
  // Longest first: "all"/"braille" DP sequences.
  const weight = (t) => (t.task.type === "anim-dp" ? (t.task.vocab === "all" ? 4 : t.task.vocab === "braille" ? 3 : 1) : 2);
  tasks.sort((a, b) => weight(b) - weight(a));
  const res = {};
  for (const f of Object.keys(FACES)) res[f] = { current: [], dp: [], style: [] };
  await pool(tasks, workers, (t, out) => {
    if (t.task.type === "anim-current") res[t.face].current.push(out);
    else if (t.task.type === "anim-dp") res[t.face].dp.push(out);
    else res[t.face].style.push(...out);
  }, log);
  return { lambdas: LAMBDAS, margins: MARGINS, vocabs: ANIM_VOCABS, faces: res };
}
