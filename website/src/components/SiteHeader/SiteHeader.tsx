import type { ReactNode } from "react";
import { SITE_LINKS, isSiteLinkActive } from "../../config/navigation";
import { SiteTitle } from "../SiteTitle";
import styles from "./SiteHeader.module.css";
export interface SiteHeaderProps {
  pathname: string;
  search?: ReactNode;
  repository?: ReactNode;
}
export function SiteHeader({ pathname, search, repository }: SiteHeaderProps) {
  return (
    <div className={styles.header}>
      <SiteTitle />
      <nav className={styles.navigation} aria-label="Site sections">
        {SITE_LINKS.map((link) => (
          <a
            key={link.href}
            href={link.href}
            className={"mobileHidden" in link ? styles.mobileHidden : undefined}
            aria-current={isSiteLinkActive(pathname, link.href) ? "page" : undefined}
          >
            <span aria-hidden="true">{isSiteLinkActive(pathname, link.href) ? "[ " : "> "}</span>
            {link.label}
            <span aria-hidden="true">{isSiteLinkActive(pathname, link.href) ? " ]" : ""}</span>
          </a>
        ))}
      </nav>
      <div className={styles.repository}>
        {repository ?? (
          <a href="https://github.com/apresmoi/glyphcss" target="_blank" rel="noopener noreferrer">
            [ GitHub ↗ ]
          </a>
        )}
      </div>
      {search && <div className={styles.search}>{search}</div>}
    </div>
  );
}
