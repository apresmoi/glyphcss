/**
 * ONE notion of selection between the rendered graph and its source: an
 * ITEM (a node by id, an edge by its endpoints) is what a hotspot on the
 * render names and what the field under the editor's caret belongs to.
 * `diagramsSourceSlotOfItem` is the click direction (hotspot → the field
 * to edit, the LABEL by default because renaming is the common intent);
 * `diagramsSourceItemOfSlot` is the reverse (caret → the node or edge the
 * render should mark). Both read the slot map (`diagramsSourceSlots.ts`),
 * never the text on their own, so what is selectable is exactly what is
 * editable. Graph dialects only (Mermaid flowchart, graph JSON) — the
 * sequence and lane renders expose no per-item placement to pair with.
 */
import type { DiagramsSourceSlot } from "./diagramsSourceSlots";
import type { DiagramsSourceDialect } from "./diagramsSourceTokens";

export type DiagramsSourceItem =
  | { readonly kind: "node"; readonly id: string }
  | { readonly kind: "edge"; readonly from: string; readonly to: string };

export function diagramsSourceItemKey(item: DiagramsSourceItem | null | undefined): string | null {
  return !item ? null : item.kind === "node" ? `node:${item.id}` : `edge:${item.from}>${item.to}`;
}

const MERMAID_ENDPOINT_ROLES = new Set(["node id", "edge endpoint"]);
const slotText = (text: string, slot: DiagramsSourceSlot) => text.slice(slot.start, slot.end);
const lineOf = (text: string, offset: number) => {
  let line = 0;
  for (let i = 0; i < offset; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
};

/** The slots of each source line, in order — Mermaid statements are one per line. */
function mermaidLines(slots: readonly DiagramsSourceSlot[], text: string): DiagramsSourceSlot[][] {
  const lines: DiagramsSourceSlot[][] = [];
  for (const slot of slots) {
    const line = lineOf(text, slot.start);
    (lines[line] ??= []).push(slot);
  }
  return lines;
}

/**
 * Mermaid: what each slot on a line belongs to. An endpoint (and the shape
 * and label right after it) is that node; an arrow (and the edge label
 * right after it) is the edge from the endpoint before it to the one after
 * it, so `a --> b --> c` resolves per link. A subgraph's own id and label
 * belong to nothing the render marks.
 */
function mermaidItemOf(
  line: readonly DiagramsSourceSlot[],
  text: string,
  slot: DiagramsSourceSlot,
): DiagramsSourceItem | undefined {
  const index = line.indexOf(slot);
  if (index < 0) return undefined;
  const endpointBefore = (from: number) => {
    for (let i = from; i >= 0; i--) if (MERMAID_ENDPOINT_ROLES.has(line[i]!.role)) return line[i]!;
    return undefined;
  };
  const endpointAfter = (from: number) => {
    for (let i = from; i < line.length; i++) if (MERMAID_ENDPOINT_ROLES.has(line[i]!.role)) return line[i]!;
    return undefined;
  };
  if (MERMAID_ENDPOINT_ROLES.has(slot.role)) return { kind: "node", id: slotText(text, slot) };
  if (slot.role === "arrow" || slot.role === "edge label") {
    const from = endpointBefore(index - 1),
      to = endpointAfter(index + 1);
    return from && to ? { kind: "edge", from: slotText(text, from), to: slotText(text, to) } : undefined;
  }
  if (slot.role === "shape" || slot.role === "label") {
    // The owner is the id right before, unless an arrow or a subgraph keyword sits between.
    for (let i = index - 1; i >= 0; i--) {
      const role = line[i]!.role;
      if (MERMAID_ENDPOINT_ROLES.has(role)) return { kind: "node", id: slotText(text, line[i]!) };
      if (role === "arrow" || role === "subgraph id") return undefined;
    }
  }
  return undefined;
}

/** Braces between two offsets that lie OUTSIDE any slot — a `{` inside a label is text, not structure. */
function jsonDepthBetween(text: string, slots: readonly DiagramsSourceSlot[], from: number, to: number): number {
  let depth = 0;
  let s = 0;
  for (let i = from; i < to; i++) {
    while (s < slots.length && slots[s]!.end <= i) s++;
    if (s < slots.length && slots[s]!.start <= i && i < slots[s]!.end) continue;
    const c = text[i];
    if (c === "{") depth++;
    else if (c === "}") depth--;
  }
  return depth;
}
/** The direct slots of the JSON object enclosing `offset` — nested objects' slots excluded. */
function jsonObjectSlots(slots: readonly DiagramsSourceSlot[], text: string, offset: number): DiagramsSourceSlot[] {
  let start = -1;
  for (let i = offset - 1, depth = 0; i >= 0; i--) {
    const c = text[i];
    if (slots.some((slot) => slot.start <= i && i < slot.end)) continue;
    if (c === "}") depth++;
    else if (c === "{") {
      if (depth === 0) {
        start = i;
        break;
      }
      depth--;
    }
  }
  if (start < 0) return [];
  let end = text.length;
  for (let i = start + 1, depth = 0; i < text.length; i++) {
    const c = text[i];
    if (slots.some((slot) => slot.start <= i && i < slot.end)) continue;
    if (c === "{") depth++;
    else if (c === "}") {
      if (depth === 0) {
        end = i;
        break;
      }
      depth--;
    }
  }
  return slots.filter(
    (slot) => slot.start > start && slot.end <= end && jsonDepthBetween(text, slots, start + 1, slot.start) === 0,
  );
}
function jsonItemOf(object: readonly DiagramsSourceSlot[], text: string): DiagramsSourceItem | undefined {
  const field = (role: string) => object.find((slot) => slot.role === role);
  const id = field('"id"');
  if (id) return { kind: "node", id: slotText(text, id) };
  const from = field('"from"'),
    to = field('"to"');
  return from && to ? { kind: "edge", from: slotText(text, from), to: slotText(text, to) } : undefined;
}

/** The node or edge the field under the caret belongs to, if the render can mark one. */
export function diagramsSourceItemOfSlot(
  slots: readonly DiagramsSourceSlot[],
  text: string,
  dialect: DiagramsSourceDialect,
  slot: DiagramsSourceSlot,
): DiagramsSourceItem | undefined {
  if (slot.role === "repair") return undefined;
  if (dialect === "mermaid") {
    const line = mermaidLines(slots, text)[lineOf(text, slot.start)] ?? [];
    return mermaidItemOf(line, text, slot);
  }
  if (dialect === "json") return jsonItemOf(jsonObjectSlots(slots, text, slot.start), text);
  return undefined;
}

/**
 * An item's editable fields: `anchor` is where the item is declared (a
 * node's id at its first mention — the one with a shape when it has one,
 * `a --> b[Beta]` declares b's on an edge line; an edge's arrow; a JSON
 * node's `"id"` / edge's `"from"`), `label` its label field if it has one,
 * `choice` its cycle field (a node's shape, an edge's arrow or JSON style).
 * A missing `label`/`choice` is inserted right after `anchor` by the editor.
 */
export interface DiagramsSourceItemFields {
  readonly anchor: DiagramsSourceSlot;
  readonly label?: DiagramsSourceSlot;
  readonly choice?: DiagramsSourceSlot;
}

export function diagramsSourceItemFields(
  slots: readonly DiagramsSourceSlot[],
  text: string,
  dialect: DiagramsSourceDialect,
  item: DiagramsSourceItem,
): DiagramsSourceItemFields | undefined {
  if (dialect === "mermaid") {
    let fallback: DiagramsSourceSlot | undefined;
    for (const line of mermaidLines(slots, text)) {
      if (!line) continue;
      for (let i = 0; i < line.length; i++) {
        const slot = line[i]!;
        if (item.kind === "node") {
          if (!MERMAID_ENDPOINT_ROLES.has(slot.role) || slotText(text, slot) !== item.id) continue;
          if (line[i + 1]?.role === "shape" && line[i + 2]?.role === "label")
            return { anchor: slot, choice: line[i + 1], label: line[i + 2] };
          if (!fallback || (slot.role === "node id" && fallback.role !== "node id")) fallback = slot;
        } else if (slot.role === "arrow") {
          const from = line
            .slice(0, i)
            .reverse()
            .find((s) => MERMAID_ENDPOINT_ROLES.has(s.role));
          const rest = line.slice(i + 1);
          const to = rest.find((s) => MERMAID_ENDPOINT_ROLES.has(s.role));
          if (!from || !to || slotText(text, from) !== item.from || slotText(text, to) !== item.to) continue;
          return {
            anchor: slot,
            choice: slot,
            label: rest.slice(0, rest.indexOf(to)).find((s) => s.role === "edge label"),
          };
        }
      }
    }
    return fallback ? { anchor: fallback } : undefined;
  }
  if (dialect === "json") {
    for (const slot of slots) {
      const role = item.kind === "node" ? '"id"' : '"from"';
      if (slot.role !== role || slotText(text, slot) !== (item.kind === "node" ? item.id : item.from)) continue;
      const object = jsonObjectSlots(slots, text, slot.start);
      const to = object.find((s) => s.role === '"to"');
      if (item.kind === "edge" && (!to || slotText(text, to) !== item.to)) continue;
      // The anchor is where the item is DECLARED: a node's `"id"`, an edge's
      // `"from"` — its first field, and the one `slot` already matched. `to`
      // is only matched above to confirm this is the right edge object.
      return {
        anchor: slot,
        label: object.find((s) => s.role === '"label"'),
        choice: object.find((s) => s.role === (item.kind === "node" ? '"shape"' : '"style"')),
      };
    }
  }
  return undefined;
}

/** The field to select for an item: its label (renaming is the common intent), else where it is declared. */
export function diagramsSourceSlotOfItem(
  slots: readonly DiagramsSourceSlot[],
  text: string,
  dialect: DiagramsSourceDialect,
  item: DiagramsSourceItem,
): DiagramsSourceSlot | undefined {
  const fields = diagramsSourceItemFields(slots, text, dialect, item);
  return fields?.label ?? fields?.anchor;
}
