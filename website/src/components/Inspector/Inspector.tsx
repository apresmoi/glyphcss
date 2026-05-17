import { useEffect, useRef, useState } from "react";
import type { TextureTriangle } from "@glyphcss/core";

export interface InspectorColorGroup {
  /** Hex when `editable`; group label (e.g. "textured") when not. */
  color: string;
  count: number;
  editable: boolean;
  triangles: TextureTriangle[];
}

export interface InspectorMesh {
  id: string;
  label: string;
  groups: InspectorColorGroup[];
}

export function Inspector({
  meshes,
  onColorChange,
}: {
  meshes: InspectorMesh[];
  onColorChange: (
    mesh: InspectorMesh,
    group: InspectorColorGroup,
    next: string,
  ) => void;
}) {
  if (meshes.length === 0) return null;
  return (
    <aside className="dn-inspector" aria-label="Inspector">
      <header className="dn-inspector__title">Inspector</header>
      <div className="dn-inspector__body dark-scrollbar">
        {meshes.map((mesh) => (
          <MeshNode key={mesh.id} mesh={mesh} onColorChange={onColorChange} />
        ))}
      </div>
    </aside>
  );
}

export const InspectorPanel = Inspector;

function MeshNode({
  mesh,
  onColorChange,
}: {
  mesh: InspectorMesh;
  onColorChange: (
    mesh: InspectorMesh,
    group: InspectorColorGroup,
    next: string,
  ) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="dn-mesh-node">
      <button
        type="button"
        className={`dn-mesh-header${open ? " is-open" : ""}`}
        onClick={() => setOpen(!open)}
      >
        <span className="dn-mesh-chevron" aria-hidden="true">
          {open ? "▾" : "▸"}
        </span>
        <span className="dn-mesh-icon" aria-hidden="true">
          {"⬢"}
        </span>
        <span className="dn-mesh-label">{mesh.label}</span>
        <span className="dn-mesh-meta">{mesh.groups.length}</span>
      </button>
      {open && (
        <ul className="dn-mesh-groups">
          {mesh.groups.map((g, i) => (
            <GroupRow
              key={`${g.color}:${i}`}
              group={g}
              onChange={(next) => onColorChange(mesh, g, next)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function GroupRow({
  group,
  onChange,
}: {
  group: InspectorColorGroup;
  onChange: (next: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [currentColor, setCurrentColor] = useState(group.color);
  useEffect(() => {
    setCurrentColor(group.color);
  }, [group.color]);
  if (!group.editable) {
    return (
      <li className="dn-group-row is-readonly">
        <span className="dn-swatch dn-swatch--readonly" aria-hidden="true" />
        <span className="dn-group-label">{group.color}</span>
        <span className="dn-group-count">{group.count}</span>
      </li>
    );
  }
  return (
    <li className="dn-group-row">
      <button
        type="button"
        className="dn-swatch"
        style={{ background: currentColor }}
        onClick={() => inputRef.current?.click()}
        aria-label={`Change color of ${group.count} triangles (currently ${currentColor})`}
      />
      <input
        ref={inputRef}
        type="color"
        className="dn-color-input"
        value={currentColor}
        onChange={(e) => {
          setCurrentColor(e.target.value);
          onChange(e.target.value);
        }}
      />
      <span className="dn-group-label">{currentColor}</span>
      <span className="dn-group-count">{group.count}</span>
    </li>
  );
}
