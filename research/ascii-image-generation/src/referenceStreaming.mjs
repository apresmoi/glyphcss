export async function streamReferenceTransitions({ runs, transitions, evaluate, beginRun = async () => {}, afterRun = async () => {}, nodeHeap = () => process.memoryUsage().heapUsed }) {
  const spans = [];
  const traceHashes = [];
  let peakNodeHeapBytes = nodeHeap();
  let peakPageHeapBytes = null;
  for (let run = 0; run < runs; run += 1) {
    await beginRun(run);
    for (const transition of transitions) {
      const compact = await evaluate(run, transition);
      spans.push(compact.span);
      traceHashes.push(compact.hash);
      if (typeof compact.pageHeapBytes === "number") peakPageHeapBytes = Math.max(peakPageHeapBytes ?? 0, compact.pageHeapBytes);
      peakNodeHeapBytes = Math.max(peakNodeHeapBytes, nodeHeap());
    }
    await afterRun(run, { spans, traceHashes, memory: { peakNodeHeapBytes, peakPageHeapBytes } });
  }
  return { spans, traceHashes, memory: { peakNodeHeapBytes, peakPageHeapBytes } };
}
