import * as runtime from "./provider-core.mjs";
import type { GlyphAdmittedTargetRequest, GlyphTargetProvider } from "./provider";

export interface GlyphOpenAIProviderOptions {
  readonly model?: string;
  readonly fetchImpl?: typeof fetch;
  readonly ledgerRoot: string;
  readonly attempts?: number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly projectId?: string;
  readonly requireUsageReconciliation?: boolean;
}
export interface GlyphOpenAIImageRequest {
  readonly apiVersion: "openai-images/v1";
  readonly operation: "control-keyframe-edit" | "temporal-edit";
  readonly endpoint: "https://api.openai.com/v1/images/edits";
  readonly method: "POST";
  readonly body: Readonly<Record<string, unknown>>;
  readonly prompt: string;
}

export const buildOpenAIRequest = runtime.buildOpenAIRequest as (request: GlyphAdmittedTargetRequest, options?: { readonly model?: string }) => GlyphOpenAIImageRequest;
export const createOpenAIImageProvider = runtime.createOpenAIImageProvider as (options: GlyphOpenAIProviderOptions) => GlyphTargetProvider & { readonly describe: (request: GlyphAdmittedTargetRequest) => GlyphOpenAIImageRequest };
