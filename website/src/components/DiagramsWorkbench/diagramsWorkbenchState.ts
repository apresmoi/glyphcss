import {
  GLYPH_DIAGRAM_TARGET_DEFAULTS, glyphGraphFromJson, glyphGraphFromMermaid, parseGlyphDiagramJson,
  type GlyphDiagramCharset, type GlyphDiagramColorMode, type GlyphDiagramDetail,
  type GlyphDiagramRenderOptions, type GlyphDiagramTarget, type GlyphGraph, type GlyphGraphNode,
} from "@glyphcss/diagrams";
import type { GlyphDiagram3dCamera, GlyphDiagram3dLayoutKind, GlyphDiagram3dRenderOptions } from "@glyphcss/diagrams/3d";
import {
  GLYPH_SEQUENCE_TARGET_DEFAULTS, glyphSequenceFromMermaid, parseGlyphSequenceJson, validateGlyphSequence,
  type GlyphSequence, type GlyphSequenceFrame, type GlyphSequenceNote,
} from "@glyphcss/diagrams/sequence";
import {
  GLYPH_LANE_TARGET_DEFAULTS, glyphLaneDagFromGitLog, parseGlyphLaneDagJson, validateGlyphLaneDag,
  type GlyphLaneDag,
} from "@glyphcss/diagrams/lanes";
import type { GlyphOrbitControlsMode } from "glyphcss";
import { INSTRUMENT_3D_EFFECT_ALL_TARGET, INSTRUMENT_3D_EFFECT_NONE, type Instrument3DEffectsState } from "../InstrumentWorkbench/Instrument3DEffectsFolder";
import { glyphMonoWebGridSize, type GlyphPixelBox } from "../../lib/glyphMonoMetrics";
export type { GlyphPixelBox } from "../../lib/glyphMonoMetrics";
import chain from "../../../../packages/diagrams/fixtures/chain.mmd?raw";
import diamond from "../../../../packages/diagrams/fixtures/diamond.mmd?raw";
import fanOut from "../../../../packages/diagrams/fixtures/fan-out.mmd?raw";
import cycle from "../../../../packages/diagrams/fixtures/cycle.mmd?raw";
import subgraph from "../../../../packages/diagrams/fixtures/subgraph.mmd?raw";
import langgraphExport from "../../../../packages/diagrams/fixtures/langgraph.mmd?raw";

/**
 * The page's copy of a preset never carries HTML inside its labels. The
 * LangGraph fixture (`packages/diagrams/fixtures/langgraph.mmd`) is a
 * verbatim LangGraph export — its generator wraps every label in
 * `<p>…</p>` — and stays exactly as exported, because the LIBRARY should
 * keep proving it parses HTML-in-label. The page is a different audience: a
 * reader editing this source field by field (`DiagramsSourceEditor`) must
 * see `__start__`, not `<p>__start__</p>`. The adapter's own `labelText`
 * drops these tags (`mermaid.ts`: `<p>`/`<b>`/`<i>`/`<em>`/`<strong>`/`<span>`
 * removed, `<br>` → a line break), so the stripped copy renders
 * byte-identically to the fixture — `diagramsWorkbenchState.test.ts` pins
 * that. A `<br>` becomes a space: labels are single-line fields here.
 */
export function cleanPresetMermaid(source: string): string {
  return source.replace(/<br\s*\/?\s*>/gi, " ").replace(/<\/?(?:p|b|strong|i|em|span)(?:\s[^>]*?)?\s*>/gi, "");
}
const langgraph = cleanPresetMermaid(langgraphExport);
import agentSupervisor from "../../../../packages/diagrams/fixtures/agent-supervisor.mmd?raw";
import fanJoinSplit from "../../../../packages/diagrams/fixtures/fan-join-split.mmd?raw";
import lenet5Cnn from "../../../../packages/diagrams/fixtures/lenet5-cnn.json?raw";
import transformerEncoder from "../../../../packages/diagrams/fixtures/transformer-encoder.json?raw";
import ciPipelineDag from "../../../../packages/diagrams/fixtures/ci-pipeline-dag.json?raw";
import agentGuardrail from "../../../../packages/diagrams/fixtures/agent-guardrail.mmd?raw";
import transformerBlock from "../../../../packages/diagrams/fixtures/transformer-block.mmd?raw";
import ragPipeline from "../../../../packages/diagrams/fixtures/rag-pipeline.mmd?raw";
import eventQueue from "../../../../packages/diagrams/fixtures/event-queue.mmd?raw";

/**
 * The `form` axis — which 2D pipeline the page renders (AGENTS.md's "Root
 * vs `./3d` vs `./sequence`"): `graph` is today's Mermaid/JSON
 * flowchart pipeline; `sequence` is the new `@glyphcss/diagrams/sequence`
 * one. A table of descriptors, not a chain of `if (form === ...)` branches,
 * so a future `lanes`/`timeline`/`matrix` form (the library side already
 * ships `./lanes`; the other three wait on their own website packets) is
 * ONE ROW here plus its own preset list, state slice, reducer cases and
 * render/build functions — never a rewrite of this table's shape or of the
 * `IconToggle` row that reads it (`DiagramsDock.tsx`'s `formToggleOptions`).
 * `supports3d` is the one thing the rest of the page needs to know about a
 * form without importing its pipeline: it gates the View toggle's 3D option
 * (`mapDirectionLocked` idiom — dimmed with a reason, never hidden) and
 * whether a form switch must force `view` back to `"2d"`.
 */
export type GlyphDiagramsFormId = "graph" | "sequence" | "lanes";
export interface GlyphDiagramsFormDescriptor { readonly id: GlyphDiagramsFormId; readonly label: string; readonly supports3d: boolean }
export const GLYPH_DIAGRAMS_FORMS: readonly GlyphDiagramsFormDescriptor[] = [
  { id: "graph", label: "Graph", supports3d: true },
  { id: "sequence", label: "Sequence", supports3d: false },
  { id: "lanes", label: "Lanes", supports3d: false },
] as const;

// Five sequence presets, deliberately NOT all service calls (the sequence
// IR is domain-agnostic — `packages/diagrams/AGENTS.md`'s own "Domain-
// agnostic IR" section): a service login (alt/else), a human approval
// process (actor participants), a protocol handshake (peers, no
// caller/callee asymmetry), a queue with a polling consumer (loop, a
// self-message), and a hardware interrupt path (device -> kernel ->
// userspace). Every one renders through `glyphSequenceFromMermaid` with no
// domain vocabulary leaking into the IR itself.
const sequenceLoginSource = `sequenceDiagram
  participant Client
  participant Server
  Client->>Server: POST /login
  alt credentials valid
    Server-->>Client: 200 OK, session token
  else invalid credentials
    Server-->>Client: 401 Unauthorized
  end
`;
const sequencePurchaseApprovalSource = `sequenceDiagram
  actor Requester
  actor Manager
  actor Finance
  Requester->>Manager: Submit purchase request
  alt within budget
    Manager->>Finance: Approve for payment
    Finance-->>Requester: Payment issued
  else over budget
    Manager-->>Requester: Request denied
  end
`;
const sequenceTcpHandshakeSource = `sequenceDiagram
  participant ClientHost as Client
  participant ServerHost as Server
  ClientHost->>ServerHost: SYN
  ServerHost-->>ClientHost: SYN-ACK
  ClientHost->>ServerHost: ACK
  ClientHost->>ServerHost: FIN
  ServerHost-->>ClientHost: ACK
  ServerHost->>ClientHost: FIN
  ClientHost-->>ServerHost: ACK
`;
const sequenceQueuePollSource = `sequenceDiagram
  participant Producer
  participant Queue
  participant Consumer
  Producer->>Queue: Enqueue job
  loop poll every 5s
    Consumer->>Queue: Poll for jobs
    Queue-->>Consumer: Job available
  end
  Consumer->>Consumer: Process job
  Consumer-->>Queue: Ack
`;
const sequenceHardwareInterruptSource = `sequenceDiagram
  participant Device
  participant IRQ as IRQ Controller
  participant Kernel
  participant Userspace
  Device->>IRQ: Raise interrupt
  IRQ->>Kernel: Dispatch ISR
  Kernel->>Kernel: Run handler
  Kernel-->>Device: Acknowledge
  Kernel->>Userspace: Schedule wakeup
  Userspace-->>Kernel: Return from syscall
`;
export const GLYPH_SEQUENCE_WORKBENCH_PRESETS = [
  { id: "login", label: "Login round trip", source: sequenceLoginSource },
  { id: "purchase-approval", label: "Purchase approval", source: sequencePurchaseApprovalSource },
  { id: "tcp-handshake", label: "TCP handshake + teardown", source: sequenceTcpHandshakeSource },
  { id: "queue-poll", label: "Queue + polling consumer", source: sequenceQueuePollSource },
  { id: "hardware-interrupt", label: "Hardware interrupt path", source: sequenceHardwareInterruptSource },
] as const;

// Three lane-DAG presets, deliberately not all git (the IR is domain-agnostic
// — `packages/diagrams/AGENTS.md`'s own "Lane DAGs" section: "git is the
// familiar instance, never the vocabulary"): one genuine git history
// (branch + merge + tags, sourced through the library's own git-log adapter)
// and two hand-authored JSON lane DAGs with no git vocabulary at all — a CI
// pipeline's parallel stages fanning into an approval gate, and a
// data-lineage graph. Every node id in every preset occurs strictly earlier
// than its own parents (newest-first array order), and every merge/branch
// point below is real (`glyphLaneDagFromGitLog`/`validateGlyphLaneDag`
// reject anything else).
// Lane presets are deliberately DEEP — USER FEEDBACK, verbatim: "can we add
// more complex lanes please?... I want to have a couple of nested layers so
// we see a good good render". Each carries 4-7 concurrent lanes with nested
// branch/merge structure, which is what exercises the lane allocator's own
// free-and-reuse rule; a three-node chain shows none of it.
const laneReleaseTrainGitLog = `rel210|mrel mdev|(HEAD -> main, tag: v2.1.0)|Release 2.1.0
mdev|dev6 hf2||Merge hotfix/session-leak into develop
mrel|rc2 hf2||Merge hotfix/session-leak into main
hf2|hf1|(hotfix/session-leak)|Add regression test
hf1|rc2||Close leaking session on 401
rc2|rc1|(release/2.1)|Bump version, changelog
rc1|mfeat||Cut release branch
mfeat|dev6 feat3||Merge feature/search-ranking
feat3|feat2|(feature/search-ranking)|Tune BM25 weights
feat2|feat1||Add ranking benchmark
feat1|dev4||Extract scorer interface
dev6|dev5||Bump lockfile
dev5|mauth||Tidy imports
mauth|dev4 auth2||Merge feature/oauth-pkce
auth2|auth1|(feature/oauth-pkce)|Verify code challenge
auth1|dev4||Add PKCE parameters
dev4|dev3|(develop)|Update contributing guide
dev3|v200||Start 2.1 development
v200|base|(tag: v2.0.0)|Release 2.0.0
base|||Initial commit`;
const laneCiPipelineDag: GlyphLaneDag = {
  nodes: [
    { id: "prod", label: "Deploy production", parents: ["approve"], marks: ["prod"] },
    { id: "staging", label: "Deploy staging", parents: ["approve"], marks: ["staging"] },
    { id: "approve", label: "Manual approval", parents: ["e2egate", "lint", "types", "unit"], marks: ["gate"] },
    { id: "e2egate", label: "E2E shards complete", parents: ["e2e1", "e2e2", "e2e3"] },
    { id: "e2e3", label: "E2E shard 3/3", parents: ["build"] },
    { id: "e2e2", label: "E2E shard 2/3", parents: ["build"] },
    { id: "e2e1", label: "E2E shard 1/3", parents: ["build"] },
    { id: "unit", label: "Unit tests", parents: ["build"] },
    { id: "types", label: "Typecheck", parents: ["build"] },
    { id: "lint", label: "Lint", parents: ["build"] },
    { id: "build", label: "Build artifacts", parents: ["install"] },
    { id: "install", label: "Install deps", parents: ["checkout"] },
    { id: "checkout", label: "Checkout", parents: [] },
  ],
};
const laneDataLineageDag: GlyphLaneDag = {
  nodes: [
    { id: "exec", label: "Exec dashboard", parents: ["mart-rev", "mart-churn"] },
    { id: "mart-churn", label: "Churn mart", parents: ["t-sessions", "t-users"] },
    { id: "mart-rev", label: "Revenue mart", parents: ["t-orders", "t-users"] },
    { id: "t-sessions", label: "Sessionise events", parents: ["stg-events"] },
    { id: "t-orders", label: "Normalise orders", parents: ["stg-orders", "stg-refunds"] },
    { id: "t-users", label: "Conform users", parents: ["stg-users"] },
    { id: "stg-refunds", label: "stg_refunds", parents: ["src-billing"] },
    { id: "stg-events", label: "stg_events", parents: ["src-clickstream"] },
    { id: "stg-orders", label: "stg_orders", parents: ["src-shop"] },
    { id: "stg-users", label: "stg_users", parents: ["src-crm"] },
    { id: "src-billing", label: "Billing API", parents: [] },
    { id: "src-clickstream", label: "Clickstream", parents: [] },
    { id: "src-shop", label: "Shop database", parents: [] },
    { id: "src-crm", label: "CRM export", parents: [] },
  ],
};
const laneIncidentDag: GlyphLaneDag = {
  nodes: [
    { id: "postmortem", label: "Postmortem published", parents: ["verify"] },
    { id: "verify", label: "Metrics recovered", parents: ["rollforward", "rollback"] },
    { id: "rollforward", label: "Deploy 4.2.1 (fixed)", parents: ["patch"], marks: ["v4.2.1"] },
    { id: "patch", label: "Patch null deref", parents: ["triage"] },
    { id: "rollback", label: "Roll back to 4.1.9", parents: ["triage"], marks: ["v4.1.9"] },
    { id: "triage", label: "Incident declared", parents: ["alert-latency", "alert-errors"], marks: ["SEV-2"] },
    { id: "alert-errors", label: "5xx rate alert", parents: ["deploy"] },
    { id: "alert-latency", label: "p99 latency alert", parents: ["deploy"] },
    { id: "deploy", label: "Deploy 4.2.0", parents: ["merge"], marks: ["v4.2.0"] },
    { id: "merge", label: "Merge release branch", parents: ["base"] },
    { id: "base", label: "Release candidate cut", parents: [] },
  ],
};
export const GLYPH_LANES_WORKBENCH_PRESETS = [
  { id: "release-train", label: "Release train (git)", source: laneReleaseTrainGitLog, sourceKind: "gitlog" as const },
  { id: "ci-pipeline", label: "CI matrix", source: JSON.stringify(laneCiPipelineDag, null, 2), sourceKind: "json" as const },
  { id: "data-lineage", label: "Warehouse lineage", source: JSON.stringify(laneDataLineageDag, null, 2), sourceKind: "json" as const },
  { id: "incident", label: "Incident + rollback", source: JSON.stringify(laneIncidentDag, null, 2), sourceKind: "json" as const },
] as const;

// Shapes distinguish ROLE, not just position (the task's own "better
// diagrams" brief): a circle marks entry/exit, a diamond the
// routing/decision node, subroutine boxes the worker tasks, a stadium the
// terminal deliverable.
const crewSource = `flowchart LR
  request((Request)) --> manager{Manager}
  subgraph crew[Crew]
    researcher[[Researcher]] --> writer[[Writer]]
  end
  manager --> researcher
  writer --> review{Review}
  review -->|approved| result([Result])
  review -.->|revise| writer
`;

/**
 * `dimension`/`view3d` (packet D3, PLAN-3d.md §10) mark a preset that opens
 * the 3D viewport instead of the 2D one — see `datasets3d/LICENSES.md` for
 * where each 3D preset's data comes from (a real vendored dataset or a
 * hand-authored, explicitly labelled example; never invented data presented
 * as real). Omitted `dimension` (every pre-D3 preset) is `"2d"`,
 * byte-identical to before this field existed.
 */
export const GLYPH_DIAGRAM_WORKBENCH_PRESETS = [
  { id: "chain", label: "Chain", source: chain },
  { id: "diamond", label: "Diamond", source: diamond },
  { id: "fan-out", label: "Fan-out", source: fanOut },
  { id: "cycle", label: "Cycle", source: cycle },
  { id: "subgraph", label: "Subgraph", source: subgraph },
  { id: "langgraph", label: "LangGraph agent", source: langgraph },
  { id: "crew", label: "CrewAI-style crew", source: crewSource },
  // "more complex 2D diagram presets" round (user, verbatim: "put a
  // subagent to create more complex 2d ascii charts... I want to add more
  // complex agentic architectures, maybe even a complex transformer with
  // inner pieces etc") — four genuinely complex, real-shaped 2D examples
  // the earlier chain/diamond/fan-out/cycle/subgraph/langgraph/crew
  // presets never exercised: real subgraph nesting, a feedback cycle, a
  // two-source convergence, and a fan-out/shared-dead-letter topology.
  // Every one of these renders in exactly one panel with no dropped
  // labels at the page's default web size (`complexPresets2d.test.ts`).
  { id: "agent-guardrail", label: "Agent + guardrail loop", source: agentGuardrail },
  { id: "transformer-block", label: "Transformer block (inner)", source: transformerBlock },
  { id: "rag-pipeline", label: "RAG pipeline", source: ragPipeline },
  { id: "event-queue", label: "Event queue + DLQ", source: eventQueue },
  // D2 round 6 — the 3D tray order is LeNet-5, Transformer, Agent
  // supervisor, Multi-agent crew. The first two are JSON-sourced
  // (`sourceKind: "json"`, `apply-preset`'s own branch below): Mermaid has
  // no syntax for `GlyphGraphNode.size` (AGENTS.md's "Diagrams 3D"), and
  // that per-node explicit sizing is the entire point of both fixtures (a
  // CNN's shrinking activation maps, a transformer block's uniform stack) —
  // round-tripping them through Mermaid would silently drop it.
  {
    id: "lenet5-3d", label: "LeNet-5 CNN (3D, example)", source: lenet5Cnn, sourceKind: "json" as const,
    dimension: "3d" as const, view3d: { layout: "layered" as const },
  },
  {
    id: "transformer-3d", label: "Transformer encoder (3D, example)", source: transformerEncoder, sourceKind: "json" as const,
    dimension: "3d" as const, view3d: { layout: "layered" as const },
  },
  {
    id: "agent-supervisor-3d", label: "Agent supervisor (3D, example)", source: agentSupervisor,
    dimension: "3d" as const, view3d: { layout: "layered" as const },
  },
  {
    id: "crew-3d", label: "Multi-agent crew (3D, example)", source: crewSource,
    dimension: "3d" as const, view3d: { layout: "layered" as const },
  },
  // D2 round 7 — the coordinator's own new example (a fan-out/join/split
  // topology, requested verbatim to exercise the triangulated ring layout's
  // "one in front, two in back" fan-in and a genuine front/back
  // `Merge`/`Side` split feeding one `Output`).
  {
    id: "fan-join-split-3d", label: "Fan-out / join / split (3D, example)", source: fanJoinSplit,
    dimension: "3d" as const, view3d: { layout: "layered" as const },
  },
  // "better diagrams" round (user, verbatim: "we don't have any really
  // good complex diagram, I want some really interesting diagrams") — a
  // genuinely complex, realistic-shaped DAG (19 nodes / 31 edges, wide
  // fan-out from checkout then fan-in through security-scan/publish/
  // notify) that the earlier, mostly-linear presets never exercised. Role
  // is shape-coded throughout: circle for entry/exit, rounded for quality
  // checks, a plain box for builds, stadium for test stages, diamond for
  // the security gate, subroutine for packaging, cylinder for a
  // publish/deploy target, asymmetric for the notify fan-in.
  {
    id: "ci-pipeline-3d", label: "CI pipeline DAG (3D, example)", source: ciPipelineDag, sourceKind: "json" as const,
    dimension: "3d" as const, view3d: { layout: "layered" as const },
  },
] as const;

export interface GlyphDiagramsWorkbenchControls {
  readonly target: GlyphDiagramTarget;
  readonly overrides: {
    readonly charset?: GlyphDiagramCharset;
    readonly color?: GlyphDiagramColorMode;
    readonly width?: number;
    readonly height?: number;
  };
}
export type GlyphDiagramsWorkbenchControlAction =
  | { type: "target"; value: GlyphDiagramTarget }
  | { type: "charset"; value: GlyphDiagramCharset }
  | { type: "color"; value: GlyphDiagramColorMode }
  | { type: "width" | "height"; value: number }
  | { type: "reset" };

export function reduceGlyphDiagramsWorkbenchControls(state: GlyphDiagramsWorkbenchControls, action: GlyphDiagramsWorkbenchControlAction): GlyphDiagramsWorkbenchControls {
  if (action.type === "target") return { ...state, target: action.value };
  if (action.type === "reset") return { target: state.target, overrides: {} };
  return { ...state, overrides: { ...state.overrides, [action.type]: action.value } };
}
// Both pipelines' target-default tables share the identical shape and, today,
// identical values (`packages/diagrams/src/sequence/render.ts`'s own comment:
// "Mirrors `GLYPH_DIAGRAM_TARGET_DEFAULTS`... exactly, for contract
// consistency"), but this reads the FORM's own table rather than assuming
// that — a future form with different per-target defaults needs only its own
// row here, never a change to this function. `form` defaults to `"graph"` so
// every pre-existing call site (this function used to take one argument)
// resolves EXACTLY as before.
const CONTROLS_TARGET_DEFAULTS: Readonly<Record<GlyphDiagramsFormId, typeof GLYPH_DIAGRAM_TARGET_DEFAULTS>> = {
  graph: GLYPH_DIAGRAM_TARGET_DEFAULTS, sequence: GLYPH_SEQUENCE_TARGET_DEFAULTS, lanes: GLYPH_LANE_TARGET_DEFAULTS,
};
export function resolveGlyphDiagramsWorkbenchControls(state: GlyphDiagramsWorkbenchControls, form: GlyphDiagramsFormId = "graph") {
  return { target: state.target, ...CONTROLS_TARGET_DEFAULTS[form][state.target], ...state.overrides };
}

// ── Web viewport fill (mirrors `@glyphcss/charts`' own workbench — this
// file's `GlyphDiagramsWorkbenchControls` has no `density` concept, so this
// is the simpler half of that page's same feature) ───────────────────────
/** The web `<pre>`'s fixed base `font-size` (`.diagrams-grid-scroll >
 *  .glyph-output`, `diagrams-workbench.css`) — the SAME 13px `/charts`
 *  uses (both pages share the identical Glyph Mono stack at `line-height:
 *  1`), kept as a page-local constant since diagrams has no per-target
 *  Density slider to derive it from. */
export const DIAGRAMS_WEB_BASE_FONT_PX = 13;
/** `true` when the Width/Height sliders have no effect at this target —
 *  `web` fills the measured viewport instead (this file's own
 *  `glyphDiagramsWorkbenchWebGridSize`), mirroring `@glyphcss/charts`'
 *  own workbench's `chartsWorkbenchSizeLocked` exactly. */
export function diagramsWorkbenchSizeLocked(target: GlyphDiagramTarget): boolean {
  return target === "web";
}
/** The grid a `web` render fills to — `viewportPx` (measured live,
 *  `InstrumentWorkbench/useElementSize.ts`) when available, else the
 *  target's own default grid (`GLYPH_DIAGRAM_TARGET_DEFAULTS.web`) for a
 *  caller with no viewport to measure (SSR, a headless test, the CLI). The
 *  Width/Height overrides are never read here — see `diagramsWorkbenchSizeLocked`. */
export function glyphDiagramsWorkbenchWebGridSize(viewportPx: GlyphPixelBox | undefined): { width: number; height: number } {
  if (viewportPx) return glyphMonoWebGridSize(viewportPx, DIAGRAMS_WEB_BASE_FONT_PX, 1);
  const defaults = GLYPH_DIAGRAM_TARGET_DEFAULTS.web;
  return { width: defaults.width, height: defaults.height };
}

/**
 * `view3d` (packet D3) — the layout/rotation knobs the Rail/Dock exposes
 * for the 3D viewport (AGENTS.md's "Diagrams 3D"): `layout`/`seed`
 * forward straight to `glyphDiagramObject`'s own options, `controlsMode`
 * picks turntable (default, axis-locked) vs. trackball (free rotation —
 * the user's "rotates in any direction" requirement) on the SAME
 * `createGlyphOrbitControls` the rest of the site's 3D surfaces use.
 * D2 round 5 retired `zBy` — `layout: "layered"` is now ONE fixed planar
 * embedding with no Z-axis-selection option (this file's "Diagrams 3D"
 * section).
 */
export interface GlyphDiagramsWorkbenchView3d {
  readonly layout: GlyphDiagram3dLayoutKind;
  readonly seed: number;
  readonly controlsMode: GlyphOrbitControlsMode;
}
/**
 * The resolved 3D camera — mirrors `renderGlyphDiagram3d`'s own `camera`
 * result shape (`rotX`/`rotY` XOR `mat`). `undefined` means "let the
 * library's own auto-fit choose one" (a fresh mount, or a just-applied
 * preset); set once the live viewport's orbit controls report a
 * `"end"` interaction, so Copy ASCII/ANSI and the `?d=` link both read the
 * camera the reader is actually looking through — AGENTS.md's D3 packet
 * "what you copy is what you see".
 */
export type GlyphDiagramsWorkbenchCamera3d = GlyphDiagram3dCamera & {
  readonly zoom: number;
  /** The orbit controls' own pan target (`GlyphOrbitControlsHandle.getTarget()`
   *  — mirrors `Charts3dCamera.pan`'s own doc, `chartsWorkbench3d.ts`): a
   *  middle/right/Shift-drag or two-finger pan moves `camera.target` off the
   *  mesh's own fitted centre, persisted here so it survives an orbit-drag
   *  release into `?d=`/a later mount. `undefined` (the default) means the
   *  fitted centre. `renderGlyphDiagram3d`'s own `GlyphDiagram3dCamera` has
   *  no pan concept, so this key rides along unread on the initial probe
   *  render and is applied only by `Diagrams3DViewport.tsx`'s own live
   *  mount, which sets `camera.target` from it directly. */
  readonly target?: readonly [number, number, number];
};

export const GLYPH_DIAGRAMS_WORKBENCH_DEFAULT_VIEW3D: GlyphDiagramsWorkbenchView3d = { layout: "layered", seed: 1, controlsMode: "turntable" };

/**
 * Packet D5 (AGENTS.md "Diagrams" — mirrors "Charts" "Data layer") —
 * provenance for the graph currently loaded: a tray preset (`apply-preset`
 * sets this on every pick, so it's never absent after one), or a specific
 * row of a Hugging Face `graphs-datasets` dataset (`select-remote-graph`).
 * `rowIdx`/`ref` are what a `?d=` link carries — the row itself is
 * re-fetched fresh on load, never stored (mirrors `ChartsDataSource`'s own
 * `"remote"` kind). Optional on the state type so an OLD link (saved before
 * this field existed) decodes with it simply absent — the rail's graph-
 * source card shows nothing rather than guessing at an origin the link
 * never recorded.
 */
export type GlyphDiagramsGraphSource =
  | { readonly kind: "builtin"; readonly presetId: string }
  | {
      readonly kind: "remote"; readonly ref: string; readonly rowIdx: number; readonly totalRows: number;
      readonly title: string; readonly description?: string; readonly label?: string; readonly simplified?: boolean;
      readonly source: { readonly name: string; readonly url: string; readonly licence?: string };
      /** Set only by `diagramsUrlStateForEncode` (`diagramsUrlState.ts`) —
       *  `true` means this state's own `nodes`/`edges`/`mermaid`/`json`
       *  were blanked before writing the `?d=` link (the graph itself is
       *  never stored for a remote pick) and `DiagramsWorkbench.tsx`'s
       *  mount effect must re-fetch `ref`/`rowIdx` fresh rather than
       *  trusting the (empty) decoded graph. */
      readonly omitted?: true;
      /** P3 fix round (added after this field's siblings — append-only,
       *  same rule as the rest of this type) — the graph source card's own
       *  "N of M nodes, K of L edges shown" readout: `originalNodeCount`
       *  is "M", `logicalEdgeCount` is "L" (the edge total the node cap
       *  truncated FROM, already net of any undirected dedupe — see
       *  `graphDatasetLoad.ts`'s own doc); "N"/"K" are simply the loaded
       *  `nodes`/`edges` arrays' own lengths, not duplicated here. Optional
       *  so a link from before this fix round decodes with the readout
       *  absent rather than wrong. */
      readonly originalNodeCount?: number;
      readonly logicalEdgeCount?: number;
      /** P1 fix round — whether every kept edge is `style: "undirected"`
       *  (a symmetric `edge_index`) or genuinely directed (arrowheads),
       *  read straight off `GraphDatasetRowOk.edgeDirection`. */
      readonly edgeDirection?: "directed" | "undirected";
    };

/**
 * Fix round 1, P1-2 — the shared `Instrument3DEffectsFolder`'s own state
 * shape, reused verbatim (not re-declared) so this file and the folder can
 * never drift on what "no effect"/"every node" mean.
 */
export const GLYPH_DIAGRAMS_WORKBENCH_DEFAULT_EFFECT3D: Instrument3DEffectsState = { effectId: INSTRUMENT_3D_EFFECT_NONE, targetId: INSTRUMENT_3D_EFFECT_ALL_TARGET };

/**
 * The `sequence` form's own source slice — mirrors `editor`/`sourceKind`/
 * `mermaid`/`json` above one level down instead of inline on the state, so
 * a future form's own slice (`lanes`, `timeline`, `matrix`) reads the same
 * way without crowding this file's top-level state shape. Mermaid and JSON
 * only — every form edits text through the ONE `DiagramsSourceEditor`.
 * `presetId` mirrors `graphSource.presetId`'s own role (which tray tile, if
 * any, is currently loaded) but stays optional/unstamped on a free edit —
 * sequence has no remote source to track, so this is the whole of its own
 * provenance.
 */
export interface GlyphDiagramsWorkbenchSequenceState {
  readonly editor: "mermaid" | "json";
  readonly sourceKind: "mermaid" | "json";
  readonly mermaid: string;
  readonly json: string;
  readonly presetId?: string;
}
export const GLYPH_DIAGRAMS_WORKBENCH_DEFAULT_SEQUENCE: GlyphDiagramsWorkbenchSequenceState = {
  editor: "mermaid", sourceKind: "mermaid",
  mermaid: GLYPH_SEQUENCE_WORKBENCH_PRESETS[0].source,
  json: JSON.stringify(glyphSequenceFromMermaid(GLYPH_SEQUENCE_WORKBENCH_PRESETS[0].source), null, 2),
  presetId: GLYPH_SEQUENCE_WORKBENCH_PRESETS[0].id,
};

/**
 * The `lanes` form's own source slice — mirrors `GlyphDiagramsWorkbenchSequenceState`
 * one level down: a git-log tab (the library's own `glyphLaneDagFromGitLog`
 * text shape) and a JSON tab over the lane-DAG IR's `{ nodes }` shape
 * (`packages/diagrams/AGENTS.md`'s "Lane DAGs").
 */
export interface GlyphDiagramsWorkbenchLanesState {
  readonly editor: "gitlog" | "json";
  readonly sourceKind: "gitlog" | "json";
  readonly gitlog: string;
  readonly json: string;
  readonly presetId?: string;
}
export const GLYPH_DIAGRAMS_WORKBENCH_DEFAULT_LANES: GlyphDiagramsWorkbenchLanesState = {
  editor: "gitlog", sourceKind: "gitlog",
  gitlog: GLYPH_LANES_WORKBENCH_PRESETS[0].source,
  json: JSON.stringify(glyphLaneDagFromGitLog(GLYPH_LANES_WORKBENCH_PRESETS[0].source), null, 2),
  presetId: GLYPH_LANES_WORKBENCH_PRESETS[0].id,
};

/**
 * `editor` is the tab on screen; `sourceKind` is the representation that is
 * AUTHORITATIVE for the graph (the one the reader last edited). The two
 * differ right after a tab switch, which only refreshes the shown text
 * from the authoritative one (`set-editor`, below). The graph itself is
 * never stored beside its text — `buildGlyphDiagramsWorkbenchGraph` parses
 * whichever representation is authoritative on demand. (The retired Table
 * tab used to keep a parsed `nodes`/`edges` copy here; a `?d=` link from
 * that era decodes through `diagramsUrlState.ts`'s legacy branch, which
 * folds those arrays back into the JSON text.)
 */
export interface GlyphDiagramsWorkbenchState {
  readonly editor: "mermaid" | "json";
  readonly sourceKind: "mermaid" | "json";
  readonly mermaid: string;
  readonly json: string;
  readonly controls: GlyphDiagramsWorkbenchControls;
  readonly layout: { readonly direction?: GlyphGraph["direction"]; readonly engine: "dagre"; readonly nodesep: number; readonly ranksep: number };
  readonly diagram: { readonly title: string; readonly detail: GlyphDiagramDetail };
  readonly terminal: { readonly NO_COLOR: boolean; readonly FORCE_COLOR: boolean };
  /**
   * `view`/`view3d`/`camera3d` (packet D3) — APPENDED fields (see
   * `diagramsUrlState.ts`'s own append-only rule): a link saved before this
   * packet existed decodes with `view: "2d"`, `view3d` at its default, and
   * `camera3d` absent, i.e. exactly today's page. `view` picks which
   * viewport `DiagramsWorkbench.tsx` mounts for the SAME graph — 2D
   * (`TargetPreview`) or 3D (a live orbitable scene on `web`, a static
   * `renderGlyphDiagram3d` frame through the SAME `TargetPreview` on
   * `terminal`/`chat`, per AGENTS.md's Charts "Targets and page" export
   * boundary this page mirrors).
   */
  readonly view: "2d" | "3d";
  readonly view3d: GlyphDiagramsWorkbenchView3d;
  readonly camera3d?: GlyphDiagramsWorkbenchCamera3d;
  /** Fix round 1, P1-2 — the live viewport's mounted effect + its mesh target. Preview-only (never rides into Copy/the static frame). */
  readonly effect3d: Instrument3DEffectsState;
  /** Packet D5 — see {@link GlyphDiagramsGraphSource}'s own doc. */
  readonly graphSource?: GlyphDiagramsGraphSource;
  /** Packet D5 — `true` once the reader has directly edited the currently
   *  loaded graph (any Mermaid/JSON edit), reset on every fresh
   *  load (`apply-preset`, `select-remote-graph`). Read only by
   *  `diagramsUrlState.ts`'s `diagramsUrlStateForEncode`: a REMOTE
   *  graph's own edits must never be silently discarded by the "never
   *  store the graph" omission that applies to an UN-edited remote pick. */
  readonly graphEdited?: boolean;
  /**
   * `form`/`sequence` — APPENDED fields, same append-only rule as `view`/
   * `view3d`/`camera3d` above: a link saved before this feature existed
   * decodes with `form: "graph"` and `sequence` at its own default
   * (`diagramsUrlState.ts`'s own doc), i.e. exactly today's page. `form`
   * picks which PIPELINE built the current diagram; the graph fields above
   * (`mermaid`/`json`/`graphSource`) are
   * untouched by a form switch either way, so switching back to `graph`
   * always finds the graph exactly as it was left.
   */
  readonly form: GlyphDiagramsFormId;
  readonly sequence: GlyphDiagramsWorkbenchSequenceState;
  readonly lanes: GlyphDiagramsWorkbenchLanesState;
}
/**
 * The footer tray's own flat list, across EVERY form. `section` labels the
 * divider that opens a run of tiles; a run with no section (the plain 2D
 * graph presets) opens the tray. Adding the lane-DAG form is one more block
 * here plus its own `kind`, never a change to the tray's rendering.
 */
export type GlyphDiagramsTrayEntry =
  | { readonly kind: "graph"; readonly section: string | null; readonly preset: (typeof GLYPH_DIAGRAM_WORKBENCH_PRESETS)[number] }
  | { readonly kind: "sequence"; readonly section: string | null; readonly preset: (typeof GLYPH_SEQUENCE_WORKBENCH_PRESETS)[number] }
  | { readonly kind: "lanes"; readonly section: string | null; readonly preset: (typeof GLYPH_LANES_WORKBENCH_PRESETS)[number] };

export const GLYPH_DIAGRAMS_TRAY: readonly GlyphDiagramsTrayEntry[] = [
  ...GLYPH_DIAGRAM_WORKBENCH_PRESETS.map((preset) => ({
    kind: "graph" as const,
    section: ("dimension" in preset && preset.dimension === "3d" ? "3D" : null),
    preset,
  })),
  ...GLYPH_SEQUENCE_WORKBENCH_PRESETS.map((preset, i) => ({
    kind: "sequence" as const, section: i === 0 ? "Sequence" : "Sequence", preset,
  })),
  ...GLYPH_LANES_WORKBENCH_PRESETS.map((preset) => ({
    kind: "lanes" as const, section: "Lanes" as const, preset,
  })),
];

export type GlyphDiagramsWorkbenchAction =
  | { type: "set-form"; form: GlyphDiagramsFormId }
  | { type: "set-sequence-editor"; editor: GlyphDiagramsWorkbenchSequenceState["editor"] }
  | { type: "edit-sequence-source"; value: string }
  | { type: "apply-sequence-preset"; id: string }
  | { type: "set-lanes-editor"; editor: GlyphDiagramsWorkbenchLanesState["editor"] }
  | { type: "edit-lanes-source"; value: string }
  | { type: "apply-lanes-preset"; id: string }
  | { type: "set-editor"; editor: GlyphDiagramsWorkbenchState["editor"] }
  | { type: "edit-source"; value: string }
  | { type: "apply-preset"; id: string }
  | { type: "set-control"; control: GlyphDiagramsWorkbenchControlAction }
  | { type: "set-layout"; patch: Partial<GlyphDiagramsWorkbenchState["layout"]> }
  | { type: "set-diagram"; patch: Partial<GlyphDiagramsWorkbenchState["diagram"]> }
  | { type: "set-terminal"; flag: "NO_COLOR" | "FORCE_COLOR"; value: boolean }
  // 3D (packet D3).
  | { type: "set-view"; view: "2d" | "3d" }
  | { type: "set-view3d"; patch: Partial<GlyphDiagramsWorkbenchView3d> }
  | { type: "set-camera3d"; camera: GlyphDiagramsWorkbenchCamera3d | undefined }
  | { type: "set-effect3d"; patch: Partial<Instrument3DEffectsState> }
  // Graph dataset search (packet D5): a loaded Hugging Face graph row commits
  // with ONE synchronous dispatch, mirroring `select-remote-dataset`
  // (`chartsWorkbenchState.ts`) — the async fetch happens in the component,
  // never the reducer. `preferred3d` is the loader's own molecule judgement
  // (`DIAGRAMS_MOLECULE_GRAPH_REFS`), threaded through so the reducer stays
  // a pure function of its payload rather than importing the curated index.
  | {
      type: "select-remote-graph"; graph: GlyphGraph; ref: string; rowIdx: number; totalRows: number;
      title: string; description?: string; label?: string; simplified?: boolean;
      source: { name: string; url: string; licence?: string }; preferred3d: boolean;
      // P3 fix round — see `GlyphDiagramsGraphSource`'s own doc.
      originalNodeCount?: number; logicalEdgeCount?: number; edgeDirection?: "directed" | "undirected";
    };

export function createGlyphDiagramsWorkbenchState(): GlyphDiagramsWorkbenchState {
  return {
    editor: "mermaid", sourceKind: "mermaid", mermaid: langgraph, json: JSON.stringify(glyphGraphFromMermaid(langgraph), null, 2),
    controls: { target: "web", overrides: {} }, layout: { engine: "dagre", nodesep: 4, ranksep: 4 },
    diagram: { title: "LangGraph agent", detail: "auto" }, terminal: { NO_COLOR: false, FORCE_COLOR: false },
    view: "2d", view3d: GLYPH_DIAGRAMS_WORKBENCH_DEFAULT_VIEW3D, camera3d: undefined, effect3d: GLYPH_DIAGRAMS_WORKBENCH_DEFAULT_EFFECT3D,
    graphSource: { kind: "builtin", presetId: "langgraph" }, graphEdited: false,
    form: "graph", sequence: GLYPH_DIAGRAMS_WORKBENCH_DEFAULT_SEQUENCE, lanes: GLYPH_DIAGRAMS_WORKBENCH_DEFAULT_LANES,
  };
}
export function buildGlyphDiagramsWorkbenchSequence(state: GlyphDiagramsWorkbenchState): GlyphSequence {
  return state.sequence.sourceKind === "mermaid"
    ? glyphSequenceFromMermaid(state.sequence.mermaid)
    : validateGlyphSequence(parseGlyphSequenceJson(state.sequence.json));
}
export function buildGlyphDiagramsWorkbenchLanes(state: GlyphDiagramsWorkbenchState): GlyphLaneDag {
  const lanes = state.lanes;
  return lanes.sourceKind === "gitlog" ? glyphLaneDagFromGitLog(lanes.gitlog) : validateGlyphLaneDag(parseGlyphLaneDagJson(lanes.json));
}
// `parseGlyphDiagramJson`, not a bare `JSON.parse`: a malformed JSON draft
// then fails with the library's own tagged `GLYPH_DIAGRAM_BAD_JSON` (a rule
// with a repair hint, `DiagramsSourceEditor` places it on the offending
// line), exactly as the sequence/lanes forms' own JSON boundaries already do.
export function buildGlyphDiagramsWorkbenchGraph(state: GlyphDiagramsWorkbenchState): GlyphGraph {
  const graph = state.sourceKind === "mermaid" ? glyphGraphFromMermaid(state.mermaid) : glyphGraphFromJson(parseGlyphDiagramJson(state.json));
  return state.layout.direction ? { ...graph, direction: state.layout.direction } : graph;
}

export function reduceGlyphDiagramsWorkbenchState(state: GlyphDiagramsWorkbenchState, action: GlyphDiagramsWorkbenchAction): GlyphDiagramsWorkbenchState {
  switch (action.type) {
    case "set-editor": {
      // Switching tabs REFRESHES the newly-shown representation's text from
      // whichever source is currently authoritative (`sourceKind`) — it
      // never steals authority itself, only an actual edit does (below),
      // which is what lets JSON-only metadata (`kind`, `priority`, ...)
      // survive a round trip through the Mermaid tab it has no vocabulary
      // for, right up until the reader edits Mermaid directly.
      if (action.editor === state.editor) return state;
      try {
        const graph = buildGlyphDiagramsWorkbenchGraph(state);
        if (action.editor === "json") return { ...state, editor: "json", json: JSON.stringify(graph, null, 2) };
        return { ...state, editor: "mermaid", mermaid: glyphDiagramsWorkbenchMermaid(graph) };
      } catch {
        return { ...state, editor: action.editor, sourceKind: action.editor };
      }
    }
    case "edit-source": return { ...state, sourceKind: state.editor, [state.editor]: action.value, graphEdited: true };
    case "apply-preset": {
      const preset = GLYPH_DIAGRAM_WORKBENCH_PRESETS.find((item) => item.id === action.id);
      if (!preset) return state;
      // D2 round 6 — a preset whose own `sourceKind` is `"json"` (LeNet-5,
      // Transformer: explicit per-node `size`, no Mermaid vocabulary for
      // it) parses/authors through the JSON path instead of Mermaid's; the
      // Mermaid TAB still gets a real (size-less) derived rendering rather
      // than being left stale, the same "switching tabs refreshes from the
      // authoritative source" rule `set-editor` already follows.
      const isJsonSource = "sourceKind" in preset && preset.sourceKind === "json";
      const graph = isJsonSource ? glyphGraphFromJson(JSON.parse(preset.source)) : glyphGraphFromMermaid(preset.source);
      // A 3D preset (`dimension: "3d"`) switches the viewport AND resets
      // `camera3d` to `undefined` so the newly-mounted object re-runs the
      // library's own auto-fit (AGENTS.md D3: never a page-tuned camera) —
      // a 2D preset resets `view3d` back to the shared default so an
      // earlier 3D preset's `layout` choice doesn't leak into the
      // next graph's own Rail/Dock reading.
      const is3d = "dimension" in preset && preset.dimension === "3d";
      const view3dPatch = is3d && "view3d" in preset ? preset.view3d : GLYPH_DIAGRAMS_WORKBENCH_DEFAULT_VIEW3D;
      // D2 round 7 (coordinator, verbatim: "Presets open 3D on braille for
      // web") — a 3D preset clears any charset OVERRIDE the reader made in
      // 2D, so the charset falls back to `GLYPH_DIAGRAM_TARGET_DEFAULTS`'
      // own per-target default (braille on web/terminal, box — which
      // `resolveCharset` degrades to blocks — on chat) rather than
      // carrying forward a 2D-picked value with no 3D meaning (`ascii`
      // stays whatever the 2D default already was, since a reader who
      // never touched the charset control should see no visible change on
      // a 2D preset).
      const { charset: _droppedCharsetOverride, ...overridesWithoutCharset } = state.controls.overrides;
      const controls = is3d ? { ...state.controls, overrides: overridesWithoutCharset } : state.controls;
      return { ...state, sourceKind: isJsonSource ? "json" : "mermaid",
        mermaid: isJsonSource ? glyphDiagramsWorkbenchMermaid(graph) : preset.source,
        json: isJsonSource ? preset.source : JSON.stringify(graph, null, 2),
        layout: { ...state.layout, direction: undefined }, diagram: { ...state.diagram, title: preset.label },
        controls,
        view: is3d ? "3d" : "2d", view3d: { ...GLYPH_DIAGRAMS_WORKBENCH_DEFAULT_VIEW3D, ...view3dPatch }, camera3d: undefined,
        effect3d: GLYPH_DIAGRAMS_WORKBENCH_DEFAULT_EFFECT3D,
        graphSource: { kind: "builtin", presetId: preset.id }, graphEdited: false, form: "graph" };
    }
    case "set-control": return { ...state, controls: reduceGlyphDiagramsWorkbenchControls(state.controls, action.control) };
    case "set-layout": return { ...state, layout: { ...state.layout, ...action.patch } };
    case "set-diagram": return { ...state, diagram: { ...state.diagram, ...action.patch } };
    case "set-terminal": return { ...state, terminal: { ...state.terminal, [action.flag]: action.value } };
    // 3D (packet D3). A view switch clears `camera3d` — the fresh viewport
    // (or, on terminal/chat, the next static render) picks its own
    // auto-fit rather than inheriting a pose framed for the OTHER mode.
    case "set-view": return action.view === state.view ? state : { ...state, view: action.view, camera3d: undefined };
    // A layout/seed/controlsMode edit invalidates the mounted object's
    // geometry (a different layout is a different set of node positions),
    // so the camera resets to auto-fit for the SAME reason a view switch
    // does — an old camera framed for the previous layout can clip or
    // misplace the new one.
    case "set-view3d": return { ...state, view3d: { ...state.view3d, ...action.patch }, camera3d: undefined };
    case "set-camera3d": return { ...state, camera3d: action.camera };
    case "set-effect3d": return { ...state, effect3d: { ...state.effect3d, ...action.patch } };
    // Packet D5 — mirrors `apply-preset`'s own shape (fresh
    // mermaid/json snapshots, view reset, camera
    // reset to auto-fit) but reads a already-loaded `GlyphGraph` instead of
    // parsing a fixture string, and picks the 3D view only for a molecule
    // dataset (`preferred3d`, resolved by the caller from
    // `DIAGRAMS_MOLECULE_GRAPH_REFS` — this reducer stays a pure function
    // of its own payload).
    case "select-remote-graph": {
      const { graph } = action;
      const view3dPatch = action.preferred3d ? { layout: "layered" as const } : GLYPH_DIAGRAMS_WORKBENCH_DEFAULT_VIEW3D;
      return {
        ...state, sourceKind: "json",
        mermaid: glyphDiagramsWorkbenchMermaid(graph), json: JSON.stringify(graph, null, 2),
        layout: { ...state.layout, direction: undefined },
        diagram: { ...state.diagram, title: action.title },
        view: action.preferred3d ? "3d" : "2d",
        view3d: { ...GLYPH_DIAGRAMS_WORKBENCH_DEFAULT_VIEW3D, ...view3dPatch }, camera3d: undefined,
        effect3d: GLYPH_DIAGRAMS_WORKBENCH_DEFAULT_EFFECT3D,
        graphSource: {
          kind: "remote", ref: action.ref, rowIdx: action.rowIdx, totalRows: action.totalRows,
          title: action.title, description: action.description, label: action.label, simplified: action.simplified,
          source: action.source,
          originalNodeCount: action.originalNodeCount, logicalEdgeCount: action.logicalEdgeCount, edgeDirection: action.edgeDirection,
        },
        graphEdited: false, form: "graph",
      };
    }
    // A form switch never touches the OTHER form's own fields (the graph
    // fields stay exactly as left when switching to sequence, and vice
    // versa) — only `view`, which forces back to `"2d"` for a form whose
    // descriptor says `supports3d: false` (today, `sequence` — the
    // `mapDirectionLocked`-idiom View toggle dims the 3D option too,
    // `DiagramsDock.tsx`'s own `viewToggleOptions`, but a reader already IN
    // 3D switching form must not strand the page on a view the new form
    // can't render). `camera3d` resets with it for the same reason a plain
    // `set-view` does above.
    case "set-form": {
      if (action.form === state.form) return state;
      const supports3d = GLYPH_DIAGRAMS_FORMS.find((f) => f.id === action.form)?.supports3d ?? true;
      return { ...state, form: action.form, ...(supports3d ? {} : { view: "2d" as const, camera3d: undefined }) };
    }
    // Mirrors `set-editor`'s own "refresh, never steal authority" rule
    // (this file's own doc on that case): switching tabs re-derives the
    // newly-shown representation from whichever source is currently
    // authoritative, and only an actual edit (`edit-sequence-source`) makes
    // a representation authoritative itself.
    case "set-sequence-editor": {
      if (action.editor === state.sequence.editor) return state;
      try {
        const sequence = buildGlyphDiagramsWorkbenchSequence(state);
        if (action.editor === "json") return { ...state, sequence: { ...state.sequence, editor: "json", json: JSON.stringify(sequence, null, 2) } };
        return { ...state, sequence: { ...state.sequence, editor: "mermaid", mermaid: glyphDiagramsWorkbenchSequenceMermaid(sequence) } };
      } catch {
        return { ...state, sequence: { ...state.sequence, editor: action.editor, sourceKind: action.editor } };
      }
    }
    case "edit-sequence-source": return { ...state, sequence: { ...state.sequence, sourceKind: state.sequence.editor, [state.sequence.editor]: action.value, presetId: undefined } };
    case "apply-sequence-preset": {
      const preset = GLYPH_SEQUENCE_WORKBENCH_PRESETS.find((item) => item.id === action.id);
      if (!preset) return state;
      const sequence = glyphSequenceFromMermaid(preset.source);
      return {
        ...state, form: "sequence", view: "2d", camera3d: undefined,
        sequence: {
          editor: state.sequence.editor, sourceKind: "mermaid", mermaid: preset.source,
          json: JSON.stringify(sequence, null, 2), presetId: preset.id,
        },
        diagram: { ...state.diagram, title: preset.label },
      };
    }
    // Mirrors `set-sequence-editor`'s own "refresh, never steal authority"
    // rule one level down for the lane-DAG form's git-log / JSON tabs:
    // switching in re-derives the newly-shown representation from
    // whichever is currently authoritative; only an actual edit
    // (`edit-lanes-source`) makes a representation authoritative itself.
    case "set-lanes-editor": {
      if (action.editor === state.lanes.editor) return state;
      try {
        const dag = buildGlyphDiagramsWorkbenchLanes(state);
        if (action.editor === "json") return { ...state, lanes: { ...state.lanes, editor: "json", json: JSON.stringify(dag, null, 2) } };
        return { ...state, lanes: { ...state.lanes, editor: "gitlog", gitlog: glyphDiagramsWorkbenchLanesGitLog(dag) } };
      } catch {
        return { ...state, lanes: { ...state.lanes, editor: action.editor, sourceKind: action.editor } };
      }
    }
    case "edit-lanes-source": return { ...state, lanes: { ...state.lanes, sourceKind: state.lanes.editor, [state.lanes.editor]: action.value, presetId: undefined } };
    case "apply-lanes-preset": {
      const preset = GLYPH_LANES_WORKBENCH_PRESETS.find((item) => item.id === action.id);
      if (!preset) return state;
      const dag = preset.sourceKind === "gitlog" ? glyphLaneDagFromGitLog(preset.source) : validateGlyphLaneDag(parseGlyphLaneDagJson(preset.source));
      return {
        ...state, form: "lanes", view: "2d", camera3d: undefined,
        lanes: {
          editor: state.lanes.editor, sourceKind: preset.sourceKind,
          gitlog: preset.sourceKind === "gitlog" ? preset.source : glyphDiagramsWorkbenchLanesGitLog(dag),
          json: preset.sourceKind === "json" ? preset.source : JSON.stringify(dag, null, 2),
          presetId: preset.id,
        },
        diagram: { ...state.diagram, title: preset.label },
      };
    }
  }
}
/** `viewportPx` — the measured live viewport (`useElementSize`) — is read
 *  ONLY on `web`; every other target ignores it entirely, exactly like it
 *  ignores `state.controls.overrides.width`/`.height` there
 *  (`diagramsWorkbenchSizeLocked`'s own doc). */
export function glyphDiagramsWorkbenchRenderOptions(state: GlyphDiagramsWorkbenchState, viewportPx?: GlyphPixelBox): GlyphDiagramRenderOptions {
  const resolved = resolveGlyphDiagramsWorkbenchControls(state.controls);
  const size = state.controls.target === "web" ? glyphDiagramsWorkbenchWebGridSize(viewportPx) : { width: resolved.width, height: resolved.height };
  // `state.diagram` is spread WITHOUT its `title` — USER FEEDBACK, verbatim:
  // "why do we have the titles of the diagrams in the rendering areas? we
  // should only have the diagrams, not titles". The viewport holds the
  // render and nothing else, the same rule the ledger readout already
  // follows; the title still names the diagram in the rail, the aria-label,
  // the exported snippet and the `?d=` link.
  const { title: _title, ...diagram } = state.diagram;
  return { ...resolved, width: size.width, height: size.height, ...state.layout, ...diagram,
    ...(state.controls.target === "terminal" ? { env: { ...(state.terminal.NO_COLOR ? { NO_COLOR: "1" } : {}), ...(state.terminal.FORCE_COLOR ? { FORCE_COLOR: "1" } : {}) } } : {}) };
}
/** Mirrors `glyphDiagramsWorkbenchRenderOptions` exactly, one level down for
 *  the sequence pipeline: same web-viewport-fill rule, same title-excluded-
 *  from-the-render rule, same terminal env passthrough. Reads
 *  `GLYPH_SEQUENCE_TARGET_DEFAULTS` through `resolveGlyphDiagramsWorkbenchControls(state.controls, "sequence")`
 *  rather than the graph pipeline's table. */
export function glyphDiagramsWorkbenchSequenceRenderOptions(state: GlyphDiagramsWorkbenchState, viewportPx?: GlyphPixelBox) {
  const resolved = resolveGlyphDiagramsWorkbenchControls(state.controls, "sequence");
  const size = state.controls.target === "web" ? glyphDiagramsWorkbenchWebGridSize(viewportPx) : { width: resolved.width, height: resolved.height };
  return { ...resolved, width: size.width, height: size.height,
    ...(state.controls.target === "terminal" ? { env: { ...(state.terminal.NO_COLOR ? { NO_COLOR: "1" } : {}), ...(state.terminal.FORCE_COLOR ? { FORCE_COLOR: "1" } : {}) } } : {}) };
}
/** Mirrors `glyphDiagramsWorkbenchSequenceRenderOptions` exactly, one level
 *  down for the lane-DAG pipeline. Reads `GLYPH_LANE_TARGET_DEFAULTS` through
 *  `resolveGlyphDiagramsWorkbenchControls(state.controls, "lanes")`. */
export function glyphDiagramsWorkbenchLanesRenderOptions(state: GlyphDiagramsWorkbenchState, viewportPx?: GlyphPixelBox) {
  const resolved = resolveGlyphDiagramsWorkbenchControls(state.controls, "lanes");
  const size = state.controls.target === "web" ? glyphDiagramsWorkbenchWebGridSize(viewportPx) : { width: resolved.width, height: resolved.height };
  return { ...resolved, width: size.width, height: size.height,
    ...(state.controls.target === "terminal" ? { env: { ...(state.terminal.NO_COLOR ? { NO_COLOR: "1" } : {}), ...(state.terminal.FORCE_COLOR ? { FORCE_COLOR: "1" } : {}) } } : {}) };
}
/**
 * `renderGlyphDiagram3d`'s own options for the CURRENT state — shared by
 * the live viewport's initial auto-fit render, the static terminal/chat
 * frame, Copy ASCII/ANSI, and preset thumbnails (packet D3). `direction`/
 * `nodesep`/`ranksep` ride on the SAME "Layout" Dock folder the 2D path
 * already exposes (`GlyphDiagram3dLayoutOptions` and `GlyphDiagramLayoutOptions`
 * share those field names) rather than a duplicated 3D-only row set.
 */
export function glyphDiagramsWorkbenchRenderOptions3d(state: GlyphDiagramsWorkbenchState): GlyphDiagram3dRenderOptions {
  const controls = resolveGlyphDiagramsWorkbenchControls(state.controls);
  return {
    layout: state.view3d.layout, seed: state.view3d.seed,
    ...(state.layout.direction ? { direction: state.layout.direction } : {}),
    nodesep: state.layout.nodesep, ranksep: state.layout.ranksep,
    target: controls.target, charset: controls.charset, color: controls.color,
    // No `title` — USER FEEDBACK, verbatim: "why do we have the titles of
    // the diagrams in the rendering areas? we should only have the diagrams,
    // not titles". The library option stays for a CLI/API caller; the page's
    // own viewport holds the render and nothing else, the same rule the
    // ledger readout already follows. `state.diagram.title` still names the
    // diagram for the rail, the aria-label and the `?d=` link.
    width: controls.width, height: controls.height,
    ...(state.camera3d ? { camera: state.camera3d } : {}),
    ...(state.controls.target === "terminal" ? { env: { ...(state.terminal.NO_COLOR ? { NO_COLOR: "1" } : {}), ...(state.terminal.FORCE_COLOR ? { FORCE_COLOR: "1" } : {}) } } : {}),
  };
}
/** Fix round 1, P1-2 — the Effects folder's own target list: one entry per graph node, in graph order. */
export function glyphDiagramsWorkbenchEffectTargets(nodes: readonly GlyphGraphNode[]): readonly { readonly id: string; readonly label: string }[] {
  return nodes.map((node) => ({ id: node.id, label: node.label }));
}
/**
 * The page-level rule every 2D pipeline's render applies before calling the
 * library: a chat client's fenced-code font has no braille glyphs
 * (AGENTS.md's "Targets and page"), so an explicit `braille` on `chat`
 * renders as `box`. Generic over the option type so the graph, sequence
 * and lane pipelines (and the export snippet, which must print the options
 * the render ACTUALLY used) all read the one rule.
 */
export function glyphDiagramsWorkbenchChatCharset<T extends { readonly target?: string; readonly charset?: string }>(options: T): T {
  return options.target === "chat" && options.charset === "braille" ? { ...options, charset: "box" } : options;
}

/** A JS template literal carrying `source` verbatim — the export snippet shows the reader's own text, not a `\n`-escaped string. */
function templateLiteral(source: string): string {
  return `\`${source.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${")}\``;
}
/**
 * One TypeScript snippet shape for every form: the import, the source
 * exactly as edited on this page (a template literal for a text source, the
 * pretty-printed object for a JSON one — never a one-line escaped string),
 * then the render call with the SAME resolved options the page rendered
 * with (`glyphDiagramsWorkbenchChatCharset` applied, so a chat+braille page
 * prints the `box` it really drew).
 */
function typescriptSnippet(importLine: string, renderFn: string, sourceName: string, source: string, options: object): string {
  const literal = source.startsWith("{") ? source : templateLiteral(source);
  return `${importLine}\n\n// The ${sourceName} exactly as edited on the /diagrams page.\nconst ${sourceName} = ${literal};\n\nconst diagram = await ${renderFn}(${sourceName}, ${JSON.stringify(options, null, 2)});\n`;
}
export function generateGlyphDiagramsWorkbenchSnippets(state: GlyphDiagramsWorkbenchState, viewportPx?: GlyphPixelBox): Record<string, string> {
  if (state.form === "sequence") {
    const sequence = buildGlyphDiagramsWorkbenchSequence(state);
    const json = JSON.stringify(sequence, null, 2);
    const mermaid = state.sequence.sourceKind === "mermaid" ? state.sequence.mermaid : glyphDiagramsWorkbenchSequenceMermaid(sequence);
    const options = glyphDiagramsWorkbenchChatCharset(glyphDiagramsWorkbenchSequenceRenderOptions(state, viewportPx));
    return { json, mermaid, typescript: state.sequence.sourceKind === "mermaid"
      ? typescriptSnippet('import { renderGlyphSequence } from "@glyphcss/diagrams/sequence";', "renderGlyphSequence", "source", state.sequence.mermaid, options)
      : typescriptSnippet('import { renderGlyphSequence } from "@glyphcss/diagrams/sequence";', "renderGlyphSequence", "sequence", json, options) };
  }
  if (state.form === "lanes") {
    const dag = buildGlyphDiagramsWorkbenchLanes(state);
    const json = JSON.stringify(dag, null, 2);
    const gitlog = state.lanes.sourceKind === "gitlog" ? state.lanes.gitlog : glyphDiagramsWorkbenchLanesGitLog(dag);
    const options = glyphDiagramsWorkbenchChatCharset(glyphDiagramsWorkbenchLanesRenderOptions(state, viewportPx));
    // `renderGlyphLaneDag` takes the git-log text directly, the same way
    // `renderGlyphDiagram` takes Mermaid text.
    return { json, gitlog, typescript: state.lanes.sourceKind === "gitlog"
      ? typescriptSnippet('import { renderGlyphLaneDag } from "@glyphcss/diagrams/lanes";', "renderGlyphLaneDag", "log", state.lanes.gitlog, options)
      : typescriptSnippet('import { renderGlyphLaneDag } from "@glyphcss/diagrams/lanes";', "renderGlyphLaneDag", "dag", json, options) };
  }
  const graph = buildGlyphDiagramsWorkbenchGraph(state);
  const json = JSON.stringify(graph, null, 2);
  const mermaid = state.sourceKind === "mermaid" && !state.layout.direction ? state.mermaid : glyphDiagramsWorkbenchMermaid(graph);
  const options = glyphDiagramsWorkbenchChatCharset(glyphDiagramsWorkbenchRenderOptions(state, viewportPx));
  // A Mermaid source with a Dock direction override renders through the
  // derived Mermaid (which carries that direction), never the raw text with
  // an option the library's own Mermaid path would ignore.
  return { json, mermaid, typescript: state.sourceKind === "mermaid"
    ? typescriptSnippet('import { renderGlyphDiagram } from "@glyphcss/diagrams";', "renderGlyphDiagram", "source", mermaid, options)
    : typescriptSnippet('import { renderGlyphDiagram } from "@glyphcss/diagrams";', "renderGlyphDiagram", "graph", json, options) };
}

export function glyphDiagramsWorkbenchMermaid(graph: GlyphGraph): string {
  // Keep canonical ordering stable; aliases are only needed for JSON-only ids.
  const safeId = /^[\p{L}\p{N}_](?:[\p{L}\p{N}_.]|:(?!:)|-(?=[\p{L}\p{N}_]))*$/u;
  const used = new Set(graph.nodes.filter((node) => safeId.test(node.id)).map((node) => node.id));
  const ids = new Map(graph.nodes.map((node, index) => {
    if (safeId.test(node.id)) return [node.id, node.id];
    let id = `glyph_node_${index}`;
    while (used.has(id)) id += "_";
    used.add(id);
    return [node.id, id];
  }));
  const label = (text: string) => `"${text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/\\/g, "&#92;").replace(/\n/g, "<br/>")}"`;
  // D2 round 6 — `cylinder` (the LeNet-5 preset's own `embed`-style
  // datastore nodes) was missing here entirely, crashing this function the
  // first time a JSON-sourced 3D preset needed a Mermaid-tab rendering
  // (`apply-preset`'s own JSON branch). Mermaid's real cylinder/database
  // token is `[( )]` — the mermaid ADAPTER (`packages/diagrams/src/mermaid.ts`)
  // does not parse it back into `shape: "cylinder"` yet (AGENTS.md's own
  // "JSON-only shape today" — the library side of this gap, out of scope
  // here), so this is a best-effort DISPLAY string, not a round-trippable
  // one; the JSON tab stays authoritative for a `cylinder` node exactly
  // like it already is for `size`.
  const shapes = { rect: ["[", "]"], rounded: ["(", ")"], diamond: ["{", "}"], circle: ["((", "))"], subroutine: ["[[", "]]"], asymmetric: [">(", "]"], stadium: ["([", "])"], cylinder: ["[(", ")]"] };
  const groups = graph.groups ?? [];
  // Same collision avoidance as node aliases: a group whose own id already
  // happens to equal another group's generated fallback alias (e.g.
  // "glyph_group_0") must not collide with it.
  const usedGroupIds = new Set(groups.filter((group) => safeId.test(group.id)).map((group) => group.id));
  const groupIds = new Map(groups.map((group, index) => {
    if (safeId.test(group.id)) return [group.id, group.id];
    let id = `glyph_group_${index}`;
    while (usedGroupIds.has(id)) id += "_";
    usedGroupIds.add(id);
    return [group.id, id];
  }));
  const lines = [`flowchart ${graph.direction}`];
  for (const node of graph.nodes) {
    const [open, close] = shapes[node.shape ?? "rect"]!;
    lines.push(`  ${ids.get(node.id)}${open}${label(node.label)}${close}`);
  }
  for (const group of groups) {
    lines.push(`  subgraph ${groupIds.get(group.id)}[${label(group.label ?? group.id)}]`, ...group.members.map((id) => `    ${ids.get(id)}`), "  end");
  }
  for (const edge of graph.edges) {
    const arrow = edge.style === "dotted" ? "-.->" : edge.style === "thick" ? "==>" : edge.style === "undirected" ? "---" : "-->";
    lines.push(`  ${ids.get(edge.from)} ${arrow}${edge.label ? `|${label(edge.label)}|` : ""} ${ids.get(edge.to)}`);
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Mirrors `glyphDiagramsWorkbenchMermaid`'s own role for the sequence
 * pipeline — the JSON tab's own best-effort Mermaid rendering, read by
 * `set-sequence-editor`'s "switching tabs refreshes" rule above. An `alt`
 * frame immediately followed by a `kind: "else"` frame whose own `from` is
 * exactly the prior frame's `to + 1` is one continuous Mermaid block (`alt
 * … else … end`) — precisely the shape `glyphSequenceFromMermaid`'s own
 * parser produces for a real `alt`/`else` (`mermaid.ts`'s `closeSegment`:
 * an "else" mutates the SAME stack frame rather than opening a new one), so
 * detecting that adjacency here is what makes an alt/else round-trip
 * through this tab pair without duplicating "end" or losing the "else"
 * branch's own condition. Any other frame (`loop`, `opt`, or a JSON-authored
 * `kind` with no matching library keyword) opens and closes on its own —
 * `kind` is rendered verbatim, exactly as `packages/diagrams/AGENTS.md`'s
 * "Domain-agnostic IR" requires of the pipeline itself.
 */
export function glyphDiagramsWorkbenchSequenceMermaid(sequence: GlyphSequence): string {
  const lines = ["sequenceDiagram"];
  for (const participant of sequence.participants) {
    const keyword = participant.shape === "actor" ? "actor" : "participant";
    lines.push(participant.label && participant.label !== participant.id ? `  ${keyword} ${participant.id} as ${participant.label}` : `  ${keyword} ${participant.id}`);
  }
  const frames = [...(sequence.frames ?? [])].sort((a, b) => a.from - b.from);
  const notesAt = new Map<number, GlyphSequenceNote[]>();
  for (const note of sequence.notes ?? []) notesAt.set(note.at, [...(notesAt.get(note.at) ?? []), note]);
  const emitNotes = (index: number) => { for (const note of notesAt.get(index) ?? []) lines.push(`  note over ${note.over.join(",")}: ${note.text}`); };

  let frameIndex = 0;
  let openChainEnd = -1;
  for (let i = 0; i < sequence.messages.length; i++) {
    emitNotes(i);
    while (frameIndex < frames.length && frames[frameIndex]!.from === i) {
      const frame = frames[frameIndex]!;
      lines.push(frame.kind === "else" && openChainEnd === i - 1 ? `  else ${frame.label ?? ""}`.trimEnd() : `  ${frame.kind}${frame.label ? ` ${frame.label}` : ""}`);
      openChainEnd = frame.to;
      frameIndex++;
    }
    const message = sequence.messages[i]!;
    const arrow = message.style === "dashed" ? "-->>" : "->>";
    lines.push(`  ${message.from}${arrow}${message.to}: ${message.label ?? ""}`.trimEnd());
    if (i === openChainEnd) {
      const next: GlyphSequenceFrame | undefined = frames[frameIndex];
      if (!(next && next.kind === "else" && next.from === i + 1)) { lines.push("  end"); openChainEnd = -1; }
    }
  }
  emitNotes(sequence.messages.length);
  return `${lines.join("\n")}\n`;
}

/**
 * Mirrors `glyphDiagramsWorkbenchMermaid`/`glyphDiagramsWorkbenchSequenceMermaid`'s
 * own role, one level down for the lane-DAG pipeline's git-log tab: a
 * best-effort `"id|parents|decoration|subject"` serialization (newest
 * first, exactly `glyphLaneDagFromGitLog`'s own expected shape —
 * `packages/diagrams/src/lanes/git.ts`) so a JSON-authoritative
 * DAG still shows something real on the git-log tab. `dag.nodes` is already
 * ordered newest-first (the IR's own invariant), so no re-sorting is
 * needed. Not a byte-exact inverse of the adapter (a `|` inside a label
 * would need escaping the adapter doesn't do either) — same "best-effort
 * display string" caveat `glyphDiagramsWorkbenchMermaid`'s own doc states
 * for its `cylinder` shape.
 */
export function glyphDiagramsWorkbenchLanesGitLog(dag: GlyphLaneDag): string {
  return dag.nodes.map((node) => {
    const decoration = node.marks && node.marks.length ? `(${node.marks.join(", ")})` : "";
    return `${node.id}|${node.parents.join(" ")}|${decoration}|${node.label}`;
  }).join("\n");
}
