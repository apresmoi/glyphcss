/**
 * lil-gui wrappers used by the per-folder Dock hooks.
 *
 * Each helper takes the current value + an onChange callback, creates a
 * lil-gui controller on mount and destroys it on unmount, and keeps the
 * displayed value in sync with the React-side value automatically. Callers
 * just pass the current state value and the controller mirrors it without
 * extra `setValue(...)` boilerplate per slot.
 *
 * Ported from glyphcss primitives.tsx — glyphcss-specific metric labels and
 * ranges are the only divergence.
 */
import { useEffect, useRef, useState } from "react";
import { GUI, type Controller } from "lil-gui";

/** Handle returned by every primitive hook. Stable identity for the lifetime
 *  of the underlying lil-gui controller. */
export interface DockController<T = unknown> {
  readonly raw: Controller;
  setValue(value: T): void;
  setEnabled(enabled: boolean, opts?: { dim?: boolean }): void;
  setVisible(visible: boolean): void;
}

/** Option controller exposes setOptions() so dropdowns can refresh their list. */
export interface DockOptionController<T extends string | number> extends DockController<T> {
  setOptions(options: Record<string, T>): void;
}

/** Mount a lil-gui root in `host` once and tear it down on unmount. */
export function useGui(
  hostRef: React.RefObject<HTMLElement | null>,
  options?: { width?: number; closeFolders?: boolean },
): GUI | null {
  const [gui, setGui] = useState<GUI | null>(null);
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

/** Add a child folder to `parent` and remove it on unmount. */
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

function applyEnabled(c: Controller, enabled: boolean, dim: boolean): void {
  if (enabled) c.enable();
  else {
    c.disable();
    if (!dim) c.domElement.classList.remove("disabled");
  }
}

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

function useControllerLifecycle<T>(
  parent: GUI | null,
  label: string,
  value: T,
  onChange: (next: T) => void,
  factory: (parent: GUI, proxy: { value: T }, onChange: (next: T) => void) => Controller,
): DockController<T> | null {
  const [ctrl, setCtrl] = useState<DockController<T> | null>(null);
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
    // value and onChange intentionally excluded: value is mirrored below,
    // onChange is read through the ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parent, label]);

  useEffect(() => {
    if (ctrl) ctrl.setValue(value);
  }, [ctrl, value]);

  return ctrl;
}

// ── Primitive hooks ────────────────────────────────────────────────────────

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

export function useSlider(
  parent: GUI | null,
  label: string,
  range: { min: number; max: number; step?: number },
  value: number,
  onChange: (next: number) => void,
): DockController<number> | null {
  const rangeRef = useRef(range);
  rangeRef.current = range;
  return useControllerLifecycle(parent, label, value, onChange, (folder, proxy, cb) => {
    const r = rangeRef.current;
    return folder.add(proxy, "value", r.min, r.max, r.step).onChange((v: number) => cb(v));
  });
}

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

/** Always-disabled numeric display. Renders without the "disabled" CSS class
 *  so it reads as a normal row rather than a grayed-out one. */
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
