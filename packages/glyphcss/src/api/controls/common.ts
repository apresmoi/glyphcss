/**
 * Shared controls event surface — mirrors voxcss `controls/common.ts`'s event
 * pieces (the camera snapshot + `change`/`start`/`end` listener registry). The
 * wheel/anim/options helpers are inlined per-control in glyphcss, so only the
 * event types + registry live here. Used by orbit / map / first-person controls.
 */
import type { GlyphSceneHandle } from "../createGlyphScene";
import type { Vec3 } from "@glyphcss/core";

export interface GlyphControlsCamera {
  rotX: number;
  rotY: number;
  zoom: number;
  target: Vec3;
  distance: number;
}

export interface GlyphControlsChangeEvent {
  type: "change";
  camera: GlyphControlsCamera;
}

export interface GlyphControlsInteractionEvent {
  type: "start" | "end";
  camera: GlyphControlsCamera;
}

export type GlyphControlsEvent = GlyphControlsChangeEvent | GlyphControlsInteractionEvent;
export type GlyphControlsListener<E extends GlyphControlsEvent = GlyphControlsEvent> = (event: E) => void;

/** Methods every control handle exposes for `change`/`start`/`end` subscription. */
export interface GlyphControlsEventTarget {
  addEventListener<T extends GlyphControlsEvent["type"]>(
    type: T,
    listener: GlyphControlsListener<Extract<GlyphControlsEvent, { type: T }>>,
  ): void;
  removeEventListener<T extends GlyphControlsEvent["type"]>(
    type: T,
    listener: GlyphControlsListener<Extract<GlyphControlsEvent, { type: T }>>,
  ): void;
  hasEventListener<T extends GlyphControlsEvent["type"]>(
    type: T,
    listener: GlyphControlsListener<Extract<GlyphControlsEvent, { type: T }>>,
  ): boolean;
}

export interface ListenerRegistry {
  changeListeners: GlyphControlsListener<GlyphControlsChangeEvent>[];
  startListeners: GlyphControlsListener<GlyphControlsInteractionEvent>[];
  endListeners: GlyphControlsListener<GlyphControlsInteractionEvent>[];
  listenerArray: (type: GlyphControlsEvent["type"]) => GlyphControlsListener[];
  emitChange: (snapshot: () => GlyphControlsCamera) => void;
  emitInteraction: (type: "start" | "end", snapshot: () => GlyphControlsCamera) => void;
}

export function makeListenerRegistry(): ListenerRegistry {
  const changeListeners: GlyphControlsListener<GlyphControlsChangeEvent>[] = [];
  const startListeners: GlyphControlsListener<GlyphControlsInteractionEvent>[] = [];
  const endListeners: GlyphControlsListener<GlyphControlsInteractionEvent>[] = [];

  function listenerArray(type: GlyphControlsEvent["type"]): GlyphControlsListener[] {
    if (type === "change") return changeListeners as GlyphControlsListener[];
    if (type === "start") return startListeners as GlyphControlsListener[];
    return endListeners as GlyphControlsListener[];
  }

  function emitChange(snapshot: () => GlyphControlsCamera): void {
    if (changeListeners.length === 0) return;
    const event: GlyphControlsChangeEvent = { type: "change", camera: snapshot() };
    for (const fn of changeListeners.slice()) {
      try { fn(event); } catch (err) { console.error("[glyphcss] controls 'change' listener threw:", err); }
    }
  }

  function emitInteraction(type: "start" | "end", snapshot: () => GlyphControlsCamera): void {
    const list = type === "start" ? startListeners : endListeners;
    if (list.length === 0) return;
    const event: GlyphControlsInteractionEvent = { type, camera: snapshot() };
    for (const fn of list.slice()) {
      try { fn(event); } catch (err) { console.error(`[glyphcss] controls '${type}' listener threw:`, err); }
    }
  }

  return { changeListeners, startListeners, endListeners, listenerArray, emitChange, emitInteraction };
}

export function makeCameraSnapshot(scene: GlyphSceneHandle): () => GlyphControlsCamera {
  return (): GlyphControlsCamera => {
    const c = scene.camera;
    const t = c.target ?? [0, 0, 0];
    return {
      rotX: c.rotX ?? 0,
      rotY: c.rotY ?? 0,
      zoom: c.zoom ?? 1,
      target: [t[0], t[1], t[2]],
      distance: c.distance ?? 0,
    };
  };
}

/** Build the three `addEventListener`/`removeEventListener`/`hasEventListener`
 *  handle methods over a registry. */
export function makeEventMethods(reg: ListenerRegistry): GlyphControlsEventTarget {
  return {
    addEventListener(type, listener) {
      const arr = reg.listenerArray(type);
      if (!arr.includes(listener as GlyphControlsListener)) arr.push(listener as GlyphControlsListener);
    },
    removeEventListener(type, listener) {
      const arr = reg.listenerArray(type);
      const i = arr.indexOf(listener as GlyphControlsListener);
      if (i >= 0) arr.splice(i, 1);
    },
    hasEventListener(type, listener) {
      return reg.listenerArray(type).includes(listener as GlyphControlsListener);
    },
  };
}
