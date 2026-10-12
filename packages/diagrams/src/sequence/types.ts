/**
 * The sequence-diagram IR. Deliberately domain-agnostic: a participant is an
 * ordered lane with an id and a label, a message is a directed step from one
 * lane to another, a frame is a labelled box around a message range, and a
 * note is a labelled marker over a set of lanes. None of this vocabulary
 * assumes a service call, an HTTP exchange, or any other domain — the same
 * shape fits people in a process, protocol peers, OS threads, hardware
 * components, or a workflow's actors, exactly as well as it fits API calls.
 */

/**
 * A rendering hook only — never guessed from `label`/`kind`. `"lane"`
 * (default) draws a plain vertical rule under a labelled header; `"actor"`
 * draws a small stick figure instead. Both are geometric shape names, not
 * domain vocabulary (the same register as `GlyphGraphNodeShape`'s
 * `"diamond"`/`"circle"`).
 */
export type GlyphSequenceParticipantShape = "lane" | "actor";

export interface GlyphSequenceParticipant {
  readonly id: string;
  readonly label: string;
  /** Informational only — a caller's own filtering/styling tag; never interpreted here. Mirrors `GlyphGraphNode.kind`. */
  readonly kind?: string;
  readonly shape?: GlyphSequenceParticipantShape;
}

/** Presentational only. Direction (which way the arrow points) and self-ness (`from === to`) are structural and always derived from `from`/`to`, never carried as a separate field. */
export type GlyphSequenceMessageStyle = "solid" | "dashed";

export interface GlyphSequenceMessage {
  readonly id?: string;
  readonly from: string;
  readonly to: string;
  readonly label?: string;
  readonly style?: GlyphSequenceMessageStyle;
}

/**
 * A divider inside a frame, drawn just before message index `at` — Mermaid's
 * `else`. `kind` is rendered verbatim like the frame's own.
 */
export interface GlyphSequenceFrameBranch {
  readonly kind: string;
  readonly label?: string;
  readonly at: number;
}

/**
 * A labelled box enclosing an inclusive, 0-based range of `messages`
 * indices, with optional dividers (`branches`) splitting it into segments.
 * `kind` is rendered verbatim and never interpreted — the Mermaid adapter
 * passes its own keywords (`"alt"`, `"opt"`, `"loop"`, and `"else"` for a
 * branch) straight through, and a JSON caller may use any other keyword the
 * same way. The box spans the participants its messages touch.
 */
export interface GlyphSequenceFrame {
  readonly kind: string;
  readonly label?: string;
  readonly from: number;
  readonly to: number;
  readonly branches?: readonly GlyphSequenceFrameBranch[];
}

/**
 * A labelled marker over a set of lanes, inserted immediately before message
 * index `at` (`at === messages.length` places it after the last message).
 * Visually the same floating-bar primitive as a frame; the distinct field
 * lets a caller anchor a note to lanes directly instead of a message range.
 */
export interface GlyphSequenceNote {
  readonly text: string;
  readonly over: readonly string[];
  readonly at: number;
}

export interface GlyphSequence {
  readonly participants: readonly GlyphSequenceParticipant[];
  readonly messages: readonly GlyphSequenceMessage[];
  readonly frames?: readonly GlyphSequenceFrame[];
  readonly notes?: readonly GlyphSequenceNote[];
}
