// Worker entry: the fluid's sim step, cell decision and atlas encode off the main thread.
import { handleGlyphFluidWorkerMessage, type GlyphFluidWorkerMessage, type GlyphFluidWorkerState } from "./protocol";

const state: GlyphFluidWorkerState = { core: null, gen: -1 };
const scope = self as unknown as { onmessage: ((e: MessageEvent) => void) | null; postMessage(m: unknown, t: Transferable[]): void };
scope.onmessage = (e: MessageEvent<GlyphFluidWorkerMessage>) =>
  handleGlyphFluidWorkerMessage(state, e.data, (reply, transfer) => scope.postMessage(reply, transfer));
