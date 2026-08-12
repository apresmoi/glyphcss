export function deriveReferenceTraceContract(options?: { verify?: boolean; enforceStructural?: boolean; includeTransitions?: boolean; cameraFraming?: "bounds-fitted" | "unframed"; atlasSize?: number; contract?: unknown }): Promise<any>;
export function hashReferenceFrame(frame: any, normalization: any): string;
export function hashReferenceResult(result: any): string;
export function materializeReferenceTrace(): Promise<any>;
export function disposeReferenceTrace(trace: any): Promise<void>;
