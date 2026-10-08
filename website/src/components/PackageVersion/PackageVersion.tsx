import { useEffect, useState } from "react";
import { latestRelease, PACKAGE_URL } from "../../services/package-release/latestRelease";
import styles from "./PackageVersion.module.css";

export function PackageVersion() {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    void latestRelease(abort.signal).then((value) => {
      if (!abort.signal.aborted) setVersion(value);
    });
    return () => abort.abort();
  }, []);
  return (
    <a
      className={styles.link}
      href={version ? `${PACKAGE_URL}/v/${version}` : PACKAGE_URL}
      target="_blank"
      rel="noopener noreferrer"
    >
      [ glyphcss {version ? `v${version}` : "on npm"} ↗ ]
    </a>
  );
}
