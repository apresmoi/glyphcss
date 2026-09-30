import styles from "./DropOverlay.module.css";
export function DropOverlay({ active }: { active: boolean }) {
  if (!active) return null;
  return <div className={`${styles.root} drop-overlay`}>╔══[ DROP MESH HERE ]══╗</div>;
}
