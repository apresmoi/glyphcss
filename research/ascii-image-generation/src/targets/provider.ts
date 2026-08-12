import * as runtime from "./provider-core.mjs";

export type GlyphTargetControlRole =
  | "visible-ascii" | "semantic-ascii" | "semantic-color" | "depth" | "normal"
  | "world-position" | "surface-uv" | "coverage" | "shade";
export type GlyphTargetProviderReference = { readonly fileId: string } | { readonly imageUrl: string };
export type GlyphTargetControlReference = {
  readonly role: GlyphTargetControlRole;
  readonly bundle: "visible" | "semantic";
  readonly sourcePath: string;
  readonly sourceSha256: string;
  readonly pngPath: string;
  readonly pngSha256: string;
  readonly width: number;
  readonly height: number;
  readonly legend: Readonly<Record<string, unknown>>;
  readonly providerReference: GlyphTargetProviderReference;
};
export interface GlyphTargetStyle {
  readonly id: string;
  readonly prompt: string;
  readonly license: string;
  readonly sourceSha256?: string | null;
}
export type GlyphPriorAcceptedTarget = GlyphTargetProviderReference & {
  readonly targetId: string;
  readonly contentSha256: string;
  readonly imageSha256: string;
  readonly sequenceId: string;
  readonly frameId: string;
};
export interface GlyphAdmittedTargetRequest {
  readonly schemaVersion: "glyph-target-provider/v2";
  readonly requestSha256: string;
  readonly mode: "keyframe" | "edit";
  readonly trajectory: Readonly<Record<string, string>>;
  readonly bundles: Readonly<Record<"visible" | "semantic", Readonly<Record<string, string>>>>;
  readonly current: { readonly frameId: string; readonly index: number; readonly controlSha256: string } | null;
  readonly next: { readonly frameId: string; readonly index: number; readonly controlSha256: string };
  readonly controls: readonly GlyphTargetControlReference[];
  readonly priorAcceptedTarget: GlyphPriorAcceptedTarget | null;
  readonly style: GlyphTargetStyle;
  readonly candidates: number;
  readonly output: { readonly size: string; readonly quality: string; readonly format: "png" | "jpeg" | "webp" };
}
export interface GlyphTargetCandidate {
  readonly image: Uint8Array;
  readonly candidateIndex: number;
  readonly responseRequestId: string;
  readonly attempts: readonly Readonly<Record<string, unknown>>[];
  readonly reused: boolean;
  readonly providerRequest: Readonly<Record<string, unknown>>;
  readonly usage?: Readonly<Record<string, unknown>> | null;
}
export interface GlyphTargetProvider {
  readonly id: string;
  readonly model: string;
  readonly apiVersion: string;
  readonly candidates: (request: GlyphAdmittedTargetRequest) => Promise<readonly GlyphTargetCandidate[]>;
}
export interface GlyphTargetAdmissionOptions {
  readonly corpusManifestPath: string;
  readonly trajectoryId: string;
  readonly nextFrameId: string;
  readonly style: GlyphTargetStyle;
  readonly controlUploadManifestPath: string;
  readonly controlUploadRoot: string;
  readonly priorTargetUploadManifestPath?: string | null;
  readonly priorArtifactRoot?: string | null;
  readonly candidates?: number;
  readonly output?: Partial<GlyphAdmittedTargetRequest["output"]>;
}

export const CONTROL_ROLES = runtime.CONTROL_ROLES as readonly GlyphTargetControlRole[];
export const admitTrajectoryTarget = runtime.admitTrajectoryTarget as (options: GlyphTargetAdmissionOptions) => Promise<GlyphAdmittedTargetRequest>;
export const createTargetUploadManifest = runtime.createTargetUploadManifest as (options: Readonly<Record<string, unknown>>) => Promise<Readonly<Record<string, unknown>>>;
export const createMockTargetProvider = runtime.createMockTargetProvider as () => GlyphTargetProvider;
export const persistTargetCandidates = runtime.persistTargetCandidates as (options: Readonly<Record<string, unknown>>) => Promise<Readonly<Record<string, unknown>>>;
export const generateTargetPlan = runtime.generateTargetPlan as (options: Readonly<Record<string, unknown>>) => Promise<unknown>;
export const validateTargetRecord = runtime.validateTargetRecord as (record: unknown) => Promise<unknown>;
