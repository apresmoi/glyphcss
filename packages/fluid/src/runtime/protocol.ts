// The worker protocol. `handleGlyphFluidWorkerMessage` IS the worker: `worker.ts` only
// binds it to `self`, so tests drive the exact code a real worker runs.
import { GlyphFluidCore, type GlyphFluidCoreInit, type GlyphFluidStepInput } from "./core";
import type { GlyphFluidFrame } from "../cells/encode";

export interface GlyphFluidInitMessage {
  kind: "init";
  /** Generation: replies from an older init are dropped by the client. */
  gen: number;
  init: GlyphFluidCoreInit;
}

export interface GlyphFluidStepMessage {
  kind: "step";
  gen: number;
  id: number;
  input: GlyphFluidStepInput;
}

export type GlyphFluidWorkerMessage = GlyphFluidInitMessage | GlyphFluidStepMessage;

export interface GlyphFluidWorkerReply {
  gen: number;
  id: number;
  frame: GlyphFluidFrame;
  /** The input's target buffer, handed back for reuse. */
  targets: Float32Array;
  /** In-worker ms for this step. */
  ms: number;
}

export interface GlyphFluidWorkerState {
  core: GlyphFluidCore | null;
  gen: number;
}

export function handleGlyphFluidWorkerMessage(
  state: GlyphFluidWorkerState,
  msg: GlyphFluidWorkerMessage,
  post: (reply: GlyphFluidWorkerReply, transfer: Transferable[]) => void,
  now: () => number = () => performance.now(),
): void {
  if (msg.kind === "init") {
    state.core = new GlyphFluidCore(msg.init);
    state.gen = msg.gen;
    return;
  }
  if (!state.core || msg.gen !== state.gen) return;
  const t0 = now();
  const frame = state.core.step(msg.input);
  post({ gen: msg.gen, id: msg.id, frame, targets: msg.input.targets, ms: now() - t0 }, [msg.input.targets.buffer]);
}
