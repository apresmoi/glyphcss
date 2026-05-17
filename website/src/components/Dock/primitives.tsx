/**
 * lil-gui wrappers used by the per-folder Dock hooks.
 *
 * Why this file exists: `Dock.tsx` historically open-coded the entire lil-gui
 * tree in one ~900-line `useEffect`, mixing scaffolding (`gui.addFolder`,
 * `controller.add`, `.onChange`, `.updateDisplay`, `.disable`) with state
 * plumbing (reading every field of `sceneOptions` and pushing it back into
 * the corresponding controller). The split made folders impossible to reuse
 * and reorder.
 *
 * Each helper here:
 *   - takes the current value + an onChange callback,
 *   - creates a lil-gui controller on mount and destroys it on unmount,
 *   - keeps the displayed value in sync with the React-side value via a
 *     follow-up effect — callers just pass `state.foo` and the controller
 *     mirrors it automatically (no `setValue(...)` boilerplate per slot).
 *
 * The returned `DockController` is a ref-stable handle the hook can hold for
 * runtime mutations (`setEnabled`, `setVisible`, the underlying lil-gui
 * controller for inject-style customizations).
 */
import { useEffect, useRef, useState } from "react";
import { GUI, type Controller } from "lil-gui";

/** Handle returned by every primitive hook. Stable identity for the lifetime
 *  of the underlying lil-gui controller. */
export interface DockController<T = unknown> {
  /** Underlying lil-gui controller. Exposed so hooks can do advanced ops
   *  (e.g. dom-element injection of extra checkboxes). */
  readonly raw: Controller;
  /** Update the displayed value AND the controller's internal binding. The
   *  primitive hook also calls this automatically when the `value` arg
   *  changes between renders — most callers won't need to invoke it. */
  setValue(value: T): void;
  /** Toggle the controller's enabled state. `dim` controls whether lil-gui's
   *  visual "disabled" treatment is applied (true) or hidden (false — used
   *  for always-disabled read-only displays so they still read normally). */
  setEnabled(enabled: boolean, opts?: { dim?: boolean }): void;
  /** Hide/show the controller (folder collapses don't count — this fully
   *  removes the row from layout). */
  setVisible(visible: boolean): void;
}

/** Option controller adds runtime options() so dropdowns can refresh their
 *  list (e.g. animation clip names, placed-item lists). */
export interface DockOptionController<T extends string | number> extends DockController<T> {
  setOptions(options: Record<string, T>): void;
}

/** Mount a lil-gui root in `host` once and tear it down on unmount. The
 *  returned state is `null` on the first render and the GUI instance after.
 *  Use it as the `parent` arg to `useFolder`. */
export function useGui(
  hostRef: React.RefObject<HTMLElement | null>,
  options?: { width?: number; closeFolders?: boolean },
): GUI | null {
  const [gui, setGui] = useState<GUI | null>(null);
  // Captured at mount so changing the options object after the fact doesn't
  // recreate the GUI (which would lose every folder + controller added by
  // children).
  const optsRef = useRef(options);
  optsRef.current = options;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const o = optsRef.current;
    const instance = new GUI({
      autoPlace: false,
      container: host,
      width: o?.width ?? 360,
      closeFolders: o?.closeFolders ?? false,
    });
    instance.open();
    setGui(instance);
    return () => {
      instance.destroy();
      setGui(null);
    };
  }, [hostRef]);

  return gui;
}

/** Add a child folder to `parent` and remove it on unmount. Children call
 *  primitives against the returned folder reference. Returns `null` while
 *  the parent GUI isn't ready (first render). */
export function useFolder(
  parent: GUI | null,
  title: string,
  options?: { open?: boolean },
): GUI | null {
  const [folder, setFolder] = useState<GUI | null>(null);
  const optsRef = useRef(options);
  optsRef.current = options;

  useEffect(() => {
    if (!parent) return;
    const f = parent.addFolder(title);
    if (optsRef.current?.open === false) f.close();
    else f.open();
    setFolder(f);
    return () => {
      f.destroy();
      setFolder(null);
    };
  }, [parent, title]);

  return folder;
}

// ── Internal helpers ───────────────────────────────────────────────────────

/** Strip lil-gui's "disabled" class so a read-only display doesn't look
 *  grayed out. Used by `setEnabled(false, { dim: false })`. */
function applyEnabled(c: Controller, enabled: boolean, dim: boolean): void {
  if (enabled) c.enable();
  else {
    c.disable();
    if (!dim) c.domElement.classList.remove("disabled");
  }
}

/** Wrap a lil-gui `Controller` in our `DockController` interface. Owns the
 *  underlying `{ value }` proxy object lil-gui binds to. */
function makeDockController<T>(controller: Controller, proxy: { value: T }): DockController<T> {
  return {
    raw: controller,
    setValue(value) {
      proxy.value = value;
      controller.updateDisplay();
    },
    setEnabled(enabled, opts) {
      applyEnabled(controller, enabled, opts?.dim ?? true);
    },
    setVisible(visible) {
      if (visible) controller.show();
      else controller.hide();
    },
  };
}

/** Shared lifecycle: mount/sync/teardown for any single-value controller.
 *  `factory` is called once per mount to produce the controller; subsequent
 *  value changes go through `setValue` automatically. */
function useControllerLifecycle<T>(
  parent: GUI | null,
  label: string,
  value: T,
  onChange: (next: T) => void,
  factory: (parent: GUI, proxy: { value: T }, onChange: (next: T) => void) => Controller,
): DockController<T> | null {
  const [ctrl, setCtrl] = useState<DockController<T> | null>(null);
  // The latest onChange — controller closures capture this ref at creation
  // and re-read on every event so callers can pass fresh arrow functions
  // without recreating the controller every render.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!parent) return;
    const proxy = { value };
    const raw = factory(parent, proxy, (next) => onChangeRef.current(next));
    raw.name(label);
    const wrapper = makeDockController<T>(raw, proxy);
    setCtrl(wrapper);
    return () => {
      raw.destroy();
      setCtrl(null);
    };
    // Intentionally skip `value` and `onChange` — value is mirrored via the
    // follow-up sync effect; onChange is read through the ref above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parent, label]);

  // Mirror the React-side value into the controller. Cheap if unchanged
  // (setValue is just a property assign + updateDisplay).
  useEffect(() => {
    if (ctrl) ctrl.setValue(value);
  }, [ctrl, value]);

  return ctrl;
}

// ── Primitive hooks ────────────────────────────────────────────────────────

/** Boolean checkbox. */
export function useToggle(
  parent: GUI | null,
  label: string,
  value: boolean,
  onChange: (next: boolean) => void,
): DockController<boolean> | null {
  return useControllerLifecycle(parent, label, value, onChange, (folder, proxy, cb) =>
    folder.add(proxy, "value").onChange((v: boolean) => cb(v)),
  );
}

/** Numeric slider + number-input combo. `range.step` defaults to lil-gui's
 *  auto step. */
export function useSlider(
  parent: GUI | null,
  label: string,
  range: { min: number; max: number; step?: number },
  value: number,
  onChange: (next: number) => void,
): DockController<number> | null {
  // Range captured at mount — changing it would require destroying and re-
  // adding the controller. None of our uses change range at runtime.
  const rangeRef = useRef(range);
  rangeRef.current = range;
  return useControllerLifecycle(parent, label, value, onChange, (folder, proxy, cb) => {
    const r = rangeRef.current;
    const ctrl = folder.add(proxy, "value", r.min, r.max, r.step);
    ctrl.onChange((v: number) => cb(v));
    return ctrl;
  });
}

/** Dropdown bound to a record of `{ displayLabel: value }`. Returns a
 *  controller that exposes `setOptions` for runtime list changes. */
export function useOption<T extends string | number>(
  parent: GUI | null,
  label: string,
  options: Record<string, T>,
  value: T,
  onChange: (next: T) => void,
): DockOptionController<T> | null {
  const [ctrl, setCtrl] = useState<DockOptionController<T> | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // Options snapshot at mount — runtime changes go through `setOptions`.
  const initialOptionsRef = useRef(options);
  initialOptionsRef.current = options;

  useEffect(() => {
    if (!parent) return;
    const proxy = { value };
    const raw = parent.add(proxy, "value", initialOptionsRef.current).name(label);
    raw.onChange((v: T) => onChangeRef.current(v));
    const base = makeDockController<T>(raw, proxy);
    const wrapper: DockOptionController<T> = {
      ...base,
      setOptions(next) {
        // lil-gui's `.options(newOpts)` REPLACES the controller — the old
        // `raw` reference is destroyed. Returned controller swaps in.
        // Callers rarely need the new ref since `setValue/setEnabled` go
        // through this wrapper's closure; we just rebind internally.
        const replaced = (raw as unknown as { options: (o: Record<string, T>) => Controller }).options(next);
        replaced.onChange((v: T) => onChangeRef.current(v));
      },
    };
    setCtrl(wrapper);
    return () => {
      raw.destroy();
      setCtrl(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parent, label]);

  useEffect(() => {
    if (ctrl) ctrl.setValue(value);
  }, [ctrl, value]);

  return ctrl;
}

/** Color picker. lil-gui handles `#rrggbb` strings + named CSS colors. */
export function useColor(
  parent: GUI | null,
  label: string,
  value: string,
  onChange: (next: string) => void,
): DockController<string> | null {
  return useControllerLifecycle(parent, label, value, onChange, (folder, proxy, cb) =>
    folder.addColor(proxy, "value").onChange((v: string) => cb(v)),
  );
}

/** Action button — no value, just a click handler. Display label set via
 *  `name()`. */
export function useButton(
  parent: GUI | null,
  label: string,
  onClick: () => void,
): DockController<never> | null {
  const [ctrl, setCtrl] = useState<DockController<never> | null>(null);
  const onClickRef = useRef(onClick);
  onClickRef.current = onClick;

  useEffect(() => {
    if (!parent) return;
    const proxy = { value: (() => onClickRef.current()) as () => void };
    const raw = parent.add(proxy, "value").name(label);
    setCtrl(makeDockController<never>(raw, proxy as unknown as { value: never }));
    return () => {
      raw.destroy();
      setCtrl(null);
    };
  }, [parent, label]);

  return ctrl;
}

/** Always-disabled numeric display. Used for live metrics (DOM node count,
 *  sprite count, etc.) where the value is push-only from outside. The
 *  controller renders without the "disabled" CSS class so it still reads
 *  as a normal row. */
export function useReadonlyNumber(
  parent: GUI | null,
  label: string,
  value: number,
): DockController<number> | null {
  const [ctrl, setCtrl] = useState<DockController<number> | null>(null);

  useEffect(() => {
    if (!parent) return;
    const proxy = { value };
    const raw = parent.add(proxy, "value").name(label);
    const wrapper = makeDockController<number>(raw, proxy);
    wrapper.setEnabled(false, { dim: false });
    setCtrl(wrapper);
    return () => {
      raw.destroy();
      setCtrl(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parent, label]);

  useEffect(() => {
    if (ctrl) ctrl.setValue(value);
  }, [ctrl, value]);

  return ctrl;
}
