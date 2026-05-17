/**
 * Model folder — live render metrics (DOM nodes, per-strategy counts) with
 * inline strategy-disable checkboxes injected next to the count rows.
 *
 * The four readonly counts come from `metrics`; the three injected checkboxes
 * (b / u / i) write into `disableStrategies` via `onUpdateScene`. The sprite
 * count has no checkbox because `<s>` is the universal fallback strategy and
 * cannot be disabled (see AGENTS.md → Rendering model).
 */
import { useEffect, useRef } from "react";
import type { GUI } from "lil-gui";
import type { PolyRenderStrategy } from "@layoutit/polycss-react";
import type { DomMetrics } from "../../types";
import { useFolder, useReadonlyNumber, type DockController } from "../primitives";

const SHAPE_LABELS = {
  rectangle: "Quads <b>",
  triangle: "Triangles <u>",
  irregular: "Polygons <i>",
};

export interface ModelFolderInputs {
  metrics: DomMetrics;
  disableStrategies: PolyRenderStrategy[];
  onUpdateScene: (partial: { disableStrategies: PolyRenderStrategy[] }) => void;
}

/**
 * Inject an inline checkbox into a readonly-number row that toggles whether
 * the given render strategy is in `disableStrategies`. lil-gui doesn't have a
 * native "label + value + checkbox" widget so we append to the `.widget` div
 * of the underlying controller after mount. Returns the created element (or
 * null if the widget DOM isn't ready yet) so the caller can update
 * `checkbox.checked` when external state changes.
 */
function injectStrategyCheckbox(
  controller: DockController<number> | null,
  strategy: PolyRenderStrategy,
  disableStrategiesRef: React.MutableRefObject<PolyRenderStrategy[]>,
  onUpdate: (partial: { disableStrategies: PolyRenderStrategy[] }) => void,
): HTMLInputElement | null {
  const dom = controller?.raw.domElement;
  const widget = dom?.querySelector?.<HTMLElement>(".widget");
  if (!widget) return null;
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.className = "dn-strategy-toggle";
  checkbox.checked = !disableStrategiesRef.current.includes(strategy);
  checkbox.addEventListener("change", () => {
    const current = disableStrategiesRef.current;
    onUpdate({
      disableStrategies: checkbox.checked
        ? current.filter((s) => s !== strategy)
        : [...current.filter((s) => s !== strategy), strategy],
    });
  });
  widget.appendChild(checkbox);
  return checkbox;
}

export function useModelFolder(parent: GUI | null, inputs: ModelFolderInputs): void {
  const { metrics, disableStrategies, onUpdateScene } = inputs;

  // Live refs so the injection effect's event listener always sees the latest
  // values without re-running (and re-injecting) on every render.
  const disableStrategiesRef = useRef(disableStrategies);
  disableStrategiesRef.current = disableStrategies;
  const onUpdateSceneRef = useRef(onUpdateScene);
  onUpdateSceneRef.current = onUpdateScene;

  const folder = useFolder(parent, "Model", { open: true });

  useReadonlyNumber(folder, "DOM nodes", metrics.nodeCount);
  useReadonlyNumber(folder, "Sprites <s>", metrics.sprites);
  const rectsCtrl = useReadonlyNumber(folder, SHAPE_LABELS.rectangle, metrics.rects);
  const trianglesCtrl = useReadonlyNumber(folder, SHAPE_LABELS.triangle, metrics.triangles);
  const irregularCtrl = useReadonlyNumber(folder, SHAPE_LABELS.irregular, metrics.irregular);

  // Hold the injected checkbox elements so the sync effect below can update
  // their `.checked` state when `disableStrategies` changes externally.
  const bCheckboxRef = useRef<HTMLInputElement | null>(null);
  const uCheckboxRef = useRef<HTMLInputElement | null>(null);
  const iCheckboxRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!rectsCtrl || !trianglesCtrl || !irregularCtrl) return;
    bCheckboxRef.current = injectStrategyCheckbox(rectsCtrl, "b", disableStrategiesRef, (p) =>
      onUpdateSceneRef.current(p),
    );
    uCheckboxRef.current = injectStrategyCheckbox(trianglesCtrl, "u", disableStrategiesRef, (p) =>
      onUpdateSceneRef.current(p),
    );
    iCheckboxRef.current = injectStrategyCheckbox(irregularCtrl, "i", disableStrategiesRef, (p) =>
      onUpdateSceneRef.current(p),
    );
    return () => {
      bCheckboxRef.current?.remove();
      uCheckboxRef.current?.remove();
      iCheckboxRef.current?.remove();
      bCheckboxRef.current = null;
      uCheckboxRef.current = null;
      iCheckboxRef.current = null;
    };
  }, [rectsCtrl, trianglesCtrl, irregularCtrl]);

  // Mirror external `disableStrategies` changes into the checkbox UI. The
  // checkboxes are DOM nodes outside React's tree, so we drive `.checked`
  // imperatively.
  useEffect(() => {
    if (bCheckboxRef.current) bCheckboxRef.current.checked = !disableStrategies.includes("b");
    if (uCheckboxRef.current) uCheckboxRef.current.checked = !disableStrategies.includes("u");
    if (iCheckboxRef.current) iCheckboxRef.current.checked = !disableStrategies.includes("i");
  }, [disableStrategies]);
}
