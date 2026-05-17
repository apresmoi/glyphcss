export function DropOverlay({ active }: { active: boolean }) {
  if (!active) return null;
  return <div className="drop-overlay">╔══[ DROP MESH HERE ]══╗</div>;
}
