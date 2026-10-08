import styles from "./SiteTitle.module.css";
export function SiteTitle() {
  return (
    <a href="/" className={styles.title} aria-label="glyphcss home">
      <span aria-hidden="true">[</span>
      <span className={styles.name}>glyphcss</span>
      <span aria-hidden="true">]</span>
    </a>
  );
}
