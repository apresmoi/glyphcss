// Message indices cannot distinguish a note before a frame from one inside it.
// Keep Mermaid statement order through validation/paging without changing the JSON IR.
const orders = new WeakMap<object, number>();
export function glyphSequenceAuthoredOrder(item: object): number { return orders.get(item) ?? Infinity; }
export function orderGlyphSequenceItem<T extends object>(item: T, order: number): T {
  if (Number.isFinite(order)) orders.set(item, order);
  return item;
}
