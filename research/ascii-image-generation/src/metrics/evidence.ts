export type GlyphEvidenceStatus = "pass" | "fail" | "unwired" | "pending-derivation";

export type GlyphEvidenceSignal = { value: number } | { value: null; reason: string };

export interface GlyphNormalizedMetric {
  id: string;
  status: GlyphEvidenceStatus;
  value?: number | null;
  reason?: string;
  threshold?: number | string;
}

export interface GlyphNormalizedGate {
  id: `G${number}`;
  status: GlyphEvidenceStatus;
  evidence: string | null;
  metrics: GlyphNormalizedMetric[];
}
