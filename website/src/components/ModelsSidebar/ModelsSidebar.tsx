import React from "react";
import { ActionButton } from "../ActionButton";
import { CollapsibleSection } from "../ControlSection";
import { useModelCategories } from "./hooks/useModelCategories";
import { ChoiceButton } from "../IconToggle";
import { InstrumentRail } from "../InstrumentWorkbench";
import styles from "./ModelsSidebar.module.css";

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
  activeCategoryId: string;
  presetId: string;
  onPresetClick: (id: string) => void;
  attribution?: ModelAttribution;
  /** Extra class on the sidebar root (e.g. `is-mobile-open` for the mobile drawer). */
  className?: string;
  id?: string;
}

function AttributionCredit({ attribution }: { attribution?: ModelAttribution }) {
  if (!attribution) {
    return <p className="model-credit">Source: Unknown</p>;
  }

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
  activeCategoryId,
  presetId,
  onPresetClick,
  attribution,
  className,
  id,
}: ModelsSidebarProps) {
  const categories = useModelCategories(presetId, activeCategoryId, modelSearch);
  return (
    <InstrumentRail
      id={id ?? "gallery-models-panel"}
      title="Models"
      bodyInset="inline"
      open={className?.includes("is-mobile-open")}
      className={`${styles.root} models-sidebar`}
      toolbar={
        <div className="models-sidebar__header">
          <input
            className="model-search models-sidebar__search"
            aria-label="Search models"
            type="search"
            placeholder="Search models"
            value={modelSearch}
            onChange={(event) => onModelSearchChange(event.target.value)}
            autoComplete="off"
          />
          <ActionButton type="button" className="control-btn" onClick={onImportClick}>
            Import
          </ActionButton>
          <ActionButton type="button" className="control-btn control-btn--primary" onClick={onRandomPreset}>
            Load Random
          </ActionButton>
          <input
            ref={fileInputRef}
            className="model-file-input"
            type="file"
            multiple
            accept=".obj,.glb,.vox,.mtl,.png,.jpg,.jpeg,.webp,.gif,.bmp"
            onChange={onFileInputChange}
          />
        </div>
      }
      footer={<AttributionCredit attribution={attribution} />}
    >
      {modelCategories.length === 0 ? (
        <div className="model-empty">No matching models</div>
      ) : (
        <div className="model-tree">
          {modelCategories.map((category) => (
            <CollapsibleSection
              key={category.id}
              title={category.label}
              label={category.label}
              count={category.models.length}
              open={categories.isOpen(category.id)}
              onOpenChange={(open) => categories.setOpen(category.id, open)}
              sticky
            >
              <div className="model-button-list">
                {category.models.map((preset) => (
                  <ChoiceButton
                    type="button"
                    key={preset.id}
                    align="start"
                    aria-label={preset.label}
                    aria-pressed={preset.id === presetId}
                    title={preset.label}
                    className="sidebar-item"
                    onClick={() => onPresetClick(preset.id)}
                  >
                    <span className="model-name">{preset.label}</span>
                  </ChoiceButton>
                ))}
              </div>
            </CollapsibleSection>
          ))}
        </div>
      )}
    </InstrumentRail>
  );
}
