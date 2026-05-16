import React from "react";

export interface ModelAttribution {
  creator: string;
  license?: string;
  sourceUrl?: string;
  tris?: number;
}

export interface PresetModel {
  id: string;
  label: string;
  attribution?: ModelAttribution;
}

export interface ModelCategory {
  id: string;
  label: string;
  models: PresetModel[];
}

export interface ModelsSidebarProps {
  modelSearch: string;
  onModelSearchChange: (value: string) => void;
  onImportClick: () => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onFileInputChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onRandomPreset: () => void;
  modelCategories: ModelCategory[];
  isCategoryOpen: (id: string) => boolean;
  onToggleCategory: (id: string) => void;
  modelTreeId: string[];
  presetId: string;
  onPresetClick: (id: string) => void;
  attribution?: ModelAttribution;
}

function AttributionCredit({ attribution }: { attribution?: ModelAttribution }) {
  if (!attribution) {
    return <p className="model-credit">Source: Unknown</p>;
  }

  const trisText =
    typeof attribution.tris === "number" ? ` · ${attribution.tris.toLocaleString()} tris` : "";

  return (
    <p className="model-credit">
      Source:{" "}
      {attribution.sourceUrl ? (
        <a href={attribution.sourceUrl} target="_blank" rel="noreferrer">
          {attribution.creator}
        </a>
      ) : (
        attribution.creator
      )}
      {attribution.license ? ` · ${attribution.license}` : ""}
      {trisText}
    </p>
  );
}

export function ModelsSidebar({
  modelSearch,
  onModelSearchChange,
  onImportClick,
  fileInputRef,
  onFileInputChange,
  onRandomPreset,
  modelCategories,
  isCategoryOpen,
  onToggleCategory,
  modelTreeId,
  presetId,
  onPresetClick,
  attribution,
}: ModelsSidebarProps) {
  return (
    <aside className="models-sidebar" aria-label="Models">
      <div className="models-sidebar__body dark-scrollbar">
        <div className="models-sidebar__header">
          <input
            className="model-search models-sidebar__search"
            type="search"
            placeholder="Search models"
            value={modelSearch}
            onChange={(event) => onModelSearchChange(event.target.value)}
            autoComplete="off"
          />
          <button type="button" className="control-btn" onClick={onImportClick}>
            Import
          </button>
          <button type="button" className="control-btn control-btn--primary" onClick={onRandomPreset}>
            Load Random
          </button>
          <input
            ref={fileInputRef}
            className="model-file-input"
            type="file"
            multiple
            accept=".obj,.glb,.vox,.mtl,.png,.jpg,.jpeg,.webp,.gif,.bmp"
            onChange={onFileInputChange}
          />
        </div>

        {modelCategories.length === 0 ? (
          <div className="model-empty">No matching models</div>
        ) : (
          <div className="model-tree dark-scrollbar" id="debug-model-tree">
            {modelCategories.map((category, index) => {
              const isOpen = isCategoryOpen(category.id);
              const treeId = modelTreeId[index];
              return (
                <div key={category.id} className="tree-category" data-cat-id={category.id}>
                  <button
                    type="button"
                    className="tree-heading"
                    aria-expanded={isOpen}
                    aria-controls={treeId}
                    onClick={() => onToggleCategory(category.id)}
                  >
                    <span className="tree-label">
                      <span className={`tree-caret${isOpen ? " open" : ""}`}>▸</span>
                      {category.label}
                    </span>
                    <span className="tree-count">{category.models.length}</span>
                  </button>
                  <div className="model-button-list dark-scrollbar" id={treeId} style={isOpen ? undefined : { display: "none" }}>
                    {category.models.map((preset) => (
                      <button
                        type="button"
                        key={preset.id}
                        className={`sidebar-item${preset.id === presetId ? " active" : ""}`}
                        onClick={() => onPresetClick(preset.id)}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <AttributionCredit attribution={attribution} />
      </div>
    </aside>
  );
}
