import { stripParenthesizedText } from "../../GalleryWorkbench/presets";
import type { GizmoMode } from "../../types";
import type { PlacedItem } from "../types";

export interface BuilderSceneOutlinerProps {
  placedItems: PlacedItem[];
  selectedId: string | null;
  gizmoMode: GizmoMode;
  onSelectItem: (id: string) => void;
  onDeleteItem: (id: string) => void;
  onGizmoModeChange: (mode: GizmoMode) => void;
}

export function BuilderSceneOutliner({
  placedItems,
  selectedId,
  gizmoMode,
  onSelectItem,
  onDeleteItem,
  onGizmoModeChange,
}: BuilderSceneOutlinerProps) {
  return (
    <div className="builder-scene-folder">
      {placedItems.length === 0 ? (
        <p className="builder-scene-folder__empty">Click a model on the left to add it.</p>
      ) : (
        <ul className="builder-scene-folder__list">
          {placedItems.map((it) => (
            <li key={it.id}>
              <div
                className={`builder-scene-folder__row${it.id === selectedId ? " is-selected" : ""}`}
              >
                <button
                  type="button"
                  className="builder-scene-folder__select"
                  onClick={() => onSelectItem(it.id)}
                  title={it.preset.label}
                >
                  <span className="builder-scene-folder__icon" aria-hidden="true">⬢</span>
                  <span className="builder-scene-folder__label">{stripParenthesizedText(it.preset.label)}</span>
                </button>
                <button
                  type="button"
                  className="builder-scene-folder__remove"
                  aria-label={`Remove ${it.preset.label}`}
                  onClick={() => onDeleteItem(it.id)}
                >×</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="builder-scene-folder__gizmo">
        <button
          type="button"
          className={`builder-scene-folder__gizmo-btn${gizmoMode === "translate" ? " is-active" : ""}`}
          onClick={() => onGizmoModeChange("translate")}
          disabled={!selectedId}
        >Translate</button>
        <button
          type="button"
          className={`builder-scene-folder__gizmo-btn${gizmoMode === "rotate" ? " is-active" : ""}`}
          onClick={() => onGizmoModeChange("rotate")}
          disabled={!selectedId}
        >Rotate</button>
      </div>
    </div>
  );
}
