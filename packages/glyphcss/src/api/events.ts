/**
 * Typed DOM event aliases for mesh interaction.
 *
 * `meshId` is populated when the event originates from a hit-layer lookup —
 * it carries the string id of the mesh that was hit (the `id` prop / transform
 * `id`).
 *
 * TODO(hit-layer): meshId will be set automatically once the rasterizer
 * hit-map and per-polygon raycasting are wired into the hit-layer dispatch.
 * Until then, consumers receive plain DOM events with `meshId` left undefined.
 */

export type GlyphPointerEvent = PointerEvent & { meshId?: string };
export type GlyphMouseEvent = MouseEvent & { meshId?: string };
export type GlyphWheelEvent = WheelEvent & { meshId?: string };
export type GlyphEventHandler<E = Event> = (event: E) => void;
