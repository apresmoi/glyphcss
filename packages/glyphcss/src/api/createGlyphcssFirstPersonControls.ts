/**
 * createGlyphcssFirstPersonControls — first-person camera input for a GlyphcssScene.
 *
 * Mouse-drag looks around (rotX/rotY). WASD or arrow keys move forward/backward/strafe.
 * Mirrors polycss's createPolyFirstPersonControls semantics for the ASCII rasterizer.
 */

import type { GlyphcssSceneHandle } from "./createGlyphcssScene";
import type { Vec3 } from "@layoutit/polycss-core";

export interface GlyphcssFirstPersonControlsOptions {
  drag?: boolean;
  keyboard?: boolean;
  moveSpeed?: number;
  lookSpeed?: number;
  invert?: boolean | number;
}

export interface GlyphcssFirstPersonControlsHandle {
  update(opts: GlyphcssFirstPersonControlsOptions): void;
  pause(): void;
  resume(): void;
  destroy(): void;
}

export function createGlyphcssFirstPersonControls(
  scene: GlyphcssSceneHandle,
  options: GlyphcssFirstPersonControlsOptions = {},
): GlyphcssFirstPersonControlsHandle {
  const host = scene.host;
  let drag = options.drag ?? true;
  let keyboard = options.keyboard ?? true;
  let moveSpeed = options.moveSpeed ?? 0.05;
  let lookSpeed = options.lookSpeed ?? 0.004;
  let invertFactor = resolveInvert(options.invert);
  let stopped = false;
  let activePointerId: number | null = null;
  let pointer = { x: 0, y: 0 };
  const keys = new Set<string>();
  let rafId: ReturnType<typeof requestAnimationFrame> | null = null;

  const camera = scene.camera;

  function onPointerDown(e: PointerEvent): void {
    if (!drag || stopped) return;
    if (activePointerId !== null) return;
    e.preventDefault();
    activePointerId = e.pointerId;
    pointer = { x: e.clientX, y: e.clientY };
    try { (e.target as Element).setPointerCapture(e.pointerId); } catch { /* ignore */ }
  }

  function onPointerMove(e: PointerEvent): void {
    if (activePointerId === null || e.pointerId !== activePointerId) return;
    if (!drag || stopped) return;
    e.preventDefault();
    const dx = e.clientX - pointer.x;
    const dy = e.clientY - pointer.y;
    pointer = { x: e.clientX, y: e.clientY };
    camera.rotY = camera.rotY - dx * lookSpeed * invertFactor;
    camera.rotX = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, camera.rotX + dy * lookSpeed * invertFactor));
    scene.rerender();
  }

  function onPointerUp(e: PointerEvent): void {
    if (activePointerId !== e.pointerId) return;
    activePointerId = null;
    try { (e.target as Element).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  }

  function onKeyDown(e: KeyboardEvent): void { if (keyboard && !stopped) keys.add(e.key.toLowerCase()); }
  function onKeyUp(e: KeyboardEvent): void { keys.delete(e.key.toLowerCase()); }

  function keyTick(): void {
    if (stopped || !keyboard || keys.size === 0) return;
    const t = camera.target;
    const cosY = Math.cos(camera.rotY), sinY = Math.sin(camera.rotY);
    let moved = false;
    if (keys.has("w") || keys.has("arrowup")) {
      camera.target = [t[0] - sinY * moveSpeed, t[1] - cosY * moveSpeed, t[2]] as Vec3;
      moved = true;
    }
    if (keys.has("s") || keys.has("arrowdown")) {
      camera.target = [t[0] + sinY * moveSpeed, t[1] + cosY * moveSpeed, t[2]] as Vec3;
      moved = true;
    }
    if (keys.has("a") || keys.has("arrowleft")) {
      camera.target = [t[0] - cosY * moveSpeed, t[1] + sinY * moveSpeed, t[2]] as Vec3;
      moved = true;
    }
    if (keys.has("d") || keys.has("arrowright")) {
      camera.target = [t[0] + cosY * moveSpeed, t[1] - sinY * moveSpeed, t[2]] as Vec3;
      moved = true;
    }
    if (moved) scene.rerender();
  }

  function animTick(): void {
    if (stopped) return;
    keyTick();
    rafId = requestAnimationFrame(animTick);
  }

  function attach(): void {
    host.addEventListener("pointerdown", onPointerDown);
    host.addEventListener("pointermove", onPointerMove);
    host.addEventListener("pointerup", onPointerUp);
    host.addEventListener("pointercancel", onPointerUp);
    if (keyboard) {
      host.ownerDocument?.addEventListener("keydown", onKeyDown);
      host.ownerDocument?.addEventListener("keyup", onKeyUp);
    }
    host.style.touchAction = "none";
    host.style.userSelect = "none";
    if (typeof requestAnimationFrame !== "undefined") rafId = requestAnimationFrame(animTick);
  }

  function detach(): void {
    host.removeEventListener("pointerdown", onPointerDown);
    host.removeEventListener("pointermove", onPointerMove);
    host.removeEventListener("pointerup", onPointerUp);
    host.removeEventListener("pointercancel", onPointerUp);
    host.ownerDocument?.removeEventListener("keydown", onKeyDown);
    host.ownerDocument?.removeEventListener("keyup", onKeyUp);
    host.style.touchAction = "";
    host.style.userSelect = "";
    if (rafId !== null) { if (typeof cancelAnimationFrame !== "undefined") cancelAnimationFrame(rafId); rafId = null; }
    keys.clear();
  }

  attach();

  return {
    update(opts: GlyphcssFirstPersonControlsOptions): void {
      drag = opts.drag ?? drag;
      keyboard = opts.keyboard ?? keyboard;
      moveSpeed = opts.moveSpeed ?? moveSpeed;
      lookSpeed = opts.lookSpeed ?? lookSpeed;
      invertFactor = resolveInvert(opts.invert);
    },
    pause(): void { if (stopped) return; stopped = true; detach(); activePointerId = null; },
    resume(): void { if (!stopped) return; stopped = false; attach(); },
    destroy(): void { if (!stopped) detach(); stopped = true; },
  };
}

function resolveInvert(invert: boolean | number | undefined): number {
  if (invert === undefined || invert === false) return 1;
  if (invert === true) return -1;
  return invert;
}
