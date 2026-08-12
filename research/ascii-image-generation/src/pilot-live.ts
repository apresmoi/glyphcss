import * as runtime from "./pilot-live.mjs";
import type { GlyphTargetProvider, GlyphTargetProviderReference } from "./targets/provider.js";

export type GlyphPilotControlReferenceContext = Readonly<{
  population: "base" | "style-a" | "style-b";
  trajectoryId: string;
  frameId: string;
  role: "visible-ascii" | "semantic-ascii" | "semantic-color" | "depth" | "normal" | "world-position" | "surface-uv" | "coverage" | "shade" | "prior";
  regeneration: number;
}>;

export interface GlyphPilotLiveProvider extends GlyphTargetProvider {
  readonly id: "openai-images/v1";
  readonly apiVersion: "openai-images/v1";
  readonly projectId: string;
  readonly controlReference: (context: GlyphPilotControlReferenceContext) => GlyphTargetProviderReference;
}

export interface GlyphPilotB10Acceptance {
  readonly targetId: string;
  readonly targetContentSha256: string;
  readonly targetImageSha256: string;
  readonly b10: Readonly<{ accepted: true }> & Readonly<Record<string, unknown>>;
}

export interface GlyphPilotLiveOptions {
  readonly provider: GlyphPilotLiveProvider;
  readonly evaluateTarget: (input: Readonly<Record<string, unknown>>) => Promise<GlyphPilotB10Acceptance>;
  readonly outputRoot: string;
  readonly configPath?: string;
}

export const runPilotLive = runtime.runPilotLive as (options: GlyphPilotLiveOptions) => Promise<unknown>;
