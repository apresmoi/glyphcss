export function DropOverlay({ active }: { active: boolean }): JSX.Element | null {
  if (!active) return null;
  return <div className="drop-overlay">Drop OBJ / GLB / VOX</div>;
}
