export const referenceFrameTypedArrayKinds: Readonly<Record<string, string>>;
export function wireReferenceFrame(frame: Record<string, unknown>): Record<string, unknown>;
export function inflateReferenceFrame(frame: Record<string, unknown>, decodeBase64?: (value: string) => ArrayBuffer): Record<string, unknown>;
