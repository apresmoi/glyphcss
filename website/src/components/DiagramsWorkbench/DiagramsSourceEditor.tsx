/**
 * The /diagrams rail's source editor — ONE component for every text source
 * on the page (graph/sequence Mermaid, every form's JSON, the lane form's
 * git-log), parameterised by `dialect`. Hand-rolled rather than a
 * CodeMirror dependency: the page needs a gutter, highlighting for two
 * dialects no stock grammar covers (Mermaid, git-log lines), and errors
 * placed on a line — which the library's positionless error codes can only
 * get from `diagramsSourceErrors.ts`'s own locator either way. A real editor
 * package would add ~100 KB gzipped to a docs page for undo history the
 * native `<textarea>` already keeps.
 *
 * Structure — the classic overlay editor: a transparent-text `<textarea>`
 * (the real, focusable, scrollable control — caret, selection, IME, native
 * undo all stay native) sits over an `aria-hidden` highlight layer and a
 * line-number gutter that translate with its scroll offset. Both layers
 * share the textarea's exact font/line-height/padding/tab-size
 * (`.diagrams-editor*`, `diagrams-workbench.css`) and never soft-wrap, so
 * line N of the gutter is line N of the text.
 *
 * The authoring aid (`diagramsSourceAid.ts`) rides on the same surface: a
 * toolbar of snippets above the text (the graph form's node snippets fold
 * into one shape menu whose entries carry a LIVE preview the page renders
 * through the real library), and id completion — the ids the live parse
 * already knows, offered as the reader types an edge endpoint, a message
 * participant or a git-log parent. Both insert through `replaceSelection`,
 * so browser undo covers them like any keystroke.
 *
 * Editing is GUIDED, always (the user's own ask: "single way of editing,
 * always guided"): `diagramsSourceSlots.ts`'s slot map masks the text. The
 * caret may only rest inside a slot (a stray click is redirected to the
 * nearest one), Tab/Shift+Tab and Enter walk the slots, typing and deleting
 * are refused wherever they would touch structure (a native `beforeinput`
 * guard — cancelable, before the DOM changes, so undo history never sees a
 * refused edit), and a cycle slot (arrow, shape, direction, frame kind,
 * JSON enum) LISTS its choices — Enter or its ▾ opens the node menu's own
 * tile widget with the held value marked (a shape with its live preview),
 * Space and the vertical arrows still cycle for whoever knows the set.
 * Every slot is drawn as a field; the one under the caret is filled and
 * named in the ONE status line under the editor, so "what am I editing"
 * is answered at a glance.
 *
 * Paste: a single-line clipboard is a VALUE — it goes into the field under
 * the caret, line breaks collapsed and characters the field cannot hold
 * dropped. A multi-line clipboard is a SOURCE — it replaces the whole text
 * (one undo step), because nobody pastes three lines into an id.
 *
 * A source that does not parse is still repairable — there is no raw mode
 * to fall back on, so the mask itself opens: the line the error locator
 * names becomes one free "repair" slot (any character, line breaks
 * included), or every line does when the failure names none
 * (`diagramsSourceRepairSlots`). The normal fields return the moment the
 * source parses. IME composition is never interrupted (a mid-composition
 * cancel corrupts the composer's own state), so composed text lands as
 * typed. A refused keystroke shows itself as a 1.5 s pink flash on the
 * field and a one-line reason under the editor — never a modal or a sound.
 *
 * Commits are DEBOUNCED (`commitDelayMs` idle, flushed on blur): the page's
 * render pipeline (`DiagramsWorkbench.tsx`'s per-form effects) re-lays the
 * whole diagram out on every reducer change, so a keystroke-per-dispatch
 * editor ran dagre on every character. An external `value` change (a tray
 * preset, a tab switch, a remote load) cancels any pending commit and is
 * adopted as-is — the outside world wins over a draft it never saw.
 */
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { GlyphGraphNodeShape } from "@glyphcss/diagrams";
import type { GlyphDiagramsFormId } from "./diagramsWorkbenchState";
import { locateDiagramsSourceError } from "./diagramsSourceErrors";
import { tokenizeDiagramsSource, type DiagramsSourceDialect } from "./diagramsSourceTokens";
import { DIAGRAMS_SHAPE_CATALOGUE, diagramsSourceCompletionContext, diagramsSourceCompletions, diagramsSourceInsertion, type DiagramsSourceCompletion, type DiagramsSourceSnippet } from "./diagramsSourceAid";
import { diagramsSourceItemFields, diagramsSourceItemKey, diagramsSourceItemOfSlot, diagramsSourceSlotOfItem, type DiagramsSourceItem } from "./diagramsSourceSelection";
import { DiagramsChoiceList, diagramsChoiceOf, type DiagramsChoice } from "./DiagramsChoiceList";
import {
  diagramsSourceNearestSlot, diagramsSourceRepairSlots, diagramsSourceSlotAccepts, diagramsSourceSlotAt, diagramsSourceSlotChoose, diagramsSourceSlotCycle, diagramsSourceSlotOptionIndex, diagramsSourceSlotSanitize, diagramsSourceSlotStep, diagramsSourceSlots,
  type DiagramsSourceSlot,
} from "./diagramsSourceSlots";

/** Pixel line height every layer shares — see `.diagrams-editor` in `diagrams-workbench.css`, which pins the same value. */
export const DIAGRAMS_EDITOR_LINE_PX = 20;
const REFUSAL_MS = 1500;
const CYCLE_HOW = "Enter or ▾ lists its choices, Space cycles them";
const MERMAID_SHAPE_OPENERS = DIAGRAMS_SHAPE_CATALOGUE.filter((s) => s.mermaid).map((s) => s.open);

export interface DiagramsSourceEditorProps {
  readonly id: string;
  readonly label: string;
  readonly form: GlyphDiagramsFormId;
  readonly dialect: DiagramsSourceDialect;
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** The current render's failure, if any (`GlyphDiagramsWorkbenchRender`'s own `ok: false` shape). */
  readonly error?: { readonly error: string; readonly code?: string } | null;
  readonly commitDelayMs?: number;
  /** Ids the live parse knows (nodes, participants, lane nodes) — what completion offers. */
  readonly ids?: readonly DiagramsSourceCompletion[];
  /** The toolbar's snippets (`diagramsSourceSnippets`); grouped ones fold into one menu. */
  readonly snippets?: readonly DiagramsSourceSnippet[];
  /** Live shape previews, rendered by the page through the real library, keyed by `GlyphGraphNodeShape`. */
  readonly previews?: Readonly<Partial<Record<GlyphGraphNodeShape, string>>>;
  /** The node or edge the field under the caret belongs to (`diagramsSourceSelection.ts`), whenever it changes — what the render marks. */
  readonly onSelectionChange?: (item: DiagramsSourceItem | null) => void;
  /**
   * The item the pointer is over ON THE RENDER. Its fields light up here and
   * scroll into view, so pointing at a node in the diagram answers "where is
   * this in the source" without clicking anything. USER, verbatim: "when we
   * hover it on the rendering area we should see it in the left sidebar
   * highlighting — like you highlight the node and you know where the node
   * is in the sidebar". Distinct from selection, which the caret owns.
   */
  readonly highlight?: DiagramsSourceItem | null;
}
export interface DiagramsSourceEditorHandle {
  /** Move the caret to the start of a 1-based line, scroll it into view and focus the editor. */
  jumpToLine(line: number): void;
  insertSnippet(snippet: DiagramsSourceSnippet): void;
  /** Select an item's field (a node's label, an edge's label or arrow), scrolled into view and focused, so the next keystroke replaces it. False when the source declares no such item. */
  selectItem(item: DiagramsSourceItem): boolean;
}

function lineStartOffset(text: string, line: number): number {
  let offset = 0;
  for (let i = 1; i < line; i++) {
    const next = text.indexOf("\n", offset);
    if (next < 0) return text.length;
    offset = next + 1;
  }
  return offset;
}
/** Line (1-based) and VISUAL column of an offset — a tab advances to the next multiple of the shared `tab-size: 2`, as the layers render it. */
function lineColumnOf(text: string, offset: number): { line: number; col: number } {
  const before = text.slice(0, offset);
  const line = before.split("\n").length;
  const lineText = before.slice(before.lastIndexOf("\n") + 1);
  let col = 0;
  for (const char of lineText) col = char === "\t" ? col + 2 - (col % 2) : col + 1;
  return { line, col };
}

interface CompletionState {
  readonly start: number; readonly end: number;
  readonly items: readonly DiagramsSourceCompletion[]; readonly index: number;
  readonly top: number; readonly left: number;
}

export const DiagramsSourceEditor = forwardRef<DiagramsSourceEditorHandle, DiagramsSourceEditorProps>(function DiagramsSourceEditor(
  { id, label, form, dialect, value, onChange, error, commitDelayMs = 150, ids = [], snippets = [], previews = {}, onSelectionChange, highlight = null }, ref,
) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const layerRef = useRef<HTMLDivElement | null>(null);
  const gutterRef = useRef<HTMLDivElement | null>(null);
  const measureRef = useRef<HTMLSpanElement | null>(null);
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null);
  // The global timer functions, not `window.*` — identical in a browser, but
  // only the globals are what a test's fake timers intercept.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const committedRef = useRef(value);
  const tabReleasedRef = useRef(false);
  const pendingSelectionRef = useRef<readonly [number, number] | null>(null);
  const [draft, setDraft] = useState(value);
  const [seenValue, setSeenValue] = useState(value);
  const [completion, setCompletion] = useState<CompletionState | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [caret, setCaret] = useState<readonly [number, number]>([0, 0]);
  // The choice list of the cycle slot under the caret: the highlighted
  // option's index while open, null while closed. `scrollTick` only forces
  // a render on scroll, so the list and its ▾ trigger track the slot's
  // pixel position (which reads the textarea's scroll offset).
  const [choices, setChoices] = useState<number | null>(null);
  const [, setScrollTick] = useState(0);
  const [refusal, setRefusal] = useState<{ readonly reason: string; readonly at: number } | null>(null);
  const refusalTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tokens = useMemo(() => tokenizeDiagramsSource(dialect, draft), [dialect, draft]);
  const lineCount = tokens.length;
  const diagnostic = useMemo(() => (error ? locateDiagramsSourceError(form, dialect, draft, error) : null), [error, form, dialect, draft]);
  const errorLine = diagnostic?.line !== undefined && diagnostic.line <= lineCount ? diagnostic.line : undefined;
  // The slot map, with the broken line(s) opened up for repair while the
  // source does not parse (`error` is the last render's failure; the
  // locator places it on the CURRENT draft).
  const slots = useMemo(() => {
    const masked = diagramsSourceSlots(form, dialect, draft);
    return diagnostic ? diagramsSourceRepairSlots(masked, draft, errorLine ?? "all") : masked;
  }, [form, dialect, draft, diagnostic, errorLine]);
  const activeSlot = diagramsSourceSlotAt(slots, caret[0], caret[1]);
  // The fields of the item the pointer is over on the render — marked here,
  // never on the diagram, which stays pure ink.
  const highlightKey = diagramsSourceItemKey(highlight);
  const highlighted = useMemo(() => {
    if (!highlight) return new Set<DiagramsSourceSlot>();
    const fields = diagramsSourceItemFields(slots, draft, dialect, highlight);
    return new Set([fields?.anchor, fields?.label, fields?.choice].filter(Boolean) as DiagramsSourceSlot[]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightKey, slots, draft, dialect]);
  // Every cycle field, tagged with its position among fields of its OWN role.
  // That ordinal, not the byte offset, is the key its `<select>` renders
  // under: an edit anywhere earlier shifts every offset after it, and an
  // offset key would destroy and re-create each later control — including
  // one the reader has a menu open on, which then applies its old offsets to
  // the new text. Keyed by ordinal the element survives and takes fresh props.
  const cycleFields = useMemo(() => {
    const seen = new Map<string, number>();
    return slots.filter((slot) => slot.kind === "cycle" && (slot.options?.length ?? 0) > 1).map((slot) => {
      const ordinal = seen.get(slot.role) ?? 0;
      seen.set(slot.role, ordinal + 1);
      return { slot, ordinal };
    });
  }, [slots]);
  // The choice field the ▾ and the list belong to. A one-character choice
  // (a Mermaid shape's `[`) can never hold a collapsed caret INSIDE it, so a
  // caret touching its edge offers it too — a click on the bracket gets the
  // shape list, not only Tab's selection of it.
  const adjacentChoice = caret[0] === caret[1] ? slots.find((s) => s.kind === "cycle" && s.options && (s.start === caret[0] || s.end === caret[0])) : undefined;
  const choiceSlot = activeSlot?.kind === "cycle" && activeSlot.options ? activeSlot : adjacentChoice ?? null;
  /**
   * The values a field can hold, when they are a KNOWN SET — USER FEEDBACK,
   * verbatim: "anything that has a constrained set ... should be possible to
   * click and show a dropdown". A cycle field carries its own vocabulary; an
   * `id` field (an edge's `from`/`to`, a `parents` entry, a group `member`)
   * is constrained by the ids that EXIST, which the live parse already hands
   * us. The current text is kept as an option even when it names nothing yet,
   * so a half-typed or brand-new id is never silently replaced by the list —
   * typing a NEW id still works, the select only offers the existing ones.
   */
  const idSlot = activeSlot?.kind === "id" && ids.length > 0 ? activeSlot : null;
  const dropdownSlot = choiceSlot ?? idSlot;
  const selectOptions: readonly string[] = choiceSlot?.options
    ?? (idSlot ? (() => {
      const held = draft.slice(idSlot.start, idSlot.end);
      const known = ids.map((i) => i.id);
      return known.includes(held) ? known : [held, ...known];
    })() : []);
  // The ONE selection: the item the caret's field belongs to, reported
  // upward only when it changes (a keystroke inside the same label is not a
  // selection change), so the render marks it without re-rendering per key.
  const selectedItem = useMemo(() => (activeSlot ? diagramsSourceItemOfSlot(slots, draft, dialect, activeSlot) ?? null : null), [activeSlot, slots, draft, dialect]);
  const selectedKey = diagramsSourceItemKey(selectedItem);
  const onSelectionChangeRef = useRef(onSelectionChange);
  onSelectionChangeRef.current = onSelectionChange;
  useEffect(() => { onSelectionChangeRef.current?.(selectedItem); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey]);
  // The native `beforeinput` guard (below) runs outside React's render, so it reads the latest of these through refs.
  const guardRef = useRef({ slots, dialect });
  guardRef.current = { slots, dialect };
  const refuse = (reason: string) => {
    setRefusal({ reason, at: Date.now() });
    if (refusalTimer.current !== null) clearTimeout(refusalTimer.current);
    refusalTimer.current = setTimeout(() => { refusalTimer.current = null; setRefusal(null); }, REFUSAL_MS);
  };
  useEffect(() => () => { if (refusalTimer.current !== null) clearTimeout(refusalTimer.current); }, []);

  // Adopt an external change during render (React's own derived-state
  // idiom), never in an effect — a test or a reader reading the textarea
  // right after a preset click must already see the new source.
  if (value !== seenValue) {
    setSeenValue(value);
    if (value !== committedRef.current) {
      committedRef.current = value;
      setDraft(value);
      if (timerRef.current !== null) { clearTimeout(timerRef.current); timerRef.current = null; }
    }
  }

  const commit = (next: string) => {
    if (timerRef.current !== null) { clearTimeout(timerRef.current); timerRef.current = null; }
    if (next === committedRef.current) return;
    committedRef.current = next;
    onChange(next);
  };
  /** Cell metrics of the text area, for placing the completion list under the caret. */
  const caretPixel = (offset: number): { top: number; left: number } => {
    const el = textareaRef.current;
    const { line, col } = lineColumnOf(el?.value ?? draft, offset);
    const measured = measureRef.current?.getBoundingClientRect().width ?? 0;
    const charW = measured > 0 ? measured / 10 : 6.6;
    const gutterW = gutterRef.current?.offsetWidth ?? 0;
    // Read the REAL padding off the textarea rather than repeating the CSS
    // value here. Every hardcoded copy of a CSS length is a desync waiting to
    // happen — `--diagrams-editor-line` already did exactly that, and the
    // overlay drifted from its own text until a test pinned the pairing.
    const style = el ? getComputedStyle(el) : null;
    const padTop = style ? parseFloat(style.paddingTop) || 0 : 6;
    const padLeft = style ? parseFloat(style.paddingLeft) || 0 : 6 + gutterW;
    return {
      // `lineColumnOf` counts lines from ONE (`split("\n").length`), so the
      // first line is 1 — subtract it, or every overlay lands a full line
      // below its own text. The `▾` trigger used to hide this by subtracting
      // a line at its own call site; nothing else did, which is why the
      // dropdown sat under the label it belonged to.
      top: padTop + (line - 1) * DIAGRAMS_EDITOR_LINE_PX - (el?.scrollTop ?? 0),
      // `paddingLeft` already includes the gutter (the CSS adds it), so the
      // gutter width is NOT added again — doing both shifted every field one
      // gutter to the right of its own text.
      left: padLeft + col * charW - (el?.scrollLeft ?? 0),
    };
  };
  const refreshCompletion = (next: string, caret: number) => {
    const context = diagramsSourceCompletionContext(dialect, next, caret);
    const items = context ? diagramsSourceCompletions(ids, context.prefix) : [];
    if (!context || items.length === 0) { setCompletion(null); return; }
    setCompletion((current) => ({
      start: context.start, end: caret, items,
      index: current && current.start === context.start ? Math.min(current.index, items.length - 1) : 0,
      ...caretPixel(context.start),
    }));
  };
  const update = (next: string, caret?: number) => {
    setDraft(next);
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { timerRef.current = null; commit(next); }, commitDelayMs);
    if (caret === undefined) setCompletion(null); else refreshCompletion(next, caret);
  };
  useEffect(() => () => { if (timerRef.current !== null) clearTimeout(timerRef.current); }, []);

  // The fallback edit path (no `execCommand`) applies the caret AFTER React
  // has written the new value into the node.
  useLayoutEffect(() => {
    const selection = pendingSelectionRef.current;
    const el = textareaRef.current;
    if (!selection || !el) return;
    pendingSelectionRef.current = null;
    el.setSelectionRange(selection[0], selection[1]);
  });

  /**
   * Replace `[start, end)` with `text`, keeping the browser's native undo
   * stack where `execCommand("insertText")` exists (every shipping browser;
   * deprecated but the only undo-preserving API there is). Elsewhere (test
   * DOMs) the same edit goes through React state plus a deferred caret.
   * `caret` selects a range afterwards (a snippet's placeholder); default
   * is a collapsed caret after the inserted text.
   */
  const replaceSelection = (el: HTMLTextAreaElement, start: number, end: number, text: string, caret?: readonly [number, number]) => {
    // `insertText` writes at the FOCUSED element's own caret — it takes no
    // target and no range. Setting this textarea's selection first only
    // steers it while this textarea IS the focused element. It is not, for
    // an edit that came from a native `<select>`: the menu holds focus, and
    // the browser then writes wherever it believes the caret to be, which is
    // how an arrow ended up inside a node's label (USER: "its like it puts
    // the arrows in other places"). Every path that does not own focus takes
    // the deterministic string path below instead — same result, one undo
    // step of its own rather than the native stack's.
    const focused = typeof document !== "undefined" && document.activeElement === el;
    let native = false;
    if (focused) {
      el.setSelectionRange(start, end);
      try { native = typeof document.execCommand === "function" && document.execCommand("insertText", false, text); } catch { native = false; }
    }
    if (native) {
      if (caret) el.setSelectionRange(caret[0], caret[1]);
      return;
    }
    const next = `${el.value.slice(0, start)}${text}${el.value.slice(end)}`;
    pendingSelectionRef.current = caret ?? [start + text.length, start + text.length];
    update(next);
  };

  const acceptCompletion = (state: CompletionState, index = state.index) => {
    const el = textareaRef.current;
    const item = state.items[index];
    if (!el || !item) return;
    setCompletion(null);
    replaceSelection(el, state.start, state.end, item.id);
  };
  const insertSnippet = (snippet: DiagramsSourceSnippet) => {
    const el = textareaRef.current;
    if (!el) return;
    setMenuOpen(false);
    setCompletion(null);
    el.focus();
    const insertion = diagramsSourceInsertion(el.value, el.selectionStart, snippet, dialect);
    replaceSelection(el, insertion.start, insertion.end, insertion.insert, insertion.select);
  };
  /** Select a whole slot — the guided idiom: land on a field with its value selected, so typing replaces it. */
  const selectSlot = (el: HTMLTextAreaElement, slot: DiagramsSourceSlot) => {
    el.setSelectionRange(slot.start, slot.end);
    setCaret([slot.start, slot.end]);
    scrollLineIntoView(el, lineColumnOf(el.value, slot.start).line, true);
  };
  /** Apply a cycle slot's edits as ONE replacement spanning all of them (a shape's opener AND closer, the label between kept), so it is one undo step and one DOM write. */
  const applySlotEdits = (el: HTMLTextAreaElement, edits: ReturnType<typeof diagramsSourceSlotCycle>) => {
    if (!edits) return;
    const first = edits[edits.length - 1]!, last = edits[0]!;
    const text = edits.length === 1 ? first.replacement : `${first.replacement}${el.value.slice(first.end, last.start)}${last.replacement}`;
    replaceSelection(el, first.start, last.end, text, [first.start, first.start + first.replacement.length]);
    setCaret([first.start, first.start + first.replacement.length]);
  };
  const cycleSlot = (el: HTMLTextAreaElement, slot: DiagramsSourceSlot, direction: 1 | -1) => applySlotEdits(el, diagramsSourceSlotCycle(slot, el.value, direction));
  /**
   * A choice writes to OFFSETS, so it must never run against text those
   * offsets no longer describe. A native menu stays open across re-renders,
   * and the reader picks an option whenever they like — so between the
   * render that offered the choice and the `change` that applies it, the
   * text can have moved under it. It did: choosing one arrow then another
   * wrote the second into the middle of a node id and left the first arrow
   * in place (USER: "it puts more than one arrow... it should only change
   * the arrow there is").
   *
   * The span is therefore CHECKED before it is written: it must still hold
   * the value the control was showing. When it does not, the same field is
   * found again by its position in the field ORDER — stable while an edit
   * elsewhere shifts every offset after it — and only a field that is gone
   * outright refuses.
   */
  const chooseOption = (el: HTMLTextAreaElement, slot: DiagramsSourceSlot, held: string, option: string) => {
    setChoices(null);
    const target = el.value.slice(slot.start, slot.end) === held ? slot : reanchorSlot(el.value, slot, held);
    if (!target) { refuse("That field moved while the menu was open — pick it again."); return; }
    applySlotEdits(el, diagramsSourceSlotChoose(target, option));
  };
  /** The same field in `text`: the slot of that kind and role at the same ordinal, still holding `held`. */
  const reanchorSlot = (text: string, slot: DiagramsSourceSlot, held: string): DiagramsSourceSlot | null => {
    const sameField = (list: readonly DiagramsSourceSlot[]) => list.filter((s) => s.kind === slot.kind && s.role === slot.role);
    const ordinal = sameField(slots).indexOf(slot);
    if (ordinal < 0) return null;
    const candidate = sameField(diagramsSourceSlots(form, dialect, text))[ordinal];
    return candidate && text.slice(candidate.start, candidate.end) === held ? candidate : null;
  };
  /** Open the choice list on a cycle slot, highlighting the option it holds. */
  const selectRef = useRef<HTMLSelectElement | null>(null);
  const openChoices = (el: HTMLTextAreaElement, slot: DiagramsSourceSlot) => {
    el.focus();
    setCompletion(null);
    setChoices(Math.max(0, diagramsSourceSlotOptionIndex(slot, el.value)));
  };
  // The guard: a cancelable native `beforeinput` sees every edit the reader
  // is about to make — typing, deleting, pasting, cutting — BEFORE the DOM
  // changes, so a refusal costs nothing and undo history stays clean.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const onBeforeInput = (event: InputEvent) => {
      const { slots: current, dialect: currentDialect } = guardRef.current;
      if (event.isComposing || event.inputType === "insertCompositionText" || event.inputType.startsWith("history")) return;
      const from = el.selectionStart, to = el.selectionEnd;
      const slot = diagramsSourceSlotAt(current, from, to);
      // The marked field follows the guard's own read of the selection, so
      // a refusal flashes the field the reader is actually in.
      setCaret([from, to]);
      const deny = (reason: string) => { event.preventDefault(); refuse(reason); };
      const repair = slot?.role === "repair";
      const repairAt = (offset: number) => current.some((s) => s.role === "repair" && s.start <= offset && offset <= s.end);
      // A multi-line clipboard is a whole SOURCE, wherever it lands.
      if (event.inputType === "insertFromPaste" || event.inputType === "insertFromDrop") {
        const raw = event.dataTransfer?.getData("text/plain") ?? "";
        const wholeSource = raw.includes("\n") || (from === 0 && to === el.value.length);
        if (wholeSource) {
          event.preventDefault();
          replaceSelection(el, 0, el.value.length, raw.replace(/\r\n?/g, "\n"), [0, 0]);
          refuse("Replaced the whole source with the pasted text — Undo brings the old one back.");
          return;
        }
      }
      if (!slot) { deny(from === to ? "That is structure — Tab moves between the fields, the toolbar adds statements." : "The selection spans structure — select within one field."); return; }
      switch (event.inputType) {
        case "insertText": {
          const data = event.data ?? "";
          if (slot.kind === "cycle") { deny(`The ${slot.role} is a fixed choice — ${CYCLE_HOW}.`); return; }
          const clean = diagramsSourceSlotSanitize(slot, currentDialect, data);
          if (clean === data) return;
          event.preventDefault();
          if (clean.length > 0) { el.setSelectionRange(from, to); replaceSelection(el, from, to, clean); }
          refuse(`The ${slot.role} cannot hold "${Array.from(data).find((c) => !diagramsSourceSlotAccepts(slot, currentDialect, c)) ?? data}".`);
          return;
        }
        case "insertLineBreak": case "insertParagraph": {
          if (repair) return; // a repair line may grow lines
          event.preventDefault();
          const next = diagramsSourceSlotStep(current, to, 1);
          if (next) selectSlot(el, next);
          refuse("Enter moves to the next field — the toolbar above adds new statements.");
          return;
        }
        case "insertFromPaste": case "insertFromDrop": {
          event.preventDefault();
          if (slot.kind === "cycle") { refuse(`The ${slot.role} is a fixed choice — ${CYCLE_HOW}.`); return; }
          const raw = event.dataTransfer?.getData("text/plain") ?? "";
          const clean = diagramsSourceSlotSanitize(slot, currentDialect, raw);
          if (clean.length > 0) { el.setSelectionRange(from, to); replaceSelection(el, from, to, clean); }
          if (clean !== raw) refuse(`Pasted into the ${slot.role}: characters it cannot hold were dropped.`);
          return;
        }
        case "deleteContentBackward":
          // Joining two repair lines is a repair too.
          if (from === to && from <= slot.start && !(repair && from > 0 && repairAt(from - 1))) deny(`That is structure — only the ${slot.role} can change here.`);
          return;
        case "deleteContentForward":
          if (from === to && to >= slot.end && !(repair && repairAt(to + 1))) deny(`That is structure — only the ${slot.role} can change here.`);
          return;
        case "deleteByCut": case "deleteContent":
          return;
        default:
          // Word/line deletes reach outside the field from a bare caret; with a selection inside the slot they are plain deletes.
          if (event.inputType.startsWith("delete") && from === to) deny(`Select within the ${slot.role} to delete it.`);
      }
    };
    el.addEventListener("beforeinput", onBeforeInput);
    return () => el.removeEventListener("beforeinput", onBeforeInput);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /** A caret that lands on structure (a click, an arrow key past a field's edge) is redirected to the nearest field. */
  const onSelect = () => {
    const el = textareaRef.current;
    if (!el) return;
    const { selectionStart: from, selectionEnd: to } = el;
    if (from === to && !diagramsSourceSlotAt(slots, from)) {
      const nearest = diagramsSourceNearestSlot(slots, from);
      if (nearest) {
        const target = from < nearest.start ? nearest.start : nearest.end;
        el.setSelectionRange(target, target);
        setCaret([target, target]);
        return;
      }
    }
    setCaret([from, to]);
  };
  const scrollLineIntoView = (el: HTMLTextAreaElement, line: number, onlyIfHidden = false) => {
    const top = (line - 1) * DIAGRAMS_EDITOR_LINE_PX;
    if (onlyIfHidden && top >= el.scrollTop && top + DIAGRAMS_EDITOR_LINE_PX <= el.scrollTop + el.clientHeight) return;
    el.scrollTop = Math.max(0, top - el.clientHeight / 2);
    onScroll();
  };
  // Pointing at a node in a long source has to BRING the field into view —
  // a highlight below the fold answers nothing. Scroll only, never focus or
  // move the caret: hovering the render must not steal the reader's place.
  useEffect(() => {
    const el = textareaRef.current;
    const first = highlighted.values().next();
    if (!el || first.done) return;
    scrollLineIntoView(el, lineColumnOf(el.value, first.value.start).line);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightKey]);
  const jumpToLine = (line: number) => {
    const el = textareaRef.current;
    if (!el) return;
    const target = Math.max(1, Math.min(line, el.value.split("\n").length));
    const offset = lineStartOffset(el.value, target);
    el.focus();
    el.setSelectionRange(offset, offset);
    scrollLineIntoView(el, target);
  };
  const selectItem = (item: DiagramsSourceItem): boolean => {
    const el = textareaRef.current;
    if (!el) return false;
    const slot = diagramsSourceSlotOfItem(slots, el.value, dialect, item);
    if (!slot) return false;
    el.focus();
    setCompletion(null);
    selectSlot(el, slot);
    return true;
  };
  useImperativeHandle(ref, () => ({ jumpToLine, insertSnippet, selectItem }));

  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    const el = event.currentTarget;
    if (event.nativeEvent.isComposing) return;
    if (completion) {
      // The completion list owns these keys while it is open; Escape here
      // only closes it (a second Escape then arms the Tab release below).
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const delta = event.key === "ArrowDown" ? 1 : -1;
        setCompletion({ ...completion, index: (completion.index + delta + completion.items.length) % completion.items.length });
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") { event.preventDefault(); acceptCompletion(completion); return; }
      if (event.key === "Escape") { event.preventDefault(); setCompletion(null); return; }
      if (event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "Home" || event.key === "End") setCompletion(null);
    }
    const slot = diagramsSourceSlotAt(slots, el.selectionStart, el.selectionEnd);
    if (choices !== null && choiceSlot?.options) {
      // The choice list owns the keys a listbox owns; Escape only closes it.
      const options = choiceSlot.options;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setChoices((choices + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab" || event.key === " ") { event.preventDefault(); chooseOption(el, choiceSlot, el.value.slice(choiceSlot.start, choiceSlot.end), options[choices]!); return; }
      if (event.key === "Escape") { event.preventDefault(); setChoices(null); return; }
    }
    if (event.key === "Escape") { tabReleasedRef.current = true; return; }
    if (event.key === "Tab") {
      // Escape then Tab leaves the editor — the standard release for a
      // text control that otherwise captures Tab (no focus trap).
      if (tabReleasedRef.current || event.altKey || event.ctrlKey || event.metaKey) { tabReleasedRef.current = false; return; }
      event.preventDefault();
      // Tab walks the fields (the value selected, so typing replaces it); indentation is structure.
      const next = diagramsSourceSlotStep(slots, event.shiftKey ? el.selectionStart : el.selectionEnd, event.shiftKey ? -1 : 1);
      if (next) selectSlot(el, next);
      return;
    }
    tabReleasedRef.current = false;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    // A cycle slot lists its choices on Enter and changes with Space/Up/Down;
    // every other key is plain typing (the `beforeinput` guard vets it) or
    // caret movement (`onSelect` redirects it).
    if (slot?.kind === "cycle") {
      if (event.key === "Enter") { event.preventDefault(); selectRef.current?.focus(); return; }
      if (event.key === " " || event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        cycleSlot(el, slot, event.key === "ArrowUp" ? -1 : 1);
      }
    }
  };

  const onScroll = () => {
    const el = textareaRef.current;
    if (!el) return;
    if (layerRef.current) layerRef.current.style.transform = `translate(${-el.scrollLeft}px, ${-el.scrollTop}px)`;
    if (gutterRef.current) gutterRef.current.style.transform = `translateY(${-el.scrollTop}px)`;
    if (completion) setCompletion(null);
    if (choices !== null) setChoices(null);
    setScrollTick((tick) => tick + 1);
  };
  // The list follows the caret's field: a caret that leaves it closes it.
  const choiceStart = choiceSlot?.start;
  useEffect(() => { setChoices(null); }, [choiceStart]);

  const gutterChars = Math.max(2, String(lineCount).length);
  const grouped = snippets.filter((s) => s.group !== undefined);
  const plain = snippets.filter((s) => s.group === undefined);
  const groupLabel = grouped[0]?.group;

  const jumpToError = () => { if (errorLine !== undefined) jumpToLine(errorLine); };

  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  const listId = `${id}-completions`;
  const menuId = `${id}-shapes`;
  const choicesId = `${id}-choices`;
  /** One tile per choice — the SAME widget for the toolbar's node menu and a cycle slot's list, so a shape looks the same wherever it is offered. */
  const tile = (item: Choice, extra: { readonly role: string; readonly id?: string; readonly current?: boolean; readonly active?: boolean; readonly title?: string; readonly onPick: () => void }) =>
    <button type="button" role={extra.role} key={item.value} id={extra.id} className={`diagrams-editor-shape${extra.current ? " is-current" : ""}${extra.active ? " is-active" : ""}`}
      title={extra.title} aria-selected={extra.role === "option" ? extra.current : undefined}
      onMouseDown={extra.role === "option" ? (event) => event.preventDefault() : undefined} onClick={extra.onPick}>
      {item.shape && <pre className="diagrams-editor-shape-preview" aria-hidden="true">{previews[item.shape] ?? ""}</pre>}
      <span className="diagrams-editor-shape-label">{item.label}</span>
      {item.syntax && <code className="diagrams-editor-shape-syntax">{item.syntax}</code>}
    </button>;
  // The ▾ trigger and the list sit after the active choice's LAST character
  // (a shape's closer, a JSON value's closing quote), never over its text.
  /**
   * Where the `<select>` sits. `caretPixel().top` is the TOP of the field's
   * own line, so no line offset is applied — it used to subtract one line,
   * which put an invisible control a row ABOVE the field and made a click on
   * the field hit nothing.
   *
   * A CYCLE field (shape, arrow, direction) is not typeable — the editor
   * refuses characters in it — so the select COVERS its whole span and the
   * first click opens the platform menu. An `id` field IS typeable (a brand
   * new id must be possible), so its select sits just after the field and
   * leaves the text itself to the caret.
   */
  const choiceAnchor = dropdownSlot ? (() => {
    const end = dropdownSlot.pair ? dropdownSlot.pair.end : dropdownSlot.end;
    const after = caretPixel(draft[end] === '"' ? end + 1 : end);
    if (!choiceSlot) return { ...after, width: undefined as number | undefined };
    const from = caretPixel(dropdownSlot.start);
    return { top: from.top, left: from.left, width: Math.max(after.left - from.left, 8) };
  })() : null;
  const choiceLine = choiceSlot ? lineColumnOf(draft, choiceSlot.start).line : 0;
  const editorHeight = textareaRef.current?.clientHeight ?? 0;
  // Below the field when it sits in the upper half, above it otherwise — inside the editor box either way.
  const choicesBelow = choiceAnchor ? choiceAnchor.top < editorHeight / 2 : true;
  const helpText = refusal ? null
    : diagnostic ? `${errorLine !== undefined ? `Line ${errorLine} is free to edit until it parses` : "Nothing parses yet — every line is free to edit until it does"}`
    : activeSlot ? (activeSlot.kind === "cycle" ? ` · ${CYCLE_HOW}` : "") + " · Tab next field · Enter next field · Escape then Tab leaves the editor"
    : "Click a field to edit it · Tab moves between fields · dashed fields are choices with a ▾ list · Insert adds statements";
  return <div className="diagrams-editor-wrap">
    <div className="diagrams-editor-tools" role="toolbar" aria-label="Insert">
      <span className="diagrams-editor-tools-label" aria-hidden="true">Insert</span>
      {groupLabel && <div className="diagrams-editor-menu" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setMenuOpen(false); }}
        onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); setMenuOpen(false); menuTriggerRef.current?.focus(); } }}>
        <button type="button" ref={menuTriggerRef} className={`diagrams-editor-tool${menuOpen ? " is-active" : ""}`} aria-haspopup="menu" aria-expanded={menuOpen} aria-controls={menuId}
          onClick={() => setMenuOpen((open) => !open)}>+ {groupLabel} ▾</button>
        {menuOpen && <div className="diagrams-editor-shapes" role="menu" id={menuId} aria-label={`${groupLabel} shapes`}>
          {grouped.map((snippet) => tile({ value: snippet.id, label: snippet.label, syntax: snippet.title, shape: snippet.shape }, { role: "menuitem", title: snippet.title, onPick: () => insertSnippet(snippet) }))}
        </div>}
      </div>}
      {plain.map((snippet) => <button type="button" key={snippet.id} className="diagrams-editor-tool" title={`Add: ${snippet.title}`} onClick={() => insertSnippet(snippet)}>+ {snippet.label}</button>)}
    </div>
    <div className={`diagrams-editor diagrams-editor--${dialect}`} style={{ "--diagrams-editor-gutter": `${gutterChars + 2}ch` } as CSSProperties}>
      <div className="diagrams-editor-gutter" aria-hidden="true" ref={gutterRef}>
        {tokens.map((_, index) => <span key={index} className={index + 1 === errorLine ? "is-error" : undefined}>{index + 1}</span>)}
      </div>
      <div className="diagrams-editor-layer" aria-hidden="true" ref={layerRef}>
        {errorLine !== undefined && <div className="diagrams-editor-errline" style={{ top: (errorLine - 1) * DIAGRAMS_EDITOR_LINE_PX }} />}
        {/* Every field, faintly; the one under the caret, plainly — "what
         *  am I editing" answered at a glance. `ch` units track the cell
         *  width of the shared monospace font, so no measurement is needed. */}
        {slots.map((slot, index) => {
          const { line, col } = lineColumnOf(draft, slot.start);
          const width = lineColumnOf(draft, slot.end).col - col;
          const active = slot === activeSlot;
          return <div key={index} className={`diagrams-editor-slot${active ? " is-active" : ""}${active && refusal ? " is-refused" : ""}${slot.kind === "cycle" ? " is-cycle" : ""}${slot.role === "repair" ? " is-repair" : ""}${highlighted.has(slot) ? " is-highlight" : ""}`}
            style={{ top: (line - 1) * DIAGRAMS_EDITOR_LINE_PX, left: `calc(var(--diagrams-editor-gutter) + var(--diagrams-editor-pad) + ${col}ch)`, width: `${Math.max(width, 0.5)}ch` }} />;
        })}
        <pre className="diagrams-editor-highlight">
          {tokens.map((line, index) => <span key={index} className="diagrams-editor-line">
            {line.map((token, tokenIndex) => <span key={tokenIndex} className={`diagrams-tok-${token.kind}`}>{token.text}</span>)}
            {index < tokens.length - 1 ? "\n" : ""}
          </span>)}
        </pre>
      </div>
      <span className="diagrams-editor-measure" aria-hidden="true" ref={measureRef}>MMMMMMMMMM</span>
      <textarea
        ref={textareaRef} id={id} className="diagrams-source diagrams-editor-input" aria-label={label}
        aria-describedby={diagnostic ? `${errorId} ${helpId}` : helpId} aria-invalid={diagnostic ? true : undefined}
        aria-autocomplete="list" aria-expanded={completion !== null || choices !== null} aria-controls={completion ? listId : choices !== null ? choicesId : undefined}
        aria-activedescendant={completion ? `${listId}-${completion.index}` : choices !== null ? `${choicesId}-${choices}` : undefined}
        value={draft} onKeyDown={onKeyDown} onScroll={onScroll} onSelect={onSelect} onKeyUp={onSelect} onMouseUp={onSelect}
        // The caret rides with the edit itself, not only with the key/select
        // events after it: an edit re-derives the slot map, and the active
        // field (hence the marked node) must be read against the NEW map.
        onChange={(event) => { setCaret([event.target.selectionStart, event.target.selectionEnd]); update(event.target.value, event.target.selectionStart); }}
        onBlur={() => { setCompletion(null); setChoices(null); if (timerRef.current !== null) commit(draft); }}
        spellCheck={false} autoCapitalize="off" autoCorrect="off" autoComplete="off" wrap="off"
      />
      {completion && <ul className="diagrams-editor-completions" role="listbox" id={listId} aria-label="Matching ids" style={{ top: completion.top + DIAGRAMS_EDITOR_LINE_PX, left: completion.left }}>
        {completion.items.map((item, index) => <li key={item.id} id={`${listId}-${index}`} role="option" aria-selected={index === completion.index}
          className={`diagrams-editor-completion${index === completion.index ? " is-active" : ""}`}
          onMouseDown={(event) => event.preventDefault()} onClick={() => acceptCompletion(completion, index)}>
          <span className="diagrams-editor-completion-id">{item.id}</span>
          {item.label && item.label !== item.id && <span className="diagrams-editor-completion-label">{item.label}</span>}
        </li>)}
      </ul>}
      {/* A choice field gets a REAL `<select>`, not a bespoke popover. USER
       *  FEEDBACK, verbatim: "the dropdowns are a nightmare, I wanted a true
       *  dropdown like a real one format, not that custom nightmare on top of
       *  the ui". A native control brings the platform's own menu, keyboard,
       *  type-ahead and touch behaviour for free; the cost is that an
       *  `<option>` renders text only, so a shape's live preview moves into
       *  the option's own text rather than a rendered swatch. It sits ON the
       *  field, sized to it, and writes through the SAME `chooseOption` slot
       *  edit the keyboard path uses — never a second edit path. */}
      {/* A `<select>` over EVERY cycle field in the text, not only the one
       *  under the caret: a cycle field is not typeable, so the control can
       *  own its span and the FIRST click opens the platform menu. Caret-only
       *  rendering meant a click just moved the caret and the reader had to
       *  click again — USER FEEDBACK, verbatim: "im clicking here and it
       *  doesn't open man". Transparent, so the highlighted text shows
       *  through; the menu itself is the platform's. */}
      {cycleFields.map(({ slot, ordinal }) => {
        const from = caretPixel(slot.start);
        // The control covers its OWN field and nothing else. A Mermaid shape
        // field is the opener alone (`[`) and carries its closer as `pair`,
        // which is what a CHOICE rewrites — not what the control occupies:
        // sizing through `pair.end` laid the shape menu over `[Alpha]`
        // entire, so a node's label could not be clicked, dragged over or
        // caret-placed at all. A JSON value keeps its closing quote, which
        // sits inside no slot but belongs to the same field.
        const endOffset = draft[slot.end] === '"' ? slot.end + 1 : slot.end;
        const width = Math.max(caretPixel(endOffset).left - from.left, 4);
        const held = slot.options![diagramsSourceSlotOptionIndex(slot, draft)] ?? slot.options![0]!;
        return <select key={`${slot.role}-${ordinal}`} ref={slot === dropdownSlot ? selectRef : undefined}
          className="diagrams-editor-choice-select" aria-label={`${slot.role} choices`}
          style={{ top: from.top, left: from.left, width }}
          value={held}
          onChange={(event) => { const el = textareaRef.current; if (el) chooseOption(el, slot, held, event.target.value); }}>
          {slot.options!.map((option) => {
            const choice = diagramsChoiceOf(form, slot, option);
            // An option that IS its own glyph needs no prose: an arrow reads
            // as `-->`, not "Arrow   -->". USER FEEDBACK, verbatim: "it
            // shouldn't say arrow ---> come on, just the arrows". A shape or
            // a direction still needs its name — `[` and `TB` do not explain
            // themselves — and a shape keeps its live preview.
            const selfEvident = !slot.pair && !/[A-Za-z0-9]/.test(option);
            if (selfEvident) return <option key={option} value={option}>{option}</option>;
            const preview = choice.shape ? (previews[choice.shape] ?? "").split("\n").find((l) => l.trim()) : undefined;
            return <option key={option} value={option}>{[choice.label, choice.syntax, preview?.trim()].filter(Boolean).join("   ")}</option>;
          })}
        </select>;
      })}
      {/* An `id` field IS typeable (a brand-new id must stay possible), so its
       *  own select sits just AFTER the field and leaves the text to the caret. */}
      {idSlot && choiceAnchor && selectOptions.length > 1 && <select ref={selectRef} className="diagrams-editor-choice-select is-adjacent"
        aria-label={`${idSlot.role} choices`}
        style={{ top: choiceAnchor.top, left: choiceAnchor.left }}
        value={draft.slice(idSlot.start, idSlot.end)}
        onChange={(event) => { const el = textareaRef.current; if (el) chooseOption(el, idSlot, draft.slice(idSlot.start, idSlot.end), event.target.value); }}>
        {selectOptions.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>}
    </div>
    {diagnostic && <p className="diagrams-readout diagrams-error diagrams-editor-status" role="alert" id={errorId}>
      <button type="button" className="diagrams-editor-jump" onClick={jumpToError} disabled={errorLine === undefined}
        title={errorLine === undefined ? "The parser reports no line for this error." : `Move the caret to line ${errorLine}`}>
        {errorLine === undefined ? "Line unknown" : `Line ${errorLine}`}
      </button>
      {diagnostic.code && <code className="diagrams-editor-code">{diagnostic.code}</code>}
      <span className="diagrams-editor-message">{diagnostic.message}</span>
      {diagnostic.hint && <span className="diagrams-editor-hint">{diagnostic.hint}</span>}
    </p>}
    {/* ONE line under the editor, contextual: a refusal's reason while it
     *  flashes, else the repair note, else the field under the caret and
     *  the keys that matter for it, else (nothing focused yet) how to start. */}
    <p className="diagrams-readout diagrams-editor-help" id={helpId} role="status">
      {refusal ? <span className="diagrams-editor-refusal" key={refusal.at}>{refusal.reason}</span> : <>
        {diagnostic && <span className="diagrams-editor-repair-note">{helpText}{activeSlot ? " · " : ""}</span>}
        {activeSlot && <span className="diagrams-editor-field">{activeSlot.role === "repair" ? "Repairing this line" : `Editing ${activeSlot.role}`}</span>}
        {!diagnostic && helpText}
      </>}
    </p>
  </div>;
});
