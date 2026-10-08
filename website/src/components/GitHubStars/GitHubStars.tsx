import { useEffect, useState } from "react";
export function GitHubStars() {
  const [stars, setStars] = useState<number | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    void fetch("https://api.github.com/repos/apresmoi/glyphcss", { signal: abort.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((value) => {
        if (typeof value?.stargazers_count === "number") setStars(value.stargazers_count);
      })
      .catch(() => {});
    return () => abort.abort();
  }, []);
  return (
    <span aria-label={stars === null ? "GitHub stars" : stars + " GitHub stars"}>
      ★ {stars === null ? "…" : stars.toLocaleString()}
    </span>
  );
}
