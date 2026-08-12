export function streamReferenceTransitions(options: {
  runs: number;
  transitions: any[];
  evaluate: (run: number, transition: any) => Promise<{ span: any; hash: string; pageHeapBytes: number | null }>;
  beginRun?: (run: number) => Promise<void>;
  afterRun?: (run: number, snapshot: { spans: any[]; traceHashes: string[]; memory: { peakNodeHeapBytes: number; peakPageHeapBytes: number | null } }) => Promise<void>;
  nodeHeap?: () => number;
}): Promise<{ spans: any[]; traceHashes: string[]; memory: { peakNodeHeapBytes: number; peakPageHeapBytes: number | null } }>;
